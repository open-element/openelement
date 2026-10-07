/**
 * @openelement/router/server-runtime — the built-in middleware, in
 * dialect-free WinterCG shape (#1560).
 *
 * The generated entry previously mounted these as Hono built-ins
 * (`hono/request-id`, `hono/logger`, `hono/cors`,
 * `hono/secure-headers`); they move here as `(request, next) => Response`
 * middleware so the entry depends on no composition framework. The
 * observable behavior is kept deliberately identical to the Hono versions
 * they replace — header names and values, the preflight short-circuit,
 * the Vary appends, the id validation and regeneration — and pinned by
 * the unit tests beside this module. One deliberate divergence: the
 * logger's status coloring is gone — it read `process.env` for
 * color policy, which the server contract forbids in shipped runtime
 * code (P3); the log lines are otherwise byte-identical.
 */

import { boundRequestScope } from './wintercg.ts';
import type { OpenElementRequestScope, WinterCgFetchMiddleware } from './wintercg.ts';

// ── request-id ────────────────────────────────────────────────────────────

/** Options for {@linkcode createRequestIdMiddleware}. */
export interface RequestIdOptions {
  /** Maximum accepted inbound id length; longer ids regenerate. Default 255. */
  limitLength?: number;
  /** The response header carrying the id. Default `X-Request-Id`. */
  headerName?: string;
  /** The id generator. Default `crypto.randomUUID()`. */
  generator?: (request: Request) => string;
}

/**
 * Reads the inbound request id (honoring it only when it is present,
 * ≤ `limitLength`, and free of characters outside `[A-Za-z0-9_-=]`),
 * regenerates otherwise, exposes it as the `requestId` scope variable and
 * the response header — the request-id header rides every response the
 * scope builds.
 */
export function createRequestIdMiddleware(options: RequestIdOptions = {}): WinterCgFetchMiddleware {
  const limitLength = options.limitLength ?? 255;
  const headerName = options.headerName ?? 'X-Request-Id';
  const generator = options.generator ?? (() => crypto.randomUUID());
  return (request, next) => {
    const scope = requestScope(request, 'requestId');
    let requestId = scope.req.header(headerName);
    if (!requestId || requestId.length > limitLength || /[^\w\-=]/.test(requestId)) {
      requestId = generator(request);
    }
    scope.set('requestId', requestId);
    if (headerName) scope.header(headerName, requestId);
    return Promise.resolve(next());
  };
}

// ── logger ────────────────────────────────────────────────────────────────

/** Options for {@linkcode createLoggerMiddleware}. */
export interface LoggerOptions {
  /** The print function. Default `console.log`. */
  print?: (line: string) => void;
}

/**
 * Logs `<-- METHOD /path` before the chain and
 * `--> METHOD /path 200 12ms` after it, with the elapsed time humanized
 * the way the previous built-in logged it. No color support: the color
 * policy read `process.env`, which shipped runtime code must not (P3).
 */
export function createLoggerMiddleware(options: LoggerOptions = {}): WinterCgFetchMiddleware {
  const print = options.print ?? ((line: string) => console.log(line));
  return async (request, next) => {
    const url = request.url;
    const path = url.slice(url.indexOf('/', 8));
    const method = request.method;
    print(`<-- ${method} ${path}`);
    const start = Date.now();
    const response = await next();
    print(`--> ${method} ${path} ${response.status} ${humanizeElapsed(Date.now() - start)}`);
    return response;
  };
}

/** `912ms` / `2s` — the previous built-in's elapsed formatting. */
function humanizeElapsed(delta: number): string {
  const value = delta < 1e3 ? `${delta}ms` : `${Math.round(delta / 1e3)}s`;
  return value.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1,');
}

// ── cors ──────────────────────────────────────────────────────────────────

/** Options for {@linkcode createCorsMiddleware} — the surface the generated entry emits. */
export interface CorsOptions {
  /** The `Access-Control-Allow-Origin` value: one origin, a list, or a resolver returning an origin or undefined. */
  origin?: string | string[] | ((origin: string) => string | undefined | null);
  /** The `Access-Control-Allow-Methods` list. */
  allowMethods?: string[];
  /** The `Access-Control-Allow-Headers` list. */
  allowHeaders?: string[];
  /** The `Access-Control-Expose-Headers` list. */
  exposeHeaders?: string[];
  /** Emits `Access-Control-Allow-Credentials: true`. */
  credentials?: boolean;
  /** Emits `Access-Control-Max-Age` on preflights. */
  maxAge?: number;
}

const CORS_DEFAULT_ALLOW_METHODS = ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH', 'QUERY'];

/**
 * The CORS middleware: non-preflight requests get the allow-origin (and
 * credentials/expose) headers on the channel and an appended
 * `Vary: Origin` when the origin is not `*`; an `OPTIONS` preflight
 * short-circuits with 204 and the full allow set. The origin resolver may
 * return undefined to deny — the generated default reflects only
 * localhost origins and denies everything else.
 */
export function createCorsMiddleware(options: CorsOptions = {}): WinterCgFetchMiddleware {
  const origin = options.origin ?? '*';
  const allowMethods = options.allowMethods ?? CORS_DEFAULT_ALLOW_METHODS;
  const allowHeaders = options.allowHeaders ?? [];
  const exposeHeaders = options.exposeHeaders ?? [];
  const allowMethodsValue = allowMethods.join(',');
  const exposeHeadersValue = exposeHeaders.length > 0 ? exposeHeaders.join(',') : undefined;
  const allowHeadersValue = allowHeaders.length > 0 ? allowHeaders.join(',') : undefined;
  const findAllowOrigin = (requestOrigin: string): string | undefined => {
    if (typeof origin === 'string')
      return origin === '*' ? origin : origin === requestOrigin ? origin : undefined;
    if (typeof origin === 'function') return origin(requestOrigin) ?? undefined;
    return origin.includes(requestOrigin) ? requestOrigin : undefined;
  };
  return async (request, next) => {
    const scope = requestScope(request, 'cors');
    const requestOrigin = scope.req.header('origin') ?? '';
    const allowOrigin = findAllowOrigin(requestOrigin);
    if (allowOrigin) scope.header('Access-Control-Allow-Origin', allowOrigin);
    if (options.credentials) scope.header('Access-Control-Allow-Credentials', 'true');
    if (exposeHeadersValue) scope.header('Access-Control-Expose-Headers', exposeHeadersValue);
    if (request.method === 'OPTIONS') {
      if (origin !== '*') scope.header('Vary', 'Origin', { append: true });
      if (options.maxAge != null) scope.header('Access-Control-Max-Age', String(options.maxAge));
      scope.header('Access-Control-Allow-Methods', allowMethodsValue);
      let headersValue = allowHeadersValue;
      if (!headersValue) {
        const requestHeaders = scope.req.header('Access-Control-Request-Headers');
        if (requestHeaders) {
          headersValue = requestHeaders
            .split(',')
            .map((header) => header.trim())
            .join(',');
        }
      }
      if (headersValue) {
        scope.header('Access-Control-Allow-Headers', headersValue);
        scope.header('Vary', 'Access-Control-Request-Headers', { append: true });
      }
      // The preflight short-circuit: 204 with the channel's allow set and
      // no body/length metadata (the previous built-in stripped both).
      const headers = new Headers(scope.headers);
      headers.delete('Content-Length');
      headers.delete('Content-Type');
      return new Response(null, { status: 204, statusText: 'No Content', headers });
    }
    const response = await next();
    if (origin !== '*') response.headers.append('Vary', 'Origin');
    return response;
  };
}

// ── secure-headers ────────────────────────────────────────────────────────

/**
 * The security response headers, applied after the response exists so a
 * handler cannot skip them, plus `X-Powered-By` removal. Same names and
 * values (and the same disabled `Cross-Origin-Embedder-Policy` default)
 * as the built-in set they replace.
 */
export function createSecureHeadersMiddleware(): WinterCgFetchMiddleware {
  return async (request, next) => {
    const response = await next();
    for (const [name, value] of SECURITY_HEADERS) response.headers.set(name, value);
    response.headers.delete('X-Powered-By');
    return response;
  };
}

/** The default security header set, in emission order. */
const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Cross-Origin-Resource-Policy', 'same-origin'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Origin-Agent-Cluster', '?1'],
  ['Referrer-Policy', 'no-referrer'],
  ['Strict-Transport-Security', 'max-age=15552000; includeSubDomains'],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-DNS-Prefetch-Control', 'off'],
  ['X-Download-Options', 'noopen'],
  ['X-Frame-Options', 'SAMEORIGIN'],
  ['X-Permitted-Cross-Domain-Policies', 'none'],
  ['X-XSS-Protection', '0'],
];

// ── shared ────────────────────────────────────────────────────────────────

/**
 * The built-in middleware run inside the app's dispatch, where the scope
 * is always already bound; a missing binding means the middleware was
 * composed outside the generated app — an integration bug, so it fails
 * loudly instead of silently dropping its headers.
 */
function requestScope(request: Request, middlewareName: string): OpenElementRequestScope {
  const scope = boundRequestScope(request);
  if (!scope) {
    throw new Error(
      `[openElement] ${middlewareName} middleware ran outside a bound request scope. ` +
        'Register built-in middleware through the generated app (app.use), not a bare compose.',
    );
  }
  return scope;
}
