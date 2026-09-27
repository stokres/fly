// Bootstrap and game loop. Flight runs on a fixed timestep; rendering interpolates between steps.
import { ACESFilmicToneMapping, Vector3, WebGLRenderer } from 'three';
import { FollowCamera } from './camera';
import { Creature } from './creature';
import { Flight, type FlightPose } from './flight';
import { Input } from './input';
import { createTuningPanel, onTuningChange, tuning } from './tuning';
import { World } from './world';

const FIXED_DT = 1 / 120;
const MAX_FRAME = 0.1; // clamp long frames (tab switch, breakpoint) to avoid a spiral

const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const world = new World();
const flight = new Flight();
const creature = new Creature();
const follow = new FollowCamera(window.innerWidth / window.innerHeight);
const input = new Input();
world.scene.add(creature.object);

const readouts = { speed: 0, altitude: 0, sink: 0, energy: 0, fps: 0, cpuMs: 0 };
const gui = createTuningPanel(readouts);
let guiVisible = true;

onTuningChange((group, key) => {
  if (group === 'world' && (key === 'seed' || key === 'pillarsPerTile')) world.buildPillars();
  if (group === 'world' && key === 'fogDensity') world.setFogDensity(tuning.world.fogDensity);
});

const pose: FlightPose = { position: new Vector3(), yaw: 0, pitch: 0, bank: 0 };
const velocity = new Vector3();

function reset(): void {
  flight.reset();
  flight.interpolate(1, pose);
  follow.snap(pose, flight.velocity(velocity), flight.speed);
}
reset();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  follow.setAspect(window.innerWidth / window.innerHeight);
});

let accumulator = 0;
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;

function frame(now: number): void {
  const frameStart = performance.now();
  const dt = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;

  if (input.wasPressed('KeyR')) reset();
  if (input.wasPressed('KeyG')) {
    guiVisible = !guiVisible;
    gui.show(guiVisible);
  }

  const intent = input.read();
  accumulator += dt;
  while (accumulator >= FIXED_DT) {
    flight.step(FIXED_DT, intent);
    accumulator -= FIXED_DT;
  }
  flight.interpolate(accumulator / FIXED_DT, pose);
  flight.velocity(velocity);

  creature.update(dt, pose, flight.flapCount);
  follow.update(dt, pose, velocity, flight.speed);
  world.update(pose.position);
  renderer.render(world.scene, follow.camera);
  input.endFrame();

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    readouts.fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }
  readouts.speed = round(flight.speed, 1);
  readouts.altitude = round(flight.position.y, 1);
  readouts.sink = round(flight.sink - flight.climb, 2);
  readouts.energy = round(flight.energy, 2);
  readouts.cpuMs = round(performance.now() - frameStart, 2);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
