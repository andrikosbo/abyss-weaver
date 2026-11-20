import { expect, test } from '@playwright/test';
import { boot, debug, Finger, hunt, isChromium, isTouchProject, press, realErrors, state, watchErrors } from './helpers';

test.describe('Abyss Weaver', () => {
  test('boots to the menu cleanly and fits the viewport', async ({ page }, info) => {
    const errors = watchErrors(page);
    await boot(page, false);
    await expect(page.locator('h1.title')).toContainText('ABYSS');
    const renderer = await page.evaluate(() => (window as unknown as { __aw: { renderer: string } }).__aw.renderer);
    expect(renderer).toBe('webgl');

    // canvas covers the viewport
    const vp = page.viewportSize()!;
    const box = await page.locator('#game canvas').boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - vp.width)).toBeLessThan(2);
    expect(Math.abs(box!.height - vp.height)).toBeLessThan(2);

    // no page-level scrolling or horizontal overflow
    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      sy: window.scrollY,
    }));
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw);
    expect(overflow.sy).toBe(0);

    // all primary menu buttons are visible, inside the viewport, and finger sized
    for (const sel of ['#screen-menu [data-action=ascent]', '#screen-menu [data-action=endless]', '#screen-menu [data-action=howto]', '#screen-menu [data-action=settings]']) {
      const b = await page.locator(sel).boundingBox();
      expect(b, sel).not.toBeNull();
      expect(b!.y + b!.height).toBeLessThanOrEqual(vp.height + 1);
      expect(b!.height).toBeGreaterThanOrEqual(44);
    }
    // dorothy.gr logo: loaded, linked, opens in a new tab, reachable
    const brand = page.locator('#screen-menu a.brand');
    await expect(brand).toHaveAttribute('href', 'https://dorothy.gr');
    await expect(brand).toHaveAttribute('target', '_blank');
    await expect(brand).toHaveAttribute('rel', /noopener/);
    await brand.scrollIntoViewIfNeeded();
    await expect(brand).toBeInViewport();
    expect(await brand.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const bb = (await brand.boundingBox())!;
    expect(bb.height).toBeGreaterThanOrEqual(44);

    // the attract-mode demo is alive behind the menu
    const st = await state(page);
    expect(st.phase).toBe('attract');
    await page.screenshot({ path: info.outputPath('menu.png') });
    expect(realErrors(errors)).toEqual([]);
  });

  test('how-to-play and settings work and persist', async ({ page }, info) => {
    const errors = watchErrors(page);
    await boot(page);
    await press(page, '#screen-menu [data-action=howto]', info);
    await expect(page.locator('#screen-howto')).toHaveClass(/active/);
    await expect(page.locator('#bestiary .beast')).toHaveCount(6);
    await page.screenshot({ path: info.outputPath('howto.png') });
    await press(page, '#screen-howto [data-action=back]', info);
    await expect(page.locator('#screen-menu')).toHaveClass(/active/);

    await press(page, '#screen-menu [data-action=settings]', info);
    await expect(page.locator('#screen-settings')).toHaveClass(/active/);
    await press(page, '#set-shake', info);
    await expect(page.locator('#set-shake')).toHaveAttribute('aria-checked', 'false');
    await press(page, '#set-touch [data-value=direct]', info);
    await expect(page.locator('#set-touch [data-value=direct]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('#set-music').fill('30');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dorothy.abyss-weaver.settings.v1') || '{}'));
    expect(saved.shake).toBe(false);
    expect(saved.touchMode).toBe('direct');
    expect(saved.music).toBeCloseTo(0.3);
    await page.reload();
    await expect(page.locator('#screen-menu')).toHaveClass(/active/, { timeout: 45_000 });
    await press(page, '#screen-menu [data-action=settings]', info);
    await expect(page.locator('#set-shake')).toHaveAttribute('aria-checked', 'false');
    await press(page, '#screen-settings [data-action=back]', info);
    await expect(page.locator('#screen-menu')).toHaveClass(/active/);
    expect(realErrors(errors)).toEqual([]);
  });

  test('local data reset leaves other games and the earlier save untouched', async ({ page }, info) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('reset-fixture')) return;
      sessionStorage.setItem('reset-fixture', '1');
      localStorage.setItem('dorothy.abyss-weaver.settings.v1', JSON.stringify({ music: 0, sfx: 0, shake: false }));
      localStorage.setItem('dorothy.abyss-weaver.records.v1', JSON.stringify({ bestAscent: 120 }));
      localStorage.setItem('abyss-weaver.settings.v1', 'legacy');
      localStorage.setItem('another-game.settings.v1', 'keep');
    });
    await boot(page);
    await press(page, '#screen-menu [data-action=settings]', info);
    await expect(page.locator('#set-music')).toHaveValue('0');
    await expect(page.locator('#set-sfx')).toHaveValue('0');
    await press(page, '#reset-game-data', info);
    const dialog = page.getByRole('dialog', { name: 'Reset local data?' });
    await expect(dialog).toBeVisible();
    await press(page, '#reset-dialog button[value=cancel]', info);
    await expect(dialog).toBeHidden();
    await expect(page.locator('#set-music')).toHaveValue('0');
    await press(page, '#reset-game-data', info);
    await press(page, '#reset-dialog button[value=reset]', info);
    await expect(page.locator('#reset-status')).toHaveText('Local game data cleared.');
    expect(await page.evaluate(() => [
      localStorage.getItem('dorothy.abyss-weaver.settings.v1'),
      localStorage.getItem('dorothy.abyss-weaver.records.v1'),
      localStorage.getItem('abyss-weaver.settings.v1'),
      localStorage.getItem('another-game.settings.v1'),
    ])).toEqual([null, null, 'legacy', 'keep']);
    await page.reload();
    await expect(page.locator('#screen-menu')).toHaveClass(/active/, { timeout: 45_000 });
    await press(page, '#screen-menu [data-action=settings]', info);
    await expect(page.locator('#set-music')).toHaveValue('60');
    await expect(page.locator('#set-sfx')).toHaveValue('80');
  });

  test('real gameplay: loops ensnare creatures and score', async ({ page }, info) => {
    const errors = watchErrors(page);
    await boot(page);
    await press(page, '[data-action=ascent]', info);
    await expect(page.locator('#screen-hud')).toHaveClass(/active/);
    await expect(page.locator('#banner')).toContainText('Wave 1');
    const st = await hunt(page, info, (s) => s.loops >= 2 || s.phase === 'dead', 45_000);
    await page.screenshot({ path: info.outputPath('gameplay.png') });
    expect(st.loops, `loops (phase=${st.phase})`).toBeGreaterThanOrEqual(1);
    expect(st.score).toBeGreaterThan(0);
    // the HUD reflects the score
    const shown = Number((await page.locator('#hud-score').innerText()).replace(/[^0-9]/g, ''));
    expect(shown).toBeGreaterThan(0);
    expect(realErrors(errors)).toEqual([]);
  });

  test('pause, resume and restart', async ({ page }, info) => {
    const errors = watchErrors(page);
    await boot(page);
    await press(page, '[data-action=ascent]', info);
    await page.waitForTimeout(800);
    await press(page, '#screen-hud [data-action=pause]', info);
    await expect(page.locator('#screen-pause')).toHaveClass(/active/);
    expect((await state(page)).paused).toBe(true);
    await page.waitForTimeout(150); // Phaser applies the pause on its next step
    const frozen = (await state(page)).player;
    await page.waitForTimeout(400);
    expect((await state(page)).player).toEqual(frozen);

    await press(page, '#screen-pause [data-action=resume]', info);
    await expect(page.locator('#screen-pause')).not.toHaveClass(/active/);
    expect((await state(page)).paused).toBe(false);

    if (!isTouchProject(info)) {
      await page.keyboard.press('Escape');
      await expect(page.locator('#screen-pause')).toHaveClass(/active/);
      await page.keyboard.press('Escape');
      await expect(page.locator('#screen-pause')).not.toHaveClass(/active/);
    }

    await debug(page, 'clear');
    await page.waitForTimeout(200);
    await press(page, '#screen-hud [data-action=pause]', info);
    await press(page, '#screen-pause [data-action=restart]', info);
    const st = await state(page);
    expect(st.wave).toBe(1);
    expect(st.score).toBe(0);
    expect(st.paused).toBe(false);

    // settings opened from pause returns to pause
    await press(page, '#screen-hud [data-action=pause]', info);
    await press(page, '#screen-pause [data-action=settings]', info);
    await expect(page.locator('#screen-settings')).toHaveClass(/active/);
    await press(page, '#screen-settings [data-action=back]', info);
    await expect(page.locator('#screen-pause')).toHaveClass(/active/);
    await press(page, '#screen-pause [data-action=quit]', info);
    await expect(page.locator('#screen-menu')).toHaveClass(/active/);
    expect((await state(page)).phase).toBe('attract');
    expect(realErrors(errors)).toEqual([]);
  });

  test('wave clear, blessing choice and next wave', async ({ page }, info) => {
    const errors = watchErrors(page);
    await boot(page);
    await press(page, '[data-action=ascent]', info);
    await page.waitForTimeout(500);
    await debug(page, 'clear');
    await expect(page.locator('#screen-upgrade')).toHaveClass(/active/, { timeout: 10_000 });
    await expect(page.locator('#upgrade-cards .card')).toHaveCount(3);
    await page.screenshot({ path: info.outputPath('upgrade.png') });
    await page.waitForTimeout(500); // cards ignore taps for a moment to prevent accidental picks
    await press(page, '#upgrade-cards .card', info);
    await expect(page.locator('#screen-upgrade')).not.toHaveClass(/active/);
    const st = await state(page);
    expect(st.wave).toBe(2);
    expect(realErrors(errors)).toEqual([]);
  });

  test('defeat shows the game-over screen and retry works', async ({ page }, info) => {
    const errors = watchErrors(page);
    await boot(page);
    await press(page, '[data-action=ascent]', info);
    await page.waitForTimeout(500);
    await debug(page, 'kill');
    await expect(page.locator('#screen-gameover')).toHaveClass(/active/, { timeout: 10_000 });
    await expect(page.locator('#over-stats div')).toHaveCount(8);
    await page.screenshot({ path: info.outputPath('gameover.png') });
    await press(page, '#screen-gameover [data-action=retry]', info);
    await expect(page.locator('#screen-hud')).toHaveClass(/active/);
    const st = await state(page);
    expect(st.wave).toBe(1);
    expect(st.hp).toBe(3);
    expect(realErrors(errors)).toEqual([]);
  });

  test('final boss defeat reaches the surface (victory)', async ({ page }, info) => {
    const errors = watchErrors(page);
    await boot(page);
    await press(page, '[data-action=ascent]', info);
    await page.waitForTimeout(300);
    await debug(page, 'wave:12');
    await expect.poll(async () => (await state(page)).foes.some((f) => f.kind === 'boss3'), { timeout: 10_000 }).toBe(true);
    await expect(page.locator('#hud-boss')).toBeVisible();
    await page.screenshot({ path: info.outputPath('boss.png') });
    await debug(page, 'clear');
    await expect(page.locator('#screen-victory')).toHaveClass(/active/, { timeout: 15_000 });
    await page.screenshot({ path: info.outputPath('victory.png') });
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('dorothy.abyss-weaver.records.v1') || '{}'));
    expect(rec.cleared).toBe(true);
    await press(page, '#screen-victory [data-action=endless]', info);
    const st = await state(page);
    expect(st.mode).toBe('endless');
    expect(realErrors(errors)).toEqual([]);
  });

  test('every boss spawns and renders without errors', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'covered on desktop; rendering path is identical');
    const errors = watchErrors(page);
    await boot(page);
    await press(page, '[data-action=ascent]', info);
    for (const [wave, kind] of [
      [4, 'boss1'],
      [8, 'boss2'],
      [12, 'boss3'],
    ] as const) {
      await debug(page, `wave:${wave}`);
      await expect.poll(async () => (await state(page)).foes.some((f) => f.kind === kind), { timeout: 10_000 }).toBe(true);
      await page.waitForTimeout(2500); // let it attack
      await page.screenshot({ path: info.outputPath(`${kind}.png`) });
    }
    expect(realErrors(errors)).toEqual([]);
  });

  test('HUD controls stay on screen, finger sized and non-overlapping', async ({ page }, info) => {
    await boot(page);
    await press(page, '[data-action=ascent]', info);
    await page.waitForTimeout(600);
    const vp = page.viewportSize()!;
    const pause = (await page.locator('#screen-hud [data-action=pause]').boundingBox())!;
    const surge = (await page.locator('#hud-surge').boundingBox())!;
    const score = (await page.locator('#hud-score').boundingBox())!;
    const depth = (await page.locator('#hud-depth').boundingBox())!;
    for (const b of [pause, surge, score, depth]) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
    }
    expect(pause.width).toBeGreaterThanOrEqual(44);
    expect(surge.width).toBeGreaterThanOrEqual(64);
    const overlap = (a: typeof pause, b: typeof pause) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlap(pause, depth)).toBe(false);
    expect(overlap(score, depth)).toBe(false);
    expect(overlap(pause, surge)).toBe(false);
    await page.screenshot({ path: info.outputPath('hud.png') });
  });

  test('touch surface: no scrolling, selection, zoom or context menu', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'touch devices only');
    const errors = watchErrors(page);
    await boot(page);
    const css = await page.evaluate(() => {
      const g = getComputedStyle(document.getElementById('game')!);
      const b = getComputedStyle(document.body);
      return { touch: g.touchAction, select: b.userSelect || (b as unknown as Record<string, string>).webkitUserSelect };
    });
    expect(css.touch).toBe('none');
    expect(css.select).toBe('none');

    await press(page, '[data-action=ascent]', info);
    await page.waitForTimeout(2200);
    const before = await state(page);
    const vp = page.viewportSize()!;
    const finger = new Finger(page, isChromium(info));
    await finger.init();
    // a long vertical swipe (the classic "scroll the page" gesture)
    await finger.start(vp.width * 0.5, vp.height * 0.75);
    for (let i = 1; i <= 20; i++) {
      await finger.move(vp.width * 0.5 + i * 3, vp.height * 0.75 - i * 18);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(300);
    const mid = await state(page);
    await finger.end();
    // the light swam (relative drag moved the target up), the page did not scroll or zoom
    expect(mid.player.y).toBeLessThan(before.player.y - 30);
    const view = await page.evaluate(() => ({
      sy: window.scrollY,
      sx: window.scrollX,
      top: document.scrollingElement?.scrollTop ?? 0,
      scale: window.visualViewport?.scale ?? 1,
      sel: document.getSelection()?.toString() ?? '',
    }));
    expect(view).toEqual({ sy: 0, sx: 0, top: 0, scale: 1, sel: '' });

    // long-press context menu is suppressed on the game surface
    const prevented = await page.evaluate(() => {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.getElementById('game')!.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);

    // a second finger tapping SURGE while the first one steers does not break steering
    await debug(page, 'surge');
    await finger.start(vp.width * 0.3, vp.height * 0.5);
    await finger.move(vp.width * 0.3 + 40, vp.height * 0.5);
    const sb = (await page.locator('#hud-surge').boundingBox())!;
    await finger.tapSecond(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await finger.move(vp.width * 0.3 + 80, vp.height * 0.5);
    await finger.end();
    const after = await state(page);
    expect(after.surge).toBe(0); // consumed => Surge activated
    expect(realErrors(errors)).toEqual([]);
  });

  test('pinch on the game surface does not zoom the page', async ({ page }, info) => {
    test.skip(!(isTouchProject(info) && isChromium(info)), 'needs Chromium touch emulation');
    await boot(page);
    await press(page, '[data-action=ascent]', info);
    await page.waitForTimeout(1500);
    const cdp = await page.context().newCDPSession(page);
    const vp = page.viewportSize()!;
    const cx = vp.width / 2;
    const cy = vp.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: cx - 20, y: cy, id: 1 },
        { x: cx + 20, y: cy, id: 2 },
      ],
    });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: cx - 20 - i * 12, y: cy, id: 1 },
          { x: cx + 20 + i * 12, y: cy, id: 2 },
        ],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  });

  test('adapts to orientation / viewport changes mid-game', async ({ page }, info) => {
    const errors = watchErrors(page);
    await boot(page);
    await press(page, '[data-action=ascent]', info);
    await page.waitForTimeout(800);
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.height, height: vp.width });
    await expect.poll(async () => {
      const s = await state(page);
      return Math.abs(s.W / s.H - vp.height / vp.width) < 0.05;
    }).toBe(true);
    const st = await state(page);
    const short = Math.min(vp.width, vp.height);
    expect(Math.min(st.W, st.H)).toBeCloseTo(600, 0);
    expect(st.W / st.H).toBeCloseTo(vp.height / vp.width, 1);
    expect(st.player.x).toBeLessThanOrEqual(st.W);
    expect(st.player.y).toBeLessThanOrEqual(st.H);
    const box = (await page.locator('#game canvas').boundingBox())!;
    expect(Math.round(box.width)).toBe(vp.height);
    expect(short).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath('rotated.png') });
    expect(realErrors(errors)).toEqual([]);
  });

  test('keyboard-only play (desktop)', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'desktop only');
    await boot(page);
    await page.locator('[data-action=ascent]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#screen-hud')).toHaveClass(/active/);
    await page.waitForTimeout(400);
    const a = await state(page);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(500);
    await page.keyboard.up('KeyD');
    const b = await state(page);
    expect(b.player.x).toBeGreaterThan(a.player.x + 60);
    // focus should not stay on a hidden menu button (Space must not re-trigger it)
    await page.keyboard.press('Space');
    expect((await state(page)).wave).toBe(1);
  });

  test('audio unlocks on the first interaction', async ({ page }, info) => {
    await boot(page);
    const aw = () => page.evaluate(() => (window as unknown as { __aw: { audio: () => string } }).__aw.audio());
    expect(await aw()).toBe('locked'); // nothing plays before a user gesture
    await press(page, '#screen-menu [data-action=howto]', info);
    await expect.poll(aw).not.toBe('locked');
    if (isChromium(info)) await expect.poll(aw).toBe('running');
    info.annotations.push({ type: 'audio', description: await aw() });
  });

  test('endless mode runs and escalates', async ({ page }, info) => {
    const errors = watchErrors(page);
    await boot(page);
    await press(page, '#screen-menu [data-action=endless]', info);
    await expect(page.locator('#hud-wave')).toContainText('Endless');
    await page.waitForTimeout(400);
    await debug(page, 'clear');
    await expect(page.locator('#screen-upgrade')).toHaveClass(/active/, { timeout: 10_000 });
    await page.waitForTimeout(500);
    await press(page, '#upgrade-cards .card', info);
    await expect(page.locator('#hud-wave')).toContainText('Wave 2');
    expect((await state(page)).mode).toBe('endless');
    expect(realErrors(errors)).toEqual([]);
  });

  test('frame rate in the busiest campaign wave', async ({ page }, info) => {
    await boot(page);
    await press(page, '#screen-menu [data-action=ascent]', info);
    await debug(page, 'wave:11');
    await page.waitForTimeout(9000); // let the wave fill up
    const fps = await page.evaluate(
      () =>
        new Promise<number>((r) => {
          let n = 0;
          const t0 = performance.now();
          const f = () => {
            n++;
            if (performance.now() - t0 < 3000) requestAnimationFrame(f);
            else r(n / 3);
          };
          requestAnimationFrame(f);
        }),
    );
    const st = await state(page);
    info.annotations.push({ type: 'fps', description: `${fps.toFixed(1)} fps with ${st.enemies} creatures` });
    console.log(`[${info.project.name}] busy-wave fps: ${fps.toFixed(1)} (${st.enemies} creatures)`);
    expect(st.enemies).toBeGreaterThan(5);
    expect(fps).toBeGreaterThan(20);
  });
});
