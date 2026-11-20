import type Phaser from 'phaser';
import type { Vec } from './geometry';

export type EnemyKind = 'mote' | 'lancer' | 'urchin' | 'naut' | 'eel' | 'siren' | 'boss1' | 'boss2' | 'boss3';

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Telegraph {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number; // 0..1 charge progress
  color: number;
}

/** What entities may see and do. Implemented by GameScene. */
export interface World {
  gs: Phaser.Scene;
  player: { x: number; y: number; vx: number; vy: number };
  W: number;
  H: number;
  now: number;
  speedMul: number;
  /** For bosses: endless-mode scaling. */
  bossTier: number;
  tex: number;
  fireOrb(x: number, y: number, vx: number, vy: number): void;
  spawn(kind: EnemyKind, x: number, y: number, opts?: { orbit?: { host: Vec; radius: number; angle: number } }): void;
  telegraph(t: Telegraph): void;
  shake(intensity: number, ms: number): void;
  sfx(name: 'telegraph' | 'dash' | 'orbFire' | 'roar'): void;
  burst(x: number, y: number, color: number, count: number, speed?: number): void;
  countAlive(kind: EnemyKind): number;
}
