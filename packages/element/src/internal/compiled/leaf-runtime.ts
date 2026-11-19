/**
 * @openelement/element — the GENERATED-LEAF runtime entry (M11-3).
 *
 * The compiled-leaf modules the compiler emits (mount/claim/SSR factories)
 * import their primitives from here instead of from the
 * `internal/compiled/runtime` facade.
 *
 * WHY THIS ENTRY EXISTS. The facade re-exports `serializeToHtml`,
 * `createFreshDom`, `hydrateExistingDom` and their kernels. A generated island
 * chunk that imported the facade therefore pulled the whole generic executor
 * into its chunk — measured at M10-P1: `element-runtime-<hash>.js` was ONE
 * 64-module bundle holding both the generated-element shell and the six
 * executor endpoints (`facade-host`, `runtime-program`,
 * `runtime/{kernel,program-kernel,hydrate,fresh-dom}`), reachable from all
 * eight www islands. The generated lane never calls those endpoints: its shell
 * claims and mounts through `generated-element/shell.ts`, and its leaves only
 * need the primitives re-exported below.
 *
 * SO THIS FILE IS A CLOSED SET, NOT A CONVENIENCE INDEX. Every symbol here must
 * resolve to a leaf-safe module (`values`, `markers`, `claim-invariants`,
 * `recipe`, `instance-ledger`, `static-sibling-ranges`, `list-key`,
 * `bindings`, `observability`, `signal/*`). Importing from `program-kernel.ts`
 * — even just to re-export `removeNodes` — would put the executor back in the
 * graph, which is exactly the defect this entry removes. `values.ts`,
 * `markers.ts` and `claim-invariants.ts` are the ORIGIN modules for the
 * symbols the facade re-exports through `program-kernel.ts`; import from the
 * origin, never from the re-export.
 */

// Values, escaping and attribute reads (the origin module the facade re-exports
// through program-kernel.ts — importing the kernel would be the defect).
export {
  assertSafeUrlAttribute,
  attributeValueOf,
  displayValue,
  removeNodes,
} from './runtime/values.ts';
// The escaping pair lives in the shared core (one HTML-escape contract with
// the server serializer); `escapeText` is its text-node half.
export { escapeAttrValue } from '../core/html-escape.ts';
export { escapeText } from './escape-text.ts';

// Marker protocol: the wire the SSR and claim paths must agree on.
export {
  MARKERS,
  emitComment,
  entryKeyMarker,
  markerText,
  parseEntryKeyMarker,
  rangeMarker,
  slotAnchorMarker,
  textSlotMarker,
} from './runtime/markers.ts';

// Claim invariants: the static-seed and structural assertions.
export {
  assertEachAnchor,
  assertEachEndMarker,
  assertElementInHtmlNamespace,
  assertElementInNamespace,
  assertStaticAttributeSeed,
  assertTextSlotMarker,
  assertWhenAnchor,
  assertWhenEndMarker,
  entrySeedMismatch,
  isWhenEndMarker,
  leafClaimMismatch,
  leafRuntimeError,
  readEntryKeyMarker,
} from './runtime/claim-invariants.ts';

// Recipes and their projection ownership.
export { claimRecipe, createRecipe, insertRecipe } from './runtime/recipe.ts';

// The retained-child ledger the LC-2 depth-1 hooks use.
export {
  beginInstancePass,
  endInstancePass,
  releaseChildInstance,
  releaseUnderStructuralScope,
  retainChildInstance,
} from './runtime/instance-ledger.ts';

// Directory / range ownership.
export {
  claimStaticSiblingRange,
  openStaticSiblingDirectory,
} from './runtime/static-sibling-ranges.ts';

// List keys.
export { encodeListKey, tryEncodeListKey } from './runtime/list-key.ts';

// Signal writes and untracked evaluation.
export { bindSignalWrites } from './runtime/bindings.ts';
export { runUntracked } from './runtime/bindings.ts';
// `16b-EB`: the ONE update-phase isolation contract a generated element body
// uses for its refresh/each/event handlers. It is the executor's existing
// `guardUpdate` (report to the supplied sink, never rethrow) — re-exported from
// its origin module, not re-implemented, and NOT imported by any module that
// does not register an `onError` handler.
export { guardUpdate } from './runtime/bindings.ts';

// `16b-CTX` SERVER half: the per-render owner scope an emitted `__ssr` producer
// builds for one call. It is the SAME engine the client anchor uses
// (`runtime/context.ts` `CompiledContextService.forRender`), re-exported from its
// origin module and imported only by a module that renders a context consumer —
// a module without the intrinsic keeps its bytes and its module graph.
export { createRenderContextScope } from './runtime/context.ts';
