// Buildings, landmarks and boats from art/architecture.py, placed by places.ts. Instanced per
// model with a near/far LOD; windows ("<model>_win") glow warm at dusk; windmill sails turn; the
// lighthouse sweeps a beam at night; the ring's runes pulse; boats sail their routes.
import {
  AdditiveBlending,
  type BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { AtmosphereState } from './atmosphere';
import { BOATS } from './map';
import { loadGeometries } from './models';
import type { Placement } from './places';
import type { TerrainMaps } from './terrainMaps';
import { tuning } from './tuning';
import { worldMaterial } from './worldMaterial';

const LOD_DISTANCE = 700;
/** Windmill hub, in the windmill's local space (glTF axes). */
const HUB = new Vector3(0, 10.1, 3.15);
const LAMP = new Vector3(0, 26, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

interface Batch {
  model: string;
  items: Placement[];
  matrices: Matrix4[];
  lod0: InstancedMesh;
  lod1: InstancedMesh | null;
  win: InstancedMesh | null;
}

export class Props {
  readonly group = new Group();
  private batches: Batch[] = [];
  private sails: InstancedMesh | null = null;
  private sailBase: Matrix4[] = [];
  private boats: InstancedMesh | null = null;
  private beams: Mesh[] = [];
  private time = 0;
  private readonly fogScale = { value: tuning.landmarks.fogScale };
  private readonly propMaterial: MeshLambertMaterial;
  private readonly landmarkMaterial: MeshLambertMaterial;
  private readonly windowMaterial = new MeshBasicMaterial({ color: 0x223044 });
  private readonly runeMaterial = new MeshBasicMaterial({ color: 0x7fe8ff });
  private readonly beamMaterial = new MeshBasicMaterial({
    color: 0xfff0c0,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  private readonly glassDay = new Color(0.1, 0.13, 0.2);
  private readonly glassNight = new Color(1.0, 0.7, 0.36).multiplyScalar(2.6);
  private readonly lastRefresh = new Vector3(Infinity, 0, Infinity);
  // Scratch.
  private readonly m = new Matrix4();
  private readonly m2 = new Matrix4();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(
    private placements: Placement[],
    maps: TerrainMaps,
  ) {
    this.propMaterial = worldMaterial(maps);
    this.landmarkMaterial = worldMaterial(maps, { fogScale: this.fogScale });
    loadGeometries('architecture.glb').then((set) => this.build(set));
  }

  private build(set: Map<string, BufferGeometry>): void {
    const byModel = new Map<string, Placement[]>();
    for (const p of this.placements) {
      if (!byModel.has(p.model)) byModel.set(p.model, []);
      byModel.get(p.model)!.push(p);
    }
    for (const [model, items] of byModel) {
      const geo0 = set.get(`${model}_lod0`);
      if (!geo0) continue;
      const material = items[0].landmark ? this.landmarkMaterial : this.propMaterial;
      const make = (geo: BufferGeometry, mat: MeshBasicMaterial | MeshLambertMaterial, shadow: boolean) => {
        const mesh = new InstancedMesh(geo, mat, items.length);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = shadow;
        mesh.receiveShadow = shadow;
        this.group.add(mesh);
        return mesh;
      };
      const matrices = items.map((it) => {
        this.q.setFromAxisAngle(Y, it.yaw);
        return new Matrix4().compose(this.p.set(it.x, it.y, it.z), this.q, this.s.setScalar(it.scale));
      });
      const geo1 = set.get(`${model}_lod1`);
      const geoWin = set.get(`${model}_win`);
      const winMat = model === 'ring' ? this.runeMaterial : this.windowMaterial;
      this.batches.push({
        model,
        items,
        matrices,
        lod0: make(geo0, material, true),
        lod1: geo1 ? make(geo1, material, false) : null,
        win: geoWin ? make(geoWin, winMat, false) : null,
      });
      if (model === 'windmill') this.buildSails(set.get('windmill_sails')!, matrices);
      if (model === 'lighthouse') this.buildBeams(matrices);
    }
    const boat = set.get('boat_lod0');
    if (boat) {
      this.boats = new InstancedMesh(boat, this.propMaterial, BOATS.length);
      this.boats.castShadow = true;
      this.boats.frustumCulled = false;
      this.group.add(this.boats);
    }
    this.lastRefresh.set(Infinity, 0, Infinity);
  }

  private buildSails(geo: BufferGeometry, bases: Matrix4[]): void {
    this.sailBase = bases.map((b) => b.clone().multiply(new Matrix4().makeTranslation(HUB.x, HUB.y, HUB.z)));
    this.sails = new InstancedMesh(geo, this.propMaterial, bases.length);
    this.sails.castShadow = true;
    this.sails.frustumCulled = false;
    this.group.add(this.sails);
  }

  private buildBeams(bases: Matrix4[]): void {
    // A long soft cone pointing out horizontally from the lamp.
    const geo = new ConeGeometry(28, 520, 24, 1, true).translate(0, -260, 0).rotateZ(Math.PI / 2);
    for (const b of bases) {
      const beam = new Mesh(geo, this.beamMaterial);
      beam.position.copy(LAMP).applyMatrix4(b);
      beam.frustumCulled = false;
      beam.renderOrder = 3;
      this.beams.push(beam);
      this.group.add(beam);
    }
  }

  update(dt: number, camera: Vector3, state: AtmosphereState): void {
    this.time += dt;
    this.fogScale.value = tuning.landmarks.fogScale;
    // Lights come on as the sun gets low.
    const lights = MathUtils.smoothstep(-state.sunDir.y, -0.12, 0.04);
    this.windowMaterial.color.copy(this.glassDay).multiplyScalar(0.6 + state.ambientIntensity * 0.4).lerp(this.glassNight, lights);
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 1.7);
    this.runeMaterial.color.setRGB(0.45 * pulse, 1.4 * pulse, 1.9 * pulse).multiplyScalar(0.8 + lights * 0.6);
    this.beamMaterial.opacity = 0.16 * lights;
    for (const beam of this.beams) beam.rotation.y = this.time * 0.9;

    if (this.sails) {
      for (let i = 0; i < this.sailBase.length; i++) {
        this.q.setFromAxisAngle(Z, this.time * 0.8 + i * 1.3);
        this.m2.makeRotationFromQuaternion(this.q);
        this.sails.setMatrixAt(i, this.m.multiplyMatrices(this.sailBase[i], this.m2));
      }
      this.sails.instanceMatrix.needsUpdate = true;
    }
    if (this.boats) {
      BOATS.forEach((b, i) => {
        const a = (this.time * b.speed) / b.radius + i * 1.7;
        this.p.set(b.x + Math.cos(a) * b.radius, Math.sin(this.time * 1.3 + i) * 0.25, b.z + Math.sin(a) * b.radius);
        // Bow (local -Z) along the direction of travel, heeling a little with the wind.
        const yaw = Math.atan2(Math.sin(a), Math.cos(a)) + (b.speed > 0 ? Math.PI : 0);
        this.q.setFromAxisAngle(Y, -yaw);
        this.q.multiply(this.q2.setFromAxisAngle(Z, Math.sign(b.speed) * 0.12 + Math.sin(this.time + i) * 0.04));
        this.boats!.setMatrixAt(i, this.m.compose(this.p, this.q, this.s.setScalar(1.2)));
      });
      this.boats.instanceMatrix.needsUpdate = true;
    }

    if (Math.hypot(camera.x - this.lastRefresh.x, camera.z - this.lastRefresh.z) < 40) return;
    this.lastRefresh.copy(camera);
    for (const b of this.batches) {
      let n0 = 0;
      let n1 = 0;
      let nw = 0;
      b.items.forEach((it, i) => {
        const near = !b.lod1 || it.landmark || Math.hypot(it.x - camera.x, it.z - camera.z) < LOD_DISTANCE;
        if (near) b.lod0.setMatrixAt(n0++, b.matrices[i]);
        else b.lod1!.setMatrixAt(n1++, b.matrices[i]);
        if (b.win) b.win.setMatrixAt(nw++, b.matrices[i]);
      });
      b.lod0.count = n0;
      b.lod0.instanceMatrix.needsUpdate = true;
      if (b.lod1) {
        b.lod1.count = n1;
        b.lod1.instanceMatrix.needsUpdate = true;
      }
      if (b.win) {
        b.win.count = nw;
        b.win.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
