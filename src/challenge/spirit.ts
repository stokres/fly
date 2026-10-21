// Golden spirit event: a small creature of light appears ahead and flees. It drifts lazily when
// far away, then bolts and jinks when the bird closes in; it tires as the chase goes on. Catch
// it before it escapes. Diving and boosting are the way to close the gap.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { WORLD_HALF_SIZE } from '../map';
import { softDotTexture } from '../textures';
import { tuning } from '../tuning';

const TRAIL = 500;
const FORWARD = new Vector3(0, 0, -1);

export type SpiritResult = 'caught' | 'escaped' | null;

export class Spirit {
  readonly group = new Group();
  active = false;
  timeLeft = 0;
  readonly pos = new Vector3();
  private readonly dir = new Vector3(0, 0, -1);
  private readonly jink = new Vector3();
  private speed = 0;
  private jinkTimer = 0;
  private age = 0;
  private readonly body = new Group();
  private readonly halo: Mesh;
  private readonly wings: Mesh[] = [];
  private readonly trail: Points;
  private readonly trailVel = new Float32Array(TRAIL * 3);
  private readonly trailLife = new Float32Array(TRAIL);
  private trailNext = 0;
  private readonly v = new Vector3();
  private readonly q = new Quaternion();

  constructor() {
    const core = new Mesh(new IcosahedronGeometry(1.3, 2), new MeshBasicMaterial({ color: new Color(4, 3.2, 1.6) }));
    this.halo = new Mesh(
      new IcosahedronGeometry(4, 2),
      new MeshBasicMaterial({ color: new Color(1, 0.75, 0.3), transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false }),
    );
    const wingGeo = new PlaneGeometry(4.5, 1.6).translate(2.25, 0, 0.4);
    for (let i = 0; i < 2; i++) {
      const wing = new Mesh(
        wingGeo,
        new MeshBasicMaterial({ color: new Color(2.4, 1.7, 0.6), transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
      );
      if (i === 1) wing.scale.x = -1;
      this.wings.push(wing);
      this.body.add(wing);
    }
    this.body.add(core, this.halo);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(TRAIL * 3).fill(-9999), 3).setUsage(DynamicDrawUsage));
    g.setAttribute('color', new BufferAttribute(new Float32Array(TRAIL * 4), 4).setUsage(DynamicDrawUsage));
    this.trail = new Points(
      g,
      new PointsMaterial({ size: 1.4, map: softDotTexture, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    );
    this.trail.frustumCulled = false;
    this.body.visible = false;
    this.group.add(this.body, this.trail);
  }

  start(bird: Vector3, forward: Vector3, ground: (x: number, z: number) => number): void {
    const c = tuning.challenge;
    this.v.set(forward.x, 0, forward.z).normalize();
    this.pos.copy(bird).addScaledVector(this.v, 260);
    this.pos.x += (Math.random() - 0.5) * 120;
    this.pos.y = Math.max(ground(this.pos.x, this.pos.z) + 40, bird.y + 30);
    this.dir.copy(this.v);
    this.speed = c.spiritSpeed;
    this.timeLeft = c.spiritSeconds;
    this.active = true;
    this.age = 0;
    this.body.visible = true;
  }

  stop(): void {
    this.active = false;
    this.body.visible = false;
  }

  update(dt: number, bird: Vector3, ground: (x: number, z: number) => number): SpiritResult {
    this.updateTrail(dt);
    if (!this.active) return null;
    const c = tuning.challenge;
    this.age += dt;
    this.timeLeft -= dt;
    const dist = this.pos.distanceTo(bird);
    if (dist < c.spiritCatchRadius) {
      this.stop();
      return 'caught';
    }
    if (this.timeLeft <= 0) {
      this.stop();
      return 'escaped';
    }

    // Away from the bird, plus a jink that changes every second or so.
    this.jinkTimer -= dt;
    if (this.jinkTimer <= 0) {
      this.jinkTimer = 0.7 + Math.random() * 0.9;
      this.jink.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).normalize();
    }
    const fleeing = dist < 170;
    const taunting = dist > 280; // too far: drift back, so the chase never gets lost
    this.v.subVectors(this.pos, bird).normalize();
    if (taunting) this.v.negate();
    else if (!fleeing) this.v.multiplyScalar(0.4).add(this.dir); // wander on, loosely away
    this.v.addScaledVector(this.jink, fleeing ? 0.9 : 0.5);
    const floor = ground(this.pos.x, this.pos.z);
    if (this.pos.y < floor + 25) this.v.y = Math.max(this.v.y, 0.6);
    if (this.pos.y > 380) this.v.y = Math.min(this.v.y, -0.3);
    if (Math.abs(this.pos.x) > WORLD_HALF_SIZE * 0.9 || Math.abs(this.pos.z) > WORLD_HALF_SIZE * 0.9) this.v.addScaledVector(this.pos, -0.002);
    this.v.normalize();
    this.dir.lerp(this.v, 1 - Math.exp(-2.6 * dt)).normalize();
    // It tires: the flee speed sinks over the chase.
    const tired = 1 - 0.3 * Math.min(1, this.age / c.spiritSeconds);
    const target = fleeing ? c.spiritFleeSpeed * tired : taunting ? c.spiritSpeed * 0.6 : c.spiritSpeed;
    this.speed += (target - this.speed) * (1 - Math.exp(-2 * dt));
    this.pos.addScaledVector(this.dir, this.speed * dt);
    this.pos.y = Math.max(this.pos.y, floor + 8);

    // Visuals: wings beat fast, halo breathes, sparks trail behind.
    this.body.position.copy(this.pos);
    this.q.setFromUnitVectors(FORWARD, this.dir);
    this.body.quaternion.copy(this.q);
    const beat = Math.sin(this.age * 22) * 0.7;
    this.wings[0].rotation.z = beat;
    this.wings[1].rotation.z = -beat;
    this.halo.scale.setScalar(1 + 0.15 * Math.sin(this.age * 6));
    for (let i = 0; i < 3; i++) this.sparkle();
    return null;
  }

  private sparkle(): void {
    const pos = this.trail.geometry.attributes.position as BufferAttribute;
    const col = this.trail.geometry.attributes.color as BufferAttribute;
    const i = this.trailNext;
    this.trailNext = (this.trailNext + 1) % TRAIL;
    pos.setXYZ(i, this.pos.x + (Math.random() - 0.5) * 2, this.pos.y + (Math.random() - 0.5) * 2, this.pos.z + (Math.random() - 0.5) * 2);
    this.trailVel[i * 3] = (Math.random() - 0.5) * 3;
    this.trailVel[i * 3 + 1] = (Math.random() - 0.5) * 3 - 1;
    this.trailVel[i * 3 + 2] = (Math.random() - 0.5) * 3;
    this.trailLife[i] = 1;
    col.setXYZW(i, 1.5, 1.1 + Math.random() * 0.3, 0.45, 1);
  }

  private updateTrail(dt: number): void {
    const pos = this.trail.geometry.attributes.position as BufferAttribute;
    const col = this.trail.geometry.attributes.color as BufferAttribute;
    for (let i = 0; i < TRAIL; i++) {
      if (this.trailLife[i] <= 0) continue;
      this.trailLife[i] -= dt * 0.8;
      pos.setXYZ(i, pos.getX(i) + this.trailVel[i * 3] * dt, pos.getY(i) + this.trailVel[i * 3 + 1] * dt, pos.getZ(i) + this.trailVel[i * 3 + 2] * dt);
      col.setW(i, Math.max(0, this.trailLife[i]));
      if (this.trailLife[i] <= 0) pos.setY(i, -9999);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}
