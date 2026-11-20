import type { Vec } from './geometry';
import { settings } from '../storage';

/**
 * Unified input: mouse (cursor target), touch (relative "trackpad" drag or
 * direct follow), keyboard and gamepad. Uses Pointer Events on the game surface
 * and tracks a single steering pointer so other fingers can press HUD buttons.
 */
export class InputController {
  /** World-space steering target (pointer modes). */
  target: Vec = { x: 0, y: 0 };
  /** Normalized direction from keys/gamepad. */
  dir: Vec = { x: 0, y: 0 };
  mode: 'pointer' | 'axis' = 'pointer';
  /** True while a finger or mouse is actively steering. */
  steering = false;
  lastPointerType: 'mouse' | 'touch' | 'pen' | 'none' = 'none';
  enabled = false;

  onSurge: () => void = () => {};
  onPause: () => void = () => {};
  onAnyInput: () => void = () => {};

  private keys = new Set<string>();
  private activeId: number | null = null;
  private lastClient: Vec = { x: 0, y: 0 };
  private padSurge = false;
  private padPause = false;
  private readonly el: HTMLElement;
  private readonly toWorld: (cx: number, cy: number) => Vec;
  private readonly unitsPerCssPx: () => number;
  private readonly cleanup: (() => void)[] = [];

  constructor(el: HTMLElement, toWorld: (cx: number, cy: number) => Vec, unitsPerCssPx: () => number) {
    this.el = el;
    this.toWorld = toWorld;
    this.unitsPerCssPx = unitsPerCssPx;
    const on = <K extends keyof HTMLElementEventMap>(
      t: HTMLElement | Window,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(el, 'pointerdown', (e) => this.down(e));
    on(el, 'pointermove', (e) => this.move(e));
    on(el, 'pointerup', (e) => this.up(e));
    on(el, 'pointercancel', (e) => this.up(e));
    on(el, 'lostpointercapture', (e) => this.up(e));
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e) => this.keyDown(e as KeyboardEvent));
    on(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code));
    on(window, 'blur', () => this.reset());
  }

  destroy(): void {
    this.cleanup.forEach((f) => f());
  }

  /** Clears all held input (focus loss, pause, orientation change). */
  reset(): void {
    this.keys.clear();
    this.activeId = null;
    this.steering = false;
    this.dir.x = this.dir.y = 0;
  }

  private down(e: PointerEvent): void {
    this.onAnyInput();
    if (!this.enabled) return;
    this.lastPointerType = e.pointerType as 'mouse' | 'touch' | 'pen';
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      this.mode = 'pointer';
      this.steering = true;
      this.setTarget(this.toWorld(e.clientX, e.clientY));
      this.onSurge(); // a mouse click fires Surge when it is charged
      return;
    }
    if (this.activeId !== null) return; // already steering with another finger
    e.preventDefault();
    this.activeId = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* some browsers reject capture for synthetic events */
    }
    this.mode = 'pointer';
    this.steering = true;
    this.lastClient = { x: e.clientX, y: e.clientY };
    if (settings.touchMode === 'direct') this.setTarget(this.directPoint(e));
  }

  private move(e: PointerEvent): void {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      this.lastPointerType = 'mouse';
      this.mode = 'pointer';
      this.steering = true;
      this.setTarget(this.toWorld(e.clientX, e.clientY));
      return;
    }
    if (e.pointerId !== this.activeId) return;
    e.preventDefault();
    if (settings.touchMode === 'direct') {
      this.setTarget(this.directPoint(e));
    } else {
      const k = this.unitsPerCssPx() * settings.touchSensitivity;
      this.setTarget({
        x: this.target.x + (e.clientX - this.lastClient.x) * k,
        y: this.target.y + (e.clientY - this.lastClient.y) * k,
      });
    }
    this.lastClient = { x: e.clientX, y: e.clientY };
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.activeId) {
      this.activeId = null;
      this.steering = false;
    }
  }

  /** In direct touch mode, steer to a point just above the finger so it stays visible. */
  private directPoint(e: PointerEvent): Vec {
    const p = this.toWorld(e.clientX, e.clientY);
    p.y -= 46 * this.unitsPerCssPx();
    return p;
  }

  private setTarget(p: Vec): void {
    this.target.x = p.x;
    this.target.y = p.y;
  }

  private keyDown(e: KeyboardEvent): void {
    this.onAnyInput();
    const code = e.code;
    if (code === 'Escape' || code === 'KeyP') {
      if (!e.repeat) this.onPause();
      return;
    }
    if (!this.enabled) return;
    if (code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyE') {
      if (!e.repeat) this.onSurge();
      e.preventDefault();
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) e.preventDefault();
    this.keys.add(code);
  }

  /** Polls keyboard + gamepad. Call once per frame. */
  poll(): void {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;

    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const mag = Math.hypot(ax, ay);
      if (mag > 0.22) {
        x += ax;
        y += ay;
      }
      const b = pad.buttons;
      if (b[12]?.pressed) y -= 1;
      if (b[13]?.pressed) y += 1;
      if (b[14]?.pressed) x -= 1;
      if (b[15]?.pressed) x += 1;
      const surge = !!(b[0]?.pressed || b[1]?.pressed || b[5]?.pressed || b[7]?.pressed);
      if (surge && !this.padSurge && this.enabled) this.onSurge();
      this.padSurge = surge;
      const pause = !!b[9]?.pressed;
      if (pause && !this.padPause) this.onPause();
      this.padPause = pause;
      if (surge || pause || mag > 0.22) this.onAnyInput();
      break;
    }
    const m = Math.hypot(x, y);
    if (m > 0.01) {
      this.dir.x = x / Math.max(1, m);
      this.dir.y = y / Math.max(1, m);
      this.mode = 'axis';
    } else {
      this.dir.x = this.dir.y = 0;
    }
  }
}
