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
  kind: 'arch' | 'needle' | 'ring' | 'tower';
  x: number;
  z: number;
  /** Rotation around Y in radians. 0 = arch/ring opening faces along Z (toward spawn). */
  angle: number;
  /** Absolute height of the model origin; omitted = on the ground. */
  y?: number;
}

/** A village: houses scattered on the gentle ground within the circle. */
export interface Village {
  name: string;
  x: number;
  z: number;
  radius: number;
  houses: number;
}

/** A single building at an authored spot (on the ground). */
export interface PropPlacement {
  model: 'lighthouse' | 'windmill' | 'temple' | 'pier';
  x: number;
  z: number;
  angle: number;
}

/** A sailboat looping on a circle. */
export interface BoatRoute {
  x: number;
  z: number;
  radius: number;
  /** m/s; negative sails the other way. */
  speed: number;
}

export const SPAWN = { x: 0, y: 120, z: 3700, yaw: 0 };

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
  // A natural sea arch straight ahead of the spawn point: the first thing to fly through.
  { kind: 'arch', x: 60, z: 3020, angle: 0 },
  // A rock needle rising from the Needle islet, a tiny shrine on its summit.
  { kind: 'needle', x: -3000, z: -2100, angle: 0.4 },
  // An ancient stone ring floating over the caldera lagoon.
  { kind: 'ring', x: -300, z: -2500, angle: 0.5, y: 115 },
  // A ruined tower on the Mesa.
  { kind: 'tower', x: 2760, z: -2940, angle: 0.3 },
];

export const VILLAGES: Village[] = [
  { name: 'Harbor Town', x: 80, z: 2520, radius: 190, houses: 38 },
  { name: 'Peak Cove', x: -2450, z: 1080, radius: 170, houses: 16 },
  { name: 'Ember Hamlet', x: -1100, z: 1080, radius: 150, houses: 7 },
  { name: 'Saddle', x: 660, z: 1140, radius: 120, houses: 4 },
];

export const PROPS: PropPlacement[] = [
  { model: 'lighthouse', x: 350, z: 2570, angle: -0.9 },
  { model: 'pier', x: 130, z: 2830, angle: 0 },
  { model: 'pier', x: -2460, z: 1290, angle: 0.2 },
  { model: 'windmill', x: 700, z: 1100, angle: 2.6 },
  { model: 'windmill', x: 610, z: 1190, angle: 2.4 },
  { model: 'windmill', x: 1900, z: -860, angle: 2.0 },
  { model: 'windmill', x: 1460, z: -860, angle: 1.7 },
  { model: 'windmill', x: 2340, z: 240, angle: 2.8 },
  { model: 'temple', x: 2520, z: -2720, angle: 0.3 },
];

export const BOATS: BoatRoute[] = [
  { x: 120, z: 3150, radius: 260, speed: 6 },
  { x: -500, z: 2200, radius: 420, speed: -5 },
  { x: 900, z: 2300, radius: 330, speed: 4.5 },
  { x: -2400, z: 1550, radius: 300, speed: 5 },
  { x: 1100, z: 1700, radius: 500, speed: -6 },
  { x: -1200, z: -1700, radius: 450, speed: 5.5 },
];

/** Hand-placed thermals (x, z). More are scattered over land procedurally. */
export const THERMALS: { x: number; z: number }[] = [
  { x: -150, z: 2650 }, // over Harbor Town
  { x: -1500, z: 800 }, // on the Peak's sunny flank
  { x: 1500, z: 100 },
  { x: -300, z: -1950 }, // caldera rim
  { x: 2350, z: -2450 },
  { x: -2800, z: -1850 },
];

/**
 * Wind currents: ribbons of fast air along these points (x, y, z). Flying in grabs the creature
 * and carries it along at `speed`. Points are raised to clear the terrain automatically.
 */
export interface CurrentPath {
  name: string;
  points: [number, number, number][];
  /** Flow speed, m/s. */
  speed: number;
  /** Capture radius, m. */
  radius: number;
}

function helix(cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, turns: number, start: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = Math.round(turns * 10);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = start + t * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * t;
    out.push([cx + Math.cos(a) * r, y0 + (y1 - y0) * t, cz + Math.sin(a) * r]);
  }
  return out;
}

export const CURRENTS: CurrentPath[] = [
  {
    name: 'Harbor Run',
    points: [[-40, 70, 3500], [60, 60, 3100], [70, 70, 2800], [-120, 90, 2400], [-60, 110, 1900], [420, 130, 1500], [650, 160, 1150], [900, 170, 650]],
    speed: 78,
    radius: 26,
  },
  {
    name: 'Peak Spiral',
    points: helix(-1900, 300, 1050, 220, 120, 760, 1.6, 1.2),
    speed: 72,
    radius: 30,
  },
  {
    name: 'Ridge Line',
    points: [[1180, 240, 1080], [1500, 330, 520], [1820, 380, -60], [2150, 380, -620], [2500, 340, -1180], [2700, 300, -1700], [2780, 300, -2300]],
    speed: 85,
    radius: 26,
  },
  {
    name: 'Ring Gate',
    // Straight through the floating ring over the caldera (axis along yaw 0.5).
    points: [[-300 - 0.479 * 900, 150, -2500 - 0.878 * 900], [-300 - 0.479 * 300, 125, -2500 - 0.878 * 300], [-300, 115, -2500], [-300 + 0.479 * 300, 125, -2500 + 0.878 * 300], [-300 + 0.479 * 700, 170, -2500 + 0.878 * 700], [-1000, 200, -1200], [-1700, 160, -700]],
    speed: 80,
    radius: 24,
  },
  {
    name: 'Needle Climb',
    points: helix(-3000, -2100, 260, 70, 60, 270, 1.4, 0.5),
    speed: 68,
    radius: 26,
  },
  {
    name: 'Sea Crossing',
    points: [[2600, 260, -2600], [1800, 180, -2900], [800, 120, -3300], [-400, 90, -3500], [-1600, 110, -3300], [-2600, 140, -2700]],
    speed: 90,
    radius: 28,
  },
];
