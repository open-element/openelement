/**
 * Inner fetch middleware (ADR-0123 item 2, #858), composed inside `outer`.
 * Exercises the module contract:
 * - imports a LOCAL HELPER (../lib/middleware-marker.ts);
 * - imports a THIRD-PARTY package (hono's cookie parser) — impossible under
 *   the old Function.toString() inlining, which could not resolve bare
 *   package specifiers from the generated entry;
 * - closes over module-level constants;
 * - short-circuits (?mw-short) without calling next();
 * - throws on demand (?mw-boom) so the parity test can prove a throwing
 *   middleware is contained as a 500 by the existing handler-error path.
 */
import { parse as parseCookie } from 'hono/utils/cookie';
import type { Middleware } from '@openelement/element';
import { appendLayer } from '../lib/middleware-marker.ts';

const SHORT_CIRCUIT_PARAM = 'mw-short';
const BOOM_PARAM = 'mw-boom';
const PROOF_COOKIE = 'fixture-proof';
const PROOF_HEADER = 'x-fixture-cookie-proof';

const inner: Middleware = async (request, next) => {
  const url = new URL(request.url);
  if (url.searchParams.has(BOOM_PARAM)) {
    throw new Error('fixture middleware boom');
  }
  if (url.searchParams.has(SHORT_CIRCUIT_PARAM)) {
    return new Response('fixture short-circuit', { status: 418 });
  }
  const response = await next();
  appendLayer(response.headers, 'inner');
  // Third-party dependency proof: hono's cookie parser runs inside the chain.
  const proof = parseCookie(request.headers.get('cookie') ?? '')[PROOF_COOKIE];
  if (proof) response.headers.set(PROOF_HEADER, proof);
  return response;
};

export default inner;
