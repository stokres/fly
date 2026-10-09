// Web Worker: bakes the terrain maps from the heightfield, off the main thread.
//  heights: terrain height on a SIZE² grid over ±extent (water depth, foam, placement)
//  light:   per texel, sky visibility (ambient occlusion) and sun visibility (soft mountain
//           shadows for the given sun direction). Sea texels use the water surface (y = 0).
import { DataUtils } from 'three';
import { Heightfield, type HeightfieldOptions } from './heightfield';

export type BakeRequest =
  | { type: 'heights'; options: HeightfieldOptions; size: number; lightSize: number; extent: number }
  | { type: 'light'; sun: [number, number, number]; id: number };

export type BakeResponse =
  | { type: 'heights'; data: Uint16Array; maxHeight: number }
  | { type: 'light'; data: Uint16Array; id: number };

let heights = new Float32Array(0);
let size = 0;
let extent = 1;
let cell = 1;
let maxHeight = 0;
let ao = new Float32Array(0);
/** Light (AO, sun) is baked on a coarser grid: mountain-scale shading doesn't need more. */
let lightSize = 0;
let lightCell = 1;

function sample(x: number, z: number): number {
  const gx = Math.min(Math.max((x + extent) / cell - 0.5, 0), size - 1.001);
  const gz = Math.min(Math.max((z + extent) / cell - 0.5, 0), size - 1.001);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const i = iz * size + ix;
  const a = heights[i] + (heights[i + 1] - heights[i]) * fx;
  const b = heights[i + size] + (heights[i + size + 1] - heights[i + size]) * fx;
  return Math.max(a + (b - a) * fz, 0); // the sea surface casts and receives at y = 0
}

function bakeHeights(options: HeightfieldOptions): void {
  const hf = new Heightfield(options);
  heights = new Float32Array(size * size);
  maxHeight = 0;
  for (let j = 0; j < size; j++) {
    const z = -extent + (j + 0.5) * cell;
    for (let i = 0; i < size; i++) {
      const h = hf.surface(-extent + (i + 0.5) * cell, z);
      heights[j * size + i] = h;
      if (h > maxHeight) maxHeight = h;
    }
  }
  // Ambient occlusion: how much of the sky each texel sees, from horizon angles in 8 directions.
  ao = new Float32Array(lightSize * lightSize);
  const dists = [15, 30, 55, 90, 140, 210, 300, 420];
  for (let j = 0; j < lightSize; j++) {
    const z = -extent + (j + 0.5) * lightCell;
    for (let i = 0; i < lightSize; i++) {
      const x = -extent + (i + 0.5) * lightCell;
      const h0 = sample(x, z);
      if (maxHeight <= 0) {
        ao[j * lightSize + i] = 1;
        continue;
      }
      let occl = 0;
      for (let d = 0; d < 8; d++) {
        const a = (d / 8) * Math.PI * 2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        let maxTan = 0;
        for (const t of dists) {
          const tan = (sample(x + dx * t, z + dz * t) - h0) / t;
          if (tan > maxTan) maxTan = tan;
        }
        occl += maxTan / Math.sqrt(1 + maxTan * maxTan);
      }
      ao[j * lightSize + i] = 1 - occl / 8;
    }
  }
}

function bakeLight(sun: [number, number, number]): Uint16Array {
  const out = new Uint16Array(lightSize * lightSize * 2);
  const flat = Math.hypot(sun[0], sun[2]);
  const dx = flat > 1e-4 ? sun[0] / flat : 0;
  const dz = flat > 1e-4 ? sun[2] / flat : 0;
  const tanSun = sun[1] / Math.max(flat, 1e-4);
  for (let j = 0; j < lightSize; j++) {
    const z = -extent + (j + 0.5) * lightCell;
    for (let i = 0; i < lightSize; i++) {
      const x = -extent + (i + 0.5) * lightCell;
      const h0 = sample(x, z) + 1.5;
      let vis = sun[1] > 0 ? 1 : 0;
      // March toward the sun; soft shadows from how closely the ray clears the terrain.
      for (let t = 8; vis > 0 && t < 4000; t *= 1.12) {
        const rayH = h0 + t * tanSun;
        if (rayH > maxHeight) break;
        const clearance = rayH - sample(x + dx * t, z + dz * t);
        vis = Math.min(vis, Math.max(0, (clearance * 6) / t + 0.2));
      }
      vis = Math.min(1, vis);
      const k = (j * lightSize + i) * 2;
      out[k] = DataUtils.toHalfFloat(ao[j * lightSize + i]);
      out[k + 1] = DataUtils.toHalfFloat(vis * vis * (3 - 2 * vis));
    }
  }
  return out;
}

self.onmessage = (e: MessageEvent<BakeRequest>) => {
  const msg = e.data;
  if (msg.type === 'heights') {
    size = msg.size;
    lightSize = msg.lightSize;
    extent = msg.extent;
    cell = (2 * extent) / size;
    lightCell = (2 * extent) / lightSize;
    bakeHeights(msg.options);
    const data = new Uint16Array(size * size);
    for (let i = 0; i < data.length; i++) data[i] = DataUtils.toHalfFloat(heights[i]);
    const res: BakeResponse = { type: 'heights', data, maxHeight };
    (self as unknown as Worker).postMessage(res, [data.buffer]);
  } else {
    const data = bakeLight(msg.sun);
    const res: BakeResponse = { type: 'light', data, id: msg.id };
    (self as unknown as Worker).postMessage(res, [data.buffer]);
  }
};
