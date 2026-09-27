// Bootstrap and game loop. Flight runs on a fixed timestep; rendering interpolates between steps.
import { ACESFilmicToneMapping, Vector3, WebGLRenderer } from 'three';
import { FollowCamera } from './camera';
import { Creature } from './creature';
import { Flight, type FlightEnvironment, type FlightPose } from './flight';
import { Heightfield } from './heightfield';
import { Input } from './input';
import { Landmarks } from './landmarks';
import { Terrain } from './terrain';
import { Thermals } from './thermals';
import { createTuningPanel, onTuningChange, tuning } from './tuning';
import { World } from './world';

const FIXED_DT = 1 / 120;
const MAX_FRAME = 0.1; // clamp long frames (tab switch, breakpoint) to avoid a spiral
const TERRAIN_BUDGET_MS = 3; // mesh building per frame once running

const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const makeHeightfield = () =>
  new Heightfield({ seed: tuning.world.seed, detail: tuning.terrain.detail, fillerIslets: tuning.terrain.fillerIslets });

let heightfield = makeHeightfield();
const world = new World();
const terrain = new Terrain(heightfield);
const landmarks = new Landmarks(heightfield);
const thermals = new Thermals();
thermals.rebuild(heightfield);
const flight = new Flight();
const creature = new Creature();
const follow = new FollowCamera(window.innerWidth / window.innerHeight);
const input = new Input();
world.scene.add(terrain.group, landmarks.mesh, thermals.group, creature.object);

/** Terrain or sea surface, whichever is higher. */
const groundAt = (x: number, z: number) => Math.max(0, heightfield.surface(x, z));

const readouts = { speed: 0, altitude: 0, aboveGround: 0, lift: 0, sink: 0, energy: 0, fps: 0, cpuMs: 0 };
const gui = createTuningPanel(readouts);
let guiVisible = true;

// Values read every frame need nothing here; these need a rebuild or a push into a material.
onTuningChange((group, key) => {
  if (group === 'world' && key === 'fogDensity') world.setFogDensity(tuning.world.fogDensity);
  if (group === 'world' && key === 'waterOpacity') world.setWaterOpacity(tuning.world.waterOpacity);
  if (group === 'landmarks' && key === 'fogScale') landmarks.setFogScale(tuning.landmarks.fogScale);

  const reshape =
    (group === 'world' && key === 'seed') || (group === 'terrain' && ['detail', 'fillerIslets'].includes(key));
  if (reshape) {
    heightfield = makeHeightfield();
    terrain.setHeightfield(heightfield);
    landmarks.rebuild(heightfield);
  }
  const live = ['liftScale', 'moteSize', 'birdSize', 'columnOpacity'];
  if (reshape || (group === 'thermals' && !live.includes(key))) thermals.rebuild(heightfield);
});

const pose: FlightPose = { position: new Vector3(), yaw: 0, pitch: 0, bank: 0 };
const velocity = new Vector3();
const env: FlightEnvironment = { updraft: 0, ground: 0, groundSlopeX: 0, groundSlopeZ: 0 };

/** Optional start override from the URL: `#x,y,z,headingDeg` (heading 0 = north, 90 = east). */
function startOverride(): { x: number; y: number; z: number; yaw: number } | null {
  const parts = location.hash.slice(1).split(',').map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[1], z: parts[2], yaw: (-(parts[3] ?? 0) * Math.PI) / 180 };
}

function reset(): void {
  flight.reset(startOverride() ?? undefined);
  flight.interpolate(1, pose);
  follow.snap(pose, flight.velocity(velocity), flight.speed);
  // Build everything in view right away, so the world doesn't pop in around the start.
  terrain.update(flight.position, Infinity);
}
reset();

window.addEventListener('hashchange', reset);
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
    env.updraft = thermals.liftAt(flight.position);
    const { x, z } = flight.position;
    env.ground = groundAt(x, z);
    env.groundSlopeX = (groundAt(x + 2, z) - groundAt(x - 2, z)) / 4;
    env.groundSlopeZ = (groundAt(x, z + 2) - groundAt(x, z - 2)) / 4;
    flight.step(FIXED_DT, intent, env);
    accumulator -= FIXED_DT;
  }
  flight.interpolate(accumulator / FIXED_DT, pose);
  flight.velocity(velocity);

  creature.update(dt, pose, flight.flapCount);
  follow.update(dt, pose, velocity, flight.speed, groundAt);
  world.update(pose.position);
  terrain.update(pose.position, TERRAIN_BUDGET_MS);
  thermals.update(dt);
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
  readouts.aboveGround = round(flight.position.y - env.ground, 1);
  readouts.lift = round(flight.updraft, 2);
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
