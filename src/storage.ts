// Persistent settings and records. Every storage access is guarded: private
// browsing modes and blocked storage must never break the game.

export type Quality = 'auto' | 'high' | 'low';
export type TouchMode = 'relative' | 'direct';

export interface Settings {
  music: number; // 0..1
  sfx: number; // 0..1
  shake: boolean;
  quality: Quality;
  touchMode: TouchMode;
  touchSensitivity: number; // 0.6..2
  reducedFlashing: boolean;
}

export interface Records {
  bestAscent: number;
  bestEndless: number;
  bestEndlessWave: number;
  cleared: boolean;
  seenTutorial: boolean;
}

const storage = {
  settings: 'dorothy.abyss-weaver.settings.v1',
  records: 'dorothy.abyss-weaver.records.v1',
} as const;

export const defaultSettings: Settings = {
  music: 0.6,
  sfx: 0.8,
  shake: true,
  quality: 'auto',
  touchMode: 'relative',
  touchSensitivity: 1.25,
  reducedFlashing: false,
};

const defaultRecords: Records = {
  bestAscent: 0,
  bestEndless: 0,
  bestEndlessWave: 0,
  cleared: false,
  seenTutorial: false,
};

function load<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...fallback };
    const parsed = JSON.parse(raw) as Partial<T>;
    return { ...fallback, ...parsed };
  } catch {
    return { ...fallback };
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

export const settings: Settings = load(storage.settings, defaultSettings);
export const records: Records = load(storage.records, defaultRecords);

export function saveSettings(): void {
  save(storage.settings, settings);
}

export function saveRecords(): void {
  save(storage.records, records);
}

export function resetLocalData(): boolean {
  Object.assign(settings, defaultSettings);
  Object.assign(records, defaultRecords);
  try {
    localStorage.removeItem(storage.settings);
    localStorage.removeItem(storage.records);
    return true;
  } catch {
    return false;
  }
}
