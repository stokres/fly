// The curated world. Everything placed by hand lives here: islands, landmarks, key thermals and
// the spawn point. Procedural detail (noise, filler islets, extra thermals) fills in around it.
//
// Coordinates are world meters. The archipelago spans roughly 9 x 9 km around the origin;
// beyond it is open sea. North is -Z. The player starts south of it, heading north.

export type IslandShape =
  /** Rounded hill with beaches. */
  | 'hill'
  /** Steep cone with a small crater, ridged flanks, snow on top. */
  | 'volcano'
  /** Long crest with ridged detail, for valley and ridge flying. */
  | 'ridge'
  /** Flat top, cliff sides. */
  | 'mesa'
  /** Ring of hills around a lagoon. */
  | 'caldera';

export interface Island {
  name: string;
  shape: IslandShape;
  x: number;
  z: number;
  /** Radii along the island's own axes, before rotation. */
  rx: number;
  rz: number;
  /** Rotation around Y in radians. */
  angle: number;
  /** Peak height above sea level. */
  height: number;
  /** Height of coastal cliffs (m); 0 or absent keeps beaches all round. */
  cliff?: number;
}

export interface LandmarkPlacement {
  kind: 'arch' | 'spire' | 'ring' | 'stack';
  x: number;
  z: number;
  /** Rotation around Y in radians. 0 = arch/ring opening faces along Z (toward spawn). */
  angle: number;
}

export const SPAWN = { x: 0, y: 180, z: 3700, yaw: 0 };

/** Sea floor depth where there is no island. */
export const SEA_FLOOR = -35;

/** Half-size of the area islands can occupy; used to bound terrain chunks. */
export const WORLD_HALF_SIZE = 5000;

export const ISLANDS: Island[] = [
  { name: 'Harbor', shape: 'hill', x: 0, z: 2500, rx: 750, rz: 480, angle: 0.15, height: 70 },
  { name: 'The Peak', shape: 'volcano', x: -1900, z: 300, rx: 1350, rz: 1250, angle: 0, height: 680, cliff: 45 },
  { name: 'Long Ridge', shape: 'ridge', x: 1900, z: -200, rx: 2300, rz: 480, angle: 1.1, height: 330, cliff: 70 },
  { name: 'Caldera', shape: 'caldera', x: -300, z: -2500, rx: 950, rz: 900, angle: 0, height: 160, cliff: 30 },
  { name: 'Mesa', shape: 'mesa', x: 2600, z: -2800, rx: 720, rz: 640, angle: 0.6, height: 230 },
  { name: 'Needle', shape: 'hill', x: -3000, z: -2100, rx: 330, rz: 260, angle: 0.4, height: 90, cliff: 35 },
  { name: 'Needle South', shape: 'hill', x: -2650, z: -1650, rx: 200, rz: 170, angle: 1.2, height: 45 },
  { name: 'Needle West', shape: 'hill', x: -3450, z: -1750, rx: 230, rz: 150, angle: 2.1, height: 55 },
  { name: 'Saddle', shape: 'hill', x: 700, z: 1100, rx: 520, rz: 300, angle: -0.5, height: 120, cliff: 40 },
];

export const LANDMARKS: LandmarkPlacement[] = [
  // On Harbor's south beach, facing the spawn point: the first thing to fly through.
  { kind: 'arch', x: 150, z: 2760, angle: 0 },
  { kind: 'spire', x: -3000, z: -2100, angle: 0 },
  // Standing in the caldera lagoon.
  { kind: 'ring', x: -300, z: -2500, angle: 0.5 },
  { kind: 'stack', x: 2650, z: -2850, angle: 0.3 },
];

/** Hand-placed thermals (x, z). More are scattered over land procedurally. */
export const THERMALS: { x: number; z: number }[] = [
  { x: -150, z: 2750 }, // first one you reach, on Harbor's south shore
  { x: -1500, z: 800 }, // on the Peak's sunny flank
  { x: 1500, z: 100 },
  { x: -300, z: -1950 }, // caldera rim
  { x: 2350, z: -2450 },
  { x: -2800, z: -1850 },
];
