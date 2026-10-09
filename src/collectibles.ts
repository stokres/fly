// Things to find while flying (the game's soft goals):
//  - Light motes: glowing orbs strung along graceful lines over the land and sea. Each one
//    refills a little energy; collecting a whole trail in one go plays a rising scale and pays
//    a bonus. Trails respawn after a while, so they are always there to play with.
//  - Golden feathers: hidden in special places (inside the arch, on the needle's shrine, in the
//    ring, under the temple...). Permanent finds, saved; each one grows the creature's energy.
//  - Shrines: stone gates on high places. Flying through wakes one, which reveals the nearest
//    hidden feather with a pillar of light.
// Placement is authored in map.ts; this file handles state, visuals and pickup.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  PointsMaterial,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  CylinderGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from './heightfield';
import { softDotTexture } from './textures';
import { FEATHERS, MOTE_TRAILS, SHRINES } from './map';

export interface Mote {
  trail: number;
  pos: Vector3;
  taken: boolean;
}

export interface CollectEvent {
  kind: 'mote' | 'trail' | 'feather' | 'shrine';
  /** For motes: index in its trail (for the rising scale). */
  index: number;
  /** Trail length / feather or shrine id. */
  total: number;
  pos: Vector3;
}

const SPARKS = 400;
const MOTE_RADIUS = 9; // pickup radius, generous: the game is about flow, not precision
const FEATHER_RADIUS = 12;
const TRAIL_RESPAWN = 75; // s
/** Shrines are drawn at this scale (places.ts), so their gates are wide enough to fly through. */
export const SHRINE_SCALE = 2.6;

/** Feather shape for the pickups: a thin double-sided blade. */
function featherGeometry(): BufferGeometry {
  const blade = new IcosahedronGeometry(1, 1);
  blade.scale(0.35, 2.4, 0.08);
  const quill = new CylinderGeometry(0.05, 0.05, 1.4, 5).translate(0, -2.4, 0);
  return mergeGeometries([blade.toNonIndexed(), quill.toNonIndexed()])!;
}

export class Collectibles {
  readonly group = new Group();
  readonly motes: Mote[] = [];
  /** Feather ids collected (persisted by the save system). */
  readonly feathers = new Set<number>();
  /** Shrine ids awakened. */
  readonly shrines = new Set<number>();
  private trailState: { remaining: number; collectedInRow: number; respawn: number; total: number }[] = [];
  private readonly moteMesh: InstancedMesh;
  private readonly haloMesh: InstancedMesh;
  private readonly featherMesh: InstancedMesh;
  private readonly featherHalo: InstancedMesh;
  private readonly beams: Mesh[] = [];
  private readonly beamMaterial = new MeshBasicMaterial({
    color: 0xffe9a8,
    transparent: true,
    opacity: 0.0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private featherPos: Vector3[] = [];
  private shrinePos: { pos: Vector3; yaw: number; feather: number }[] = [];
  private time = 0;
  private readonly events: CollectEvent[] = [];
  private readonly sparks: Points;
  private readonly sparkVel = new Float32Array(SPARKS * 3);
  private readonly sparkLife = new Float32Array(SPARKS);
  private sparkNext = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly p = new Vector3();
  private readonly camera = new Vector3();

  constructor(hf: Heightfield) {
    // Motes along each trail: points interpolated along the authored polyline, kept above ground.
    MOTE_TRAILS.forEach((trail, ti) => {
      const ground = (x: number, z: number) => Math.max(hf.surface(x, z), 0);
      const pts = trail.points.map(([x, y, z]) => new Vector3(x, trail.agl ? ground(x, z) + y : y, z));
      let length = 0;
      for (let i = 1; i < pts.length; i++) length += pts[i].distanceTo(pts[i - 1]);
      const count = Math.max(3, Math.round(length / trail.spacing));
      for (let k = 0; k < count; k++) {
        const target = (k / (count - 1)) * length;
        let acc = 0;
        const pos = new Vector3();
        for (let i = 1; i < pts.length; i++) {
          const seg = pts[i].distanceTo(pts[i - 1]);
          if (acc + seg >= target || i === pts.length - 1) {
            pos.lerpVectors(pts[i - 1], pts[i], Math.min(1, (target - acc) / seg));
            break;
          }
          acc += seg;
        }
        // Heights between authored points follow the ground for `agl` trails.
        if (trail.agl) {
          const k = (target / length) * (trail.points.length - 1);
          const i0 = Math.min(trail.points.length - 2, Math.floor(k));
          const h = trail.points[i0][1] + (trail.points[i0 + 1][1] - trail.points[i0][1]) * (k - i0);
          pos.y = ground(pos.x, pos.z) + h;
        }
        pos.y = Math.max(pos.y, Math.max(hf.surface(pos.x, pos.z), 0) + 6);
        this.motes.push({ trail: ti, pos, taken: false });
      }
      this.trailState.push({ remaining: count, collectedInRow: 0, respawn: 0, total: count });
    });

    const orb = new IcosahedronGeometry(1.1, 1);
    // HDR gold, so bloom gives the motes a glow.
    this.moteMesh = new InstancedMesh(orb, new MeshBasicMaterial({ color: new Color(2.4, 1.6, 0.55) }), this.motes.length);
    this.haloMesh = new InstancedMesh(
      new IcosahedronGeometry(2.6, 1),
      new MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false }),
      this.motes.length,
    );
    this.moteMesh.frustumCulled = this.haloMesh.frustumCulled = false;

    this.featherPos = FEATHERS.map((f) => new Vector3(f.x, f.y ?? Math.max(hf.surface(f.x, f.z), 0) + (f.above ?? 6), f.z));
    this.featherMesh = new InstancedMesh(featherGeometry(), new MeshBasicMaterial({ color: new Color(2.2, 1.6, 0.5) }), FEATHERS.length);
    this.featherHalo = new InstancedMesh(
      new IcosahedronGeometry(5, 2),
      new MeshBasicMaterial({ color: 0xffc95a, transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false }),
      FEATHERS.length,
    );
    this.featherMesh.frustumCulled = this.featherHalo.frustumCulled = false;

    this.shrinePos = SHRINES.map((sh) => ({
      pos: new Vector3(sh.x, Math.max(hf.surface(sh.x, sh.z), 0) - 3, sh.z),
      yaw: sh.angle,
      feather: sh.reveals,
    }));
    // Light pillars over feathers revealed by shrines.
    const beamGeo = new CylinderGeometry(3, 6, 900, 16, 1, true).translate(0, 450, 0);
    for (const f of this.featherPos) {
      const beam = new Mesh(beamGeo, this.beamMaterial.clone());
      beam.position.set(f.x, f.y - 10, f.z);
      beam.visible = false;
      beam.frustumCulled = false;
      beam.renderOrder = 5;
      this.beams.push(beam);
      this.group.add(beam);
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(new Float32Array(SPARKS * 3).fill(-9999), 3).setUsage(DynamicDrawUsage));
    sg.setAttribute('color', new BufferAttribute(new Float32Array(SPARKS * 4), 4).setUsage(DynamicDrawUsage));
    this.sparks = new Points(
      sg,
      new PointsMaterial({ size: 0.9, map: softDotTexture, vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    );
    this.sparks.frustumCulled = false;
    this.group.add(this.moteMesh, this.haloMesh, this.featherMesh, this.featherHalo, this.sparks);
  }

  /** A burst of golden sparks at a point. */
  burst(at: Vector3, count: number, speed: number): void {
    const pos = this.sparks.geometry.attributes.position as BufferAttribute;
    const col = this.sparks.geometry.attributes.color as BufferAttribute;
    for (let k = 0; k < count; k++) {
      const i = this.sparkNext;
      this.sparkNext = (this.sparkNext + 1) % SPARKS;
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const v = speed * (0.4 + Math.random() * 0.6);
      this.sparkVel[i * 3] = Math.cos(a) * r * v;
      this.sparkVel[i * 3 + 1] = u * v + speed * 0.2;
      this.sparkVel[i * 3 + 2] = Math.sin(a) * r * v;
      this.sparkLife[i] = 1;
      pos.setXYZ(i, at.x, at.y, at.z);
      col.setXYZW(i, 1.4, 1.1 + Math.random() * 0.3, 0.55, 1);
    }
  }

  private updateSparks(dt: number): void {
    const pos = this.sparks.geometry.attributes.position as BufferAttribute;
    const col = this.sparks.geometry.attributes.color as BufferAttribute;
    for (let i = 0; i < SPARKS; i++) {
      if (this.sparkLife[i] <= 0) continue;
      this.sparkLife[i] -= dt * 0.9;
      const drag = Math.exp(-2.5 * dt);
      this.sparkVel[i * 3] *= drag;
      this.sparkVel[i * 3 + 1] = this.sparkVel[i * 3 + 1] * drag - 2 * dt;
      this.sparkVel[i * 3 + 2] *= drag;
      pos.setXYZ(i, pos.getX(i) + this.sparkVel[i * 3] * dt, pos.getY(i) + this.sparkVel[i * 3 + 1] * dt, pos.getZ(i) + this.sparkVel[i * 3 + 2] * dt);
      col.setW(i, Math.max(0, this.sparkLife[i]));
      if (this.sparkLife[i] <= 0) pos.setY(i, -9999);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  /** Shrine placements for props (the game draws them with the architecture). */
  get shrinePlacements(): { pos: Vector3; yaw: number }[] {
    return this.shrinePos;
  }

  get featherCount(): number {
    return FEATHERS.length;
  }

  get shrineCount(): number {
    return SHRINES.length;
  }

  /** Restores saved progress. */
  restore(feathers: number[], shrines: number[]): void {
    for (const f of feathers) if (f < FEATHERS.length) this.feathers.add(f);
    for (const s of shrines) if (s < SHRINES.length) this.shrines.add(s);
  }

  /** Nearest uncollected feather that has been revealed, for the HUD compass. */
  revealedTarget(from: Vector3): Vector3 | null {
    let best: Vector3 | null = null;
    let bestD = Infinity;
    this.shrinePos.forEach((sh, si) => {
      if (!this.shrines.has(si) || this.feathers.has(sh.feather)) return;
      const f = this.featherPos[sh.feather];
      const d = f.distanceToSquared(from);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    });
    return best;
  }

  /** Checks pickups along the segment the creature flew this frame; returns what happened. */
  update(dt: number, from: Vector3, to: Vector3, camera: Vector3): CollectEvent[] {
    this.camera.copy(camera);
    this.time += dt;
    this.events.length = 0;

    // Motes.
    this.motes.forEach((m) => {
      if (m.taken) return;
      if (distToSegment(m.pos, from, to) < MOTE_RADIUS) {
        m.taken = true;
        const st = this.trailState[m.trail];
        st.remaining--;
        st.collectedInRow++;
        st.respawn = TRAIL_RESPAWN;
        this.events.push({ kind: 'mote', index: st.collectedInRow - 1, total: st.total, pos: m.pos });
        if (st.remaining === 0) this.events.push({ kind: 'trail', index: m.trail, total: st.total, pos: m.pos });
      }
    });
    this.trailState.forEach((st, ti) => {
      if (st.respawn <= 0) return;
      st.respawn -= dt;
      if (st.respawn <= 0) {
        for (const m of this.motes) if (m.trail === ti) m.taken = false;
        st.remaining = st.total;
        st.collectedInRow = 0;
      }
    });

    // Feathers.
    this.featherPos.forEach((f, i) => {
      if (this.feathers.has(i)) return;
      if (distToSegment(f, from, to) < FEATHER_RADIUS) {
        this.feathers.add(i);
        this.events.push({ kind: 'feather', index: i, total: FEATHERS.length, pos: f });
      }
    });

    // Shrines: fly through the gate (within its opening).
    this.shrinePos.forEach((sh, i) => {
      if (this.shrines.has(i)) return;
      this.p.set(sh.pos.x, sh.pos.y + SHRINE_SCALE * 5, sh.pos.z);
      if (distToSegment(this.p, from, to) < SHRINE_SCALE * 6) {
        this.shrines.add(i);
        this.events.push({ kind: 'shrine', index: i, total: SHRINES.length, pos: sh.pos });
      }
    });

    for (const e of this.events) {
      if (e.kind === 'mote') this.burst(e.pos, 14, 14);
      else if (e.kind === 'feather') this.burst(e.pos, 120, 40);
      else if (e.kind === 'shrine') this.burst(this.p.copy(e.pos).setY(e.pos.y + 13), 90, 30);
    }
    this.updateSparks(dt);
    this.draw();
    return this.events;
  }

  private draw(): void {
    let n = 0;
    const t = this.time;
    const far2 = 1800 * 1800; // beyond this the fog has them anyway
    for (const m of this.motes) {
      if (m.taken || m.pos.distanceToSquared(this.camera) > far2) continue;
      const bob = Math.sin(t * 2 + m.pos.x * 0.05) * 0.6;
      const pulse = 1 + Math.sin(t * 4 + m.pos.z * 0.1) * 0.12;
      this.p.copy(m.pos).setY(m.pos.y + bob);
      this.m.compose(this.p, this.q.identity(), this.s.setScalar(pulse));
      this.moteMesh.setMatrixAt(n, this.m);
      this.haloMesh.setMatrixAt(n, this.m);
      n++;
    }
    this.moteMesh.count = this.haloMesh.count = n;
    this.moteMesh.instanceMatrix.needsUpdate = this.haloMesh.instanceMatrix.needsUpdate = true;

    let f = 0;
    this.featherPos.forEach((p, i) => {
      const beam = this.beams[i];
      const revealed = this.shrinePos.some((sh, si) => sh.feather === i && this.shrines.has(si));
      beam.visible = revealed && !this.feathers.has(i);
      (beam.material as MeshBasicMaterial).opacity = 0.18 + Math.sin(t * 2 + i) * 0.05;
      if (this.feathers.has(i)) return;
      this.q.setFromAxisAngle(Y, t * 1.2 + i);
      this.p.copy(p).setY(p.y + Math.sin(t * 1.5 + i) * 0.8);
      this.featherMesh.setMatrixAt(f, this.m.compose(this.p, this.q, this.s.setScalar(1.3)));
      this.featherHalo.setMatrixAt(f, this.m.compose(this.p, this.q.identity(), this.s.setScalar(1 + Math.sin(t * 3 + i) * 0.1)));
      f++;
    });
    this.featherMesh.count = this.featherHalo.count = f;
    this.featherMesh.instanceMatrix.needsUpdate = this.featherHalo.instanceMatrix.needsUpdate = true;
  }
}

const Y = new Vector3(0, 1, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();

function distToSegment(p: Vector3, a: Vector3, b: Vector3): number {
  tmpA.subVectors(b, a);
  const len2 = tmpA.lengthSq();
  const t = len2 > 0 ? Math.max(0, Math.min(1, tmpB.subVectors(p, a).dot(tmpA) / len2)) : 0;
  return tmpB.copy(a).addScaledVector(tmpA, t).distanceTo(p);
}
