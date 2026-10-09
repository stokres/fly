// Baked world maps over the whole archipelago, shared by the terrain, water and grass shaders:
//  terrainHeightMap: height (R), for water depth, shore foam and color
//  terrainLightMap:  ambient occlusion (R) and sun visibility (G), for soft mountain shadows
// Baking runs in a worker (terrainBake.worker.ts). Until the first bake lands, the maps hold
// neutral values (deep water, no shadow) and `terrainMapsReady` fades the effect in.
import { DataTexture, HalfFloatType, LinearFilter, RedFormat, RGFormat, Vector3 } from 'three';
import type { HeightfieldOptions } from './heightfield';
import { WORLD_HALF_SIZE } from './map';
import type { BakeRequest, BakeResponse } from './terrainBake.worker';

export const MAP_SIZE = 1024;
export const LIGHT_MAP_SIZE = 512;
/** Half-size of the baked square (m). Beyond it everything reads as open sea. */
export const MAP_EXTENT = WORLD_HALF_SIZE + 600;

function halfTexture(size: number, channels: 1 | 2, fill: number): DataTexture {
  const data = new Uint16Array(size * size * channels).fill(fill);
  const tex = new DataTexture(data, size, size, channels === 1 ? RedFormat : RGFormat, HalfFloatType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const HALF_ONE = 0x3c00;
const HALF_MINUS_100 = 0xd640;

export class TerrainMaps {
  readonly uniforms = {
    terrainHeightMap: { value: halfTexture(MAP_SIZE, 1, HALF_MINUS_100) },
    terrainLightMap: { value: halfTexture(LIGHT_MAP_SIZE, 2, HALF_ONE) },
    terrainMapExtent: { value: MAP_EXTENT },
    /** 0 until the maps are baked, then eases to 1. */
    terrainMapsReady: { value: 0 },
  };
  private worker: Worker;
  private bakedSun = new Vector3(0, -1, 0);
  private readonly currentSun = new Vector3(0, 1, 0);
  private busy = false;
  private heightsReady = false;
  private requestId = 0;
  private pendingSun: Vector3 | null = null;

  constructor(options: HeightfieldOptions) {
    this.worker = new Worker(new URL('./terrainBake.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<BakeResponse>) => this.receive(e.data);
    this.rebake(options);
  }

  /** Re-bakes everything for a new heightfield (seed or shape changes). */
  rebake(options: HeightfieldOptions): void {
    this.heightsReady = false;
    this.busy = true;
    const req: BakeRequest = { type: 'heights', options, size: MAP_SIZE, lightSize: LIGHT_MAP_SIZE, extent: MAP_EXTENT };
    this.worker.postMessage(req);
  }

  /** Re-bakes sun shadows when the sun has moved more than ~1.5° since the last bake. */
  update(dt: number, sunDir: Vector3): void {
    const u = this.uniforms.terrainMapsReady;
    if (this.heightsReady && u.value < 1) u.value = Math.min(1, u.value + dt * 0.8);
    this.currentSun.copy(sunDir);
    if (sunDir.angleTo(this.bakedSun) > 0.026) {
      this.pendingSun = sunDir.clone();
      this.flush();
    }
  }

  private flush(): void {
    if (this.busy || !this.heightsReady || !this.pendingSun) return;
    this.busy = true;
    this.bakedSun.copy(this.pendingSun);
    this.pendingSun = null;
    const s = this.bakedSun;
    const req: BakeRequest = { type: 'light', sun: [s.x, s.y, s.z], id: ++this.requestId };
    this.worker.postMessage(req);
  }

  private receive(msg: BakeResponse): void {
    this.busy = false;
    if (msg.type === 'heights') {
      const tex = this.uniforms.terrainHeightMap.value;
      tex.image.data = msg.data;
      tex.needsUpdate = true;
      this.heightsReady = true;
      // Light depends on the heights: bake it now for the current sun.
      this.pendingSun = this.currentSun.clone();
    } else {
      const tex = this.uniforms.terrainLightMap.value;
      tex.image.data = msg.data;
      tex.needsUpdate = true;
    }
    this.flush();
  }
}
