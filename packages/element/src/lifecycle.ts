/**
 * Lifecycle-intrinsic entry of @openelement/element (A16-LANE-M, M10-P1/P4).
 *
 * Exposes ONLY the compiler-erased lifecycle intrinsics — `onConnect`,
 * `onDispose` and `onPropertyChange` — with no side effects and no path to the
 * compiled executor.
 *
 * Those three are COMPILE-TIME INTRINSICS, not runtime functions: the
 * generated-element lane recognizes them by binding provenance (a named import
 * from this package, aliases followed), lowers their callbacks into the
 * retained instance factory of a compiled root setup, and ERASES the calls
 * from the emitted module. The emitted module therefore imports nothing from
 * this subpath — the runtime import exists only to satisfy the compiler's
 * provenance check on the AUTHORED source.
 *
 * Because the package root (`./src/index.ts`) is flagged in `sideEffects` — it
 * carries the hydration and Block install edges — an author module importing
 * these intrinsics from the root drags the generic executor into the browser
 * graph for a binding the compiler then deletes. Importing from this subpath
 * instead keeps the authored import tree-shakeable: this module re-exports
 * three fail-closed stand-ins from `internal/core/compile-lifecycle.ts` (whose
 * only dependency is the error façade), so it reaches neither `public-surface`
 * nor `OpenElement` nor any executor entry.
 *
 * Calling an intrinsic at runtime still fails closed with the same identity as
 * the root-entry spelling — the stand-ins are the SAME functions, re-exported,
 * not a second implementation.
 */
export { onConnect, onDispose, onPropertyChange } from './internal/core/compile-lifecycle.ts';
