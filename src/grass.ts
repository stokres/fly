// Tall meadow grass around the camera: GPU-instanced blades in world-aligned tiles. Blades take
// the painted ground color beneath them (TERRAIN_GLSL), lighten toward the tips, carry flowers in
// patches, bend under gusts that roll across the meadows, and part under the creature's
// slipstream when it skims low. Only drawn while the camera is near the ground.
import {
  BufferAttribute,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  MathUtils,
  Mesh,
  MeshLambertMaterial,
  Vector3,
} from 'three';
import { CLOUD_SHADOW_GLSL, cloudShadowUniforms } from './cloudShadows';
import type { Heightfield } from './heightfield';
import { mulberry32 } from './random';
import type { TerrainMaps } from './terrainMaps';
import { FOREST_HI, FOREST_LO, FOREST_SCALE, TERRAIN_GLSL, terrainUniforms } from './terrainShading';
import { noiseAt } from './textures';
import { tuning } from './tuning';

const TILE = 24;
const MAX_BLADES = 160000;
const MAX_CACHED_TILES = 400;

/** One blade: a tapered strip of 7 vertices, x in [-0.5, 0.5], y in [0, 1]. */
function bladeGeometry(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  const ys = [0, 0, 0.4, 0.4, 0.75, 0.75, 1];
  const xs = [-0.5, 0.5, -0.42, 0.42, -0.26, 0.26, 0];
  const pos = new Float32Array(7 * 3);
  for (let i = 0; i < 7; i++) {
    pos[i * 3] = xs[i];
    pos[i * 3 + 1] = ys[i];
  }
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(7 * 3).fill(0), 3));
  g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6]);
  return g;
}

export class Grass {
  readonly mesh: Mesh;
  private readonly geometry = bladeGeometry();
  private readonly data: InstancedBufferAttribute;
  private readonly tiles = new Map<number, Float32Array>();
  private readonly uniforms = {
    grassTime: { value: 0 },
    grassCamera: { value: new Vector3() },
    grassBird: { value: new Vector3() },
    grassParams: { value: new Float32Array([110, 1, 1, 1]) }, // radius, height, wind, wake
    grassWind: { value: new Float32Array([0.8, 0.6]) },
  };
  private activeKey = '';

  constructor(
    private heightfield: Heightfield,
    maps: TerrainMaps,
  ) {
    this.data = new InstancedBufferAttribute(new Float32Array(MAX_BLADES * 4), 4);
    this.data.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('blade', this.data);
    this.geometry.instanceCount = 0;

    const material = new MeshLambertMaterial({ side: DoubleSide });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms, terrainUniforms, maps.uniforms, cloudShadowUniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 blade; // base x, y, z, random
          uniform sampler2D noiseTex;
          uniform float grassTime;
          uniform vec3 grassCamera, grassBird;
          uniform vec4 grassParams;
          uniform vec2 grassWind;
          varying vec3 vBladeBase;
          varying float vBladeT;
          varying float vBladeRand;`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 objectNormal = vec3( 0.0, 1.0, 0.0 ); // lit like the ground, so meadows read as one surface`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 base = blade.xyz;
          float r = blade.w;
          vBladeBase = base;
          vBladeRand = r;
          vBladeT = position.y;
          float dist = length( base.xz - grassCamera.xz );
          float fade = 1.0 - smoothstep( grassParams.x * 0.7, grassParams.x, dist );
          float patchH = texture2D( noiseTex, base.xz / 160.0 ).g;
          float h = mix( 0.55, 1.6, r * 0.6 + patchH * 0.4 ) * grassParams.y * fade;
          float w = 0.22 + r * 0.12;
          float a = r * 53.0;
          vec3 side = vec3( cos( a ), 0.0, sin( a ) );
          // Wind: a steady lean plus gusts that roll across the field.
          float gust = texture2D( noiseTex, base.xz / 70.0 - grassWind * grassTime * 0.09 ).r;
          float sway = sin( grassTime * 2.3 + r * 6.28 + base.x * 0.3 ) * 0.15;
          vec2 bend = grassWind * ( 0.25 + gust * 1.1 + sway ) * grassParams.z;
          // The creature's slipstream pushes blades away when it skims over them.
          vec2 away = base.xz - grassBird.xz;
          float wakeD = length( away );
          float low = 1.0 - smoothstep( 4.0, 16.0, grassBird.y - base.y );
          bend += away / max( wakeD, 0.5 ) * ( 1.0 - smoothstep( 2.0, 11.0, wakeD ) ) * 1.6 * low * grassParams.w;
          float t2 = position.y * position.y;
          vec3 transformed = base + side * position.x * w * ( 1.0 - position.y * 0.6 ) + vec3( 0.0, position.y * h, 0.0 );
          transformed.xz += bend * t2 * h;
          transformed.y -= length( bend ) * t2 * h * 0.35;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vBladeBase;
          varying float vBladeT;
          varying float vBladeRand;
          uniform sampler2D terrainLightMap;
          uniform float terrainMapExtent;
          uniform float terrainMapsReady;
          ${TERRAIN_GLSL}
          ${CLOUD_SHADOW_GLSL}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec3 ground = terrainAlbedo( vBladeBase, vec3( 0.0, 1.0, 0.0 ) );
          // Darker at the root, sunlit and a little yellow at the tip.
          vec3 tip = ground * vec3( 1.25, 1.2, 0.9 ) + vec3( 0.03, 0.03, 0.0 );
          diffuseColor.rgb = mix( ground * 0.62, tip, smoothstep( 0.0, 1.0, vBladeT ) );
          // Flowers: some blades in flowering patches end in a white, yellow or pink head.
          float flowerPatch = smoothstep( 0.62, 0.8, texture2D( noiseTex, vBladeBase.xz / 95.0 ).b );
          if ( vBladeRand > 1.0 - 0.09 * flowerPatch && vBladeT > 0.72 ) {
            float k = fract( vBladeRand * 97.0 );
            diffuseColor.rgb = k < 0.45 ? vec3( 0.95, 0.94, 0.9 ) : k < 0.8 ? vec3( 0.98, 0.82, 0.25 ) : vec3( 0.95, 0.55, 0.7 );
          }
          vec2 grassLight = mix( vec2( 1.0 ), texture2D( terrainLightMap, vBladeBase.xz / ( 2.0 * terrainMapExtent ) + 0.5 ).rg, terrainMapsReady );`,
        )
        .replace(
          '#include <lights_fragment_begin>',
          `stylizedDirect = grassLight.g * cloudShade( vBladeBase.xz );
          #include <lights_fragment_begin>`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          reflectedLight.indirectDiffuse *= mix( 0.5, 1.0, grassLight.r ) * mix( 0.6, 1.0, vBladeT );`,
        );
    };
    material.customProgramCacheKey = () => 'grass';
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false; // blades are placed in the shader
    this.mesh.receiveShadow = true;
  }

  setHeightfield(heightfield: Heightfield): void {
    this.heightfield = heightfield;
    this.tiles.clear();
    this.activeKey = '';
  }

  update(dt: number, camera: Vector3, bird: Vector3, groundBelowCamera: number): void {
    const g = tuning.grass;
    const u = this.uniforms;
    u.grassTime.value += dt;
    u.grassCamera.value.copy(camera);
    u.grassBird.value.copy(bird);
    u.grassParams.value.set([g.radius, g.height, g.wind, g.wake]);

    // Only near the ground: from high up the blades are sub-pixel, and the terrain paints meadows.
    const visible = g.density > 0 && camera.y - groundBelowCamera < g.maxCameraHeight;
    this.mesh.visible = visible;
    if (!visible) return;

    const r = g.radius;
    const t0x = Math.floor((camera.x - r) / TILE);
    const t1x = Math.floor((camera.x + r) / TILE);
    const t0z = Math.floor((camera.z - r) / TILE);
    const t1z = Math.floor((camera.z + r) / TILE);
    const key = `${t0x},${t1x},${t0z},${t1z}`;
    if (key === this.activeKey) return;

    // Gather tiles within the radius (building at most a few new ones per frame).
    const arr = this.data.array as Float32Array;
    let count = 0;
    let built = 0;
    let complete = true;
    for (let tz = t0z; tz <= t1z; tz++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        const cx = (tx + 0.5) * TILE - camera.x;
        const cz = (tz + 0.5) * TILE - camera.z;
        if (cx * cx + cz * cz > (r + TILE) ** 2) continue;
        const id = (tx + 10000) * 20000 + (tz + 10000);
        let tile = this.tiles.get(id);
        if (!tile) {
          if (built >= 6) {
            complete = false;
            continue;
          }
          tile = this.buildTile(tx, tz);
          this.tiles.set(id, tile);
          built++;
        }
        const n = Math.min(tile.length / 4, MAX_BLADES - count);
        arr.set(tile.subarray(0, n * 4), count * 4);
        count += n;
      }
    }
    if (complete) this.activeKey = key;
    this.geometry.instanceCount = count;
    this.data.needsUpdate = true;
    this.data.addUpdateRange(0, count * 4);

    if (this.tiles.size > MAX_CACHED_TILES) {
      const drop = this.tiles.size - MAX_CACHED_TILES;
      let i = 0;
      for (const k of this.tiles.keys()) {
        if (i++ >= drop) break;
        this.tiles.delete(k);
      }
    }
  }

  private buildTile(tx: number, tz: number): Float32Array {
    const g = tuning.grass;
    const rand = mulberry32((tx * 73856093) ^ (tz * 19349663));
    const spacing = 0.62 / Math.sqrt(Math.max(g.density, 0.01));
    const n = Math.floor(TILE / spacing);
    const out: number[] = [];
    const hf = this.heightfield;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = tx * TILE + (i + rand()) * spacing;
        const z = tz * TILE + (j + rand()) * spacing;
        const r = rand();
        const y = hf.surface(x, z);
        if (y < 2.6 || y > 470) continue;
        const dx = hf.surface(x + 1.5, z) - y;
        const dz = hf.surface(x, z + 1.5) - y;
        if (Math.hypot(dx, dz) / 1.5 > 0.5) continue; // no grass on cliffs
        // Patchy meadows: thinner in some places and under forest canopy.
        const meadow = noiseAt(x / 140, z / 140, 2);
        const forest = MathUtils.smoothstep(noiseAt(x / FOREST_SCALE, z / FOREST_SCALE, 1), FOREST_LO, FOREST_HI);
        if (rand() > MathUtils.smoothstep(meadow, 0.15, 0.45) * (1 - forest * 0.6)) continue;
        out.push(x, y - 0.05, z, r);
      }
    }
    return new Float32Array(out);
  }
}
