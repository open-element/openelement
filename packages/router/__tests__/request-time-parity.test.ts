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
 *            production entry) served by Deno.serve
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
 *   deno task fixture:router-request-time:build
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { join, toFileUrl } from '@std/path';
import { createServer as createNodeServer } from 'node:http';

const fixtureDir = join(import.meta.dirname!, '../../../fixtures/router-request-time');
const serverEntryPath = join(fixtureDir, 'dist/server/index.js');

type ServerHandle = { base: string; close: () => Promise<void> };

async function bootBuildServer(): Promise<ServerHandle> {
  const entry = await import(toFileUrl(serverEntryPath).href);
  const handle = entry.default as (event: { req: Request }) => Promise<Response>;
  const server = Deno.serve(
    { port: 0, hostname: '127.0.0.1' },
    (request) => handle({ req: request }),
  );
  const addr = server.addr as Deno.NetAddr;
  return {
    base: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      await server.shutdown();
    },
  };
}

async function bootDevServer(): Promise<ServerHandle> {
  // The dev (hono) SSR entry imports the ADR-0044 customElements polyfill as
  // its first module (plugin.ts virtual:open-ssr-polyfill, fixed in alpha.5 —
  // dev SSR previously crashed with "customElements is not defined" on every
  // route, reproducible via `deno task dev` on www).
  const { createServer } = await import('vite');
  // The plugin scans routes relative to the process cwd, so boot from the
  // fixture directory (same shape as `deno task dev`, which cds into www).
  const previousCwd = Deno.cwd();
  Deno.chdir(fixtureDir);
  let server;
  try {
    server = await createServer({
      root: fixtureDir,
      logLevel: 'silent',
      // Vite probes wildcard addresses before binding its standalone server,
      // even when `host` is loopback. Run the exact Hono/Vite middleware stack
      // behind our own loopback-only server so this contract remains safe in
      // restricted CI and local adversarial runs (#1147).
      server: { middlewareMode: true, ws: false },
    });
  } finally {
    Deno.chdir(previousCwd);
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
  assert(address && typeof address === 'object', 'vite dev server did not bind a port');
  assertEquals(address.address, '127.0.0.1', 'vite dev server must stay on loopback');
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => error ? reject(error) : resolve());
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

Deno.test({
  name: 'request-time parity: dev (hono) vs build (Nitro)',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    // The fixture dist is not committed, and the coverage/test gates run
    // before any build gate — build it on demand (a no-op when it exists,
    // which is the common local case).
    let fixtureBuilt = true;
    try {
      await Deno.stat(serverEntryPath);
    } catch {
      fixtureBuilt = false;
    }
    if (!fixtureBuilt) {
      const build = await new Deno.Command(Deno.execPath(), {
        args: ['task', 'fixture:router-request-time:build'],
        cwd: join(fixtureDir, '../..'),
        stdout: 'inherit',
        stderr: 'inherit',
      }).output();
      if (!build.success) throw new Error('fixture build failed');
    }

    const build = await bootBuildServer();
    const dev = await bootDevServer();
    try {
      const both = { dev: dev.base, build: build.base };

      await t.step(
        'GET /live → 200, loader data present, Cache-Control: private,no-cache (#943)',
        async () => {
          for (const [name, base] of Object.entries(both)) {
            const response = await fetch(`${base}/live?x=parity`);
            assertEquals(response.status, 200, `${name}: GET /live status`);
            assertEquals(
              response.headers.get('cache-control'),
              'private, no-cache',
              `${name}: GET /live cache-control`,
            );
            const body = await response.text();
            assertStringIncludes(body, 'x=parity', `${name}: GET /live loader data`);
          }
        },
      );

      await t.step('GET /missing → styled 404 page with a 404 status (#923)', async () => {
        for (const [name, base] of Object.entries(both)) {
          const response = await fetch(`${base}/missing/route`);
          assertEquals(response.status, 404, `${name}: GET unmatched status`);
          assertEquals(
            response.headers.get('cache-control'),
            'no-store',
            `${name}: GET unmatched cache-control`,
          );
          const body = await response.text();
          assertStringIncludes(body, 'styled not found', `${name}: styled 404 page rendered`);
          assertStringIncludes(body, '404', `${name}: 404 title present`);
        }
      });

      // #943 amendment: the private,no-cache relaxation applies ONLY to a
      // successful 200 GET. notFound()/redirect()/a throw out of render()
      // (inside __renderAppShell) must keep the no-store baseline — the
      // override used to be emitted before the render, leaking onto every
      // error/redirect response.
      await t.step('GET /unstable → notFound() during render: 404 keeps no-store', async () => {
        for (const [name, base] of Object.entries(both)) {
          const response = await fetch(`${base}/unstable`);
          assertEquals(response.status, 404, `${name}: GET /unstable status`);
          assertEquals(
            response.headers.get('cache-control'),
            'no-store',
            `${name}: GET /unstable cache-control`,
          );
          const body = await response.text();
          assertStringIncludes(body, 'unstable gone', `${name}: 404 body carries the message`);
        }
      });

      await t.step('GET /unstable?kind=redirect → 3xx during render keeps no-store', async () => {
        for (const [name, base] of Object.entries(both)) {
          const response = await fetch(`${base}/unstable?kind=redirect`, { redirect: 'manual' });
          assertEquals(response.status, 302, `${name}: GET /unstable?kind=redirect status`);
          assertEquals(
            response.headers.get('location'),
            '/live',
            `${name}: GET /unstable?kind=redirect location`,
          );
          assertEquals(
            response.headers.get('cache-control'),
            'no-store',
            `${name}: GET /unstable?kind=redirect cache-control`,
          );
          await response.body?.cancel();
        }
      });

      await t.step('GET /boom → 500 error boundary keeps no-store', async () => {
        for (const [name, base] of Object.entries(both)) {
          const response = await fetch(`${base}/boom`);
          assertEquals(response.status, 500, `${name}: GET /boom status`);
          assertEquals(
            response.headers.get('cache-control'),
            'no-store',
            `${name}: GET /boom cache-control`,
          );
          const body = await response.text();
          assertStringIncludes(body, 'boom boundary', `${name}: error boundary rendered`);
        }
      });

      await t.step('POST /form empty → 422 + Vary: x-openelement-action', async () => {
        for (const [name, base] of Object.entries(both)) {
          const response = await fetch(`${base}/form`, formBody({ message: '' }));
          assertEquals(response.status, 422, `${name}: POST /form empty status`);
          assertStringIncludes(
            response.headers.get('vary') ?? '',
            'x-openelement-action',
            `${name}: POST /form empty vary`,
          );
          const body = await response.text();
          assertStringIncludes(body, 'message is required', `${name}: POST /form failure echo`);
        }
      });

      // Fetch channel with unserializable fail() data: the JSON channel
      // must still answer the author status (payload degrades to null) —
      // a c.json throw here would turn a 422 into a 500.
      await t.step(
        'POST /fail-unserializable (fetch channel) → 422 with degraded payload',
        async () => {
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
              assertEquals(response.status, 422, `${name}/${kind}: unserializable fail status`);
              const body = await response.json();
              assertEquals(body.type, 'failure', `${name}/${kind}: failure body shape`);
              assertEquals(body.status, 422, `${name}/${kind}: failure body status`);
              assertEquals(
                body.data,
                null,
                `${name}/${kind}: unserializable data degrades to null`,
              );
            }
          }
        },
      );

      // #1146 area 4a — native (no-JS) channel parity for the same five
      // unserializable kinds: a plain form POST WITHOUT the fetch header.
      // Contract (from entry-action-runtime.ts): __runActionProtocol returns
      // { actionResult } and the handler re-renders the page at the author
      // status (entry-codegen.ts:149-154 + c.html(..., __actionStatus)). The
      // raw fail() data rides the __openElementActionData prop, which
      // collectPublicProps drops (props-utils.ts:64), so it never reaches
      // attribute/hydration serialization — the re-render cannot 500.
      await t.step(
        'POST /fail-unserializable (native channel) → 422 page re-render (#1146 4a)',
        async () => {
          for (const [name, base] of Object.entries(both)) {
            for (const kind of ['undefined', 'function', 'symbol', 'bigint', 'circular']) {
              const response = await fetch(`${base}/fail-unserializable`, formBody({ kind }));
              assertEquals(response.status, 422, `${name}/${kind}: native fail status`);
              assertStringIncludes(
                response.headers.get('content-type') ?? '',
                'text/html',
                `${name}/${kind}: native fail content-type`,
              );
              assertStringIncludes(
                response.headers.get('vary') ?? '',
                'x-openelement-action',
                `${name}/${kind}: native fail vary`,
              );
              assertEquals(
                response.headers.get('cache-control'),
                'no-store',
                `${name}/${kind}: native fail cache-control`,
              );
              const body = await response.text();
              assertStringIncludes(
                body,
                '<h1>fail-unserializable</h1>',
                `${name}/${kind}: native fail re-renders the page`,
              );
            }
          }
        },
      );

      // #1146 area 4b — large-but-serializable fail() data on both channels.
      // Threshold (pinned by the fixture's bigPayload()): 64 nesting levels
      // over a 64 KiB string leaf; serialized payload ≥ 64 KiB. The fetch
      // channel must answer 422 with the payload intact (no truncation, no
      // 500); the native channel re-renders without embedding the data.
      await t.step(
        'large serializable fail() data (64-deep, 64 KiB leaf) → intact on both channels (#1146 4b)',
        async () => {
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
            assertEquals(json.status, 422, `${name}: big fetch status`);
            const body = await json.json() as {
              type?: string;
              status?: number;
              data?: unknown;
            };
            assertEquals(body.type, 'failure', `${name}: big fetch body shape`);
            assertEquals(body.status, 422, `${name}: big fetch body status`);
            let node = body.data;
            let depth = 0;
            while (node !== null && typeof node === 'object' && 'child' in node) {
              node = (node as { child: unknown }).child;
              depth++;
            }
            assertEquals(depth, 64, `${name}: big nesting depth survives untruncated`);
            assertEquals(
              (node as { leaf: string }).leaf.length,
              64 * 1024,
              `${name}: big 64 KiB leaf survives untruncated`,
            );
            assert(
              JSON.stringify(body.data).length >= 64 * 1024,
              `${name}: big serialized payload is ≥ 64 KiB`,
            );

            const native = await fetch(`${base}/fail-unserializable`, formBody({ kind: 'big' }));
            assertEquals(native.status, 422, `${name}: big native status`);
            const html = await native.text();
            assertStringIncludes(
              html,
              '<h1>fail-unserializable</h1>',
              `${name}: big native re-renders the page`,
            );
            // fail() data is render-context state, not document state: the
            // 64 KiB leaf must not be embedded into the re-rendered HTML.
            assert(
              !html.includes('x'.repeat(1024)),
              `${name}: big fail data is not embedded in the native HTML`,
            );
          }
        },
      );

      // #1146 area 4c — symbol-KEYED object (not symbol value): JSON.stringify
      // drops symbol keys silently, so the fetch payload keeps only the plain
      // key; the native channel re-renders unaffected.
      await t.step(
        'symbol-keyed fail() data: symbol key dropped, plain key survives (#1146 4c)',
        async () => {
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
            assertEquals(json.status, 422, `${name}: symbol-key fetch status`);
            const body = await json.json() as {
              type?: string;
              status?: number;
              data?: unknown;
            };
            assertEquals(body.type, 'failure', `${name}: symbol-key fetch body shape`);
            assertEquals(
              body.data,
              { plain: 1 },
              `${name}: symbol key dropped silently, plain key survives`,
            );

            const native = await fetch(
              `${base}/fail-unserializable`,
              formBody({ kind: 'symbol-key' }),
            );
            assertEquals(native.status, 422, `${name}: symbol-key native status`);
            assertStringIncludes(
              await native.text(),
              '<h1>fail-unserializable</h1>',
              `${name}: symbol-key native re-renders the page`,
            );
          }
        },
      );

      // ADR-0129: the loader writes the channel on every GET; the action
      // writes Set-Cookie then redirects; a 422 re-render carries the
      // action's header; protocol headers (Cache-Control) cannot be
      // overridden by the channel.
      await t.step(
        'ADR-0129 response-header channel: render + redirect + 422 + protocol wins',
        async () => {
          for (const [name, base] of Object.entries(both)) {
            const page = await fetch(`${base}/set-header`);
            assertEquals(
              page.headers.get('x-oe-channel'),
              'loader-render',
              `${name}: GET channel header`,
            );
            assertEquals(
              page.headers.get('cache-control'),
              'private, no-cache',
              `${name}: protocol Cache-Control wins over the channel`,
            );
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
            assertEquals(action.status, 303, `${name}: action redirect status`);
            assertEquals(
              action.headers.get('set-cookie'),
              'oe_session=stub-ok; HttpOnly; Path=/; SameSite=Lax',
              `${name}: Set-Cookie survives the redirect`,
            );
            assertEquals(
              action.headers.get('x-oe-channel'),
              'action-redirect',
              `${name}: action channel header`,
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
            assertEquals(failed.status, 422, `${name}: 422 status`);
            // The channel accumulates across the action and the re-run
            // loader (Headers.append join) — assert membership, not equality.
            const channel = failed.headers.get('x-oe-channel') ?? '';
            assertEquals(
              channel.includes('action-422'),
              true,
              `${name}: 422 re-render carries the action's channel entry`,
            );
            await failed.body?.cancel();
          }
        },
      );

      await t.step('POST /form valid → 303 + Location', async () => {
        for (const [name, base] of Object.entries(both)) {
          const response = await fetch(`${base}/form`, formBody({ message: 'parity-check' }));
          assertEquals(response.status, 303, `${name}: POST /form valid status`);
          assertEquals(
            response.headers.get('location'),
            '/form?echoed=parity-check',
            `${name}: POST /form valid location`,
          );
          await response.body?.cancel();
        }
      });

      await t.step('POST /form?/nope → 404', async () => {
        for (const [name, base] of Object.entries(both)) {
          const response = await fetch(`${base}/form?/nope`, formBody({ message: 'x' }));
          assertEquals(response.status, 404, `${name}: POST /form?/nope status`);
          await response.body?.cancel();
        }
      });

      await t.step('POST /live (no action) → 404', async () => {
        for (const [name, base] of Object.entries(both)) {
          const response = await fetch(`${base}/live`, formBody({ x: '1' }));
          assertEquals(response.status, 404, `${name}: POST /live status`);
          await response.body?.cancel();
        }
      });

      // #960 regression: a route module exporting tagName + a same-tag
      // self-registered content element + a definePage default export must
      // run the definePage render (previously the content element won the
      // registration and the page render — with its request context — was
      // silently bypassed).
      await t.step(
        'GET /decoupled → definePage render runs, wrapping the content element',
        async () => {
          for (const [name, base] of Object.entries(both)) {
            const response = await fetch(`${base}/decoupled?marker=from-request`);
            assertEquals(response.status, 200, `${name}: GET /decoupled status`);
            const body = await response.text();
            assertStringIncludes(
              body,
              'decoupled-page-render',
              `${name}: definePage render output present`,
            );
            assertStringIncludes(
              body,
              'content element: from-request',
              `${name}: request context reached the page render`,
            );
            assertStringIncludes(
              body,
              '<decoupled-page',
              `${name}: page registers under the path-derived fallback tag`,
            );
          }
        },
      );

      await t.step('PUT /form → 405 + no-store', async () => {
        for (const [name, base] of Object.entries(both)) {
          const response = await fetch(`${base}/form`, { method: 'PUT', body: 'x=1' });
          assertEquals(response.status, 405, `${name}: PUT /form status`);
          assertEquals(
            response.headers.get('cache-control'),
            'no-store',
            `${name}: PUT /form cache-control`,
          );
          await response.body?.cancel();
        }
      });

      await t.step('fetch-header unknown action → RFC 9457 problem+json 404 (#863)', async () => {
        for (const [name, base] of Object.entries(both)) {
          const response = await fetch(`${base}/form?/nope`, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              'x-openelement-action': 'true',
            },
            body: 'message=x',
          });
          assertEquals(response.status, 404, `${name}: JSON 404 status`);
          assertStringIncludes(
            response.headers.get('content-type') ?? '',
            'application/problem+json',
            `${name}: JSON 404 content-type`,
          );
          const body = await response.json() as {
            type?: string;
            title?: string;
            status?: number;
            detail?: string;
          };
          assertEquals(body.type, 'about:blank', `${name}: JSON 404 problem type`);
          assertEquals(body.title, 'Not Found', `${name}: JSON 404 problem title`);
          assertEquals(body.status, 404, `${name}: JSON 404 problem status`);
          assertEquals(
            body.detail,
            'No action named "nope" on this route.',
            `${name}: JSON 404 problem detail`,
          );
        }
      });

      await t.step('action returning a Response → 500 contract violation', async () => {
        for (const [name, base] of Object.entries(both)) {
          const response = await fetch(`${base}/ping?/raw`, formBody({}));
          assertEquals(response.status, 500, `${name}: /ping?/raw status`);
          const body = await response.text();
          assertEquals(body.includes('<h1>raw</h1>'), false, `${name}: raw HTML must not leak`);
        }
      });

      await t.step('malformed body (JSON content-type) → 400, both channels', async () => {
        for (const [name, base] of Object.entries(both)) {
          const response = await fetch(`${base}/form`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"x":1}',
          });
          assertEquals(response.status, 400, `${name}: JSON body status`);
          const json = await fetch(`${base}/form`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-openelement-action': 'true' },
            body: '{"x":1}',
          });
          assertEquals(json.status, 400, `${name}: JSON body (fetch channel) status`);
          assertStringIncludes(
            json.headers.get('content-type') ?? '',
            'application/problem+json',
            `${name}: fetch channel errors speak problem+json`,
          );
        }
      });

      await t.step('303 PRG chain: POST → 303 → GET renders the target', async () => {
        for (const [name, base] of Object.entries(both)) {
          const post = await fetch(`${base}/form`, {
            ...formBody({ message: 'chain' }),
            redirect: 'manual',
          });
          assertEquals(post.status, 303, `${name}: PRG status`);
          const get = await fetch(`${base}${post.headers.get('location')}`);
          assertEquals(get.status, 200, `${name}: PRG target status`);
          assertStringIncludes(await get.text(), 'echo=chain', `${name}: PRG target body`);
        }
      });

      // #1146 area 4d — concurrency: one burst of N=20 parallel action POSTs
      // per runtime, alternating valid/fail-unserializable across both
      // channels (5 requests per quadrant). Cross-talk shows up as a wrong
      // per-request marker in the 303/redirect location or a status flip;
      // server-side failures show up as console.error output from the
      // generated entry's catch blocks, captured here for the assertion.
      await t.step(
        'concurrent mixed submissions: 20 parallel, both channels, no cross-talk (#1146 4d)',
        async () => {
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
                    const fields: Record<string, string> = quadrant === 0
                      ? { message: marker }
                      : { kind: 'circular' };
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
              assertEquals(results.length, 20, `${name}: every burst request answered`);
              for (const { quadrant, marker, response } of results) {
                if (quadrant === 0) {
                  assertEquals(response.status, 303, `${name}/${marker}: native valid status`);
                  assertEquals(
                    response.headers.get('location'),
                    `/form?echoed=${marker}`,
                    `${name}/${marker}: native valid location carries its own marker`,
                  );
                  await response.body?.cancel();
                } else if (quadrant === 1) {
                  assertEquals(response.status, 200, `${name}/${marker}: fetch valid status`);
                  const body = await response.json() as {
                    type?: string;
                    status?: number;
                    location?: string;
                  };
                  assertEquals(body.type, 'redirect', `${name}/${marker}: fetch valid shape`);
                  assertEquals(body.status, 303, `${name}/${marker}: fetch valid body status`);
                  assertEquals(
                    body.location,
                    `/form?echoed=${marker}`,
                    `${name}/${marker}: fetch valid location carries its own marker`,
                  );
                } else if (quadrant === 2) {
                  assertEquals(response.status, 422, `${name}/${marker}: native fail status`);
                  assertStringIncludes(
                    await response.text(),
                    '<h1>fail-unserializable</h1>',
                    `${name}/${marker}: native fail re-renders the page`,
                  );
                } else {
                  assertEquals(response.status, 422, `${name}/${marker}: fetch fail status`);
                  const body = await response.json() as { type?: string; data?: unknown };
                  assertEquals(body.type, 'failure', `${name}/${marker}: fetch fail shape`);
                  assertEquals(body.data, null, `${name}/${marker}: fetch fail degrades to null`);
                }
              }
            } finally {
              console.error = originalError;
            }
            assertEquals(
              errorLogs,
              [],
              `${name}: no server error logs during the concurrent burst`,
            );
          }
        },
      );

      // ADR-0123 item 2 (#858): the fixture configures middleware.use with an
      // outer post-processor and an inner short-circuit. Both runtimes must
      // run the chain in onion order at the handler boundary.
      await t.step('fetch middleware: onion order + short-circuit parity (#858)', async () => {
        for (const [name, base] of Object.entries(both)) {
          const response = await fetch(`${base}/live?x=mw`);
          assertEquals(response.status, 200, `${name}: GET /live status`);
          // Onion order: the inner middleware post-processes the response
          // first, so 'inner' precedes 'outer'.
          assertEquals(
            response.headers.get('x-fixture-middleware'),
            'inner, outer',
            `${name}: middleware onion order`,
          );
          await response.body?.cancel();

          const short = await fetch(`${base}/live?mw-short=1`);
          assertEquals(short.status, 418, `${name}: short-circuit status`);
          assertEquals(await short.text(), 'fixture short-circuit', `${name}: short-circuit body`);
          // The outer middleware still wraps the short-circuit response.
          assertEquals(
            short.headers.get('x-fixture-middleware'),
            'outer',
            `${name}: short-circuit still passes the outer middleware`,
          );
        }
      });

      await t.step(
        'dev SSR reloads an edited imported component on the next request (#1091)',
        async () => {
          // v0.44: the /shared route's markup lives in the imported compiled
          // page element module; the edit exercises the same SSR-runner
          // invalidation chain for compiled modules.
          const componentPath = join(fixtureDir, 'app/components/page-shared.tsx');
          const original = await Deno.readTextFile(componentPath);
          const changed = original.replace('Shared submit', 'Fresh SSR dependency');
          assert(changed !== original, 'fixture replacement sentinel was not found');
          try {
            await Deno.writeTextFile(componentPath, changed);
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
            await Deno.writeTextFile(componentPath, original);
          }
        },
      );
    } finally {
      await dev.close();
      await build.close();
    }
  },
});
