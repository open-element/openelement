/**
 * @openelement/router — dev (hono) vs build (Nitro) semantic parity
 * contract test (0.42.0-alpha.5 TP-5.5, issue #557, VERSION_PLAN test matrix:
 * "Contract: dev (hono) vs build (Nitro) semantic parity").
 *
 * Boots BOTH servers against the same fixture and asserts the request-time
 * protocol is semantically identical:
 *   - dev:   vite dev server (@hono/vite-dev-server over the same virtual
 *            entry codegen as the build) serving the request-time fixture
 *   - build: the generated dist/server/index.js default export (the Nitro
 *            production entry) served through the shipped node:http adapter
 *            (packages/router/src/internal/node-http.ts)
 *
 * Status codes and the listed headers must match exactly; bodies may differ
 * in dev-only details (client script injection, stack traces) — the test
 * asserts shape, not bytes.
 *
 * The fixture also configures `middleware.use` (ADR-0123 item 2, #858): the
 * last step asserts the fetch middleware chain runs in onion order with
 * identical short-circuit semantics on both runtimes.
 *
 * Prerequisite: the fixture must be built first —
 *   pnpm --dir tests/fixtures/router-request-time run build
 */

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as createNodeServer } from 'node:http';

const fixtureDir = join(import.meta.dirname!, '../../../tests/fixtures/router-request-time');
const serverEntryPath = join(fixtureDir, 'dist/server/index.js');

type ServerHandle = { base: string; close: () => Promise<void> };

async function bootBuildServer(): Promise<ServerHandle> {
  const entry = await import(pathToFileURL(serverEntryPath).href);
  const handle = entry.default as (event: { req: Request }) => Promise<Response>;
  // The same node:http ↔ fetch adapter the start CLI uses in production
  // (packages/router/src/internal/node-http.ts) — the oracle pins semantic
  // parity, so the harness bridge must be the shipped one.
  const { serveFetch } = await import('../src/internal/node-http.ts');
  const server = serveFetch({
    hostname: '127.0.0.1',
    port: 0,
    handler: (request) => handle({ req: request }),
  });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const addr = server.address() as { port: number };
  return {
    base: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function bootDevServer(): Promise<ServerHandle> {
  // The dev (hono) SSR entry imports the ADR-0044 customElements polyfill as
  // its first module (plugin.ts virtual:open-ssr-polyfill) so the dev SSR
  // runtime always has customElements defined on every route.
  const { createServer } = await import('vite');
  // The plugin scans routes relative to the process cwd, so boot from the
  // fixture directory — the dev command runs from the app root, and the tests
  // mirror that shape.
  const previousCwd = process.cwd();
  process.chdir(fixtureDir);
  let server;
  try {
    server = await createServer({
      root: fixtureDir,
      logLevel: 'silent',
      // Vite's errorMiddleware in middlewareMode logs and calls plain next()
      // (the parent app owns error responses), which would turn an out-of-app
      // throw (a failing fetch middleware) into the wrapper's 404 instead of
      // the 500 a real `vite dev` server answers. Register the same
      // error-to-500 mapping a standalone dev server gets from Vite's overlay
      // error middleware, so dev/build parity is asserted on the real
      // semantic: a contained 500.
      plugins: [
        {
          name: 'open-test:error-to-500',
          configureServer(errorServer) {
            return () => {
              errorServer.middlewares.use(
                (
                  error: unknown,
                  _req: unknown,
                  response: { statusCode: number; end: (body: string) => void },
                  _next: unknown,
                ) => {
                  console.error('[dev] request error:', error);
                  response.statusCode = 500;
                  response.end('Internal Server Error');
                },
              );
            };
          },
        },
      ],
      // Vite probes wildcard addresses before binding its standalone server,
      // even when `host` is loopback. Run the exact Hono/Vite middleware stack
      // behind our own loopback-only server so this contract remains safe in
      // restricted CI and local adversarial runs (#1147).
      server: { middlewareMode: true, ws: false },
    });
  } finally {
    process.chdir(previousCwd);
  }
  const httpServer = createNodeServer((request, response) => {
    server.middlewares(request, response, (error: unknown) => {
      response.statusCode = error ? 500 : 404;
      response.end(error instanceof Error ? error.message : 'Not Found');
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    await server.close();
    throw error;
  }
  const address = httpServer.address();
  expect(
    address && typeof address === 'object',
    'vite dev server did not bind a port',
  ).toBeTruthy();
  expect(address.address, 'vite dev server must stay on loopback').toEqual('127.0.0.1');
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      } finally {
        await server.close();
      }
    },
  };
}

function formBody(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  };
}

describe('request-time parity: dev (hono) vs build (Nitro)', () => {
  const both: Record<'dev' | 'build', string> = { dev: '', build: '' };
  let dev: ServerHandle | undefined;
  let build: ServerHandle | undefined;

  beforeAll(async () => {
    // The fixture dist is not committed, and the coverage/test gates run
    // before any build gate, so this builds it on demand. It builds
    // unconditionally: "the entry exists" is not evidence that it matches the
    // sources around it, and a stale entry makes the suite assert a past build
    // while reporting on the working tree (2026-09-17: a fixture dist and a
    // shadowing node_modules copy each hid the same stale codegen).
    const fixtureBuild = spawnSync(
      'pnpm',
      ['--dir', 'tests/fixtures/router-request-time', 'run', 'build'],
      {
        cwd: join(fixtureDir, '../../..'),
        stdio: 'inherit',
      },
    );
    if ((fixtureBuild.status ?? -1) !== 0) throw new Error('fixture build failed');

    build = await bootBuildServer();
    dev = await bootDevServer();
    both.dev = dev.base;
    both.build = build.base;
  }, 600_000);

  afterAll(async () => {
    await dev?.close();
    await build?.close();
  });

  test('GET /live → 200, loader data present, Cache-Control: private,no-cache (#943)', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/live?x=parity`);
      expect(response.status, `${name}: GET /live status`).toEqual(200);
      expect(response.headers.get('cache-control'), `${name}: GET /live cache-control`).toEqual(
        'private, no-cache',
      );
      const body = await response.text();
      expect(body, `${name}: GET /live loader data`).toContain('x=parity');
    }
  });

  test('GET /missing → styled 404 page with a 404 status (#923)', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/missing/route`);
      expect(response.status, `${name}: GET unmatched status`).toEqual(404);
      expect(response.headers.get('cache-control'), `${name}: GET unmatched cache-control`).toEqual(
        'no-store',
      );
      const body = await response.text();
      expect(body, `${name}: styled 404 page rendered`).toContain('styled not found');
      expect(body, `${name}: 404 title present`).toContain('404');
    }
  });

  // #943 amendment: the private,no-cache relaxation applies ONLY to a
  // successful 200 GET. notFound()/redirect()/a throw out of render()
  // (inside __renderAppShell) must keep the no-store baseline — the
  // override used to be emitted before the render, leaking onto every
  // error/redirect response.
  test('GET /unstable → notFound() during render: 404 keeps no-store', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/unstable`);
      expect(response.status, `${name}: GET /unstable status`).toEqual(404);
      expect(response.headers.get('cache-control'), `${name}: GET /unstable cache-control`).toEqual(
        'no-store',
      );
      const body = await response.text();
      expect(body, `${name}: 404 body carries the message`).toContain('unstable gone');
    }
  });

  test('GET /unstable?kind=redirect → 3xx during render keeps no-store', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/unstable?kind=redirect`, { redirect: 'manual' });
      expect(response.status, `${name}: GET /unstable?kind=redirect status`).toEqual(302);
      expect(
        response.headers.get('location'),
        `${name}: GET /unstable?kind=redirect location`,
      ).toEqual('/live');
      expect(
        response.headers.get('cache-control'),
        `${name}: GET /unstable?kind=redirect cache-control`,
      ).toEqual('no-store');
      await response.body?.cancel();
    }
  });

  test('GET /boom → 500 error boundary keeps no-store', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/boom`);
      expect(response.status, `${name}: GET /boom status`).toEqual(500);
      expect(response.headers.get('cache-control'), `${name}: GET /boom cache-control`).toEqual(
        'no-store',
      );
      const body = await response.text();
      expect(body, `${name}: error boundary rendered`).toContain('boom boundary');
    }
  });

  test('POST /form empty → 422 + Vary: x-openelement-action', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/form`, formBody({ message: '' }));
      expect(response.status, `${name}: POST /form empty status`).toEqual(422);
      expect(response.headers.get('vary') ?? '', `${name}: POST /form empty vary`).toContain(
        'x-openelement-action',
      );
      const body = await response.text();
      expect(body, `${name}: POST /form failure echo`).toContain('message is required');
    }
  });

  // Fetch channel with unserializable fail() data: the JSON channel
  // must still answer the author status (payload degrades to null) —
  // a c.json throw here would turn a 422 into a 500.
  test('POST /fail-unserializable (fetch channel) → 422 with degraded payload', async () => {
    for (const [name, base] of Object.entries(both)) {
      for (const kind of ['undefined', 'function', 'symbol', 'bigint', 'circular']) {
        const response = await fetch(`${base}/fail-unserializable`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-openelement-action': 'true',
            origin: new URL(base).origin,
          },
          body: `kind=${kind}`,
        });
        expect(response.status, `${name}/${kind}: unserializable fail status`).toEqual(422);
        const body = await response.json();
        expect(body.type, `${name}/${kind}: failure body shape`).toEqual('failure');
        expect(body.status, `${name}/${kind}: failure body status`).toEqual(422);
        expect(body.data, `${name}/${kind}: unserializable data degrades to null`).toEqual(null);
      }
    }
  });

  // #1146 area 4a — native (no-JS) channel parity for the same five
  // unserializable kinds: a plain form POST WITHOUT the fetch header.
  // Contract (from entry-action-runtime.ts): __runActionProtocol returns
  // { actionResult } and the handler re-renders the page at the author
  // status (entry-codegen.ts:149-154 + c.html(..., __actionStatus)). The
  // raw fail() data rides the __openElementActionData prop, which
  // collectPublicProps drops (props-utils.ts:64), so it never reaches
  // attribute/hydration serialization — the re-render cannot 500.
  test('POST /fail-unserializable (native channel) → 422 page re-render (#1146 4a)', async () => {
    for (const [name, base] of Object.entries(both)) {
      for (const kind of ['undefined', 'function', 'symbol', 'bigint', 'circular']) {
        const response = await fetch(`${base}/fail-unserializable`, formBody({ kind }));
        expect(response.status, `${name}/${kind}: native fail status`).toEqual(422);
        expect(
          response.headers.get('content-type') ?? '',
          `${name}/${kind}: native fail content-type`,
        ).toContain('text/html');
        expect(response.headers.get('vary') ?? '', `${name}/${kind}: native fail vary`).toContain(
          'x-openelement-action',
        );
        expect(
          response.headers.get('cache-control'),
          `${name}/${kind}: native fail cache-control`,
        ).toEqual('no-store');
        const body = await response.text();
        expect(body, `${name}/${kind}: native fail re-renders the page`).toContain(
          '<h1>fail-unserializable</h1>',
        );
      }
    }
  });

  // #1146 area 4b — large-but-serializable fail() data on both channels.
  // Threshold (pinned by the fixture's bigPayload()): 64 nesting levels
  // over a 64 KiB string leaf; serialized payload ≥ 64 KiB. The fetch
  // channel must answer 422 with the payload intact (no truncation, no
  // 500); the native channel re-renders without embedding the data.
  test('large serializable fail() data (64-deep, 64 KiB leaf) → intact on both channels (#1146 4b)', async () => {
    for (const [name, base] of Object.entries(both)) {
      const json = await fetch(`${base}/fail-unserializable`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-openelement-action': 'true',
          origin: new URL(base).origin,
        },
        body: 'kind=big',
      });
      expect(json.status, `${name}: big fetch status`).toEqual(422);
      const body = (await json.json()) as {
        type?: string;
        status?: number;
        data?: unknown;
      };
      expect(body.type, `${name}: big fetch body shape`).toEqual('failure');
      expect(body.status, `${name}: big fetch body status`).toEqual(422);
      let node = body.data;
      let depth = 0;
      while (node !== null && typeof node === 'object' && 'child' in node) {
        node = (node as { child: unknown }).child;
        depth++;
      }
      expect(depth, `${name}: big nesting depth survives untruncated`).toEqual(64);
      expect(
        (node as { leaf: string }).leaf.length,
        `${name}: big 64 KiB leaf survives untruncated`,
      ).toEqual(64 * 1024);
      expect(
        JSON.stringify(body.data).length >= 64 * 1024,
        `${name}: big serialized payload is ≥ 64 KiB`,
      ).toBeTruthy();

      const native = await fetch(`${base}/fail-unserializable`, formBody({ kind: 'big' }));
      expect(native.status, `${name}: big native status`).toEqual(422);
      const html = await native.text();
      expect(html, `${name}: big native re-renders the page`).toContain(
        '<h1>fail-unserializable</h1>',
      );
      // fail() data is render-context state, not document state: the
      // 64 KiB leaf must not be embedded into the re-rendered HTML.
      expect(
        !html.includes('x'.repeat(1024)),
        `${name}: big fail data is not embedded in the native HTML`,
      ).toBeTruthy();
    }
  });

  // #1146 area 4c — symbol-KEYED object (not symbol value): JSON.stringify
  // drops symbol keys silently, so the fetch payload keeps only the plain
  // key; the native channel re-renders unaffected.
  test('symbol-keyed fail() data: symbol key dropped, plain key survives (#1146 4c)', async () => {
    for (const [name, base] of Object.entries(both)) {
      const json = await fetch(`${base}/fail-unserializable`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-openelement-action': 'true',
          origin: new URL(base).origin,
        },
        body: 'kind=symbol-key',
      });
      expect(json.status, `${name}: symbol-key fetch status`).toEqual(422);
      const body = (await json.json()) as {
        type?: string;
        status?: number;
        data?: unknown;
      };
      expect(body.type, `${name}: symbol-key fetch body shape`).toEqual('failure');
      expect(body.data, `${name}: symbol key dropped silently, plain key survives`).toEqual({
        plain: 1,
      });

      const native = await fetch(`${base}/fail-unserializable`, formBody({ kind: 'symbol-key' }));
      expect(native.status, `${name}: symbol-key native status`).toEqual(422);
      expect(await native.text(), `${name}: symbol-key native re-renders the page`).toContain(
        '<h1>fail-unserializable</h1>',
      );
    }
  });

  // ADR-0129: the loader writes the channel on every GET; the action
  // writes Set-Cookie then redirects; a 422 re-render carries the
  // action's header; protocol headers (Cache-Control) cannot be
  // overridden by the channel.
  test('ADR-0129 response-header channel: render + redirect + 422 + protocol wins', async () => {
    for (const [name, base] of Object.entries(both)) {
      const page = await fetch(`${base}/set-header`);
      expect(page.headers.get('x-oe-channel'), `${name}: GET channel header`).toEqual(
        'loader-render',
      );
      expect(
        page.headers.get('cache-control'),
        `${name}: protocol Cache-Control wins over the channel`,
      ).toEqual('private, no-cache');
      await page.body?.cancel();

      const action = await fetch(`${base}/set-header`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: new URL(base).origin,
        },
        body: 'mode=go',
        redirect: 'manual',
      });
      expect(action.status, `${name}: action redirect status`).toEqual(303);
      expect(action.headers.get('set-cookie'), `${name}: Set-Cookie survives the redirect`).toEqual(
        'oe_session=stub-ok; HttpOnly; Path=/; SameSite=Lax',
      );
      expect(action.headers.get('x-oe-channel'), `${name}: action channel header`).toEqual(
        'action-redirect',
      );
      await action.body?.cancel();

      const failed = await fetch(`${base}/set-header`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: new URL(base).origin,
        },
        body: 'mode=fail',
      });
      expect(failed.status, `${name}: 422 status`).toEqual(422);
      // The channel accumulates across the action and the re-run
      // loader (Headers.append join) — assert membership, not equality.
      const channel = failed.headers.get('x-oe-channel') ?? '';
      expect(
        channel.includes('action-422'),
        `${name}: 422 re-render carries the action's channel entry`,
      ).toEqual(true);
      await failed.body?.cancel();
    }
  });

  test('POST /form valid → 303 + Location', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/form`, formBody({ message: 'parity-check' }));
      expect(response.status, `${name}: POST /form valid status`).toEqual(303);
      expect(response.headers.get('location'), `${name}: POST /form valid location`).toEqual(
        '/form?echoed=parity-check',
      );
      await response.body?.cancel();
    }
  });

  test('POST /form?/nope → 404', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/form?/nope`, formBody({ message: 'x' }));
      expect(response.status, `${name}: POST /form?/nope status`).toEqual(404);
      await response.body?.cancel();
    }
  });

  // #1382: the residual window for browser-shaped form bodies. A client
  // that omits Origin AND Fetch Metadata is allowed only when it does not
  // look like a browser form navigation; with browser evidence
  // (Upgrade-Insecure-Requests or a text/html Accept) the missing Origin
  // is fail-closed, in the same dialect as the #921 forged-header rule.
  //
  // Non-vacuity (differential pair): the trailing
  // 'non-browser POST without Origin stays allowed' step sends the SAME
  // urlencoded body with the SAME absent Origin and Fetch Metadata, and
  // only differs by omitting the browser-evidence header — it must be
  // allowed (303). Since no other rule reads anything but Origin and
  // Sec-Fetch-Site, a 403 in this step can only come from the #1382
  // branch; the previous rule set allowed this shape (see #938/#921 E2E).
  test('browser-shaped POST without Origin → 403, both channels (#1382)', async () => {
    for (const [name, base] of Object.entries(both)) {
      for (const browserEvidence of [
        { 'upgrade-insecure-requests': '1' },
        { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      ] as Array<Record<string, string>>) {
        // Native (no-JS) multipart form navigation.
        const multipart = new FormData();
        multipart.set('message', 'cross-site-probe');
        const html = await fetch(`${base}/form`, {
          method: 'POST',
          headers: browserEvidence,
          body: multipart,
          redirect: 'manual',
        });
        expect(
          html.status,
          `${name}: multipart without Origin status for ${Object.keys(browserEvidence)[0]}`,
        ).toEqual(403);
        expect(await html.text(), `${name}: native channel answers plain Forbidden`).toEqual(
          'Forbidden',
        );

        // Same shape on the fetch channel speaks RFC 9457 problem+json.
        const form = new FormData();
        form.set('message', 'cross-site-probe');
        const json = await fetch(`${base}/form`, {
          method: 'POST',
          headers: { ...browserEvidence, 'x-openelement-action': 'true' },
          body: form,
          redirect: 'manual',
        });
        expect(json.status, `${name}: fetch channel 403 status`).toEqual(403);
        expect(
          json.headers.get('content-type') ?? '',
          `${name}: fetch channel 403 content-type`,
        ).toContain('application/problem+json');
        const problem = (await json.json()) as { status?: number; detail?: string };
        expect(problem.status, `${name}: fetch channel problem status`).toEqual(403);
        expect(problem.detail, `${name}: fetch channel problem detail`).toEqual(
          'Cross-site form submission rejected',
        );

        // The urlencoded shape is covered by the same rule.
        const urlencoded = await fetch(`${base}/form`, {
          method: 'POST',
          headers: {
            ...browserEvidence,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: 'message=cross-site-probe',
          redirect: 'manual',
        });
        expect(urlencoded.status, `${name}: urlencoded without Origin status`).toEqual(403);
        await urlencoded.body?.cancel();
      }
    }
  });

  test('browser-shaped POST with a same-origin Origin still commits (#1382)', async () => {
    for (const [name, base] of Object.entries(both)) {
      const multipart = new FormData();
      multipart.set('message', 'same-origin-upload');
      const response = await fetch(`${base}/form`, {
        method: 'POST',
        headers: {
          origin: new URL(base).origin,
          'upgrade-insecure-requests': '1',
          accept: 'text/html',
        },
        body: multipart,
        redirect: 'manual',
      });
      expect(response.status, `${name}: same-origin multipart status`).toEqual(303);
      expect(response.headers.get('location'), `${name}: same-origin multipart location`).toEqual(
        '/form?echoed=same-origin-upload',
      );
      await response.body?.cancel();

      // Origin: null + Fetch Metadata same-origin is the #938
      // no-referrer case. It must keep passing: an opaque origin is
      // still an Origin the browser sent (the residual-window rule
      // above deliberately only fires when the header is absent).
      const opaque = new FormData();
      opaque.set('message', 'no-referrer-upload');
      const opaqueResponse = await fetch(`${base}/form`, {
        method: 'POST',
        headers: {
          origin: 'null',
          'sec-fetch-site': 'same-origin',
          'upgrade-insecure-requests': '1',
          accept: 'text/html',
        },
        body: opaque,
        redirect: 'manual',
      });
      expect(opaqueResponse.status, `${name}: #938 opaque-origin status`).toEqual(303);
      await opaqueResponse.body?.cancel();
    }
  });

  test('non-browser POST without Origin stays allowed (#1382 trade-off)', async () => {
    // The allowance this rule deliberately preserves: a client that omits
    // browser navigation evidence (curl, health probes, API tooling) is
    // not a browser-shaped form post, so it is still let through even
    // with a urlencoded body and no Origin. Pinned so the compatibility
    // promise documented in docs/architecture keeps holding.
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/form`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: '*/*',
        },
        body: 'message=scripted-client',
        redirect: 'manual',
      });
      expect(response.status, `${name}: tool-shaped POST status`).toEqual(303);
      expect(response.headers.get('location'), `${name}: tool-shaped POST location`).toEqual(
        '/form?echoed=scripted-client',
      );
      await response.body?.cancel();
    }
  });

  test('POST /live (no action) → 404', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/live`, formBody({ x: '1' }));
      expect(response.status, `${name}: POST /live status`).toEqual(404);
      await response.body?.cancel();
    }
  });

  // #960 regression: a route module exporting tagName + a same-tag
  // self-registered content element + a definePage default export must
  // run the definePage render (previously the content element won the
  // registration and the page render — with its request context — was
  // silently bypassed).
  test('GET /decoupled → definePage render runs, wrapping the content element', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/decoupled?marker=from-request`);
      expect(response.status, `${name}: GET /decoupled status`).toEqual(200);
      const body = await response.text();
      expect(body, `${name}: definePage render output present`).toContain('decoupled-page-render');
      expect(body, `${name}: request context reached the page render`).toContain(
        'content element: from-request',
      );
      expect(body, `${name}: page registers under the path-derived fallback tag`).toContain(
        '<decoupled-page',
      );
    }
  });

  test('PUT /form → 405 + no-store', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/form`, { method: 'PUT', body: 'x=1' });
      expect(response.status, `${name}: PUT /form status`).toEqual(405);
      expect(response.headers.get('cache-control'), `${name}: PUT /form cache-control`).toEqual(
        'no-store',
      );
      await response.body?.cancel();
    }
  });

  test('oversized action POST → 413, fetch channel speaks problem+json', async () => {
    // #568 sets a 10 MiB action limit; the fetch channel parses every
    // action error as RFC 9457 problem+json (same fork as the CSRF 403),
    // while the native form channel keeps the plain-text 413. The full
    // fork is asserted on the build server, which bundles the entry from
    // workspace source; the dev server boots the plugin copy resolved
    // from node_modules, so it is pinned on the channel-invariant part.
    const oversized = new Uint8Array(11 * 1024 * 1024);
    const post = (base: string, headers: Record<string, string>) =>
      fetch(`${base}/form`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: oversized,
      });
    for (const [name, base] of Object.entries(both)) {
      const json = await post(base, { 'x-openelement-action': 'true' });
      expect(json.status, `${name}: fetch 413 status`).toEqual(413);
      expect(json.headers.get('cache-control'), `${name}: fetch 413 cache-control`).toEqual(
        'no-store',
      );
      await json.body?.cancel();

      const plain = await post(base, {});
      expect(plain.status, `${name}: native 413 status`).toEqual(413);
      expect(plain.headers.get('content-type') ?? '', `${name}: native 413 content-type`).toContain(
        'text/plain',
      );
      await plain.body?.cancel();
    }

    const json = await post(build.base, { 'x-openelement-action': 'true' });
    expect(json.headers.get('content-type') ?? '', 'build: fetch 413 content-type').toContain(
      'application/problem+json',
    );
    const problem = (await json.json()) as { type?: string; title?: string; status?: number };
    expect(problem.type, 'build: fetch 413 problem type').toEqual('about:blank');
    expect(problem.title, 'build: fetch 413 problem title').toEqual('Payload Too Large');
    expect(problem.status, 'build: fetch 413 problem status').toEqual(413);
  });

  test('fetch-header unknown action → RFC 9457 problem+json 404 (#863)', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/form?/nope`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-openelement-action': 'true',
        },
        body: 'message=x',
      });
      expect(response.status, `${name}: JSON 404 status`).toEqual(404);
      expect(
        response.headers.get('content-type') ?? '',
        `${name}: JSON 404 content-type`,
      ).toContain('application/problem+json');
      const body = (await response.json()) as {
        type?: string;
        title?: string;
        status?: number;
        detail?: string;
      };
      expect(body.type, `${name}: JSON 404 problem type`).toEqual('about:blank');
      expect(body.title, `${name}: JSON 404 problem title`).toEqual('Not Found');
      expect(body.status, `${name}: JSON 404 problem status`).toEqual(404);
      expect(body.detail, `${name}: JSON 404 problem detail`).toEqual(
        'No action named "nope" on this route.',
      );
    }
  });

  test('action returning a Response → 500 contract violation', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/ping?/raw`, formBody({}));
      expect(response.status, `${name}: /ping?/raw status`).toEqual(500);
      const body = await response.text();
      expect(body.includes('<h1>raw</h1>'), `${name}: raw HTML must not leak`).toEqual(false);
    }
  });

  test('malformed body (JSON content-type) → 400, both channels', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/form`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"x":1}',
      });
      expect(response.status, `${name}: JSON body status`).toEqual(400);
      const json = await fetch(`${base}/form`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-openelement-action': 'true' },
        body: '{"x":1}',
      });
      expect(json.status, `${name}: JSON body (fetch channel) status`).toEqual(400);
      expect(
        json.headers.get('content-type') ?? '',
        `${name}: fetch channel errors speak problem+json`,
      ).toContain('application/problem+json');
    }
  });

  test('303 PRG chain: POST → 303 → GET renders the target', async () => {
    for (const [name, base] of Object.entries(both)) {
      const post = await fetch(`${base}/form`, {
        ...formBody({ message: 'chain' }),
        redirect: 'manual',
      });
      expect(post.status, `${name}: PRG status`).toEqual(303);
      const get = await fetch(`${base}${post.headers.get('location')}`);
      expect(get.status, `${name}: PRG target status`).toEqual(200);
      expect(await get.text(), `${name}: PRG target body`).toContain('echo=chain');
    }
  });

  // #1146 area 4d — concurrency: one burst of N=20 parallel action POSTs
  // per runtime, alternating valid/fail-unserializable across both
  // channels (5 requests per quadrant). Cross-talk shows up as a wrong
  // per-request marker in the 303/redirect location or a status flip;
  // server-side failures show up as console.error output from the
  // generated entry's catch blocks, captured here for the assertion.
  test('concurrent mixed submissions: 20 parallel, both channels, no cross-talk (#1146 4d)', async () => {
    for (const [name, base] of Object.entries(both)) {
      const origin = new URL(base).origin;
      const errorLogs: unknown[][] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        errorLogs.push(args);
      };
      type BurstResult = { quadrant: number; marker: string; response: Response };
      try {
        const results: BurstResult[] = await Promise.all(
          Array.from({ length: 20 }, async (_, i) => {
            const quadrant = i % 4;
            const marker = `mix-${i}`;
            if (quadrant === 0 || quadrant === 2) {
              // Native channel: valid → 303, fail → 422 re-render.
              const target = quadrant === 0 ? '/form' : '/fail-unserializable';
              const fields: Record<string, string> =
                quadrant === 0 ? { message: marker } : { kind: 'circular' };
              const response = await fetch(`${base}${target}`, formBody(fields));
              return { quadrant, marker, response };
            }
            // Fetch channel: valid → 200 JSON redirect, fail → 422 JSON failure.
            const target = quadrant === 1 ? '/form' : '/fail-unserializable';
            const body = quadrant === 1 ? `message=${marker}` : 'kind=circular';
            const response = await fetch(`${base}${target}`, {
              method: 'POST',
              headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-openelement-action': 'true',
                origin,
              },
              body,
            });
            return { quadrant, marker, response };
          }),
        );
        expect(results.length, `${name}: every burst request answered`).toEqual(20);
        for (const { quadrant, marker, response } of results) {
          if (quadrant === 0) {
            expect(response.status, `${name}/${marker}: native valid status`).toEqual(303);
            expect(
              response.headers.get('location'),
              `${name}/${marker}: native valid location carries its own marker`,
            ).toEqual(`/form?echoed=${marker}`);
            await response.body?.cancel();
          } else if (quadrant === 1) {
            expect(response.status, `${name}/${marker}: fetch valid status`).toEqual(200);
            const body = (await response.json()) as {
              type?: string;
              status?: number;
              location?: string;
            };
            expect(body.type, `${name}/${marker}: fetch valid shape`).toEqual('redirect');
            expect(body.status, `${name}/${marker}: fetch valid body status`).toEqual(303);
            expect(
              body.location,
              `${name}/${marker}: fetch valid location carries its own marker`,
            ).toEqual(`/form?echoed=${marker}`);
          } else if (quadrant === 2) {
            expect(response.status, `${name}/${marker}: native fail status`).toEqual(422);
            expect(
              await response.text(),
              `${name}/${marker}: native fail re-renders the page`,
            ).toContain('<h1>fail-unserializable</h1>');
          } else {
            expect(response.status, `${name}/${marker}: fetch fail status`).toEqual(422);
            const body = (await response.json()) as { type?: string; data?: unknown };
            expect(body.type, `${name}/${marker}: fetch fail shape`).toEqual('failure');
            expect(body.data, `${name}/${marker}: fetch fail degrades to null`).toEqual(null);
          }
        }
      } finally {
        console.error = originalError;
      }
      expect(errorLogs, `${name}: no server error logs during the concurrent burst`).toEqual([]);
    }
  });

  // ADR-0123 item 2 (#858), Alpha.1 module contract: the fixture's
  // middleware.use entries are MODULE PATHS. app/middleware/outer.ts
  // default-exports a factory result closing over a module constant;
  // app/middleware/inner.ts imports a local helper AND a third-party
  // package (hono/utils/cookie), closes over module constants,
  // short-circuits, and throws on demand. Both runtimes must run the
  // chain with identical semantics.
  test('fetch middleware: onion order + short-circuit parity (#858)', async () => {
    for (const [name, base] of Object.entries(both)) {
      const response = await fetch(`${base}/live?x=mw`);
      expect(response.status, `${name}: GET /live status`).toEqual(200);
      // Onion order: the inner middleware post-processes the response
      // first, so 'inner' precedes 'outer'.
      expect(
        response.headers.get('x-fixture-middleware'),
        `${name}: middleware onion order`,
      ).toEqual('inner, outer');
      await response.body?.cancel();

      const short = await fetch(`${base}/live?mw-short=1`);
      expect(short.status, `${name}: short-circuit status`).toEqual(418);
      expect(await short.text(), `${name}: short-circuit body`).toEqual('fixture short-circuit');
      // The outer middleware still wraps the short-circuit response.
      expect(
        short.headers.get('x-fixture-middleware'),
        `${name}: short-circuit still passes the outer middleware`,
      ).toEqual('outer');
    }
  });

  test('fetch middleware module contract: local helper + third-party dep + closures (#858, Alpha.1)', async () => {
    for (const [name, base] of Object.entries(both)) {
      // Third-party proof: inner.ts parses the Cookie header with
      // hono/utils/cookie — a bare package import the old toString()
      // inlining could never resolve — and echoes the proof cookie.
      const proof = await fetch(`${base}/live?x=mw-dep`, {
        headers: { cookie: 'fixture-proof=hono-cookie-parser' },
      });
      expect(proof.status, `${name}: dependency proof status`).toEqual(200);
      expect(
        proof.headers.get('x-fixture-cookie-proof'),
        `${name}: third-party package import works inside middleware`,
      ).toEqual('hono-cookie-parser');
      // Module-closure proof: the marker header comes from a constant
      // and a helper in ../lib/middleware-marker.ts, and the 'outer'
      // marker comes from a factory closure over a module constant.
      expect(
        proof.headers.get('x-fixture-middleware'),
        `${name}: module-level constants/closures captured`,
      ).toEqual('inner, outer');
      await proof.body?.cancel();
    }
  });

  test('fetch middleware: a throwing middleware is a contained 500, server survives', async () => {
    for (const [name, base] of Object.entries(both)) {
      const boom = await fetch(`${base}/live?mw-boom=1`);
      expect(boom.status, `${name}: throwing middleware status`).toEqual(500);
      await boom.body?.cancel();
      // Contained: the runtime keeps serving afterwards.
      const after = await fetch(`${base}/live?x=after-boom`);
      expect(after.status, `${name}: server survives a middleware throw`).toEqual(200);
      expect(
        after.headers.get('x-fixture-middleware'),
        `${name}: chain intact after a middleware throw`,
      ).toEqual('inner, outer');
      await after.body?.cancel();
    }
  });

  test('dev SSR reloads an edited imported component on the next request (#1091)', async () => {
    // v0.44: the /shared route's markup lives in the imported compiled
    // page element module; the edit exercises the same SSR-runner
    // invalidation chain for compiled modules.
    const componentPath = join(fixtureDir, 'app/components/page-shared.tsx');
    const original = await readFile(componentPath, 'utf8');
    const changed = original.replace('Shared submit', 'Fresh SSR dependency');
    expect(changed !== original, 'fixture replacement sentinel was not found').toBeTruthy();
    try {
      await writeFile(componentPath, changed);
      const deadline = Date.now() + 5000;
      while (true) {
        const response = await fetch(`${dev.base}/shared`);
        const body = await response.text();
        if (body.includes('Fresh SSR dependency')) break;
        if (Date.now() > deadline) {
          throw new Error('dev SSR kept serving the stale imported component after 5s');
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      await writeFile(componentPath, original);
    }
  });
});
