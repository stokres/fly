// Every feel constant lives here. Defaults come from tuning-defaults.json; live edits
// are persisted to localStorage and can be exported back to JSON to become the new defaults.
// Only values that differ from the defaults are stored, so new defaults still reach players.
import GUI from 'lil-gui';
import defaults from './tuning-defaults.json';

export type Tuning = typeof defaults;
type Group = keyof Tuning;
type Range = [min: number, max: number, step: number];

const STORAGE_KEY = 'fly.tuning.v2';

// Slider ranges. Keys missing here fall back to lil-gui's default controller (e.g. booleans).
const RANGES: { [G in Group]: Partial<Record<keyof Tuning[G], Range>> } = {
  flight: {
    startSpeed: [0, 60, 0.5],
    stallSpeed: [2, 30, 0.5],
    maxSpeed: [20, 150, 1],
    gravity: [0, 30, 0.1],
    drag: [0, 0.01, 0.0001],
    baseSink: [0, 5, 0.05],
    stallSink: [0, 20, 0.1],
    pitchRateDeg: [10, 200, 1],
    pitchResponse: [0.5, 20, 0.1],
    pitchAutoLevel: [0, 5, 0.05],
    glidePitchDeg: [-30, 10, 0.5],
    maxPitchDeg: [20, 85, 1],
    stallNoseDrop: [0, 5, 0.05],
    maxBankDeg: [10, 85, 1],
    bankResponse: [0.5, 15, 0.1],
    turnRate: [0.1, 3, 0.01],
    bankPitchDrop: [0, 2, 0.01],
    flapThrust: [0, 20, 0.1],
    flapLift: [0, 15, 0.1],
    flapLiftDecay: [0.1, 10, 0.1],
    flapCooldown: [0.05, 2, 0.01],
    flapCost: [0, 1, 0.01],
    energyRegen: [0, 1, 0.01],
    groundClearance: [0, 10, 0.1],
    slideTurnRate: [0, 5, 0.05],
    cruiseSpeed: [0, 80, 0.5],
    cruiseThrust: [0, 30, 0.1],
    boostAccel: [0, 120, 0.5],
    boostMaxSpeed: [20, 200, 1],
    boostCost: [0, 2, 0.01],
    skimHeight: [1, 80, 0.5],
    skimRegen: [0, 2, 0.01],
    skimAccel: [0, 40, 0.1],
    currentSteer: [0, 15, 0.1],
  },
  camera: {
    distance: [2, 30, 0.1],
    height: [-5, 10, 0.1],
    distancePerSpeed: [0, 0.3, 0.005],
    lateralHz: [0.1, 6, 0.05],
    lateralDamping: [0.1, 2, 0.01],
    verticalHz: [0.1, 6, 0.05],
    verticalDamping: [0.1, 2, 0.01],
    longitudinalHz: [0.1, 6, 0.05],
    longitudinalDamping: [0.1, 2, 0.01],
    lookAhead: [0, 2, 0.01],
    lookHeight: [-3, 5, 0.1],
    fovMin: [30, 100, 1],
    fovMax: [30, 120, 1],
    fovSpeedMin: [0, 80, 0.5],
    fovSpeedMax: [5, 150, 0.5],
    fovResponse: [0.1, 10, 0.1],
    rollFactor: [0, 1, 0.01],
    rollResponse: [0.1, 15, 0.1],
    groundClearance: [0, 20, 0.1],
    shake: [0, 4, 0.05],
    boostFov: [0, 30, 0.5],
  },
  creature: {
    scale: [0.3, 3, 0.05],
    tuckSpeedMin: [0, 80, 0.5],
    tuckSpeedMax: [5, 120, 0.5],
    flapDuration: [0.1, 1.5, 0.01],
    flapAmplitudeDeg: [0, 80, 1],
    dihedralDeg: [-20, 30, 0.5],
    flutterDeg: [0, 10, 0.1],
    headTurnDeg: [0, 60, 1],
    tailSpread: [0, 2, 0.05],
    rimStrength: [0, 3, 0.05],
    rimPower: [0.5, 8, 0.1],
    streamerLength: [0, 8, 0.1],
    streamerWidth: [0, 0.4, 0.005],
    streamerWave: [0, 0.6, 0.01],
    streamerSag: [0, 10, 0.1],
  },
  thermals: {
    liftScale: [0, 3, 0.01],
    extraCount: [0, 60, 1],
    radiusMin: [10, 200, 1],
    radiusMax: [10, 300, 1],
    strengthMin: [0, 15, 0.1],
    strengthMax: [0, 20, 0.1],
    topMin: [50, 1000, 5],
    topMax: [50, 1500, 5],
    motesPerThermal: [0, 500, 1],
    moteSize: [0.2, 8, 0.1],
    birdsPerThermal: [0, 12, 1],
    birdSize: [0.5, 8, 0.1],
    columnOpacity: [0, 0.5, 0.005],
  },
  currents: {
    strength: [0, 2, 0.01],
    speedScale: [0.2, 3, 0.01],
    visibility: [0, 3, 0.01],
    drawDistance: [200, 5000, 50],
  },
  fx: {
    lines: [0, 2, 0.01],
    linesSpeed: [0, 150, 1],
    spray: [0, 3, 0.01],
  },
  landmarks: {
    fogScale: [0, 1, 0.01],
  },
  terrain: {
    detail: [0, 3, 0.05],
    fillerIslets: [0, 60, 1],
    lodDistance: [150, 2000, 10],
    drawDistance: [1000, 8000, 50],
  },
  atmosphere: {
    timeOfDay: [0, 24, 0.05],
    dayCycleMinutes: [0, 120, 0.5],
    sunMaxElevationDeg: [5, 90, 1],
    sunDiscDeg: [0.2, 8, 0.1],
    sunGlowAmount: [0, 1, 0.01],
    sunGlowPower: [1, 64, 0.5],
    fogHeightScale: [50, 3000, 10],
  },
  clouds: {
    count: [0, 150, 1],
    altitudeMin: [100, 1500, 5],
    altitudeMax: [100, 2000, 5],
    sizeMin: [0.2, 4, 0.05],
    sizeMax: [0.2, 5, 0.05],
    windSpeed: [0, 40, 0.5],
    insideFogDensity: [0, 0.1, 0.001],
    shadowStrength: [0, 1, 0.01],
  },

  audio: {
    masterVolume: [0, 1, 0.01],
    windVolume: [0, 1.5, 0.01],
    windMinSpeed: [0, 40, 0.5],
    windMaxSpeed: [10, 120, 1],
    windCutoffMin: [40, 2000, 10],
    windCutoffMax: [200, 8000, 10],
    whistleVolume: [0, 1, 0.01],
    flapVolume: [0, 2, 0.01],
    musicVolume: [0, 2, 0.01],
    chordSeconds: [4, 90, 1],
    wavesVolume: [0, 2, 0.01],
    surfFalloff: [20, 800, 5],
    birdsVolume: [0, 2, 0.01],
    birdHearing: [50, 2000, 10],
  },
  shading: {
    rampStart: [-1, 0.5, 0.01],
    rampEnd: [-0.5, 1, 0.01],
    rimStrength: [0, 2, 0.01],
    rimPower: [0.5, 8, 0.1],
  },
  water: {
    ripple: [0, 3, 0.01],
    foam: [0, 2, 0.01],
    glint: [0, 3, 0.01],
  },
  post: {
    bloomStrength: [0, 2, 0.01],
    bloomThreshold: [0, 2, 0.01],
    saturation: [0, 2, 0.01],
    contrast: [0.5, 1.5, 0.01],
    vignette: [0, 1, 0.01],
    speedBlur: [0, 3, 0.01],
    pixelRatioMax: [0.5, 2, 0.25],
  },
  vegetation: {
    density: [0, 3, 0.05],
    lod0Distance: [50, 1000, 10],
    lod1Distance: [200, 3000, 10],
    drawDistance: [500, 6000, 50],
  },
  grass: {
    density: [0, 3, 0.05],
    radius: [20, 250, 5],
    height: [0.2, 3, 0.05],
    wind: [0, 3, 0.05],
    wake: [0, 3, 0.05],
    maxCameraHeight: [10, 500, 5],
  },
  world: {
    seed: [1, 99999, 1],
    fogDensity: [0, 0.01, 0.0001],
  },
  input: {
    gamepadDeadzone: [0, 0.5, 0.01],
    mouseSensitivity: [0.1, 5, 0.05],
    mouseReturn: [0, 10, 0.1],
  },
};

/** Values that can change on their own (e.g. the day cycle advances the clock): keep their sliders live. */
const LIVE = new Set(['atmosphere.timeOfDay']);

const LABELS: Partial<Record<string, string>> = {
  'input.invertPitch': 'invertPitch (W = climb)',
};

type Listener = (group: Group, key: string) => void;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Copies only keys that exist in `target` and have the same type, so stale or foreign JSON is harmless.
function mergeKnown(target: Tuning, source: unknown): void {
  if (typeof source !== 'object' || source === null) return;
  const src = source as Record<string, Record<string, unknown>>;
  for (const group of Object.keys(target) as Group[]) {
    const from = src[group];
    if (typeof from !== 'object' || from === null) continue;
    const to = target[group] as Record<string, unknown>;
    for (const key of Object.keys(to)) {
      if (typeof from[key] === typeof to[key]) to[key] = from[key];
    }
  }
}

function loadStored(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStored(tuning: Tuning): void {
  const changed: Record<string, Record<string, unknown>> = {};
  for (const group of Object.keys(tuning) as Group[]) {
    const now = tuning[group] as Record<string, unknown>;
    const base = defaults[group] as Record<string, unknown>;
    for (const key of Object.keys(now)) {
      if (now[key] !== base[key]) (changed[group] ??= {})[key] = now[key];
    }
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changed));
  } catch {
    // Storage unavailable (private mode etc.): tuning still works for this session.
  }
}

export const tuning: Tuning = clone(defaults);
mergeKnown(tuning, loadStored());

const listeners: Listener[] = [];
export function onTuningChange(listener: Listener): void {
  listeners.push(listener);
}

function notifyAll(): void {
  for (const group of Object.keys(tuning) as Group[]) {
    for (const key of Object.keys(tuning[group])) listeners.forEach((l) => l(group, key));
  }
}

function downloadJson(): void {
  const text = JSON.stringify(tuning, null, 2) + '\n';
  navigator.clipboard?.writeText(text).catch(() => {});
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tuning-defaults.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importJson(gui: GUI): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      mergeKnown(tuning, JSON.parse(await file.text()));
    } catch (err) {
      console.warn('Could not import tuning JSON', err);
      return;
    }
    saveStored(tuning);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    notifyAll();
  };
  input.click();
}

/** Builds the tuning panel. `readouts` is shown read-only and refreshed every frame. */
export function createTuningPanel(readouts: Record<string, number>): GUI {
  const gui = new GUI({ title: 'Tuning  (G to hide)', width: 320 });

  const live = gui.addFolder('Readout');
  for (const key of Object.keys(readouts)) live.add(readouts, key).listen().disable();

  for (const group of Object.keys(tuning) as Group[]) {
    const folder = gui.addFolder(group);
    const values = tuning[group] as Record<string, number | boolean>;
    const ranges = RANGES[group] as Record<string, Range | undefined>;
    for (const key of Object.keys(values)) {
      const range = ranges[key];
      const controller = range
        ? folder.add(values, key, range[0], range[1], range[2])
        : folder.add(values, key);
      if (LIVE.has(`${group}.${key}`)) controller.listen();
      const label = LABELS[`${group}.${key}`];
      if (label) controller.name(label);
      controller.onChange(() => {
        saveStored(tuning);
        listeners.forEach((l) => l(group, key));
      });
    }
    if (group !== 'flight' && group !== 'camera') folder.close();
  }

  const actions = {
    exportJson: downloadJson,
    importJson: () => importJson(gui),
    resetToDefaults: () => {
      mergeKnown(tuning, clone(defaults));
      saveStored(tuning);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      notifyAll();
    },
  };
  const io = gui.addFolder('Save / load');
  io.add(actions, 'exportJson').name('Export JSON (download + clipboard)');
  io.add(actions, 'importJson').name('Import JSON');
  io.add(actions, 'resetToDefaults').name('Reset to defaults');

  return gui;
}
