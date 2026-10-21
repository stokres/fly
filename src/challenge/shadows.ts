// Shadow spirits: ink-dark wisps with ember eyes that hunt the bird in challenge mode.
// They home in with a limited turn rate, so a tight turn, a steep dive or a boost shakes them
// off. Touching one hurts, unless the bird is boosting: then it is purified and bursts into
// light. This file owns their state, steering and visuals; challenge.ts decides what a hit,
// a purification or a near miss is worth.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { softDotTexture } from '../textures';
import { tuning } from '../tuning';

const MAX = 24;
const SMOKE = 1400;
const DEG = Math.PI / 180;
const FORWARD = new Vector3(0, 0, -1);

export interface Shadow {
  alive: boolean;
  pos: Vector3;
  /** Unit heading. */
  dir: Vector3;
  speed: number;
  age: number;
  life: number;
  /** 0..1 materializing / dissolving. */
  fade: number;
  dying: boolean;
  phase: number;
  /** Closest approach to the bird so far (for near misses). */
  closest: number;
  nearMissed: boolean;
}

export interface ShadowEvent {
  kind: 'hit' | 'purify' | 'nearMiss';
  pos: Vector3;
}

/** A lumpy, tailed blob: the body reads as smoke gathered around a core. */
function bodyGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const lump = (r: number, x: number, y: number, z: number, detail = 2) =>
    parts.push(new IcosahedronGeometry(r, detail).translate(x, y, z));
  lump(2.1, 0, 0, 0, 3);
  lump(1.5, 0.9, 0.6, 1.2);
  lump(1.4, -1.0, 0.3, 1.0);
  lump(1.2, 0, -0.7, 1.6);
  lump(1.0, 0.3, 0.2, 2.9);
  lump(0.7, -0.2, 0.1, 4.0);
  lump(0.45, 0.1, 0, 4.9, 1);
  return mergeGeometries(parts.map((g) => g.deleteAttribute('uv')))!;
}

export class Shadows {
  readonly group = new Group();
  readonly list: Shadow[] = [];
  private readonly body: InstancedMesh;
  private readonly eyes: InstancedMesh;
  private readonly smoke: Points;
  private readonly smokeVel = new Float32Array(SMOKE * 3);
  private readonly smokeLife = new Float32Array(SMOKE);
  private smokeNext = 0;
  private readonly time = { value: 0 };
  private readonly events: ShadowEvent[] = [];
  private readonly eventPool: ShadowEvent[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly p = new Vector3();
  private readonly v = new Vector3();
  private readonly w = new Vector3();
  private readonly side = new Vector3();

  constructor() {
    for (let i = 0; i < MAX; i++) {
      this.list.push({
        alive: false,
        pos: new Vector3(),
        dir: new Vector3(0, 0, -1),
        speed: 0,
        age: 0,
        life: 0,
        fade: 0,
        dying: false,
        phase: 0,
        closest: Infinity,
        nearMissed: false,
      });
    }
    for (let i = 0; i < 8; i++) this.eventPool.push({ kind: 'hit', pos: new Vector3() });

    // Ink body with a violet rim that pulses: wobbles like smoke, tail lashing behind.
    const material = new MeshBasicMaterial({ color: new Color(0.012, 0.005, 0.022) });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uShadowTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uShadowTime;
          varying vec3 vShN;
          varying vec3 vShV;
          varying float vShPhase;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 shIp = vec3( instanceMatrix[3] );
          #else
            vec3 shIp = vec3( 0.0 );
          #endif
          float shPh = shIp.x * 0.13 + shIp.z * 0.07;
          vShPhase = shPh;
          float shT = uShadowTime;
          float shW = sin( position.y * 2.3 + shT * 5.0 + shPh ) * 0.22 + sin( position.x * 3.1 - shT * 4.1 + shPh * 1.7 ) * 0.16;
          transformed += normal * shW;
          float shTail = max( 0.0, position.z );
          transformed.x += sin( shT * 6.0 - position.z * 1.2 + shPh ) * shTail * 0.28;
          transformed.y += cos( shT * 4.7 - position.z * 1.0 + shPh ) * shTail * 0.18;`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          #ifdef USE_INSTANCING
            vShN = normalize( normalMatrix * mat3( instanceMatrix ) * normal );
          #else
            vShN = normalize( normalMatrix * normal );
          #endif
          vShV = - mvPosition.xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uShadowTime;
          varying vec3 vShN;
          varying vec3 vShV;
          varying float vShPhase;`,
        )
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
          float shRim = pow( 1.0 - abs( dot( normalize( vShN ), normalize( vShV ) ) ), 3.5 );
          float shPulse = 0.7 + 0.3 * sin( uShadowTime * 7.0 + vShPhase * 3.0 );
          gl_FragColor.rgb += vec3( 0.5, 0.1, 0.8 ) * shRim * shPulse;`,
        );
    };
    this.body = new InstancedMesh(bodyGeometry(), material, MAX);
    // Ember eyes: HDR, so bloom makes them burn.
    this.eyes = new InstancedMesh(new SphereGeometry(0.34, 10, 8), new MeshBasicMaterial({ color: new Color(4.5, 1.4, 0.3) }), MAX * 2);
    this.body.frustumCulled = this.eyes.frustumCulled = false;
    this.body.count = this.eyes.count = 0;

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(SMOKE * 3).fill(-9999), 3).setUsage(DynamicDrawUsage));
    g.setAttribute('color', new BufferAttribute(new Float32Array(SMOKE * 4), 4).setUsage(DynamicDrawUsage));
    this.smoke = new Points(
      g,
      new PointsMaterial({ size: 4.5, map: softDotTexture, vertexColors: true, transparent: true, depthWrite: false }),
    );
    this.smoke.frustumCulled = false;
    this.group.add(this.body, this.eyes, this.smoke);
  }

  get aliveCount(): number {
    let n = 0;
    for (const s of this.list) if (s.alive && !s.dying) n++;
    return n;
  }

  /** Spawns a shadow at `pos` heading along `dir`. Returns false when all are in use. */
  spawn(pos: Vector3, dir: Vector3, life = tuning.challenge.shadowLife): boolean {
    const s = this.list.find((x) => !x.alive);
    if (!s) return false;
    s.alive = true;
    s.dying = false;
    s.pos.copy(pos);
    s.dir.copy(dir).normalize();
    s.speed = tuning.challenge.shadowSpeed;
    s.age = 0;
    s.life = life * (0.85 + Math.random() * 0.3);
    s.fade = 0;
    s.phase = Math.random() * 100;
    s.closest = Infinity;
    s.nearMissed = false;
    this.puff(pos, 30, 6);
    return true;
  }

  /** Dissolves every shadow (mode change, game over). */
  clear(): void {
    for (const s of this.list) if (s.alive) s.dying = true;
  }

  /**
   * Steers the shadows toward the bird and reports contacts. `canHit` is false while the bird
   * is invulnerable (shadows pass through it then, without bursting).
   */
  update(
    dt: number,
    bird: Vector3,
    birdVel: Vector3,
    boosting: boolean,
    danger: number,
    ground: (x: number, z: number) => number,
    canHit: boolean,
  ): ShadowEvent[] {
    const c = tuning.challenge;
    this.events.length = 0;
    this.time.value += dt;
    const maxTurn = (c.shadowTurnDeg + c.shadowTurnPerLevelDeg * (danger - 1)) * DEG;
    const baseSpeed = c.shadowSpeed + c.shadowSpeedPerLevel * (danger - 1);
    let n = 0;
    for (const s of this.list) {
      if (!s.alive) continue;
      s.age += dt;
      if (s.dying) {
        s.fade -= dt * 2.5;
        if (s.fade <= 0) {
          s.alive = false;
          continue;
        }
      } else {
        s.fade = Math.min(1, s.fade + dt * 1.2);
        if (s.age > s.life) {
          s.dying = true;
          this.puff(s.pos, 25, 5);
        }
      }

      // Aim where the bird is going to be, a little ahead.
      const dist = s.pos.distanceTo(bird);
      const lead = Math.min(1.1, dist / 110);
      this.v.copy(bird).addScaledVector(birdVel, lead).sub(s.pos);
      if (s.dying) this.v.copy(s.dir); // drift on while dissolving
      this.v.normalize();
      // Weave a little, like something swimming through the air.
      this.side.set(-s.dir.z, 0, s.dir.x).normalize();
      this.v.addScaledVector(this.side, Math.sin(s.age * 2.1 + s.phase) * 0.18);
      this.v.y += Math.sin(s.age * 1.6 + s.phase * 2.0) * 0.08;
      // Keep off the ground and water.
      const floor = ground(s.pos.x, s.pos.z) + 9;
      if (s.pos.y < floor + 10) this.v.y = Math.max(this.v.y, 0.35);
      this.v.normalize();
      // Turn toward it at a limited rate: out-turning them is the main way to escape.
      const cosA = Math.min(1, Math.max(-1, s.dir.dot(this.v)));
      const angle = Math.acos(cosA);
      if (angle > 1e-4) {
        const k = Math.min(1, (maxTurn * dt) / angle);
        s.dir.lerp(this.v, k).normalize();
      }
      // Rush to catch up from far away; slow a touch when right behind, so it can be shaken.
      const target = baseSpeed * (dist > 320 ? 1.35 : 1) * (s.fade < 1 ? 0.6 : 1);
      s.speed += (target - s.speed) * (1 - Math.exp(-1.5 * dt));
      s.pos.addScaledVector(s.dir, s.speed * dt);
      if (s.pos.y < floor) s.pos.y = floor;

      // Contacts.
      if (!s.dying && s.fade > 0.6) {
        if (dist < c.hitRadius) {
          if (boosting) {
            s.dying = true;
            s.fade = Math.min(s.fade, 0.6);
            this.emit('purify', s.pos);
          } else if (canHit) {
            s.dying = true;
            this.puff(s.pos, 70, 14);
            this.emit('hit', s.pos);
          }
        } else {
          if (dist < s.closest) s.closest = dist;
          // Passed close and now pulling away: a near miss, once per shadow.
          if (!s.nearMissed && s.closest < c.nearMissRadius && dist > s.closest + 4) {
            s.nearMissed = true;
            this.emit('nearMiss', s.pos);
          }
        }
      }
      if (dist > 1600) s.alive = false; // lost far behind

      // Trail smoke from the tail.
      if (Math.random() < dt * 40 * s.fade) {
        this.p.copy(s.pos).addScaledVector(s.dir, -3.5);
        this.smokeParticle(this.p, 2.5, s.fade);
      }

      // Visuals.
      const stretch = 1 + Math.min(0.5, s.speed / 160);
      const size = 1.15 * (s.dying ? 0.4 + s.fade * 0.6 : 0.3 + s.fade * 0.7);
      this.q.setFromUnitVectors(FORWARD, s.dir);
      this.s.set(size / Math.sqrt(stretch), size / Math.sqrt(stretch), size * stretch);
      this.m.compose(s.pos, this.q, this.s);
      this.body.setMatrixAt(n, this.m);
      // Eyes on the front of the head, a little apart.
      for (let e = 0; e < 2; e++) {
        this.w.set(e === 0 ? -0.75 : 0.75, 0.45, -1.75).multiply(this.s).applyQuaternion(this.q).add(s.pos);
        const blink = Math.sin(s.age * 0.9 + s.phase) > 0.97 ? 0.15 : 1;
        this.p.setScalar(size * blink * (s.dying ? s.fade : 1));
        this.m.compose(this.w, this.q, this.p);
        this.eyes.setMatrixAt(n * 2 + e, this.m);
      }
      n++;
    }
    this.body.count = n;
    this.eyes.count = n * 2;
    this.body.instanceMatrix.needsUpdate = true;
    this.eyes.instanceMatrix.needsUpdate = true;
    this.updateSmoke(dt);
    return this.events;
  }

  private emit(kind: ShadowEvent['kind'], pos: Vector3): void {
    const e = this.eventPool[this.events.length % this.eventPool.length];
    e.kind = kind;
    e.pos.copy(pos);
    this.events.push(e);
  }

  /** A burst of dark smoke. */
  puff(at: Vector3, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      this.smokeParticle(at, speed, 1);
    }
  }

  private smokeParticle(at: Vector3, speed: number, alpha: number): void {
    const pos = this.smoke.geometry.attributes.position as BufferAttribute;
    const col = this.smoke.geometry.attributes.color as BufferAttribute;
    const i = this.smokeNext;
    this.smokeNext = (this.smokeNext + 1) % SMOKE;
    pos.setXYZ(i, at.x + (Math.random() - 0.5) * 1.5, at.y + (Math.random() - 0.5) * 1.5, at.z + (Math.random() - 0.5) * 1.5);
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u) * speed * Math.random();
    this.smokeVel[i * 3] = Math.cos(a) * r;
    this.smokeVel[i * 3 + 1] = u * speed * Math.random() + 0.8;
    this.smokeVel[i * 3 + 2] = Math.sin(a) * r;
    this.smokeLife[i] = 1;
    const tint = Math.random();
    col.setXYZW(i, 0.05 + tint * 0.08, 0.02, 0.08 + tint * 0.1, alpha * 0.85);
  }

  private updateSmoke(dt: number): void {
    const pos = this.smoke.geometry.attributes.position as BufferAttribute;
    const col = this.smoke.geometry.attributes.color as BufferAttribute;
    for (let i = 0; i < SMOKE; i++) {
      if (this.smokeLife[i] <= 0) continue;
      this.smokeLife[i] -= dt * 0.9;
      const drag = Math.exp(-1.5 * dt);
      this.smokeVel[i * 3] *= drag;
      this.smokeVel[i * 3 + 1] *= drag;
      this.smokeVel[i * 3 + 2] *= drag;
      pos.setXYZ(i, pos.getX(i) + this.smokeVel[i * 3] * dt, pos.getY(i) + this.smokeVel[i * 3 + 1] * dt, pos.getZ(i) + this.smokeVel[i * 3 + 2] * dt);
      col.setW(i, Math.max(0, this.smokeLife[i]) * 0.8);
      if (this.smokeLife[i] <= 0) pos.setY(i, -9999);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}
