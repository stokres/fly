// Every feel constant lives here. Defaults come from tuning-defaults.json; live edits
// are persisted to localStorage and can be exported back to JSON to become the new defaults.
import GUI from 'lil-gui';
import defaults from './tuning-defaults.json';

export type Tuning = typeof defaults;
type Group = keyof Tuning;
type Range = [min: number, max: number, step: number];

const STORAGE_KEY = 'fly.tuning.v1';

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
  },
  world: {
    seed: [1, 99999, 1],
    fogDensity: [0, 0.01, 0.0001],
    pillarsPerTile: [0, 1000, 1],
  },
  input: {
    gamepadDeadzone: [0, 0.5, 0.01],
  },
};

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning));
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
