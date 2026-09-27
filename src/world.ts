// Scene, light, fog and the ocean. The ocean surface and the sea floor beneath it follow the
// player, so the sea never ends; terrain.ts draws only where there is land.
import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  type Vector3,
} from 'three';
import type { AtmosphereState } from './atmosphere';
import { SEA_FLOOR } from './map';
import { PALETTE } from './palette';
import { tuning } from './tuning';

const OCEAN_SIZE = 16000;
/** The ocean planes move in steps of this size, so any future surface pattern stays fixed in the world. */
const OCEAN_SNAP = 100;
const SEA_FLOOR_PLANE = SEA_FLOOR - 4;

export class World {
  readonly scene = new Scene();
  private readonly ocean: Mesh;
  private readonly seaFloor: Mesh;
  private readonly oceanMaterial: MeshStandardMaterial;
  private readonly ambient = new HemisphereLight();
  private readonly key = new DirectionalLight();
  private readonly fog: FogExp2;

  constructor() {
    this.fog = new FogExp2(new Color(PALETTE.sky), tuning.world.fogDensity);
    this.scene.fog = this.fog;
    this.scene.background = new Color(PALETTE.sky); // hidden behind the sky dome
    this.scene.add(this.ambient, this.key, this.key.target);

    const plane = new PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE).rotateX(-Math.PI / 2);
    // Semi-transparent, so shallows over sand read lighter than deep water.
    this.oceanMaterial = new MeshStandardMaterial({
      color: PALETTE.sea,
      roughness: 0.35,
      transparent: true,
      opacity: tuning.world.waterOpacity,
      depthWrite: false,
    });
    this.ocean = new Mesh(plane, this.oceanMaterial);
    this.ocean.renderOrder = 1;
    this.seaFloor = new Mesh(plane, new MeshStandardMaterial({ color: PALETTE.seaDeep, roughness: 1 }));
    // Well below the terrain chunks' own sea floor, so the two never z-fight at a distance.
    this.seaFloor.position.y = SEA_FLOOR_PLANE;
    this.scene.add(this.ocean, this.seaFloor);
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
    this.key.position.copy(this.key.target.position).addScaledVector(state.lightDir, 1000);
    this.fog.color.copy(state.horizon).lerp(cloudColor, inCloud);
    this.fog.density = tuning.world.fogDensity + (tuning.clouds.insideFogDensity - tuning.world.fogDensity) * inCloud;
  }

  setWaterOpacity(opacity: number): void {
    this.oceanMaterial.opacity = opacity;
  }

  update(player: Vector3): void {
    const x = Math.round(player.x / OCEAN_SNAP) * OCEAN_SNAP;
    const z = Math.round(player.z / OCEAN_SNAP) * OCEAN_SNAP;
    this.ocean.position.set(x, 0, z);
    this.seaFloor.position.set(x, SEA_FLOOR_PLANE, z);
    this.key.target.position.set(x, 0, z);
  }
}
