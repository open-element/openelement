/**
 * CSP nonce closure E2E (Alpha.1).
 *
 * The fixture configures `middleware.csp: { nonce: true, policy }` with a
 * strict script-src ('nonce-...' + 'strict-dynamic'): every
 * framework-generated <script> must carry the per-request nonce or the
 * browser refuses to execute it. Before the fix the island client entry was
 * injected without a nonce and islands never hydrated under the framework's
 * own CSP.
 *
 * Prerequisites:
 *   pnpm run build     (fixture-local)
 *
 * Run: pnpm run e2e -- csp-nonce
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { BrowserEntryGraphArtifact } from '../../../../packages/router/src/vite/internal/browser-entry-graph-artifact.ts';

const CSP_HEADER = 'content-security-policy';

/** Extract the nonce the CSP header pins in script-src. */
function headerNonce(csp: string | undefined): string | null {
  if (!csp) return null;
  return /script-src 'nonce-([A-Za-z0-9+/=_-]+)'/.exec(csp)?.[1] ?? null;
}

/** Every opening <script ...> tag in the document. */
function scriptTags(html: string): string[] {
  return html.match(/<script\b[^>]*>/gi) ?? [];
}

function expectEveryScriptCarriesNonce(html: string, nonce: string): void {
  const tags = scriptTags(html);
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) {
    expect(tag).toContain(`nonce="${nonce}"`);
  }
}

test.describe('CSP nonce (request-time)', () => {
  test('every framework-generated script carries the request nonce from the CSP header', async ({
    request,
  }) => {
    const response = await request.get('/live?x=csp');
    expect(response.ok()).toBe(true);
    const csp = response.headers()[CSP_HEADER];
    expect(csp).toBeTruthy();
    const nonce = headerNonce(csp);
    expect(nonce).toBeTruthy();

    const html = await response.text();
    // The island client entry is present and nonced...
    expect(html).toContain(
      `<script type="module" src="/client/islands/client.js" nonce="${nonce}"></script>`,
    );
    // ...and so is every other script tag in the response.
    expectEveryScriptCarriesNonce(html, nonce!);
  });

  test('sequential and concurrent requests get distinct, self-consistent nonces', async ({
    request,
  }) => {
    const read = async (x: string) => {
      const response = await request.get(`/live?x=${x}`);
      const html = await response.text();
      return { nonce: headerNonce(response.headers()[CSP_HEADER]), html };
    };

    const first = await read('seq-a');
    const second = await read('seq-b');
    expect(first.nonce).toBeTruthy();
    expect(second.nonce).toBeTruthy();
    expect(first.nonce).not.toBe(second.nonce);
    expectEveryScriptCarriesNonce(first.html, first.nonce!);
    expectEveryScriptCarriesNonce(second.html, second.nonce!);

    // Concurrent requests: no cross-request bleed — each response's scripts
    // carry exactly its own header nonce, and all nonces differ.
    const batch = await Promise.all(['c1', 'c2', 'c3', 'c4'].map(read));
    const nonces = new Set(batch.map((r) => r.nonce));
    expect(nonces.size).toBe(batch.length);
    for (const { nonce, html } of batch) {
      expect(nonce).toBeTruthy();
      expectEveryScriptCarriesNonce(html, nonce!);
    }
  });

  test('the island hydrates and stays interactive under the strict CSP', async ({ page }) => {
    const graph = JSON.parse(
      await readFile(
        new URL('../dist/client/.vite/oe-browser-entry-graph.json', import.meta.url),
        'utf8',
      ),
    ) as BrowserEntryGraphArtifact;
    const bootstrap = graph.chunks.find(({ file }) => file === graph.entry.chunkFile)!;
    const helpers = bootstrap.imports.map((file) => `/client/${file}`);
    expect(helpers.length).toBeGreaterThan(0);
    const counter = graph.islands.find(({ tag }) => tag === 'live-counter')!;
    const activation = `/client/${counter.activationChunkFile}`;
    const requests: string[] = [];
    page.on('request', (request) => requests.push(new URL(request.url()).pathname));
    await page.addInitScript(() => {
      document.addEventListener('open:ready', () => {
        document.documentElement.setAttribute('data-csp-fixture-ready', '');
      });
    });
    const cspViolations: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /content.security.policy/i.test(message.text())) {
        cspViolations.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      if (/content.security.policy/i.test(String(error))) cspViolations.push(String(error));
    });

    const button = page.locator('live-counter #increment');
    const count = page.locator('live-counter #count');
    const allowActivation = Promise.withResolvers<void>();
    await page.route(`**${activation}`, async (route) => {
      await allowActivation.promise;
      await route.continue();
    });
    try {
      const response = await page.goto('/live?x=browser', { waitUntil: 'domcontentloaded' });
      const nonce = headerNonce(response!.headers()[CSP_HEADER]);
      expect(nonce).toBeTruthy();
      const html = await response!.text();
      expect(
        [...html.matchAll(/<link rel="modulepreload" href="([^"]+)" nonce="([^"]+)">/g)].map(
          ([, href, preloadNonce]) => [href, preloadNonce],
        ),
      ).toEqual(helpers.map((href) => [href, nonce]));
      expect(html).not.toContain(`rel="modulepreload" href="${activation}"`);
      await expect(page.locator('html[data-csp-fixture-ready]')).toBeAttached();
      expect(await page.evaluate(() => customElements.get('live-counter'))).toBeUndefined();
      await button.click();
    } finally {
      allowActivation.resolve();
    }
    await expect(count).toHaveText('1');
    for (const helper of helpers) {
      expect(requests.filter((url) => url === helper)).toEqual([helper]);
    }
    expect(requests.filter((url) => url === activation)).toEqual([activation]);
    await button.click();
    await expect(count).toHaveText('2');

    // The enhanced form client rides the same nonced client entry.
    await page.goto('/form');
    await expect(page.locator('live-counter #increment')).toBeVisible();

    expect(cspViolations).toEqual([]);
  });

  test('the prerendered static page ships no nonce attributes (SSG stays nonce-free)', async ({
    request,
  }) => {
    const response = await request.get('/');
    expect(response.ok()).toBe(true);
    // Static files are served from disk: no middleware, no CSP header...
    expect(response.headers()[CSP_HEADER]).toBeUndefined();
    const html = await response.text();
    // ...and static HTML can never carry per-request nonces.
    expect(html).not.toContain('nonce=');
    // The policy-only <meta> fallback is the designed SSG fail-closed shape.
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain('script-src');
  });
});
