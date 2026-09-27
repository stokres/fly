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
