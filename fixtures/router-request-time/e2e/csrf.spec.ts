/**
 * CSRF same-origin floor E2E (#811, TP-5.7 exit criterion).
 *
 * The main request-time harness (playwright.config.ts webServer) starts with
 * OPEN_ELEMENT_DISABLE_CSRF=1, so it can never observe the default floor.
 * This spec spawns its own fixture-server instances on dedicated ports:
 *
 *   - port 4191: default floor (no OPEN_ELEMENT_DISABLE_CSRF)
 *   - port 4192: opt-out (OPEN_ELEMENT_DISABLE_CSRF=1)
 *
 * Covers the three states of the generated action-POST guard
 * (entry-render-helpers.ts): cross-site POST rejected with 403, same-origin
 * POST allowed, and the env opt-out allowing cross-site POSTs.
 *
 * Prerequisites:
 *   deno task fixture:request-time:build
 *
 * Run: deno task fixture:request-time:e2e
 */
import { expect, test } from '@playwright/test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DENO_JSON = join(E2E_DIR, '..', '..', '..', '..', '..', 'deno.json');
const SERVER_ENTRY = join(E2E_DIR, '..', 'dist', 'server', 'index.js');

const CSRF_ON_PORT = 4191;
const CSRF_OFF_PORT = 4192;
const csrfOnBase = `http://127.0.0.1:${CSRF_ON_PORT}`;
const csrfOffBase = `http://127.0.0.1:${CSRF_OFF_PORT}`;

const children: ChildProcess[] = [];

function startFixtureServer(port: number, disableCsrf: boolean): ChildProcess {
  const env = { ...process.env };
  if (disableCsrf) {
    env.OPEN_ELEMENT_DISABLE_CSRF = '1';
  } else {
    delete env.OPEN_ELEMENT_DISABLE_CSRF;
  }
  const child = spawn(
    'deno',
    [
      'run',
      '--config',
      ROOT_DENO_JSON,
      '-A',
      'server.ts',
      '--port',
      String(port),
      '--dir',
      '../dist',
    ],
    { cwd: E2E_DIR, env, stdio: 'ignore' },
  );
  children.push(child);
  return child;
}

async function waitForServer(base: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + '/');
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`fixture server at ${base} did not become ready in ${timeoutMs}ms`);
}

test.describe('CSRF same-origin floor (#811)', () => {
  test.beforeAll(async () => {
    test.skip(
      !existsSync(SERVER_ENTRY),
      'fixture dist missing — run deno task fixture:request-time:build first',
    );
    startFixtureServer(CSRF_ON_PORT, false);
    startFixtureServer(CSRF_OFF_PORT, true);
    await waitForServer(csrfOnBase);
    await waitForServer(csrfOffBase);
  });

  test.afterAll(() => {
    for (const child of children) child.kill();
  });

  test('cross-site POST is rejected with 403 on both channels', async ({ request }) => {
    // HTML channel: cross-site Origin header.
    const html = await request.post(csrfOnBase + '/form', {
      form: { message: 'csrf-probe' },
      headers: { origin: 'https://evil.example' },
      maxRedirects: 0,
    });
    expect(html.status()).toBe(403);
    expect(await html.text()).toBe('Forbidden');

    // Fetch channel: Sec-Fetch-Site alone marks the request cross-site.
    const json = await request.post(csrfOnBase + '/form', {
      form: { message: 'csrf-probe' },
      headers: {
        'x-openelement-action': 'true',
        'sec-fetch-site': 'cross-site',
      },
      maxRedirects: 0,
    });
    expect(json.status()).toBe(403);
    // #863: the CSRF rejection is an RFC 9457 problem document.
    expect(json.headers()['content-type']).toContain('application/problem+json');
    const body = await json.json();
    expect(body.type).toBe('about:blank');
    expect(body.title).toBe('Forbidden');
    expect(body.status).toBe(403);
    expect(body.detail).toBe('Cross-site form submission rejected');
  });

  test('same-origin POST passes the floor (303 PRG)', async ({ request }) => {
    const sameOrigin = await request.post(csrfOnBase + '/form', {
      form: { message: 'same-origin-ok' },
      headers: { origin: csrfOnBase, 'sec-fetch-site': 'same-origin' },
      maxRedirects: 0,
    });
    expect(sameOrigin.status()).toBe(303);
    expect(sameOrigin.headers()['location']).toBe('/form?echoed=same-origin-ok');

    // Non-browser clients that omit Origin and Sec-Fetch-Site are allowed.
    const noOrigin = await request.post(csrfOnBase + '/form', {
      form: { message: 'no-origin-ok' },
      maxRedirects: 0,
    });
    expect(noOrigin.status()).toBe(303);
  });

  test('OPEN_ELEMENT_DISABLE_CSRF=1 opts the floor out', async ({ request }) => {
    const response = await request.post(csrfOffBase + '/form', {
      form: { message: 'opt-out-ok' },
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe('/form?echoed=opt-out-ok');
  });

  // #938: a no-referrer page (referrer-policy: no-referrer) submits the
  // native form POST with Origin: null + Sec-Fetch-Site: same-origin — the
  // progressive-enhancement fallback must not be rejected as cross-site.
  test('Origin null + Sec-Fetch-Site same-origin passes the floor (#938)', async ({ request }) => {
    const response = await request.post(csrfOnBase + '/form', {
      form: { message: 'opaque-origin-ok' },
      headers: { origin: 'null', 'sec-fetch-site': 'same-origin' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe('/form?echoed=opaque-origin-ok');
  });

  // #921: Sec-Fetch-Site alone is not proof — a browser always sends Origin
  // with it, so same-site without a usable Origin is a forged header.
  test('Sec-Fetch-Site same-site without Origin is rejected (#921)', async ({ request }) => {
    const response = await request.post(csrfOnBase + '/form', {
      form: { message: 'forged' },
      headers: { 'sec-fetch-site': 'same-site' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);

    const opaque = await request.post(csrfOnBase + '/form', {
      form: { message: 'forged-opaque' },
      headers: { origin: 'null', 'sec-fetch-site': 'same-site' },
      maxRedirects: 0,
    });
    expect(opaque.status()).toBe(403);
  });

  // #937: dev servers present themselves as localhost while the browser may
  // hit 127.0.0.1 — a literal origin compare would reject a same-site post.
  // Playwright's request client sends the csrfOnBase origin verbatim, so hit
  // the server through a loopback alias of the same host.
  test('loopback hostname alias counts as same-origin (#937)', async ({ request }) => {
    const response = await request.post(csrfOnBase + '/form', {
      form: { message: 'alias-ok' },
      headers: { origin: 'http://localhost:' + CSRF_ON_PORT, 'sec-fetch-site': 'same-origin' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe('/form?echoed=alias-ok');
  });
});
