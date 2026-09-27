// Cloud layer: a stack of horizontal slices sampling one tileable noise texture. Middle slices
// cover more than the outer ones, so clouds get rounded tops and bottoms and read as volumes
// from the side. The CPU keeps the same noise data, so densityAt() matches what is drawn:
// the game uses it to close the fog in while you punch through a cloud.
import {
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RedFormat,
  RepeatWrapping,
  type Vector3,
} from 'three';
import type { AtmosphereState } from './atmosphere';
import { seeded } from './random';
import { tuning } from './tuning';

const TEX = 256;
const SLICES = 7;
const PLANE_SIZE = 14000;

/** Tileable fractal value noise in [0, 1], TEX x TEX. */
function cloudNoise(rand: () => number): Float32Array {
  const out = new Float32Array(TEX * TEX);
  let amp = 0.5;
  let norm = 0;
  for (let period = 4; period <= 64; period *= 2) {
    const lattice = Float32Array.from({ length: period * period }, () => rand());
    const cell = TEX / period;
    for (let y = 0; y < TEX; y++) {
      const gy = y / cell;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < TEX; x++) {
        const gx = x / cell;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const at = (i: number, j: number) => lattice[(j % period) * period + (i % period)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        out[y * TEX + x] += (a + (b - a) * sy) * amp;
      }
    }
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Coverage threshold for a height fraction t in [0, 1] through the layer: lowest mid-layer. */
function sliceThreshold(t: number, coverage: number): number {
  const profile = 1 - (2 * t - 1) ** 2; // 0 at top/bottom, 1 in the middle
  return 1 - coverage + (1 - profile) * 0.22;
}

export class Clouds {
  private noise: Float32Array;
  private readonly texture: DataTexture;
  readonly slices: Mesh[] = [];
  private readonly shared = {
    cloudNoise: { value: null as DataTexture | null },
    cloudOffset: { value: new Float32Array(2) },
    cloudScale: { value: 3500 },
    cloudSoftness: { value: 0.12 },
    cloudLit: { value: new Color() },
    cloudShade: { value: new Color() },
  };
  private readonly thresholds: { value: number }[] = [];
  private readonly offset = { x: 0, z: 0 };

  constructor() {
    this.noise = cloudNoise(seeded(tuning.world.seed, 'clouds'));
    const bytes = new Uint8Array(TEX * TEX);
    this.noise.forEach((v, i) => (bytes[i] = Math.round(v * 255)));
    this.texture = new DataTexture(bytes, TEX, TEX, RedFormat);
    this.texture.wrapS = this.texture.wrapT = RepeatWrapping;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.needsUpdate = true;
    this.shared.cloudNoise.value = this.texture;

    const geometry = new PlaneGeometry(PLANE_SIZE, PLANE_SIZE).rotateX(-Math.PI / 2);
    for (let i = 0; i < SLICES; i++) {
      const t = i / (SLICES - 1);
      const threshold = { value: 0.5 };
      this.thresholds.push(threshold);
      const material = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.shared, { cloudThreshold: threshold, cloudT: { value: t } });
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vCloudXZ;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloudXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
            varying vec2 vCloudXZ;
            uniform sampler2D cloudNoise;
            uniform vec2 cloudOffset;
            uniform float cloudScale, cloudSoftness, cloudThreshold, cloudT;
            uniform vec3 cloudLit, cloudShade;`,
          )
          .replace(
            '#include <alphamap_fragment>',
            `#include <alphamap_fragment>
            float cloudN = texture2D( cloudNoise, ( vCloudXZ + cloudOffset ) / cloudScale ).r;
            diffuseColor.a *= smoothstep( cloudThreshold, cloudThreshold + cloudSoftness, cloudN );
            // Lit from above: tops bright, bellies shaded, denser cores a touch darker.
            diffuseColor.rgb = mix( cloudShade, cloudLit, cloudT ) * ( 1.0 - 0.15 * smoothstep( 0.0, 0.3, cloudN - cloudThreshold ) );`,
          );
      };
      material.customProgramCacheKey = () => 'cloud-slice';
      const mesh = new Mesh(geometry, material);
      mesh.renderOrder = 2; // after the water
      mesh.frustumCulled = false;
      this.slices.push(mesh);
    }
  }

  /**
   * Cloud color seen from inside: the average over the slices. The in-cloud fog uses it, so
   * fogged terrain behind the slices matches the slices in front of it.
   */
  readonly color = new Color();

  update(dt: number, camera: Vector3, state: AtmosphereState): void {
    const c = tuning.clouds;
    this.offset.x += c.windSpeed * dt;
    this.offset.z += c.windSpeed * 0.4 * dt;
    this.shared.cloudOffset.value[0] = this.offset.x;
    this.shared.cloudOffset.value[1] = this.offset.z;
    this.shared.cloudScale.value = c.scale;
    this.shared.cloudSoftness.value = c.softness;
    // Tops take the key light, bellies the ambient sky; both lean toward the horizon color.
    this.shared.cloudLit.value.copy(state.light).multiplyScalar(0.35 * state.lightIntensity).add(state.horizon).multiplyScalar(0.8);
    this.shared.cloudShade.value.copy(state.ambientSky).multiplyScalar(0.5 * state.ambientIntensity).lerp(state.horizon, 0.4);
    this.color.lerpColors(this.shared.cloudShade.value, this.shared.cloudLit.value, 0.5);

    this.slices.forEach((mesh, i) => {
      const t = i / (SLICES - 1);
      this.thresholds[i].value = sliceThreshold(t, c.coverage);
      mesh.position.set(camera.x, c.altitude + (t - 0.5) * c.thickness, camera.z);
      (mesh.material as MeshBasicMaterial).opacity = c.opacity;
      mesh.visible = c.coverage > 0;
    });
  }

  /** Cloud density 0..1 at a world position, matching what the slices draw. */
  densityAt(p: Vector3): number {
    const c = tuning.clouds;
    if (c.coverage <= 0) return 0;
    const t = (p.y - (c.altitude - c.thickness / 2)) / c.thickness;
    if (t < 0 || t > 1) return 0;
    const u = (((p.x + this.offset.x) / c.scale) * TEX) % TEX;
    const v = (((p.z + this.offset.z) / c.scale) * TEX) % TEX;
    const n = this.sample(u < 0 ? u + TEX : u, v < 0 ? v + TEX : v);
    const threshold = sliceThreshold(t, c.coverage);
    const x = Math.min(1, Math.max(0, (n - threshold) / c.softness));
    return x * x * (3 - 2 * x);
  }

  private sample(u: number, v: number): number {
    // Texel centers sit at +0.5, matching GPU bilinear filtering.
    const x = u - 0.5;
    const y = v - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const at = (i: number, j: number) => this.noise[(((j % TEX) + TEX) % TEX) * TEX + (((i % TEX) + TEX) % TEX)];
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  }
}
