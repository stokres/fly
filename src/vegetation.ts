// Trees, bushes and rocks over the islands. Placement is seeded and follows the same noise
// patches the terrain paints as forest floor (terrainShading.forestMask), so forests sit on
// darker ground. Rendering: per species and LOD one InstancedMesh, refilled from the instances
// around the camera when it has moved far enough. Foliage sways in the wind and receives the
// baked mountain shadows like the terrain.
import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { CLOUD_SHADOW_GLSL, cloudShadowUniforms } from './cloudShadows';
import type { Heightfield } from './heightfield';
import { WORLD_HALF_SIZE } from './map';
import { loadGeometries } from './models';
import { seeded } from './random';
import type { TerrainMaps } from './terrainMaps';
import { FOREST_HI, FOREST_LO, FOREST_SCALE } from './terrainShading';
import { noiseAt } from './textures';
import { tuning } from './tuning';

interface Species {
  name: string;
  /** Sway amplitude (m at the top). */
  sway: number;
  castShadow: boolean;
}

const SPECIES: Species[] = [
  { name: 'broadleaf_a', sway: 0.35, castShadow: true },
  { name: 'broadleaf_b', sway: 0.35, castShadow: true },
  { name: 'broadleaf_c', sway: 0.35, castShadow: true },
  { name: 'cypress', sway: 0.5, castShadow: true },
  { name: 'pine', sway: 0.3, castShadow: true },
  { name: 'bush', sway: 0.12, castShadow: true },
  { name: 'bush_flower', sway: 0.12, castShadow: true },
  { name: 'rock_a', sway: 0, castShadow: true },
  { name: 'rock_b', sway: 0, castShadow: true },
  { name: 'rock_c', sway: 0, castShadow: true },
];
const LODS = 3;
/** Circles where nothing may grow (landmarks, buildings): x, z, radius. */
export type Clearing = [number, number, number];

/** Material shared by all vegetation: vertex colors, wind sway, baked terrain light. */
function vegetationMaterial(maps: TerrainMaps, time: { value: number }): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, maps.uniforms, cloudShadowUniforms, { vegTime: time });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float vegTime;
        attribute float swayAmount;
        varying vec2 vVegBase;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 vegBase = ( instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
        vVegBase = vegBase.xz;
        // Sway grows with height up the plant; each plant has its own phase, gusts roll over.
        float vegH = max( position.y, 0.0 ) / 12.0;
        float phase = vegBase.x * 0.07 + vegBase.z * 0.05;
        float gust = 0.6 + 0.4 * sin( vegTime * 0.35 + vegBase.x * 0.004 );
        float bend = vegH * vegH * swayAmount * gust;
        transformed.x += sin( vegTime * 1.3 + phase ) * bend;
        transformed.z += cos( vegTime * 1.1 + phase * 1.3 ) * bend * 0.6;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vVegBase;
        uniform sampler2D terrainLightMap;
        uniform float terrainMapExtent;
        uniform float terrainMapsReady;
        ${CLOUD_SHADOW_GLSL}`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `vec2 vegLight = mix( vec2( 1.0 ), texture2D( terrainLightMap, vVegBase / ( 2.0 * terrainMapExtent ) + 0.5 ).rg, terrainMapsReady );
        stylizedDirect = vegLight.g * cloudShade( vVegBase );
        #include <lights_fragment_begin>`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse *= mix( 0.55, 1.0, vegLight.r );`,
      );
  };
  m.customProgramCacheKey = () => 'vegetation';
  return m;
}

export class Vegetation {
  readonly group = new Group();
  private readonly time = { value: 0 };
  private readonly material: MeshLambertMaterial;
  /** Per species: packed instance matrices (16 floats each), tints (rgb) and positions (x, z). */
  private instances: { matrices: Float32Array; colors: Float32Array; xz: Float32Array; count: number }[] = [];
  private geometries: BufferGeometry[][] = []; // [species][lod]
  private meshes: InstancedMesh[][] = []; // [species][lod]
  private readonly lastRefresh = new Vector3(Infinity, 0, Infinity);
  private ready = false;

  constructor(
    private heightfield: Heightfield,
    maps: TerrainMaps,
    private clearings: Clearing[],
  ) {
    this.material = vegetationMaterial(maps, this.time);
    loadGeometries('vegetation.glb').then((set) => {
      this.geometries = SPECIES.map((sp) => {
        const lods: BufferGeometry[] = [];
        for (let lod = 0; lod < LODS; lod++) {
          const geo = set.get(`${sp.name}_lod${lod}`) as BufferGeometry;
          // Per-vertex sway weight (rocks don't move); read by the wind in the vertex shader.
          geo.setAttribute('swayAmount', new BufferAttribute(new Float32Array(geo.attributes.position.count).fill(sp.sway), 1));
          lods.push(geo);
        }
        return lods;
      });
      this.place();
      this.ready = true;
    });
  }

  setHeightfield(heightfield: Heightfield): void {
    this.heightfield = heightfield;
    if (this.ready) this.place();
  }

  update(dt: number, camera: Vector3): void {
    this.time.value += dt;
    if (!this.ready) return;
    const moved = Math.hypot(camera.x - this.lastRefresh.x, camera.z - this.lastRefresh.z);
    if (moved > 35) this.refresh(camera);
  }

  /** Seeded placement over all land. */
  private place(): void {
    const rand = seeded(tuning.world.seed, 'vegetation');
    const hf = this.heightfield;
    const lists: number[][] = SPECIES.map(() => []);
    const density = tuning.vegetation.density;
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    const tilt = new Quaternion();
    const yAxis = new Vector3(0, 1, 0);

    const tint = new Color();
    const add = (species: number, x: number, z: number, scale: number, y: number) => {
      q.setFromAxisAngle(yAxis, rand() * Math.PI * 2);
      tilt.setFromAxisAngle(new Vector3(rand() - 0.5, 0, rand() - 0.5).normalize(), (rand() - 0.5) * 0.12);
      q.premultiply(tilt);
      s.setScalar(scale);
      p.set(x, y, z);
      m.compose(p, q, s);
      // Each plant a slightly different shade: brightness and a nudge toward yellow or blue-green.
      const k = 0.86 + rand() * 0.24;
      const warm = (rand() - 0.5) * 0.12;
      tint.setRGB(k * (1 + warm), k, k * (1 - warm));
      lists[species].push(...m.elements, tint.r, tint.g, tint.b, x, z);
    };

    const cleared = (x: number, z: number) => this.clearings.some(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 < r * r);
    const slopeAt = (x: number, z: number) => {
      const dx = hf.surface(x + 3, z) - hf.surface(x - 3, z);
      const dz = hf.surface(x, z + 3) - hf.surface(x, z - 3);
      return Math.hypot(dx, dz) / 6;
    };
    const forestAt = (x: number, z: number) =>
      MathUtils.smoothstep(noiseAt(x / FOREST_SCALE, z / FOREST_SCALE, 1), FOREST_LO, FOREST_HI);
    const pickTree = (h: number) => {
      const r = rand();
      if (h > 300) return r < 0.55 ? 3 : 4;
      if (h > 130) return r < 0.45 ? Math.floor(rand() * 3) : r < 0.75 ? 3 : 4;
      return r < 0.75 ? Math.floor(rand() * 3) : r < 0.9 ? 4 : 3;
    };

    const half = WORLD_HALF_SIZE;
    // Forests: a dense pass inside the forest patches.
    const FOREST_CELL = 8.5;
    for (let gz = -half; gz < half; gz += FOREST_CELL) {
      for (let gx = -half; gx < half; gx += FOREST_CELL) {
        const x = gx + rand() * FOREST_CELL;
        const z = gz + rand() * FOREST_CELL;
        const roll = rand();
        const forest = forestAt(x, z);
        if (forest <= 0.02) continue;
        const h = hf.surface(x, z);
        if (h < 3.5 || h > 520 || cleared(x, z) || slopeAt(x, z) > 0.42) continue;
        const highland = MathUtils.smoothstep(h, 280, 460);
        if (roll < forest * 0.85 * (1 - highland * 0.6) * density) add(pickTree(h), x, z, 0.95 + rand() * 0.75, h - 0.6);
      }
    }
    // Meadows: lone trees, bushes and rocks.
    const CELL = 16;
    for (let gz = -half; gz < half; gz += CELL) {
      for (let gx = -half; gx < half; gx += CELL) {
        const x = gx + rand() * CELL;
        const z = gz + rand() * CELL;
        const roll = rand();
        const h = hf.surface(x, z);
        if (h < 3 || cleared(x, z)) continue;
        const slope = slopeAt(x, z);
        const forest = forestAt(x, z);
        if (slope > 0.45) {
          if (slope < 1.2 && roll < 0.05 * density) add(7 + Math.floor(rand() * 3), x, z, 0.8 + rand() * 1.6, h - 0.4);
          continue;
        }
        const highland = MathUtils.smoothstep(h, 280, 460);
        const edge = forest * (1 - forest) * 4; // strongest at forest edges
        if (roll < 0.03 * (1 - forest) * (1 - highland * 0.7) * density && h < 520) {
          add(pickTree(h), x, z, 1.05 + rand() * 0.7, h - 0.6);
        } else if (roll < (0.05 + edge * 0.25) * density) {
          add(rand() < 0.3 ? 6 : 5, x, z, 0.7 + rand() * 0.8, h - 0.3);
        } else if (roll > 0.996 - 0.006 * highland) {
          add(7 + Math.floor(rand() * 3), x, z, 0.6 + rand() * 1.2, h - 0.3);
        }
      }
    }

    const STRIDE = 21; // 16 matrix + 3 color + 2 position
    this.instances = lists.map((l) => {
      const count = l.length / STRIDE;
      const matrices = new Float32Array(count * 16);
      const colors = new Float32Array(count * 3);
      const xz = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const o = i * STRIDE;
        for (let k = 0; k < 16; k++) matrices[i * 16 + k] = l[o + k];
        for (let k = 0; k < 3; k++) colors[i * 3 + k] = l[o + 16 + k];
        xz[i * 2] = l[o + 19];
        xz[i * 2 + 1] = l[o + 20];
      }
      return { matrices, colors, xz, count };
    });
    // One instanced mesh per species and LOD, sized for every instance of that species.
    for (const lods of this.meshes) for (const mesh of lods) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.meshes = SPECIES.map((sp, si) =>
      this.geometries[si].map((geo, lod) => {
        const capacity = Math.max(this.instances[si].count, 1);
        const mesh = new InstancedMesh(geo, this.material, capacity);
        mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        mesh.count = 0;
        mesh.frustumCulled = false; // instances span the world; distance culling is ours
        mesh.castShadow = sp.castShadow && lod === 0;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        return mesh;
      }),
    );
    this.lastRefresh.set(Infinity, 0, Infinity);
    console.info('vegetation', SPECIES.map((sp, i) => `${sp.name}:${this.instances[i].count}`).join(' '));
  }

  /** Re-buckets instances into LODs by distance from the camera. */
  private refresh(camera: Vector3): void {
    this.lastRefresh.copy(camera);
    const v = tuning.vegetation;
    const d0 = v.lod0Distance ** 2;
    const d1 = v.lod1Distance ** 2;
    const d2 = v.drawDistance ** 2;
    this.instances.forEach((inst, si) => {
      const lods = this.meshes[si];
      const counts = [0, 0, 0];
      const arrays = lods.map((m) => m.instanceMatrix.array as Float32Array);
      const colorArrays = lods.map((m) => m.instanceColor!.array as Float32Array);
      for (let i = 0; i < inst.count; i++) {
        const dx = inst.xz[i * 2] - camera.x;
        const dz = inst.xz[i * 2 + 1] - camera.z;
        const d = dx * dx + dz * dz;
        const lod = d < d0 ? 0 : d < d1 ? 1 : d < d2 ? 2 : -1;
        if (lod < 0) continue;
        arrays[lod].set(inst.matrices.subarray(i * 16, i * 16 + 16), counts[lod] * 16);
        colorArrays[lod].set(inst.colors.subarray(i * 3, i * 3 + 3), counts[lod] * 3);
        counts[lod]++;
      }
      lods.forEach((m, lod) => {
        m.count = counts[lod];
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor!.needsUpdate = true;
      });
    });
  }
}
