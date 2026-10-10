/**
 * Playwright configuration for the dev-mode smoke (#951/#952).
 *
 * Same packed-starter surface as playwright.config.ts, but served by the
 * starter's own `dev` command (the Vite+ dev server, `vp dev`, with the
 * @hono/vite-dev-server SSR) instead of the production `start` command.
 *
 * Prerequisites:
 *   pnpm --dir tests/e2e/starter-smoke run setup
 *
 * Run: pnpm --dir tests/e2e/starter-smoke run test:dev
 */
import { defineConfig } from '@playwright/test';
import process from 'node:process';

const PORT = Number(process.env.STARTER_SMOKE_DEV_PORT ?? 4299);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: 'dev.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,

  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  webServer: {
    // B5 (ADR-0161): the starter's own `dev` script — `vp dev` on the Vite+
    // toolchain (alpha.14); the flags below are vite-compatible and pass
    // straight through. The host is pinned because the dev server's default
    // 'localhost' binding is IPv6-first on some platforms while the probe
    // URL is 127.0.0.1.
    command: `exec pnpm run dev --port ${PORT} --host 127.0.0.1 --strictPort`,
    cwd: new URL('./work/my-blog', import.meta.url).pathname,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
