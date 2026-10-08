/**
 * @openelement/router/server-runtime — the internal WinterCG composition
 * layer (#1560, the #152 product-router positioning restored).
 *
 * The generated server entry composes HERE, not in Hono: a middleware
 * chain (`(request, next) => Response` onion), the fn-form API mounts, and
 * the 404 terminal policy — every layer speaks the same dialect-free
 * WinterCG shape the public authoring contract
 * (@openelement/router/http) already speaks. Hono is no longer the entry's
 * composition engine; it is an optional peer behind a single adapter
 * (@openelement/router/hono) for consumers that mount the handler inside
 * their own Hono app.
 *
 * The per-request {@linkcode OpenElementRequestScope} is the request
 * mechanics the generated handlers bind (`c` in the emitted wiring): the
 * request view (`req.raw/path/param/header`), the response-header channel
 * every framework-set header flows through, the runtime env/platform
 * binding, the typed variable bag (the CSP nonce), and the response
 * constructors (`html/text/json/redirect/body`). It never reaches author
 * contracts: `_middleware.ts` and `middleware.use` see plain
 * `(request, next)`, API route functions see
 * `{ request, params, env, platform }`, and renderers see the same narrow
 * `{ req, get, set }` view the SSG render path always handed them.
 *
 * Behavior parity with the Hono composition it replaces is deliberate and
 * pinned by the unit tests beside this module: middleware run in
 * registration order before routes; a `use('/p/*')` scope matches `/p`
 * itself and everything under it while a bare `use('/p')` matches only
 * `/p`; fn-form API mounts win over the route middleware (most specific
 * path, any method, params resolved from the match); unmatched requests
 * fall to `notFound`; a missing `notFound` answers plain-text
 * `404 Not Found`; a rejection the chain leaks answers plain-text
 * `500 Internal Server Error` — the host never sees a rejected fetch.
 */

import { composeFetchMiddleware } from '@openelement/element/build-utils';
import { RouteTable } from '../../../router.ts';

/** The dialect-free fetch middleware the whole composition speaks. */
export type WinterCgFetchMiddleware = (
  request: Request,
  next: () => Promise<Response>,
) => Promise<Response>;

/** The request view the generated wiring binds as `c.req`. */
export interface RequestScopeRequest {
  /** The underlying WinterCG request (replaceable — the body limit swaps in a buffered twin). */
  raw: Request;
  /** The full request URL string. */
  readonly url: string;
  /** The request pathname. */
  readonly path: string;
  /** The route-match path params (empty outside a match). */
  param(): Record<string, string>;
  /** One request header. */
  header(name: string): string | undefined;
}

/**
 * The per-request scope: one instance per dispatch, bound to its request
 * by the identity registry. Response headers written before the
 * response exists (`header()`) flow into every response the scope
 * constructs — the merge point the Hono context's prepared headers used to
 * own.
 */
export interface OpenElementRequestScope {
  readonly req: RequestScopeRequest;
  /**
   * The response-header channel. Headers the handler or the built-in
   * middleware write before a response exists (`Cache-Control`, `Vary`,
   * `X-Request-Id`, the security set) land here and merge into every
   * response the scope builds. Stream routes hand the handler a separate
   * committed stream channel; the scope keeps supplying the framework set.
   */
  readonly headers: Headers;
  /** The runtime env binding (`fetch(request, env)`). */
  readonly env: Record<string, unknown>;
  /** The host execution context; throws when the host passed none (call sites guard). */
  get executionCtx(): unknown;
  /** Writes one response header on the channel (set by default, append opt-in). */
  header(name: string, value: string, options?: { append?: boolean }): void;
  /** Reads one typed variable (e.g. `cspNonce`). */
  get(key: string): unknown;
  /** Writes one typed variable. */
  set(key: string, value: unknown): void;
  /** `application/json` response starting from the channel headers. */
  json(object: unknown, status?: number, headers?: Record<string, string>): Response;
  /** `text/plain; charset=UTF-8` response starting from the channel headers. */
  text(text: string, status?: number, headers?: Record<string, string>): Response;
  /** `text/html; charset=UTF-8` response starting from the channel headers. */
  html(html: string, status?: number, headers?: Record<string, string>): Response;
  /** Redirect response (`Location` + status, default 302). */
  redirect(location: string, status?: number): Response;
  /** Raw-body response starting from the channel headers. */
  body(data: BodyInit | null, status?: number, headers?: Record<string, string>): Response;
}

const TEXT_PLAIN = 'text/plain; charset=UTF-8';
const TEXT_HTML = 'text/html; charset=UTF-8';

/**
 * Creates one per-request scope. Exported for the generated wiring's test
 * harnesses; {@linkcode WinterCgApp.fetch} creates and binds one per
 * dispatch.
 */
export function createRequestScope(
  request: Request,
  env: Record<string, unknown> = {},
  platform?: unknown,
): OpenElementRequestScope {
  const channel = new Headers();
  const variables = new Map<string, unknown>();
  const params: Record<string, string> = {};
  const scope: OpenElementRequestScope = {
    req: {
      raw: request,
      url: request.url,
      path: new URL(request.url).pathname,
      param: () => scopeParams.get(scope) ?? params,
      header: (name) => request.headers.get(name) ?? undefined,
    },
    headers: channel,
    env,
    get executionCtx() {
      if (platform === undefined) {
        throw new TypeError('This request has no execution context.');
      }
      return platform;
    },
    header: (name, value, options) => {
      if (value === undefined) channel.delete(name);
      else if (options?.append) channel.append(name, value);
      else channel.set(name, value);
    },
    get: (key) => variables.get(key),
    set: (key, value) => {
      variables.set(key, value);
    },
    json: (object, status = 200, headers) =>
      new Response(JSON.stringify(object) ?? '', {
        status,
        headers: withChannelHeaders(channel, { 'Content-Type': 'application/json' }, headers),
      }),
    text: (text, status = 200, headers) =>
      new Response(text, {
        status,
        headers: withChannelHeaders(channel, { 'Content-Type': TEXT_PLAIN }, headers),
      }),
    html: (html, status = 200, headers) =>
      new Response(html, {
        status,
        headers: withChannelHeaders(channel, { 'Content-Type': TEXT_HTML }, headers),
      }),
    redirect: (location, status = 302) =>
      new Response(null, {
        status,
        headers: withChannelHeaders(channel, { Location: location }),
      }),
    body: (data, status = 200, headers) =>
      new Response(data, { status, headers: withChannelHeaders(channel, undefined, headers) }),
  };
  return scope;
}

/**
 * Builds one response Headers instance: a copy of the channel, overlaid by
 * the constructor default (content type) and then the explicit per-call
 * headers — the explicit call wins, the channel supplies everything the
 * call did not set.
 */
function withChannelHeaders(
  channel: Headers,
  defaults: Record<string, string> | undefined,
  explicit?: Record<string, string>,
): Headers {
  const headers = new Headers(channel);
  if (defaults) for (const [name, value] of Object.entries(defaults)) headers.set(name, value);
  if (explicit) for (const [name, value] of Object.entries(explicit)) headers.set(name, value);
  return headers;
}

/** A fn-form API handler: the `(ctx) => Response` form an API route module default-exports. */
export type ApiRouteFunction = (
  request: Request,
  scope: OpenElementRequestScope,
) => Response | Promise<Response>;

/** One `all(path, handler)` mount. */
interface ApiMount {
  path: string;
  handler: ApiRouteFunction;
}

/** The internal WinterCG app: the composition surface the generated entry wires. */
export interface WinterCgApp {
  /** Registers middleware, optionally path-scoped (`'*'`, `'/p/*'`, or a bare `'/p'`). */
  use(pattern: string, middleware: WinterCgFetchMiddleware): void;
  /**
   * Registers the route-table layer: theWinterCG middleware that resolves
   * method-keyed records (createRouteMiddleware). It composes after the
   * fn-form mounts — the route layer, not an outer middleware — so a mount
   * and a record at the same path resolve with route specificity, the way
   * the replaced composition ordered them.
   */
  route(middleware: WinterCgFetchMiddleware): void;
  /** Mounts a fn-form API handler at a path — every method reaches it, params resolve from the match. */
  all(path: string, handler: ApiRouteFunction): void;
  /** The 404 terminal: invoked when no middleware or mount produced a response. */
  notFound(
    handler: (request: Request, scope: OpenElementRequestScope) => Response | Promise<Response>,
  ): void;
  /** The dispatch: the composed chain over one request. Never rejects. */
  fetch(request: Request, env?: Record<string, unknown>, platform?: unknown): Promise<Response>;
  /** `Request`-convenience dispatch (the SSG prerender and test harnesses). */
  request(
    input: string | URL | Request,
    init?: RequestInit,
    env?: Record<string, unknown>,
  ): Promise<Response>;
  /** The per-request scope accessor the generated handlers bind (`__requestScope`). */
  requestScope(request: Request): OpenElementRequestScope | undefined;
  /** The fn-form mounts (the SSG prerender's page-discovery exclusion set). */
  readonly routes: ReadonlyArray<{ method: 'ALL'; path: string }>;
}

/** The bare 404 a missing `notFound` handler answers with (plain text). */
function defaultNotFound(): Response {
  return new Response('404 Not Found', { status: 404, headers: { 'Content-Type': TEXT_PLAIN } });
}

/**
 * Hono-compatible middleware-scope matching: `'/p/*'` matches `/p` itself
 * and everything beneath it; `'/*'` matches everything; a bare `'/p'`
 * matches only `/p` exactly.
 */
export function matchesMiddlewareScope(pattern: string, pathname: string): boolean {
  if (pattern === '/*') return true;
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return pathname === prefix || pathname.startsWith(prefix + '/');
  }
  return pathname === pattern;
}

/**
 * The per-request scope registry: one binding per dispatch, keyed by
 * request identity. The app's dispatch binds; the generated handlers and
 * the built-in middleware read. A Request body can be read once, so one
 * scope per request object is sound.
 */
const boundScopes = new WeakMap<Request, OpenElementRequestScope>();

/** The scope accessor the generated handlers and built-in middleware share. */
export function boundRequestScope(request: Request): OpenElementRequestScope | undefined {
  return boundScopes.get(request);
}

/**
 * Route-match path params, bound per scope: the fn-form mount layer sets
 * them from its RouteTable match right before the handler runs; every
 * other request reads the empty record.
 */
const scopeParams = new WeakMap<object, Record<string, string>>();

/**
 * Creates the internal WinterCG app one generated entry assembles. The
 * dispatch builds lazily on the first fetch (registration happens at
 * module scope) and rebuilds if anything registers afterwards.
 */
export function createWinterCgApp(): WinterCgApp {
  const middleware: Array<{ pattern: string; handler: WinterCgFetchMiddleware }> = [];
  const mounts: ApiMount[] = [];
  let routeLayer: WinterCgFetchMiddleware | undefined;
  let notFoundHandler:
    | ((request: Request, scope: OpenElementRequestScope) => Response | Promise<Response>)
    | undefined;
  let dispatch: ((request: Request) => Promise<Response>) | undefined;
  let apiTable: RouteTable<{ id: string; path: string }> | undefined;

  const rebuild = (): void => {
    dispatch = undefined;
    apiTable = undefined;
  };

  const terminal = (request: Request): Promise<Response> => {
    const scope = boundScopes.get(request)!;
    if (!notFoundHandler) return Promise.resolve(defaultNotFound());
    return Promise.resolve(notFoundHandler(request, scope));
  };

  const apiFnDispatch: WinterCgFetchMiddleware = (request, next) => {
    if (mounts.length === 0) return next();
    const scope = boundScopes.get(request);
    if (!scope) return next();
    const pathname = new URL(request.url).pathname;
    apiTable ??= new RouteTable(
      mounts.map((mount, index) => ({ id: String(index), path: mount.path })),
    );
    const match = apiTable.match(pathname);
    if (!match) return next();
    const mount = mounts[Number(match.id)];
    scopeParams.set(scope, match.params);
    return Promise.resolve(mount.handler(request, scope));
  };

  return {
    use(pattern, handler) {
      middleware.push({ pattern, handler });
      rebuild();
    },
    route(middleware) {
      routeLayer = middleware;
      rebuild();
    },
    all(path, handler) {
      mounts.push({ path, handler });
      rebuild();
    },
    notFound(handler) {
      notFoundHandler = handler;
      rebuild();
    },
    get routes() {
      return mounts.map((mount) => ({ method: 'ALL' as const, path: mount.path }));
    },
    requestScope: boundRequestScope,
    fetch(request, env = {}, platform) {
      dispatch ??= buildDispatch(middleware, apiFnDispatch, routeLayer, terminal);
      const scope = createRequestScope(request, env, platform);
      boundScopes.set(request, scope);
      // The dispatch never rejects (buildDispatch's async wrapper) and the
      // channel merges into whatever response the chain produced — the
      // prepared-headers behavior of the replaced composition: middleware
      // headers ride every response, however the handler built it.
      return dispatch(request)
        .then((response) => applyChannelHeaders(response, scope.headers))
        .catch((error) => {
          // The host never sees a rejected fetch: an uncaught chain rejection
          // answers plain-text 500 (the previous composition's default).
          console.error(
            '[openElement] Unhandled request failure for ' + scope.req.path + ':',
            error,
          );
          return new Response('Internal Server Error', {
            status: 500,
            headers: { 'Content-Type': TEXT_PLAIN },
          });
        });
    },
    request(input, init, env = {}) {
      // Relative paths resolve against http://localhost — the previous
      // composition's convenience form.
      const source = typeof input === 'string' ? new URL(input, 'http://localhost').href : input;
      const request = new Request(source, init);
      return this.fetch(request, env);
    },
  };
}

/**
 * Builds the composed dispatch once registration settles: the `use`
 * middleware in registration order (scope-filtered where scoped), then the
 * route layer — the fn-form mounts ahead of the method-keyed records — then
 * the notFound terminal. `composeFetchMiddleware` keeps the onion: the first
 * `use` sees the request first. The async wrapper turns a synchronous
 * middleware throw into a rejection so the caller's guard always applies.
 */
function buildDispatch(
  middleware: Array<{ pattern: string; handler: WinterCgFetchMiddleware }>,
  apiFnDispatch: WinterCgFetchMiddleware,
  routeLayer: WinterCgFetchMiddleware | undefined,
  terminal: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  const chain: WinterCgFetchMiddleware[] = middleware.map(({ pattern, handler }) =>
    pattern === '*'
      ? handler
      : (request, next) =>
          matchesMiddlewareScope(pattern, new URL(request.url).pathname)
            ? handler(request, next)
            : next(),
  );
  if (routeLayer) chain.push(apiFnDispatch, routeLayer);
  else chain.push(apiFnDispatch);
  const composed = composeFetchMiddleware(chain, terminal);
  return (request) => Promise.resolve().then(() => composed(request));
}

/**
 * The response-boundary channel merge — the prepared-headers semantics of
 * the replaced composition: the channel wins on every header except
 * content-type (the handler's media type stands), and multi-value
 * set-cookie accumulates.
 */
function applyChannelHeaders(response: Response, channel: Headers): Response {
  let needsMerge = false;
  channel.forEach(() => {
    needsMerge = true;
  });
  if (!needsMerge) return response;
  const merged = new Headers(response.headers);
  channel.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'content-type') return;
    if (lower === 'set-cookie') {
      merged.delete('set-cookie');
      merged.append('set-cookie', value);
      return;
    }
    merged.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
