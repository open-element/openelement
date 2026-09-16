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
 *   deno task build   (fixture-local)
 *
 * Run: deno task e2e -- csp-nonce
 */
import { expect, test } from '@playwright/test';

const CSP_HEADER = 'content-security-policy';

/** Extract the nonce the CSP header pins in script-src. */
function headerNonce(csp: string | undefined): string | null {
  if (!csp) return null;
  return /script-src 'nonce-([A-Za-z0-9+/=_-]+)'/.exec(csp)?.[1] ?? null;
}

/** Every opening <script ...> tag in the document. */
function scriptTags(html: string): string[] {
  return html.match(/<script\b[^>]*>/g) ?? [];
}

function expectEveryScriptCarriesNonce(html: string, nonce: string): void {
  const tags = scriptTags(html);
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) {
    expect(tag).toContain(`nonce="${nonce}"`);
  }
}

test.describe('CSP nonce (request-time)', () => {
  test('every framework-generated script carries the request nonce from the CSP header', async ({ request }) => {
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

  test('sequential and concurrent requests get distinct, self-consistent nonces', async ({ request }) => {
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
    const cspViolations: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /content.security.policy/i.test(message.text())) {
        cspViolations.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      if (/content.security.policy/i.test(String(error))) cspViolations.push(String(error));
    });

    await page.goto('/live?x=browser');
    const button = page.locator('live-counter #increment');
    const count = page.locator('live-counter #count');
    await expect(button).toBeVisible();
    await button.click();
    await expect(count).toHaveText('1');
    await button.click();
    await expect(count).toHaveText('2');

    // The enhanced form client rides the same nonced client entry.
    await page.goto('/form');
    await expect(page.locator('live-counter #increment')).toBeVisible();

    expect(cspViolations).toEqual([]);
  });

  test('the prerendered static page ships no nonce attributes (SSG stays nonce-free)', async ({ request }) => {
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
