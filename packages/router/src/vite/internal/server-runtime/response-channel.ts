/**
 * @openelement/router/server-runtime — response/header channel.
 *
 * The request-time runtime semantics of the loader/action response-header
 * channel, its streamed-document commitment gate, and
 * the CSP auto-nonce: header commitment, the late-mutation Proxy guard, the
 * Set-Cookie-preserving merge, protocol-header precedence, and nonce
 * creation/application.
 *
 * Generated entries import this module and call it; the codegen templates
 * keep call sites, never function bodies. Behavior is governed by this module
 * and pinned by the read-only oracles (request-time-parity, stream-manifest)
 * plus the unit tests beside it.
 *
 * Behavior contract:
 * - `mergeChannelHeaders` appends every channel entry into a copy of the
 *   response headers. `Headers.append` keeps multi-value `Set-Cookie`
 *   intact, and an empty channel returns the original `Response` untouched.
 * - Protocol headers always win when the response already carries them —
 *   the channel cannot override the protocol. A protocol header the response
 *   does NOT set is still appended from the channel.
 * - `createStreamHeaderChannel` gates `append`/`set`/`delete` after
 *   `commit()` with a warn-and-ignore diagnostic naming the route, header,
 *   and operation. Reads and `forEach` stay live; nothing ever throws.
 */

import type { ResponseHeaderChannel } from './types.ts';

/**
 * Headers the loader/action channel may never override once the response
 * already carries them: the framework protocol always wins on
 * conflict. Compared case-insensitively against the channel entry's name;
 * the channel may still introduce one of these when the response does not
 * set it itself.
 */
export const PROTOCOL_HEADERS: ReadonlySet<string> = new Set([
  'location',
  'content-type',
  'cache-control',
  'vary',
  'x-openelement-action',
]);

/**
 * Creates the per-request response-header channel for a streamed route:
 * the author-facing `Headers` proxy plus its commitment switch.
 *
 * The proxy guards the mutating members (`append`, `set`, `delete`) after
 * {@linkcode ResponseHeaderChannel.commit}: a late write from a held
 * `context.responseHeaders` reference is a no-op with a structured
 * diagnostic naming the route, header, and operation (the no-op rule; it
 * never throws and never reinterprets a late
 * `Location`/`Set-Cookie` as a protocol decision). Every other member —
 * reads, `forEach` included — behaves exactly like the wrapped `Headers`,
 * and `forEach` hands the callback the proxy itself so a callback-held
 * reference is gated the same way.
 *
 * `route` only feeds the diagnostic payload.
 */
export function createStreamHeaderChannel(route: string): ResponseHeaderChannel {
  const headers = new Headers();
  let committed = false;
  const channel = new Proxy(headers, {
    get(target, key) {
      if (key === 'append' || key === 'set' || key === 'delete') {
        const operation = key;
        return (name: string, value: string) => {
          if (committed) {
            console.warn('[openElement] late response header write', {
              route,
              header: String(name),
              operation,
            });
            return;
          }
          if (operation === 'delete') target.delete(name);
          else target[operation](name, value);
        };
      }
      if (key === 'forEach') {
        return (
          callback: (this: unknown, value: string, name: string, headers: Headers) => void,
          thisArg?: unknown,
        ) => {
          target.forEach((value, name) => callback.call(thisArg, value, name, channel));
        };
      }
      const member = Reflect.get(target, key, target) as unknown;
      return typeof member === 'function'
        ? (member as (this: Headers, ...args: unknown[]) => unknown).bind(target)
        : member;
    },
  });
  return {
    channel,
    commit: () => {
      committed = true;
    },
  };
}

/**
 * Merges the loader/action response-header channel into a response.
 * Channel entries are appended after the framework-set
 * headers, so multi-value `Set-Cookie` accumulates; a protocol header
 * ({@linkcode PROTOCOL_HEADERS}) the response already carries is skipped —
 * the channel cannot override the protocol. An empty channel returns the
 * original `Response` object untouched, so responses that never touch the
 * channel keep their identity (and their streaming body is not rebuilt).
 */
export function mergeChannelHeaders(response: Response, channel: Headers): Response {
  let needsMerge = false;
  channel.forEach(() => {
    needsMerge = true;
  });
  if (!needsMerge) return response;
  const merged = new Headers(response.headers);
  channel.forEach((value, key) => {
    if (PROTOCOL_HEADERS.has(key.toLowerCase()) && merged.has(key)) return;
    merged.append(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

/**
 * Creates one per-request CSP nonce: a UUID without its dashes (32 hex
 * characters). The CSP middleware embeds this value into the
 * `script-src 'nonce-…'` policy it sets on the response and exposes it to
 * the handlers as the `cspNonce` request-scope variable.
 */
export function createCspNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * Instantiates a generated CSP policy template for one request: replaces
 * the first `NONCE_PLACEHOLDER` marker with the request nonce. The template
 * is build-time data (route wiring produced it from the author's
 * `middleware.csp` policy); only this substitution is runtime semantics.
 */
export function applyCspNonce(policyTemplate: string, nonce: string): string {
  return policyTemplate.replace('NONCE_PLACEHOLDER', nonce);
}

/**
 * The env key the SSG prerender pass sets to `true` on every build-time
 * dispatch (ssg-render.ts passes `{ [SSG_PRERENDER_ENV_KEY]: true }` as the
 * request env). Since #1560 the prerender driver is our own static
 * generator, so the key is owned here — this module is the single source;
 * the build side imports the constant, and no second copy exists to drift.
 */
export const SSG_PRERENDER_ENV_KEY = 'OPEN_ELEMENT_SSG_CONTEXT';

/**
 * True when the dispatch is an SSG prerender pass. Static build output
 * cannot carry per-request state — the SSG nonce contract (nonce.ts: SSG
 * output carries none, static bytes cannot be per-request) — so the CSP
 * auto-nonce binds nothing on this pass: the handlers' `c.get('cspNonce')`
 * stays undefined and `wrapInDocument` serializes the client script tags
 * nonce-free while the SSG CSP injector writes the policy-only meta.
 */
export function isSsgPrerenderDispatch(env: unknown): boolean {
  return (
    typeof env === 'object' &&
    env !== null &&
    (env as Record<string, unknown>)[SSG_PRERENDER_ENV_KEY] === true
  );
}
