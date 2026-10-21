// Storm event: the sky darkens, rain streams past, and lightning hunts the bird. Every strike is
// telegraphed: a crackling violet column marks where it will land (aimed where the bird is
// heading), then the bolt falls. Fly out of the column in time. The darkening is applied to the
// atmosphere state, so sky, clouds, water and fog all follow.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  RingGeometry,
  Vector3,
} from 'three';
import type { AtmosphereState } from '../atmosphere';
import { fogUniforms } from '../fog';
import { tuning } from '../tuning';

const STRIKES = 4;
const RAIN = 900;
const RAIN_BOX = 70;
const BOLT_SEGMENTS = 28;
const BRANCH_SEGMENTS = 6;
const BOLT_QUADS = BOLT_SEGMENTS + 2 * BRANCH_SEGMENTS;
const COLUMN_HEIGHT = 900;

const STORM_ZENITH = new Color(0.07, 0.08, 0.12);
const STORM_HORIZON = new Color(0.2, 0.22, 0.28);
const STORM_LIGHT = new Color(0.6, 0.65, 0.82);
const STORM_AMBIENT = new Color(0.32, 0.36, 0.48);
const FLASH = new Color(0.85, 0.88, 1.0);

interface Strike {
  active: boolean;
  pos: Vector3;
  /** Seconds left of the warning, then of the bolt. */
  warn: number;
  bolt: number;
  column: Mesh;
  ring: Mesh;
  boltMesh: Mesh;
}

export interface StrikeEvent {
  pos: Vector3;
  /** Horizontal distance from the bird when it landed. */
  distance: number;
}

export class Storm {
  readonly group = new Group();
  /** 0..1 how stormy it is (eases in and out). */
  level = 0;
  /** 0..1 lightning flash, decays fast. */
  flash = 0;
  active = false;
  timeLeft = 0;
  /** Called when a strike is armed (for its warning sound). */
  onArm: () => void = () => {};
  private strikes: Strike[] = [];
  private nextStrike = 0;
  private readonly rain: LineSegments;
  private readonly rainPos = new Float32Array(RAIN * 3);
  private readonly rainMaterial = new LineBasicMaterial({ color: new Color(0.7, 0.75, 0.88), transparent: true, opacity: 0, depthWrite: false, fog: false });
  private readonly events: StrikeEvent[] = [];
  private readonly eventPool: StrikeEvent[] = [];
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly side = new Vector3();
  private readonly toCam = new Vector3();
  private readonly path: Vector3[] = [];
  private readonly tmp = new Color();
  private time = 0;

  constructor() {
    const columnGeo = new CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
    const ringGeo = new RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
    for (let i = 0; i < STRIKES; i++) {
      const column = new Mesh(
        columnGeo,
        new MeshBasicMaterial({ color: new Color(0.9, 0.55, 1.6), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }),
      );
      const ring = new Mesh(
        ringGeo,
        new MeshBasicMaterial({ color: new Color(1.6, 0.9, 2.4), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }),
      );
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(BOLT_QUADS * 6 * 3), 3).setUsage(DynamicDrawUsage));
      const boltMesh = new Mesh(
        g,
        new MeshBasicMaterial({ color: new Color(6, 6, 9), transparent: true, opacity: 1, side: DoubleSide, depthWrite: false, fog: false }),
      );
      column.visible = ring.visible = boltMesh.visible = false;
      column.frustumCulled = ring.frustumCulled = boltMesh.frustumCulled = false;
      column.renderOrder = ring.renderOrder = 6;
      boltMesh.renderOrder = 7;
      this.group.add(column, ring, boltMesh);
      this.strikes.push({ active: false, pos: new Vector3(), warn: 0, bolt: 0, column, ring, boltMesh });
      this.eventPool.push({ pos: new Vector3(), distance: 0 });
    }
    for (let i = 0; i <= BOLT_SEGMENTS; i++) this.path.push(new Vector3());

    const rg = new BufferGeometry();
    rg.setAttribute('position', new BufferAttribute(new Float32Array(RAIN * 2 * 3), 3).setUsage(DynamicDrawUsage));
    this.rain = new LineSegments(rg, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    for (let i = 0; i < RAIN; i++) {
      this.rainPos[i * 3] = (Math.random() - 0.5) * 2 * RAIN_BOX;
      this.rainPos[i * 3 + 1] = (Math.random() - 0.5) * 2 * RAIN_BOX;
      this.rainPos[i * 3 + 2] = (Math.random() - 0.5) * 2 * RAIN_BOX;
    }
    this.group.add(this.rain);
  }

  start(seconds: number): void {
    this.active = true;
    this.timeLeft = seconds;
    this.nextStrike = 3.5; // let the sky darken first
  }

  /** Ends the storm (the sky clears over a few seconds). */
  stop(immediate = false): void {
    this.active = false;
    for (const s of this.strikes) {
      s.active = false;
      s.column.visible = s.ring.visible = s.boltMesh.visible = false;
    }
    if (immediate) {
      this.level = 0;
      this.flash = 0;
      this.rain.visible = false;
    }
  }

  update(
    dt: number,
    camera: PerspectiveCamera,
    bird: Vector3,
    birdVel: Vector3,
    danger: number,
    ground: (x: number, z: number) => number,
  ): StrikeEvent[] {
    const c = tuning.challenge;
    this.events.length = 0;
    this.time += dt;
    this.level += ((this.active ? 1 : 0) - this.level) * (1 - Math.exp(-(this.active ? 0.6 : 0.35) * dt));
    if (!this.active && this.level < 0.002) this.level = 0;
    this.flash *= Math.exp(-7 * dt);

    if (this.active) {
      this.timeLeft -= dt;
      this.nextStrike -= dt;
      if (this.nextStrike <= 0 && this.timeLeft > c.strikeWarnSeconds) {
        // More often as danger rises; sometimes a pair.
        const every = c.strikeEverySeconds / (1 + (danger - 1) * 0.12);
        this.nextStrike = every * (0.6 + Math.random() * 0.8);
        this.arm(bird, birdVel, ground, 0);
        if (Math.random() < 0.15 + danger * 0.05) this.arm(bird, birdVel, ground, 1);
      }
    }

    for (const s of this.strikes) {
      if (!s.active) continue;
      if (s.warn > 0) {
        s.warn -= dt;
        const k = 1 - Math.max(0, s.warn) / c.strikeWarnSeconds;
        const crackle = 0.6 + 0.4 * Math.sin(this.time * 47 + s.pos.x) * Math.sin(this.time * 31);
        (s.column.material as MeshBasicMaterial).opacity = (0.06 + 0.22 * k * k) * crackle;
        (s.ring.material as MeshBasicMaterial).opacity = 0.25 + 0.6 * k;
        s.ring.scale.setScalar(c.strikeRadius * (1.6 - 0.6 * k));
        if (s.warn <= 0) {
          // Strike!
          s.bolt = 0.35;
          s.column.visible = false;
          this.buildBolt(s, camera);
          s.boltMesh.visible = true;
          this.flash = 1;
          const e = this.eventPool[this.events.length];
          e.pos.copy(s.pos);
          e.distance = Math.hypot(bird.x - s.pos.x, bird.z - s.pos.z);
          this.events.push(e);
        }
      } else {
        s.bolt -= dt;
        const m = s.boltMesh.material as MeshBasicMaterial;
        m.opacity = Math.max(0, s.bolt / 0.35) * (Math.sin(this.time * 90) > -0.3 ? 1 : 0.3);
        (s.ring.material as MeshBasicMaterial).opacity = Math.max(0, s.bolt / 0.35);
        if (s.bolt <= 0) {
          s.active = false;
          s.boltMesh.visible = s.ring.visible = false;
        }
      }
    }

    this.updateRain(dt, camera, birdVel);
    return this.events;
  }

  /** Arms a strike where the bird will be in a moment. */
  private arm(bird: Vector3, birdVel: Vector3, ground: (x: number, z: number) => number, offset: number): void {
    const c = tuning.challenge;
    const s = this.strikes.find((x) => !x.active);
    if (!s) return;
    // Exactly where the bird will be if it holds its course: so hold it and get hit.
    const lead = c.strikeWarnSeconds + c.strikeLead;
    const scatter = offset ? 40 + Math.random() * 30 : Math.random() * 18;
    const a = Math.random() * Math.PI * 2;
    s.pos.set(bird.x + birdVel.x * lead + Math.cos(a) * scatter, 0, bird.z + birdVel.z * lead + Math.sin(a) * scatter);
    s.pos.y = Math.max(0, ground(s.pos.x, s.pos.z));
    s.active = true;
    s.warn = c.strikeWarnSeconds;
    s.bolt = 0;
    s.column.position.copy(s.pos);
    s.column.scale.set(c.strikeRadius, COLUMN_HEIGHT, c.strikeRadius);
    s.column.visible = true;
    s.ring.position.copy(s.pos).y += 0.6;
    s.ring.visible = true;
    this.onArm();
  }

  /** Jagged ribbon from the clouds to the ground, facing the camera. */
  private buildBolt(s: Strike, camera: PerspectiveCamera): void {
    const pos = s.boltMesh.geometry.attributes.position as BufferAttribute;
    const top = s.pos.y + 700;
    let v = 0;
    const quad = (a: Vector3, b: Vector3, width: number) => {
      this.toCam.subVectors(camera.position, a);
      this.side.subVectors(b, a).cross(this.toCam).normalize().multiplyScalar(width / 2);
      const p = [
        [a, -1],
        [b, -1],
        [b, 1],
        [a, -1],
        [b, 1],
        [a, 1],
      ] as const;
      for (const [pt, sgn] of p) pos.setXYZ(v++, pt.x + this.side.x * sgn, pt.y + this.side.y * sgn, pt.z + this.side.z * sgn);
    };
    // A random walk, pinned to the target at the bottom: zigzags, not noise.
    let ox = 0;
    let oz = 0;
    for (let i = 0; i <= BOLT_SEGMENTS; i++) {
      const f = i / BOLT_SEGMENTS;
      ox = Math.max(-60, Math.min(60, ox + (Math.random() - 0.5) * 34));
      oz = Math.max(-60, Math.min(60, oz + (Math.random() - 0.5) * 34));
      this.path[i].set(s.pos.x + ox * (1 - f), top + (s.pos.y - top) * f, s.pos.z + oz * (1 - f));
    }
    for (let i = 0; i < BOLT_SEGMENTS; i++) quad(this.path[i], this.path[i + 1], 2.6 - (i / BOLT_SEGMENTS) * 1.0);
    // Two branches forking off the upper half.
    for (let b = 0; b < 2; b++) {
      this.a.copy(this.path[4 + b * 7]);
      const dx = (Math.random() - 0.5) * 2;
      const dz = (Math.random() - 0.5) * 2;
      for (let i = 0; i < BRANCH_SEGMENTS; i++) {
        this.b.set(this.a.x + dx * 18 + (Math.random() - 0.5) * 12, this.a.y - 28 - Math.random() * 14, this.a.z + dz * 18 + (Math.random() - 0.5) * 12);
        quad(this.a, this.b, 1.4 * (1 - i / BRANCH_SEGMENTS));
        this.a.copy(this.b);
      }
    }
    pos.needsUpdate = true;
  }

  private updateRain(dt: number, camera: PerspectiveCamera, birdVel: Vector3): void {
    this.rain.visible = this.level > 0.02;
    if (!this.rain.visible) return;
    this.rainMaterial.opacity = 0.32 * this.level;
    const out = this.rain.geometry.attributes.position as BufferAttribute;
    const cam = camera.position;
    const fall = 38;
    // Streaks run along the drops' motion relative to the bird, so speed reads in the rain too.
    const k = 0.045;
    const sx = (birdVel.x - 3) * k;
    const sy = (birdVel.y + fall) * k;
    const sz = birdVel.z * k;
    const wrap = (x: number) => ((((x + RAIN_BOX) % (2 * RAIN_BOX)) + 2 * RAIN_BOX) % (2 * RAIN_BOX)) - RAIN_BOX;
    for (let i = 0; i < RAIN; i++) {
      this.rainPos[i * 3 + 1] -= fall * dt;
      this.rainPos[i * 3] += 3 * dt;
      // World-space drops, wrapped into a box around the camera.
      const x = cam.x + wrap(this.rainPos[i * 3] - cam.x);
      const y = cam.y + wrap(this.rainPos[i * 3 + 1] - cam.y);
      const z = cam.z + wrap(this.rainPos[i * 3 + 2] - cam.z);
      out.setXYZ(i * 2, x, y, z);
      out.setXYZ(i * 2 + 1, x + sx, y + sy, z + sz);
    }
    out.needsUpdate = true;
  }

  /** Darkens the time-of-day state toward storm light, plus the lightning flash. */
  tint(state: AtmosphereState): void {
    const k = this.level * 0.8;
    if (k <= 0 && this.flash <= 0.001) return;
    state.zenith.lerp(STORM_ZENITH, k);
    state.horizon.lerp(STORM_HORIZON, k);
    state.sun.lerp(STORM_HORIZON, k);
    state.light.lerp(STORM_LIGHT, k);
    state.ambientSky.lerp(STORM_AMBIENT, k * 0.8);
    state.lightIntensity *= 1 - 0.7 * k;
    state.ambientIntensity *= 1 - 0.42 * k;
    fogUniforms.fogParams.value[0] *= 1 - k;
    if (this.flash > 0.001) {
      const f = this.flash;
      state.light.lerp(FLASH, f);
      state.lightIntensity += 2.2 * f;
      state.ambientIntensity += 1.0 * f;
      state.zenith.lerp(this.tmp.copy(FLASH).multiplyScalar(0.7), f * 0.5);
      state.horizon.lerp(FLASH, f * 0.35);
    }
  }
}
