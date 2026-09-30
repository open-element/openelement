/**
 * Cross-package build/runtime policy constants — the numeric admission budgets
 * a streamed route, a server render, and the generated entries all enforce.
 *
 * This module is import-free and host-free by design (same base-of-graph
 * contract as stream-frame-policy.ts). Each value below names one policy
 * boundary that more than one executor checks: the router's build manifest
 * scan, the generated server entry, the generated browser bootstrap, and the
 * element-side deferred/SSR paths must reject the same inputs with the same
 * numbers, so the constants are declared once here and carried to every
 * consumer through the public export. A copy of one of these numbers inside a
 * generated string is a drift hazard, not a second source.
 *
 * The values are contracts, not tuning knobs: a released browser bootstrap
 * already enforces them against the server payload, so raising one is a
 * coordinated wire-format change, not a local edit.
 */

/**
 * Deferred fields (declared streamed properties) one stream route's manifest
 * may carry. The build scan, the server executor, and the browser seed
 * contract enforce the same bound.
 */
export const STREAM_MAX_FIELDS = 32;

/**
 * Part/Region owners one stream route's manifest may address in total across
 * all deferred fields.
 */
export const STREAM_MAX_OWNERS = 64;

/**
 * Typed properties one streamed seed may carry: the browser seed contract
 * rejects the WHOLE seed above this count, so an oversized component would
 * silently fail to hydrate instead of failing loud at the server.
 */
export const STREAM_MAX_SEED_PROPERTIES = 64;

/**
 * Serialized stream payload bound, as a string length in UTF-16 code units:
 * one seed attribute or one deferred frame's markup may not exceed it. The
 * server checks the JSON text and the rendered range before emitting; the
 * browser checks the attribute before parsing.
 */
export const STREAM_MAX_PAYLOAD_LENGTH = 256 * 1024;

/**
 * Nested element expansion depth bound for `renderDsd`: cyclic component
 * composition fails closed instead of recursing without end.
 */
export const MAX_COMPOSITION_DEPTH = 8;

/**
 * Request-body bound (bytes) the generated entry applies to action POST
 * routes; larger uploads belong on API routes with explicit limits.
 */
export const MAX_ACTION_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Deferred-field resolution budget (milliseconds) for one streamed response:
 * fields still pending when it expires are failed in place and the stream
 * ends with the shell and whatever resolved.
 */
export const STREAM_TIMEOUT_MS = 30_000;

/**
 * Idle-hydration scheduling fallback (milliseconds) when neither
 * `requestIdleCallback` nor `requestAnimationFrame` is available.
 */
export const IDLE_FALLBACK_TIMEOUT_MS = 50;
