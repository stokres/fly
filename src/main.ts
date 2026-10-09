// Bootstrap and game loop. Flight runs on a fixed timestep; rendering interpolates between steps.
// Menus overlay the live world: on the title screen the bird glides on its own; paused, the
// world keeps moving but the bird holds still.
import { fogUniforms } from './fog'; // also patches three's fog shaders: must load before anything renders
import { shadingUniforms } from './shading'; // patches three's Lambert lighting: same rule
import './ui/ui.css';
import { ACESFilmicToneMapping, Color, PCFShadowMap, Vector3, WebGLRenderer } from 'three';
import { Atmosphere } from './atmosphere';
import { type AudioInput, GameAudio } from './audio';
import { FollowCamera } from './camera';
import { Clouds } from './clouds';
import { Collectibles } from './collectibles';
import { Creature, type CreatureDrive } from './creature';
import { Currents } from './currents';
import { Flight, type FlightEnvironment, type FlightPose } from './flight';
import { Grass } from './grass';
import { Heightfield } from './heightfield';
import { type FlightInput, Input } from './input';
import { Obstacles } from './obstacles';
import { clearingsOf, computePlacements } from './places';
import { Post } from './post';
import { Progress } from './progress';
import { Props } from './props';
import { Sky } from './sky';
import { SpeedFx } from './speedfx';
import { Terrain } from './terrain';
import { TerrainMaps } from './terrainMaps';
import { Thermals } from './thermals';
import { createTuningPanel, onTuningChange, tuning } from './tuning';
import { Hud } from './ui/hud';
import { setLang, t } from './ui/i18n';
import { Menu } from './ui/menu';
import { type Quality, loadSave, writeSave } from './ui/save';
import { Vegetation } from './vegetation';
import { Water } from './water';
import { World } from './world';

const FIXED_DT = 1 / 120;
const MAX_FRAME = 0.1; // clamp long frames (tab switch, breakpoint) to avoid a spiral
const TERRAIN_BUDGET_MS = 3; // mesh building per frame once running

const save = loadSave();
if (save.settings.lang) setLang(save.settings.lang);

// Post-processing does the antialiasing (MSAA target), so the canvas itself doesn't need it.
const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const pixelRatio = () => Math.min(window.devicePixelRatio, tuning.post.pixelRatioMax);
renderer.setPixelRatio(pixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap; // soft with shadow.radius (PCFSoft is deprecated in r184)
renderer.info.autoReset = false; // count the whole frame (shadows, scene, post), reset per frame
document.body.prepend(renderer.domElement);

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
const collectibles = new Collectibles(heightfield);
const speedFx = new SpeedFx();
const atmosphere = new Atmosphere();
const sky = new Sky();
const clouds = new Clouds();
world.scene.add(
  sky.mesh,
  water.mesh,
  terrain.group,
  grass.mesh,
  vegetation.group,
  props.group,
  thermals.group,
  creature.object,
  clouds.group,
  currents.mesh,
  collectibles.group,
  speedFx.lines,
  speedFx.particles,
);
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
const goldRim = new Color(1.0, 0.75, 0.35);
const markerLight = new Color();
const currentTint = new Color();

/** Terrain or sea surface, whichever is higher. */
const groundAt = (x: number, z: number) => Math.max(0, heightfield.surface(x, z));

// ---- UI ----
const uiRoot = document.getElementById('ui') as HTMLElement;
const hud = new Hud(uiRoot);
const progress = new Progress(collectibles, hud, audio, save, flight);
const menu = new Menu(
  uiRoot,
  save,
  () => ({
    feathers: collectibles.feathers.size,
    featherTotal: collectibles.featherCount,
    shrines: collectibles.shrines.size,
    shrineTotal: collectibles.shrineCount,
  }),
  {
    onPlay: () => {
      audio.start();
      if (!started) {
        started = true;
        reset();
      }
      hud.visible = true;
      void renderer.domElement.requestPointerLock?.();
    },
    onSettingsChanged: applySettings,
    onResetProgress: () => {
      progress.reset();
      menu.close();
      hud.visible = true;
    },
  },
);
let started = false;
let loadingTime = 0;
menu.setLoading(true);

/** Graphics presets and player settings, mapped onto tuning values. */
function applySettings(): void {
  const s = save.settings;
  tuning.audio.masterVolume = 0.8 * s.volume;
  tuning.audio.musicVolume = 0.6 * s.music;
  tuning.input.mouseSensitivity = s.sensitivity;
  tuning.input.invertPitch = s.invert;
  tuning.camera.rollFactor = s.cameraRoll;
  const q: Record<Quality, { pr: number; grass: number; grassR: number; veg: number; shadows: boolean; bloom: number }> = {
    low: { pr: 0.75, grass: 0, grassR: 60, veg: 1600, shadows: false, bloom: 0 },
    medium: { pr: 1, grass: 0.55, grassR: 85, veg: 2400, shadows: true, bloom: 0.2 },
    high: { pr: 1.5, grass: 1, grassR: 110, veg: 2800, shadows: true, bloom: 0.25 },
  };
  const p = q[s.quality];
  const grassChanged = tuning.grass.density !== p.grass || tuning.grass.radius !== p.grassR;
  tuning.post.pixelRatioMax = p.pr;
  tuning.grass.density = p.grass;
  tuning.grass.radius = p.grassR;
  tuning.vegetation.drawDistance = p.veg;
  tuning.post.bloomStrength = p.bloom;
  world.key.castShadow = p.shadows;
  if (grassChanged) grass.setHeightfield(heightfield);
  resize();
  writeSave(save);
}

const readouts = { x: 0, z: 0, calls: 0, ktris: 0, sound: 0, speed: 0, altitude: 0, aboveGround: 0, lift: 0, sink: 0, energy: 0, fps: 0, cpuMs: 0 };
const gui = createTuningPanel(readouts);
let guiVisible = false;
gui.show(guiVisible);

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
  if (group === 'grass' && (key === 'density' || key === 'radius')) grass.setHeightfield(heightfield);
  const live = ['liftScale', 'moteSize', 'birdSize', 'columnOpacity'];
  if (reshape || (group === 'thermals' && !live.includes(key))) thermals.rebuild(heightfield);
});

const pose: FlightPose = { position: new Vector3(), yaw: 0, pitch: 0, bank: 0 };
const velocity = new Vector3();
const lastPos = new Vector3();
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
const idle: FlightInput = { pitch: 0, roll: 0, flap: false, boost: false };

/** Optional start override from the URL: `#x,y,z,headingDeg` (heading 0 = north, 90 = east). */
function startOverride(): { x: number; y: number; z: number; yaw: number } | null {
  const parts = location.hash.slice(1).split(',').map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[1], z: parts[2], yaw: (-(parts[3] ?? 0) * Math.PI) / 180 };
}

function reset(): void {
  flight.reset(startOverride() ?? undefined);
  flight.interpolate(1, pose);
  lastPos.copy(flight.position);
  follow.snap(pose, flight.velocity(velocity), flight.speed);
  // Build everything in view right away, so the world doesn't pop in around the start.
  terrain.update(flight.position, Infinity);
}

window.addEventListener('hashchange', () => {
  reset();
  // Dev shortcut: a start position in the URL skips the title screen.
  if (!started) {
    started = true;
    menu.close();
    hud.visible = true;
  }
});
function resize(): void {
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight, pixelRatio());
  follow.setAspect(window.innerWidth / window.innerHeight);
}
window.addEventListener('resize', resize);

// Pause when the pointer is released (Esc) or the tab loses focus mid-flight. The Esc that
// released the pointer may also arrive as a key press: ignore it so it doesn't unpause at once.
let autoPausedAt = -Infinity;
document.addEventListener('pointerlockchange', () => {
  if (!input.pointerLocked && started && !menu.open) {
    menu.pause();
    hud.visible = false;
    autoPausedAt = performance.now();
  }
});
window.addEventListener('blur', () => {
  if (started && !menu.open) {
    menu.pause();
    hud.visible = false;
    input.releasePointer();
  }
});

// Debug hook for tooling (?debug in the URL): scene and renderer on window.
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { fly: { scene: world.scene, renderer, tuning } });

applySettings();
reset();
if (startOverride()) {
  started = true;
  menu.close();
  hud.visible = true;
}

// Adaptive quality: if flight runs below ~40 fps for a while, step down one level (once per
// level), unless the player picked a quality themselves.
const QUALITY_ORDER: Quality[] = ['low', 'medium', 'high'];
let slowTime = 0;
let measuredTime = 0;
function adaptQuality(realDt: number, playing: boolean): void {
  if (!playing || save.settings.qualityLocked || realDt > 0.5) return; // ignore hitches and tab switches
  measuredTime += realDt;
  if (measuredTime < 4) return; // let shaders compile and the world stream in first
  slowTime = realDt > 1 / 40 ? slowTime + realDt : Math.max(0, slowTime - realDt * 0.5);
  if (slowTime > 3) {
    const i = QUALITY_ORDER.indexOf(save.settings.quality);
    if (i > 0) {
      save.settings.quality = QUALITY_ORDER[i - 1];
      applySettings();
      hud.showHint(t('qualityLowered'));
    }
    slowTime = 0;
    measuredTime = 0;
  }
}

let accumulator = 0;
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let titleTime = 0;

function frame(now: number): void {
  const frameStart = performance.now();
  const realDt = (now - last) / 1000;
  const dt = Math.min(realDt, MAX_FRAME);
  last = now;

  // The world has loaded enough to fly once the terrain maps are baked.
  if (!started) {
    loadingTime += dt;
    if (maps.uniforms.terrainMapsReady.value > 0.5 || loadingTime > 8) menu.setLoading(false);
  }

  const playing = started && !menu.open;
  adaptQuality(realDt, playing);
  input.captureEnabled = playing || !menu.open;
  if (input.wasPressed('Escape') && started && performance.now() - autoPausedAt > 400) {
    if (menu.open) {
      menu.close();
      hud.visible = true;
    } else {
      menu.pause();
      hud.visible = false;
      input.releasePointer(); // menus need a free cursor
    }
  }
  if (playing && input.wasPressed('KeyR')) reset();
  if (input.wasPressed('KeyM')) audio.toggleMute();
  if (input.wasPressed('KeyG')) {
    guiVisible = !guiVisible;
    gui.show(guiVisible);
  }

  // Title screen: the bird glides on its own in lazy S-turns.
  let intent = input.read(dt);
  if (!started) {
    titleTime += dt;
    intent = { ...idle, roll: Math.sin(titleTime * 0.25) * 0.35, pitch: flight.position.y < 90 ? 0.4 : 0 };
  } else if (!playing) {
    intent = idle;
  }

  if (!started || playing) {
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
  }
  flight.interpolate(playing || !started ? accumulator / FIXED_DT : 1, pose);
  flight.velocity(velocity);

  // Pickups along the path flown this frame.
  const events = collectibles.update(dt, lastPos, flight.position, follow.camera.position);
  if (playing) {
    progress.handle(events);
    progress.update(dt, { current: env.current, skim: flight.skim });
  }
  lastPos.copy(flight.position);

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
  rimColor.copy(st.horizon).lerp(st.sun, 0.5);
  // With every feather found, the bird glows gold.
  creature.setRimColor(progress.allFound ? goldRim : rimColor);
  terrain.update(pose.position, TERRAIN_BUDGET_MS);
  vegetation.update(dt, follow.camera);
  props.update(dt, camPos, st);
  currents.update(dt, camPos, currentTint.copy(st.horizon).lerp(st.light, 0.3).multiplyScalar(1.15));
  const overWater = heightfield.surface(pose.position.x, pose.position.z) < 0.3;
  speedFx.update(dt, follow.camera, {
    speed: flight.speed,
    boost: flight.boost,
    current: env.current,
    skim: flight.skim,
    position: pose.position,
    velocity,
    ground: env.ground,
    water: overWater,
  });
  grass.update(dt, camPos, pose.position, groundAt(camPos.x, camPos.z));

  hud.update(dt, {
    energy: flight.energy,
    boost: flight.boost,
    speed: flight.speed,
    stick: input.pointerLocked ? input.mouseStick : null,
    target: collectibles.revealedTarget(flight.position),
    camera: follow.camera,
  });

  if (audio.started) {
    const sea = seaFraction(pose.position.x, pose.position.z);
    audioInput.speed = flight.speed;
    audioInput.boost = flight.boost;
    audioInput.current = env.current;
    audioInput.skim = flight.skim;
    audioInput.overWater = overWater;
    audioInput.bank = pose.bank;
    audioInput.flapCount = flight.flapCount;
    audioInput.inCloud = inCloud;
    audioInput.night = st.night;
    audioInput.aboveGround = flight.position.y - env.ground;
    audioInput.sea = sea;
    audioInput.coast = 4 * sea * (1 - sea);
    audioInput.birdDistance = thermals.nearestBirds(camPos, birdsAt);
    audioInput.birds = Number.isFinite(audioInput.birdDistance) ? birdsAt : null;
    audio.update(dt, audioInput, follow.camera);
  }
  thermals.update(dt);
  renderer.info.reset();
  post.render(dt, Math.max(0, Math.min(1, (flight.speed - 60) / 50)) * 0.7 + flight.boost * 0.3);
  readouts.calls = renderer.info.render.calls;
  readouts.ktris = Math.round(renderer.info.render.triangles / 1000);
  input.endFrame();

  // FPS from real (unclamped) frame times, so slow machines show their true rate.
  fpsFrames++;
  fpsTime += realDt;
  if (fpsTime >= 0.5) {
    readouts.fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }
  readouts.x = Math.round(flight.position.x);
  readouts.z = Math.round(flight.position.z);
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
