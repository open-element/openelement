/**
 * @openelement/router/server-runtime — the typecheckable runtime modules
 * that generated entries import (ADR-0160 rule a).
 *
 * Generated Hono entries are route wiring: they select routes, bind
 * renderers, and forward requests. The request-time server semantics they
 * invoke — the response/header channel, its commitment gate, the CSP
 * auto-nonce, and (in later blocks) the action protocol, streaming pump,
 * claim, and scheduling — live in the modules re-exported here, so the
 * logic is visible to `deno check` and directly unit-testable instead of
 * hiding inside codegen template strings. The bundler inlines the import
 * into every generated entry (dev, SSG prerender, Nitro production).
 *
 * Authors never import this subpath directly; it is the generated entry's
 * runtime, kept on the package surface because generated code can only
 * resolve declared exports.
 */

export {
  applyCspNonce,
  createCspNonce,
  createStreamHeaderChannel,
  mergeChannelHeaders,
  PROTOCOL_HEADERS,
} from './response-channel.ts';
export type { ResponseHeaderChannel } from './types.ts';
