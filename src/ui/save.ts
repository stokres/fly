// Progress and settings, kept in localStorage (best effort: private windows may refuse).
import type { Lang } from './i18n';

export type Quality = 'low' | 'medium' | 'high';

export interface SaveData {
  feathers: number[];
  shrines: number[];
  hintsShown: string[];
  settings: {
    lang: Lang | null;
    volume: number;
    music: number;
    sensitivity: number;
    invert: boolean;
    quality: Quality;
    cameraRoll: number;
  };
}

const KEY = 'fly.save.v1';

export function defaultSave(): SaveData {
  return {
    feathers: [],
    shrines: [],
    hintsShown: [],
    settings: { lang: null, volume: 0.8, music: 0.6, sensitivity: 1, invert: false, quality: 'high', cameraRoll: 0.4 },
  };
}

export function loadSave(): SaveData {
  const base = defaultSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const data = JSON.parse(raw) as Partial<SaveData>;
    return {
      feathers: Array.isArray(data.feathers) ? data.feathers.filter((n) => typeof n === 'number') : [],
      shrines: Array.isArray(data.shrines) ? data.shrines.filter((n) => typeof n === 'number') : [],
      hintsShown: Array.isArray(data.hintsShown) ? data.hintsShown.filter((n) => typeof n === 'string') : [],
      settings: { ...base.settings, ...(data.settings ?? {}) },
    };
  } catch {
    return base;
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable: progress lasts for this session only.
  }
}
