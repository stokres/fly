// Star shower event: shooting stars rain down ahead of the bird for a while, each drawing a
// bright streak. Catch as many as you can before they reach the sea or the ground.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { tuning } from '../tuning';

const MAX = 120;

interface Star {
  alive: boolean;
  pos: Vector3;
  vel: Vector3;
  spin: number;
}

export class Starfall {
  readonly group = new Group();
  active = false;
  timeLeft = 0;
  caught = 0;
  spawned = 0;
  private stars: Star[] = [];
  private spawnAcc = 0;
  private readonly mesh: InstancedMesh;
  private readonly streaks: LineSegments;
  /** Positions of the stars caught this frame (for sparks). */
  readonly caughtAt: Vector3[] = [];
  private caughtPool: Vector3[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly e = new Vector3();
  private readonly fwd = new Vector3();
  private readonly d = new Vector3();
  private time = 0;

  constructor() {
    for (let i = 0; i < MAX; i++) this.stars.push({ alive: false, pos: new Vector3(), vel: new Vector3(), spin: 0 });
    for (let i = 0; i < 8; i++) this.caughtPool.push(new Vector3());
    this.mesh = new InstancedMesh(new OctahedronGeometry(1.6, 0), new MeshBasicMaterial({ color: new Color(2.6, 2.8, 3.6) }), MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(MAX * 2 * 3), 3).setUsage(DynamicDrawUsage));
    this.streaks = new LineSegments(
      g,
      new LineBasicMaterial({ color: new Color(1.4, 1.5, 2.2), transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false }),
    );
    this.streaks.frustumCulled = false;
    this.group.add(this.mesh, this.streaks);
  }

  start(): void {
    const c = tuning.challenge;
    this.active = true;
    this.timeLeft = c.starSeconds;
    this.caught = 0;
    this.spawned = 0;
    this.spawnAcc = 0;
  }

  stop(): void {
    this.active = false;
    for (const s of this.stars) s.alive = false;
  }

  get total(): number {
    return Math.min(MAX, tuning.challenge.starCount);
  }

  /** Returns how many stars were caught this frame (their positions in `caughtAt`). */
  update(dt: number, prev: Vector3, pos: Vector3, birdVel: Vector3, ground: (x: number, z: number) => number): number {
    const c = tuning.challenge;
    this.time += dt;
    this.caughtAt.length = 0;
    if (this.active) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.active = false;
      // Spawn across most of the event, ahead of the bird so they fall into its path.
      this.spawnAcc += (this.total / (c.starSeconds * 0.75)) * dt;
      while (this.spawnAcc >= 1 && this.spawned < this.total) {
        this.spawnAcc -= 1;
        this.spawn(pos, birdVel);
      }
    }
    let n = 0;
    const lines = this.streaks.geometry.attributes.position as BufferAttribute;
    for (const s of this.stars) {
      if (!s.alive) continue;
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y < ground(s.pos.x, s.pos.z) + 1) {
        s.alive = false;
        continue;
      }
      // Segment-to-point distance from the bird's path this frame.
      this.d.subVectors(pos, prev);
      const len2 = this.d.lengthSq();
      const t = len2 > 0 ? Math.max(0, Math.min(1, this.e.subVectors(s.pos, prev).dot(this.d) / len2)) : 0;
      this.e.copy(prev).addScaledVector(this.d, t);
      if (this.e.distanceTo(s.pos) < c.starCatchRadius) {
        s.alive = false;
        this.caught++;
        if (this.caughtAt.length < this.caughtPool.length) this.caughtAt.push(this.caughtPool[this.caughtAt.length].copy(s.pos));
        continue;
      }
      s.spin += dt * 4;
      this.q.setFromAxisAngle(this.fwd.set(0, 1, 0), s.spin);
      this.s.setScalar(1 + 0.25 * Math.sin(this.time * 12 + s.spin));
      this.m.compose(s.pos, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      lines.setXYZ(n * 2, s.pos.x, s.pos.y, s.pos.z);
      lines.setXYZ(n * 2 + 1, s.pos.x - s.vel.x * 1.1, s.pos.y - s.vel.y * 1.1, s.pos.z - s.vel.z * 1.1);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.streaks.geometry.setDrawRange(0, n * 2);
    lines.needsUpdate = true;
    return this.caughtAt.length;
  }

  get falling(): number {
    let n = 0;
    for (const s of this.stars) if (s.alive) n++;
    return n;
  }

  private spawn(bird: Vector3, birdVel: Vector3): void {
    const s = this.stars.find((x) => !x.alive);
    if (!s) return;
    this.spawned++;
    this.fwd.set(birdVel.x, 0, birdVel.z);
    if (this.fwd.lengthSq() < 1) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    const ahead = 120 + Math.random() * 320;
    const side = (Math.random() - 0.5) * 360;
    // Fall time to the bird's height ~ the time the bird needs to get there.
    const fall = 14 + Math.random() * 8;
    const tArrive = ahead / Math.max(30, Math.hypot(birdVel.x, birdVel.z));
    s.pos.set(
      bird.x + this.fwd.x * ahead - this.fwd.z * side,
      // A little early, so they cross the view on the way down.
      bird.y + fall * tArrive * (0.45 + Math.random() * 0.4),
      bird.z + this.fwd.z * ahead + this.fwd.x * side,
    );
    s.vel.set((Math.random() - 0.5) * 6, -fall, (Math.random() - 0.5) * 6);
    s.alive = true;
    s.spin = Math.random() * 6;
  }
}
