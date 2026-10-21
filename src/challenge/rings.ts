// Ring rush event: a chain of golden rings appears ahead, curving over the land and sea. Fly
// through each before its timer runs out; every ring passed buys time for the next. The next
// ring burns bright and pulses, the ones after it glow faintly so the line can be read ahead.
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three';
import { WORLD_HALF_SIZE } from '../map';
import { tuning } from '../tuning';

const MAX = 20;
const DEG = Math.PI / 180;
const Z = new Vector3(0, 0, 1);
const NEXT = new Color(3.2, 2.1, 0.6);
const LATER = new Color(0.55, 0.38, 0.12);
const URGENT = new Color(3.5, 0.9, 0.3);

export type RingResult = 'pass' | 'done' | 'fail' | null;

export class Rings {
  readonly group = new Group();
  active = false;
  /** Index of the ring to fly through next. */
  next = 0;
  count = 0;
  /** Seconds left to reach the next ring, and the full time it was given. */
  timeLeft = 0;
  timeGiven = 1;
  readonly centers: Vector3[] = [];
  private readonly normals: Vector3[] = [];
  private readonly mesh: InstancedMesh;
  private readonly veil: Mesh;
  private time = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly d = new Vector3();
  private readonly hit = new Vector3();

  constructor() {
    for (let i = 0; i < MAX; i++) {
      this.centers.push(new Vector3());
      this.normals.push(new Vector3());
    }
    this.mesh = new InstancedMesh(new TorusGeometry(1, 0.08, 10, 56), new MeshBasicMaterial({ color: 0xffffff }), MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < MAX; i++) this.mesh.setColorAt(i, LATER);
    // A faint shimmering membrane in the next ring, so it reads as a gate to fly through.
    this.veil = new Mesh(
      new CircleGeometry(1, 48),
      new MeshBasicMaterial({ color: new Color(1.0, 0.7, 0.25), transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
    );
    this.veil.frustumCulled = false;
    this.veil.visible = false;
    this.group.add(this.mesh, this.veil);
  }

  /** Lays out a new chain starting ahead of the bird. */
  start(bird: Vector3, forward: Vector3, ground: (x: number, z: number) => number): void {
    const c = tuning.challenge;
    this.count = Math.min(MAX, c.ringCount);
    let yaw = Math.atan2(-forward.x, -forward.z);
    let pitch = 0;
    const p = this.s.copy(bird);
    for (let i = 0; i < this.count; i++) {
      const step = i === 0 ? c.ringSpacing * 1.2 : c.ringSpacing * (0.8 + Math.random() * 0.4);
      if (i > 0) {
        // Of a few random turns, take the one needing the least climb: no ring over a mountain.
        let best = Infinity;
        let bestYaw = yaw;
        for (let k = 0; k < 5; k++) {
          const y = yaw + (Math.random() - 0.5) * 80 * DEG;
          const x1 = p.x - Math.sin(y) * step;
          const z1 = p.z - Math.cos(y) * step;
          const cost = Math.max(0, ground(x1, z1) + 28 - p.y) + Math.random() * 10;
          if (cost < best) {
            best = cost;
            bestYaw = y;
          }
        }
        yaw = bestYaw;
        pitch = (Math.random() - 0.5) * 22 * DEG;
      }
      // Near the edge of the archipelago, curve back toward the islands.
      if (Math.abs(p.x) > WORLD_HALF_SIZE * 0.85 || Math.abs(p.z) > WORLD_HALF_SIZE * 0.85) {
        const home = Math.atan2(p.x, p.z);
        let dy = home - yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        yaw += dy * 0.6;
      }
      this.d.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      p.addScaledVector(this.d, step);
      // Keep well clear of the ground (and look ahead a little: no ring hidden behind a ridge).
      const floor = Math.max(ground(p.x, p.z), ground(p.x + this.d.x * 60, p.z + this.d.z * 60)) + 28;
      p.y = Math.min(420, Math.max(floor, p.y));
      this.centers[i].copy(p);
    }
    for (let i = 0; i < this.count; i++) {
      const from = i === 0 ? bird : this.centers[i - 1];
      this.normals[i].subVectors(this.centers[i], from).normalize();
    }
    this.next = 0;
    this.active = true;
    this.timeGiven = this.timeLeft = bird.distanceTo(this.centers[0]) * c.ringSecondsPerMeter + 3;
    this.mesh.count = this.count;
    this.veil.visible = true;
    this.refresh();
  }

  stop(): void {
    this.active = false;
    this.mesh.count = 0;
    this.veil.visible = false;
  }

  get nextCenter(): Vector3 | null {
    return this.active ? this.centers[this.next] : null;
  }

  update(dt: number, prev: Vector3, pos: Vector3): RingResult {
    if (!this.active) return null;
    const c = tuning.challenge;
    this.time += dt;
    this.timeLeft -= dt;
    let result: RingResult = null;
    const center = this.centers[this.next];
    const n = this.normals[this.next];
    // Crossing the ring's plane this frame, inside the ring (with a little mercy)?
    const s0 = this.d.subVectors(prev, center).dot(n);
    const s1 = this.hit.subVectors(pos, center).dot(n);
    let through = false;
    if (s0 <= 0 && s1 > 0) {
      const f = s0 / (s0 - s1);
      this.hit.lerpVectors(prev, pos, f);
      through = this.hit.distanceTo(center) < c.ringRadius * 1.15;
    }
    if (through || pos.distanceTo(center) < c.ringRadius * 0.6) {
      this.next++;
      if (this.next >= this.count) {
        this.stop();
        return 'done';
      }
      const climb = Math.max(0, this.centers[this.next].y - center.y);
      this.timeGiven = this.timeLeft = (center.distanceTo(this.centers[this.next]) + climb * 1.5) * c.ringSecondsPerMeter + c.ringBonusSeconds;
      result = 'pass';
    } else if (this.timeLeft <= 0) {
      this.stop();
      return 'fail';
    }
    this.refresh();
    return result;
  }

  private refresh(): void {
    const r = tuning.challenge.ringRadius;
    for (let i = 0; i < this.count; i++) {
      const passed = i < this.next;
      const isNext = i === this.next;
      const pulse = isNext ? 1 + 0.08 * Math.sin(this.time * 9) : 1;
      this.q.setFromUnitVectors(Z, this.normals[i]);
      this.s.setScalar(passed ? 0 : r * pulse * (isNext ? 1 : 0.92));
      this.m.compose(this.centers[i], this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      // Hurry: the next ring flickers red-gold as time runs out.
      const urgent = isNext && this.timeLeft < 2.5 && Math.sin(this.time * 18) > 0;
      this.mesh.setColorAt(i, isNext ? (urgent ? URGENT : NEXT) : LATER);
      if (isNext) {
        this.veil.position.copy(this.centers[i]);
        this.veil.quaternion.copy(this.q);
        this.veil.scale.setScalar(r * 0.95);
        (this.veil.material as MeshBasicMaterial).opacity = 0.08 + 0.06 * Math.sin(this.time * 5);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
