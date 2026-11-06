/**
 * @openelement/router/hono — the single Hono adapter (#1560).
 *
 * The #152 product-router positioning, restored: Hono is an OPTIONAL HTTP
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

import type { OpenElementError } from '@openelement/protocol/errors';
import {
  AdapterErrorCode,
  describeError,
  errorCause,
  isMissingPeerError,
  serveError,
} from './internal/error-codes.ts';

/** The WinterCG request handler the generated entries export. */
export type WinterCgHandler = (
  request: Request,
  env?: Record<string, unknown>,
  platform?: unknown,
) => Promise<Response>;

/**
 * Classify one failed `import('hono')`: only a resolution failure that names
 * `hono` itself means the optional peer is absent. Anything else — a broken
 * install, a failing transitive import, module evaluation throwing — keeps the
 * same cause but reports the load-failure code, so the fix hint cannot send a
 * user to install a package that is already on disk.
 */
function honoLoadError(cause: unknown): OpenElementError {
  if (isMissingPeerError(cause, 'hono')) {
    return serveError(
      AdapterErrorCode.HONO_MISSING,
      'The @openelement/router Hono adapter requires hono (an optional peer of ' +
        '@openelement/router). Install it into your app: add "hono": "^4.12" to the ' +
        'package.json dependencies.',
      { cause: errorCause(cause) },
    );
  }
  return serveError(
    AdapterErrorCode.HONO_LOAD_FAILED,
    'The @openelement/router Hono adapter found hono installed but it failed to load: ' +
      `${describeError(cause)}. The original failure is preserved as the cause; fix the ` +
      'broken install (or the transitive import it reports).',
    { cause: errorCause(cause) },
  );
}

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
 * @throws a classifiable `OpenElementError`. A missing optional `hono` peer
 * reports `OE_ADAPTER_HONO_MISSING` and names the package to add; a peer that
 * resolves but throws while loading reports `OE_ADAPTER_HONO_LOAD_FAILED`
 * instead (the user must not be told to install something already present).
 * Both keep the original failure — including a hostile, unprintable thrown
 * value — as `cause`; the message only ever carries the safe description.
 */
export async function createHonoAdapter(handler: WinterCgHandler): Promise<object> {
  let hono: typeof import('hono').Hono;
  try {
    ({ Hono: hono } = await import('hono'));
  } catch (cause) {
    throw honoLoadError(cause);
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
