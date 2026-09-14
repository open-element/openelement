/**
 * registry-markers.ts — SSR customElements registry marker contract (#965).
 *
 * The Router SSR/dev toolchain replaces `globalThis.customElements` with a
 * stub registry (ssg/ssr-polyfills.ts). That stub lives across vite
 * module-runner re-evaluations, so generated entry code must be allowed to
 * re-define (overwrite the stale class) — otherwise route edits never reach
 * SSR output (#952). These property names are the wire contract between the
 * hand-written writers and the generated entry code.
 *
 * Ordinary TypeScript writers import the constants. Generated entry code is
 * emitted as strings; its generator (ssg/entry-orchestrator.ts) imports this
 * module and injects the values, so no second literal can drift. The values
 * themselves are pinned by registry-marker-drift.test.ts because they cross
 * process/module-evaluation boundaries that cannot share an import edge.
 */

/**
 * Marker property set to `true` on the SSR customElements stub. Readers must
 * treat the marked registry as re-definable.
 */
export const SSR_REGISTRY_STUB_MARKER = '__openElementSsrStub';

/**
 * Property on the stub holding the generated entry's registration-ownership
 * map (tag -> class it registered): a route module that self-registers its
 * tag wins over the entry's registration, and on dev re-evaluation a fresh
 * self-registered class must still win (#952/ADR-0128).
 */
export const ENTRY_REGISTRATION_OWNERS = '__openEntryDefined';

/**
 * Property on the SSR registry holding the TRUE original `define` method,
 * captured before the generated entry installs its idempotent wrapper. The
 * registry outlives vite dev SSR module re-evaluations, so without this the
 * second evaluation would capture the already-wrapped `define` as its
 * "original" and every forced re-registration would silently early-return
 * through the previous wrapper (#1339 lit dev feedback).
 */
export const SSR_REGISTRY_ORIGINAL_DEFINE = '__openElementOrigDefine';
