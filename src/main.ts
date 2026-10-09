// Bootstrap and game loop. Flight runs on a fixed timestep; rendering interpolates between steps.
import { fogUniforms } from './fog'; // also patches three's fog shaders: must load before anything renders
import { shadingUniforms } from './shading'; // patches three's Lambert lighting: same rule
import { ACESFilmicToneMapping, Color, Object3D, PCFShadowMap, Vector3, WebGLRenderer } from 'three';
import { Atmosphere } from './atmosphere';
import { type AudioInput, GameAudio } from './audio';
import { FollowCamera } from './camera';
import { Clouds } from './clouds';
import { Currents } from './currents';
import { Creature, type CreatureDrive } from './creature';
import { Flight, type FlightEnvironment, type FlightPose } from './flight';
import { Heightfield } from './heightfield';
import { Input } from './input';
import { Obstacles } from './obstacles';
import { clearingsOf, computePlacements } from './places';
import { Props } from './props';
import { Sky } from './sky';
import { Post } from './post';
import { SpeedFx } from './speedfx';
import { Terrain } from './terrain';
import { TerrainMaps } from './terrainMaps';
import { Thermals } from './thermals';
import { createTuningPanel, onTuningChange, tuning } from './tuning';
import { Grass } from './grass';
import { Vegetation } from './vegetation';
import { Water } from './water';
import { World } from './world';

const FIXED_DT = 1 / 120;
const MAX_FRAME = 0.1; // clamp long frames (tab switch, breakpoint) to avoid a spiral
const TERRAIN_BUDGET_MS = 3; // mesh building per frame once running

// Post-processing does the antialiasing (MSAA target), so the canvas itself doesn't need it.
const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const pixelRatio = () => Math.min(window.devicePixelRatio, tuning.post.pixelRatioMax);
renderer.setPixelRatio(pixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap; // soft with shadow.radius (PCFSoft is deprecated in r184)
document.body.appendChild(renderer.domElement);

const heightfieldOptions = () => ({
  seed: tuning.world.seed,
  detail: tuning.terrain.detail,
  fillerIslets: tuning.terrain.fillerIslets,
});

let heightfield = new Heightfield(heightfieldOptions());
const maps = new TerrainMaps(heightfieldOptions());
const world = new World();
const terrain = new Terrain(heightfield, maps);
const water = new Water(maps);
const placements = computePlacements(heightfield, tuning.world.seed);
const props = new Props(placements, maps);
const obstacles = new Obstacles(placements);
const vegetation = new Vegetation(heightfield, maps, clearingsOf(placements));
const grass = new Grass(heightfield, maps);
const thermals = new Thermals();
thermals.rebuild(heightfield);
const flight = new Flight();
const creature = new Creature();
const follow = new FollowCamera(window.innerWidth / window.innerHeight);
const input = new Input(renderer.domElement);
const currents = new Currents(heightfield);
const speedFx = new SpeedFx();
const atmosphere = new Atmosphere();
const sky = new Sky();
const clouds = new Clouds();
world.scene.add(grass.mesh, vegetation.group, sky.mesh, water.mesh, terrain.group, props.group, thermals.group, creature.object, clouds.group, currents.mesh, speedFx.lines, speedFx.particles);
const castShadows = (o: Object3D) => o.traverse((c) => (c.castShadow = c.receiveShadow = true));
castShadows(creature.object);
const post = new Post(renderer, world.scene, follow.camera);
post.setSize(window.innerWidth, window.innerHeight, pixelRatio());
let inCloud = 0;
const audio = new GameAudio();
// Browsers only allow sound after a gesture: start (or resume) on the first key or click.
const startAudio = () => audio.start();
window.addEventListener('keydown', startAudio);
window.addEventListener('pointerdown', startAudio);
const birdsAt = new Vector3();
const audioInput: AudioInput = {
  speed: 0, bank: 0, flapCount: 0, inCloud: 0, night: 0, boost: 0, current: 0, skim: 0, overWater: false,
  aboveGround: 0, coast: 0, sea: 0, birds: null, birdDistance: Infinity,
};

/** Fraction of open sea in a ring around a point (coastline detection for the surf). */
function seaFraction(x: number, z: number): number {
  let sea = heightfield.surface(x, z) < 0 ? 1 : 0;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (heightfield.surface(x + Math.cos(a) * 250, z + Math.sin(a) * 250) < 0) sea++;
  }
  return sea / 9;
}
const rimColor = new Color();
const markerLight = new Color();
const currentTint = new Color();

/** Terrain or sea surface, whichever is higher. */
const groundAt = (x: number, z: number) => Math.max(0, heightfield.surface(x, z));

const readouts = { sound: 0, speed: 0, altitude: 0, aboveGround: 0, lift: 0, sink: 0, energy: 0, fps: 0, cpuMs: 0 };
const gui = createTuningPanel(readouts);
let guiVisible = true;

// Values read every frame need nothing here; these need a rebuild or a push into a material.
onTuningChange((group, key) => {
  if (group === 'post' && key === 'pixelRatioMax') resize();

  const reshape =
    (group === 'world' && key === 'seed') || (group === 'terrain' && ['detail', 'fillerIslets'].includes(key));
  if (reshape) {
    heightfield = new Heightfield(heightfieldOptions());
    maps.rebake(heightfieldOptions());
    terrain.setHeightfield(heightfield);
    vegetation.setHeightfield(heightfield);
    grass.setHeightfield(heightfield);
  }
  const live = ['liftScale', 'moteSize', 'birdSize', 'columnOpacity'];
  if (reshape || (group === 'thermals' && !live.includes(key))) thermals.rebuild(heightfield);
});

const pose: FlightPose = { position: new Vector3(), yaw: 0, pitch: 0, bank: 0 };
const velocity = new Vector3();
const drive: CreatureDrive = { speed: 0, pitchInput: 0, rollInput: 0, flapCount: 0 };
const env: FlightEnvironment = {
  updraft: 0,
  ground: 0,
  groundSlopeX: 0,
  groundSlopeZ: 0,
  current: 0,
  currentDir: new Vector3(),
  currentSpeed: 0,
};

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
function resize(): void {
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight, pixelRatio());
  follow.setAspect(window.innerWidth / window.innerHeight);
}
window.addEventListener('resize', resize);

let accumulator = 0;
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;

function frame(now: number): void {
  const frameStart = performance.now();
  const dt = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;

  if (input.wasPressed('KeyR')) reset();
  if (input.wasPressed('KeyM')) audio.toggleMute();
  if (input.wasPressed('KeyG')) {
    guiVisible = !guiVisible;
    gui.show(guiVisible);
  }

  const intent = input.read(dt);
  accumulator += dt;
  while (accumulator >= FIXED_DT) {
    env.updraft = thermals.liftAt(flight.position);
    const { x, z } = flight.position;
    env.ground = groundAt(x, z);
    env.groundSlopeX = (groundAt(x + 2, z) - groundAt(x - 2, z)) / 4;
    env.groundSlopeZ = (groundAt(x, z + 2) - groundAt(x, z - 2)) / 4;
    const cur = currents.sample(flight.position);
    env.current = cur.strength;
    env.currentDir.copy(cur.dir);
    env.currentSpeed = cur.speed;
    flight.step(FIXED_DT, intent, env);
    flight.position.addScaledVector(cur.pull, FIXED_DT);
    // Rock and buildings are solid: get pushed out, losing speed in the scrape.
    const hit = obstacles.resolve(flight.position, 1.6);
    if (hit > 0) flight.speed *= Math.max(0.9, 1 - hit * 0.05);
    accumulator -= FIXED_DT;
  }
  flight.interpolate(accumulator / FIXED_DT, pose);
  flight.velocity(velocity);

  drive.speed = flight.speed;
  drive.pitchInput = intent.pitch;
  drive.rollInput = intent.roll;
  drive.flapCount = flight.flapCount;
  creature.update(dt, pose, drive);
  follow.rush = Math.max(flight.boost, env.current);
  follow.update(dt, pose, velocity, flight.speed, groundAt);
  obstacles.resolve(follow.camera.position, 2.5);
  atmosphere.update(dt);
  world.update(pose.position, atmosphere.state.lightDir);
  water.update(dt, pose.position, atmosphere.state);
  maps.update(dt, atmosphere.state.sunDir);
  const sh = tuning.shading;
  shadingUniforms.toonParams.value.set([sh.rampStart, sh.rampEnd, sh.rimStrength, sh.rimPower]);
  const camPos = follow.camera.position;
  clouds.update(dt, atmosphere.state);
  inCloud += (clouds.densityAt(camPos) - inCloud) * (1 - Math.exp(-6 * dt));
  world.applyAtmosphere(atmosphere.state, inCloud, clouds.color);
  fogUniforms.fogParams.value[0] *= 1 - inCloud; // no sun tint inside a cloud: an even whiteout
  sky.update(dt, atmosphere.state, camPos, inCloud, clouds.color);
  const st = atmosphere.state;
  thermals.setLight(markerLight.copy(st.ambientSky).multiplyScalar(Math.min(1, st.ambientIntensity * 0.75)));
  creature.setRimColor(rimColor.copy(atmosphere.state.horizon).lerp(atmosphere.state.sun, 0.5));
  terrain.update(pose.position, TERRAIN_BUDGET_MS);
  vegetation.update(dt, camPos);
  props.update(dt, camPos, atmosphere.state);
  currents.update(dt, camPos, currentTint.copy(atmosphere.state.horizon).lerp(atmosphere.state.light, 0.3).multiplyScalar(1.15));
  speedFx.update(dt, follow.camera, {
    speed: flight.speed,
    boost: flight.boost,
    current: env.current,
    skim: flight.skim,
    position: pose.position,
    velocity,
    ground: env.ground,
    water: heightfield.surface(pose.position.x, pose.position.z) < 0.3,
  });
  grass.update(dt, camPos, pose.position, groundAt(camPos.x, camPos.z));

  if (audio.started) {
    const sea = seaFraction(pose.position.x, pose.position.z);
    audioInput.speed = flight.speed;
    audioInput.boost = flight.boost;
    audioInput.current = env.current;
    audioInput.skim = flight.skim;
    audioInput.overWater = heightfield.surface(pose.position.x, pose.position.z) < 0.3;
    audioInput.bank = pose.bank;
    audioInput.flapCount = flight.flapCount;
    audioInput.inCloud = inCloud;
    audioInput.night = atmosphere.state.night;
    audioInput.aboveGround = flight.position.y - env.ground;
    audioInput.sea = sea;
    audioInput.coast = 4 * sea * (1 - sea);
    audioInput.birdDistance = thermals.nearestBirds(camPos, birdsAt);
    audioInput.birds = Number.isFinite(audioInput.birdDistance) ? birdsAt : null;
    audio.update(dt, audioInput, follow.camera);
  }
  thermals.update(dt);
  post.render(dt, Math.max(0, Math.min(1, (flight.speed - 60) / 50)) * 0.7 + flight.boost * 0.3);
  input.endFrame();

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    readouts.fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }
  readouts.sound = round(audio.level(), 3);
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
