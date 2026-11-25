/** Shared helpers and visual recipes for the public UI primitives. */
import { createLogger, type Logger } from '@openelement/element/logger';

/**
 * Shared component logger. Compiled modules may not carry runtime top-level
 * statements (OEC9008), so the logger instance lives in this plain module.
 */
export const log: Logger = createLogger('ui');

/** open-code-block tuning constants (compiled modules carry no top-level consts). */
export const CODE_BLOCK_CONSTANTS = {
  copyFeedbackMs: 2000,
} as const;

// Instance-unique ids so multiple instances of one component on a page never
// collide on id/htmlFor/aria-*. Uniqueness holds within one realm only: SSG
// renders every page in a single process (the count accumulates across
// pages) and island hydration does not upgrade components in document order,
// so the server and client counters can assign different ids to the same
// instance. Pairs that must match across realms therefore have to be
// re-synced on the client — the compiled components assign their ids at
// activation (open-input, open-dropdown), so client and server
// each keep one consistent realm. References that stay inside a single
// activation need no repair.
let instanceCount = 0;

/** Return the next realm-unique instance id suffix. */
export function nextInstanceId(): number {
  return instanceCount++;
}

/**
 * Deepest focused element, descending through open shadow roots (OEC9008:
 * shared helpers live in plain .ts modules, not compiled component modules).
 */
export function deepActiveElement(): HTMLElement | null {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return (active as HTMLElement | null) ?? null;
}
