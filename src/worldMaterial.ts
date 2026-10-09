// The material for everything placed in the world (trees, rocks, buildings, landmarks):
// vertex colors from the Blender assets, the stylized Lambert (shading.ts), baked mountain shadows
// and ambient occlusion at the object's base (terrainMaps.ts), moving cloud shadows, and options
// for wind sway (foliage) and thinner fog (landmarks, so they read from far away).
import { MeshLambertMaterial } from 'three';
import { CLOUD_SHADOW_GLSL, cloudShadowUniforms } from './cloudShadows';
import { fogUniforms } from './fog';
import type { TerrainMaps } from './terrainMaps';

export interface WorldMaterialOptions {
  /** Wind sway, scaled per vertex by a `swayAmount` attribute. */
  sway?: { time: { value: number } };
  /** Thinner fog: fog density multiplied by this uniform's value. */
  fogScale?: { value: number };
}

export function worldMaterial(maps: TerrainMaps, options: WorldMaterialOptions = {}): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, maps.uniforms, cloudShadowUniforms, { worldSunDir: { value: fogUniforms.fogSunDir.value } });
    if (options.sway) shader.uniforms.vegTime = options.sway.time;
    if (options.fogScale) shader.uniforms.fogScale = options.fogScale;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vWorldBase;
        varying vec3 vWorldPos;
        ${options.sway ? 'uniform float vegTime;\nattribute float swayAmount;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 worldBase = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
        #else
          vec3 worldBase = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
        #endif
        vWorldBase = worldBase.xz;
        #ifdef USE_INSTANCING
          vWorldPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
        #else
          vWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        #endif
        ${
          options.sway
            ? `// Sway grows with height up the plant; each plant has its own phase, gusts roll over.
        float vegH = max( position.y, 0.0 ) / 12.0;
        float phase = worldBase.x * 0.07 + worldBase.z * 0.05;
        float gust = 0.6 + 0.4 * sin( vegTime * 0.35 + worldBase.x * 0.004 );
        float bend = vegH * vegH * swayAmount * gust;
        transformed.x += sin( vegTime * 1.3 + phase ) * bend;
        transformed.z += cos( vegTime * 1.1 + phase * 1.3 ) * bend * 0.6;`
            : ''
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${options.fogScale ? 'uniform float fogScale;\n#define FOG_DENSITY_SCALE fogScale' : ''}
        varying vec2 vWorldBase;
        varying vec3 vWorldPos;
        uniform vec3 worldSunDir;
        uniform sampler2D terrainLightMap;
        uniform float terrainMapExtent;
        uniform float terrainMapsReady;
        ${CLOUD_SHADOW_GLSL}`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        options.fogScale
          ? // Landmarks are too tall for the ground maps: cloud shadow per point, projected along the sun.
            `vec2 baseLight = vec2( 1.0 );
        stylizedDirect = cloudShade( vWorldPos.xz - worldSunDir.xz / max( worldSunDir.y, 0.2 ) * vWorldPos.y );
        #include <lights_fragment_begin>`
          : `vec2 baseLight = mix( vec2( 1.0 ), texture2D( terrainLightMap, vWorldBase / ( 2.0 * terrainMapExtent ) + 0.5 ).rg, terrainMapsReady );
        stylizedDirect = baseLight.g * cloudShade( vWorldBase );
        #include <lights_fragment_begin>`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse *= mix( 0.55, 1.0, baseLight.r );`,
      );
  };
  m.customProgramCacheKey = () => `world:${options.sway ? 's' : ''}${options.fogScale ? 'f' : ''}`;
  return m;
}
