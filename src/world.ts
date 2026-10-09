// Scene, lights and fog. The key light casts real-time shadows in a box that follows the player
// (trees, buildings, the creature); mountain-scale shadows are baked (terrainMaps.ts).
import { Color, DirectionalLight, FogExp2, HemisphereLight, Matrix4, Scene, Vector3 } from 'three';
import type { AtmosphereState } from './atmosphere';
import { PALETTE } from './palette';
import { tuning } from './tuning';

const SHADOW_RANGE = 260; // half-size of the shadow box (m)
const SHADOW_MAP = 2048;
const ORIGIN = new Vector3();
const UP = new Vector3(0, 1, 0);
const NORTH = new Vector3(0, 0, 1);

export class World {
  readonly scene = new Scene();
  private readonly ambient = new HemisphereLight();
  readonly key = new DirectionalLight();
  private readonly fog: FogExp2;
  private readonly lightBasis = new Matrix4();
  private readonly lightBasisInv = new Matrix4();
  private readonly snapped = new Vector3();

  constructor() {
    this.fog = new FogExp2(new Color(PALETTE.sky), tuning.world.fogDensity);
    this.scene.fog = this.fog;
    this.scene.background = new Color(PALETTE.sky); // hidden behind the sky dome

    const k = this.key;
    k.castShadow = true;
    k.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    k.shadow.camera.left = -SHADOW_RANGE;
    k.shadow.camera.right = SHADOW_RANGE;
    k.shadow.camera.top = SHADOW_RANGE;
    k.shadow.camera.bottom = -SHADOW_RANGE;
    k.shadow.camera.near = 10;
    k.shadow.camera.far = 2400;
    k.shadow.bias = -0.0004;
    k.shadow.normalBias = 0.6;
    k.shadow.radius = 3;
    this.scene.add(this.ambient, k, k.target);
  }

  /**
   * Lights and fog from the time of day. `inCloud` (0..1) closes the fog in to the cloud
   * color while the camera is inside a cloud.
   */
  applyAtmosphere(state: AtmosphereState, inCloud: number, cloudColor: Color): void {
    this.ambient.color.copy(state.ambientSky);
    this.ambient.groundColor.copy(state.ambientGround);
    this.ambient.intensity = state.ambientIntensity;
    this.key.color.copy(state.light);
    this.key.intensity = state.lightIntensity;
    this.fog.color.copy(state.horizon).lerp(cloudColor, inCloud);
    this.fog.density = tuning.world.fogDensity + (tuning.clouds.insideFogDensity - tuning.world.fogDensity) * inCloud;
  }

  /** Centers the shadow box on the player, snapped to shadow texels so shadows don't crawl. */
  update(player: Vector3, lightDir: Vector3): void {
    const texel = (2 * SHADOW_RANGE) / SHADOW_MAP;
    // Quantize the player's position in the light's own frame.
    this.lightBasis.lookAt(lightDir, ORIGIN, Math.abs(lightDir.y) > 0.99 ? NORTH : UP);
    this.lightBasisInv.copy(this.lightBasis).transpose(); // pure rotation
    this.snapped.copy(player).applyMatrix4(this.lightBasisInv);
    this.snapped.x = Math.round(this.snapped.x / texel) * texel;
    this.snapped.y = Math.round(this.snapped.y / texel) * texel;
    this.snapped.applyMatrix4(this.lightBasis);
    this.key.target.position.copy(this.snapped);
    this.key.position.copy(this.snapped).addScaledVector(lightDir, 1200);
    this.key.target.updateMatrixWorld();
  }
}
