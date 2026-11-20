export interface Stats {
  trailLen: number;
  speed: number;
  maxHp: number;
  magnet: number;
  chainWindow: number;
  surgeGain: number;
  surgeDuration: number;
  resonance: number; // shockwave radius on capture (0 = none)
  invuln: number;
  threadGuard: number; // severs ignored per wave
  pearlBonus: number; // extra pearls per capture
}

export const baseStats = (): Stats => ({
  trailLen: 1250,
  speed: 470,
  maxHp: 3,
  magnet: 70,
  chainWindow: 2.6,
  surgeGain: 1,
  surgeDuration: 6,
  resonance: 0,
  invuln: 1.6,
  threadGuard: 0,
  pearlBonus: 0,
});

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  icon: string; // key into ICONS (ui)
  max: number;
  rarity: 'common' | 'rare';
  /** Whether it may be offered right now. */
  available?: (s: Stats, hp: number) => boolean;
  apply: (s: Stats, heal: (n: number) => void) => void;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'thread',
    name: 'Longer Thread',
    desc: 'Your light trail grows 22% longer. Bigger loops, bigger catches.',
    icon: 'thread',
    max: 5,
    rarity: 'common',
    apply: (s) => (s.trailLen *= 1.22),
  },
  {
    id: 'fins',
    name: 'Swift Fins',
    desc: 'Move 12% faster.',
    icon: 'fins',
    max: 4,
    rarity: 'common',
    apply: (s) => (s.speed *= 1.12),
  },
  {
    id: 'heart',
    name: 'Coral Heart',
    desc: 'Gain +1 maximum light and restore 1.',
    icon: 'heart',
    max: 3,
    rarity: 'rare',
    apply: (s, heal) => {
      s.maxHp += 1;
      heal(1);
    },
  },
  {
    id: 'mend',
    name: 'Tidal Mend',
    desc: 'Restore all lost light.',
    icon: 'mend',
    max: 99,
    rarity: 'common',
    available: (s, hp) => hp < s.maxHp,
    apply: (s, heal) => heal(s.maxHp),
  },
  {
    id: 'magnet',
    name: 'Pearl Current',
    desc: 'Pearls drift to you from 60% farther away.',
    icon: 'magnet',
    max: 3,
    rarity: 'common',
    apply: (s) => (s.magnet *= 1.6),
  },
  {
    id: 'echo',
    name: 'Echoing Chain',
    desc: 'Chains last 1 second longer between loops.',
    icon: 'chain',
    max: 3,
    rarity: 'common',
    apply: (s) => (s.chainWindow += 1),
  },
  {
    id: 'resonance',
    name: 'Resonance',
    desc: 'Every capture sends out a shockwave that ensnares nearby small foes.',
    icon: 'wave',
    max: 3,
    rarity: 'rare',
    apply: (s) => (s.resonance = s.resonance === 0 ? 85 : s.resonance + 35),
  },
  {
    id: 'surge',
    name: 'Brighter Surge',
    desc: 'Surge charges 30% faster and lasts 1.5 seconds longer.',
    icon: 'surge',
    max: 3,
    rarity: 'common',
    apply: (s) => {
      s.surgeGain *= 1.3;
      s.surgeDuration += 1.5;
    },
  },
  {
    id: 'guard',
    name: 'Woven Ward',
    desc: 'Each wave, the first 2 cuts to your thread are shrugged off.',
    icon: 'ward',
    max: 2,
    rarity: 'rare',
    apply: (s) => (s.threadGuard += 2),
  },
  {
    id: 'ghost',
    name: 'Ghostlight',
    desc: 'Stay invulnerable 0.8 seconds longer after being hit.',
    icon: 'ghost',
    max: 2,
    rarity: 'common',
    apply: (s) => (s.invuln += 0.8),
  },
  {
    id: 'bounty',
    name: 'Abyssal Bounty',
    desc: 'Every capture drops an extra pearl.',
    icon: 'pearl',
    max: 2,
    rarity: 'common',
    apply: (s) => (s.pearlBonus += 1),
  },
];

/** Picks `n` distinct upgrades weighted by rarity and respecting stack limits. */
export function rollUpgrades(n: number, taken: Map<string, number>, stats: Stats, hp: number): UpgradeDef[] {
  const pool = UPGRADES.filter(
    (u) => (taken.get(u.id) ?? 0) < u.max && (!u.available || u.available(stats, hp)),
  );
  const out: UpgradeDef[] = [];
  while (out.length < n && pool.length) {
    const weights = pool.map((u) => (u.rarity === 'rare' ? 1 : 2.2) * (u.id === 'mend' && hp <= 1 ? 3 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= weights[idx];
      if (r <= 0) break;
    }
    out.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0]);
  }
  return out;
}
