// Terrain height as a pure function of (x, z): the curated islands from map.ts, shaped by
// per-island profiles, plus seeded noise for coastlines and detail and a few filler islets.
import { MathUtils } from 'three';
import { ISLANDS, type Island, SEA_FLOOR, SPAWN, WORLD_HALF_SIZE } from './map';
import { fbm, type Noise2, ridged, simplex2 } from './noise';
import { seeded } from './random';

/** Size of a terrain chunk and the finest grid spacing. surface() matches meshes built on this grid. */
export const CHUNK_SIZE = 500;
export const FINE_SEGMENTS = 64;
export const CELL = CHUNK_SIZE / FINE_SEGMENTS;

const WARP_FREQ = 1 / 900;
const WARP_AMP = 140;

interface PreparedIsland extends Island {
  cos: number;
  sin: number;
  /** Bounding radius including coastline warp. */
  reach: number;
}

function prepare(island: Island): PreparedIsland {
  return {
    ...island,
    cos: Math.cos(island.angle),
    sin: Math.sin(island.angle),
    reach: Math.max(island.rx, island.rz) + WARP_AMP + 20,
  };
}

export interface HeightfieldOptions {
  seed: number;
  /** Multiplier on noise detail (0 = smooth authored shapes only). */
  detail: number;
  fillerIslets: number;
}

export class Heightfield {
  readonly islands: PreparedIsland[];
  private readonly warpX: Noise2;
  private readonly warpZ: Noise2;
  private readonly detailNoise: Noise2;
  private readonly ridgeNoise: Noise2;
  private readonly detail: number;
  /** Fine-grid heights per chunk, filled lazily; shared by meshing and surface(). */
  private readonly cache = new Map<number, Float32Array>();
  private readonly landCache = new Map<number, boolean>();

  constructor(options: HeightfieldOptions) {
    const rand = seeded(options.seed, 'terrain');
    this.warpX = simplex2(Math.floor(rand() * 2 ** 31));
    this.warpZ = simplex2(Math.floor(rand() * 2 ** 31));
    this.detailNoise = simplex2(Math.floor(rand() * 2 ** 31));
    this.ridgeNoise = simplex2(Math.floor(rand() * 2 ** 31));
    this.detail = options.detail;
    this.islands = [...ISLANDS, ...fillerIslets(rand, options.fillerIslets)].map(prepare);
  }

  /** Islands whose reach overlaps the rectangle. */
  islandsIn(minX: number, minZ: number, maxX: number, maxZ: number): PreparedIsland[] {
    return this.islands.filter((i) => {
      const cx = MathUtils.clamp(i.x, minX, maxX);
      const cz = MathUtils.clamp(i.z, minZ, maxZ);
      return (i.x - cx) ** 2 + (i.z - cz) ** 2 < i.reach * i.reach;
    });
  }

  /** Exact height of the analytic field. */
  height(x: number, z: number, islands: readonly PreparedIsland[] = this.islands): number {
    const wx = x + this.warpX(x * WARP_FREQ, z * WARP_FREQ) * WARP_AMP;
    const wz = z + this.warpZ(x * WARP_FREQ + 31.7, z * WARP_FREQ - 12.3) * WARP_AMP;
    let h = SEA_FLOOR;
    let cliff = 0;
    for (const island of islands) {
      const dx = x - island.x;
      const dz = z - island.z;
      if (dx * dx + dz * dz > island.reach * island.reach) continue;
      const ih = this.islandHeight(island, wx, wz);
      if (ih > h) {
        h = ih;
        cliff = island.cliff ?? 0;
      }
    }
    // Coastal cliffs: land just above sea level jumps up by `cliff` meters within a few meters
    // of height, so the coast rises in a wall. Noise along the coast leaves some coves and beaches.
    if (cliff > 0 && h > 0) {
      const along = 0.5 + 0.5 * this.detailNoise(x / 650 + 17.1, z / 650 - 3.7);
      const amount = cliff * MathUtils.smoothstep(along, 0.3, 0.6);
      h += amount * MathUtils.smoothstep(h, 0.6, 7);
    }
    return h;
  }

  /** Fine-grid heights for a chunk ((FINE_SEGMENTS+1)² values, row-major in z then x). */
  chunkHeights(cx: number, cz: number): Float32Array {
    const key = chunkKey(cx, cz);
    let heights = this.cache.get(key);
    if (heights) return heights;
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const islands = this.islandsIn(x0, z0, x0 + CHUNK_SIZE, z0 + CHUNK_SIZE);
    const n = FINE_SEGMENTS + 1;
    heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) heights[j * n + i] = this.height(x0 + i * CELL, z0 + j * CELL, islands);
    }
    this.cache.set(key, heights);
    return heights;
  }

  /** True if any island reaches into the chunk. */
  chunkHasLand(cx: number, cz: number): boolean {
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    return this.islandsIn(x0, z0, x0 + CHUNK_SIZE, z0 + CHUNK_SIZE).length > 0;
  }

  /**
   * Height of the rendered surface: the fine grid, interpolated over the same triangles the
   * finest mesh uses. Collision and camera use this so they agree with what is on screen.
   */
  surface(x: number, z: number): number {
    const gx = x / CELL;
    const gz = z / CELL;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const h00 = this.fineHeight(ix, iz);
    const h11 = this.fineHeight(ix + 1, iz + 1);
    // Triangles split along the (0,0)-(1,1) diagonal, matching terrain.ts.
    if (fx > fz) {
      const h10 = this.fineHeight(ix + 1, iz);
      return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
    }
    const h01 = this.fineHeight(ix, iz + 1);
    return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  /** Height at a fine-grid vertex (global grid indices, spacing CELL). */
  fineHeight(ix: number, iz: number): number {
    const cx = Math.floor(ix / FINE_SEGMENTS);
    const cz = Math.floor(iz / FINE_SEGMENTS);
    if (!this.chunkHasLandCached(cx, cz)) return SEA_FLOOR;
    const heights = this.chunkHeights(cx, cz);
    return heights[(iz - cz * FINE_SEGMENTS) * (FINE_SEGMENTS + 1) + (ix - cx * FINE_SEGMENTS)];
  }

  private chunkHasLandCached(cx: number, cz: number): boolean {
    const key = chunkKey(cx, cz);
    let land = this.landCache.get(key);
    if (land === undefined) {
      land = this.chunkHasLand(cx, cz);
      this.landCache.set(key, land);
    }
    return land;
  }

  private islandHeight(island: PreparedIsland, wx: number, wz: number): number {
    const dx = wx - island.x;
    const dz = wz - island.z;
    // Into the island's own frame, normalized so the nominal coastline region is d ≈ 1.
    const lx = (dx * island.cos + dz * island.sin) / island.rx;
    const lz = (-dx * island.sin + dz * island.cos) / island.rz;
    const d = Math.sqrt(lx * lx + lz * lz);
    if (d >= 1.1) return SEA_FLOOR;

    const H = island.height;
    const detail = this.detail;
    const bumps = fbm(this.detailNoise, wx / 280, wz / 280, 4) * Math.min(35, 0.22 * H) * detail;
    let f: number; // 0 = sea floor, 1 = peak
    let extra = 0;

    switch (island.shape) {
      case 'hill': {
        const t = Math.max(0, 1 - d * d);
        f = t * t;
        extra = bumps * f;
        break;
      }
      case 'volcano': {
        const c = Math.max(0, 1 - d);
        f = Math.pow(c, 1.5);
        if (d < 0.07) f -= (0.07 - d) * 2.2; // crater
        const r = ridged(this.ridgeNoise, wx / 520, wz / 520, 4);
        extra = (r - 0.5) * 0.35 * H * c * detail + bumps * c * 0.5;
        break;
      }
      case 'ridge': {
        const t = Math.max(0, 1 - d * d);
        f = t * t;
        // Crest height varies along the length, with ridged gullies on the flanks.
        const along = lx * 2.2;
        f *= 0.65 + 0.35 * (0.5 + 0.5 * this.ridgeNoise(along, 7.3));
        const r = ridged(this.ridgeNoise, wx / 380, wz / 380, 4);
        extra = (r - 0.5) * 0.3 * H * t * detail + bumps * t * 0.5;
        break;
      }
      case 'mesa': {
        const top = 1 - MathUtils.smoothstep(d, 0.62, 0.78);
        const skirt = d < 1 ? (1 - d) * (1 - d) * 0.3 : 0;
        f = Math.max(top * 0.97, skirt);
        extra = bumps * 0.4 * top;
        break;
      }
      case 'caldera': {
        const rim = Math.exp(-(((d - 0.62) / 0.2) ** 2));
        const lagoon = 0.15 * (1 - MathUtils.smoothstep(d, 0.5, 0.75));
        f = Math.max(rim, lagoon) * (1 - MathUtils.smoothstep(d, 0.92, 1.1));
        extra = bumps * rim;
        break;
      }
    }
    return SEA_FLOOR + (H - SEA_FLOOR) * f + extra;
  }
}

function chunkKey(cx: number, cz: number): number {
  return (cx + 4096) * 8192 + (cz + 4096);
}

function fillerIslets(rand: () => number, count: number): Island[] {
  const out: Island[] = [];
  for (let tries = 0; out.length < count && tries < count * 50; tries++) {
    const rx = 80 + rand() * 200;
    const islet: Island = {
      name: `islet ${out.length}`,
      shape: 'hill',
      x: (rand() - 0.5) * 2 * (WORLD_HALF_SIZE - 500),
      z: (rand() - 0.5) * 2 * (WORLD_HALF_SIZE - 500),
      rx,
      rz: rx * (0.5 + rand() * 0.5),
      angle: rand() * Math.PI,
      height: 15 + rand() * 55,
    };
    const clear = [...ISLANDS, ...out].every(
      (o) => Math.hypot(o.x - islet.x, o.z - islet.z) > Math.max(o.rx, o.rz) + rx + 250,
    );
    // Keep the approach from the spawn point open.
    const inApproach = Math.abs(islet.x - SPAWN.x) < 500 && islet.z > 2800;
    if (clear && !inApproach) out.push(islet);
  }
  return out;
}
