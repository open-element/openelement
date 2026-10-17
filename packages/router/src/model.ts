/** Host-agnostic request context shared by App request adapters. */

export interface OpenElementRequestContext<
  Env extends Record<string, unknown> = Record<string, unknown>,
> {
  request: Request;
  url: URL;
  path: string;
  method: string;
  params: Record<string, string>;
  searchParams: URLSearchParams;
  env?: Env;
  platform?: unknown;
}

/** Inputs for building an {@linkcode OpenElementRequestContext} from a platform request event. */
export interface CreateRequestContextOptions<
  Env extends Record<string, unknown> = Record<string, unknown>,
> {
  request: Request;
  params?: Record<string, string>;
  env?: Env;
  platform?: unknown;
}

/**
 * Single source for the request-env precedence chain (M-R2): the hosting
 * runtime's live bindings win, then an explicit per-event env, then the
 * mount's static options env. Every adapter resolves through this — the
 * chain used to be re-spelled per adapter (nitro-mount carried the 3-link
 * chain while model.ts carried none), so two copies could drift on which
 * link wins. `??` (not `||`): an explicitly-passed empty env object is a
 * real configuration, not a missing one.
 */
export function resolveRequestEnv<Env extends Record<string, unknown> = Record<string, unknown>>(
  ...candidates: Array<Env | undefined>
): Env | undefined {
  for (const candidate of candidates) {
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

/** Build the canonical OpenElement request context from a platform request event. */
export function createRequestContext<Env extends Record<string, unknown> = Record<string, unknown>>(
  options: CreateRequestContextOptions<Env>,
): OpenElementRequestContext<Env> {
  const url = new URL(options.request.url);
  return {
    request: options.request,
    url,
    path: url.pathname,
    method: options.request.method,
    params: options.params ?? {},
    searchParams: url.searchParams,
    env: options.env,
    platform: options.platform,
  };
}
