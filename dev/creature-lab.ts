// Dev-only page (npm run dev, then /dev/creature.html): the creature on its own, orbitable,
// with its drive inputs on sliders. The bird flies forward at `speed` and the view follows,
// so the streamers behave as in flight. Creature tunables are in the main tuning panel groups.
import GUI from 'lil-gui';
import { ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Creature, type CreatureDrive } from '../src/creature';
import type { FlightPose } from '../src/flight';
import { PALETTE } from '../src/palette';

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(PALETTE.sky);
scene.add(new HemisphereLight(PALETTE.skyLight, 0x6b7a5a, 1.4));
const sun = new DirectionalLight(PALETTE.sun, 2.2);
sun.position.set(-300, 500, 200);
scene.add(sun);

const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 1000);
const view = new URLSearchParams(location.search).get('view') ?? '-4,2,5';
camera.position.fromArray(view.split(',').map(Number));
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);

const creature = new Creature();
scene.add(creature.object);

const pose: FlightPose = { position: new Vector3(), yaw: 0, pitch: 0, bank: 0 };
const drive: CreatureDrive = { speed: 20, pitchInput: 0, rollInput: 0, flapCount: 0 };
const params = { speed: 20, pitchInput: 0, rollInput: 0, bankDeg: 0, pitchDeg: 0, autoFlap: false, flap: () => drive.flapCount++ };
for (const [key, value] of new URLSearchParams(location.search)) if (key in params && key !== 'flap') (params as Record<string, unknown>)[key] = key === 'autoFlap' ? value === '1' : Number(value);

const gui = new GUI({ title: 'Creature lab' });
gui.add(params, 'speed', 0, 80, 0.5);
gui.add(params, 'pitchInput', -1, 1, 0.01);
gui.add(params, 'rollInput', -1, 1, 0.01);
gui.add(params, 'bankDeg', -60, 60, 1);
gui.add(params, 'pitchDeg', -70, 70, 1);
gui.add(params, 'autoFlap');
gui.add(params, 'flap');

const delta = new Vector3();
let last = performance.now();
let flapTimer = 0;
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  drive.speed = params.speed;
  drive.pitchInput = params.pitchInput;
  drive.rollInput = params.rollInput;
  pose.bank = (params.bankDeg * Math.PI) / 180;
  pose.pitch = (params.pitchDeg * Math.PI) / 180;
  if (params.autoFlap && (flapTimer -= dt) <= 0) {
    drive.flapCount++;
    flapTimer = 0.5;
  }
  // Fly forward along the heading and carry the view along.
  delta.set(0, Math.sin(pose.pitch), -Math.cos(pose.pitch)).multiplyScalar(params.speed * dt);
  pose.position.add(delta);
  camera.position.add(delta);
  controls.target.copy(pose.position);
  controls.update();
  creature.update(dt, pose, drive);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
