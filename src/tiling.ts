// The test world repeats in square tiles. Content is generated once in tile-local space and
// drawn as 3x3 copies recentered around the player, so the world never runs out.
import type { Object3D, Vector3 } from 'three';

/** Period of landmarks and thermals. Large enough that the repeat hides in the fog. */
export const WORLD_TILE = 6000;

/** Shortest signed offset from `a` to the nearest periodic copy of `b` (period `period`). */
export function wrapDelta(a: number, b: number, period: number): number {
  const d = b - a;
  return d - Math.round(d / period) * period;
}

/** Keeps 9 children of `group` laid out as a 3x3 grid of tiles centered on the player's tile. */
export class TileGrid {
  private tileX = NaN;
  private tileZ = NaN;

  constructor(
    readonly group: Object3D,
    readonly period: number,
  ) {}

  /** Forces a re-layout on the next update (after children were rebuilt). */
  invalidate(): void {
    this.tileX = this.tileZ = NaN;
  }

  update(player: Vector3): void {
    const tx = Math.round(player.x / this.period);
    const tz = Math.round(player.z / this.period);
    if (tx === this.tileX && tz === this.tileZ) return;
    this.tileX = tx;
    this.tileZ = tz;
    this.group.children.forEach((child, i) => {
      child.position.set((tx + (i % 3) - 1) * this.period, 0, (tz + Math.floor(i / 3) - 1) * this.period);
    });
  }
}
