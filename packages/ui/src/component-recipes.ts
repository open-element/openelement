/** Shared helpers and visual recipes for the public UI primitives. */
import { createLogger, StyleSheet, type StyleSheetLike } from '@openelement/element';

/**
 * Shared component logger. Compiled modules may not carry runtime top-level
 * statements (OEC9008), so the logger instance lives in this plain module.
 */
export const log = createLogger('ui');

/** open-code-block tuning constants (compiled modules carry no top-level consts). */
export const CODE_BLOCK_CONSTANTS = {
  maxHighlightRetries: 120,
  copyFeedbackMs: 2000,
} as const;

// Instance-unique ids so multiple instances of one component on a page never
// collide on id/htmlFor/aria-*. Uniqueness holds within one realm only: SSG
// renders every page in a single process (the count accumulates across
// pages) and island hydration does not upgrade components in document order,
// so the server and client counters can assign different ids to the same
// instance. Pairs that must match across realms therefore have to be
// re-synced on the client — the compiled components assign their ids at
// activation (open-input, open-dropdown, open-tabs), so client and server
// each keep one consistent realm. References that stay inside a single
// activation need no repair.
let instanceCount = 0;

/** Return the next realm-unique instance id suffix. */
export function nextInstanceId(): number {
  return instanceCount++;
}

/**
 * Build a StyleSheetLike from a CSS string. Shared by the component-local
 * sheets so components do not repeat new StyleSheet()+replaceSync boilerplate.
 */
export function recipe(css: string): StyleSheetLike {
  const sheet = new StyleSheet();
  sheet.replaceSync(css);
  return sheet;
}

/**
 * Reflect the `disabled` attribute into ElementInternals custom states
 * (:state(disabled)/:state(enabled)). Shared by the form-associated
 * primitives (open-button, open-input).
 */
export function syncDisabledState(
  internals: ElementInternals | undefined,
  disabled: boolean,
): void {
  if (!internals?.states) return;
  if (disabled) {
    internals.states.delete('enabled');
    internals.states.add('disabled');
  } else {
    internals.states.delete('disabled');
    internals.states.add('enabled');
  }
}

/**
 * Compiled modules may not carry helper functions at top level (OEC9008), so
 * the form lookup shared by the form-associated primitives lives here.
 */
export function closestFormOf(element: Element): HTMLFormElement | null {
  return typeof element.closest === 'function' ? element.closest('form') : null;
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

/**
 * open-callout's type → icon map. Compiled modules may not carry runtime
 * top-level statements (OEC9008), so shared lookup tables live in plain .ts
 * modules like this one.
 */
export const CALLOUT_TYPE_ICONS: Record<string, string> = {
  info: 'ℹ️',
  warning: '⚠',
  danger: '✕',
  tip: '✓',
};

export const controlRecipe: StyleSheetLike = recipe(`
  .control {
    font: inherit;
    color: var(--ui-control-text);
    background: var(--ui-control-bg);
    border: var(--border-size-1) solid var(--ui-control-border);
    border-radius: var(--ui-control-radius);
    box-shadow: var(--ui-control-highlight);
    transition: border-color var(--motion-fast) var(--motion-standard),
      background var(--motion-fast) var(--motion-standard),
      box-shadow var(--motion-fast) var(--motion-standard),
      transform var(--motion-fast) var(--motion-standard);
  }
  .control:hover { border-color: var(--ui-control-border-hover); }
  .control:focus-visible {
    outline: var(--focus-size) solid var(--focus-ring);
    outline-offset: var(--focus-offset);
  }
  .control:disabled, .control[aria-disabled="true"] { opacity: .48; cursor: not-allowed; }
`);

export const surfaceRecipe: StyleSheetLike = recipe(`
  .surface {
    color: var(--text-primary);
    background: var(--surface-glass);
    border: var(--border-size-1) solid var(--surface-border);
    border-radius: var(--surface-radius);
    box-shadow: var(--surface-highlight), var(--surface-shadow);
  }
`);

export const overlayRecipe: StyleSheetLike = recipe(`
  .overlay {
    color: var(--text-primary);
    background: var(--surface-overlay);
    border: var(--border-size-1) solid var(--surface-border-strong);
    border-radius: var(--overlay-radius);
    box-shadow: var(--surface-highlight), var(--overlay-shadow);
  }
`);
