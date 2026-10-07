/**
 * Cross-environment CSSStyleSheet abstraction.
 *
 * In browsers this delegates to the native CSSStyleSheet API. In SSR runtimes
 * it falls back to a minimal in-memory implementation that exposes the subset
 * used by OpenElement and renderDsd().
 */

export interface StyleSheetRule {
  cssText: string;
}

/** Minimal stylesheet contract (replaceSync + cssRules) satisfied by native and shim sheets. */
export interface StyleSheetLike {
  replaceSync(text: string): void;
  readonly cssRules: StyleSheetRule[];
}
