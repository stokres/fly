// GLSL for the terrain's painted look, shared by the terrain and the grass so blades take the
// color of the ground they grow from. Colors come from LANDSCAPE in palette.ts.
import { Color } from 'three';
import { LANDSCAPE } from './palette';
import { noiseTexture } from './textures';

const c = (hex: number) => {
  const col = new Color(hex);
  return `vec3(${col.r.toFixed(4)}, ${col.g.toFixed(4)}, ${col.b.toFixed(4)})`;
};

/** World scales (m) of the noise layers. Vegetation placement reads the same layers. */
export const FOREST_SCALE = 900;
export const PATCH_SCALE = 380;

export const terrainUniforms = {
  noiseTex: { value: noiseTexture },
};

/** Declarations + `vec3 terrainAlbedo(vec3 p, vec3 n)` + `float forestMask(vec2 xz)`. */
export const TERRAIN_GLSL = /* glsl */ `
uniform sampler2D noiseTex;

float forestMask( vec2 xz ) {
  float f = texture( noiseTex, xz / ${FOREST_SCALE.toFixed(1)} ).g;
  return smoothstep( 0.55, 0.72, f );
}

vec3 terrainAlbedo( vec3 p, vec3 n ) {
  float macro = texture( noiseTex, p.xz / 2600.0 ).r;
  float patchN = texture( noiseTex, p.xz / ${PATCH_SCALE.toFixed(1)} ).b;
  float fine = texture( noiseTex, p.xz / 48.0 ).b;
  float grain = texture( noiseTex, p.xz / 6.5 ).a;
  float h = p.y;
  float slope = 1.0 - n.y;

  // Meadows: lush and deep greens in patches, sunlit yellow-green fields, dry grass up high.
  vec3 grass = mix( ${c(LANDSCAPE.grassDeep)}, ${c(LANDSCAPE.grassLush)}, smoothstep( 0.25, 0.75, patchN ) );
  grass = mix( grass, ${c(LANDSCAPE.grassSun)}, smoothstep( 0.55, 0.9, macro ) * 0.75 );
  grass = mix( grass, ${c(LANDSCAPE.grassDry)}, smoothstep( 0.6, 0.95, macro * 0.5 + fine * 0.5 ) * smoothstep( 60.0, 220.0, h ) * 0.55 );
  grass = mix( grass, ${c(LANDSCAPE.forestFloor)}, forestMask( p.xz ) * 0.55 );
  grass = mix( grass, ${c(LANDSCAPE.alpine)}, smoothstep( 330.0, 470.0, h + patchN * 70.0 ) );

  // Cliffs: pale stone with horizontal strata, darker on the steepest faces.
  float strata = 0.5 + 0.5 * sin( h * 0.21 + patchN * 7.0 + fine * 2.0 );
  vec3 cliff = mix( ${c(LANDSCAPE.cliffMid)}, ${c(LANDSCAPE.cliffLight)}, strata * 0.65 + fine * 0.35 );
  cliff = mix( cliff, ${c(LANDSCAPE.cliffDark)}, smoothstep( 0.55, 0.95, slope ) * 0.35 + ( 1.0 - strata ) * 0.12 );
  float cliffT = smoothstep( 0.24, 0.4, slope + ( fine - 0.5 ) * 0.14 );
  vec3 col = mix( grass, cliff, cliffT );

  // Beaches, only where the coast is gentle; wet sand at the waterline.
  float beachH = 1.8 + fine * 3.0 + patchN * 2.0;
  float beach = ( 1.0 - smoothstep( beachH - 1.2, beachH + 0.8, h ) ) * ( 1.0 - smoothstep( 0.25, 0.42, slope ) );
  col = mix( col, ${c(LANDSCAPE.sand)}, beach );
  col = mix( col, ${c(LANDSCAPE.wetSand)}, 1.0 - smoothstep( -0.6, 0.7, h ) );

  // Snow on the volcano's summit, only where it can lie.
  float snow = smoothstep( 545.0, 600.0, h + patchN * 50.0 ) * ( 1.0 - smoothstep( 0.25, 0.5, slope ) );
  col = mix( col, ${c(LANDSCAPE.snow)}, snow );

  // Painterly grain: small value jitter, like brush texture.
  return col * ( 0.9 + grain * 0.2 );
}
`;
