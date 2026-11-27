/** Request-time response-header merge and CSP nonce helpers. */

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
