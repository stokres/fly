// The sea: an opaque, stylized water surface following the player.
//  - color by depth (from the baked height map): bright turquoise shallows to deep blue
//  - shore foam: a solid line at the waterline plus bands that roll in toward the coast
//  - ripples from two scrolling noise layers, flattening with distance to avoid shimmer
//  - sky reflection by fresnel, a sharp sun glint with sparkles, mountain shadows on the water
// It is a MeshBasicMaterial with its color computed in the shader, so it keeps three's fog.
import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, type Vector3 } from 'three';
import type { AtmosphereState } from './atmosphere';
import { LANDSCAPE } from './palette';
import type { TerrainMaps } from './terrainMaps';
import { noiseTexture } from './textures';
import { tuning } from './tuning';

const SIZE = 24000;
const SNAP = 50;

const c = (hex: number) => {
  const col = new Color(hex);
  return `vec3(${col.r.toFixed(4)}, ${col.g.toFixed(4)}, ${col.b.toFixed(4)})`;
};

export class Water {
  readonly mesh: Mesh;
  private readonly uniforms = {
    noiseTex: { value: noiseTexture },
    waterTime: { value: 0 },
    waterSunDir: { value: new Float32Array(3) },
    waterSunColor: { value: new Color() },
    waterAmbient: { value: new Color() },
    waterZenith: { value: new Color() },
    waterHorizon: { value: new Color() },
    waterParams: { value: new Float32Array([1, 1, 1, 0]) }, // ripple, foam, glint, unused
  };

  constructor(maps: TerrainMaps) {
    const material = new MeshBasicMaterial();
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms, maps.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWaterPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWaterPos;
          uniform sampler2D noiseTex;
          uniform sampler2D terrainHeightMap;
          uniform sampler2D terrainLightMap;
          uniform float terrainMapExtent;
          uniform float terrainMapsReady;
          uniform float waterTime;
          uniform vec3 waterSunDir, waterSunColor, waterAmbient, waterZenith, waterHorizon;
          uniform vec4 waterParams;

          // Slope of a noise layer at uv, from finite differences.
          vec2 rippleSlope( vec2 uv ) {
            float e = 1.0 / 256.0;
            float h = texture2D( noiseTex, uv ).g;
            return vec2( texture2D( noiseTex, uv + vec2( e, 0.0 ) ).g - h, texture2D( noiseTex, uv + vec2( 0.0, e ) ).g - h ) * 9.0;
          }`,
        )
        .replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          `vec3 wp = vWaterPos;
          vec3 toEye = cameraPosition - wp;
          float dist = length( toEye );
          vec3 V = toEye / dist;
          vec2 muv = wp.xz / ( 2.0 * terrainMapExtent ) + 0.5;
          float ground = mix( -100.0, texture2D( terrainHeightMap, muv ).r, terrainMapsReady );
          float depth = max( -ground, 0.0 );
          vec2 light = mix( vec2( 1.0 ), texture2D( terrainLightMap, muv ).rg, terrainMapsReady );

          // Ripples: two layers drifting across each other; calmer far away to avoid shimmer.
          float t = waterTime;
          vec2 s = rippleSlope( wp.xz / 160.0 + vec2( t * 0.008, t * 0.005 ) )
                 + rippleSlope( wp.xz / 55.0 - vec2( t * 0.007, t * 0.013 ) ) * 0.5;
          s *= waterParams.x * ( 0.25 + 0.75 * exp( -dist / 300.0 ) );
          vec3 N = normalize( vec3( -s.x, 1.0, -s.y ) );

          // Body color by depth.
          vec3 col = mix( ${c(LANDSCAPE.waterShallow)}, ${c(LANDSCAPE.waterMid)}, smoothstep( 0.4, 7.0, depth ) );
          col = mix( col, ${c(LANDSCAPE.waterDeep)}, smoothstep( 7.0, 28.0, depth ) );
          col = mix( col, ${c(LANDSCAPE.waterAbyss)}, smoothstep( 28.0, 90.0, depth ) );
          float sunLit = mix( 0.35, 1.0, light.g );
          col *= waterAmbient * 0.55 + waterSunColor * 0.32 * sunLit * max( dot( N, waterSunDir ), 0.0 );

          // Sky reflection, stronger at grazing angles.
          vec3 R = reflect( -V, N );
          vec3 sky = mix( waterHorizon, waterZenith, pow( max( R.y, 0.0 ), 0.5 ) );
          float fres = 0.03 + 0.55 * pow( 1.0 - max( dot( N, V ), 0.0 ), 5.0 );
          col = mix( col, sky, fres );

          // Shore foam: a solid lip at the waterline, and bands that roll in toward the coast.
          float fn = texture2D( noiseTex, wp.xz / 14.0 + t * 0.01 ).a;
          float lip = 1.0 - smoothstep( 0.1, 0.9 + fn * 0.6, depth );
          float band = smoothstep( 0.7, 0.9, sin( depth * 1.7 - t * 1.4 + fn * 5.0 ) ) * ( 1.0 - smoothstep( 0.5, 4.0, depth ) );
          float foam = max( lip, band * 0.75 ) * smoothstep( 0.25, 0.55, fn + lip * 0.5 ) * waterParams.y;
          vec3 foamCol = waterAmbient * 0.75 + waterSunColor * 0.3 * sunLit;
          col = mix( col, foamCol, clamp( foam, 0.0, 1.0 ) );

          // Sun glint: a tight highlight plus sparkles where ripple facets catch the sun.
          float spec = pow( max( dot( R, waterSunDir ), 0.0 ), 420.0 ) * 6.0;
          float sparkle = smoothstep( 0.93, 0.99, texture2D( noiseTex, wp.xz / 9.0 + t * vec2( 0.02, -0.012 ) ).a )
                        * pow( max( dot( R, waterSunDir ), 0.0 ), 60.0 ) * 2.0 * exp( -dist / 500.0 );
          col += waterSunColor * ( spec + sparkle ) * light.g * waterParams.z * ( 1.0 - foam );

          vec4 diffuseColor = vec4( col, 1.0 );`,
        );
    };
    material.customProgramCacheKey = () => 'water';
    this.mesh = new Mesh(new PlaneGeometry(SIZE, SIZE, 1, 1).rotateX(-Math.PI / 2), material);
    this.mesh.frustumCulled = false;
  }

  update(dt: number, player: Vector3, state: AtmosphereState): void {
    const w = tuning.water;
    this.mesh.position.set(Math.round(player.x / SNAP) * SNAP, 0, Math.round(player.z / SNAP) * SNAP);
    const u = this.uniforms;
    u.waterTime.value += dt;
    state.sunDir.toArray(u.waterSunDir.value);
    u.waterSunColor.value.copy(state.light).multiplyScalar(state.lightIntensity);
    u.waterAmbient.value.copy(state.ambientSky).multiplyScalar(state.ambientIntensity);
    u.waterZenith.value.copy(state.zenith);
    u.waterHorizon.value.copy(state.horizon);
    u.waterParams.value[0] = w.ripple;
    u.waterParams.value[1] = w.foam;
    u.waterParams.value[2] = w.glint;
  }
}
