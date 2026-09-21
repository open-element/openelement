/**
 * runtime.ts - Runtime adapter protocol.
 *
 * Replacement boundary for Nitro, Workers, Node, Deno, or future
 * fetch-compatible runtimes. Preserves openElement semantics while leaving
 * concrete server engines outside this package.
 */

export interface RuntimeContext<Env extends Record<string, unknown> = Record<string, unknown>> {
  env?: Env;
  platform?: unknown;
  params?: Record<string, string>;
}

interface RuntimePrerenderResult {
  path: string;
  html: string;
  status?: number;
  headers?: HeadersInit;
}

/**
 * The host-neutral request handler every runtime adapter and generated server
 * entry exposes: a WinterCG `(request, context?) => Response` with no server
 * engine dialect baked in.
 */
export type OpenElementRequestHandler<
  Env extends Record<string, unknown> = Record<string, unknown>,
> = (request: Request, context?: RuntimeContext<Env>) => Response | Promise<Response>;

export interface RuntimeAdapter<Env extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  fetch: OpenElementRequestHandler<Env>;
  prerender?(): AsyncIterable<RuntimePrerenderResult> | Iterable<RuntimePrerenderResult>;
}

export interface RuntimeAdapterOptions<
  Env extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string;
  fetch: OpenElementRequestHandler<Env>;
  prerender?(): AsyncIterable<RuntimePrerenderResult> | Iterable<RuntimePrerenderResult>;
}
