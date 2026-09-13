/**
 * Dev-mode smoke (#951/#952) — runs against `deno task dev` (vite dev server),
 * not the production build:
 *
 * #951: dev used to 500 on /client/islands/client.js (the URL was treated as
 * a file path), so islands never hydrated in dev. The dev server now serves
 * the generated client entry at that URL and the SSR entry injects the
 * matching <script> tag.
 *
 * #952: editing a route logged "(ssr) page reload" but SSR kept rendering
 * the pre-edit module — the dev customElements stub registry outlived module
 * re-evaluation and every define() guard kept the first class. Re-definition
 * now wins under the stub, so the next request renders the edited module.
 *
 * Prerequisites:
 *   deno task --cwd tests/e2e/starter-smoke setup
 *
 * Run: deno task --cwd tests/e2e/starter-smoke test:dev
 */
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

// v0.44: the route module is a thin definePage wrapper; the page markup lives
// in the compiled page element it imports, so the edit target is the page
// component (the #952 invalidation chain is the same: watcher → module
// re-evaluation → next request renders the edited module).
const PAGE_FILE = new URL('./work/my-blog/app/components/page-home.tsx', import.meta.url).pathname;
const H1_ORIGINAL = 'Static pages, alive where it counts';
const H1_EDITED = 'Static pages, edited in dev mode';

test('dev serves the island client entry (#951)', async ({ request }) => {
  const response = await request.get('/client/islands/client.js');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('javascript');
  const body = await response.text();
  expect(body).toContain('createIslandScheduler');
  expect(body).toContain('my-counter');
});

test('dev island hydrates and handles clicks (#951)', async ({ page }) => {
  await page.goto('/');
  // The island script tag must be in the dev HTML and the module must load:
  // my-counter hydrates on idle, so wait for the definition first.
  await page.waitForFunction(() => Boolean(globalThis.customElements.get('my-counter')));
  const counter = page.locator('my-counter');
  await expect(counter.locator('#count')).toHaveText('0');
  await counter.getByRole('button', { name: '+' }).click();
  await expect(counter.locator('#count')).toHaveText('1');
});

test('route edit invalidates dev SSR output (#952)', async ({ request }) => {
  const original = await readFile(PAGE_FILE, 'utf-8');
  if (!original.includes(H1_ORIGINAL)) {
    throw new Error(
      `fixture page component does not contain the expected H1 — was setup.ts changed? ` +
        `Looking for: ${H1_ORIGINAL}`,
    );
  }
  try {
    await writeFile(PAGE_FILE, original.replace(H1_ORIGINAL, H1_EDITED));
    // Vite's watcher + SSR module re-evaluation is asynchronous; poll until
    // the edited text renders (well beyond the 3s target from the issue).
    await expect
      .poll(
        async () => {
          const response = await request.get('/');
          return (await response.text()).includes(H1_EDITED);
        },
        { timeout: 15_000, intervals: [250, 500, 1000] },
      )
      .toBe(true);
  } finally {
    await writeFile(PAGE_FILE, original);
  }
});
