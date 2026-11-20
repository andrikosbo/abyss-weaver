import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/outfit/300.css';
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import './style.css';
import Phaser from 'phaser';
import { GameScene } from './game/GameScene';
import { UI } from './ui/UI';
import { audio } from './audio/AudioEngine';
import { settings } from './storage';

const ui = new UI();

function maxRenderScale(): number {
  const dpr = window.devicePixelRatio || 1;
  if (settings.quality === 'low') return 1;
  return Math.min(2, Math.max(1, dpr));
}

function textureScale(): number {
  if (settings.quality === 'low') return 2;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const short = Math.min(screen.width, screen.height);
  const zoom = (Math.max(short, 600) / 600) * dpr;
  return zoom > 2.2 || settings.quality === 'high' ? 3 : 2;
}

function viewport(): { w: number; h: number } {
  const host = document.getElementById('game')!;
  return { w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) };
}

async function loadFonts(): Promise<void> {
  if (!document.fonts) return;
  const want = ['700 40px Cinzel', '600 20px Cinzel', '400 16px Outfit', '700 16px Outfit', '300 16px Outfit'];
  await Promise.race([
    Promise.all(want.map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

async function boot(): Promise<void> {
  ui.setLoading(0.15, 'Kindling the lantern…');
  await loadFonts();
  ui.setLoading(0.45, 'Painting the creatures of the deep…');
  await nextFrame();
  await nextFrame();

  let renderScale = maxRenderScale();
  const { w, h } = viewport();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: Math.round(w * renderScale),
    height: Math.round(h * renderScale),
    backgroundColor: '#02040c',
    banner: false,
    scale: { mode: Phaser.Scale.NONE },
    render: { antialias: true, powerPreference: 'high-performance', roundPixels: false },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    audio: { noAudio: true },
    fps: { target: 60, smoothStep: true },
  });

  // The scene manager queues this until the game has booted.
  const scene = new GameScene();
  const created = new Promise<void>((resolve) => {
    scene.onCreated = resolve;
  });
  game.scene.add('game', scene, true, { ui, tex: textureScale(), renderScale });
  await created;
  ui.setLoading(0.9, 'Lighting the abyss…');

  // ---------------------------------------------------------------- resizing
  let pending = 0;
  const applySize = () => {
    pending = 0;
    const v = viewport();
    game.scale.resize(Math.round(v.w * renderScale), Math.round(v.h * renderScale));
    scene.setRenderScale(renderScale);
    scene.layout();
  };
  const onResize = () => {
    if (!pending) pending = requestAnimationFrame(applySize);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 150));
  window.visualViewport?.addEventListener('resize', onResize);
  game.events.on('lower-resolution', () => {
    renderScale = Math.max(1, renderScale - 0.5);
    applySize();
  });

  // ---------------------------------------------------------------- UI wiring
  audio.setVolumes(settings.music, settings.sfx);
  ui.syncSettings();
  ui.onSettingsChanged = () => {
    audio.setVolumes(settings.music, settings.sfx);
    const want = maxRenderScale();
    if (want !== renderScale) {
      renderScale = want;
      applySize();
    }
  };
  ui.onUpgrade = (i) => scene.chooseUpgrade(i);
  ui.onAction = (action) => {
    audio.unlock();
    switch (action) {
      case 'ascent':
        scene.startRun('ascent');
        break;
      case 'endless':
        scene.startRun('endless');
        break;
      case 'pause':
        scene.togglePause();
        break;
      case 'resume':
        scene.resumeGame();
        break;
      case 'restart':
        scene.restart();
        break;
      case 'retry':
        scene.restart();
        break;
      case 'quit':
        scene.quitToMenu();
        ui.show('menu');
        break;
      case 'surge':
        scene.activateSurge();
        break;
    }
  };

  // Bestiary portraits come straight from the generated sprite atlases.
  ui.buildBestiary((key, canvas) => {
    const tex = game.textures.get(key);
    const frame = tex.get(0);
    const src = frame.source.image as CanvasImageSource;
    const ctx = canvas.getContext('2d')!;
    const s = Math.min(canvas.width / frame.cutWidth, canvas.height / frame.cutHeight) * 1.25;
    const dw = frame.cutWidth * s;
    const dh = frame.cutHeight * s;
    ctx.drawImage(src, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  });

  // Block Safari's page-level pinch gestures and double-tap zoom while playing.
  const block = (e: Event) => {
    if (ui.hudVisible) e.preventDefault();
  };
  document.addEventListener('gesturestart', block);
  document.addEventListener('dblclick', (e) => e.preventDefault());

  // First interaction anywhere unlocks audio (mobile autoplay policy).
  const unlock = () => audio.unlock();
  // (older iOS only honours touchend/click as audio-unlocking gestures)
  for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) {
    window.addEventListener(type, unlock, { passive: true });
  }

  if (import.meta.env.MODE === 'e2e') {
    const debugEnabled = new URLSearchParams(location.search).has('debug');
    (window as unknown as { __aw: unknown }).__aw = {
      state: () => scene.snapshot(),
      renderer: game.renderer.type === Phaser.WEBGL ? 'webgl' : 'canvas',
      audio: () => audio.ctx?.state ?? 'locked',
      debug: debugEnabled ? (cmd: string) => scene.debug(cmd) : undefined,
    };
  }

  ui.setLoading(1, 'Ready');
  await new Promise((r) => setTimeout(r, 200));
  // fade the loader's content out first so it never overlaps the menu
  document.getElementById('screen-loading')!.classList.add('done');
  await new Promise((r) => setTimeout(r, 280));
  ui.show('menu');
}

boot().catch((err) => {
  console.error(err);
  ui.setLoading(1, 'Something went wrong while starting the game. Please reload.');
});
