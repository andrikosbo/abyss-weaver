# Verification

The branded release candidate was checked on November 20, 2026 on
macOS 27.3 (Apple silicon) with Node.js 26.10.0 and Playwright 1.65.1.
Chromium 159.0.8154.6 and WebKit 27.2 supplied the desktop browsers.
Playwright emulated iPhone portrait and landscape, Android touch, and iPad.

- `npm ci`, TypeScript checking, Vite production build, and the dependency
  audit succeeded. npm reported zero known vulnerabilities.
- Vitest passed all eight geometry tests, including invalid or narrow loops,
  snap closures, and capture boundaries.
- Playwright passed 102 checks across seven profiles. Seventeen checks that
  require a particular input type or browser were skipped by design.
- The browser suite exercised real loops and scoring, mouse and keyboard
  controls, touch steering, pause and resume, blessings, the three bosses,
  the campaign ending, endless play, audio unlock, zero-volume settings,
  save and reload, and reset isolation from other local storage keys.
- The production build was served at `/projects/abyss-weaver/play/`. Both
  browsers verified that the Dorothy wordmark, manifest, and game load there.
  Pause and resume passed and the test interface stayed unavailable even
  with `?debug` on the production URL.
- The README animation was captured from an actual scored loop. It uses
  the same game build logic, with the automated test interface reading
  game state so the recorded pointer can steer around a creature.

Physical iPhone and iPad testing remains pending. Emulated touch and
viewport checks do not establish physical-device acceptance.

The source ZIP was also extracted into a fresh directory and built with
Node.js 22.23.5. Its static output matched the packaged build byte for byte.
Following the final storage constant cleanup, all 14 settings and reset
checks passed again across the seven browser profiles.
