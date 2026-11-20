/**
 * The build's per-island stylesheet URLs (M09-2e / #1803), keyed by the island
 * tag: Phase 2 joins every admitted generated-shadow island's declared sheets to
 * the emitted client asset and Phase 3 hands the map to the generated SSR entry
 * through the existing style-links channel.
 *
 * Kept off `OpenElementBuildContext` on purpose: the map is a build-internal
 * hand-off, not part of the public `@openelement/router/vite` context shape.
 * One WeakMap keyed by the context object keeps the two phases coupled without
 * widening that public type.
 */

const assetsByContext = new WeakMap<object, Map<string, string[]>>();

/** Record Phase 2's per-island URL map for this build. */
export function setClientIslandStyleAssets(context: object, assets: Map<string, string[]>): void {
  assetsByContext.set(context, assets);
}

/** The map Phase 2 recorded, or an empty map (no styled shadow island). */
export function clientIslandStyleAssets(context: object): ReadonlyMap<string, string[]> {
  return assetsByContext.get(context) ?? new Map();
}

/**
 * The generated shadow islands whose component stylesheet the DSD must also
 * link (deletion prerequisite P-1b, 2026-11-21).
 *
 * A generated shadow island's `styles` declaration names AUTHORED `.css` files,
 * and those ride the per-island asset map above. Its statically admitted class
 * tokens are a DIFFERENT sheet: the build's one shared COMPONENT stylesheet,
 * compiled from every shadow candidate the discovery pass registered. The class
 * lane merges both by construction (an element's `static styles` and its
 * `__oeUtilityClasses` fact both point at that one sheet); the generated lane
 * has no class static, so the build has to remember which tags need the shared
 * sheet appended to their DSD link list.
 *
 * Same lifetime and same reason as the map above: a build-internal hand-off, so
 * a WeakMap keyed by the context object rather than a wider public type.
 */
const utilityTagsByContext = new WeakMap<object, ReadonlySet<string>>();

/** Record which generated shadow tags need the shared component sheet. */
export function setClientIslandUtilityTags(context: object, tags: ReadonlySet<string>): void {
  utilityTagsByContext.set(context, tags);
}

/** The tags Phase 2 recorded, or an empty set (none needed the shared sheet). */
export function clientIslandUtilityTags(context: object): ReadonlySet<string> {
  return utilityTagsByContext.get(context) ?? new Set();
}
