import Phaser from 'phaser';
import { buildArt } from './art';
import { BG_FRAG } from './bgShader';
import { createEnemy, Enemy, ENEMY_SCORE, Urchin } from './entities';
import { distSqPointSegment, findLoop, pointInPolygon, polygonCentroid, type Vec } from './geometry';
import { InputController } from './input';
import type { Circle, EnemyKind, Telegraph, World } from './types';
import { baseStats, rollUpgrades, type Stats, type UpgradeDef } from './upgrades';
import {
  BOSS_NAMES,
  CAMPAIGN,
  CAMPAIGN_DEPTH_START,
  DEPTH_PER_WAVE,
  endlessWave,
  type SpawnGroup,
  type WaveDef,
} from './waves';
import { audio } from '../audio/AudioEngine';
import { records, saveRecords, settings } from '../storage';
import type { UI } from '../ui/UI';

type Phase = 'attract' | 'intro' | 'playing' | 'cleared' | 'upgrade' | 'dead' | 'victory';
type Mode = 'ascent' | 'endless';

interface Orb {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  alive: boolean;
}

interface Pearl {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  alive: boolean;
}

interface Snow {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vy: number;
  drift: number;
  seed: number;
  near: boolean;
}

const WORLD_SHORT = 600; // world units across the short side of the screen
const PLAYER_R = 11;
const TRAIL_STEP = 8;
const MIN_LOOP_AREA = 1700;
const LOOP_SNAP = 15;

const D = {
  bg: 0,
  snowFar: 1,
  whale: 2,
  pearl: 15,
  orb: 16,
  tele: 18,
  trail: 20,
  flash: 22,
  playerGlow: 25,
  player: 26,
  particles: 30,
  popup: 35,
  snowNear: 50,
};

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

export class GameScene extends Phaser.Scene implements World {
  // ---- World interface
  player = { x: 0, y: 0, vx: 0, vy: 0 };
  W = 1000;
  H = 600;
  now = 0;
  speedMul = 1;
  bossTier = 0;
  tex = 3;
  get gs(): Phaser.Scene {
    return this;
  }

  ui!: UI;
  onCreated: () => void = () => {};
  private ctrl!: InputController;
  private renderScale = 1;
  private pxPerUnit = 1;

  // ---- visuals
  private bg: Phaser.GameObjects.Shader | null = null;
  private bgFallback: Phaser.GameObjects.Graphics | null = null;
  private trailGfx!: Phaser.GameObjects.Graphics;
  private teleGfx!: Phaser.GameObjects.Graphics;
  private playerSprite!: Phaser.GameObjects.Sprite;
  private playerGlow!: Phaser.GameObjects.Image;
  private playerCore!: Phaser.GameObjects.Image;
  private surgeRing!: Phaser.GameObjects.Image;
  private emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();
  private popups: Phaser.GameObjects.Text[] = [];
  private rings: Phaser.GameObjects.Image[] = [];
  private snow: Snow[] = [];
  private whale: Phaser.GameObjects.Image | null = null;
  private whaleT = 12;
  private heading = 0;
  private emberT = 0;

  // ---- state
  private phase: Phase = 'attract';
  /** Set synchronously; Phaser applies scene.pause() on its next step. */
  private paused = false;
  private mode: Mode = 'ascent';
  private enemies: Enemy[] = [];
  private orbs: Orb[] = [];
  private pearls: Pearl[] = [];
  private trail: Vec[] = [];
  private telegraphs: Telegraph[] = [];
  private stats: Stats = baseStats();
  private taken = new Map<string, number>();
  private hp = 3;
  private invuln = 0;
  private score = 0;
  private wave = 0;
  private waveDef: WaveDef | null = null;
  private groups: (SpawnGroup & { next: number; left: number })[] = [];
  private waveT = 0;
  private phaseT = 0;
  private chain = 0;
  private chainT = 0;
  private surge = 0;
  private surgeT = 0;
  private guardLeft = 0;
  private hitStop = 0;
  private slowMo = 1;
  private depth = CAMPAIGN_DEPTH_START;
  private depthVis = 0; // shader uniform
  private hue = 0;
  private flashU = 0;
  private waveHurt = false;
  private boss: Enemy | null = null;
  private seenHints = new Set<string>();
  private heartbeatT = 0;
  private pearlStreak = 0;
  private pearlStreakT = 0;
  private offeredUpgrades: UpgradeDef[] = [];
  private demoAngle = 0;
  private demoTarget: Enemy | null = null;
  private attractSpawnT = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private lowFpsTime = 0;
  private run = {
    loops: 0,
    captured: 0,
    biggest: 0,
    maxChain: 0,
    pearls: 0,
    time: 0,
    hurt: 0,
    bosses: 0,
  };

  constructor() {
    super('game');
  }

  // ================================================================== setup

  init(data: { ui: UI; tex: number; renderScale: number }): void {
    this.ui = data.ui;
    this.tex = data.tex;
    this.renderScale = data.renderScale;
  }

  create(): void {
    buildArt(this, this.tex);
    this.createBackground();
    this.trailGfx = this.add.graphics().setDepth(D.trail).setBlendMode(Phaser.BlendModes.ADD);
    this.teleGfx = this.add.graphics().setDepth(D.tele).setBlendMode(Phaser.BlendModes.ADD);

    this.playerGlow = this.add
      .image(0, 0, 'glow')
      .setTint(0xffc46b)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(1.9)
      .setAlpha(0.42)
      .setDepth(D.playerGlow);
    this.playerCore = this.add
      .image(0, 0, 'glow')
      .setTint(0xfff1cc)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.45)
      .setAlpha(0.9)
      .setDepth(D.playerGlow);
    this.surgeRing = this.add
      .image(0, 0, 'ring')
      .setTint(0xfff1cc)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.42)
      .setAlpha(0)
      .setDepth(D.playerGlow);
    this.playerSprite = this.add.sprite(0, 0, 'player', 0).setScale(1.3 / this.tex).setDepth(D.player);
    this.playerSprite.play('player');

    this.createSnow();

    const el = this.game.canvas.parentElement as HTMLElement;
    this.ctrl = new InputController(
      el,
      (cx, cy) => this.toWorld(cx, cy),
      () => 1 / this.pxPerUnit,
    );
    this.ctrl.onSurge = () => this.activateSurge();
    this.ctrl.onPause = () => this.togglePause();
    this.ctrl.onAnyInput = () => audio.unlock();

    this.scale.on('resize', () => this.layout());
    this.layout();
    this.player.x = this.W / 2;
    this.player.y = this.H / 2;
    this.ctrl.target = { x: this.W / 2, y: this.H / 2 };

    const onVis = () => {
      audio.suspend(document.hidden);
      if (document.hidden) this.autoPause();
    };
    document.addEventListener('visibilitychange', onVis);
    const onBlur = () => this.autoPause();
    window.addEventListener('blur', onBlur);
    this.events.once('destroy', () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      this.ctrl.destroy();
    });

    this.enterAttract();
    this.onCreated();
  }

  private createBackground(): void {
    const renderer = this.game.renderer;
    if (renderer.type === Phaser.WEBGL) {
      try {
        const base = new Phaser.Display.BaseShader('ocean', BG_FRAG, undefined, {
          uTime: { type: '1f', value: 0 },
          uSize: { type: '2f', value: { x: 1000, y: 600 } },
          uPlayer: { type: '2f', value: { x: 500, y: 300 } },
          uDepth: { type: '1f', value: 0 },
          uFlash: { type: '1f', value: 0 },
          uSurge: { type: '1f', value: 0 },
          uHue: { type: '1f', value: 0 },
        });
        this.bg = this.add.shader(base, 0, 0, 1000, 600).setOrigin(0, 0).setDepth(D.bg);
        return;
      } catch (err) {
        console.warn('Shader background unavailable, using fallback', err);
      }
    }
    this.bgFallback = this.add.graphics().setDepth(D.bg);
  }

  private createSnow(): void {
    const lowQ = settings.quality === 'low';
    const far = lowQ ? 40 : 70;
    const near = lowQ ? 6 : 12;
    for (let i = 0; i < far + near; i++) {
      const isNear = i >= far;
      const img = this.add
        .image(0, 0, isNear ? 'glow' : 'spark')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(isNear ? D.snowNear : D.snowFar)
        .setTint(isNear ? 0x9fdcff : 0xcfefff);
      if (isNear) img.setScale(0.12 + Math.random() * 0.14).setAlpha(0.08 + Math.random() * 0.08);
      else img.setScale(0.04 + Math.random() * 0.09).setAlpha(0.15 + Math.random() * 0.35);
      this.snow.push({
        img,
        x: Math.random() * 2000,
        y: Math.random() * 2000,
        vy: isNear ? 22 + Math.random() * 16 : 6 + Math.random() * 10,
        drift: 4 + Math.random() * 10,
        seed: Math.random() * 100,
        near: isNear,
      });
    }
  }

  /** Recomputes the world size for the current screen. Called on every resize. */
  layout(): void {
    const cssW = this.scale.width / this.renderScale;
    const cssH = this.scale.height / this.renderScale;
    this.pxPerUnit = Math.min(cssW, cssH) / WORLD_SHORT;
    const zoom = this.pxPerUnit * this.renderScale;
    const prevW = this.W;
    const prevH = this.H;
    this.W = cssW / this.pxPerUnit;
    this.H = cssH / this.pxPerUnit;
    const cam = this.cameras.main;
    cam.setZoom(zoom);
    cam.centerOn(this.W / 2, this.H / 2);
    if (this.bg) {
      this.bg.setSize(this.W, this.H);
      this.bg.setUniform('uSize.value.x', this.W);
      this.bg.setUniform('uSize.value.y', this.H);
    }
    if (this.bgFallback) {
      const g = this.bgFallback;
      g.clear();
      g.fillGradientStyle(0x08162c, 0x08162c, 0x01030a, 0x01030a, 1);
      g.fillRect(0, 0, this.W, this.H);
    }
    // keep things inside the new bounds
    if (prevW > 0 && prevH > 0) {
      const sx = this.W / prevW;
      const sy = this.H / prevH;
      this.player.x = Phaser.Math.Clamp(this.player.x * sx, PLAYER_R, this.W - PLAYER_R);
      this.player.y = Phaser.Math.Clamp(this.player.y * sy, PLAYER_R, this.H - PLAYER_R);
      this.ctrl.target.x = this.player.x;
      this.ctrl.target.y = this.player.y;
      for (const e of this.enemies) {
        e.x *= sx;
        e.y *= sy;
      }
      this.trail.length = 0;
    }
    const res = Math.min(3, Math.max(1, zoom));
    for (const t of this.popups) t.setResolution(res);
  }

  setRenderScale(s: number): void {
    this.renderScale = s;
  }

  private toWorld(cx: number, cy: number): Vec {
    const r = this.game.canvas.getBoundingClientRect();
    return { x: (cx - r.left) / this.pxPerUnit, y: (cy - r.top) / this.pxPerUnit };
  }

  // ================================================================== World API

  fireOrb(x: number, y: number, vx: number, vy: number): void {
    let o = this.orbs.find((q) => !q.alive);
    if (!o) {
      const img = this.add.image(0, 0, 'orb').setBlendMode(Phaser.BlendModes.ADD).setDepth(D.orb);
      o = { img, x: 0, y: 0, vx: 0, vy: 0, life: 0, alive: false };
      this.orbs.push(o);
    }
    o.x = x;
    o.y = y;
    o.vx = vx;
    o.vy = vy;
    o.life = 7;
    o.alive = true;
    o.img.setVisible(true).setPosition(x, y).setScale(0.05);
    this.tweens.add({ targets: o.img, scale: 0.34, duration: 200, ease: 'Back.Out' });
  }

  spawn(kind: EnemyKind, x: number, y: number, opts?: { orbit?: { host: Vec; radius: number; angle: number } }): void {
    const e = createEnemy(this, kind, x, y, opts);
    this.enemies.push(e);
    if (e.isBoss) this.boss = e;
    if (this.phase !== 'attract') this.firstSight(kind);
  }

  telegraph(t: Telegraph): void {
    this.telegraphs.push(t);
  }

  shake(intensity: number, ms: number): void {
    if (!settings.shake || this.phase === 'attract') return;
    this.cameras.main.shake(ms, intensity);
  }

  sfx(name: 'telegraph' | 'dash' | 'orbFire' | 'roar'): void {
    if (this.phase === 'attract') return;
    if (name === 'telegraph') audio.telegraph();
    else if (name === 'dash') audio.dash();
    else if (name === 'orbFire') audio.orbFire();
    else audio.bossRoar();
  }

  burst(x: number, y: number, color: number, count: number): void {
    const n = settings.quality === 'low' ? Math.ceil(count / 2) : count;
    this.emitter('spark', color).explode(n, x, y);
  }

  countAlive(kind: EnemyKind): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive && e.kind === kind) n++;
    return n;
  }

  // ================================================================== effects

  private emitter(tex: 'spark' | 'star', color: number): Phaser.GameObjects.Particles.ParticleEmitter {
    const key = `${tex}-${color}`;
    let e = this.emitters.get(key);
    if (!e) {
      const star = tex === 'star';
      e = this.add
        .particles(0, 0, tex, {
          speed: star ? { min: 20, max: 140 } : { min: 50, max: 300 },
          angle: { min: 0, max: 360 },
          lifespan: star ? { min: 600, max: 1300 } : { min: 300, max: 850 },
          scale: star ? { start: 0.4, end: 0 } : { start: 0.6, end: 0 },
          alpha: { start: 1, end: 0 },
          rotate: star ? { min: 0, max: 180 } : 0,
          tint: color,
          blendMode: Phaser.BlendModes.ADD,
          emitting: false,
        })
        .setDepth(D.particles);
      this.emitters.set(key, e);
    }
    return e;
  }

  private ringFx(x: number, y: number, color: number, toRadius: number, ms = 600, alpha = 0.9): void {
    let r = this.rings.find((q) => !q.visible);
    if (!r) {
      r = this.add.image(0, 0, 'ring').setBlendMode(Phaser.BlendModes.ADD).setDepth(D.flash);
      this.rings.push(r);
    }
    r.setVisible(true).setPosition(x, y).setTint(color).setAlpha(alpha).setScale(0.05);
    this.tweens.add({
      targets: r,
      scale: toRadius / 110,
      alpha: 0,
      duration: ms,
      ease: 'Cubic.Out',
      onComplete: () => r!.setVisible(false),
    });
  }

  private popup(x: number, y: number, text: string, color = '#fff3d1', size = 22, ms = 1000): void {
    let t = this.popups.find((p) => !p.visible);
    if (!t) {
      t = this.add
        .text(0, 0, '', {
          fontFamily: 'Outfit, system-ui, sans-serif',
          fontStyle: '700',
          fontSize: '22px',
          color: '#ffffff',
          align: 'center',
        })
        .setOrigin(0.5)
        .setDepth(D.popup)
        .setResolution(Math.min(3, Math.max(1, this.pxPerUnit * this.renderScale)));
      t.setShadow(0, 0, 'rgba(255,170,60,0.9)', 12, false, true);
      this.popups.push(t);
    }
    t.setText(text).setColor(color).setFontSize(size).setVisible(true).setAlpha(1).setScale(0.6);
    t.setPosition(Phaser.Math.Clamp(x, 80, this.W - 80), Phaser.Math.Clamp(y, 60, this.H - 40));
    this.tweens.killTweensOf(t);
    this.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.Out' });
    this.tweens.add({
      targets: t,
      y: t.y - 46,
      alpha: 0,
      delay: ms * 0.55,
      duration: ms * 0.45,
      ease: 'Quad.In',
      onComplete: () => t!.setVisible(false),
    });
  }

  private loopFlash(poly: Vec[], color: number, alpha: number): void {
    const g = this.add.graphics().setDepth(D.flash).setBlendMode(Phaser.BlendModes.ADD);
    g.fillStyle(color, 0.35);
    g.fillPoints(poly as Phaser.Types.Math.Vector2Like[], true);
    g.lineStyle(10, color, 0.25);
    g.strokePoints(poly as Phaser.Types.Math.Vector2Like[], true, true);
    g.lineStyle(3, 0xffffff, 0.9);
    g.strokePoints(poly as Phaser.Types.Math.Vector2Like[], true, true);
    g.setAlpha(alpha);
    this.tweens.add({ targets: g, alpha: 0, duration: 650, ease: 'Quad.Out', onComplete: () => g.destroy() });
  }

  private flashScreen(amount: number): void {
    if (settings.reducedFlashing) amount *= 0.25;
    this.flashU = Math.max(this.flashU, amount);
  }

  // ================================================================== flow

  enterAttract(): void {
    this.clearWorld();
    this.phase = 'attract';
    this.ctrl.enabled = false;
    this.ctrl.reset();
    this.ui.setHud(false);
    this.speedMul = 0.9;
    this.bossTier = 0;
    this.stats = baseStats();
    this.hp = 3;
    this.surge = 0;
    this.surgeT = 0;
    this.depth = CAMPAIGN_DEPTH_START * 0.6;
    this.tweenDepth(0.35, 1500);
    this.hue = 0;
    this.slowMo = 1;
    this.restorePlayerLook();
    audio.setMode('menu');
    audio.duck(false);
  }

  /** Undo the death fade so the light is whole again. */
  private restorePlayerLook(): void {
    this.tweens.killTweensOf([this.playerGlow, this.playerCore, this.player]);
    this.playerSprite.setVisible(true).setAlpha(1);
    this.playerGlow.setVisible(true).setAlpha(0.42);
    this.playerCore.setVisible(true).setAlpha(0.9);
  }

  startRun(mode: Mode): void {
    this.paused = false;
    this.scene.resume();
    this.clearWorld();
    this.mode = mode;
    this.stats = baseStats();
    this.taken.clear();
    this.hp = this.stats.maxHp;
    this.score = 0;
    this.wave = 0;
    this.chain = 0;
    this.chainT = 0;
    this.surge = 0;
    this.surgeT = 0;
    this.invuln = 0;
    this.slowMo = 1;
    this.hitStop = 0;
    this.seenHints.clear();
    this.run = { loops: 0, captured: 0, biggest: 0, maxChain: 0, pearls: 0, time: 0, hurt: 0, bosses: 0 };
    this.player.x = this.W / 2;
    this.player.y = this.H * 0.6;
    this.player.vx = this.player.vy = 0;
    this.ctrl.reset();
    this.ctrl.target = { x: this.player.x, y: this.player.y };
    this.ctrl.enabled = true;
    this.restorePlayerLook();
    this.hue = mode === 'endless' ? 0.15 : 0;
    this.ui.hideScreens();
    this.ui.resetHud();
    this.ui.setHud(true);
    audio.duck(false);
    audio.setMode('play');
    this.nextWave();
  }

  private nextWave(): void {
    this.wave++;
    const def = this.mode === 'ascent' ? CAMPAIGN[this.wave - 1] : endlessWave(this.wave);
    this.waveDef = def;
    this.groups = def.groups.map((g) => ({ ...g, next: g.delay, left: g.count }));
    this.waveT = 0;
    this.phase = 'intro';
    this.phaseT = 0;
    this.guardLeft = this.stats.threadGuard;
    this.waveHurt = false;
    this.boss = null;
    if (this.mode === 'ascent') {
      this.depth = CAMPAIGN_DEPTH_START - (this.wave - 1) * DEPTH_PER_WAVE;
      this.speedMul = 0.88 + (this.wave - 1) * 0.035;
      this.bossTier = 0;
    } else {
      this.depth = CAMPAIGN_DEPTH_START + (this.wave - 1) * 150;
      this.speedMul = Math.min(1.6, 1 + (this.wave - 1) * 0.035);
      this.bossTier = Math.floor((this.wave - 1) / 15);
      this.hue = Math.min(1, 0.15 + this.wave * 0.05);
    }
    this.tweenDepth(this.depthUniform(), 1200);
    const depthTxt = `${fmt(this.depth)} m`;
    const waveTxt = this.mode === 'ascent' ? `Wave ${this.wave} / ${CAMPAIGN.length}` : `Endless · Wave ${this.wave}`;
    this.ui.setDepth(depthTxt, waveTxt);
    this.ui.setBoss(null, 0, 0);
    if (def.boss) {
      const [name, sub] = BOSS_NAMES[def.boss];
      this.ui.banner(`${depthTxt} · ${def.zone}`, name, sub, true);
      audio.setMode('boss');
      this.after(0.6, () => audio.bossRoar());
    } else {
      this.ui.banner(depthTxt, `Wave ${this.wave}`, def.zone, false);
      audio.setMode('play');
    }
    audio.setIntensity(this.mode === 'ascent' ? this.wave / 12 : Math.min(1, this.wave / 10));
    audio.waveStart(!!def.boss);
    if (this.wave === 1) {
      const touch = document.body.classList.contains('touch');
      this.ui.hint(
        touch
          ? 'Drag anywhere to swim. <b>Cross your own trail</b> to loop creatures.'
          : 'Move the mouse (or WASD) to swim. <b>Cross your own trail</b> to loop creatures.',
      );
    }
  }

  private depthUniform(): number {
    if (this.mode === 'endless') return 0;
    return 1 - this.depth / CAMPAIGN_DEPTH_START;
  }

  private tweenDepth(to: number, ms: number): void {
    this.tweens.killTweensOf(this);
    this.tweens.add({ targets: this, depthVis: to, duration: ms, ease: 'Sine.InOut' });
  }

  /** Scene-time delayed call (pauses with the scene). */
  private after(sec: number, fn: () => void): void {
    this.time.delayedCall(sec * 1000, fn);
  }

  private waveCleared(): void {
    this.phase = 'cleared';
    this.phaseT = 0;
    this.trail.length = 0;
    this.ui.hint(null);
    for (const o of this.orbs) {
      if (!o.alive) continue;
      o.alive = false;
      o.img.setVisible(false);
      this.emitter('spark', 0xff7a4a).explode(3, o.x, o.y);
    }
    const bonus = 100 * this.wave + (this.waveHurt ? 0 : 500);
    this.score += bonus;
    this.ui.toast(this.waveDef?.boss ? 'The Dark Recedes' : 'Wave Cleared', this.waveHurt ? `+${fmt(bonus)}` : `Flawless · +${fmt(bonus)}`, 2200);
    audio.setMode('play');
    audio.setIntensity(0.1);
    this.ui.setBoss(null, 0, 0);
    // magnetise all pearls
    for (const p of this.pearls) if (p.alive) p.life = Math.max(p.life, 3);
    const finalWave = this.mode === 'ascent' && this.wave >= CAMPAIGN.length;
    if (finalWave) {
      this.after(1.2, () => this.victory());
      return;
    }
    // ascend!
    if (this.mode === 'ascent') {
      const nextDepth = this.depth - DEPTH_PER_WAVE;
      this.tweens.addCounter({
        from: this.depth,
        to: nextDepth,
        duration: 2400,
        ease: 'Sine.InOut',
        onUpdate: (tw) => {
          const v = tw.getValue() ?? nextDepth;
          this.ui.setDepth(`${fmt(v)} m`, 'Ascending…');
        },
      });
      this.tweenDepth(1 - nextDepth / CAMPAIGN_DEPTH_START, 2400);
    }
    this.after(2.6, () => this.offerUpgrades());
  }

  private offerUpgrades(): void {
    if (this.phase !== 'cleared') return;
    this.phase = 'upgrade';
    this.ctrl.enabled = false;
    this.ctrl.reset();
    this.offeredUpgrades = rollUpgrades(3, this.taken, this.stats, this.hp);
    audio.duck(true);
    this.ui.showUpgrades(
      this.mode === 'ascent' ? `Wave ${this.wave} cleared · ${fmt(this.depth - DEPTH_PER_WAVE)} m` : `Wave ${this.wave} cleared`,
      this.offeredUpgrades,
      (id) => this.taken.get(id) ?? 0,
    );
  }

  chooseUpgrade(i: number): void {
    if (this.phase !== 'upgrade') return;
    const u = this.offeredUpgrades[i];
    if (u) {
      u.apply(this.stats, (n) => {
        this.hp = Math.min(this.stats.maxHp, this.hp + n);
        audio.heal();
      });
      this.taken.set(u.id, (this.taken.get(u.id) ?? 0) + 1);
    }
    this.ui.hideScreens();
    audio.duck(false);
    this.ctrl.enabled = true;
    this.ctrl.target = { x: this.player.x, y: this.player.y };
    this.nextWave();
  }

  private victory(): void {
    this.phase = 'victory';
    this.phaseT = 0;
    this.trail.length = 0;
    this.ctrl.enabled = false;
    audio.setMode('victory');
    audio.victory();
    this.ui.setHud(false);
    this.tweenDepth(1.18, 4200);
    this.tweens.addCounter({
      from: this.depth - DEPTH_PER_WAVE,
      to: 0,
      duration: 3800,
      onUpdate: (tw) => this.ui.setDepth(`${fmt(tw.getValue() ?? 0)} m`, ''),
    });
    // the light rises toward the surface
    this.tweens.add({ targets: this.player, y: -60, duration: 4200, ease: 'Sine.In' });
    this.after(3.4, () => {
      if (!settings.reducedFlashing) this.cameras.main.flash(900, 255, 244, 214);
    });
    this.after(4.4, () => {
      const isBest = this.score > records.bestAscent;
      if (isBest) records.bestAscent = this.score;
      records.cleared = true;
      saveRecords();
      this.ui.showEnd('victory', {
        score: this.score,
        best: records.bestAscent,
        newBest: isBest,
        rows: this.endRows(),
      });
    });
  }

  private die(): void {
    this.phase = 'dead';
    this.phaseT = 0;
    this.ctrl.enabled = false;
    this.ctrl.reset();
    this.trail.length = 0;
    audio.gameOver();
    audio.setMode('gameover');
    this.slowMo = 0.3;
    this.burst(this.player.x, this.player.y, 0xffd27a, 60);
    this.emitter('star', 0xfff1cc).explode(24, this.player.x, this.player.y);
    this.ringFx(this.player.x, this.player.y, 0xffd27a, 260, 1200);
    this.playerSprite.setVisible(false);
    this.tweens.add({ targets: [this.playerGlow, this.playerCore], alpha: 0, duration: 1400 });
    this.shake(0.012, 500);
    this.after(0.7, () => (this.slowMo = 1));
    this.after(1.9, () => {
      let best: number;
      let isBest: boolean;
      if (this.mode === 'ascent') {
        isBest = this.score > records.bestAscent;
        if (isBest) records.bestAscent = this.score;
        best = records.bestAscent;
      } else {
        isBest = this.score > records.bestEndless;
        if (isBest) {
          records.bestEndless = this.score;
          records.bestEndlessWave = this.wave;
        }
        best = records.bestEndless;
      }
      saveRecords();
      this.ui.setHud(false);
      this.ui.showEnd('gameover', { score: this.score, best, newBest: isBest && this.score > 0, rows: this.endRows() });
    });
  }

  private endRows(): [string, string][] {
    const t = Math.round(this.run.time);
    const rows: [string, string][] = [
      [this.mode === 'ascent' ? 'Depth reached' : 'Waves', this.mode === 'ascent' ? `${fmt(this.phase === 'victory' ? 0 : this.depth)} m` : `${this.wave}`],
      ['Time', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
      ['Loops', fmt(this.run.loops)],
      ['Ensnared', fmt(this.run.captured)],
      ['Biggest loop', `×${this.run.biggest}`],
      ['Best chain', `×${this.run.maxChain}`],
      ['Pearls', fmt(this.run.pearls)],
      ['Bosses', `${this.run.bosses}`],
    ];
    return rows;
  }

  togglePause(): void {
    if (this.phase === 'attract' || this.phase === 'dead' || this.phase === 'victory' || this.phase === 'upgrade') return;
    if (this.paused) {
      // only resume from the pause menu itself (not from settings opened over it)
      if (this.ui.screen === 'pause') this.resumeGame();
    } else this.pauseGame();
  }

  pauseGame(): void {
    if (this.paused || this.phase === 'attract') return;
    if (!['intro', 'playing', 'cleared'].includes(this.phase)) return;
    this.paused = true;
    this.scene.pause();
    this.ctrl.reset();
    audio.duck(true);
    this.ui.setPauseStats(
      `${this.mode === 'ascent' ? `Wave ${this.wave}/${CAMPAIGN.length}` : `Endless wave ${this.wave}`} · ${fmt(this.depth)} m · ${fmt(this.score)} pts`,
    );
    this.ui.show('pause');
  }

  resumeGame(): void {
    if (!this.paused) return;
    this.ui.hideScreens();
    this.ctrl.reset();
    this.ctrl.target = { x: this.player.x, y: this.player.y };
    audio.duck(false);
    this.paused = false;
    this.scene.resume();
  }

  private autoPause(): void {
    if (['intro', 'playing', 'cleared'].includes(this.phase) && !this.paused) this.pauseGame();
  }

  restart(): void {
    this.startRun(this.mode);
  }

  quitToMenu(): void {
    this.paused = false;
    this.scene.resume();
    this.enterAttract();
  }

  get currentMode(): Mode {
    return this.mode;
  }

  private clearWorld(): void {
    for (const e of this.enemies) e.destroy();
    this.enemies.length = 0;
    for (const o of this.orbs) {
      o.alive = false;
      o.img.setVisible(false);
    }
    for (const p of this.pearls) {
      p.alive = false;
      p.img.setVisible(false);
    }
    this.trail.length = 0;
    this.boss = null;
    this.telegraphs.length = 0;
    this.teleGfx?.clear();
    this.trailGfx?.clear();
    this.time.removeAllEvents();
  }

  // ================================================================== surge

  activateSurge(): void {
    if (this.paused) return;
    if (this.phase !== 'playing' && this.phase !== 'intro') return;
    if (this.surge < 1 || this.surgeT > 0) return;
    this.surge = 0;
    this.surgeT = this.stats.surgeDuration;
    audio.surge();
    this.ringFx(this.player.x, this.player.y, 0xfff1cc, 320, 900);
    this.ringFx(this.player.x, this.player.y, 0xffd27a, 200, 700);
    this.emitter('star', 0xfff1cc).explode(30, this.player.x, this.player.y);
    this.flashScreen(0);
    this.ui.toast('SURGE', 'Unbreakable · Double score', 1200);
  }

  // ================================================================== main loop

  update(_t: number, deltaMs: number): void {
    let dt = Math.min(deltaMs / 1000, 1 / 20);
    this.trackFps(deltaMs);
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      dt *= 0.06;
    }
    dt *= this.slowMo;
    this.now += dt;
    if (this.phase !== 'attract' && this.phase !== 'dead' && this.phase !== 'victory') this.run.time += dt;

    this.ctrl.poll();
    this.updatePlayer(dt);
    this.telegraphs.length = 0;

    if (this.phase === 'attract') this.updateAttract(dt);
    else this.updateWave(dt);

    for (const e of this.enemies) if (e.alive) e.update(dt, this);
    this.separate(dt);
    this.updateOrbs(dt);
    this.updatePearls(dt);

    if (this.phase !== 'dead' && this.phase !== 'victory') {
      this.updateTrail();
      if (this.phase !== 'attract') {
        this.checkCuts();
        this.checkHits();
      }
    }
    this.cullEnemies();
    this.updateTimers(dt);
    this.drawTrail();
    this.drawTelegraphs();
    this.updateBackground(dt);
    this.updateHud();
  }

  private trackFps(deltaMs: number): void {
    if (settings.quality !== 'auto' || this.phase === 'attract') return;
    this.fpsAcc += deltaMs;
    this.fpsFrames++;
    if (this.fpsAcc >= 1000) {
      const fps = (this.fpsFrames * 1000) / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      if (fps < 46) this.lowFpsTime++;
      else this.lowFpsTime = Math.max(0, this.lowFpsTime - 1);
      if (this.lowFpsTime >= 4 && this.renderScale > 1) {
        this.lowFpsTime = 0;
        this.game.events.emit('lower-resolution');
      }
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    if (this.phase === 'dead') return;
    if (this.phase === 'victory') {
      this.syncPlayer(dt);
      return;
    }
    let speed = this.stats.speed * (this.surgeT > 0 ? 1.2 : 1);
    let dvx = 0;
    let dvy = 0;
    if (this.phase === 'attract') {
      const tgt = this.demoPoint(dt);
      const dx = tgt.x - p.x;
      const dy = tgt.y - p.y;
      const d = Math.hypot(dx, dy);
      speed = 360;
      const s = Math.min(speed, d * 6);
      dvx = d > 0 ? (dx / d) * s : 0;
      dvy = d > 0 ? (dy / d) * s : 0;
    } else if (!this.ctrl.enabled) {
      dvx = dvy = 0;
    } else if (this.ctrl.mode === 'axis' && (this.ctrl.dir.x || this.ctrl.dir.y)) {
      dvx = this.ctrl.dir.x * speed;
      dvy = this.ctrl.dir.y * speed;
      this.ctrl.target.x = p.x;
      this.ctrl.target.y = p.y;
    } else {
      const t = this.ctrl.target;
      // keep a relative-drag target from running away
      const lead = 150;
      const lx = t.x - p.x;
      const ly = t.y - p.y;
      const ld = Math.hypot(lx, ly);
      if (ld > lead && this.ctrl.lastPointerType !== 'mouse') {
        t.x = p.x + (lx / ld) * lead;
        t.y = p.y + (ly / ld) * lead;
      }
      t.x = Phaser.Math.Clamp(t.x, PLAYER_R, this.W - PLAYER_R);
      t.y = Phaser.Math.Clamp(t.y, PLAYER_R, this.H - PLAYER_R);
      const dx = t.x - p.x;
      const dy = t.y - p.y;
      const d = Math.hypot(dx, dy);
      const s = Math.min(speed, d * 10);
      if (d > 0.5) {
        dvx = (dx / d) * s;
        dvy = (dy / d) * s;
      }
    }
    const k = Math.min(1, 16 * dt);
    p.vx += (dvx - p.vx) * k;
    p.vy += (dvy - p.vy) * k;
    p.x = Phaser.Math.Clamp(p.x + p.vx * dt, PLAYER_R, this.W - PLAYER_R);
    p.y = Phaser.Math.Clamp(p.y + p.vy * dt, PLAYER_R, this.H - PLAYER_R);
    this.syncPlayer(dt);
  }

  private syncPlayer(dt: number): void {
    const p = this.player;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 20) this.heading = Phaser.Math.Angle.RotateTo(this.heading, Math.atan2(p.vy, p.vx), 12 * dt);
    const surge = this.surgeT > 0;
    const blink = this.invuln > 0 && Math.floor(this.now * 16) % 2 === 0;
    this.playerSprite
      .setPosition(p.x, p.y)
      .setRotation(this.heading)
      .setFlipY(Math.cos(this.heading) < 0)
      .setAlpha(blink ? 0.35 : 1);
    this.playerSprite.anims.timeScale = 0.8 + Math.min(1.6, sp / 300);
    const pulse = 1 + Math.sin(this.now * 4) * 0.06;
    this.playerGlow.setPosition(p.x, p.y).setScale((surge ? 2.8 : 1.9) * pulse);
    this.playerCore.setPosition(p.x, p.y).setScale(surge ? 0.7 : 0.45);
    this.surgeRing
      .setPosition(p.x, p.y)
      .setAlpha(surge ? 0.55 + Math.sin(this.now * 10) * 0.2 : 0)
      .setScale(0.36 + Math.sin(this.now * 6) * 0.03)
      .setRotation(this.now * 2);
    // trailing embers
    this.emberT -= dt;
    if (sp > 60 && this.emberT <= 0 && this.phase !== 'victory') {
      this.emberT = settings.quality === 'low' ? 0.06 : 0.03;
      this.emitter('spark', surge ? 0xfff1cc : 0xffb050).emitParticleAt(p.x - Math.cos(this.heading) * 8, p.y - Math.sin(this.heading) * 8, 1);
    }
  }

  // ------------------------------------------------------------------ attract mode

  private demoPoint(dt: number): Vec {
    if (!this.demoTarget || !this.demoTarget.alive) {
      let best: Enemy | null = null;
      let bd = Infinity;
      for (const e of this.enemies) {
        if (!e.alive || e.entering) continue;
        const d = Math.hypot(e.x - this.player.x, e.y - this.player.y);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      this.demoTarget = best;
      if (best) this.demoAngle = Math.atan2(this.player.y - best.y, this.player.x - best.x);
    }
    const t = this.demoTarget;
    if (!t) {
      return { x: this.W / 2 + Math.cos(this.now * 0.5) * this.W * 0.25, y: this.H / 2 + Math.sin(this.now * 0.8) * this.H * 0.2 };
    }
    this.demoAngle += 3.4 * dt;
    return { x: t.x + Math.cos(this.demoAngle) * 92, y: t.y + Math.sin(this.demoAngle) * 92 };
  }

  private updateAttract(dt: number): void {
    this.attractSpawnT -= dt;
    if (this.attractSpawnT <= 0 && this.enemies.length < 7) {
      this.attractSpawnT = 1.6;
      const r = Math.random();
      this.spawnAtEdge(r < 0.75 ? 'mote' : r < 0.9 ? 'naut' : 'siren');
    }
    for (const o of this.orbs) if (o.alive) o.life = Math.min(o.life, 2);
  }

  // ------------------------------------------------------------------ waves

  private spawnAtEdge(kind: EnemyKind): void {
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 8; tries++) {
      const side = Math.floor(Math.random() * 4);
      const m = 40;
      if (side === 0) {
        x = Math.random() * this.W;
        y = -m;
      } else if (side === 1) {
        x = this.W + m;
        y = Math.random() * this.H;
      } else if (side === 2) {
        x = Math.random() * this.W;
        y = this.H + m;
      } else {
        x = -m;
        y = Math.random() * this.H;
      }
      if (Math.hypot(x - this.player.x, y - this.player.y) > 260) break;
    }
    this.spawn(kind, x, y);
  }

  private updateWave(dt: number): void {
    if (this.phase === 'intro') {
      this.phaseT += dt;
      if (this.phaseT > 1.8) {
        this.phase = 'playing';
        if (this.waveDef?.boss) {
          const kind = this.waveDef.boss;
          this.spawn(kind, this.W / 2, -110);
        }
      }
      return;
    }
    if (this.phase !== 'playing') return;
    this.waveT += dt;
    let nonBoss = 0;
    for (const e of this.enemies) if (e.alive && !e.isBoss) nonBoss++;
    const cap = this.waveDef?.cap ?? 10;
    for (const g of this.groups) {
      if (g.left <= 0 || this.waveT < g.next) continue;
      if (nonBoss >= cap) {
        g.next = this.waveT + 0.5;
        continue;
      }
      this.spawnAtEdge(g.kind);
      nonBoss++;
      g.left--;
      g.next = this.waveT + g.interval;
    }
    if (this.boss) {
      this.ui.setBoss(BOSS_NAMES[this.boss.kind as 'boss1' | 'boss2' | 'boss3'][0], this.boss.hp, this.boss.maxHp);
    }
    const remaining = this.groups.some((g) => g.left > 0);
    if (!remaining && this.enemies.length === 0) this.waveCleared();
  }

  private separate(dt: number): void {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive || a.isBoss) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive || b.isBoss) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = (a.r + b.r) * 0.9;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 0.5 * Math.min(1, 10 * dt);
          a.x -= dx * push;
          a.y -= dy * push;
          b.x += dx * push;
          b.y += dy * push;
        }
      }
    }
  }

  private cullEnemies(): void {
    // eliminate anything that wandered too far (never happens normally)
    for (const e of this.enemies) {
      if (e.alive && (e.x < -400 || e.x > this.W + 400 || e.y < -400 || e.y > this.H + 400)) e.destroy();
    }
    if (this.enemies.some((e) => !e.alive)) this.enemies = this.enemies.filter((e) => e.alive);
  }

  // ------------------------------------------------------------------ projectiles & pearls

  private updateOrbs(dt: number): void {
    for (const o of this.orbs) {
      if (!o.alive) continue;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.life -= dt;
      const out = o.x < -60 || o.x > this.W + 60 || o.y < -60 || o.y > this.H + 60;
      if (o.life <= 0 || out) {
        o.alive = false;
        o.img.setVisible(false);
        continue;
      }
      o.img.setPosition(o.x, o.y).setAlpha(o.life < 0.6 ? o.life / 0.6 : 1);
      o.img.rotation += dt * 3;
    }
  }

  private dropPearls(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      let p = this.pearls.find((q) => !q.alive);
      if (!p) {
        const img = this.add.image(0, 0, 'pearl').setBlendMode(Phaser.BlendModes.ADD).setDepth(D.pearl);
        p = { img, x: 0, y: 0, vx: 0, vy: 0, life: 0, alive: false };
        this.pearls.push(p);
      }
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 120;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = 9;
      p.alive = true;
      p.img.setVisible(true).setPosition(x, y).setScale(0.32).setAlpha(1);
    }
  }

  private updatePearls(dt: number): void {
    const pl = this.player;
    const playing = this.phase !== 'attract' && this.phase !== 'dead';
    const vacuum = this.phase === 'cleared' || this.phase === 'victory';
    for (const p of this.pearls) {
      if (!p.alive) continue;
      p.life -= dt;
      const dx = pl.x - p.x;
      const dy = pl.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (playing && (d < this.stats.magnet || vacuum)) {
        const pull = vacuum ? 900 : 700;
        p.vx += (dx / d) * pull * dt;
        p.vy += (dy / d) * pull * dt;
      } else {
        p.vx *= 1 - Math.min(1, 2.5 * dt);
        p.vy *= 1 - Math.min(1, 2.5 * dt);
        p.vy -= 6 * dt; // pearls float gently upward
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (playing && d < PLAYER_R + 10) {
        this.collectPearl(p);
        continue;
      }
      if (p.life <= 0) {
        p.alive = false;
        p.img.setVisible(false);
        continue;
      }
      const blink = p.life < 2 && Math.floor(p.life * 8) % 2 === 0;
      p.img.setPosition(p.x, p.y).setAlpha(blink ? 0.3 : 1).setScale(0.3 + Math.sin(this.now * 6 + p.x) * 0.04);
    }
    this.pearlStreakT -= dt;
    if (this.pearlStreakT <= 0) this.pearlStreak = 0;
  }

  private collectPearl(p: Pearl): void {
    p.alive = false;
    p.img.setVisible(false);
    if (this.phase === 'attract') return;
    this.score += 5;
    this.run.pearls++;
    if (this.surgeT <= 0) this.surge = Math.min(1, this.surge + 0.035 * this.stats.surgeGain);
    audio.pearl(this.pearlStreak++);
    this.pearlStreakT = 0.6;
    this.emitter('spark', 0x8ffcff).explode(3, p.x, p.y);
    if (this.surge >= 1 && !this.seenHints.has('surge')) {
      this.seenHints.add('surge');
      const touch = document.body.classList.contains('touch');
      this.ui.hint(touch ? '<b>Surge is ready!</b> Tap the SURGE button.' : '<b>Surge is ready!</b> Press Space or click.', 4500);
    }
  }

  // ------------------------------------------------------------------ trail

  private trailMax(): number {
    return this.stats.trailLen * (this.surgeT > 0 ? 1.7 : 1);
  }

  private updateTrail(): void {
    const p = this.player;
    const t = this.trail;
    const last = t[t.length - 1];
    if (!last) {
      t.push({ x: p.x, y: p.y });
      return;
    }
    const d = Math.hypot(p.x - last.x, p.y - last.y);
    if (d < TRAIL_STEP) return;
    t.push({ x: p.x, y: p.y });
    // trim the tail to max length
    let len = 0;
    for (let i = t.length - 1; i > 0; i--) {
      len += Math.hypot(t[i].x - t[i - 1].x, t[i].y - t[i - 1].y);
      if (len > this.trailMax()) {
        t.splice(0, i);
        break;
      }
    }
    const loop = findLoop(t, MIN_LOOP_AREA, LOOP_SNAP);
    if (loop) this.resolveLoop(loop.polygon, loop.area);
  }

  private resolveLoop(poly: Vec[], area: number): void {
    const attract = this.phase === 'attract';
    const captured: Enemy[] = [];
    let orbsCaught = 0;
    const centroid = polygonCentroid(poly);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (!pointInPolygon(e.captureCenter(), poly)) continue;
      if (e.isBoss && area < e.minLoopArea) {
        this.popup(e.x, e.y - e.r, 'Wider!', '#ffb3d1', 20, 800);
        continue;
      }
      captured.push(e);
    }
    for (const o of this.orbs) {
      if (o.alive && pointInPolygon(o, poly)) {
        o.alive = false;
        o.img.setVisible(false);
        orbsCaught++;
        this.emitter('spark', 0xff7a4a).explode(5, o.x, o.y);
      }
    }
    for (const p of this.pearls) if (p.alive && pointInPolygon(p, poly)) this.collectPearl(p);
    this.trail.length = 0;

    const n = captured.length + orbsCaught;
    if (n === 0) {
      this.loopFlash(poly, 0xffd27a, 0.35);
      if (!attract) audio.loopClose();
      return;
    }

    // scoring
    if (!attract) {
      this.chain = this.chainT > 0 ? this.chain + 1 : 1;
      this.chainT = this.stats.chainWindow;
      this.run.loops++;
      this.run.maxChain = Math.max(this.run.maxChain, this.chain);
      this.run.biggest = Math.max(this.run.biggest, n);
    }
    let base = orbsCaught * 5;
    let destroyed = 0;
    for (const e of captured) {
      if (!e.alive) continue; // purged by a boss dying in this same loop
      base += ENEMY_SCORE[e.kind];
      const dead = e.onCaptured(this, centroid);
      if (dead) {
        destroyed++;
        this.killEnemy(e, true);
      } else {
        this.burst(e.x, e.y, e.color, 18);
        this.ringFx(e.x, e.y, e.color, e.r * 2.4, 500);
        if (!attract) {
          if (e.isBoss) {
            audio.bossHit();
            this.hitStop = 0.12;
            this.shake(0.01, 300);
            this.flashScreen(0);
            this.dropPearls(e.x, e.y, 4);
            this.popup(e.x, e.y - e.r - 10, 'WOUNDED!', '#ffb3d1', 30, 1100);
          } else {
            audio.crack();
          }
        }
      }
    }
    if (attract) {
      this.loopFlash(poly, 0xffd27a, 0.8);
      return;
    }
    this.run.captured += destroyed + orbsCaught;
    const chainMul = 1 + 0.5 * (this.chain - 1);
    const surgeMul = this.surgeT > 0 ? 2 : 1;
    const gained = Math.round(base * n * chainMul * surgeMul);
    this.score += gained;

    this.loopFlash(poly, this.surgeT > 0 ? 0xfff1cc : 0xffd27a, 1);
    audio.capture(n, this.chain, n >= 4);
    this.ringFx(centroid.x, centroid.y, 0xffd27a, Math.sqrt(area) * 0.9, 700, 0.7);
    this.emitter('star', 0xfff1cc).explode(Math.min(30, 6 + n * 3), centroid.x, centroid.y);
    if (n >= 4) {
      this.hitStop = Math.max(this.hitStop, 0.05 + Math.min(0.1, n * 0.01));
      this.shake(0.003 + Math.min(0.008, n * 0.001), 180);
    }
    const label = n >= 12 ? 'ABYSSAL!!!' : n >= 8 ? 'LUMINOUS!!' : n >= 5 ? 'RADIANT!' : n >= 3 ? 'Bright!' : '';
    const sizeBoost = Math.min(18, n * 2);
    this.popup(centroid.x, centroid.y, `+${fmt(gained)}`, '#fff3d1', 22 + sizeBoost, 1100);
    if (n >= 2) this.popup(centroid.x, centroid.y + 26 + sizeBoost * 0.6, `×${n}${this.chain > 1 ? `  ·  chain ${this.chain}` : ''}`, '#8ffcff', 15, 1100);
    if (n >= 5) this.ui.toast(label, `${n} ensnared at once`, 1300);

    // resonance shockwave
    if (this.stats.resonance > 0) {
      const R = this.stats.resonance;
      this.ringFx(centroid.x, centroid.y, 0x8ffcff, R + Math.sqrt(area) * 0.5, 600);
      const reach = R + Math.sqrt(area / Math.PI);
      for (const e of this.enemies) {
        if (!e.alive || e.isBoss || e.kind === 'naut') continue;
        if (Math.hypot(e.x - centroid.x, e.y - centroid.y) < reach && (e.kind === 'mote' || e.kind === 'lancer' || e.kind === 'siren')) {
          this.score += ENEMY_SCORE[e.kind] * surgeMul;
          this.run.captured++;
          this.killEnemy(e, false);
        }
      }
    }
    if (this.wave === 1 && !this.seenHints.has('first')) {
      this.seenHints.add('first');
      this.ui.hint('Beautiful. <b>Bigger loops</b> with more inside multiply your score.', 4000);
    }
  }

  private killEnemy(e: Enemy, scoreDrop: boolean): void {
    const attract = this.phase === 'attract';
    for (const pt of e.bodyPoints()) this.burst(pt.x, pt.y, e.color, e.isBoss ? 40 : 14);
    this.burst(e.x, e.y, 0xffffff, 6);
    this.ringFx(e.x, e.y, e.color, e.r * (e.isBoss ? 6 : 2.6), e.isBoss ? 1200 : 500);
    if (!attract) {
      const drops = e.pearls + (scoreDrop ? this.stats.pearlBonus : 0);
      this.dropPearls(e.x, e.y, drops);
    }
    if (e.isBoss) this.bossDefeated(e);
    e.destroy();
  }

  private bossDefeated(e: Enemy): void {
    this.run.bosses++;
    this.boss = null;
    audio.bossDie();
    const bonus = 1500 * (1 + this.bossTier) * (e.kind === 'boss1' ? 1 : e.kind === 'boss2' ? 1.5 : 2);
    this.score += bonus;
    this.popup(e.x, e.y, `+${fmt(bonus)}`, '#ffd27a', 40, 1800);
    this.slowMo = 0.35;
    this.after(0.5, () => (this.slowMo = 1));
    this.shake(0.016, 700);
    if (!settings.reducedFlashing) this.cameras.main.flash(500, 255, 230, 240);
    for (let i = 0; i < 4; i++) {
      this.after(i * 0.12, () => {
        this.ringFx(e.x, e.y, i % 2 ? 0xfff1cc : e.color, 200 + i * 120, 1100);
      });
    }
    this.emitter('star', 0xfff1cc).explode(40, e.x, e.y);
    // the dark recedes: purge minions and orbs
    for (const m of this.enemies) {
      if (m === e || !m.alive) continue;
      if (m instanceof Urchin) m.orbit = null;
      for (const pt of m.bodyPoints()) this.burst(pt.x, pt.y, m.color, 10);
      this.dropPearls(m.x, m.y, 1);
      m.destroy();
    }
    for (const o of this.orbs) {
      if (!o.alive) continue;
      o.alive = false;
      o.img.setVisible(false);
      this.emitter('spark', 0xff7a4a).explode(3, o.x, o.y);
    }
    for (const g of this.groups) g.left = 0;
    this.ui.setBoss(null, 0, 0);
  }

  /** Enemies that cut the thread. */
  private checkCuts(): void {
    const t = this.trail;
    if (t.length < 2) return;
    const circles: Circle[] = [];
    for (const e of this.enemies) if (e.alive && e.cutsTrail) e.cutCircles(circles);
    if (!circles.length) return;
    let cutAt = -1;
    let cutPoint: Vec | null = null;
    for (const c of circles) {
      const r2 = c.r * c.r;
      // newest segment first, so the larger, older part is removed
      for (let i = t.length - 2; i > cutAt; i--) {
        if (distSqPointSegment(c, t[i], t[i + 1]) < r2) {
          cutAt = i;
          cutPoint = c;
          break;
        }
      }
    }
    if (cutAt < 0 || !cutPoint) return;
    if (this.surgeT > 0) return; // unbreakable
    if (this.guardLeft > 0) {
      this.guardLeft--;
      this.ringFx(cutPoint.x, cutPoint.y, 0x8ffcff, 60, 400);
      this.popup(cutPoint.x, cutPoint.y - 20, 'Warded', '#8ffcff', 16, 700);
      // shove the thread clear of the cutter so the ward isn't spent twice in a row
      this.trail.splice(0, cutAt + 1);
      return;
    }
    const removed = t.splice(0, cutAt + 1);
    for (let i = 0; i < removed.length; i += 3) this.emitter('spark', 0xff8a6a).explode(1, removed[i].x, removed[i].y);
    this.burst(cutPoint.x, cutPoint.y, 0xff6a6a, 10);
    audio.sever();
    if (!this.seenHints.has('cut')) {
      this.seenHints.add('cut');
      this.ui.hint('Your thread was <b>cut</b>! Loop around spiny things, not through them.', 4000);
    }
  }

  private checkHits(): void {
    if (this.phase !== 'playing' && this.phase !== 'intro' && this.phase !== 'cleared') return;
    const p = this.player;
    const surge = this.surgeT > 0;
    if (this.invuln > 0 && !surge) return;
    const circles: Circle[] = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      circles.length = 0;
      e.hitCircles(circles);
      for (const c of circles) {
        const rr = c.r + PLAYER_R - 3;
        if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < rr * rr) {
          if (surge) {
            if (!e.isBoss) {
              this.score += ENEMY_SCORE[e.kind] * 2;
              this.run.captured++;
              this.popup(e.x, e.y, `+${ENEMY_SCORE[e.kind] * 2}`, '#fff3d1', 16, 700);
              audio.capture(1, Math.max(1, this.chain), false);
              this.killEnemy(e, true);
            }
          } else {
            this.hurt(c);
          }
          break;
        }
      }
      if (this.invuln > 0 && !surge) return;
    }
    for (const o of this.orbs) {
      if (!o.alive) continue;
      const rr = 8 + PLAYER_R - 2;
      if ((o.x - p.x) ** 2 + (o.y - p.y) ** 2 < rr * rr) {
        o.alive = false;
        o.img.setVisible(false);
        this.emitter('spark', 0xff7a4a).explode(8, o.x, o.y);
        if (!surge) {
          this.hurt(o);
          return;
        }
      }
    }
  }

  private hurt(from: Vec): void {
    this.hp--;
    this.run.hurt++;
    this.waveHurt = true;
    this.invuln = this.stats.invuln;
    const p = this.player;
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const d = Math.hypot(dx, dy) || 1;
    p.vx = (dx / d) * 520;
    p.vy = (dy / d) * 520;
    this.ctrl.target.x = p.x + (dx / d) * 60;
    this.ctrl.target.y = p.y + (dy / d) * 60;
    audio.hurt();
    this.ui.hurt();
    this.shake(0.012, 260);
    this.flashScreen(0.5);
    this.hitStop = 0.08;
    this.burst(p.x, p.y, 0xff4d6d, 20);
    this.chain = 0;
    this.chainT = 0;
    if (this.hp <= 0) this.die();
  }

  private updateTimers(dt: number): void {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.chainT > 0) {
      this.chainT -= dt;
      if (this.chainT <= 0) this.chain = 0;
    }
    if (this.surgeT > 0) {
      this.surgeT -= dt;
      if (this.surgeT <= 0) {
        this.surgeT = 0;
        audio.surgeEnd();
      }
    }
    if (this.hp === 1 && (this.phase === 'playing' || this.phase === 'intro')) {
      this.heartbeatT -= dt;
      if (this.heartbeatT <= 0) {
        this.heartbeatT = 1.4;
        audio.heartbeat();
      }
    }
    this.flashU = Math.max(0, this.flashU - dt * 2.5);
  }

  private firstSight(kind: EnemyKind): void {
    const hints: Partial<Record<EnemyKind, string>> = {
      lancer: '<b>Lancers</b> show a red line before they lunge. Slip aside!',
      urchin: '<b>Thornlings cut your thread.</b> Loop around them without touching.',
      naut: '<b>Shellbacks</b> need two loops. The first one cracks the shell.',
      eel: '<b>Ribbon eels</b> slice your thread with their bodies. Loop the head.',
      siren: '<b>Sirens</b> spit embers. Loop the embers for bonus points.',
      boss1: 'Bosses need a <b>wide loop</b> around their whole body.',
      boss2: 'Watch the jaw. When it opens, <b>get out of the line</b>.',
      boss3: 'Her thorn guard cuts your thread. Loop <b>inside the guard</b>, loop the thorns first, or <b>Surge</b> through.',
    };
    const h = hints[kind];
    if (!h || this.seenHints.has(kind)) return;
    this.seenHints.add(kind);
    this.ui.hint(h, 5200);
  }

  // ================================================================== rendering

  private drawTrail(): void {
    const g = this.trailGfx;
    g.clear();
    const t = this.trail;
    if (t.length < 2 || this.phase === 'dead') return;
    const pts: Vec[] = [...t, { x: this.player.x, y: this.player.y }];
    const surge = this.surgeT > 0;
    const n = pts.length;
    // fraction of max length used: tail flickers when near the limit
    const chunks = 6;
    const per = Math.ceil(n / chunks);
    const outer = surge ? 0xfff1cc : 0xffb44a;
    const mid = surge ? 0xffffff : 0xffd27a;
    for (let c = 0; c < chunks; c++) {
      const a = c * per;
      const b = Math.min(n - 1, (c + 1) * per);
      if (b <= a) continue;
      const slice = pts.slice(a, b + 1) as Phaser.Types.Math.Vector2Like[];
      const f = (c + 1) / chunks; // 0 tail .. 1 head
      const flick = c === 0 ? 0.6 + Math.random() * 0.4 : 1;
      g.lineStyle((surge ? 22 : 16) * (0.5 + f * 0.5), outer, 0.07 * f * flick);
      g.strokePoints(slice);
      g.lineStyle((surge ? 8 : 6) * (0.5 + f * 0.5), mid, 0.28 * f * flick);
      g.strokePoints(slice);
      g.lineStyle(surge ? 3.2 : 2.2, 0xfff6e0, (0.35 + 0.6 * f) * flick);
      g.strokePoints(slice);
    }
  }

  private drawTelegraphs(): void {
    const g = this.teleGfx;
    g.clear();
    for (const t of this.telegraphs) {
      const k = Math.min(1, t.t);
      const flick = k > 0.7 ? (Math.floor(this.now * 30) % 2 ? 1 : 0.5) : 1;
      g.lineStyle(14 * k, t.color, 0.08 * flick);
      g.lineBetween(t.x1, t.y1, t.x2, t.y2);
      // dashed core
      const dx = t.x2 - t.x1;
      const dy = t.y2 - t.y1;
      const len = Math.hypot(dx, dy);
      const steps = Math.floor(len / 18);
      g.lineStyle(2.5, t.color, (0.25 + 0.6 * k) * flick);
      for (let i = 0; i < steps; i++) {
        if (i % 2) continue;
        const a = i / steps;
        const b = Math.min(1, (i + 1) / steps);
        if (a > k) break;
        g.lineBetween(t.x1 + dx * a, t.y1 + dy * a, t.x1 + dx * b, t.y1 + dy * b);
      }
    }
  }

  private updateBackground(dt: number): void {
    const p = this.player;
    if (this.bg) {
      this.bg.setUniform('uTime.value', this.now);
      this.bg.setUniform('uPlayer.value.x', p.x);
      this.bg.setUniform('uPlayer.value.y', p.y);
      this.bg.setUniform('uDepth.value', this.depthVis);
      this.bg.setUniform('uFlash.value', this.flashU * 0.25);
      this.bg.setUniform('uSurge.value', this.surgeT > 0 ? 1 : 0);
      this.bg.setUniform('uHue.value', this.mode === 'endless' && this.phase !== 'attract' ? this.hue : 0);
    }
    // marine snow with parallax; rising (ascending) makes it stream downward
    const rising = this.phase === 'cleared' || this.phase === 'victory' ? 7 : 1;
    const cx = (p.x - this.W / 2) / this.W;
    const cy = (p.y - this.H / 2) / this.H;
    const W = this.W + 80;
    const H = this.H + 80;
    for (const s of this.snow) {
      s.y += s.vy * rising * dt;
      s.x += Math.sin(this.now * 0.5 + s.seed) * s.drift * dt;
      const par = s.near ? 40 : 10;
      let x = (((s.x - cx * par) % W) + W) % W;
      let y = (((s.y - cy * par) % H) + H) % H;
      x -= 40;
      y -= 40;
      s.img.setPosition(x, y);
      if (s.near) s.img.setScale(s.img.scaleX, s.img.scaleX * (rising > 1 ? 2.5 : 1));
    }
    // a whale-shaped silhouette passes now and then
    this.whaleT -= dt;
    if (this.whaleT <= 0 && !this.whale) {
      this.whaleT = 30 + Math.random() * 25;
      const fromLeft = Math.random() < 0.5;
      const y = this.H * (0.2 + Math.random() * 0.5);
      const sc = 0.9 + Math.random() * 0.8;
      const w = this.add
        .image(fromLeft ? -300 : this.W + 300, y, 'whale')
        .setScale(sc)
        .setFlipX(!fromLeft)
        .setAlpha(0)
        .setDepth(D.whale);
      this.whale = w;
      this.tweens.add({ targets: w, alpha: 0.32, duration: 4000 });
      this.tweens.add({
        targets: w,
        x: fromLeft ? this.W + 300 : -300,
        y: y - 40,
        duration: 42000,
        onComplete: () => {
          w.destroy();
          this.whale = null;
        },
      });
    }
  }

  private updateHud(): void {
    if (this.phase === 'attract' || !this.ui.hudVisible) return;
    this.ui.setScore(this.score);
    this.ui.setHearts(Math.max(0, this.hp), this.stats.maxHp);
    this.ui.setChain(this.chain, this.chainT / this.stats.chainWindow);
    this.ui.setSurge(this.surgeT > 0 ? this.surgeT / this.stats.surgeDuration : this.surge, this.surge >= 1 && this.surgeT <= 0, this.surgeT > 0);
  }

  // ================================================================== test hooks

  snapshot(): Record<string, unknown> {
    return {
      phase: this.phase,
      paused: this.paused,
      mode: this.mode,
      wave: this.wave,
      score: this.score,
      hp: this.hp,
      enemies: this.enemies.length,
      trail: this.trail.length,
      surge: this.surge,
      W: this.W,
      H: this.H,
      player: { x: this.player.x, y: this.player.y },
      loops: this.run.loops,
      captured: this.run.captured,
      renderScale: this.renderScale,
      foes: this.enemies.filter((e) => e.alive).map((e) => ({ kind: e.kind, x: Math.round(e.x), y: Math.round(e.y), r: e.r, hp: e.hp, entering: e.entering })),
      pxPerUnit: this.pxPerUnit,
      target: { x: this.ctrl.target.x, y: this.ctrl.target.y },
    };
  }

  debug(cmd: string): void {
    if (cmd === 'kill') {
      this.hp = 1;
      this.invuln = 0;
      this.hurt({ x: this.player.x + 1, y: this.player.y });
    } else if (cmd === 'clear') {
      for (const g of this.groups) g.left = 0;
      for (const e of [...this.enemies]) this.killEnemy(e, false);
    } else if (cmd === 'god') {
      this.invuln = 1e9;
    } else if (cmd === 'surge') {
      this.surge = 1;
    } else if (cmd.startsWith('wave:')) {
      this.wave = parseInt(cmd.slice(5), 10) - 1;
      this.clearWorld();
      this.nextWave();
    }
  }
}
