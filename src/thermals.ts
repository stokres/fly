// Thermals: invisible rising columns of air. Circle inside one to gain height without flapping.
// They are marked without UI: a faint shimmering column, motes drifting upward in a slow spiral,
// and birds circling inside. Every landmark has one beside it, and one waits just ahead of the spawn point.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { Landmark } from './landmarks';
import { PALETTE } from './palette';
import { seeded } from './random';
import { TileGrid, WORLD_TILE, wrapDelta } from './tiling';
import { tuning } from './tuning';

const MOTE_COLOR = new Color(PALETTE.bone);

export interface Thermal {
  /** Tile-local center. */
  x: number;
  z: number;
  radius: number;
  /** Peak updraft at the core, m/s. */
  strength: number;
  /** Height where the lift has faded to zero. */
  top: number;
  /** +1 or -1: which way the motes and birds circle. */
  spin: number;
}

/** Updraft of one thermal at squared horizontal distance `dist2` and height `y`. */
export function thermalLift(th: Thermal, dist2: number, y: number): number {
  const d2 = dist2 / (th.radius * th.radius);
  if (d2 >= 1) return 0;
  const core = 1 - d2 * d2; // broad core, soft edge
  const fade = 1 - MathUtils.smoothstep(y, th.top * 0.75, th.top);
  return th.strength * core * fade;
}

interface Mote {
  thermal: Thermal;
  angle: number;
  radiusFrac: number;
  phase: number;
  rise: number;
}

interface Bird {
  thermal: Thermal;
  angle: number;
  orbit: number;
  height: number;
  speed: number;
  bob: number;
}

function softDotTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

/** Unit open cylinder (radius 1, height 1, base at y=0) whose alpha fades out toward the top. */
function columnGeometry(): BufferGeometry {
  const geo = new CylinderGeometry(1, 1.25, 1, 20, 6, true).translate(0, 0.5, 0);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    colors.set([1, 1, 1, (1 - h) * (1 - h) * Math.min(1, h * 8 + 0.3)], i * 4);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 4));
  return geo;
}

/** A shallow V seen from below, 1 m wingspan, forward = -Z. Scaled per instance. */
function birdGeometry(): BufferGeometry {
  // prettier-ignore
  const v = new Float32Array([
    0, 0, -0.15,   -0.5, 0.08, 0.1,   0, 0, 0.12,
    0, 0, -0.15,    0, 0, 0.12,       0.5, 0.08, 0.1,
  ]);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(v, 3));
  geo.computeVertexNormals();
  return geo;
}

export class Thermals {
  readonly group = new Group();
  private readonly moteTiles = new Group();
  private readonly birdTiles = new Group();
  private readonly columnTiles = new Group();
  private readonly tiles = [
    new TileGrid(this.moteTiles, WORLD_TILE),
    new TileGrid(this.birdTiles, WORLD_TILE),
    new TileGrid(this.columnTiles, WORLD_TILE),
  ];
  private readonly moteMaterial = new PointsMaterial({
    map: softDotTexture(),
    size: 2.2,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
  });
  private readonly birdGeometry = birdGeometry();
  private readonly birdMaterial = new MeshBasicMaterial({ color: PALETTE.ink, side: DoubleSide });
  private readonly columnGeometry = columnGeometry();
  private readonly columnMaterial = new MeshBasicMaterial({
    color: PALETTE.bone,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });

  private thermals: Thermal[] = [];
  private motes: Mote[] = [];
  private birds: Bird[] = [];
  private moteGeometry = new BufferGeometry();
  private birdSource: InstancedMesh | null = null;
  private time = 0;

  // Scratch.
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YXZ');
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor() {
    this.group.add(this.columnTiles, this.moteTiles, this.birdTiles);
  }

  /** Rebuilds all thermals. Landmarks each get a thermal beside them. */
  rebuild(landmarks: readonly Landmark[]): void {
    const t = tuning.thermals;
    const rand = seeded(tuning.world.seed, 'thermals');
    const make = (x: number, z: number): Thermal => ({
      x,
      z,
      radius: MathUtils.lerp(t.radiusMin, t.radiusMax, rand()),
      strength: MathUtils.lerp(t.strengthMin, t.strengthMax, rand()),
      top: MathUtils.lerp(t.topMin, t.topMax, rand()),
      spin: rand() < 0.5 ? -1 : 1,
    });

    this.thermals = [];
    // One just ahead of the spawn point (spawn faces -Z) to teach the mechanic early.
    this.thermals.push(make(40, -380));
    for (const l of landmarks) {
      const a = rand() * Math.PI * 2;
      const d = l.radius + t.radiusMax + 40;
      this.thermals.push(make(l.x + Math.cos(a) * d, l.z + Math.sin(a) * d));
    }
    for (let i = 0; i < Math.round(t.perTile); i++) {
      this.thermals.push(make((rand() - 0.5) * WORLD_TILE, (rand() - 0.5) * WORLD_TILE));
    }

    this.motes = [];
    this.birds = [];
    for (const th of this.thermals) {
      for (let i = 0; i < Math.round(t.motesPerThermal); i++) {
        this.motes.push({
          thermal: th,
          angle: rand() * Math.PI * 2,
          radiusFrac: Math.sqrt(rand()),
          phase: rand(),
          rise: th.strength * (0.8 + rand() * 0.6),
        });
      }
      for (let i = 0; i < Math.round(t.birdsPerThermal); i++) {
        this.birds.push({
          thermal: th,
          angle: rand() * Math.PI * 2,
          orbit: th.radius * (0.4 + rand() * 0.5),
          height: th.top * (0.2 + rand() * 0.6),
          speed: 9 + rand() * 4,
          bob: rand() * Math.PI * 2,
        });
      }
    }

    this.buildMeshes();
    this.update(0, new Vector3(NaN, 0, NaN));
  }

  /** Updraft (m/s) at a world position. Smooth core, fading out toward the thermal's top. */
  liftAt(pos: Vector3): number {
    let lift = 0;
    for (const th of this.thermals) {
      const dx = wrapDelta(pos.x, th.x, WORLD_TILE);
      const dz = wrapDelta(pos.z, th.z, WORLD_TILE);
      lift += thermalLift(th, dx * dx + dz * dz, pos.y);
    }
    return lift * tuning.thermals.liftScale;
  }

  update(dt: number, player: Vector3): void {
    this.time += dt;
    if (!Number.isNaN(player.x)) this.tiles.forEach((tile) => tile.update(player));
    this.updateMotes();
    this.updateBirds();
  }

  private buildMeshes(): void {
    this.moteTiles.clear();
    this.birdTiles.clear();
    for (const child of this.columnTiles.children) (child as InstancedMesh).dispose();
    this.columnTiles.clear();
    this.tiles.forEach((tile) => tile.invalidate());
    this.moteGeometry.dispose();
    this.birdSource?.dispose();

    this.moteGeometry = new BufferGeometry();
    this.moteGeometry.setAttribute('position', new BufferAttribute(new Float32Array(this.motes.length * 3), 3));
    this.moteGeometry.setAttribute('color', new BufferAttribute(new Float32Array(this.motes.length * 4), 4));

    const columns = new InstancedMesh(this.columnGeometry, this.columnMaterial, Math.max(this.thermals.length, 1));
    columns.count = this.thermals.length;
    this.thermals.forEach((th, i) => {
      this.p.set(th.x, 0, th.z);
      this.s.set(th.radius * 0.8, th.top, th.radius * 0.8);
      columns.setMatrixAt(i, this.m.compose(this.p, this.q.identity(), this.s));
    });
    columns.computeBoundingSphere();

    const count = this.birds.length;
    this.birdSource = new InstancedMesh(this.birdGeometry, this.birdMaterial, Math.max(count, 1));
    this.birdSource.count = count;
    for (let i = 0; i < 9; i++) {
      const points = new Points(this.moteGeometry, this.moteMaterial);
      points.frustumCulled = false; // animated every frame; bounds would be stale
      this.moteTiles.add(points);

      const birds = i === 0 ? this.birdSource : new InstancedMesh(this.birdGeometry, this.birdMaterial, count);
      birds.instanceMatrix = this.birdSource.instanceMatrix;
      birds.count = count;
      birds.frustumCulled = false;
      this.birdTiles.add(birds);

      const cols = i === 0 ? columns : new InstancedMesh(this.columnGeometry, this.columnMaterial, columns.count);
      cols.instanceMatrix = columns.instanceMatrix;
      cols.boundingSphere = columns.boundingSphere;
      this.columnTiles.add(cols);
    }
  }

  private updateMotes(): void {
    const pos = this.moteGeometry.attributes.position as BufferAttribute;
    const col = this.moteGeometry.attributes.color as BufferAttribute;
    for (let i = 0; i < this.motes.length; i++) {
      const mote = this.motes[i];
      const th = mote.thermal;
      // Rise from the ground to the top, then loop. The column widens as it rises.
      const h01 = (mote.phase + (this.time * mote.rise) / th.top) % 1;
      const r = th.radius * mote.radiusFrac * (0.5 + 0.5 * h01);
      const a = mote.angle + (th.spin * this.time * 6) / Math.max(r, 5);
      pos.setXYZ(i, th.x + Math.cos(a) * r, h01 * th.top, th.z + Math.sin(a) * r);
      // Fade in at the bottom and out at the top so the loop is invisible.
      const alpha = MathUtils.smoothstep(h01, 0, 0.1) * (1 - MathUtils.smoothstep(h01, 0.8, 1));
      col.setXYZW(i, MOTE_COLOR.r, MOTE_COLOR.g, MOTE_COLOR.b, alpha * 0.85);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.moteMaterial.size = tuning.thermals.moteSize;
    this.columnMaterial.opacity = tuning.thermals.columnOpacity;
  }

  private updateBirds(): void {
    if (!this.birdSource) return;
    const scale = tuning.thermals.birdSize;
    this.s.set(scale, scale, scale);
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      const th = b.thermal;
      const angle = b.angle + (th.spin * this.time * b.speed) / b.orbit;
      this.p.set(
        th.x + Math.cos(angle) * b.orbit,
        b.height + Math.sin(this.time * 0.3 + b.bob) * 6,
        th.z + Math.sin(angle) * b.orbit,
      );
      // Face along the circle and bank into it. Same conventions as the creature (-Z forward).
      const yaw = th.spin > 0 ? Math.PI - angle : -angle;
      const bank = 0.35 + Math.sin(this.time * 1.7 + b.bob) * 0.08;
      this.e.set(0, yaw, -th.spin * bank);
      this.birdSource.setMatrixAt(i, this.m.compose(this.p, this.q.setFromEuler(this.e), this.s));
    }
    this.birdSource.instanceMatrix.needsUpdate = true;
  }
}
