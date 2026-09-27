// Scene-wide fog, replacing three's uniform exp² fog with one that is:
//  - height-aware: dense low over the sea, thinner at altitude (clear air above, haze below)
//  - sun-tinted: warmer toward the sun, using the same formula as the sky dome, so distant
//    terrain melts into the sky at the horizon instead of showing a fog-colored band
//
// It works by patching three's fog shader chunks and adding uniforms to every built-in shader.
// The extra uniform values are typed arrays, which three shares by reference when it clones
// uniforms per material, so one write here updates every material. Import this module before
// the first render.
import { ShaderChunk, ShaderLib } from 'three';

/** Shared fog uniforms, written by atmosphere.ts every frame. */
export const fogUniforms = {
  /** Color of fog looking toward the sun (rgb, linear). */
  fogSunColor: { value: new Float32Array([1, 0.9, 0.7]) },
  /** Unit vector toward the sun (world space). */
  fogSunDir: { value: new Float32Array([0, 1, 0]) },
  /** x: sun tint amount, y: sun tint power (tightness), z: height falloff scale (m). */
  fogParams: { value: new Float32Array([0.6, 8, 500]) },
};

ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogRay;
#endif
`;

ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // Camera-to-vertex vector in world space (view matrix rotation is orthonormal: transpose = inverse).
  vFogRay = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`;

ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogSunColor;
  uniform vec3 fogSunDir;
  uniform vec3 fogParams;
  varying float vFogDepth;
  varying vec3 vFogRay;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  // Materials can thin their own fog (landmarks do) by defining this before this chunk.
  #ifndef FOG_DENSITY_SCALE
    #define FOG_DENSITY_SCALE 1.0
  #endif
#endif
`;

ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  // Density falls off with the mean altitude of the view ray.
  float fogMeanY = max( cameraPosition.y + vFogRay.y * 0.5, 0.0 );
  float fogHeight = exp( - fogMeanY / fogParams.z );
  #ifdef FOG_EXP2
    float fogD = fogDensity * FOG_DENSITY_SCALE * fogHeight;
    float fogFactor = 1.0 - exp( - fogD * fogD * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float fogSun = pow( max( dot( normalize( vFogRay ), fogSunDir ), 0.0 ), fogParams.y ) * fogParams.x;
  gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( fogColor, fogSunColor, fogSun ), fogFactor );
#endif
`;

for (const shader of Object.values(ShaderLib)) {
  if ('fogDensity' in shader.uniforms) Object.assign(shader.uniforms, fogUniforms);
}
