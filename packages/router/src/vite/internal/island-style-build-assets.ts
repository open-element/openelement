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
