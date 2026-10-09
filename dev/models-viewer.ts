// Dev-only page (npm run dev, then /dev/models.html?file=vegetation.glb&lod=0): every mesh of a
// model file in a row, lit like the game, with an orbit camera. URL: file, lod, filter, view.
import '../src/shading';
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadGeometries } from '../src/models';

const params = new URLSearchParams(location.search);
const file = params.get('file') ?? 'vegetation.glb';
const lod = params.get('lod') ?? '0';
const filter = params.get('filter') ?? '';

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x8fc4ea);
scene.add(new HemisphereLight(0x8cb6f0, 0x5a7a48, 1.15));
const sun = new DirectionalLight(0xffe2b4, 3.0);
sun.position.set(-40, 60, 30);
sun.castShadow = true;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.4;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 300 });
scene.add(sun);
const ground = new Mesh(new PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new MeshLambertMaterial({ color: 0x6cb848 }));
ground.receiveShadow = true;
scene.add(ground);

const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 30000);
camera.position.fromArray((params.get('view') ?? '0,18,55').split(',').map(Number));
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.fromArray((params.get('target') ?? '0,6,0').split(',').map(Number));
controls.update();

const material = new MeshLambertMaterial({ vertexColors: true });
loadGeometries(file).then((set) => {
  const names = [...set.keys()].filter((n) => (lod === 'all' || n.endsWith(`_lod${lod}`)) && n.includes(filter)).sort();
  let x = 0;
  const items = names.map((n) => {
    const g = set.get(n)!;
    g.computeBoundingBox();
    const w = g.boundingBox!.max.x - g.boundingBox!.min.x;
    return { n, g, w };
  });
  const total = items.reduce((s, i) => s + i.w + 4, 0);
  x = -total / 2;
  for (const { g, w } of items) {
    const m = new Mesh(g, material);
    m.position.x = x + w / 2 - g.boundingBox!.min.x - w / 2;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    x += w + 4;
  }
  console.log('models', names.join(', '), 'tris', items.map((i) => (i.g.index ? i.g.index.count : i.g.attributes.position.count) / 3).join(','));
});

function frame(): void {
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
