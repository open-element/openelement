/**
 * Lifecycle-intrinsic entry of @openelement/element (A16-LANE-M, M10-P1/P4).
 *
 * Exposes ONLY the compiler-erased intrinsics — `onConnect`, `onDispose`,
 * `onPropertyChange`, `ref` (`16b-REF`) and `provideContext` / `useContext`
 * (`16b-CTX`) — with no side effects and no path to the compiled executor.
 *
 * All of them are COMPILE-TIME INTRINSICS, not runtime functions: the
 * generated-element lane recognizes them by binding provenance (a named import
 * from this package, aliases followed), lowers their callbacks into the
 * retained instance factory of a compiled root setup (the `ref` handle is built
 * there too, so it survives mount, claim and reconnect), and ERASES the calls
 * from the emitted module. The emitted module therefore imports nothing from
 * this subpath — the runtime import exists only to satisfy the compiler's
 * provenance check on the AUTHORED source.
 *
 * Because the package root (`./src/index.ts`) is flagged in `sideEffects` — it
 * carries the hydration and Block install edges — an author module importing
 * these intrinsics from the root drags the generic executor into the browser
 * graph for a binding the compiler then deletes. Importing from this subpath
 * instead keeps the authored import tree-shakeable: this module re-exports
 * the fail-closed stand-ins from `internal/core/compile-lifecycle.ts` (whose
 * only dependency is the error façade), so it reaches neither `public-surface`
 * nor `OpenElement` nor any executor entry.
 *
 * Calling an intrinsic at runtime still fails closed with the same identity as
 * the root-entry spelling — the stand-ins are the SAME functions, re-exported,
 * not a second implementation.
 *
 * TWO SURFACE FACTS A GENERATED-LANE AUTHOR MUST KNOW (owner direction
 * 2026-11-20 — the surfaces are kept, not renamed; see ADR-0182's recorded
 * ambiguity):
 *
 * - `provideContext` means something DIFFERENT on each entry. The ROOT entry
 *   exports the class lane's HOST-SIDE primitive
 *   `provideContext(host, context, value): Unsubscribe` (a direct host write);
 *   this subpath exports the `16b-CTX` compiler INTRINSIC
 *   `provideContext(context, read): void` (a per-owner provider the compiler
 *   erases into the retained setup factory). Same exported name, different
 *   signatures and different mechanisms: TypeScript tells them apart by the
 *   import path, and the compiler's binding-provenance admission resolves the
 *   intrinsic spelling from this module's specifier.
 * - `onError` (`16b-EB`, the author-facing error boundary) is exported ONLY
 *   from the ROOT entry: this side-effect-free subpath deliberately does not
 *   re-export it, so a generated-lane module that registers an error boundary
 *   must import it from `@openelement/element`. That root import keeps the
 *   root's `sideEffects` flag — and with it the generic executor — in the
 *   client graph; that is a known, recorded P1 cost of choosing the error
 *   boundary, accepted for this slice rather than hidden by a second spelling
 *   here.
 */
export {
  onConnect,
  onDispose,
  onPropertyChange,
  provideContext,
  ref,
  useContext,
} from './internal/core/compile-lifecycle.ts';
