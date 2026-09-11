/**
 * SSR Polyfills for browser-only APIs.
 *
 * Polyfill 分层策略（ADR-0044）:
 * - Entry code body (this module): CSSStyleSheet — needs `import { StyleSheet } from @openelement/element`
 * - Output banner (build-ssg.ts): HTMLElement + customElements — no import, runs before module evaluation
 *
 * ADR-0044: SSR polyfill strategy — browser globals in Deno SSR runtime.
 */

/**
 * Generates the entry-code polyfill (CSSStyleSheet only).
 *
 * HTMLElement and customElements are in output.banner (build-ssg.ts)
 * because they must execute BEFORE any ESM import is evaluated.
 * CSSStyleSheet lives here because it needs `import { StyleSheet }`.
 */
export function generateSsrPolyfillBanner(): string {
  return `\
import { StyleSheet } from '@openelement/element';
if (typeof globalThis.CSSStyleSheet === 'undefined') {
  globalThis.CSSStyleSheet = class {
    replaceSync(_css) {}
    get cssRules() { return []; }
  };
}
`;
}

/**
 * customElements registry stub (ADR-0044). Must run before any route module
 * evaluates: route modules call customElements.define() at module top level.
 * At build time this ships as the Rollup output banner (build-ssg.ts); in
 * dev the virtual SSR entry imports it as its first module (plugin.ts), which
 * ESM evaluates before all other imports. Uses Map-backed define()/get();
 * renderDsdByName() looks up components via customElements.get(tagName).
 */
export function generateCustomElementsPolyfill(): string {
  return `\
if (typeof globalThis.customElements === 'undefined') {
  const __openCeRegistry = new Map();
  globalThis.customElements = {
    // #952: marks the SSR stub so define() call sites allow re-definition.
    // The stub persists on globalThis across vite dev module-runner
    // re-evaluations; without the marker, idempotent-define guards keep the
    // FIRST registered class forever and route edits never reach SSR output.
    // Contract: chartered as SSR_REGISTRY_STUB_MARKER in @openelement/element
    // internal/protocol/ssr-registry-markers.ts (#965) — keep the literal in
    // sync; this code ships as a generated string and cannot import it.
    __openElementSsrStub: true,
    define(name, ctor, _opts) { __openCeRegistry.set(name, ctor); },
    get(name) { return __openCeRegistry.get(name); },
    whenDefined(name) { return Promise.resolve(__openCeRegistry.get(name)); },
    upgrade(_root) {},
  };
}
`;
}
