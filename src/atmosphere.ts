// Time of day: sun position and every sky, fog and light color, blended from SKY_KEYS.
// Other systems read the resulting state; nothing here touches the scene directly.
import { Color, MathUtils, Vector3 } from 'three';
import { fogUniforms } from './fog';
import { SKY_KEYS } from './palette';
import { tuning } from './tuning';

export interface AtmosphereState {
  /** Unit vector toward the sun. Below the horizon at night. */
  sunDir: Vector3;
  /** Unit vector toward the key light: the sun by day, the moon (opposite the sun) by night. */
  lightDir: Vector3;
  zenith: Color;
  horizon: Color;
  sun: Color;
  light: Color;
  lightIntensity: number;
  ambientSky: Color;
  ambientGround: Color;
  ambientIntensity: number;
  /** 0 by day, 1 in full night: used to fade in the moon. */
  night: number;
}

const KEYS = SKY_KEYS.map((k) => ({
  elevation: k.elevation,
  zenith: new Color(k.zenith),
  horizon: new Color(k.horizon),
  sun: new Color(k.sun),
  light: new Color(k.light),
  lightIntensity: k.lightIntensity,
  ambientSky: new Color(k.ambientSky),
  ambientGround: new Color(k.ambientGround),
  ambientIntensity: k.ambientIntensity,
}));

export class Atmosphere {
  readonly state: AtmosphereState = {
    sunDir: new Vector3(),
    lightDir: new Vector3(),
    zenith: new Color(),
    horizon: new Color(),
    sun: new Color(),
    light: new Color(),
    lightIntensity: 1,
    ambientSky: new Color(),
    ambientGround: new Color(),
    ambientIntensity: 1,
    night: 0,
  };

  update(dt: number): void {
    const a = tuning.atmosphere;
    // Advance the clock when the cycle is on; the slider then shows the live time.
    if (a.dayCycleMinutes > 0) a.timeOfDay = (a.timeOfDay + (24 * dt) / (a.dayCycleMinutes * 60)) % 24;

    // Sun rises in the east (+X), peaks in the south (+Z) at noon, sets in the west.
    const h = ((a.timeOfDay - 6) / 12) * Math.PI;
    const maxElev = a.sunMaxElevationDeg * MathUtils.DEG2RAD;
    const s = this.state;
    s.sunDir.set(Math.cos(h), Math.sin(h) * Math.sin(maxElev), Math.sin(h) * Math.cos(maxElev)).normalize();
    const e = s.sunDir.y;
    s.night = 1 - MathUtils.smoothstep(e, -0.25, -0.05);
    s.lightDir.copy(s.sunDir);
    if (e < -0.05) s.lightDir.negate(); // moonlight
    s.lightDir.y = Math.max(s.lightDir.y, 0.15); // keep the key light from skimming flat
    s.lightDir.normalize();

    // Blend the two keys around the current elevation.
    let i = 0;
    while (i < KEYS.length - 2 && e > KEYS[i + 1].elevation) i++;
    const k0 = KEYS[i];
    const k1 = KEYS[i + 1];
    const t = MathUtils.clamp((e - k0.elevation) / (k1.elevation - k0.elevation), 0, 1);
    s.zenith.lerpColors(k0.zenith, k1.zenith, t);
    s.horizon.lerpColors(k0.horizon, k1.horizon, t);
    s.sun.lerpColors(k0.sun, k1.sun, t);
    s.light.lerpColors(k0.light, k1.light, t);
    s.lightIntensity = MathUtils.lerp(k0.lightIntensity, k1.lightIntensity, t);
    s.ambientSky.lerpColors(k0.ambientSky, k1.ambientSky, t);
    s.ambientGround.lerpColors(k0.ambientGround, k1.ambientGround, t);
    s.ambientIntensity = MathUtils.lerp(k0.ambientIntensity, k1.ambientIntensity, t);

    s.sun.toArray(fogUniforms.fogSunColor.value);
    s.sunDir.toArray(fogUniforms.fogSunDir.value);
    fogUniforms.fogParams.value[0] = a.sunGlowAmount;
    fogUniforms.fogParams.value[1] = a.sunGlowPower;
    fogUniforms.fogParams.value[2] = a.fogHeightScale;
  }
}
