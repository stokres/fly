// Two long ribbon streamers trailing from the tail. They are simulated in world space as
// follow-the-leader chains, so they lag through turns and stream out in a dive: a cheap,
// always-visible read of the creature's motion.
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Vector3,
} from 'three';
import { PALETTE } from './palette';
import { tuning } from './tuning';

const SEGMENTS = 16;
/** Anchor points on the tail, in tail-local space. */
const ANCHORS = [new Vector3(0.07, 0, 0.3), new Vector3(-0.07, 0, 0.3)];

export class Streamers {
  readonly mesh: Mesh;
  private readonly chains: Vector3[][] = ANCHORS.map(() => Array.from({ length: SEGMENTS + 1 }, () => new Vector3()));
  private readonly geometry = new BufferGeometry();
  private initialized = false;
  private time = 0;

  // Scratch.
  private readonly root = new Vector3();
  private readonly dir = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly back = new Vector3();
  private readonly p = new Vector3();

  constructor() {
    const verts = ANCHORS.length * (SEGMENTS + 1) * 2;
    const position = new BufferAttribute(new Float32Array(verts * 3), 3).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', position);
    this.geometry.setAttribute('normal', new BufferAttribute(new Float32Array(verts * 3), 3).setUsage(DynamicDrawUsage));
    const index: number[] = [];
    for (let c = 0; c < ANCHORS.length; c++) {
      const base = c * (SEGMENTS + 1) * 2;
      for (let i = 0; i < SEGMENTS; i++) {
        const a = base + i * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    this.geometry.setIndex(index);
    this.mesh = new Mesh(
      this.geometry,
      // A little self-light keeps the ribbons from going black when seen from below or edge-on.
      new MeshStandardMaterial({
        color: PALETTE.ember,
        emissive: PALETTE.ember,
        emissiveIntensity: 0.35,
        side: DoubleSide,
        roughness: 0.7,
      }),
    );
    this.mesh.frustumCulled = false; // vertices are rewritten every frame in world space
  }

  update(dt: number, tail: Object3D): void {
    const c = tuning.creature;
    this.time += dt;
    const seg = c.streamerLength / SEGMENTS;
    tail.matrixWorld.extractBasis(this.right, this.up, this.back);
    this.right.normalize();
    this.up.normalize();
    this.back.normalize();

    const pos = this.geometry.attributes.position as BufferAttribute;
    this.chains.forEach((chain, ci) => {
      this.root.copy(ANCHORS[ci]).applyMatrix4(tail.matrixWorld);
      // Start straight behind the tail on the first frame or after a teleport (reset, URL jump).
      if (!this.initialized || chain[0].distanceTo(this.root) > 30) {
        chain.forEach((p, i) => p.copy(this.root).addScaledVector(this.back, i * seg));
      }
      chain[0].copy(this.root);
      for (let i = 1; i <= SEGMENTS; i++) {
        // Sag a little, then pull each point to one segment length behind its leader.
        chain[i].y -= c.streamerSag * dt;
        this.dir.subVectors(chain[i], chain[i - 1]);
        const len = this.dir.length();
        if (len < 1e-6) this.dir.copy(this.back);
        else this.dir.divideScalar(len);
        chain[i].copy(chain[i - 1]).addScaledVector(this.dir, seg);
      }

      // Ribbon vertices: tapering width, plus a travelling wave that is display-only.
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        const wave = Math.sin(this.time * 9 - i * 0.8 + ci * 1.3) * c.streamerWave * t;
        this.p.copy(chain[i]).addScaledVector(this.up, wave);
        const w = c.streamerWidth * 0.5 * Math.pow(1 - t, 0.6);
        const v = (ci * (SEGMENTS + 1) + i) * 2;
        pos.setXYZ(v, this.p.x + this.right.x * w, this.p.y + this.right.y * w, this.p.z + this.right.z * w);
        pos.setXYZ(v + 1, this.p.x - this.right.x * w, this.p.y - this.right.y * w, this.p.z - this.right.z * w);
      }
    });
    this.initialized = true;
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
