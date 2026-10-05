/**
 * #1546 — the production half of the element runtime's error-message seam.
 *
 * Element's `internal/protocol/errors.ts` declares the `OE_RUNTIME_MESSAGES`
 * global behind a `typeof` guard (default: full authored prose). This module
 * owns the production injection: the client build spreads
 * {@linkcode ELEMENT_RUNTIME_MESSAGES_DEFINE} into its Vite `define`, the
 * identifier is replaced textually, and the guarded prose folds to the stable
 * error codes. Key and value live here — not inline in build-client.ts —
 * because the consumer-form guard (element-error-messages.test.ts) drives a
 * real Vite build through this exact record; an inline literal would let the
 * build and the guard drift apart silently.
 */

/**
 * The `define` record injected into every production client build. The key
 * is the identifier element's seam declares; the value is the literal the
 * bundled runtime folds on. Dev never injects it — full prose is the dev
 * contract, locked on the element side (compiled-runtime/runtime-messages.test.ts).
 */
export const ELEMENT_RUNTIME_MESSAGES_DEFINE = { OE_RUNTIME_MESSAGES: 'false' } as const;
