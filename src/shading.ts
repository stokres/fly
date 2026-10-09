// Stylized lighting for every lit object in the world, by patching three's Lambert lighting:
//  - a soft cel ramp instead of the plain N·L falloff (painterly light/shadow masses)
//  - a rim term so silhouettes catch the light
//  - `stylizedDirect`, a per-fragment scale on direct light that materials may set before lighting
//    (terrain uses it for baked mountain shadows and cloud shadows)
// Shadowed areas are lit only by the hemisphere ambient, whose sky color is a saturated blue:
// that is where the blue Ghibli shadows come from (see SKY_KEYS in palette.ts).
//
// Uniform values are typed arrays, shared by reference across materials (see fog.ts). Import this
// module before the first render. All world materials should be MeshLambertMaterial.
import { ShaderChunk, ShaderLib } from 'three';

export const shadingUniforms = {
  /** x: ramp start, y: ramp end (on N·L), z: rim strength, w: rim power. */
  toonParams: { value: new Float32Array([-0.05, 0.32, 0.35, 3.0]) },
};

ShaderChunk.lights_lambert_pars_fragment = /* glsl */ `
varying vec3 vViewPosition;
uniform vec4 toonParams;
// Scale on direct light for this fragment; materials may set it before lighting runs.
float stylizedDirect = 1.0;

struct LambertMaterial {
  vec3 diffuseColor;
  float specularStrength;
};

void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  float nl = dot( geometryNormal, directLight.direction );
  float ramp = smoothstep( toonParams.x, toonParams.y, nl );
  vec3 light = directLight.color * stylizedDirect;
  reflectedLight.directDiffuse += ramp * light * BRDF_Lambert( material.diffuseColor );
  // Rim: edges facing away from the viewer pick up light, strongest when the light is behind.
  float fres = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), toonParams.w );
  float back = saturate( 0.5 - 0.5 * dot( geometryViewDir, directLight.direction ) ) + 0.35;
  reflectedLight.directDiffuse += fres * back * toonParams.z * light * BRDF_Lambert( material.diffuseColor ) * 3.0;
}

void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}

#define RE_Direct RE_Direct_Lambert
#define RE_IndirectDiffuse RE_IndirectDiffuse_Lambert
`;

Object.assign(ShaderLib.lambert.uniforms, shadingUniforms);
