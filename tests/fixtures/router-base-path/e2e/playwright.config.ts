/**
 * Playwright configuration for the non-root-base fixture (S-C2/S-12).
 *
 * Prerequisites: pnpm --dir tests/fixtures/router-base-path run build
 * Run:           pnpm --dir tests/fixtures/router-base-path run e2e:browsers
 */
import { defineConfig } from '@playwright/test';
import process from 'node:process';

const PORT = Number(process.env.BASE_PATH_E2E_PORT ?? 4181);
const baseURL = `http://127.0.0.1:${PORT}/sub/`;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60_000,

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command: `exec node server.ts --port ${PORT} --dir ../dist --base /sub`,
    url: `http://127.0.0.1:${PORT}/sub/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },

  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
