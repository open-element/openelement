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

/** Build the canonical OpenElement request context from a platform request event. */
export function createRequestContext<
  Env extends Record<string, unknown> = Record<string, unknown>,
>(options: CreateRequestContextOptions<Env>): OpenElementRequestContext<Env> {
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
