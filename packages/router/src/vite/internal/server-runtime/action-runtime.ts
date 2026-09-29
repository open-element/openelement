/**
 * @openelement/router/server-runtime — the action POST protocol.
 *
 * The request-time action semantics of the generated Hono entry: the
 * same-origin CSRF floor (#611, #921, #938, #1382), named-action dispatch
 * (#542), the canonical action classification (#541), the fetch-channel
 * ActionResult union, the RFC 9457 problem+json error channel (#863),
 * the POST/Redirect/GET flow (#548), the default body limit (#568) bound to
 * the policy constant, the ADR-0121 redirect coercion, and the internal
 * Hono↔WinterCG bridge every generated page handler composes through.
 * Migrated verbatim from the generated-entry strings (entry-action-runtime.ts,
 * entry-codegen.ts, entry-orchestrator.ts) so the protocol is visible to
 * `deno check` and directly unit-testable (ADR-0160 rule a).
 *
 * Behavior contract (ADR-0120/ADR-0121): a validation failure RETURNs
 * `fail(status, data)` and the no-JS channel re-renders the form at that
 * status (422); success redirects through PRG 303; CSRF rejections, unknown
 * actions, unparseable bodies, and unexpected errors answer problem+json on
 * the fetch channel and status pages / plain text on the native form channel.
 * The end-to-end behavior is pinned by the read-only request-time-parity
 * oracle (29 steps, both runtimes) and the action-runtime unit tests beside
 * this module.
 *
 * The protocol constants come from the authoring leaves (Element's
 * `internal/protocol/data.ts` via `@openelement/element/authoring`, and the
 * router's own authoring module) — both kernel-free, so the LIT entry's
 * import graph stays clean (#1339). The body-limit NUMBER is injected, not
 * imported: it lives behind the Element runtime facade, which packed consumer
 * setups and the LIT graph cannot import, so the generated entry serializes
 * the canonical `MAX_ACTION_BODY_BYTES` value as build data and hands it to
 * {@linkcode createActionBodyLimit} at binding time.
 */

import { ACTION_FETCH_HEADER, PROBLEM_JSON_MEDIA_TYPE } from '@openelement/element/authoring';
import { bodyLimit } from 'hono/body-limit';
import { classifyActionResult } from '../../../authoring.ts';
import type { ActionOutcome } from '../../../authoring.ts';

export { ACTION_FETCH_HEADER, PROBLEM_JSON_MEDIA_TYPE };

/**
 * The slice of the Hono request context the action protocol touches. The
 * generated entry passes its real Hono context; the narrow shape keeps this
 * module unit-testable without hono.
 */
export interface ActionHonoContext {
  req: {
    /** The full request URL. */
    readonly url: string;
    /** The underlying WinterCG request. */
    readonly raw: Request;
    header(name: string): string | undefined;
  };
  header(name: string, value: string): void;
  get(key: string): unknown;
  json(object: unknown, status?: number, headers?: Record<string, string>): Response;
  text(text: string, status?: number): Response;
  redirect(location: string, status?: number): Response;
  /** The response under construction (read by the middleware bridge fallback). */
  readonly res: Response;
}

/** A route module namespace as far as the action protocol reads it. */
interface ActionRouteModule {
  actions?: unknown;
  action?: unknown;
}

/** The load context the generated handler built; actions receive it plus `formData`. */
export type ActionLoadContext = { env?: unknown } & Record<string, unknown>;

/**
 * The per-request action channel state: mutated by
 * {@linkcode runActionProtocol} before any protocol exit so the generated
 * handler's catch block can branch on the fetch path (ADR-0121).
 */
export interface ActionProtocolState {
  isFetch: boolean;
}

/** What one protocol run hands back to the generated handler. */
export interface ActionExecution {
  /** When set, the handler returns this response and renders nothing. */
  response?: Response;
  /** The classified action outcome for the 422 re-render (native failure path). */
  actionResult?: ActionOutcome;
}

/**
 * Runs the action POST protocol for one request: resolve the action
 * (named `?/name` map or bare `action` export), enforce the same-origin CSRF
 * floor, parse the form body, classify the outcome, and answer per channel:
 *
 * - fetch callers (`ACTION_FETCH_HEADER: true`) always get JSON — the
 *   ActionResult union for outcomes, RFC 9457 problem+json for protocol
 *   errors (CSRF 403, unknown action 404, unparseable body 400);
 * - native form callers get PRG 303 on success, the status page on protocol
 *   errors, and `{ actionResult }` back for a `fail()` so the handler
 *   re-renders the form at the author's status (422).
 */
export async function runActionProtocol(
  context: ActionHonoContext,
  routeModule: unknown,
  loadContext: ActionLoadContext,
  renderStatusPage: (title: string, message: string, status: number) => Response,
  state: ActionProtocolState,
): Promise<ActionExecution> {
  const url = new URL(context.req.url);
  const actionName = (() => {
    for (const key of url.searchParams.keys()) if (key.startsWith('/')) return key.slice(1);
    return undefined;
  })();
  const module = routeModule as ActionRouteModule | undefined | null;
  const namedActions = typeof module?.actions === 'object' && module?.actions !== null
    ? module.actions as Record<string, unknown>
    : {};
  const actionFn = actionName !== undefined
    ? (Object.prototype.hasOwnProperty.call(namedActions, actionName)
      ? namedActions[actionName]
      : undefined)
    : (typeof module?.action === 'function' ? module.action : undefined);
  state.isFetch = context.req.header(ACTION_FETCH_HEADER) === 'true';

  const env = (loadContext.env ?? {}) as Record<string, unknown>;
  const csrfOff = env.OPEN_ELEMENT_DISABLE_CSRF === '1';
  if (!csrfOff) {
    const origin = context.req.header('origin');
    const fetchSite = (context.req.header('sec-fetch-site') || '').toLowerCase();
    let crossSite = fetchSite === 'cross-site';
    if (!crossSite && origin && origin !== 'null') {
      try {
        const source = new URL(origin);
        const target = new URL(context.req.url);
        const loopback = (host: string) =>
          host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
        crossSite = source.origin !== target.origin && !(
          source.protocol === 'http:' && target.protocol === 'http:' &&
          loopback(source.hostname) && loopback(target.hostname)
        );
      } catch {
        crossSite = true;
      }
    } else if (!crossSite && fetchSite === 'same-site') {
      crossSite = true;
    }
    // #1382: the residual window is a client that omits BOTH Origin and Fetch
    // Metadata — the allowance above exists for non-browser tools (curl,
    // health probes). A browser-shaped form body (urlencoded or multipart)
    // that also carries browser navigation evidence (Upgrade-Insecure-
    // Requests, or the text/html Accept every form navigation sends) is not
    // that: it is a pre-Fetch-Metadata browser (Safari < 16.4, Chrome < 76),
    // which does send Origin on a form POST (the #921 assumption), so a
    // missing Origin is fail-closed here. An Origin of literal null is still
    // an Origin the browser sent — the #938 no-referrer case — and is
    // deliberately left to that rule.
    if (!crossSite && !origin && !fetchSite) {
      const contentType = (context.req.header('content-type') || '').toLowerCase();
      const browserFormBody = contentType.indexOf('application/x-www-form-urlencoded') === 0 ||
        contentType.indexOf('multipart/form-data') === 0;
      if (browserFormBody) {
        const accept = (context.req.header('accept') || '').toLowerCase();
        const browserNavigation = (context.req.header('upgrade-insecure-requests') || '') === '1' ||
          accept.indexOf('text/html') !== -1;
        if (browserNavigation) crossSite = true;
      }
    }
    if (crossSite) {
      const response = state.isFetch
        ? context.json(
          {
            type: 'about:blank',
            title: 'Forbidden',
            status: 403,
            detail: 'Cross-site form submission rejected',
          },
          403,
          { 'Content-Type': PROBLEM_JSON_MEDIA_TYPE },
        )
        : context.text('Forbidden', 403);
      return { response };
    }
  }

  if (typeof actionFn !== 'function') {
    const message = actionName !== undefined
      ? 'No action named "' + actionName + '" on this route.'
      : 'This route does not accept submissions.';
    const response = state.isFetch
      ? context.json(
        { type: 'about:blank', title: 'Not Found', status: 404, detail: message },
        404,
        { 'Content-Type': PROBLEM_JSON_MEDIA_TYPE },
      )
      : renderStatusPage('404 Not Found', message, 404);
    return { response };
  }

  let formData: FormData;
  try {
    formData = await context.req.raw.formData();
  } catch {
    const message = 'Could not parse the form body.';
    const response = state.isFetch
      ? context.json(
        { type: 'about:blank', title: 'Bad Request', status: 400, detail: message },
        400,
        { 'Content-Type': PROBLEM_JSON_MEDIA_TYPE },
      )
      : renderStatusPage('400 Bad Request', message, 400);
    return { response };
  }

  const actionOutcome = classifyActionResult(
    await (actionFn as (actionContext: ActionLoadContext & { formData: FormData }) => unknown)({
      ...loadContext,
      formData,
    }),
  );
  const prgParams = new URLSearchParams(url.search);
  for (const key of [...prgParams.keys()]) if (key.startsWith('/')) prgParams.delete(key);
  const search = prgParams.toString();
  const prgTarget = url.pathname + (search ? '?' + search : '');

  if (state.isFetch) {
    if (actionOutcome.kind === 'failure') {
      let data = actionOutcome.data;
      try {
        if (JSON.stringify(data) === undefined) data = null;
      } catch {
        data = null;
      }
      return {
        response: context.json(
          { type: 'failure', status: actionOutcome.status, data },
          actionOutcome.status,
        ),
      };
    }
    return { response: context.json({ type: 'redirect', status: 303, location: prgTarget }) };
  }
  if (actionOutcome.kind === 'success') {
    return { response: context.redirect(prgTarget, 303) };
  }
  return { actionResult: actionOutcome };
}

/**
 * The default body-limit middleware for action POST routes (#568), bound to
 * the serialized `MAX_ACTION_BODY_BYTES` policy constant (see the module
 * doc): an oversized body answers the fetch channel with problem+json 413
 * (same fork as the CSRF 403) and the native form channel with plain text.
 * The no-store/Vary negotiation headers ride every 413 like every other
 * action response. Larger uploads belong on API routes with explicit limits.
 */
export function createActionBodyLimit(maxSize: number) {
  return bodyLimit({
    maxSize,
    onError: (c) => {
      c.header('Cache-Control', 'no-store');
      c.header('Vary', ACTION_FETCH_HEADER);
      if (c.req.header(ACTION_FETCH_HEADER) === 'true') {
        return c.json(
          {
            type: 'about:blank',
            title: 'Payload Too Large',
            status: 413,
            detail: 'The request body exceeded the 10 MiB action limit.',
          },
          413,
          { 'Content-Type': PROBLEM_JSON_MEDIA_TYPE },
        );
      }
      return c.text('Payload Too Large', 413);
    },
  });
}

/**
 * The ADR-0121 redirect exit for a POST action: every 3xx an author throws
 * out of an action is coerced to 303 — PRG must be method-safe and
 * non-cacheable. The native form channel answers a real 303; the fetch
 * channel answers HTTP 200 with the redirect carried as the ActionResult
 * body (`{ type: 'redirect', status: 303, location }`) — the serialized
 * client executor matches on the body, not the HTTP status. GET handlers
 * keep the author's status (the generated catch emits that branch itself).
 */
export function actionRedirectResponse(
  context: ActionHonoContext,
  location: string,
  isFetch: boolean,
): Response {
  const status = 303;
  if (isFetch) {
    return context.json({ type: 'redirect', status, location });
  }
  return context.redirect(location, status);
}

/**
 * The fetch-channel 500 (#863, #558): an unexpected action rejection answers
 * RFC 9457 problem+json with internals scrubbed in production (the detail
 * degrades to the reason phrase; development keeps the message for
 * debugging). The native channel stays on the generated handler's HTML error
 * boundary. `production` is the entry's `import.meta.env.PROD`, injected so
 * this module stays free of build-tool globals.
 */
export function actionErrorResponse(
  context: ActionHonoContext,
  routePath: string,
  error: unknown,
  production: boolean,
): Response {
  console.error('[openElement] Action POST failed for ' + routePath + ':', error);
  return context.json(
    {
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: production
        ? 'Internal Server Error'
        // Same scrub expression the emitted handler carried: a truthy
        // `message` property wins verbatim, anything else degrades to the
        // thrown value itself.
        : String(
          error && (error as { message?: unknown }).message
            ? (error as { message: unknown }).message
            : error,
        ),
    },
    500,
    { 'Content-Type': PROBLEM_JSON_MEDIA_TYPE },
  );
}

/**
 * The internal Hono↔WinterCG bridge (never user-visible): the WinterCG route
 * middleware from @openelement/router/http is the dialect-free public
 * contract, while the generated handlers keep their internal Hono dialect.
 * The per-request Hono context is bridged by request identity — one WeakMap
 * entry per dispatch, no cross-request leakage.
 */
export interface HonoBridge {
  /** Request → Hono context, populated by the entry's `app.all('*')` hook. */
  readonly contexts: WeakMap<object, ActionHonoContext>;
  /** Adapts a Hono-dialect handler onto the WinterCG `(request, route)` shape. */
  asFetchHandler(
    handler: (context: ActionHonoContext, route: unknown) => unknown,
  ): (request: Request, route: unknown, next: () => unknown) => unknown;
  /** Adapts a Hono-dialect middleware onto the WinterCG onion shape. */
  asFetchMiddleware(
    middleware: (context: ActionHonoContext, next: () => unknown) => unknown,
  ): (request: Request, route: unknown, next: () => unknown) => Promise<unknown>;
}

/** Creates the per-entry Hono bridge the generated handlers compose through. */
export function createHonoBridge(): HonoBridge {
  const contexts = new WeakMap<object, ActionHonoContext>();
  return {
    contexts,
    asFetchHandler: (handler) => (request, route, _next) => handler(contexts.get(request)!, route),
    asFetchMiddleware: (middleware) => async (request, _route, next) => {
      const c = contexts.get(request)!;
      let downstream;
      const own = await middleware(c, async () => {
        downstream = await next();
      });
      return own ?? downstream ?? c.res;
    },
  };
}
