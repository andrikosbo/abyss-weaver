import type { EnemyKind } from './types';

export interface SpawnGroup {
  kind: EnemyKind;
  count: number;
  interval: number; // seconds between spawns
  delay: number; // seconds before the first spawn
}

export interface WaveDef {
  groups: SpawnGroup[];
  cap: number; // maximum simultaneous non-boss enemies
  boss?: 'boss1' | 'boss2' | 'boss3';
  zone: string;
  hint?: string;
}

const g = (kind: EnemyKind, count: number, interval: number, delay = 0): SpawnGroup => ({ kind, count, interval, delay });

export const BOSS_NAMES: Record<'boss1' | 'boss2' | 'boss3', [string, string]> = {
  boss1: ['The Gloomwarden', 'Bell of the Hadal Dark'],
  boss2: ['The Choir Below', 'It sings with a thousand teeth'],
  boss3: ['Mother of the Deep', 'The eye that never closed'],
};

export const CAMPAIGN_DEPTH_START = 3000;
export const DEPTH_PER_WAVE = 250;

export const CAMPAIGN: WaveDef[] = [
  { zone: 'The Hadal Dark', cap: 8, groups: [g('mote', 10, 1.3)] },
  { zone: 'The Hadal Dark', cap: 10, groups: [g('mote', 14, 1.0), g('lancer', 3, 5, 6)], hint: 'lancer' },
  { zone: 'The Hadal Dark', cap: 11, groups: [g('mote', 12, 1.1), g('urchin', 3, 6, 2), g('lancer', 4, 4, 8)], hint: 'urchin' },
  { zone: 'The Hadal Dark', cap: 8, boss: 'boss1', groups: [g('mote', 6, 5, 10)] },
  { zone: 'The Midnight Reach', cap: 12, groups: [g('mote', 14, 1.0), g('naut', 4, 5, 3), g('lancer', 4, 5, 10)], hint: 'naut' },
  { zone: 'The Midnight Reach', cap: 12, groups: [g('eel', 2, 10, 2), g('mote', 14, 1.2), g('urchin', 3, 7, 6)], hint: 'eel' },
  {
    zone: 'The Midnight Reach',
    cap: 13,
    groups: [g('siren', 3, 6, 2), g('mote', 14, 1.0), g('naut', 3, 7, 8), g('lancer', 3, 6, 12)],
    hint: 'siren',
  },
  { zone: 'The Midnight Reach', cap: 8, boss: 'boss2', groups: [g('mote', 8, 4, 6)] },
  {
    zone: 'The Twilight Shelf',
    cap: 14,
    groups: [g('mote', 18, 0.8), g('lancer', 6, 3.5, 4), g('urchin', 4, 6, 2), g('naut', 4, 6, 10)],
  },
  {
    zone: 'The Twilight Shelf',
    cap: 14,
    groups: [g('eel', 3, 8, 1), g('siren', 3, 7, 6), g('urchin', 5, 5, 4), g('mote', 16, 1.0)],
  },
  {
    zone: 'The Twilight Shelf',
    cap: 16,
    groups: [
      g('mote', 20, 0.7),
      g('lancer', 6, 4, 3),
      g('naut', 5, 5, 6),
      g('siren', 4, 6, 8),
      g('eel', 2, 10, 10),
      g('urchin', 5, 5, 2),
    ],
  },
  { zone: 'The Sunlit Gate', cap: 8, boss: 'boss3', groups: [g('mote', 8, 5, 8)] },
];

const COST: Record<string, number> = { mote: 1, lancer: 3, urchin: 3, naut: 4, eel: 6, siren: 5 };

/** Procedurally generated endless waves. Every 5th wave is a boss. */
export function endlessWave(n: number): WaveDef {
  // n is 1-based
  if (n % 5 === 0) {
    const cycle = ((n / 5 - 1) % 3) + 1;
    const boss = (`boss${cycle}`) as 'boss1' | 'boss2' | 'boss3';
    return { zone: 'The Endless Abyss', cap: 9, boss, groups: [g('mote', 6 + n / 5, 4, 6)] };
  }
  const kinds: EnemyKind[] = ['mote'];
  if (n >= 2) kinds.push('lancer');
  if (n >= 3) kinds.push('urchin');
  if (n >= 4) kinds.push('naut');
  if (n >= 6) kinds.push('eel');
  if (n >= 7) kinds.push('siren');
  let budget = 14 + n * 7;
  const counts = new Map<EnemyKind, number>();
  // motes form the backbone
  const motes = Math.round(budget * 0.4);
  counts.set('mote', motes);
  budget -= motes;
  let guard = 200;
  while (budget > 0 && guard-- > 0) {
    const k = kinds[1 + Math.floor(Math.random() * Math.max(1, kinds.length - 1))] ?? 'mote';
    const c = COST[k];
    if (c > budget) {
      counts.set('mote', (counts.get('mote') ?? 0) + budget);
      break;
    }
    counts.set(k, (counts.get(k) ?? 0) + 1);
    budget -= c;
  }
  const groups: SpawnGroup[] = [];
  let delay = 0;
  for (const [kind, count] of counts) {
    const interval = kind === 'mote' ? Math.max(0.5, 1.2 - n * 0.03) : Math.max(2.5, 7 - n * 0.2);
    groups.push(g(kind, count, interval, delay));
    delay += 2.5;
  }
  return { zone: 'The Endless Abyss', cap: Math.min(22, 10 + n), groups };
}
