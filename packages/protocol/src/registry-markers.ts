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
 * self-registered class must still win (#952).
 */
export const ENTRY_REGISTRATION_OWNERS = '__openEntryDefined';

/**
 * Property on the SSR registry holding the TRUE original `define` method,
 * captured before the generated entry installs its idempotent wrapper. The
 * registry outlives vite dev SSR module re-evaluations, so without this the
 * second evaluation would capture the already-wrapped `define` as its
 * "original" and every forced re-registration would silently early-return
 * through the previous wrapper (#952 dev re-evaluation).
 */
export const SSR_REGISTRY_ORIGINAL_DEFINE = '__openElementOrigDefine';

/**
 * Property on the SSR registry holding the generated-entry host pairing table
 * (tag -> the compiler-emitted generated host renderer): written atomically by
 * the registry guard together with the class registration (M11) and read by
 * `@openelement/element`'s server serializer nested-composition seam.
 *
 * It lives on the registry (not on the class and not on the module namespace)
 * for the same reasons the ownership markers do: one writer (the generated
 * entry's guard), one reader (Element's serializer), no class static / suffix
 * scan / runtime module-shape read, and the pairing survives vite dev SSR
 * module re-evaluations together with the class it belongs to.
 */
export const SSR_REGISTRY_GENERATED_HOSTS = '__openElementGeneratedHosts';
