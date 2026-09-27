// Landmarks: a few large, distinctive shapes that read on the horizon and invite approach.
// They see through fog more than everything else (fogScale), so their silhouettes pull from afar.
// Some can be flown through (arch, ring). Each has a thermal next to it (see thermals.ts).
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  Vector2,
  type Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, PROP_COLORS } from './palette';
import { seeded } from './random';
import { TileGrid, WORLD_TILE, wrapDelta } from './tiling';
import { tuning } from './tuning';

export type LandmarkKind = 'arch' | 'spire' | 'ring' | 'stack';
const KINDS: LandmarkKind[] = ['arch', 'spire', 'ring', 'stack'];

export interface Landmark {
  kind: LandmarkKind;
  /** Tile-local position (repeats every WORLD_TILE). */
  x: number;
  z: number;
  /** Radius of the footprint, to keep thermals and other landmarks clear of it. */
  radius: number;
}

/** Non-indexed, colored part, ready to merge. */
function part(geo: BufferGeometry, color: number): BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  const c = new Color(color);
  const colors = new Float32Array(flat.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  flat.deleteAttribute('uv');
  return flat;
}

function build(kind: LandmarkKind, rand: () => number): { parts: BufferGeometry[]; radius: number } {
  const pick = () => PROP_COLORS[Math.floor(rand() * PROP_COLORS.length)];
  const parts: BufferGeometry[] = [];
  switch (kind) {
    case 'arch': {
      const h = 180 + rand() * 80;
      const span = 90 + rand() * 50;
      const leg = 26;
      const color = pick();
      for (const side of [-1, 1]) {
        parts.push(part(new BoxGeometry(leg, h, leg * 1.3).translate((side * (span + leg)) / 2, h / 2, 0), color));
      }
      parts.push(part(new BoxGeometry(span + leg * 2.4, 24, leg * 1.5).translate(0, h + 12, 0), PALETTE.bone));
      return { parts, radius: span / 2 + leg * 2 };
    }
    case 'spire': {
      const h = 350 + rand() * 150;
      parts.push(part(new CylinderGeometry(3, 42, h, 7).translate(0, h / 2, 0), pick()));
      parts.push(part(new CylinderGeometry(60, 70, 18, 7).translate(0, 9, 0), PALETTE.sand));
      return { parts, radius: 75 };
    }
    case 'ring': {
      const r = 70 + rand() * 30;
      const base = 50 + rand() * 30;
      parts.push(part(new TorusGeometry(r, 10, 8, 28).translate(0, base + r, 0), pick()));
      parts.push(part(new BoxGeometry(22, base + 8, 22).translate(0, (base + 8) / 2, 0), PALETTE.sand));
      return { parts, radius: r + 20 };
    }
    case 'stack': {
      let y = 0;
      let w = 70 + rand() * 30;
      const n = 4 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const h = 30 + rand() * 40;
        const box = new BoxGeometry(w, h, w * (0.7 + rand() * 0.5));
        box.rotateY(rand() * Math.PI).translate((rand() - 0.5) * 12, y + h / 2, (rand() - 0.5) * 12);
        parts.push(part(box, i % 2 ? PALETTE.terracotta : pick()));
        y += h;
        w *= 0.75 + rand() * 0.2;
      }
      return { parts, radius: 60 };
    }
  }
}

export class Landmarks {
  readonly group = new Group();
  private readonly tiles = new TileGrid(this.group, WORLD_TILE);
  private readonly material: MeshStandardMaterial;
  private readonly fogScale = { value: tuning.landmarks.fogScale };
  list: Landmark[] = [];

  constructor() {
    this.material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    // Same exp² fog as everything else, with the density scaled down for landmarks only.
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.fogScale = this.fogScale;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float fogScale;')
        .replace(
          '#include <fog_fragment>',
          `#ifdef USE_FOG
            float fd = fogDensity * fogScale;
            float fogFactor = 1.0 - exp( - fd * fd * vFogDepth * vFogDepth );
            gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
          #endif`,
        );
    };
    this.material.customProgramCacheKey = () => 'landmark-fog';
    this.rebuild();
  }

  setFogScale(scale: number): void {
    this.fogScale.value = scale;
  }

  rebuild(): void {
    for (const child of this.group.children) (child as Mesh).geometry.dispose();
    this.group.clear();
    this.tiles.invalidate();

    const t = tuning.landmarks;
    const rand = seeded(tuning.world.seed, 'landmarks');
    const count = Math.round(t.count);
    this.list = [];
    const geos: BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const kind = KINDS[i % KINDS.length];
      const { parts, radius } = build(kind, rand);
      // The first landmark stands ahead of the spawn point (spawn faces -Z), so there is
      // something to fly toward from the first second.
      const spot =
        i === 0 ? new Vector2((rand() - 0.5) * 300, -1100) : this.findSpot(rand, radius, t.minSpacing);
      const yaw = rand() * Math.PI;
      for (const p of parts) geos.push(p.rotateY(yaw).translate(spot.x, 0, spot.y));
      this.list.push({ kind, x: spot.x, z: spot.y, radius });
    }
    if (geos.length === 0) return;

    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    for (let i = 0; i < 9; i++) this.group.add(new Mesh(merged, this.material));
  }

  update(player: Vector3): void {
    this.tiles.update(player);
  }

  private findSpot(rand: () => number, radius: number, spacing: number): Vector2 {
    const spot = new Vector2();
    // Rejection sampling with a fallback: after enough tries, take the last candidate.
    for (let tries = 0; tries < 200; tries++) {
      spot.set((rand() - 0.5) * WORLD_TILE, (rand() - 0.5) * WORLD_TILE);
      const clear = this.list.every((l) => {
        const dx = wrapDelta(spot.x, l.x, WORLD_TILE);
        const dz = wrapDelta(spot.y, l.z, WORLD_TILE);
        return Math.hypot(dx, dz) > spacing + radius + l.radius;
      });
      // Keep the spawn area open.
      if (clear && Math.hypot(spot.x, spot.y) > 400) break;
    }
    return spot;
  }
}
