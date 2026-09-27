// Thermals: invisible rising columns of air. Circle inside one to gain height without flapping.
// They are marked without UI: a faint shimmering column, motes drifting upward in a slow spiral,
// and birds circling inside. Key ones are placed in map.ts; more are scattered over land (sun-heated
// ground). None rise from open water.
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
import type { Heightfield } from './heightfield';
import { THERMALS, WORLD_HALF_SIZE } from './map';
import { PALETTE } from './palette';
import { seeded } from './random';
import { tuning } from './tuning';

const MOTE_COLOR = new Color(PALETTE.bone);
const COLUMN_COLOR = new Color(PALETTE.bone);

export interface Thermal {
  x: number;
  z: number;
  /** Ground height at the center; the column rises from here. */
  base: number;
  radius: number;
  /** Peak updraft at the core, m/s. */
  strength: number;
  /** Altitude where the lift has faded to zero. */
  top: number;
  /** +1 or -1: which way the motes and birds circle. */
  spin: number;
}

/** Updraft of one thermal at squared horizontal distance `dist2` and height `y`. */
export function thermalLift(th: Thermal, dist2: number, y: number): number {
  const d2 = dist2 / (th.radius * th.radius);
  if (d2 >= 1) return 0;
  const core = 1 - d2 * d2; // broad core, soft edge
  const fade = 1 - MathUtils.smoothstep(y, th.base + (th.top - th.base) * 0.75, th.top);
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
  private motePoints: Points | null = null;
  private birdMesh: InstancedMesh | null = null;
  private columnMesh: InstancedMesh | null = null;
  private time = 0;

  // Scratch.
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YXZ');
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  /** Rebuilds all thermals on the given terrain. */
  rebuild(heightfield: Heightfield): void {
    const t = tuning.thermals;
    const rand = seeded(tuning.world.seed, 'thermals');
    const make = (x: number, z: number): Thermal => {
      const base = Math.max(0, heightfield.surface(x, z));
      return {
        x,
        z,
        base,
        radius: MathUtils.lerp(t.radiusMin, t.radiusMax, rand()),
        strength: MathUtils.lerp(t.strengthMin, t.strengthMax, rand()),
        top: base + MathUtils.lerp(t.topMin, t.topMax, rand()),
        spin: rand() < 0.5 ? -1 : 1,
      };
    };

    this.thermals = THERMALS.map((p) => make(p.x, p.z));
    // Scatter the rest over land, away from each other.
    const extra = Math.round(t.extraCount);
    for (let tries = 0, added = 0; added < extra && tries < extra * 200; tries++) {
      const x = (rand() * 2 - 1) * WORLD_HALF_SIZE;
      const z = (rand() * 2 - 1) * WORLD_HALF_SIZE;
      if (heightfield.surface(x, z) < 15) continue;
      if (this.thermals.some((th) => Math.hypot(th.x - x, th.z - z) < 600)) continue;
      this.thermals.push(make(x, z));
      added++;
    }

    this.motes = [];
    this.birds = [];
    for (const th of this.thermals) {
      const height = th.top - th.base;
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
          height: th.base + height * (0.2 + rand() * 0.6),
          speed: 9 + rand() * 4,
          bob: rand() * Math.PI * 2,
        });
      }
    }

    this.buildMeshes();
    this.update(0);
  }

  /** Updraft (m/s) at a world position. */
  liftAt(pos: Vector3): number {
    let lift = 0;
    for (const th of this.thermals) {
      const dx = pos.x - th.x;
      const dz = pos.z - th.z;
      lift += thermalLift(th, dx * dx + dz * dz, pos.y);
    }
    return lift * tuning.thermals.liftScale;
  }

  /** Tints the unlit markers (motes, columns) by the ambient light, so they don't glow at night. */
  setLight(color: Color): void {
    this.moteMaterial.color.copy(color);
    this.columnMaterial.color.copy(color).multiply(COLUMN_COLOR);
  }

  update(dt: number): void {
    this.time += dt;
    this.updateMotes();
    this.updateBirds();
  }

  private buildMeshes(): void {
    for (const obj of [this.motePoints, this.birdMesh, this.columnMesh]) {
      if (!obj) continue;
      this.group.remove(obj);
      if (obj instanceof Points) obj.geometry.dispose();
      else obj.dispose();
    }

    const moteGeometry = new BufferGeometry();
    moteGeometry.setAttribute('position', new BufferAttribute(new Float32Array(this.motes.length * 3), 3));
    moteGeometry.setAttribute('color', new BufferAttribute(new Float32Array(this.motes.length * 4), 4));
    this.motePoints = new Points(moteGeometry, this.moteMaterial);
    this.motePoints.frustumCulled = false; // animated every frame; bounds would be stale

    this.columnMesh = new InstancedMesh(this.columnGeometry, this.columnMaterial, Math.max(this.thermals.length, 1));
    this.columnMesh.count = this.thermals.length;
    this.thermals.forEach((th, i) => {
      this.p.set(th.x, th.base, th.z);
      this.s.set(th.radius * 0.8, th.top - th.base, th.radius * 0.8);
      this.columnMesh!.setMatrixAt(i, this.m.compose(this.p, this.q.identity(), this.s));
    });
    this.columnMesh.computeBoundingSphere();

    this.birdMesh = new InstancedMesh(this.birdGeometry, this.birdMaterial, Math.max(this.birds.length, 1));
    this.birdMesh.count = this.birds.length;
    this.birdMesh.frustumCulled = false;

    this.group.add(this.columnMesh, this.motePoints, this.birdMesh);
  }

  private updateMotes(): void {
    if (!this.motePoints) return;
    const pos = this.motePoints.geometry.attributes.position as BufferAttribute;
    const col = this.motePoints.geometry.attributes.color as BufferAttribute;
    for (let i = 0; i < this.motes.length; i++) {
      const mote = this.motes[i];
      const th = mote.thermal;
      const height = th.top - th.base;
      // Rise from the ground to the top, then loop. The column widens as it rises.
      const h01 = (mote.phase + (this.time * mote.rise) / height) % 1;
      const r = th.radius * mote.radiusFrac * (0.5 + 0.5 * h01);
      const a = mote.angle + (th.spin * this.time * 6) / Math.max(r, 5);
      pos.setXYZ(i, th.x + Math.cos(a) * r, th.base + h01 * height, th.z + Math.sin(a) * r);
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
    if (!this.birdMesh) return;
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
      this.birdMesh.setMatrixAt(i, this.m.compose(this.p, this.q.setFromEuler(this.e), this.s));
    }
    this.birdMesh.instanceMatrix.needsUpdate = true;
  }
}
