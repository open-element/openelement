/**
 * One slot, no imports — the pre-upgrade-replay-hook pattern.
 *
 * The open:mdx plugin (plugin-mdx.ts) PUBLISHES the lowering entry here when a
 * build composes it; the declared-tag scan (internal/ssg/
 * declared-element-tags.ts) CONSUMES the slot for its `.mdx` rows. Neither
 * side may import the other's graph:
 *
 * - a STATIC scan → plugin-mdx edge would put plugin-mdx's in-package dynamic
 *   `import('./plugin-mdx-lower.ts')` inside the bundled ./vite entry graph,
 *   and rolldown materializes its chunk-loading runtime into the packed
 *   artifact (`src/_virtual/_rolldown/runtime.js`, with a `node:*` import the
 *   artifact check fails closed on — measured 2026-11-24);
 * - a STATIC scan → plugin-mdx-lower edge would make every consumer resolve
 *   the optional `marked` peer at config load (measured the same night, in
 *   gate:packed's starter dev cell).
 *
 * The slot's functions ARE the registry's (same shape as the runtime's
 * pre-upgrade replay hook): a build that never composes the open:mdx plugin
 * leaves the slot empty, and the scan reports its `.mdx` rows with a note
 * instead of lowering them — an honest no-op, never a silent drop.
 */

/** Lower one `.mdx` route source to its compiled page module source. */
export type MdxScanLower = (
  source: string,
  file: string,
  routesDir: string | undefined,
) => Promise<string>;

let slot: MdxScanLower | undefined;

/** Publish the lowering entry. One publisher (the open:mdx plugin factory). */
export function publishMdxScanLowering(lower: MdxScanLower): void {
  slot ??= lower;
}

/** The published lowering entry, or undefined when no open:mdx plugin ran. */
export function mdxScanLowering(): MdxScanLower | undefined {
  return slot;
}
