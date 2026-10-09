// The game's colors: a limited palette, the terrain/water ramps and the time-of-day keys.
// Add a color only with a reason. Blender assets carry their own colors (art/*.py), chosen to match.
export const PALETTE = {
  sky: 0x8fc4ea,
  skyLight: 0xe4f3ff,
  sun: 0xfff1dc,
  ground: 0x6fb04c,
  groundDark: 0x3f8a43,
  sand: 0xecd9a6,
  terracotta: 0xd0673f,
  sage: 0x9aa7a3,
  bone: 0xf6f0e2,
  moss: 0x9cc25a,
  ember: 0xf08a4b,
  ink: 0x2c3442,
  sea: 0x2fb3c2,
  seaDeep: 0x165f97,
} as const;

/**
 * Terrain and water ramps (Ghibli summer: lush greens, pale cliffs, turquoise shallows).
 * Read by the terrain, grass and water shaders.
 */
export const LANDSCAPE = {
  grassLush: 0x6cb848,
  grassDeep: 0x3f9440,
  grassSun: 0xa9cf55,
  grassDry: 0xd2c46c,
  forestFloor: 0x2f6f3a,
  sand: 0xf1dfab,
  wetSand: 0xc9b585,
  cliffLight: 0xe0d2b6,
  cliffMid: 0xb69d82,
  cliffDark: 0x7d7480,
  alpine: 0x8fae68,
  snow: 0xf6f8fb,
  waterShallow: 0x7fe6d6,
  waterMid: 0x29b5c4,
  waterDeep: 0x1677b3,
  waterAbyss: 0x0f4e86,
  foam: 0xffffff,
} as const;

/**
 * Sky and light colors across the day, keyed by sun elevation (sine of the sun's height:
 * -1 = straight down, 0 = horizon, 1 = overhead). atmosphere.ts blends between neighbors.
 * horizon doubles as the fog color, so distant land always melts into the sky.
 */
export interface SkyKey {
  elevation: number;
  zenith: number;
  horizon: number;
  /** Sun glow in the sky and sun-side fog. */
  sun: number;
  /** Directional (sun or moon) light color and intensity. */
  light: number;
  lightIntensity: number;
  /** Hemisphere ambient: sky side, ground side, intensity. */
  ambientSky: number;
  ambientGround: number;
  ambientIntensity: number;
}

export const SKY_KEYS: SkyKey[] = [
  { elevation: -0.3, zenith: 0x0b1733, horizon: 0x223a66, sun: 0x2f4c80, light: 0xa6bfe8, lightIntensity: 0.45,
    ambientSky: 0x3d5aa0, ambientGround: 0x101826, ambientIntensity: 0.6 },
  { elevation: -0.06, zenith: 0x24488c, horizon: 0xd08c8c, sun: 0xf0a07c, light: 0xb4aedc, lightIntensity: 0.4,
    ambientSky: 0x6c78c0, ambientGround: 0x2c2a3a, ambientIntensity: 0.8 },
  { elevation: 0.04, zenith: 0x3f74c6, horizon: 0xffb27a, sun: 0xff9350, light: 0xffa868, lightIntensity: 2.2,
    ambientSky: 0x8a9ee0, ambientGround: 0x6a5242, ambientIntensity: 1.0 },
  { elevation: 0.22, zenith: 0x3784d8, horizon: 0xffe1b2, sun: 0xffd590, light: 0xffe2b4, lightIntensity: 3.0,
    ambientSky: 0x8cb6f0, ambientGround: 0x5a7a48, ambientIntensity: 1.15 },
  { elevation: 0.55, zenith: 0x2a7bd8, horizon: 0xcde9f8, sun: 0xfff6e2, light: 0xfff4e2, lightIntensity: 3.3,
    ambientSky: 0x96c2f4, ambientGround: 0x5a7a46, ambientIntensity: 1.15 },
];
