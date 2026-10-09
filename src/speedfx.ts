// Speed effects: wind lines streaming past the camera at high speed and while boosting or riding
// a current, and spray (over water) or leaves and petals (over land) kicked up while skimming.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  type PerspectiveCamera,
  Vector3,
} from 'three';
import { mulberry32 } from './random';
import { softDotTexture } from './textures';
import { tuning } from './tuning';

const LINES = 140;
const PARTICLES = 600;

export interface SpeedFxInput {
  speed: number;
  boost: number;
  current: number;
  skim: number;
  /** Bird position and velocity. */
  position: Vector3;
  velocity: Vector3;
  /** Height of the surface below, and whether it is water. */
  ground: number;
  water: boolean;
}

export class SpeedFx {
  readonly lines: LineSegments;
  readonly particles: Points;
  private readonly lineData: Float32Array; // per line: x, y, z (camera space), length scale
  private readonly lineMaterial = new LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  private readonly pVel = new Float32Array(PARTICLES * 3);
  private readonly pLife = new Float32Array(PARTICLES);
  private next = 0;
  private spawnAcc = 0;
  private readonly rand = mulberry32(77);
  private readonly fwd = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();

  constructor() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(LINES * 2 * 3), 3).setUsage(DynamicDrawUsage));
    this.lines = new LineSegments(g, this.lineMaterial);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.lineData = new Float32Array(LINES * 4);
    for (let i = 0; i < LINES; i++) this.respawnLine(i, true);

    const pg = new BufferGeometry();
    pg.setAttribute('position', new BufferAttribute(new Float32Array(PARTICLES * 3).fill(-9999), 3).setUsage(DynamicDrawUsage));
    pg.setAttribute('color', new BufferAttribute(new Float32Array(PARTICLES * 4), 4).setUsage(DynamicDrawUsage));
    this.particles = new Points(
      pg,
      new PointsMaterial({ size: 0.7, map: softDotTexture, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }),
    );
    this.particles.frustumCulled = false;
  }

  private respawnLine(i: number, anywhere: boolean): void {
    // A ring around the view axis, ahead of the camera; lines drift toward it.
    const a = this.rand() * Math.PI * 2;
    const r = 3 + this.rand() * 9;
    this.lineData[i * 4] = Math.cos(a) * r;
    this.lineData[i * 4 + 1] = Math.sin(a) * r * 0.7;
    this.lineData[i * 4 + 2] = anywhere ? -this.rand() * 60 : -60 - this.rand() * 20;
    this.lineData[i * 4 + 3] = 0.6 + this.rand() * 0.8;
  }

  update(dt: number, camera: PerspectiveCamera, s: SpeedFxInput): void {
    const fx = tuning.fx;
    // Speed lines: fade in with speed, boost and currents.
    const intensity = Math.min(1, Math.max(0, (s.speed - fx.linesSpeed) / 40) * 0.7 + s.boost * 0.6 + s.current * 0.8) * fx.lines;
    this.lineMaterial.opacity = intensity * 0.22;
    this.lines.visible = intensity > 0.01;
    if (this.lines.visible) {
      camera.getWorldDirection(this.fwd);
      this.right.setFromMatrixColumn(camera.matrixWorld, 0);
      this.up.setFromMatrixColumn(camera.matrixWorld, 1);
      const pos = this.lines.geometry.attributes.position as BufferAttribute;
      const move = s.speed * 1.6 * dt;
      for (let i = 0; i < LINES; i++) {
        const d = this.lineData;
        d[i * 4 + 2] += move;
        if (d[i * 4 + 2] > 2) this.respawnLine(i, false);
        const len = s.speed * 0.09 * d[i * 4 + 3];
        for (let e = 0; e < 2; e++) {
          const z = d[i * 4 + 2] - e * len;
          const x = camera.position.x + this.right.x * d[i * 4] + this.up.x * d[i * 4 + 1] - this.fwd.x * z;
          const y = camera.position.y + this.right.y * d[i * 4] + this.up.y * d[i * 4 + 1] - this.fwd.y * z;
          const zz = camera.position.z + this.right.z * d[i * 4] + this.up.z * d[i * 4 + 1] - this.fwd.z * z;
          pos.setXYZ(i * 2 + e, x, y, zz);
        }
      }
      pos.needsUpdate = true;
    }

    // Spray / leaves while skimming.
    const pos = this.particles.geometry.attributes.position as BufferAttribute;
    const col = this.particles.geometry.attributes.color as BufferAttribute;
    const rate = s.skim * Math.min(1, s.speed / 30) * 260 * fx.spray;
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      const i = this.next;
      this.next = (this.next + 1) % PARTICLES;
      const side = this.rand() < 0.5 ? -1 : 1;
      const vx = s.velocity.x;
      const vz = s.velocity.z;
      const h = Math.hypot(vx, vz) || 1;
      // Out sideways from under the bird, up and a little back.
      const lx = -vz / h;
      const lz = vx / h;
      pos.setXYZ(i, s.position.x + (this.rand() - 0.5) * 2, s.ground + 0.3, s.position.z + (this.rand() - 0.5) * 2);
      const out = 3 + this.rand() * 6;
      this.pVel[i * 3] = lx * side * out + vx * 0.25;
      this.pVel[i * 3 + 1] = (s.water ? 5 : 3) + this.rand() * 5;
      this.pVel[i * 3 + 2] = lz * side * out + vz * 0.25;
      this.pLife[i] = 1;
      const r = this.rand();
      if (s.water) col.setXYZW(i, 0.95, 0.98, 1.0, 1);
      else if (r < 0.15) col.setXYZW(i, 1.0, 0.95, 0.95, 1);
      else if (r < 0.3) col.setXYZW(i, 1.0, 0.85, 0.35, 1);
      else col.setXYZW(i, 0.45 + r * 0.2, 0.75, 0.3, 1);
    }
    for (let i = 0; i < PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt * 1.1;
      this.pVel[i * 3 + 1] -= 9.8 * dt;
      pos.setXYZ(i, pos.getX(i) + this.pVel[i * 3] * dt, pos.getY(i) + this.pVel[i * 3 + 1] * dt, pos.getZ(i) + this.pVel[i * 3 + 2] * dt);
      col.setW(i, Math.max(0, this.pLife[i]));
      if (this.pLife[i] <= 0) pos.setY(i, -9999);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}
