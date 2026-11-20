import { resetLocalData, settings, saveSettings, records, type Quality, type TouchMode } from '../storage';
import { audio } from '../audio/AudioEngine';
import type { UpgradeDef } from '../game/upgrades';
import { ICONS } from './icons';

export type ScreenId = 'loading' | 'menu' | 'howto' | 'settings' | 'pause' | 'upgrade' | 'gameover' | 'victory';

export interface EndStats {
  score: number;
  best: number;
  newBest: boolean;
  rows: [string, string][];
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error('missing #' + id);
  return el as T;
};

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/**
 * DOM user interface: menus, HUD and overlays. Real <button>s give crisp text,
 * native focus/keyboard handling and finger-sized hit targets on every device.
 */
export class UI {
  onAction: (action: string) => void = () => {};
  onUpgrade: (i: number) => void = () => {};
  onSettingsChanged: () => void = () => {};

  private current: ScreenId = 'loading';
  private settingsReturn: ScreenId = 'menu';
  private hudOn = false;
  private cache: Record<string, string | number | boolean> = {};
  private toastTimer = 0;
  private hintTimer = 0;
  private bannerTimer = 0;
  private upgradeLocked = false;
  private padPrev: Record<string, boolean> = {};
  private readonly resetDialog = $<HTMLDialogElement>('reset-dialog');

  constructor() {
    document.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action!;
      if (action === 'surge') return; // handled on pointerdown for zero latency
      audio.unlock();
      audio.ui();
      this.handle(action);
    });
    const surge = $('hud-surge');
    surge.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      audio.unlock();
      this.onAction('surge');
    });
    surge.addEventListener('click', (e) => {
      // keyboard activation (Enter/Space while focused)
      if ((e as MouseEvent).detail === 0) this.onAction('surge');
    });
    document.addEventListener('keydown', (e) => this.key(e));
    this.bindSettings();
    const fsBtn = $('btn-fullscreen');
    const doc = document as Document & { webkitFullscreenEnabled?: boolean };
    if (doc.fullscreenEnabled || doc.webkitFullscreenEnabled) fsBtn.hidden = false;
    // Mark touch devices so desktop-only hints (key labels) hide.
    const markTouch = (e: PointerEvent) => document.body.classList.toggle('touch', e.pointerType !== 'mouse');
    window.addEventListener('pointerdown', markTouch, { passive: true });
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    requestAnimationFrame(() => this.padLoop());
  }

  // ------------------------------------------------------------------ navigation

  private handle(action: string): void {
    switch (action) {
      case 'howto':
        this.show('howto');
        break;
      case 'settings':
        this.settingsReturn = this.current;
        this.syncSettings();
        this.show('settings');
        break;
      case 'back':
        this.show(this.current === 'settings' ? this.settingsReturn : 'menu');
        break;
      case 'fullscreen':
        this.toggleFullscreen();
        break;
      default:
        this.onAction(action);
    }
  }

  show(id: ScreenId): void {
    document.querySelectorAll('.screen:not(.hud)').forEach((s) => s.classList.remove('active'));
    $(`screen-${id}`).classList.add('active');
    this.current = id;
    if (id === 'menu') this.renderRecords();
    // focus the first control for keyboard/gamepad users, without scrolling
    const first = $(`screen-${id}`).querySelector<HTMLElement>('button, input');
    if (first && id !== 'loading') {
      // only steal focus for keyboard-ish flows; avoids iOS focus rings after taps
      if (!document.body.classList.contains('touch')) first.focus({ preventScroll: true });
      else (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }

  hideScreens(): void {
    document.querySelectorAll('.screen:not(.hud)').forEach((s) => s.classList.remove('active'));
    this.current = 'loading';
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  get screen(): ScreenId | null {
    return document.querySelector('.screen.active:not(.hud)') ? this.current : null;
  }

  setHud(on: boolean): void {
    this.hudOn = on;
    $('screen-hud').classList.toggle('active', on);
    document.body.classList.toggle('playing', on);
  }

  private focusables(): HTMLElement[] {
    const scr = this.resetDialog.open ? this.resetDialog : document.querySelector('.screen.active:not(.hud)');
    if (!scr) return [];
    return Array.from(scr.querySelectorAll<HTMLElement>('button:not([hidden]), input, a[href]')).filter(
      (el) => el.offsetParent !== null,
    );
  }

  private moveFocus(delta: number): void {
    const els = this.focusables();
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    const next = els[(i + delta + els.length) % els.length] ?? els[0];
    next.focus({ preventScroll: false });
  }

  private key(e: KeyboardEvent): void {
    const scr = this.screen;
    if (this.resetDialog.open || !scr || scr === 'loading') return;
    if (scr === 'upgrade' && ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].includes(e.code)) {
      const i = parseInt(e.code.slice(-1), 10) - 1;
      const card = document.querySelectorAll<HTMLButtonElement>('#upgrade-cards .card')[i];
      card?.click();
      return;
    }
    const target = e.target as HTMLElement;
    const isRange = target instanceof HTMLInputElement && target.type === 'range';
    if (e.code === 'ArrowDown' || (e.code === 'ArrowRight' && !isRange && scr === 'upgrade')) {
      e.preventDefault();
      this.moveFocus(1);
    } else if (e.code === 'ArrowUp' || (e.code === 'ArrowLeft' && !isRange && scr === 'upgrade')) {
      e.preventDefault();
      this.moveFocus(-1);
    } else if (e.code === 'Escape' && (scr === 'howto' || scr === 'settings')) {
      this.handle('back');
    }
  }

  /** Gamepad navigation for menus. */
  private padLoop(): void {
    requestAnimationFrame(() => this.padLoop());
    const scr = this.screen;
    if (!scr || scr === 'loading' || typeof navigator.getGamepads !== 'function') return;
    const pad = Array.from(navigator.getGamepads()).find((p) => p);
    if (!pad) return;
    const ay = pad.axes[1] ?? 0;
    const ax = pad.axes[0] ?? 0;
    const st: Record<string, boolean> = {
      down: ay > 0.5 || ax > 0.5 || !!pad.buttons[13]?.pressed || !!pad.buttons[15]?.pressed,
      up: ay < -0.5 || ax < -0.5 || !!pad.buttons[12]?.pressed || !!pad.buttons[14]?.pressed,
      a: !!pad.buttons[0]?.pressed,
      b: !!pad.buttons[1]?.pressed,
    };
    const edge = (k: string) => st[k] && !this.padPrev[k];
    if (edge('down')) this.moveFocus(1);
    if (edge('up')) this.moveFocus(-1);
    if (edge('a')) {
      const el = document.activeElement as HTMLElement | null;
      if (el && this.focusables().includes(el)) el.click();
      else this.focusables()[0]?.focus();
    }
    if (edge('b')) {
      if (this.resetDialog.open) this.resetDialog.close('cancel');
      else if (scr === 'howto' || scr === 'settings') this.handle('back');
      else if (scr === 'pause') this.onAction('resume');
    }
    this.padPrev = st;
  }

  private toggleFullscreen(): void {
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        if (doc.exitFullscreen) void doc.exitFullscreen();
        else doc.webkitExitFullscreen?.();
      } else if (el.requestFullscreen) {
        void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      } else el.webkitRequestFullscreen?.();
    } catch {
      /* fullscreen not permitted */
    }
  }

  // ------------------------------------------------------------------ loading / menu

  setLoading(frac: number, text: string): void {
    $('loading-fill').style.width = `${Math.round(frac * 100)}%`;
    $('loading-text').textContent = text;
  }

  renderRecords(): void {
    const parts: string[] = [];
    if (records.bestAscent > 0) parts.push(`Best ascent <b>${fmt(records.bestAscent)}</b>`);
    if (records.bestEndless > 0) parts.push(`Endless <b>${fmt(records.bestEndless)}</b> · wave ${records.bestEndlessWave}`);
    if (records.cleared) parts.push('<b>☀</b> Surface reached');
    $('records').innerHTML = parts.join(' &nbsp;·&nbsp; ');
  }

  buildBestiary(draw: (key: string, canvas: HTMLCanvasElement) => void): void {
    const beasts: [string, string, string][] = [
      ['mote', 'Gloam Mote', 'Drifts toward your light. Easy prey in numbers.'],
      ['lancer', 'Lancer', 'Aims its lure, then lunges. Watch the red line.'],
      ['urchin', 'Thornling', 'Cuts your thread. Loop around, never through.'],
      ['naut', 'Shellback', 'Armoured. Its shell cracks on the first loop.'],
      ['eelHead', 'Ribbon Eel', 'Its long body slices your thread. Loop the head.'],
      ['siren', 'Siren', 'Spits embers. Loop the embers for bonus points.'],
    ];
    const box = $('bestiary');
    box.innerHTML = '';
    for (const [key, name, desc] of beasts) {
      const d = document.createElement('div');
      d.className = 'beast';
      const c = document.createElement('canvas');
      c.width = c.height = 92;
      draw(key, c);
      const t = document.createElement('div');
      t.innerHTML = `<div class="beast-name">${name}</div><div class="beast-desc">${desc}</div>`;
      d.append(c, t);
      box.append(d);
    }
  }

  // ------------------------------------------------------------------ settings

  private bindSettings(): void {
    const music = $<HTMLInputElement>('set-music');
    const sfx = $<HTMLInputElement>('set-sfx');
    const sens = $<HTMLInputElement>('set-sens');
    music.addEventListener('input', () => {
      settings.music = +music.value / 100;
      this.settingsChanged();
    });
    sfx.addEventListener('input', () => {
      settings.sfx = +sfx.value / 100;
      this.settingsChanged();
    });
    sfx.addEventListener('change', () => audio.pearl(4));
    sens.addEventListener('input', () => {
      settings.touchSensitivity = +sens.value / 100;
      this.settingsChanged();
    });
    const seg = (id: string, apply: (v: string) => void) => {
      $(id).addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]');
        if (!b) return;
        audio.unlock();
        audio.ui();
        apply(b.dataset.value!);
        this.settingsChanged();
      });
    };
    seg('set-quality', (v) => (settings.quality = v as Quality));
    seg('set-touch', (v) => (settings.touchMode = v as TouchMode));
    const toggle = (id: string, apply: () => void) => {
      $(id).addEventListener('click', () => {
        audio.unlock();
        audio.ui();
        apply();
        this.settingsChanged();
      });
    };
    toggle('set-shake', () => (settings.shake = !settings.shake));
    toggle('set-flash', () => (settings.reducedFlashing = !settings.reducedFlashing));
    const resetStatus = $('reset-status');
    $('reset-game-data').addEventListener('click', () => {
      resetStatus.textContent = '';
      this.resetDialog.showModal();
    });
    this.resetDialog.addEventListener('close', () => {
      const shouldReset = this.resetDialog.returnValue === 'reset';
      this.resetDialog.returnValue = '';
      if (!shouldReset) return;
      const cleared = resetLocalData();
      this.syncSettings();
      this.onSettingsChanged();
      resetStatus.textContent = cleared ? 'Local game data cleared.' : 'Reset for this session. Browser storage could not be cleared.';
    });
  }

  private settingsChanged(): void {
    saveSettings();
    this.syncSettings();
    this.onSettingsChanged();
  }

  syncSettings(): void {
    $<HTMLInputElement>('set-music').value = String(Math.round(settings.music * 100));
    $<HTMLInputElement>('set-sfx').value = String(Math.round(settings.sfx * 100));
    $<HTMLInputElement>('set-sens').value = String(Math.round(settings.touchSensitivity * 100));
    const segSync = (id: string, v: string) =>
      $(id)
        .querySelectorAll('button')
        .forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === v)));
    segSync('set-quality', settings.quality);
    segSync('set-touch', settings.touchMode);
    $('set-shake').setAttribute('aria-checked', String(settings.shake));
    $('set-flash').setAttribute('aria-checked', String(settings.reducedFlashing));
  }

  // ------------------------------------------------------------------ HUD

  private set(key: string, value: string | number | boolean, fn: () => void): void {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn();
  }

  resetHud(): void {
    this.cache = {};
    $('hud-chain').classList.remove('on');
    $('hud-hint').classList.remove('on');
    $('hud-toast').classList.remove('on');
    $('hud-boss').hidden = true;
  }

  setScore(score: number): void {
    this.set('score', Math.round(score), () => {
      const el = $('hud-score');
      el.textContent = fmt(score);
      el.classList.add('bump');
      window.setTimeout(() => el.classList.remove('bump'), 120);
    });
  }

  setHearts(hp: number, max: number): void {
    this.set('hearts', hp * 100 + max, () => {
      const box = $('hud-hearts');
      box.innerHTML = '';
      for (let i = 0; i < max; i++) {
        const h = document.createElement('div');
        h.className = 'heart' + (i < hp ? '' : ' lost');
        box.append(h);
      }
    });
  }

  setDepth(depth: string, wave: string): void {
    this.set('depth', depth, () => ($('hud-depth').textContent = depth));
    this.set('wave', wave, () => ($('hud-wave').textContent = wave));
  }

  setBoss(name: string | null, hp: number, max: number): void {
    this.set('boss', `${name}|${hp}|${max}`, () => {
      const bar = $('hud-boss');
      bar.hidden = !name;
      if (!name) return;
      $('hud-boss-name').textContent = name;
      const pips = $('hud-boss-pips');
      pips.innerHTML = '';
      for (let i = 0; i < max; i++) {
        const p = document.createElement('div');
        p.className = 'pip' + (i < hp ? '' : ' gone');
        pips.append(p);
      }
    });
  }

  setChain(chain: number, frac: number): void {
    const on = chain >= 2;
    this.set('chainOn', on, () => $('hud-chain').classList.toggle('on', on));
    if (!on) return;
    this.set('chain', chain, () => {
      $('hud-chain').innerHTML = `CHAIN ×${chain}<small>LOOP AGAIN</small><div class="chain-meter" id="hud-chain-meter"></div>`;
    });
    const meter = document.getElementById('hud-chain-meter');
    if (meter) meter.style.transform = `scaleX(${Math.max(0, frac).toFixed(3)})`;
  }

  setSurge(frac: number, ready: boolean, active: boolean): void {
    const f = Math.round(frac * 100) / 100;
    this.set('surgeF', f, () => {
      $('hud-surge-fill').style.strokeDashoffset = String(276.46 * (1 - f));
    });
    this.set('surgeR', ready, () => $('hud-surge').classList.toggle('ready', ready));
    this.set('surgeA', active, () => $('hud-surge').classList.toggle('active', active));
  }

  hint(html: string | null, ms = 0): void {
    const el = $('hud-hint');
    window.clearTimeout(this.hintTimer);
    if (!html) {
      el.classList.remove('on');
      return;
    }
    el.innerHTML = html;
    el.classList.add('on');
    if (ms > 0) this.hintTimer = window.setTimeout(() => el.classList.remove('on'), ms);
  }

  toast(title: string, sub = '', ms = 1600): void {
    const el = $('hud-toast');
    el.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    el.classList.add('on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('on'), ms);
  }

  banner(depth: string, title: string, sub: string, boss: boolean): void {
    const el = $('banner');
    $('banner-depth').textContent = depth;
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub;
    el.classList.toggle('boss', boss);
    el.classList.remove('on');
    void el.offsetWidth; // restart animation
    el.classList.add('on');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => el.classList.remove('on'), 3100);
  }

  clearBanner(): void {
    $('banner').classList.remove('on');
  }

  hurt(): void {
    if (settings.reducedFlashing) return;
    const el = $('hurt');
    el.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
  }

  setPauseStats(text: string): void {
    $('pause-stats').textContent = text;
  }

  // ------------------------------------------------------------------ upgrades / end

  showUpgrades(kicker: string, defs: UpgradeDef[], stacks: (id: string) => number): void {
    $('upgrade-kicker').textContent = kicker;
    const box = $('upgrade-cards');
    box.innerHTML = '';
    this.upgradeLocked = true;
    defs.forEach((u, i) => {
      const b = document.createElement('button');
      b.className = 'card' + (u.rarity === 'rare' ? ' rare' : '');
      const n = stacks(u.id);
      b.innerHTML = `
        <span class="card-key">${i + 1}</span>
        <span class="card-icon">${ICONS[u.icon] ?? ''}</span>
        <span class="card-body">
          <span class="card-name">${u.name}</span>
          <span class="card-desc">${u.desc}</span>
        </span>
        <span class="card-meta"><span>${u.rarity}</span><span>${u.max < 99 ? `${n}/${u.max}` : ''}</span></span>`;
      b.addEventListener('click', () => {
        if (this.upgradeLocked) return;
        this.upgradeLocked = true;
        audio.upgrade();
        this.onUpgrade(i);
      });
      box.append(b);
    });
    this.show('upgrade');
    // brief lock prevents an in-flight gameplay tap from picking a card blindly
    window.setTimeout(() => (this.upgradeLocked = false), 450);
  }

  showEnd(kind: 'gameover' | 'victory', s: EndStats): void {
    const pre = kind === 'gameover' ? 'over' : 'win';
    $(`${pre}-score`).textContent = '0';
    $(`${pre}-best`).textContent = s.newBest ? '★ New record ★' : s.best > 0 ? `Best ${fmt(s.best)}` : '';
    $(`${pre}-stats`).innerHTML = s.rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    this.show(kind);
    // count-up
    const el = $(`${pre}-score`);
    const t0 = performance.now();
    const dur = 1200;
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / dur);
      el.textContent = fmt(s.score * (1 - Math.pow(1 - t, 3)));
      if (t < 1 && this.current === kind) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  get hudVisible(): boolean {
    return this.hudOn;
  }
}
