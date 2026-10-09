// Turns the authored places in map.ts into concrete placements on the terrain: villages scatter
// their houses over gentle ground (facing downhill, toward the sea), single props and landmarks
// go where they were put. Seeded, so a village always looks the same.
import type { Heightfield } from './heightfield';
import { LANDMARKS, PROPS, VILLAGES } from './map';
import { seeded } from './random';
import type { Clearing } from './vegetation';

export interface Placement {
  model: string;
  x: number;
  y: number;
  z: number;
  /** Rotation around Y (radians). */
  yaw: number;
  scale: number;
  /** Landmarks see through fog farther. */
  landmark: boolean;
  /** Radius kept free of vegetation. */
  clear: number;
}

const HOUSES = ['house_a', 'house_b', 'house_c', 'house_d'];

export function computePlacements(hf: Heightfield, seed: number): Placement[] {
  const out: Placement[] = [];
  const rand = seeded(seed, 'places');
  const slopeAt = (x: number, z: number) => {
    const dx = hf.surface(x + 4, z) - hf.surface(x - 4, z);
    const dz = hf.surface(x, z + 4) - hf.surface(x, z - 4);
    return { s: Math.hypot(dx, dz) / 8, dx, dz };
  };

  for (const l of LANDMARKS) {
    const y = l.y ?? Math.max(hf.surface(l.x, l.z), 0) - 2;
    const clear = l.kind === 'ring' ? 0 : l.kind === 'arch' ? 130 : 60;
    const scale = l.kind === 'tower' ? 1.7 : 1;
    out.push({ model: l.kind, x: l.x, y, z: l.z, yaw: l.angle, scale, landmark: true, clear });
  }
  for (const p of PROPS) {
    const y = p.model === 'pier' ? 0 : hf.surface(p.x, p.z);
    out.push({ model: p.model, x: p.x, y, z: p.z, yaw: p.angle, scale: 1, landmark: false, clear: p.model === 'temple' ? 28 : 12 });
  }
  for (const v of VILLAGES) {
    const placed: { x: number; z: number }[] = [];
    for (let tries = 0; placed.length < v.houses && tries < v.houses * 120; tries++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * v.radius;
      const x = v.x + Math.cos(a) * r;
      const z = v.z + Math.sin(a) * r;
      const h = hf.surface(x, z);
      if (h < 5 || h > 200) continue;
      const { s, dx, dz } = slopeAt(x, z);
      if (s > 0.3) continue;
      if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 14 * 14)) continue;
      placed.push({ x, z });
      // Front door faces downhill (+Z of the model is its front), with a little jitter.
      const yaw = s > 0.02 ? Math.atan2(-dx, -dz) : rand() * Math.PI * 2;
      out.push({
        model: HOUSES[Math.floor(rand() * HOUSES.length)],
        x,
        y: h,
        z,
        yaw: yaw + (rand() - 0.5) * 0.4,
        scale: 0.9 + rand() * 0.25,
        landmark: false,
        clear: 10,
      });
    }
  }
  return out;
}

export function clearingsOf(placements: Placement[]): Clearing[] {
  return placements.filter((p) => p.clear > 0).map((p) => [p.x, p.z, p.clear] as Clearing);
}
