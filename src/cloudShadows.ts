// Cloud shadows: a soft shadow map of every cloud's footprint, projected along the sun onto
// the ground, redrawn a few times a second as clouds drift. Terrain, water, vegetation and grass
// sample it (CLOUD_SHADOW_GLSL) and dim their direct light, so shadows sweep across the land.
import { CanvasTexture, LinearFilter } from 'three';

const SIZE = 256;
/** Half-size of the covered square (m), centered on the origin. */
export const CLOUD_SHADOW_EXTENT = 9000;

const canvas = document.createElement('canvas');
canvas.width = canvas.height = SIZE;
const ctx = canvas.getContext('2d')!;
const texture = new CanvasTexture(canvas);
texture.magFilter = LinearFilter;
texture.minFilter = LinearFilter;
texture.generateMipmaps = false;

export const cloudShadowUniforms = {
  cloudShadowMap: { value: texture },
  /** x: extent (m), y: strength (0..1). */
  cloudShadowParams: { value: new Float32Array([CLOUD_SHADOW_EXTENT, 0.45]) },
};

/** Declares `float cloudShade(vec2 xz)`: 1 in sunlight, lower under a cloud. */
export const CLOUD_SHADOW_GLSL = /* glsl */ `
uniform sampler2D cloudShadowMap;
uniform vec2 cloudShadowParams;
float cloudShade( vec2 xz ) {
  vec2 uv = xz / ( 2.0 * cloudShadowParams.x ) + 0.5;
  return 1.0 - texture2D( cloudShadowMap, vec2( uv.x, 1.0 - uv.y ) ).r * cloudShadowParams.y;
}
`;

export interface ShadowCaster {
  x: number;
  z: number;
  /** Height of the cloud's middle above sea level. */
  y: number;
  /** Footprint half-sizes (m) and rotation. */
  rx: number;
  rz: number;
  yaw: number;
}

/** Redraws the shadow map. sunDir must point toward the sun. */
export function drawCloudShadows(casters: ShadowCaster[], sunDir: { x: number; y: number; z: number }, strength: number): void {
  cloudShadowUniforms.cloudShadowParams.value[1] = strength;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  if (sunDir.y <= 0.05) {
    texture.needsUpdate = true;
    return; // no sun, no cloud shadows
  }
  ctx.globalCompositeOperation = 'lighter';
  const k = SIZE / (2 * CLOUD_SHADOW_EXTENT);
  const slant = 1 / Math.max(sunDir.y, 0.25);
  for (const c of casters) {
    // Follow the sun ray from the cloud down to sea level.
    const gx = c.x - sunDir.x * c.y * slant;
    const gz = c.z - sunDir.z * c.y * slant;
    const px = (gx + CLOUD_SHADOW_EXTENT) * k;
    const py = (gz + CLOUD_SHADOW_EXTENT) * k;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-c.yaw);
    ctx.scale(c.rx * k, c.rz * k);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  texture.needsUpdate = true;
}
