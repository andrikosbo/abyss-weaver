import Phaser from 'phaser';
import type { Circle, EnemyKind, World } from './types';
import type { Vec } from './geometry';

const TAU = Math.PI * 2;

export const ENEMY_COLORS: Record<EnemyKind, number> = {
  mote: 0xb47cff,
  lancer: 0xff4d6d,
  urchin: 0xc6ff4d,
  naut: 0x7d8bff,
  eel: 0xff3fd0,
  siren: 0xff6a4d,
  boss1: 0x9f7bff,
  boss2: 0xff3b5c,
  boss3: 0xff2fb0,
};

export const ENEMY_SCORE: Record<EnemyKind, number> = {
  mote: 10,
  lancer: 25,
  urchin: 30,
  naut: 40,
  eel: 60,
  siren: 50,
  boss1: 250,
  boss2: 300,
  boss3: 350,
};

const D_GLOW = 8;
const D_ENEMY = 12;

function angleLerp(a: number, b: number, max: number): number {
  let d = Phaser.Math.Angle.Wrap(b - a);
  if (d > max) d = max;
  if (d < -max) d = -max;
  return a + d;
}

const smoothBuf: Phaser.Types.Math.Vector2Like[] = [];

/** Catmull-Rom smoothing into a shared buffer (no per-frame allocations after warm-up). */
function smooth(pts: Phaser.Types.Math.Vector2Like[], sub = 3): Phaser.Types.Math.Vector2Like[] {
  let k = 0;
  const put = (x: number, y: number) => {
    const o = smoothBuf[k] ?? (smoothBuf[k] = { x: 0, y: 0 });
    o.x = x;
    o.y = y;
    k++;
  };
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    for (let j = 0; j < sub; j++) {
      const t = j / sub;
      const t2 = t * t;
      const t3 = t2 * t;
      put(
        0.5 * (2 * p1.x! + (-p0.x! + p2.x!) * t + (2 * p0.x! - 5 * p1.x! + 4 * p2.x! - p3.x!) * t2 + (-p0.x! + 3 * p1.x! - 3 * p2.x! + p3.x!) * t3),
        0.5 * (2 * p1.y! + (-p0.y! + p2.y!) * t + (2 * p0.y! - 5 * p1.y! + 4 * p2.y! - p3.y!) * t2 + (-p0.y! + 3 * p1.y! - 3 * p2.y! + p3.y!) * t3),
      );
    }
  }
  put(pts[n - 1].x!, pts[n - 1].y!);
  smoothBuf.length = k;
  return smoothBuf;
}

/** A glowing, tapering tentacle: soft glow pass plus a bright core that thins toward the tip. */
function tentacle(g: Phaser.GameObjects.Graphics, pts: Phaser.Types.Math.Vector2Like[], color: number, core: number, w: number): void {
  const s = smooth(pts);
  g.lineStyle(w * 3.2, color, 0.1);
  g.strokePoints(s);
  const n = s.length;
  const parts = 3;
  for (let i = 0; i < parts; i++) {
    const a = Math.floor((i / parts) * (n - 1));
    const b = Math.floor(((i + 1) / parts) * (n - 1));
    g.lineStyle(w * (1 - i * 0.28), core, 0.85 - i * 0.2);
    g.strokePoints(s.slice(a, b + 1));
  }
}

export abstract class Enemy {
  readonly kind: EnemyKind;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  r: number;
  hp = 1;
  maxHp = 1;
  alive = true;
  cutsTrail = false;
  isBoss = false;
  entering = true;
  age = 0;
  flash = 0;
  readonly seed = Math.random() * 100;
  readonly color: number;
  pearls = 1;
  /** Minimum loop area needed to capture (bosses). */
  minLoopArea = 0;
  protected sprite: Phaser.GameObjects.Sprite;
  protected glow: Phaser.GameObjects.Image;
  protected glowBase: number;

  constructor(w: World, kind: EnemyKind, x: number, y: number, r: number, texKey: string, glowSize: number) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.r = r;
    this.color = ENEMY_COLORS[kind];
    const s = w.gs;
    this.glowBase = glowSize / 128;
    this.glow = s.add
      .image(x, y, 'glow')
      .setTint(this.color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.32)
      .setScale(this.glowBase)
      .setDepth(D_GLOW);
    this.sprite = s.add.sprite(x, y, texKey, 0).setScale(1 / w.tex).setDepth(D_ENEMY);
    if (s.anims.exists(texKey)) {
      this.sprite.play({ key: texKey, startFrame: Math.floor(Math.random() * 6) });
    }
    // fade in
    this.sprite.setAlpha(0);
    s.tweens.add({ targets: this.sprite, alpha: 1, duration: 400 });
  }

  update(dt: number, w: World): void {
    this.age += dt;
    this.behave(dt, w);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.bounds(w);
    if (this.flash > 0) this.flash -= dt;
    this.sync(w);
  }

  protected abstract behave(dt: number, w: World): void;

  protected bounds(w: World): void {
    const m = this.r * 0.7;
    if (this.entering) {
      if (this.x > m && this.x < w.W - m && this.y > m && this.y < w.H - m) this.entering = false;
      return;
    }
    if (this.x < m) {
      this.x = m;
      this.vx = Math.abs(this.vx) * 0.5;
    } else if (this.x > w.W - m) {
      this.x = w.W - m;
      this.vx = -Math.abs(this.vx) * 0.5;
    }
    if (this.y < m) {
      this.y = m;
      this.vy = Math.abs(this.vy) * 0.5;
    } else if (this.y > w.H - m) {
      this.y = w.H - m;
      this.vy = -Math.abs(this.vy) * 0.5;
    }
  }

  protected sync(_w: World): void {
    this.sprite.setPosition(this.x, this.y);
    this.glow.setPosition(this.x, this.y);
    this.glow.setAlpha(0.28 + 0.08 * Math.sin(this.age * 3 + this.seed));
    if (this.flash > 0) this.sprite.setTintFill(0xffffff);
    else this.sprite.clearTint();
  }

  /** Seek toward a point with smoothing. */
  protected steer(tx: number, ty: number, speed: number, accel: number, dt: number): void {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, accel * dt);
    this.vx += ((dx / d) * speed - this.vx) * k;
    this.vy += ((dy / d) * speed - this.vy) * k;
  }

  captureCenter(): Vec {
    return this;
  }

  cutCircles(_out: Circle[]): void {}

  hitCircles(out: Circle[]): void {
    out.push({ x: this.x, y: this.y, r: this.r * 0.8 });
  }

  /** Called when enclosed in a loop. Returns true if the enemy is destroyed. */
  onCaptured(_w: World, from: Vec): boolean {
    this.hp--;
    if (this.hp <= 0) return true;
    this.flash = 0.15;
    const dx = this.x - from.x;
    const dy = this.y - from.y;
    const d = Math.hypot(dx, dy) || 1;
    this.vx = (dx / d) * 260;
    this.vy = (dy / d) * 260;
    return false;
  }

  /** Extra positions to burst particles at when destroyed. */
  bodyPoints(): Vec[] {
    return [{ x: this.x, y: this.y }];
  }

  destroy(): void {
    this.alive = false;
    this.sprite.destroy();
    this.glow.destroy();
  }
}

// ------------------------------------------------------------------ regular enemies

export class Mote extends Enemy {
  constructor(w: World, x: number, y: number) {
    super(w, 'mote', x, y, 17, 'mote', 110);
    this.sprite.setOrigin(0.5, 0.43);
  }
  protected behave(dt: number, w: World): void {
    const a =
      Math.atan2(w.player.y - this.y, w.player.x - this.x) + Math.sin(this.age * 1.2 + this.seed) * 0.75;
    const sp = (58 + (this.seed % 14)) * w.speedMul * (this.entering ? 1.4 : 1);
    const k = Math.min(1, 1.6 * dt);
    this.vx += (Math.cos(a) * sp - this.vx) * k;
    this.vy += (Math.sin(a) * sp - this.vy) * k;
    // pulse-swim bob
    this.vy += Math.sin(this.age * 5 + this.seed) * 14 * dt;
  }
  protected sync(w: World): void {
    super.sync(w);
    this.sprite.setRotation(Phaser.Math.Clamp(this.vx * 0.004, -0.4, 0.4));
  }
}

export class Lancer extends Enemy {
  private state: 'approach' | 'aim' | 'dash' | 'rest' = 'approach';
  private stateT = 0;
  private heading = 0;
  private aimX = 0;
  private aimY = 0;
  constructor(w: World, x: number, y: number) {
    super(w, 'lancer', x, y, 19, 'lancer', 120);
    this.pearls = 2;
    this.heading = Math.atan2(w.H / 2 - y, w.W / 2 - x);
  }
  protected behave(dt: number, w: World): void {
    const p = w.player;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const dist = Math.hypot(dx, dy);
    this.stateT += dt;
    const toP = Math.atan2(dy, dx);
    switch (this.state) {
      case 'approach': {
        this.heading = angleLerp(this.heading, toP, 3 * dt);
        const sp = 115 * w.speedMul;
        this.steer(this.x + Math.cos(this.heading), this.y + Math.sin(this.heading), dist > 240 ? sp : sp * 0.25, 3, dt);
        if (!this.entering && dist < 300 && this.stateT > 1.2) {
          this.state = 'aim';
          this.stateT = 0;
          w.sfx('telegraph');
        }
        break;
      }
      case 'aim': {
        const dur = 0.8 / Math.min(1.4, w.speedMul);
        if (this.stateT < dur * 0.7) this.heading = angleLerp(this.heading, toP, 6 * dt);
        this.vx *= 1 - Math.min(1, 6 * dt);
        this.vy *= 1 - Math.min(1, 6 * dt);
        this.aimX = this.x + Math.cos(this.heading) * 330;
        this.aimY = this.y + Math.sin(this.heading) * 330;
        w.telegraph({ x1: this.x, y1: this.y, x2: this.aimX, y2: this.aimY, t: this.stateT / dur, color: this.color });
        if (this.stateT >= dur) {
          this.state = 'dash';
          this.stateT = 0;
          const sp = 780 * Math.min(1.25, w.speedMul);
          this.vx = Math.cos(this.heading) * sp;
          this.vy = Math.sin(this.heading) * sp;
          w.sfx('dash');
        }
        break;
      }
      case 'dash':
        if (this.stateT > 0.42) {
          this.state = 'rest';
          this.stateT = 0;
        }
        break;
      case 'rest':
        this.vx *= 1 - Math.min(1, 3.5 * dt);
        this.vy *= 1 - Math.min(1, 3.5 * dt);
        if (this.stateT > 1.1) {
          this.state = 'approach';
          this.stateT = 0;
        }
        break;
    }
  }
  protected sync(w: World): void {
    super.sync(w);
    this.sprite.setRotation(this.heading);
    this.sprite.setFlipY(Math.cos(this.heading) < 0);
    if (this.state === 'dash') this.glow.setAlpha(0.6);
  }
}

export class Urchin extends Enemy {
  orbit: { host: Vec; radius: number; angle: number } | null = null;
  private spin = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
  constructor(w: World, x: number, y: number, orbit?: { host: Vec; radius: number; angle: number }) {
    super(w, 'urchin', x, y, 20, 'urchin', 120);
    this.cutsTrail = true;
    this.pearls = 2;
    if (orbit) {
      this.orbit = { ...orbit };
      this.entering = false;
    }
  }
  protected behave(dt: number, w: World): void {
    if (this.orbit) {
      const o = this.orbit;
      o.angle += 0.55 * dt * Math.min(1.2, w.speedMul);
      const R = o.radius + Math.sin(this.age * 0.8) * 30;
      const tx = o.host.x + Math.cos(o.angle) * R;
      const ty = o.host.y + Math.sin(o.angle) * R;
      this.vx = (tx - this.x) * 6;
      this.vy = (ty - this.y) * 6;
      return;
    }
    const a = Math.atan2(w.player.y - this.y, w.player.x - this.x) + Math.sin(this.age * 0.6 + this.seed) * 1.1;
    const sp = 34 * w.speedMul * (this.entering ? 2 : 1);
    this.steer(this.x + Math.cos(a), this.y + Math.sin(a), sp, 1.2, dt);
  }
  protected bounds(w: World): void {
    if (this.orbit) return;
    super.bounds(w);
  }
  protected sync(w: World): void {
    super.sync(w);
    this.sprite.rotation += this.spin * 0.016;
  }
  cutCircles(out: Circle[]): void {
    out.push({ x: this.x, y: this.y, r: this.r + 6 });
  }
}

export class Nautilus extends Enemy {
  private heading = 0;
  constructor(w: World, x: number, y: number) {
    super(w, 'naut', x, y, 23, 'naut', 130);
    this.hp = this.maxHp = 2;
    this.pearls = 3;
  }
  protected behave(dt: number, w: World): void {
    const toP = Math.atan2(w.player.y - this.y, w.player.x - this.x);
    this.heading = angleLerp(this.heading, toP + Math.sin(this.age + this.seed) * 0.3, 1.8 * dt);
    const sp = (this.hp < this.maxHp ? 104 : 70) * w.speedMul * (this.entering ? 1.5 : 1);
    this.steer(this.x + Math.cos(this.heading), this.y + Math.sin(this.heading), sp, 1.5, dt);
  }
  protected sync(w: World): void {
    super.sync(w);
    const face = Math.atan2(this.vy, this.vx);
    this.sprite.setRotation(face);
    this.sprite.setFlipY(Math.cos(face) < 0);
  }
  onCaptured(w: World, from: Vec): boolean {
    const dead = super.onCaptured(w, from);
    if (!dead) {
      this.sprite.play('nautCracked');
      this.glow.setTint(0xff6ad5);
    }
    return dead;
  }
}

export class Eel extends Enemy {
  private heading: number;
  private path: Vec[] = [];
  private segs: Phaser.GameObjects.Sprite[] = [];
  private segPos: Vec[] = [];
  private readonly spacing = 13;
  constructor(w: World, x: number, y: number) {
    super(w, 'eel', x, y, 15, 'eelHead', 100);
    this.pearls = 4;
    this.cutsTrail = true;
    this.heading = Math.atan2(w.H / 2 - y, w.W / 2 - x);
    for (let i = 0; i < 10; i++) {
      const s = w.gs.add
        .sprite(x, y, 'eelSeg', 0)
        .setScale((1 / w.tex) * (1 - i * 0.055))
        .setDepth(D_ENEMY - 1);
      s.play({ key: 'eelSeg', startFrame: i % 6 });
      this.segs.push(s);
      this.segPos.push({ x, y });
    }
  }
  protected behave(dt: number, w: World): void {
    const toP = Math.atan2(w.player.y - this.y, w.player.x - this.x);
    const want = toP + Math.sin(this.age * 2.1 + this.seed) * 0.95;
    this.heading = angleLerp(this.heading, want, 2.2 * dt);
    // steer away from walls
    const m = 60;
    if (!this.entering && (this.x < m || this.x > w.W - m || this.y < m || this.y > w.H - m)) {
      this.heading = angleLerp(this.heading, Math.atan2(w.H / 2 - this.y, w.W / 2 - this.x), 4 * dt);
    }
    const sp = 140 * w.speedMul;
    this.vx = Math.cos(this.heading) * sp;
    this.vy = Math.sin(this.heading) * sp;
  }
  protected sync(w: World): void {
    super.sync(w);
    this.sprite.setRotation(this.heading);
    this.sprite.setFlipY(Math.cos(this.heading) < 0);
    // record path
    const last = this.path[0];
    if (!last || Math.hypot(last.x - this.x, last.y - this.y) > 3) {
      this.path.unshift({ x: this.x, y: this.y });
      if (this.path.length > 70) this.path.pop();
    }
    // place segments along the path
    let segIdx = 0;
    let acc = 0;
    let want = 14;
    for (let i = 1; i < this.path.length && segIdx < this.segs.length; i++) {
      const a = this.path[i - 1];
      const b = this.path[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      while (acc + len >= want && segIdx < this.segs.length) {
        const t = (want - acc) / (len || 1);
        const sx = a.x + (b.x - a.x) * t;
        const sy = a.y + (b.y - a.y) * t;
        const sp = this.segPos[segIdx];
        sp.x = sx;
        sp.y = sy;
        const seg = this.segs[segIdx];
        seg.setPosition(sx, sy).setRotation(Math.atan2(a.y - b.y, a.x - b.x));
        if (this.flash > 0) seg.setTintFill(0xffffff);
        else seg.clearTint();
        segIdx++;
        want += this.spacing;
      }
      acc += len;
    }
    for (; segIdx < this.segs.length; segIdx++) {
      const sp = this.segPos[segIdx];
      const prev = segIdx > 0 ? this.segPos[segIdx - 1] : this;
      sp.x = prev.x;
      sp.y = prev.y;
      this.segs[segIdx].setPosition(sp.x, sp.y);
    }
  }
  protected bounds(w: World): void {
    if (this.entering) super.bounds(w);
  }
  cutCircles(out: Circle[]): void {
    for (let i = 1; i < this.segPos.length; i++) {
      const p = this.segPos[i];
      out.push({ x: p.x, y: p.y, r: 10 * (1 - i * 0.05) });
    }
  }
  hitCircles(out: Circle[]): void {
    out.push({ x: this.x, y: this.y, r: 14 });
  }
  bodyPoints(): Vec[] {
    return [{ x: this.x, y: this.y }, ...this.segPos.map((p) => ({ x: p.x, y: p.y }))];
  }
  destroy(): void {
    super.destroy();
    for (const s of this.segs) s.destroy();
  }
}

export class Siren extends Enemy {
  private orbitA: number;
  private fireT: number;
  private charging = false;
  private core: Phaser.GameObjects.Image;
  constructor(w: World, x: number, y: number) {
    super(w, 'siren', x, y, 22, 'siren', 140);
    this.pearls = 3;
    this.orbitA = Math.atan2(y - w.player.y, x - w.player.x);
    this.fireT = 2 + Math.random();
    this.core = w.gs.add
      .image(x, y, 'orb')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.2)
      .setDepth(D_ENEMY + 1);
  }
  protected behave(dt: number, w: World): void {
    this.orbitA += 0.28 * dt * (this.seed > 50 ? 1 : -1);
    const R = 270;
    const tx = w.player.x + Math.cos(this.orbitA) * R;
    const ty = w.player.y + Math.sin(this.orbitA) * R;
    const d = Math.hypot(tx - this.x, ty - this.y);
    this.steer(tx, ty, Math.min(95 * w.speedMul, d * 2), 2, dt);
    if (this.entering) return;
    this.fireT -= dt;
    const chargeDur = 0.8;
    this.charging = this.fireT < chargeDur;
    if (this.fireT <= 0) {
      const a = Math.atan2(w.player.y - this.y, w.player.x - this.x);
      const sp = 170 * Math.min(1.3, w.speedMul);
      const spread = w.speedMul > 1.25 ? [-0.22, 0, 0.22] : [0];
      for (const s of spread) w.fireOrb(this.x, this.y, Math.cos(a + s) * sp, Math.sin(a + s) * sp);
      w.sfx('orbFire');
      this.fireT = 3.0 / Math.min(1.4, w.speedMul) + Math.random() * 0.6;
    }
  }
  protected sync(w: World): void {
    super.sync(w);
    this.sprite.rotation += 0.004;
    const c = this.charging ? 0.2 + (1 - Math.max(0, this.fireT) / 0.8) * 0.45 : 0.2 + Math.sin(this.age * 4) * 0.03;
    this.core.setPosition(this.x, this.y).setScale(c);
  }
  destroy(): void {
    super.destroy();
    this.core.destroy();
  }
}

// ------------------------------------------------------------------ bosses

abstract class Boss extends Enemy {
  protected gfx: Phaser.GameObjects.Graphics;
  protected attackT = 2.5;
  protected summonT = 6;
  constructor(w: World, kind: EnemyKind, x: number, y: number, r: number, tex: string, hp: number) {
    super(w, kind, x, y, r, tex, r * 5);
    this.isBoss = true;
    this.hp = this.maxHp = hp + w.bossTier * 2;
    this.pearls = 10;
    this.minLoopArea = Math.PI * r * r * 0.8;
    this.gfx = w.gs.add.graphics().setDepth(D_ENEMY - 1);
    this.sprite.setScale(1 / Math.max(1.5, w.tex * 0.75));
  }
  get enraged(): boolean {
    return this.hp <= Math.ceil(this.maxHp / 2);
  }
  onCaptured(w: World, from: Vec): boolean {
    const dead = super.onCaptured(w, from);
    this.flash = 0.25;
    this.vx *= 0.6;
    this.vy *= 0.6;
    if (!dead) w.sfx('roar');
    return dead;
  }
  protected ring(w: World, n: number, speed: number, offset: number, x = this.x, y = this.y): void {
    for (let i = 0; i < n; i++) {
      const a = offset + (i / n) * TAU;
      w.fireOrb(x + Math.cos(a) * this.r * 0.6, y + Math.sin(a) * this.r * 0.6, Math.cos(a) * speed, Math.sin(a) * speed);
    }
    w.sfx('orbFire');
  }
  hitCircles(out: Circle[]): void {
    out.push({ x: this.x, y: this.y, r: this.r * 0.85 });
  }
  destroy(): void {
    super.destroy();
    this.gfx.destroy();
  }
}

/** Wave 4: a vast jellyfish that rains rings of light-eating orbs. */
export class Gloomwarden extends Boss {
  private ringOffset = 0;
  constructor(w: World, x: number, y: number) {
    super(w, 'boss1', x, y, 72, 'bossBell', 4);
    this.sprite.setOrigin(0.5, 0.56);
  }
  protected behave(dt: number, w: World): void {
    const p = w.player;
    const sp = (this.enraged ? 55 : 40) * w.speedMul * (this.entering ? 2 : 1);
    this.steer(p.x, p.y, sp, 0.8, dt);
    this.vy += Math.sin(this.age * 1.6) * 30 * dt;
    if (this.entering) return;
    this.attackT -= dt;
    if (this.attackT <= 0) {
      const n = this.enraged ? 14 : 10;
      this.ring(w, n, 120 * Math.min(1.3, w.speedMul), this.ringOffset);
      this.ringOffset += 0.3;
      this.attackT = this.enraged ? 2.8 : 4;
      if (this.enraged) {
        w.gs.time.delayedCall(450, () => {
          if (this.alive) this.ring(w, n, 95, this.ringOffset + Math.PI / n);
        });
      }
    }
    this.summonT -= dt;
    if (this.summonT <= 0) {
      this.summonT = this.enraged ? 6 : 8;
      if (w.countAlive('mote') < 8) {
        for (let i = 0; i < 3; i++) {
          const a = Math.PI * 0.25 + i * Math.PI * 0.25;
          w.spawn('mote', this.x + Math.cos(a) * 60, this.y + Math.sin(a) * 60);
        }
      }
    }
  }
  protected sync(w: World): void {
    super.sync(w);
    const pulse = Math.sin(this.age * 2.4);
    const base = 1 / Math.max(1.5, w.tex * 0.75);
    this.sprite.setScale(base * (1 + pulse * 0.05), base * (1 - pulse * 0.05));
    this.glow.setAlpha(0.35 + pulse * 0.08);
    // tentacles
    const g = this.gfx;
    g.clear();
    const n = 9;
    for (let i = 0; i < n; i++) {
      const ox = (i / (n - 1) - 0.5) * 140;
      let x = this.x + ox;
      let y = this.y + 28;
      const len = 120 + (i % 3) * 30;
      const pts: number[] = [x, y];
      for (let j = 1; j <= 10; j++) {
        y += len / 10;
        x = this.x + ox * (1 - j * 0.04) + Math.sin(this.age * 2 + j * 0.55 + i) * j * 2.2 - this.vx * j * 0.02;
        pts.push(x, y);
      }
      tentacle(g, this.toPts(pts), this.color, 0xb9a4ff, 2.6);
    }
  }
  private toPts(a: number[]): Phaser.Types.Math.Vector2Like[] {
    const out: Phaser.Types.Math.Vector2Like[] = [];
    for (let i = 0; i < a.length; i += 2) out.push({ x: a[i], y: a[i + 1] });
    return out;
  }
}

/** Wave 8: a cathedral-sized anglerfish that lunges and sings spirals. */
export class ChoirAngler extends Boss {
  private body: Phaser.GameObjects.Container;
  private jaw: Phaser.GameObjects.Image;
  private lureGlow: Phaser.GameObjects.Image;
  private heading = 0;
  private state: 'swim' | 'tele' | 'lunge' | 'recover' | 'sing' = 'swim';
  private stateT = 0;
  private orbitA = 0;
  private singA = 0;
  private singFire = 0;
  private lunges = 0;
  private lure: Vec = { x: 0, y: 0 };
  constructor(w: World, x: number, y: number) {
    super(w, 'boss2', x, y, 70, 'bossAngler', 5);
    const s = w.gs;
    const sc = 1 / Math.max(1.5, w.tex * 0.75);
    this.sprite.setOrigin(0.55, 0.55);
    this.jaw = s.add.image(-37, 32.5, 'bossJaw').setOrigin(4 / 140, 8 / 50).setScale(sc);
    this.sprite.setPosition(0, 0);
    this.body = s.add.container(x, y, [this.jaw, this.sprite]).setDepth(D_ENEMY);
    this.lureGlow = s.add
      .image(x, y, 'glow')
      .setTint(0xffe066)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(D_ENEMY + 1)
      .setScale(0.6);
    this.heading = Math.atan2(w.H / 2 - y, w.W / 2 - x);
    this.orbitA = Math.atan2(y - w.player.y, x - w.player.x);
  }
  protected behave(dt: number, w: World): void {
    const p = w.player;
    const toP = Math.atan2(p.y - this.y, p.x - this.x);
    this.stateT += dt;
    const fast = this.enraged ? 1.3 : 1;
    switch (this.state) {
      case 'swim': {
        this.orbitA += 0.35 * dt;
        const tx = p.x + Math.cos(this.orbitA) * 300;
        const ty = p.y + Math.sin(this.orbitA) * 230;
        this.steer(tx, ty, 120 * w.speedMul * fast * (this.entering ? 1.6 : 1), 1.2, dt);
        this.heading = angleLerp(this.heading, toP, 2 * dt);
        if (!this.entering && this.stateT > 2.6 / fast) {
          this.stateT = 0;
          if (Math.random() < 0.55) {
            this.state = 'tele';
            this.lunges = this.enraged ? 2 : 1;
            w.sfx('telegraph');
          } else {
            this.state = 'sing';
            this.singA = toP;
            this.singFire = 0;
          }
        }
        break;
      }
      case 'tele': {
        this.vx *= 1 - Math.min(1, 4 * dt);
        this.vy *= 1 - Math.min(1, 4 * dt);
        const dur = 0.95 / fast;
        if (this.stateT < dur * 0.75) this.heading = angleLerp(this.heading, toP, 5 * dt);
        w.telegraph({
          x1: this.x,
          y1: this.y,
          x2: this.x + Math.cos(this.heading) * 420,
          y2: this.y + Math.sin(this.heading) * 420,
          t: this.stateT / dur,
          color: this.color,
        });
        if (this.stateT >= dur) {
          this.state = 'lunge';
          this.stateT = 0;
          const sp = 640 * Math.min(1.2, w.speedMul);
          this.vx = Math.cos(this.heading) * sp;
          this.vy = Math.sin(this.heading) * sp;
          w.sfx('dash');
          w.shake(0.004, 200);
        }
        break;
      }
      case 'lunge':
        if (this.stateT > 0.6) {
          this.state = 'recover';
          this.stateT = 0;
        }
        break;
      case 'recover':
        this.vx *= 1 - Math.min(1, 3 * dt);
        this.vy *= 1 - Math.min(1, 3 * dt);
        if (this.stateT > 0.8 / fast) {
          this.stateT = 0;
          this.lunges--;
          if (this.lunges > 0) {
            this.state = 'tele';
            w.sfx('telegraph');
          } else this.state = 'swim';
        }
        break;
      case 'sing': {
        this.vx *= 1 - Math.min(1, 3 * dt);
        this.vy *= 1 - Math.min(1, 3 * dt);
        this.heading = angleLerp(this.heading, toP, 1.5 * dt);
        this.singFire -= dt;
        if (this.singFire <= 0 && this.stateT > 0.4) {
          this.singFire = this.enraged ? 0.07 : 0.1;
          this.singA += 0.52;
          const arms = this.enraged ? 3 : 2;
          for (let k = 0; k < arms; k++) {
            const a = this.singA + (k * TAU) / arms;
            const sp = 130 * Math.min(1.3, w.speedMul);
            w.fireOrb(this.lure.x, this.lure.y, Math.cos(a) * sp, Math.sin(a) * sp);
          }
          w.sfx('orbFire');
        }
        if (this.stateT > 2.2) {
          this.state = 'swim';
          this.stateT = 0;
        }
        break;
      }
    }
    this.summonT -= dt;
    if (this.summonT <= 0 && !this.entering) {
      this.summonT = this.enraged ? 7 : 10;
      if (w.countAlive('lancer') < 3) {
        w.spawn('lancer', this.x < w.W / 2 ? w.W + 40 : -40, Math.random() * w.H);
        w.spawn('lancer', Math.random() * w.W, this.y < w.H / 2 ? w.H + 40 : -40);
      }
    }
  }
  protected sync(_w: World): void {
    this.glow.setPosition(this.x, this.y);
    this.glow.setAlpha(0.32 + 0.06 * Math.sin(this.age * 3));
    const flip = Math.cos(this.heading) < 0;
    this.body.setPosition(this.x, this.y).setRotation(this.heading).setScale(1, flip ? -1 : 1);
    const open = this.state === 'tele' ? Math.min(1, this.stateT * 2) * 0.38 : this.state === 'lunge' ? 0.38 : this.state === 'sing' ? 0.25 : 0.05 + Math.sin(this.age * 2) * 0.04;
    this.jaw.setRotation(open);
    if (this.flash > 0) {
      this.sprite.setTintFill(0xffffff);
      this.jaw.setTintFill(0xffffff);
    } else {
      this.sprite.clearTint();
      this.jaw.clearTint();
    }
    // lure stalk in local space, transformed to world
    const fy = flip ? -1 : 1;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const tf = (lx: number, ly: number): Vec => ({ x: this.x + lx * c - ly * fy * s, y: this.y + lx * s + ly * fy * c });
    const sway = Math.sin(this.age * 2.5) * 6;
    const a = tf(20, -66);
    const m = tf(70, -110 + sway);
    const tip = tf(118, -70 + sway);
    this.lure = tip;
    const g = this.gfx;
    g.clear();
    const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(a.x, a.y), new Phaser.Math.Vector2(m.x, m.y), new Phaser.Math.Vector2(tip.x, tip.y));
    tentacle(g, curve.getPoints(10), this.color, 0xff9aa6, 2.4);
    const lureBright = this.state === 'tele' || this.state === 'sing' ? 1 : 0.6;
    this.lureGlow.setPosition(tip.x, tip.y).setScale(0.5 + lureBright * 0.4 + Math.sin(this.age * 6) * 0.06).setAlpha(lureBright);
  }
  bodyPoints(): Vec[] {
    return [{ x: this.x, y: this.y }, this.lure];
  }
  destroy(): void {
    super.destroy();
    this.body.destroy();
    this.lureGlow.destroy();
  }
}

/** Wave 12: the Mother of the Deep. An eye that will not close. */
export class Mother extends Boss {
  private iris: Phaser.GameObjects.Image;
  private target: Vec;
  private moveT = 0;
  private spiralT = 0;
  private spiralA = 0;
  private spiralFire = 0;
  private orbitT = 0;
  constructor(w: World, x: number, y: number) {
    super(w, 'boss3', x, y, 78, 'mother', 7);
    this.iris = w.gs.add.image(x, y, 'iris').setScale(1 / w.tex).setDepth(D_ENEMY + 1);
    this.target = { x: w.W / 2, y: w.H / 2 };
    this.attackT = 3;
    this.summonT = 9;
  }
  protected behave(dt: number, w: World): void {
    this.moveT -= dt;
    if (this.moveT <= 0) {
      this.moveT = 4.5;
      const p = w.player;
      // drift to a spot, preferring away from the player but on screen
      const mx = Math.min(w.W * 0.3, 220);
      const my = Math.min(w.H * 0.3, 200);
      this.target = {
        x: Phaser.Math.Clamp(w.W - p.x + (Math.random() - 0.5) * 200, mx, w.W - mx),
        y: Phaser.Math.Clamp(w.H - p.y + (Math.random() - 0.5) * 200, my, w.H - my),
      };
    }
    const d = Math.hypot(this.target.x - this.x, this.target.y - this.y);
    this.steer(this.target.x, this.target.y, Math.min(48 * w.speedMul * (this.entering ? 2 : 1), d), 1, dt);
    if (this.entering) return;

    // orbiting urchin shield
    this.orbitT -= dt;
    if (this.orbitT <= 0) {
      this.orbitT = 16;
      const have = w.countAlive('urchin');
      const want = this.enraged ? 3 : 2;
      for (let i = have; i < want; i++) {
        const a = (i / want) * TAU;
        w.spawn('urchin', this.x + Math.cos(a) * 190, this.y + Math.sin(a) * 190, {
          orbit: { host: this, radius: 195, angle: a },
        });
      }
    }

    if (this.spiralT > 0) {
      this.spiralT -= dt;
      this.spiralFire -= dt;
      if (this.spiralFire <= 0) {
        this.spiralFire = 0.13;
        this.spiralA += 0.33;
        const arms = this.enraged ? 4 : 3;
        for (let k = 0; k < arms; k++) {
          const a = this.spiralA + (k * TAU) / arms;
          const sp = 125 * Math.min(1.3, w.speedMul);
          w.fireOrb(this.x + Math.cos(a) * 50, this.y + Math.sin(a) * 50, Math.cos(a) * sp, Math.sin(a) * sp);
        }
        w.sfx('orbFire');
      }
      return;
    }
    this.attackT -= dt;
    if (this.attackT <= 0) {
      if (Math.random() < 0.5) {
        this.spiralT = 2.4;
      } else {
        this.ring(w, this.enraged ? 18 : 14, 115, Math.random() * TAU);
        if (this.enraged) {
          w.gs.time.delayedCall(500, () => {
            if (this.alive) this.ring(w, 18, 90, Math.random() * TAU);
          });
        }
      }
      this.attackT = this.enraged ? 3.4 : 4.5;
    }
    this.summonT -= dt;
    if (this.summonT <= 0) {
      this.summonT = this.enraged ? 9 : 12;
      if (this.enraged && w.countAlive('eel') < 2) {
        w.spawn('eel', this.x < w.W / 2 ? w.W + 40 : -40, w.H * Math.random());
      } else if (w.countAlive('mote') < 8) {
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + 0.4;
          w.spawn('mote', this.x + Math.cos(a) * 90, this.y + Math.sin(a) * 90);
        }
      }
    }
  }
  protected sync(w: World): void {
    super.sync(w);
    const breathe = 1 + Math.sin(this.age * 1.8) * 0.025;
    this.sprite.setScale((1 / Math.max(1.5, w.tex * 0.75)) * breathe);
    const a = Math.atan2(w.player.y - this.y, w.player.x - this.x);
    const dist = Math.min(14, Math.hypot(w.player.x - this.x, w.player.y - this.y) * 0.05);
    this.iris.setPosition(this.x + Math.cos(a) * dist, this.y + Math.sin(a) * dist);
    const blink = Math.sin(this.age * 0.7) > 0.985 ? 0.15 : 1;
    this.iris.setScale((1 / w.tex) * (this.enraged ? 1.15 : 1), (1 / w.tex) * blink * (this.enraged ? 1.15 : 1));
    if (this.flash > 0) this.iris.setTintFill(0xffffff);
    else this.iris.clearTint();
    const g = this.gfx;
    g.clear();
    const n = 10;
    for (let i = 0; i < n; i++) {
      const base = (i / n) * TAU + Math.sin(this.age * 0.3) * 0.2;
      const pts: Phaser.Types.Math.Vector2Like[] = [];
      for (let j = 0; j <= 9; j++) {
        const r = 70 + j * 13;
        const ang = base + Math.sin(this.age * 1.4 + j * 0.45 + i * 1.7) * 0.05 * j;
        pts.push({ x: this.x + Math.cos(ang) * r, y: this.y + Math.sin(ang) * r });
      }
      tentacle(g, pts, this.color, 0xff8fd0, 3.2);
    }
  }
  destroy(): void {
    super.destroy();
    this.iris.destroy();
  }
}

export function createEnemy(
  w: World,
  kind: EnemyKind,
  x: number,
  y: number,
  opts?: { orbit?: { host: Vec; radius: number; angle: number } },
): Enemy {
  switch (kind) {
    case 'mote':
      return new Mote(w, x, y);
    case 'lancer':
      return new Lancer(w, x, y);
    case 'urchin':
      return new Urchin(w, x, y, opts?.orbit);
    case 'naut':
      return new Nautilus(w, x, y);
    case 'eel':
      return new Eel(w, x, y);
    case 'siren':
      return new Siren(w, x, y);
    case 'boss1':
      return new Gloomwarden(w, x, y);
    case 'boss2':
      return new ChoirAngler(w, x, y);
    case 'boss3':
      return new Mother(w, x, y);
  }
}
