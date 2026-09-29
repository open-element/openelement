/**
 * Shared types for the server-runtime modules generated entries import
 * (ADR-0160 rule a: request-time server logic lives in typecheckable TS
 * modules, never accretes inside codegen template strings).
 *
 * These modules execute inside the generated Hono entry in every runtime —
 * the Vite dev server, the SSG prerender bundle, and the Nitro production
 * bundle (Node and Workers) — so they depend only on WinterCG globals
 * (Request/Response/Headers/crypto) and on no build-tool or Node API.
 */

/**
 * The per-request response-header channel (ADR-0129): the mutable `Headers`
 * instance the loader and the action receive as `context.responseHeaders`,
 * plus the commitment switch the generated stream handler flips when the
 * response is committed (ADR-0158).
 */
export interface ResponseHeaderChannel {
  /**
   * Author-facing view of the channel. Before commitment every `Headers`
   * mutator passes through unchanged; after {@linkcode ResponseHeaderChannel.commit}
   * the mutating methods are gated — a late `append`/`set`/`delete` becomes a
   * warn-and-ignore diagnostic naming the route, header, and operation. It
   * never throws and never mutates the committed response.
   */
  readonly channel: Headers;
  /**
   * The header-commitment point (ADR-0158): the generated handler calls this
   * once, immediately before it exposes the response body. Later mutator
   * calls are ignored with a diagnostic. Idempotent.
   */
  commit(): void;
}
