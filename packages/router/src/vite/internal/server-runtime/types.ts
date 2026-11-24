/**
 * Shared types for the server-runtime modules generated entries import:
 * request-time server logic lives in typecheckable TS modules, never
 * accretes inside codegen template strings.
 *
 * These modules execute inside the generated server entry in every runtime —
 * the Vite dev server, the SSG prerender bundle, and the Nitro production
 * bundle (Node and Workers) — so they depend only on WinterCG globals
 * (Request/Response/Headers/crypto) and on no build-tool or Node API.
 */

/**
 * The per-request response-header channel: the mutable `Headers`
 * instance the loader and the action receive as `context.responseHeaders`,
 * plus the commitment switch the generated stream handler flips when the
 * response is committed.
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
   * The header-commitment point: the generated handler calls this
   * once, immediately before it exposes the response body. Later mutator
   * calls are ignored with a diagnostic. Idempotent.
   */
  commit(): void;
}

/**
 * A page route module namespace as the generated entry imports it
 * (`import * as $route`): the authoring descriptor on the default export and
 * — for compiled pages — the Part Program the class carries.
 */
export interface PageRouteModule {
  default?: {
    openElementPage?: {
      renderIntent?: { stream?: unknown };
      [key: string]: unknown;
    };
    // C11 (2026-11-24): the `__partProgram` field is GONE. The class lane's
    // compiled Part Program was deleted with the lane, and no runtime reader
    // remains (the page tag is a build fact, the stream guards are retired);
    // a module that still carries one is not admitted by any lane this
    // release ships.
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
