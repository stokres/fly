// Cumulus clouds: Blender-built shapes (art/clouds.py), instanced, drifting with the wind and
// wrapping around the archipelago. Painted lighting in the shader: warm white on the sunlit side,
// blue-lavender in shadow, darker flat bellies, baked AO in the crevices, a silver lining when the
// sun is behind. They cast moving shadows on the land (cloudShadows.ts), and densityAt() tells
// when the camera is inside one, for the whiteout.
import {
  type BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { AtmosphereState } from './atmosphere';
import { type ShadowCaster, drawCloudShadows } from './cloudShadows';
import { loadGeometries } from './models';
import { seeded } from './random';
import { tuning } from './tuning';

/** Blobs of one cloud shape: x, y, z, radius, ellipsoid scales (sx, sy, sz). */
type Blob = [number, number, number, number, number, number, number];
interface Shape {
  name: string;
  balls: Blob[];
  /** Footprint half-sizes on x and z, and the height of the middle, at scale 1. */
  rx: number;
  rz: number;
  midY: number;
}
interface Cloud {
  shape: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

const REGION = 7500; // clouds wrap within ±REGION around the origin
const Y_AXIS = new Vector3(0, 1, 0);

export class Clouds {
  readonly group = new Group();
  /** Cloud color seen from inside (the in-cloud fog color). */
  readonly color = new Color();
  private shapes: Shape[] = [];
  private clouds: Cloud[] = [];
  private meshes: InstancedMesh[] = [];
  private shadowTimer = 0;
  private readonly casters: ShadowCaster[] = [];
  private readonly uniforms = {
    cloudLit: { value: new Color() },
    cloudShadeCol: { value: new Color() },
    cloudSunCol: { value: new Color() },
    cloudSunDir: { value: new Vector3(0, 1, 0) },
  };
  private readonly material: MeshBasicMaterial;
  // Scratch.
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly tmp = new Color();

  constructor() {
    this.material = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCloudPos;\nvarying vec3 vCloudN;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          mat4 cloudModel = modelMatrix * instanceMatrix;
          vCloudPos = ( cloudModel * vec4( transformed, 1.0 ) ).xyz;
          vCloudN = normalize( mat3( cloudModel ) * normal );`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vCloudPos;
          varying vec3 vCloudN;
          uniform vec3 cloudLit, cloudShadeCol, cloudSunCol, cloudSunDir;`,
        )
        .replace(
          '#include <color_fragment>',
          `float ao = vColor.r;
          vec3 N = normalize( vCloudN ) * ( gl_FrontFacing ? 1.0 : -1.0 );
          vec3 V = normalize( cameraPosition - vCloudPos );
          float wrap = dot( N, cloudSunDir ) * 0.5 + 0.5;
          vec3 col = mix( cloudShadeCol, cloudLit, smoothstep( 0.32, 0.78, wrap ) );
          col *= mix( 0.74, 1.0, ao );
          col = mix( col, cloudShadeCol * 0.92, smoothstep( -0.35, -0.85, N.y ) * 0.55 ); // flat belly
          float fres = pow( 1.0 - abs( dot( N, V ) ), 3.0 );
          float back = pow( max( dot( -V, cloudSunDir ), 0.0 ), 3.0 );
          col += cloudSunCol * fres * ( 0.12 + back * 0.85 ) * ao;
          diffuseColor.rgb = col;`,
        );
    };
    this.material.customProgramCacheKey = () => 'cumulus';

    Promise.all([
      loadGeometries('clouds.glb'),
      fetch(`${import.meta.env.BASE_URL}models/clouds.json`).then((r) => r.json() as Promise<{ name: string; balls: Blob[] }[]>),
    ]).then(([geos, meta]) => {
      this.shapes = meta.map((m) => {
        let rx = 0;
        let rz = 0;
        let lo = Infinity;
        let hi = -Infinity;
        for (const b of m.balls) {
          rx = Math.max(rx, Math.abs(b[0]) + b[3] * b[4]);
          rz = Math.max(rz, Math.abs(b[2]) + b[3] * b[6]);
          lo = Math.min(lo, b[1] - b[3]);
          hi = Math.max(hi, b[1] + b[3]);
        }
        return { name: m.name, balls: m.balls, rx: rx * 0.8, rz: rz * 0.8, midY: (lo + hi) / 2 };
      });
      this.place();
      this.meshes = this.shapes.map((shape, si) => {
        const count = this.clouds.filter((c) => c.shape === si).length;
        const mesh = new InstancedMesh(geos.get(shape.name) as BufferGeometry, this.material, Math.max(count, 1));
        mesh.count = count;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        return mesh;
      });
    });
  }

  private place(): void {
    const c = tuning.clouds;
    const rand = seeded(tuning.world.seed, 'cumulus');
    this.clouds = [];
    for (let i = 0; i < Math.round(c.count); i++) {
      this.clouds.push({
        shape: Math.floor(rand() * this.shapes.length),
        x: (rand() * 2 - 1) * REGION,
        z: (rand() * 2 - 1) * REGION,
        y: c.altitudeMin + rand() * (c.altitudeMax - c.altitudeMin),
        yaw: rand() * Math.PI * 2,
        scale: c.sizeMin + rand() * (c.sizeMax - c.sizeMin),
      });
    }
  }

  update(dt: number, state: AtmosphereState): void {
    const c = tuning.clouds;
    const u = this.uniforms;
    // Sunlit tops lean warm, shadow sides take the blue of the sky.
    u.cloudLit.value.copy(state.light).multiplyScalar(0.42 * state.lightIntensity).add(this.tmp.copy(state.horizon).multiplyScalar(0.5));
    u.cloudShadeCol.value.copy(state.ambientSky).multiplyScalar(0.8 * state.ambientIntensity).lerp(state.horizon, 0.18);
    u.cloudSunCol.value.copy(state.light).multiplyScalar(0.45 * state.lightIntensity);
    u.cloudSunDir.value.copy(state.sunDir.y > -0.05 ? state.sunDir : state.lightDir);
    this.color.lerpColors(u.cloudShadeCol.value, u.cloudLit.value, 0.6);
    if (!this.meshes.length) return;

    const wx = c.windSpeed * dt;
    const wz = c.windSpeed * 0.35 * dt;
    const index = this.meshes.map(() => 0);
    this.casters.length = 0;
    for (const cloud of this.clouds) {
      cloud.x += wx;
      cloud.z += wz;
      if (cloud.x > REGION) cloud.x -= 2 * REGION;
      if (cloud.z > REGION) cloud.z -= 2 * REGION;
      const shape = this.shapes[cloud.shape];
      this.p.set(cloud.x, cloud.y, cloud.z);
      this.q.setFromAxisAngle(Y_AXIS, cloud.yaw);
      this.s.setScalar(cloud.scale);
      this.meshes[cloud.shape].setMatrixAt(index[cloud.shape]++, this.m.compose(this.p, this.q, this.s));
      this.casters.push({
        x: cloud.x,
        z: cloud.z,
        y: cloud.y + shape.midY * cloud.scale,
        rx: shape.rx * cloud.scale,
        rz: shape.rz * cloud.scale,
        yaw: cloud.yaw,
      });
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;

    this.shadowTimer -= dt;
    if (this.shadowTimer <= 0) {
      this.shadowTimer = 0.25;
      drawCloudShadows(this.casters, state.sunDir, c.shadowStrength);
    }
  }

  /** How deep inside a cloud a point is, 0..1. */
  densityAt(p: Vector3): number {
    let field = 0;
    for (const cloud of this.clouds) {
      const shape = this.shapes[cloud.shape];
      const reach = Math.max(shape.rx, shape.rz) * 1.6 * cloud.scale;
      const dx = p.x - cloud.x;
      const dz = p.z - cloud.z;
      if (dx * dx + dz * dz > reach * reach) continue;
      // Into the cloud's local frame.
      const cos = Math.cos(-cloud.yaw);
      const sin = Math.sin(-cloud.yaw);
      const lx = (dx * cos + dz * sin) / cloud.scale;
      const lz = (-dx * sin + dz * cos) / cloud.scale;
      const ly = (p.y - cloud.y) / cloud.scale;
      for (const b of shape.balls) {
        const ex = (lx - b[0]) / b[4];
        const ey = (ly - b[1]) / b[5];
        const ez = (lz - b[2]) / b[6];
        const R = b[3] * 1.3;
        const d2 = (ex * ex + ey * ey + ez * ez) / (R * R);
        if (d2 < 1) field += (1 - d2) * (1 - d2);
      }
    }
    // The meshes are the 0.18 iso-surface of this field; ramp from just outside to well inside.
    const x = Math.min(1, Math.max(0, (field - 0.25) / 0.4));
    return x * x * (3 - 2 * x);
  }
}
