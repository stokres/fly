// Wind currents: smooth tubes of fast air along the authored paths in map.ts. Drawn as white
// streaks spiralling along the flow (Ghibli wind lines); flying into one grabs the creature,
// pulls it toward the core and carries it along at the current's speed.
import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import type { Heightfield } from './heightfield';
import { CURRENTS } from './map';
import { mulberry32 } from './random';
import { tuning } from './tuning';

const SAMPLE_SPACING = 6; // m between curve samples
const STREAK_POINTS = 8;

interface Current {
  speed: number;
  radius: number;
  /** Samples along the curve: positions and unit tangents, packed xyz. */
  pos: Float32Array;
  tan: Float32Array;
  count: number;
  length: number;
  min: Vector3;
  max: Vector3;
}

interface Streak {
  current: number;
  /** Arc position (samples, fractional), angle around the axis, radius fraction, length. */
  s: number;
  angle: number;
  radius: number;
  len: number;
  spin: number;
  speed: number;
}

export interface CurrentQuery {
  /** 0..1 how deep inside a current. */
  strength: number;
  dir: Vector3;
  speed: number;
  /** Pull toward the current's core (m/s). */
  pull: Vector3;
}

export class Currents {
  readonly mesh: Mesh;
  private currents: Current[] = [];
  private streaks: Streak[] = [];
  private readonly geometry = new BufferGeometry();
  private readonly material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  private readonly query: CurrentQuery = { strength: 0, dir: new Vector3(), speed: 0, pull: new Vector3() };
  private readonly tmp = new Vector3();
  private readonly side = new Vector3();
  private readonly up = new Vector3();

  constructor(heightfield: Heightfield) {
    this.build(heightfield);
    const verts = this.streaks.length * STREAK_POINTS * 2;
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(verts * 3), 3).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute('color', new BufferAttribute(new Float32Array(verts * 4), 4).setUsage(DynamicDrawUsage));
    const index: number[] = [];
    for (let k = 0; k < this.streaks.length; k++) {
      for (let i = 0; i < STREAK_POINTS - 1; i++) {
        const a = (k * STREAK_POINTS + i) * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    this.geometry.setIndex(index);
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  private build(hf: Heightfield): void {
    const rand = mulberry32(4242);
    this.currents = CURRENTS.map((c) => {
      const curve = new CatmullRomCurve3(c.points.map(([x, y, z]) => new Vector3(x, y, z)), false, 'centripetal');
      const length = curve.getLength();
      const count = Math.max(2, Math.ceil(length / SAMPLE_SPACING));
      const pos = new Float32Array(count * 3);
      const tan = new Float32Array(count * 3);
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      const p = new Vector3();
      for (let i = 0; i < count; i++) {
        curve.getPointAt(i / (count - 1), p);
        p.y = Math.max(p.y, Math.max(hf.surface(p.x, p.z), 0) + c.radius + 12);
        p.toArray(pos, i * 3);
        min.min(p);
        max.max(p);
      }
      // Smooth the raised heights a little, then tangents from neighbors.
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 1; i < count - 1; i++) pos[i * 3 + 1] = Math.max(pos[i * 3 + 1], (pos[(i - 1) * 3 + 1] + pos[(i + 1) * 3 + 1]) / 2 - 2);
      }
      for (let i = 0; i < count; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(count - 1, i + 1);
        p.set(pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]).normalize();
        p.toArray(tan, i * 3);
      }
      min.subScalar(c.radius * 2);
      max.addScalar(c.radius * 2);
      return { speed: c.speed, radius: c.radius, pos, tan, count, length, min, max };
    });
    this.streaks = [];
    this.currents.forEach((c, ci) => {
      const n = Math.round(c.length / 9);
      for (let i = 0; i < n; i++) {
        this.streaks.push({
          current: ci,
          s: rand() * (c.count - 1),
          angle: rand() * Math.PI * 2,
          radius: 0.25 + rand() * 0.75,
          len: 2 + rand() * 3,
          spin: (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.6),
          speed: 0.7 + rand() * 0.5,
        });
      }
    });
  }

  /** How strongly the current grabs a point, its flow there, and the pull to its core. */
  sample(p: Vector3): CurrentQuery {
    const q = this.query;
    q.strength = 0;
    q.speed = 0;
    q.pull.set(0, 0, 0);
    for (const c of this.currents) {
      if (p.x < c.min.x || p.y < c.min.y || p.z < c.min.z || p.x > c.max.x || p.y > c.max.y || p.z > c.max.z) continue;
      let best = Infinity;
      let bi = -1;
      for (let i = 0; i < c.count; i++) {
        const dx = p.x - c.pos[i * 3];
        const dy = p.y - c.pos[i * 3 + 1];
        const dz = p.z - c.pos[i * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) {
          best = d;
          bi = i;
        }
      }
      const dist = Math.sqrt(best);
      // Fade out over the last stretch so the exit releases you gently.
      const end = Math.min(1, (c.count - 1 - bi) / 12);
      const k = (1 - smooth(dist / (c.radius * 1.4))) * end * tuning.currents.strength;
      if (k > q.strength) {
        q.strength = k;
        q.speed = c.speed * tuning.currents.speedScale;
        q.dir.fromArray(c.tan, bi * 3);
        q.pull.set(c.pos[bi * 3] - p.x, c.pos[bi * 3 + 1] - p.y, c.pos[bi * 3 + 2] - p.z).multiplyScalar(2.2 * k);
      }
    }
    return q;
  }

  update(dt: number, camera: Vector3, light: Color): void {
    const pos = this.geometry.attributes.position as BufferAttribute;
    const col = this.geometry.attributes.color as BufferAttribute;
    const viewRange = tuning.currents.drawDistance;
    let v = 0;
    for (const st of this.streaks) {
      const c = this.currents[st.current];
      st.s += ((c.speed * st.speed) / SAMPLE_SPACING) * dt;
      if (st.s >= c.count - 1) st.s -= c.count - 1;
      st.angle += st.spin * dt;
      const fadeView = 1 - smooth((this.distTo(c, st.s, camera) - viewRange * 0.6) / (viewRange * 0.4));
      for (let i = 0; i < STREAK_POINTS; i++) {
        const t = i / (STREAK_POINTS - 1);
        // Clamp at the start of the path (never wrap: that would stretch a ribbon across it).
        const s = Math.max(0, st.s - t * st.len);
        this.pointAt(c, s, st.angle - t * st.spin * 0.6, st.radius * c.radius * 0.8, this.tmp);
        // Ribbon width across the view direction; grows with distance so streaks stay visible
        // far away, and fades right next to the camera so they never sweep across the screen.
        this.up.subVectors(camera, this.tmp);
        const camDist = this.up.length();
        this.side.fromArray(c.tan, Math.floor(s) * 3).cross(this.up).normalize();
        const w = (0.3 * Math.sin(Math.PI * t) + 0.05) * Math.max(1, camDist / 45);
        const near = smooth((camDist - 14) / 40);
        pos.setXYZ(v, this.tmp.x + this.side.x * w, this.tmp.y + this.side.y * w, this.tmp.z + this.side.z * w);
        pos.setXYZ(v + 1, this.tmp.x - this.side.x * w, this.tmp.y - this.side.y * w, this.tmp.z - this.side.z * w);
        // Fade in at the start of the path and out at its end, so streaks appear and vanish softly.
        const ends = smooth(st.s / 8) * smooth((c.count - 1 - st.s) / 8);
        const a = Math.sin(Math.PI * t) * 0.7 * fadeView * near * ends * tuning.currents.visibility;
        col.setXYZW(v, light.r, light.g, light.b, a);
        col.setXYZW(v + 1, light.r, light.g, light.b, a);
        v += 2;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  private pointAt(c: Current, s: number, angle: number, r: number, out: Vector3): Vector3 {
    const i = Math.min(c.count - 2, Math.floor(s));
    const f = s - i;
    out.set(
      c.pos[i * 3] + (c.pos[i * 3 + 3] - c.pos[i * 3]) * f,
      c.pos[i * 3 + 1] + (c.pos[i * 3 + 4] - c.pos[i * 3 + 1]) * f,
      c.pos[i * 3 + 2] + (c.pos[i * 3 + 5] - c.pos[i * 3 + 2]) * f,
    );
    // Offset around the axis: build a frame from the tangent.
    const tx = c.tan[i * 3];
    const ty = c.tan[i * 3 + 1];
    const tz = c.tan[i * 3 + 2];
    // side = tangent x up, up' = side x tangent
    let sx = -tz;
    let sz = tx;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    const ux = -sz * ty;
    const uy = sz * tx - sx * tz;
    const uz = sx * ty;
    const ca = Math.cos(angle) * r;
    const sa = Math.sin(angle) * r;
    out.x += sx * ca + ux * sa;
    out.y += uy * sa;
    out.z += sz * ca + uz * sa;
    return out;
  }

  private distTo(c: Current, s: number, p: Vector3): number {
    const i = Math.min(c.count - 1, Math.floor(s));
    return Math.hypot(c.pos[i * 3] - p.x, c.pos[i * 3 + 1] - p.y, c.pos[i * 3 + 2] - p.z);
  }
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
