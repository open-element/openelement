/**
 * ssr-registry-markers.ts - SSR customElements registry marker contract (#965).
 *
 * The adapter-vite SSR/dev toolchain replaces `globalThis.customElements`
 * with a stub registry (ssr-polyfills.ts). That stub lives across vite
 * module-runner re-evaluations, so module-level `defineElement()` calls must
 * be allowed to re-define (overwrite the stale class) — otherwise route
 * edits never reach SSR output (#952). The marker property on the stub is
 * the signal that distinguishes it from a real browser registry.
 *
 * Keep the string value stable: it crosses the onion boundary — the marker
 * is written ONLY by adapter-vite (SSR polyfill + generated entry code) and
 * read by app (preact.ts). There is no
 * import edge between the writer and the readers by design (the writer is
 * generated code); this module is the single source for the name so a
 * rename cannot drift silently.
 */

/**
 * Marker property set to `true` on the adapter's SSR customElements stub.
 * Readers must treat the marked registry as re-definable.
 */
export const SSR_REGISTRY_STUB_MARKER = '__openElementSsrStub';

/**
 * Property on the stub holding the generated entry's registration-ownership
 * map (tag -> class it registered). Written and read only inside
 * adapter-vite's generated entry code (entry-orchestrator.ts): a route
 * module that self-registers its tag wins over the entry's registration,
 * and on dev re-evaluation a fresh self-registered class must still win
 * (#952/ADR-0128). Documented here because the name is part of the same
 * generated-registry contract, even though element/app never read it.
 */
export const ENTRY_REGISTRATION_OWNERS = '__openEntryDefined';

/**
 * Property on the SSR registry holding the TRUE original `define` method,
 * captured before the generated entry installs its idempotent wrapper. The
 * registry outlives vite dev SSR module re-evaluations, so without this the
 * second evaluation would capture the already-wrapped `define` as its
 * "original", and every forced re-registration would silently early-return
 * through the previous wrapper (#1339 lit dev feedback: edited lit page
 * classes never reached SSR output). Written and read only inside
 * adapter-vite's generated entry code (entry-orchestrator.ts).
 */
export const SSR_REGISTRY_ORIGINAL_DEFINE = '__openElementOrigDefine';
