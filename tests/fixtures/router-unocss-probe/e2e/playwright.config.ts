/**
 * Playwright configuration for the UnoCSS probe fixture (alpha15 stage 2B).
 *
 * Tests run against the BUILT fixture app
 * (tests/fixtures/router-unocss-probe/dist), served as static files. The two
 * sheets this fixture exists for — the UnoCSS-generated document stylesheet and
 * the UnoCSS-generated component stylesheet — are read through real computed
 * styles in Chromium, Firefox and WebKit.
 *
 * Prerequisites:
 *   pnpm --dir tests/fixtures/router-unocss-probe run build
 *
 * Run: pnpm --dir tests/fixtures/router-unocss-probe run e2e:browsers
 */
import { defineConfig } from '@playwright/test';
import process from 'node:process';

const PORT = Number(process.env.ROUTER_UNOCSS_PROBE_E2E_PORT ?? 4283);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : '50%',
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  outputDir: 'test-results',
  timeout: 120_000,

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Auto-start the fixture's static server. `exec` replaces the shell with the
  // node server process, so the webServer child is killed (not orphaned) when
  // the suite finishes.
  webServer: {
    command: `exec node static-server.ts --port ${PORT} --dir ../dist`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },

  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
