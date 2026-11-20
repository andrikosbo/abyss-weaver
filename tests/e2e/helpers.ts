import { expect, type CDPSession, type Page, type TestInfo } from '@playwright/test';

export interface Foe {
  kind: string;
  x: number;
  y: number;
  r: number;
  entering: boolean;
}

export interface GameState {
  phase: string;
  paused: boolean;
  mode: string;
  wave: number;
  score: number;
  hp: number;
  enemies: number;
  trail: number;
  W: number;
  H: number;
  player: { x: number; y: number };
  target: { x: number; y: number };
  loops: number;
  captured: number;
  foes: Foe[];
  pxPerUnit: number;
}

/** Console errors and uncaught exceptions collected during a test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  return errors;
}

export async function boot(page: Page, debug = true): Promise<void> {
  await page.goto(debug ? './?debug' : './');
  await expect(page.locator('#screen-menu')).toHaveClass(/active/, { timeout: 45_000 });
}

export const state = (page: Page): Promise<GameState> =>
  page.evaluate(() => (window as unknown as { __aw: { state: () => GameState } }).__aw.state());

export const debug = (page: Page, cmd: string): Promise<void> =>
  page.evaluate((c) => (window as unknown as { __aw: { debug: (c: string) => void } }).__aw.debug(c), cmd);

export function isTouchProject(info: TestInfo): boolean {
  return !!info.project.use.hasTouch;
}

export function isChromium(info: TestInfo): boolean {
  return info.project.use.browserName !== 'webkit' && info.project.use.defaultBrowserType !== 'webkit';
}

/** Taps a UI control the way the device would (touch tap or mouse click). */
export async function press(page: Page, selector: string, info: TestInfo): Promise<void> {
  const loc = page.locator(selector).first();
  await expect(loc).toBeVisible();
  if (isTouchProject(info)) await loc.tap();
  else await loc.click();
}

/**
 * A finger on the game surface. Chromium gets genuine touch input through CDP
 * (the browser derives Pointer Events itself); WebKit has no CDP, so pointer
 * events with pointerType "touch" are dispatched on the game surface.
 */
export class Finger {
  private cdp: CDPSession | null = null;
  x = 0;
  y = 0;
  down = false;
  constructor(
    private page: Page,
    private chromium: boolean,
  ) {}

  async init(): Promise<void> {
    if (this.chromium) this.cdp = await this.page.context().newCDPSession(this.page);
  }

  private async synth(type: string): Promise<void> {
    await this.page.evaluate(
      ([t, x, y]) => {
        const el = document.getElementById('game')!;
        el.dispatchEvent(
          new PointerEvent(t as string, {
            pointerId: 7,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x as number,
            clientY: y as number,
            bubbles: true,
            cancelable: true,
            buttons: t === 'pointerup' ? 0 : 1,
          }),
        );
      },
      [type, this.x, this.y],
    );
  }

  async start(x: number, y: number): Promise<void> {
    this.x = x;
    this.y = y;
    this.down = true;
    if (this.cdp) await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    else await this.synth('pointerdown');
  }

  async move(x: number, y: number): Promise<void> {
    this.x = x;
    this.y = y;
    if (this.cdp) await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
    else await this.synth('pointermove');
  }

  /** A second finger taps (x, y) while this finger stays down. */
  async tapSecond(x: number, y: number): Promise<void> {
    if (this.cdp) {
      const p1 = { x: this.x, y: this.y, id: 1 };
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p1, { x, y, id: 2 }] });
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p1] });
      return;
    }
    await this.page.evaluate(
      ([px, py]) => {
        const el = document.elementFromPoint(px, py)!;
        for (const t of ['pointerdown', 'pointerup']) {
          el.dispatchEvent(
            new PointerEvent(t, { pointerId: 8, pointerType: 'touch', isPrimary: false, clientX: px, clientY: py, bubbles: true, cancelable: true }),
          );
        }
      },
      [x, y],
    );
  }

  async end(): Promise<void> {
    this.down = false;
    if (this.cdp) await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await this.synth('pointerup');
  }
}

/**
 * Actually plays: repeatedly swims a loop around the nearest creature until
 * `done(state)` is true or the time runs out. Uses the mouse on desktop and a
 * relative "trackpad" finger drag on touch devices, like a real player.
 */
export async function hunt(page: Page, info: TestInfo, done: (s: GameState) => boolean, timeoutMs = 30_000): Promise<GameState> {
  const touch = isTouchProject(info);
  const vp = page.viewportSize()!;
  const finger = new Finger(page, isChromium(info));
  if (touch) await finger.init();
  const t0 = Date.now();
  let st = await state(page);
  while (Date.now() - t0 < timeoutMs && !done(st)) {
    if (st.phase !== 'playing' && st.phase !== 'intro') {
      await page.waitForTimeout(250);
      st = await state(page);
      continue;
    }
    const foes = st.foes.filter((f) => !f.entering && !f.kind.startsWith('boss'));
    if (!foes.length) {
      await page.waitForTimeout(200);
      st = await state(page);
      continue;
    }
    foes.sort((a, b) => Math.hypot(a.x - st.player.x, a.y - st.player.y) - Math.hypot(b.x - st.player.x, b.y - st.player.y));
    const f = foes[0];
    const R = f.r + 60;
    let a = Math.atan2(st.player.y - f.y, st.player.x - f.x);
    const k = st.pxPerUnit;
    if (touch && !finger.down) await finger.start(vp.width / 2, vp.height / 2);
    for (let i = 0; i < 36; i++) {
      a += (Math.PI * 2.4) / 36;
      const wx = f.x + Math.cos(a) * R;
      const wy = f.y + Math.sin(a) * R;
      if (!touch) {
        await page.mouse.move(wx * k, wy * k);
      } else {
        // relative steering: move the finger by the offset we want the target to travel
        const cur = await state(page);
        const sens = 1.25;
        let nx = finger.x + ((wx - cur.target.x) * k) / sens;
        let ny = finger.y + ((wy - cur.target.y) * k) / sens;
        if (nx < 10 || ny < 10 || nx > vp.width - 10 || ny > vp.height - 10) {
          // lift and re-place the finger, like re-centring on a trackpad
          await finger.end();
          await finger.start(vp.width / 2, vp.height / 2);
          nx = finger.x + ((wx - cur.target.x) * k) / sens;
          ny = finger.y + ((wy - cur.target.y) * k) / sens;
        }
        await finger.move(nx, ny);
      }
      await page.waitForTimeout(24);
    }
    st = await state(page);
  }
  if (touch && finger.down) await finger.end();
  return st;
}

/** Errors that are environment noise rather than game faults. */
export function realErrors(errors: string[]): string[] {
  return errors.filter((e) => !/GPU stall|GL Driver Message|favicon/i.test(e));
}
