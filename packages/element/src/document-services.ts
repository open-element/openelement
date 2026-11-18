/**
 * Document-services entry of @openelement/element (generated-lane page floor).
 *
 * WHY THIS SURFACE EXISTS. The generated client entry installs two
 * DOCUMENT-LEVEL services before any island activates:
 *
 *   - {@linkcode ensureDeepFragmentNavigation} — fragment navigation across
 *     nested shadow roots (#1090). A direct load with a `#hash` must scroll
 *     into a DSD subtree that the browser's own fragment lookup cannot see, and
 *     a same-document anchor click must reach it too. Nothing else installs it.
 *   - {@linkcode ensurePreHydrationClickCapture} — the bounded pre-upgrade
 *     interaction capture a claiming island replays after activation.
 *
 * Historically both arrived as a side effect of the entry's lazy
 * `import()` of the `element-services-*` surface, because that module is the
 * element runtime. That works only while the page carries at least one
 * class-lane island: `clientEntryNeedsElementRuntime()` returns false for a
 * page whose islands are ALL generated-lane (M11-3), the entry then emits no
 * runtime loader at all (the P1 win — do not restore it), and the two services
 * silently stop being installed. Measured consequence: generated-lane pages
 * lost deep fragment navigation (`#start` never got `data-open-target`).
 *
 * So a page floor that must stay free of the generic executor needs a THIRD
 * narrow surface: this one. It is importable statically by the generated
 * entry, it re-exports the two installers and nothing else of the runtime, and
 * it deliberately has:
 *
 *   - NO `program-kernel`, `hydrate`, `fresh-dom`, `kernel`, `facade-host` or
 *     `runtime-program` edge (the six P1 executor entry modules), and
 *   - no module-scope side effect: the installers are CALLED by the entry, not
 *     run on import, so a bundler may drop this module from a graph that never
 *     calls them.
 *
 * The reachable value edges are exactly two leaf modules: `internal/core/
 * deep-fragment.ts` (zero imports) and `internal/compiled/runtime/
 * pre-upgrade-events.ts` (the protocol error catalogue, plus a TYPE-only
 * hydration-options import that erases). `pre-upgrade-events.ts` used to reach
 * the executor through `program-kernel.ts`'s `fail()` micro-factory for one
 * throw site; that call is now the same `raiseFrameworkError('render', code,
 * message)` at the façade, so the edge is gone and the thrown code, phase and
 * message are unchanged.
 *
 * `ensurePreHydrationClickCapture` is therefore present only because that
 * substitution holds. If a future change reintroduces an executor edge into
 * either leaf, the click-capture half must be dropped from this surface rather
 * than smuggling the executor into the page floor.
 *
 * The installers are the SAME function objects the root entry exports
 * (`packages/element/__tests__/document-services-subpath.test.ts` pins the
 * identity), so there is no second implementation whose behaviour could fork.
 */

export { deepGetElementById, ensureDeepFragmentNavigation } from './internal/core/deep-fragment.ts';
export { ensurePreHydrationClickCapture } from './internal/compiled/runtime/pre-upgrade-events.ts';
