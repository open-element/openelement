import type { OpenElementRequestHandler, RuntimeContext } from '@openelement/element/build-utils';
import type { OpenElementRequestContext } from '@openelement/router/model';

/**
 * Minimal Nitro v3 route event shape (#857). Nitro v3 is fetch-native: its h3
 * v2 event carries `req`, a srvx ServerRequest that already IS a standard
 * Request, so the pre-v3 method/path/headers/body translation layer is gone.
 * The mount only wires the OpenElement runtime context around the standard
 * Request → Response seam.
 */
export interface NitroRequestEvent<
  Env extends Record<string, unknown> = Record<string, unknown>,
> {
  req: Request;
  context?: { params?: Record<string, string> };
  env?: Env;
  platform?: unknown;
}

/** Options for mounting an OpenElement request handler under a Nitro/Node server. */
export interface OpenElementNitroMountOptions<
  Env extends Record<string, unknown> = Record<string, unknown>,
> {
  handler: OpenElementRequestHandler<Env>;
  env?: Env;
  platform?: unknown;
  /**
   * Observes the normalized OpenElement request context before the application
   * handler runs. Route params are empty here unless the host supplies them on
   * `event.context.params` before dispatch.
   */
  onBeforeRequestContext?: (context: OpenElementRequestContext<Env>) => void | Promise<void>;
}

function createNitroRequestContext<Env extends Record<string, unknown>>(
  request: Request,
  context: RuntimeContext<Env>,
): OpenElementRequestContext<Env> {
  // Keep this runtime-local. Nitro node output imports this module directly, so
  // a value import from @openelement/router/model would leave an unresolved bare
  // package in generated server output. The type-only import above still pins
  // this shape to the app model contract.
  const url = new URL(request.url);

  return {
    request,
    url,
    path: url.pathname,
    method: request.method,
    params: context.params ?? {},
    searchParams: url.searchParams,
    env: context.env,
    platform: context.platform,
  };
}

/**
 * Mounts an OpenElement request handler on a Nitro v3 route. Near pass-through:
 * the event's standard `req` goes in, the handler's Response comes out — h3 v2
 * serves a returned Response as-is.
 */
export function createOpenElementNitroHandler<
  Env extends Record<string, unknown> = Record<string, unknown>,
>(
  options: OpenElementNitroMountOptions<Env>,
): (event: NitroRequestEvent<Env>) => Promise<Response> {
  return async (event: NitroRequestEvent<Env>): Promise<Response> => {
    const request = event.req;
    // Nitro v3 (h3 v2) delivers the Cloudflare Workers bindings on
    // `req.runtime.cloudflare.env`; the h3 event itself has no `env` field,
    // so `event.env` is undefined in real deployments (spike evidence, #981).
    // Prefer the runtime channel, then an explicit event.env, then the mount
    // options.
    const runtimeEnv = (request as Request & { runtime?: { cloudflare?: { env?: Env } } })
      .runtime?.cloudflare?.env;
    const context: RuntimeContext<Env> = {
      env: runtimeEnv ?? event.env ?? options.env,
      platform: event.platform ?? options.platform,
      params: event.context?.params,
    };
    await options.onBeforeRequestContext?.(
      createNitroRequestContext(request, context),
    );
    return options.handler(request, context);
  };
}
