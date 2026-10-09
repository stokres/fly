// Shared procedural textures. The noise texture is the painterly backbone of the world: terrain
// color patches, grass tint, water ripples and sky wisps all sample it, and the CPU keeps the
// same data (noiseAt) so vegetation placement matches the forest patches the terrain paints.
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat } from 'three';
import { mulberry32 } from './random';

export const NOISE_SIZE = 256;

/** Tileable fractal value noise; one octave set per channel, coarse (R) to fine (A). */
function buildNoise(seed: number): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(NOISE_SIZE * NOISE_SIZE * 4);
  const basePeriods = [4, 8, 16, 32];
  for (let ch = 0; ch < 4; ch++) {
    let amp = 0.5;
    let norm = 0;
    for (let period = basePeriods[ch]; period <= Math.min(basePeriods[ch] * 8, NOISE_SIZE); period *= 2) {
      const lattice = Float32Array.from({ length: period * period }, () => rand());
      const cell = NOISE_SIZE / period;
      for (let y = 0; y < NOISE_SIZE; y++) {
        const gy = y / cell;
        const y0 = Math.floor(gy);
        const fy = gy - y0;
        const sy = fy * fy * (3 - 2 * fy);
        const r0 = (y0 % period) * period;
        const r1 = ((y0 + 1) % period) * period;
        for (let x = 0; x < NOISE_SIZE; x++) {
          const gx = x / cell;
          const x0 = Math.floor(gx);
          const fx = gx - x0;
          const sx = fx * fx * (3 - 2 * fx);
          const c0 = x0 % period;
          const c1 = (x0 + 1) % period;
          const a = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * sx;
          const b = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * sx;
          out[(y * NOISE_SIZE + x) * 4 + ch] += (a + (b - a) * sy) * amp;
        }
      }
      norm += amp;
      amp *= 0.5;
    }
    for (let i = ch; i < out.length; i += 4) out[i] /= norm;
  }
  // Stretch each channel to the full 0..1 range so thresholds behave the same on every channel.
  for (let ch = 0; ch < 4; ch++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = ch; i < out.length; i += 4) {
      lo = Math.min(lo, out[i]);
      hi = Math.max(hi, out[i]);
    }
    for (let i = ch; i < out.length; i += 4) out[i] = (out[i] - lo) / (hi - lo);
  }
  return out;
}

const noiseData = buildNoise(9137);

export const noiseTexture = (() => {
  const bytes = new Uint8Array(noiseData.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(noiseData[i] * 255);
  const tex = new DataTexture(bytes, NOISE_SIZE, NOISE_SIZE, RGBAFormat);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
})();

/**
 * Bilinear sample of the noise texture at texture coordinates (u, v) (repeating), channel 0..3.
 * Matches GPU sampling of `noiseTexture` with linear filtering.
 */
export function noiseAt(u: number, v: number, channel: number): number {
  const x = u * NOISE_SIZE - 0.5;
  const y = v * NOISE_SIZE - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (i: number, j: number) =>
    noiseData[((((j % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE) * NOISE_SIZE + (((i % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE)) * 4 + channel];
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return a + (b - a) * fy;
}
