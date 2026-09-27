// Landmarks: a few large, distinctive shapes that read on the horizon and invite approach.
// They see through fog more than everything else (fogScale), so their silhouettes pull from afar.
// Some can be flown through (arch, ring). Placements are authored in map.ts.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Heightfield } from './heightfield';
import { LANDMARKS } from './map';
import { PALETTE, PROP_COLORS } from './palette';
import { seeded } from './random';
import { tuning } from './tuning';

export type LandmarkKind = 'arch' | 'spire' | 'ring' | 'stack';

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
  readonly mesh = new Mesh(new BufferGeometry());
  private readonly fogScale = { value: tuning.landmarks.fogScale };

  constructor(heightfield: Heightfield) {
    const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    // Same exp² fog as everything else, with the density scaled down for landmarks only.
    material.onBeforeCompile = (shader) => {
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
    material.customProgramCacheKey = () => 'landmark-fog';
    this.mesh.material = material;
    this.rebuild(heightfield);
  }

  setFogScale(scale: number): void {
    this.fogScale.value = scale;
  }

  rebuild(heightfield: Heightfield): void {
    const rand = seeded(tuning.world.seed, 'landmarks');
    const geos: BufferGeometry[] = [];
    for (const place of LANDMARKS) {
      const { parts, radius } = build(place.kind, rand);
      // Sink the base to the lowest ground under the footprint so nothing floats.
      let base = Infinity;
      for (let a = 0; a < 8; a++) {
        const r = a === 0 ? 0 : radius * 0.8;
        const angle = (a / 7) * Math.PI * 2;
        base = Math.min(base, heightfield.surface(place.x + Math.cos(angle) * r, place.z + Math.sin(angle) * r));
      }
      base = Math.max(base, -30) - 2;
      for (const p of parts) geos.push(p.rotateY(place.angle).translate(place.x, base, place.z));
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
  }
}
