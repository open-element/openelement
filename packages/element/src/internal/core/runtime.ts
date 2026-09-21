/**
 * Runtime adapter protocol.
 *
 * Replacement boundary for Nitro, Workers, Node, Deno, or future
 * fetch-compatible runtimes. Preserves openElement semantics while leaving
 * concrete server engines outside this package.
 */

import type {
  OpenElementRequestHandler,
  RuntimeAdapter,
  RuntimeAdapterOptions,
  RuntimeContext,
} from '../protocol/runtime.ts';
import type { Middleware } from '../protocol/framework.ts';
export type { OpenElementRequestHandler, RuntimeContext };

/**
 * Normalize a runtime adapter declaration: pass the name, fetch handler and
 * optional prerender iterator through unchanged so a host integration only
 * implements the {@link RuntimeAdapter} contract it needs.
 */
export function createRuntimeAdapter<
  Env extends Record<string, unknown> = Record<string, unknown>,
>(options: RuntimeAdapterOptions<Env>): RuntimeAdapter<Env> {
  return {
    name: options.name,
    fetch: options.fetch,
    ...(options.prerender ? { prerender: options.prerender } : {}),
  };
}

/**
 * Compose a fetch middleware chain (ADR-0123 item 2, #858) around a handler,
 * in onion order: `middleware[0]` is outermost — it sees the request first
 * and the response last. A middleware may short-circuit by returning a
 * Response without calling `next()`.
 *
 * Extra arguments (runtime context such as env/platform) thread transparently
 * past the middleware chain to the terminal handler — the WinterCG-shaped
 * middleware itself only ever sees `(request, next)`.
 *
 * Generated server entries call this once at module scope so the dev server,
 * the `start` CLI, the e2e fixture server, and the Nitro production entry all
 * share the same composed handler.
 */
export function composeFetchMiddleware<Args extends unknown[]>(
  middleware: Middleware[],
  handler: (request: Request, ...args: Args) => Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
  return middleware.reduceRight<(request: Request, ...args: Args) => Promise<Response>>(
    (next, mw) => (request, ...args) => mw(request, () => next(request, ...args)),
    handler,
  );
}
