import type { GuideMode } from '../render/aimGuide';
import type { ArenaId } from '../render/arenas';
import type { Quality } from '../render/world';

export interface Settings {
  quality: Quality;
  guide: GuideMode;
  volume: number;
  ambience: boolean;
  sensitivity: number;
  arena: ArenaId;
}

const KEY = 'nine.settings.v1';
const DEFAULTS: Settings = { quality: 'high', guide: 'short', volume: 0.8, ambience: true, sensitivity: 1, arena: 'private' };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}
export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* abaikan */
  }
}
