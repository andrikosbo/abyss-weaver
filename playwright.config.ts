import { defineConfig, devices } from '@playwright/test';

// Mobile projects are *emulated* (viewport, DPR, touch, UA). They are not a
// substitute for testing on physical devices.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 4,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4183/projects/abyss-weaver/play/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Use the real GPU (Metal on macOS) for headless Chromium; software GL is far too slow for a WebGL game.
    launchOptions: { args: process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [] },
  },
  webServer: {
    command: 'npm run build -- --mode e2e --outDir .test-dist && vite preview --outDir .test-dist --host 127.0.0.1 --port 4183 --strictPort --base /projects/abyss-weaver/play/',
    url: 'http://127.0.0.1:4183/projects/abyss-weaver/play/',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: 'desktop-1920', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    { name: 'desktop-1366', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1366, height: 768 }, launchOptions: {} } },
    { name: 'iphone-portrait', use: { ...devices['iPhone 14'], launchOptions: {} } },
    { name: 'iphone-landscape', use: { ...devices['iPhone 14 landscape'], launchOptions: {} } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'], launchOptions: {} } },
  ],
});
