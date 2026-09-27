// The whole game draws from this limited palette. Add a color only with a reason.
export const PALETTE = {
  sky: 0x9fb8c8,
  skyLight: 0xdfeeff,
  sun: 0xfff1dc,
  ground: 0x7f9a78,
  groundDark: 0x5f7a5a,
  sand: 0xd9c9a3,
  terracotta: 0xc98f6b,
  sage: 0x8fa5a0,
  bone: 0xe8dcc4,
  moss: 0xa7b89a,
  ember: 0xe0795b,
  ink: 0x3b4650,
  sea: 0x4f8f94,
  seaDeep: 0x2f5d68,
} as const;

/** Colors used for scattered props and landmarks. */
export const PROP_COLORS = [PALETTE.sand, PALETTE.terracotta, PALETTE.sage, PALETTE.bone, PALETTE.moss];

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
  { elevation: -0.3, zenith: 0x0b1526, horizon: 0x1c2a40, sun: 0x2c3f5c, light: 0x8fa6c8, lightIntensity: 0.35,
    ambientSky: 0x3a4a66, ambientGround: 0x141c24, ambientIntensity: 0.5 },
  { elevation: -0.06, zenith: 0x243a5e, horizon: 0x7a6f86, sun: 0xd88a6a, light: 0x9fa8c8, lightIntensity: 0.3,
    ambientSky: 0x5a6a8a, ambientGround: 0x2a2e36, ambientIntensity: 0.7 },
  { elevation: 0.04, zenith: 0x4a6a92, horizon: 0xe6a07c, sun: 0xff9a5c, light: 0xffa56a, lightIntensity: 1.3,
    ambientSky: 0x9aa6c0, ambientGround: 0x5a5048, ambientIntensity: 1.0 },
  { elevation: 0.25, zenith: 0x6f9cc4, horizon: 0xf0cfa8, sun: 0xffd29a, light: 0xffe0b0, lightIntensity: 2.0,
    ambientSky: 0xcfdcec, ambientGround: 0x6b7a5a, ambientIntensity: 1.3 },
  { elevation: 0.6, zenith: 0x5f8fc0, horizon: 0xbcd3de, sun: 0xfff2dc, light: 0xfff1dc, lightIntensity: 2.3,
    ambientSky: 0xdfeeff, ambientGround: 0x6b7a5a, ambientIntensity: 1.4 },
];
