/**
 * M14-3 fixture E2E — the request-time channel of a server function page.
 *
 * `/awaited` is a dynamic function-page route (the component is declared in
 * `app/routes/awaited.tsx`) whose text child awaits a deterministic Promise.
 * The route has no prerendered artifact; the served bytes come from the
 * generated request-time entry through `renderFunctionPageAwaited`, so the
 * HTML must carry the settled value and never the thenable's stringification.
 *
 * No route-count or route-list pin: this spec asserts one route's observable
 * bytes, not the fixture's route table.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

test.describe('server function page: awaited text child', () => {
  test('serves the settled value and never [object Promise]', async ({ request }) => {
    // Dynamic render intent: the route is not prerendered, so the response
    // below exercises the request-time entry, not a static artifact.
    expect(existsSync(`${distDir}/awaited/index.html`)).toBe(false);

    const response = await request.get('/awaited');
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('id="awaited-marker"');
    expect(html).toContain('awaited-settled-value');
    expect(html).not.toContain('[object Promise]');
  });
});
