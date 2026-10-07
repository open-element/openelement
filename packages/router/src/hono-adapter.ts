/**
 * @openelement/router/hono — the single Hono adapter (#1560).
 *
 * ADR-0152's original positioning, restored: Hono is an OPTIONAL HTTP
 * adapter, not the generated entry's composition engine. The generated
 * server entry speaks only the dialect-free WinterCG shape
 * `(request, env?, platform?) => Promise<Response>`; this module is the one
 * opt-in seam for consumers that mount their server inside a Hono app
 * (a Hono `route()` mount, `@hono/node-server` hosting, an existing Hono
 * middleware tree). `hono` is an optional peer: importing this module is
 * the only thing that resolves it, and a consumer that never opts in never
 * needs it installed.
 *
 * The adapter is intentionally thin — P1: Hono's own `app.fetch` IS the
 * WinterCG shape, so mounting is a per-request delegation, not a dialect
 * translation. The generated entry's default export and its
 * `openElementHandler` both satisfy {@linkcode WinterCgHandler} directly.
 */

/** The WinterCG request handler the generated entries export. */
export type WinterCgHandler = (
  request: Request,
  env?: Record<string, unknown>,
  platform?: unknown,
) => Promise<Response>;

/**
 * Wraps a WinterCG handler in a Hono app: every method and path delegates
 * to the handler with the host's env binding and — when the host runtime
 * provides one — its execution context. The generated entry's
 * `openElementRuntimeAdapter` and default export plug in unmodified:
 *
 * ```ts
 * import { createHonoAdapter } from '@openelement/router/hono';
 * import openElement from './dist/server/entry.js';
 * const app = await createHonoAdapter(openElement);
 * export default app;
 * ```
 *
 * @throws when the optional `hono` peer is not installed — the error names
 * the package to add.
 */
export async function createHonoAdapter(handler: WinterCgHandler): Promise<object> {
  let hono: typeof import('hono').Hono;
  try {
    ({ Hono: hono } = await import('hono'));
  } catch (cause) {
    throw new Error(
      'The @openelement/router Hono adapter requires hono (an optional peer of ' +
        '@openelement/router). Install it into your app: add "hono": "^4.12" to the ' +
        'package.json dependencies.',
      { cause },
    );
  }
  const app = new hono();
  app.all('*', (c) => {
    let executionContext: unknown;
    try {
      executionContext = c.executionCtx;
    } catch {
      executionContext = undefined;
    }
    return handler(c.req.raw, (c.env ?? {}) as Record<string, unknown>, executionContext);
  });
  return app;
}
