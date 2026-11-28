/** Build and runtime bounds for composition, actions, and idle delivery. */

/**
 * Nested element expansion depth bound for `renderToString`: cyclic component
 * composition fails closed instead of recursing without end.
 */
export const MAX_COMPOSITION_DEPTH = 8;

/**
 * Request-body bound (bytes) the generated entry applies to action POST
 * routes; larger uploads belong on API routes with explicit limits.
 */
export const MAX_ACTION_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Idle-hydration scheduling fallback (milliseconds) when neither
 * `requestIdleCallback` nor `requestAnimationFrame` is available.
 */
export const IDLE_FALLBACK_TIMEOUT_MS = 50;
