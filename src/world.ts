// Milestone-1 world: an endless grid plane plus scattered pillars for speed and altitude cues.
// Both are tiled around the player so the flat test world never runs out.
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
import { tuning } from './tuning';

const SKY = new Color(0x9fb8c8);
const GRID_CELL = 50; // meters per grid texture repeat
const GROUND_SIZE = 16000;
const TILE = 2000; // pillar tile size
const Y_AXIS = new Vector3(0, 1, 0);
const PALETTE = [0xd9c9a3, 0xc98f6b, 0x8fa5a0, 0xe8dcc4, 0xa7b89a];

/** Small deterministic PRNG (mulberry32), so a seed always rebuilds the same world. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gridTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#7f9a78';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#76906f';
  ctx.fillRect(0, 0, size / 2, size / 2);
  ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
  ctx.strokeStyle = '#5f7a5a';
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
  private readonly pillarGeo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  private readonly pillarMat = new MeshStandardMaterial({ flatShading: true });
  private tileX = NaN;
  private tileZ = NaN;

  constructor() {
    this.scene.background = SKY;
    this.scene.fog = new FogExp2(SKY, tuning.world.fogDensity);

    this.scene.add(new HemisphereLight(0xdfeeff, 0x6b7a5a, 1.4));
    const sun = new DirectionalLight(0xfff1dc, 2.2);
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

    const count = Math.round(tuning.world.pillarsPerTile);
    if (count === 0) return;
    const rand = mulberry32(tuning.world.seed);
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
      pos.set((rand() - 0.5) * TILE, 0, (rand() - 0.5) * TILE);
      q.setFromAxisAngle(Y_AXIS, rand() * Math.PI);
      scale.set(w, h, w * (0.6 + rand() * 0.8));
      source.setMatrixAt(i, m.compose(pos, q, scale));
      source.setColorAt(i, color.setHex(PALETTE[Math.floor(rand() * PALETTE.length)]));
    }

    // 3x3 tiles sharing the same instance data; recentered as the player moves.
    for (let i = 0; i < 9; i++) {
      const mesh = i === 0 ? source : new InstancedMesh(this.pillarGeo, this.pillarMat, count);
      mesh.instanceMatrix = source.instanceMatrix;
      mesh.instanceColor = source.instanceColor;
      mesh.computeBoundingSphere();
      this.pillars.add(mesh);
    }
    this.tileX = this.tileZ = NaN;
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

    const tx = Math.round(player.x / TILE);
    const tz = Math.round(player.z / TILE);
    if (tx === this.tileX && tz === this.tileZ) return;
    this.tileX = tx;
    this.tileZ = tz;
    this.pillars.children.forEach((mesh, i) => {
      mesh.position.set((tx + (i % 3) - 1) * TILE, 0, (tz + Math.floor(i / 3) - 1) * TILE);
    });
  }
}
