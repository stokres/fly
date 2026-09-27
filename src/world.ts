// Test world: an endless grid plane plus scattered pillars for speed and altitude cues,
// with fog and lights. Pillars repeat in small tiles around the player.
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { PALETTE, PROP_COLORS } from './palette';
import { seeded } from './random';
import { TileGrid } from './tiling';
import { tuning } from './tuning';

const GRID_CELL = 50; // meters per grid texture repeat
const GROUND_SIZE = 16000;
const PILLAR_TILE = 2000;
const Y_AXIS = new Vector3(0, 1, 0);

function gridTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const ground = new Color(PALETTE.ground);
  ctx.fillStyle = `#${ground.getHexString()}`;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = `#${ground.clone().multiplyScalar(0.93).getHexString()}`;
  ctx.fillRect(0, 0, size / 2, size / 2);
  ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
  ctx.strokeStyle = `#${new Color(PALETTE.groundDark).getHexString()}`;
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(GROUND_SIZE / GRID_CELL, GROUND_SIZE / GRID_CELL);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class World {
  readonly scene = new Scene();
  private readonly ground: Mesh;
  private readonly pillars = new Group();
  private readonly pillarTiles = new TileGrid(this.pillars, PILLAR_TILE);
  private readonly pillarGeo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  private readonly pillarMat = new MeshStandardMaterial({ flatShading: true });

  constructor() {
    const sky = new Color(PALETTE.sky);
    this.scene.background = sky;
    this.scene.fog = new FogExp2(sky, tuning.world.fogDensity);

    this.scene.add(new HemisphereLight(PALETTE.skyLight, 0x6b7a5a, 1.4));
    const sun = new DirectionalLight(PALETTE.sun, 2.2);
    sun.position.set(-300, 500, 200);
    this.scene.add(sun);

    this.ground = new Mesh(
      new PlaneGeometry(GROUND_SIZE, GROUND_SIZE).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({ map: gridTexture(), roughness: 1 }),
    );
    this.scene.add(this.ground);
    this.scene.add(this.pillars);
    this.buildPillars();
  }

  /** Rebuilds seeded content; call after seed or density changes. */
  buildPillars(): void {
    for (const child of this.pillars.children) (child as InstancedMesh).dispose();
    this.pillars.clear();
    this.pillarTiles.invalidate();

    const count = Math.round(tuning.world.pillarsPerTile);
    if (count === 0) return;
    const rand = seeded(tuning.world.seed, 'pillars');
    const source = new InstancedMesh(this.pillarGeo, this.pillarMat, count);
    const m = new Matrix4();
    const q = new Quaternion();
    const pos = new Vector3();
    const scale = new Vector3();
    const color = new Color();
    for (let i = 0; i < count; i++) {
      const tall = rand() < 0.15;
      const w = 6 + rand() * 18;
      const h = tall ? 80 + rand() * 160 : 8 + rand() * 50;
      pos.set((rand() - 0.5) * PILLAR_TILE, 0, (rand() - 0.5) * PILLAR_TILE);
      q.setFromAxisAngle(Y_AXIS, rand() * Math.PI);
      scale.set(w, h, w * (0.6 + rand() * 0.8));
      source.setMatrixAt(i, m.compose(pos, q, scale));
      source.setColorAt(i, color.setHex(PROP_COLORS[Math.floor(rand() * PROP_COLORS.length)]));
    }

    // 3x3 tiles sharing the same instance data.
    for (let i = 0; i < 9; i++) {
      const mesh = i === 0 ? source : new InstancedMesh(this.pillarGeo, this.pillarMat, count);
      mesh.instanceMatrix = source.instanceMatrix;
      mesh.instanceColor = source.instanceColor;
      mesh.computeBoundingSphere();
      this.pillars.add(mesh);
    }
  }

  setFogDensity(density: number): void {
    (this.scene.fog as FogExp2).density = density;
  }

  update(player: Vector3): void {
    // Ground follows the player in whole grid cells, so its pattern stays fixed in world space.
    this.ground.position.set(
      Math.round(player.x / GRID_CELL) * GRID_CELL,
      0,
      Math.round(player.z / GRID_CELL) * GRID_CELL,
    );
    this.pillarTiles.update(player);
  }
}
