// Solid things the creature and camera can't pass through: landmarks, buildings, windmills.
// Each model has collision spheres (art/architecture.py writes them); placed copies are stored
// in a coarse grid for quick lookups. resolve() pushes a point back out of any sphere it is in.
import { Vector3 } from 'three';
import type { Placement } from './places';

const CELL = 250;

export class Obstacles {
  private spheres = new Float32Array(0); // x, y, z, r
  private grid = new Map<number, number[]>();
  private readonly d = new Vector3();

  constructor(placements: Placement[]) {
    fetch(`${import.meta.env.BASE_URL}models/architecture.json`)
      .then((r) => r.json() as Promise<Record<string, number[][]>>)
      .then((shapes) => this.build(placements, shapes));
  }

  private build(placements: Placement[], shapes: Record<string, number[][]>): void {
    const list: number[] = [];
    for (const p of placements) {
      const local = shapes[p.model];
      if (!local) continue;
      const cos = Math.cos(p.yaw);
      const sin = Math.sin(p.yaw);
      for (const [x, y, z, r] of local) {
        // Rotate about Y by yaw (three's convention), scale, translate.
        list.push(p.x + (x * cos + z * sin) * p.scale, p.y + y * p.scale, p.z + (-x * sin + z * cos) * p.scale, r * p.scale);
      }
    }
    this.spheres = new Float32Array(list);
    for (let i = 0; i < this.spheres.length; i += 4) {
      const r = this.spheres[i + 3];
      const x0 = Math.floor((this.spheres[i] - r) / CELL);
      const x1 = Math.floor((this.spheres[i] + r) / CELL);
      const z0 = Math.floor((this.spheres[i + 2] - r) / CELL);
      const z1 = Math.floor((this.spheres[i + 2] + r) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = (cx + 1000) * 2000 + (cz + 1000);
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key)!.push(i);
        }
      }
    }
  }

  /**
   * Pushes `p` (a body of radius `radius`) out of every sphere it overlaps. Returns how deep it
   * was (0 when clear), so callers can scale their reaction.
   */
  resolve(p: Vector3, radius: number): number {
    const cell = this.grid.get((Math.floor(p.x / CELL) + 1000) * 2000 + (Math.floor(p.z / CELL) + 1000));
    if (!cell) return 0;
    let depth = 0;
    for (const i of cell) {
      const s = this.spheres;
      this.d.set(p.x - s[i], p.y - s[i + 1], p.z - s[i + 2]);
      const dist = this.d.length();
      const reach = s[i + 3] + radius;
      if (dist >= reach) continue;
      const push = reach - dist;
      depth = Math.max(depth, push);
      if (dist < 1e-3) this.d.set(0, 1, 0);
      else this.d.divideScalar(dist);
      p.addScaledVector(this.d, push);
    }
    return depth;
  }
}
