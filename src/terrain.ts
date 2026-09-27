// Terrain meshes: land chunks streamed around the player with distance-based LOD.
// Flat-shaded, one color per triangle from height and slope. Skirts hide cracks between LODs.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  type Vector3,
} from 'three';
import { CHUNK_SIZE, FINE_SEGMENTS, Heightfield } from './heightfield';
import { WORLD_HALF_SIZE } from './map';
import { PALETTE } from './palette';
import { tuning } from './tuning';

/** Grid step (in fine cells) per LOD level: 64, 32, 16, 8 segments per chunk. */
const LOD_STEPS = [1, 2, 4, 8];
const HYSTERESIS = 60; // meters, so chunks don't flicker between LODs at a boundary
const SKIRT_DEPTH = 12;

const C = {
  seaDeep: new Color(PALETTE.seaDeep),
  wetSand: new Color(PALETTE.sand).multiplyScalar(0.72),
  sand: new Color(PALETTE.sand),
  grass: new Color(PALETTE.ground),
  moss: new Color(PALETTE.moss),
  cliff: new Color(PALETTE.terracotta),
  rock: new Color(PALETTE.sage),
  snow: new Color(PALETTE.bone),
};

interface Chunk {
  cx: number;
  cz: number;
  mesh: Mesh | null;
  lod: number; // -1 = not built
}

/** Small hash in [0, 1) for per-face color jitter. */
function hash2(x: number, z: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function faceColor(out: Color, h: number, ny: number, x: number, z: number): Color {
  const j = hash2(x, z);
  // Deep seabed matches the open-sea floor plane in world.ts, so chunk edges vanish under water.
  if (h < -6) out.copy(C.seaDeep).lerp(C.wetSand, MathUtils.smoothstep(h, -30, -6));
  else if (h < 3 + j * 3) out.copy(C.sand);
  else if (ny < 0.7) out.copy(h > 260 ? C.rock : C.cliff).lerp(C.rock, j * 0.4);
  else if (h > 470 + j * 40 && ny > 0.8) out.copy(C.snow);
  else if (h > 260) out.copy(C.moss).lerp(C.rock, (h - 260) / 300);
  else out.copy(C.grass).lerp(C.moss, j * 0.5 + (h / 260) * 0.4);
  return out.multiplyScalar(0.94 + j * 0.1);
}

export class Terrain {
  readonly group = new Group();
  private heightfield: Heightfield;
  private readonly material = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  private chunks: Chunk[] = [];

  constructor(heightfield: Heightfield) {
    this.heightfield = heightfield;
    this.setHeightfield(heightfield);
  }

  /** Swap in a new heightfield (after seed/detail changes): drops all meshes. */
  setHeightfield(heightfield: Heightfield): void {
    this.heightfield = heightfield;
    for (const chunk of this.chunks) chunk.mesh?.geometry.dispose();
    this.group.clear();
    this.chunks = [];
    const n = Math.ceil(WORLD_HALF_SIZE / CHUNK_SIZE);
    for (let cz = -n; cz < n; cz++) {
      for (let cx = -n; cx < n; cx++) {
        if (heightfield.chunkHasLand(cx, cz)) this.chunks.push({ cx, cz, mesh: null, lod: -1 });
      }
    }
  }

  /** Streams chunks around the player. `budgetMs` caps mesh building time this frame. */
  update(player: Vector3, budgetMs: number): void {
    const t = tuning.terrain;
    const wanted: { chunk: Chunk; lod: number; dist: number }[] = [];
    for (const chunk of this.chunks) {
      const dist = this.distanceTo(chunk, player);
      const lod = this.lodFor(dist, chunk.lod, t.lodDistance, t.drawDistance);
      if (lod !== chunk.lod) wanted.push({ chunk, lod, dist });
    }
    wanted.sort((a, b) => a.dist - b.dist);

    const start = performance.now();
    for (const { chunk, lod } of wanted) {
      if (lod === -1) {
        this.drop(chunk);
        continue;
      }
      if (performance.now() - start > budgetMs) continue; // only drops after the budget is spent
      const geometry = this.buildGeometry(chunk.cx, chunk.cz, LOD_STEPS[lod]);
      if (chunk.mesh) {
        chunk.mesh.geometry.dispose();
        chunk.mesh.geometry = geometry;
      } else {
        chunk.mesh = new Mesh(geometry, this.material);
        chunk.mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
        this.group.add(chunk.mesh);
      }
      chunk.lod = lod;
    }
  }

  private drop(chunk: Chunk): void {
    if (chunk.mesh) {
      chunk.mesh.geometry.dispose();
      this.group.remove(chunk.mesh);
      chunk.mesh = null;
    }
    chunk.lod = -1;
  }

  private distanceTo(chunk: Chunk, p: Vector3): number {
    const x0 = chunk.cx * CHUNK_SIZE;
    const z0 = chunk.cz * CHUNK_SIZE;
    const dx = Math.max(x0 - p.x, 0, p.x - (x0 + CHUNK_SIZE));
    const dz = Math.max(z0 - p.z, 0, p.z - (z0 + CHUNK_SIZE));
    return Math.hypot(dx, dz);
  }

  private lodFor(dist: number, current: number, lodDistance: number, drawDistance: number): number {
    const hidden = LOD_STEPS.length; // "not drawn" sorts as coarser than every level
    const at = (d: number) => {
      if (d > drawDistance) return hidden;
      const level = Math.floor(Math.log2(Math.max(d, 1) / lodDistance) + 1);
      return Math.min(LOD_STEPS.length - 1, Math.max(0, level));
    };
    const target = at(dist);
    const now = current === -1 ? hidden : current;
    // Switch only once the boundary is HYSTERESIS meters behind us, so chunks don't flicker.
    const confirmed = at(dist + (target > now ? -HYSTERESIS : HYSTERESIS)) === target;
    const next = target === now || current === -1 || confirmed ? target : now;
    return next === hidden ? -1 : next;
  }

  private buildGeometry(cx: number, cz: number, step: number): BufferGeometry {
    const heights = this.heightfield.chunkHeights(cx, cz);
    const n = FINE_SEGMENTS + 1;
    const segs = FINE_SEGMENTS / step;
    const cell = CHUNK_SIZE / segs;
    const h = (i: number, j: number) => heights[j * step * n + i * step];

    const triCount = segs * segs * 2 + segs * 4 * 2;
    const pos = new Float32Array(triCount * 9);
    const col = new Float32Array(triCount * 9);
    let v = 0;
    const color = new Color();
    const wx0 = cx * CHUNK_SIZE;
    const wz0 = cz * CHUNK_SIZE;

    const tri = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx_: number, cy: number, cz_: number,
      colorSlope?: number,
    ) => {
      // Face normal y (for slope), from the cross product (b - a) x (c - a).
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx_ - ax, vy = cy - ay, vz = cz_ - az;
      const nx = uy * vz - uz * vy;
      const nyRaw = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const ny = colorSlope ?? Math.abs(nyRaw) / (Math.hypot(nx, nyRaw, nz) || 1);
      const mx = (ax + bx + cx_) / 3;
      const mz = (az + bz + cz_) / 3;
      faceColor(color, Math.max(ay, by, cy), ny, wx0 + mx, wz0 + mz);
      pos.set([ax, ay, az, bx, by, bz, cx_, cy, cz_], v);
      for (let k = 0; k < 3; k++) color.toArray(col, v + k * 3);
      v += 9;
    };

    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const x0 = i * cell, x1 = x0 + cell, z0 = j * cell, z1 = z0 + cell;
        const h00 = h(i, j), h10 = h(i + 1, j), h01 = h(i, j + 1), h11 = h(i + 1, j + 1);
        // Split along (0,0)-(1,1); counter-clockwise seen from above.
        tri(x0, h00, z0, x1, h11, z1, x1, h10, z0);
        tri(x0, h00, z0, x0, h01, z1, x1, h11, z1);
      }
    }

    // Skirts: a strip hanging down from each edge so LOD seams never show sky through cracks.
    const drop = SKIRT_DEPTH * step;
    for (let k = 0; k < segs; k++) {
      const a = k * cell, b = a + cell;
      // North edge (z = 0), south edge (z = CHUNK_SIZE), west (x = 0), east (x = CHUNK_SIZE).
      const edges: [number, number, number, number, number, number][] = [
        [a, 0, h(k, 0), b, 0, h(k + 1, 0)],
        [b, CHUNK_SIZE, h(k + 1, segs), a, CHUNK_SIZE, h(k, segs)],
        [0, b, h(0, k + 1), 0, a, h(0, k)],
        [CHUNK_SIZE, a, h(segs, k), CHUNK_SIZE, b, h(segs, k + 1)],
      ];
      for (const [x1, z1, y1, x2, z2, y2] of edges) {
        // Colored like flat ground at the edge height, so a crack shows ground, not a dark wall.
        tri(x1, y1, z1, x2, y2, z2, x2, y2 - drop, z2, 1);
        tri(x1, y1, z1, x2, y2 - drop, z2, x1, y1 - drop, z1, 1);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    geometry.computeVertexNormals(); // non-indexed, so these are face normals: flat shading
    // Skirts are lit as if flat: where one peeks above a coarser neighbor it blends in
    // instead of showing as a dark vertical line.
    const normals = geometry.attributes.normal as BufferAttribute;
    for (let i = segs * segs * 6; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
    geometry.computeBoundingSphere();
    return geometry;
  }
}
