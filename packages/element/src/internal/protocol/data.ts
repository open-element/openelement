/**
 * data.ts - Platform-neutral data adapter protocol.
 *
 * Data adapters are contract surfaces for route data and ISR regeneration.
 * Concrete databases, filesystems, network clients, and auth layers stay in
 * adapters or recipes.
 */

/** Fetch and enumerate data by key without owning storage implementation. */

// ─── Route data layer types (v0.40.0) ──────────────────────────────

/**
 * Context passed to a request-time ('dynamic') route loader. This is the
 * server contract: the loader runs on the server with the Web-standard
 * request, matched route params, the host environment and the platform
 * object, and signals validation failure via fail()/redirect() (ADR-0120).
 */
export interface ServerRouteMetadata {
  path: string;
  filePath: string;
}

/** Canonical request-time/SSG server route context. */
export interface ServerRouteContext<
  Env extends object = Record<string, string | undefined>,
  Platform = unknown,
  Route extends ServerRouteMetadata = ServerRouteMetadata,
> {
  request: Request;
  params: Record<string, string>;
  env: Env;
  platform: Platform | undefined;
  /** Mutable response-only channel merged into the framework response. */
  responseHeaders: Headers;
  route: Route;
}

/** Context passed to a request-time ('dynamic') route loader. */
export interface LoaderContext<
  Env extends object = Record<string, string | undefined>,
  Platform = unknown,
  Route extends ServerRouteMetadata = ServerRouteMetadata,
> extends ServerRouteContext<Env, Platform, Route> {}

/** Context passed to a route action function (extends loader context). */
export interface ActionContext<
  Env extends object = Record<string, string | undefined>,
  Platform = unknown,
  Route extends ServerRouteMetadata = ServerRouteMetadata,
> extends LoaderContext<Env, Platform, Route> {
  formData: FormData;
}

/** Route loader: fetches data for a page route. */
export type Loader<
  T = unknown,
  Env extends object = Record<string, string | undefined>,
  Platform = unknown,
  Route extends ServerRouteMetadata = ServerRouteMetadata,
> = (ctx: LoaderContext<Env, Platform, Route>) => T | Promise<T>;

/** Route action: handles form submissions for a page route. */
export type Action<
  T = unknown,
  Env extends object = Record<string, string | undefined>,
  Platform = unknown,
  Route extends ServerRouteMetadata = ServerRouteMetadata,
> = (ctx: ActionContext<Env, Platform, Route>) => T | Promise<T>;

/**
 * Wire shape returned to the JavaScript form-enhancement path (0.42.0-alpha.2,
 * ADR-0120). The no-JS path never sees this: it gets the equivalent semantics
 * as plain HTTP (303 on success, 422 with the re-rendered form on validation
 * failure, redirect/error as status codes).
 *
 * Error outcomes (CSRF 403, unknown action 404, unparseable body 400,
 * unexpected 500) are NOT part of this union: since 0.42.0-alpha.13 (#863,
 * ADR-0123 addendum item 13) they answer RFC 9457 Problem Details with the
 * PROBLEM_JSON_MEDIA_TYPE content type — see ProblemDetails.
 */
export type ActionResult<Success = unknown, Failure = unknown> =
  | { type: 'success'; status: number; data?: Success }
  | { type: 'failure'; status: number; data?: Failure }
  | { type: 'redirect'; status: number; location: string };

/**
 * RFC 9457 Problem Details document (0.42.0-alpha.13, #863, ADR-0123 addendum
 * item 13): the action error channel answers `application/problem+json`
 * instead of the bespoke `{ type: 'error', error: { message } }` JSON, so
 * HTTP tooling recognizes failures natively. With `type: 'about:blank'`,
 * `title` is the HTTP reason phrase and `detail` carries the specific
 * explanation. The wire shape is alpha-unfrozen; ADR-0122 acceptance freezes
 * it in this problem+json form.
 */
export interface ProblemDetails {
  /** URI reference identifying the problem type; 'about:blank' when none applies. */
  type: string;
  /** Short human-readable summary (the HTTP reason phrase for 'about:blank'). */
  title: string;
  /** The HTTP status code generated for this occurrence. */
  status: number;
  /** Human-readable explanation specific to this occurrence. */
  detail?: string;
}

/** Media type of the RFC 9457 action error channel (#863). */
export const PROBLEM_JSON_MEDIA_TYPE = 'application/problem+json';

/**
 * Request header selecting the action response channel (ADR-0121, amends
 * ADR-0120): `true` marks a programmatic caller and selects the serialized
 * ActionResult union; `enhance` marks the built-in morph enhancement and
 * selects the same full-HTML responses the no-JS path receives.
 */
export const ACTION_FETCH_HEADER = 'x-openelement-action';
