/**
 * M14-3 fixture E2E — the request-time channel of a server function page.
 *
 * `/awaited` is a dynamic function-page route (the component is declared in
 * `app/routes/awaited.tsx`) with a text child and a nested server component
 * prop that each await a deterministic Promise.
 * The route has no prerendered artifact; the served bytes come from the
 * generated request-time entry through `renderFunctionPageAwaited`, so the
 * HTML must carry the settled value and never the thenable's stringification.
 *
 * No route-count or route-list pin: this spec asserts one route's observable
 * bytes, not the fixture's route table.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

test.describe('server function page: full await', () => {
  test('serves both settled values without sending server modules to the browser', async ({
    request,
  }) => {
    // Dynamic render intent: the route is not prerendered, so the response
    // below exercises the request-time entry, not a static artifact.
    expect(existsSync(`${distDir}/awaited/index.html`)).toBe(false);
    expect(existsSync(`${distDir}/awaited.html`)).toBe(false);

    const response = await request.get('/awaited');
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('<p id="awaited-marker">awaited-settled-value</p>');
    expect(html).toContain('<p id="awaited-prop-marker">awaited-prop-settled-value</p>');
    expect(html).not.toContain('[object Promise]');

    const browserGraph = readFileSync(
      `${distDir}/client/.vite/oe-browser-entry-graph.json`,
      'utf8',
    );
    expect(JSON.parse(browserGraph)).toMatchObject({
      kind: 'open-browser-entry-graph',
      status: 'complete',
    });
    expect(browserGraph).not.toContain('app/routes/awaited.tsx');
    expect(browserGraph).not.toContain('app/components/awaited-value.tsx');
  });
});
