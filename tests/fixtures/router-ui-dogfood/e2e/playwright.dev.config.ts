/**
 * Playwright configuration for the DEV-server acceptance (alpha15 S lane,
 * S5-A): the same dogfood fixture, served by its real Vite dev server, so the
 * shadow Tailwind probe is measured through the development pipeline
 * (dev-served component sheet + declarative DSD link + HMR).
 *
 * Run: pnpm --dir tests/fixtures/router-ui-dogfood run e2e:dev
 */
import { defineConfig } from '@playwright/test';
import process from 'node:process';

const PORT = Number(process.env.UI_DOGFOOD_DEV_PORT ?? 4198);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: 'shadow-tailwind-dev.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: 90_000,

  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  webServer: {
    // The fixture root owns vite.config + app/ — Playwright defaults the
    // spawned command's cwd to this config's directory.
    cwd: '..',
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
