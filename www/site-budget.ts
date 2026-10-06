/**
 * The one official-Site performance SLO.
 *
 * These are uncompressed client-JS budgets in KiB. They are deliberately a
 * single explicit product decision shared by the Vite configuration (manifest
 * budget enforcement), the official-Site build tests, and maintainer docs —
 * not the Router framework defaults. Rationale for the values (measured on the
 * 2026-10-06 build with the island style-asset protocol live, #1553):
 *
 *   - Island chunks no longer carry stylesheet bytes: component CSS emits as
 *     real `.css` assets under `client/assets/` and is adopted via
 *     `adoptedStyleSheets` (ADR-0164), so the old "island size dominated by
 *     inlined critical CSS" accounting is gone. The largest `island-*` chunk
 *     is the compiled app shell (`open-layout`) at 81.6 KiB raw; islandKB
 *     moved 102 → 84, keeping the same ~2.5 KiB headroom over the largest
 *     chunk that the 99.5 → 102 raising precedent established. (The ~99 KiB
 *     combobox runtime is not an `island-*` chunk, so islandKB does not apply
 *     to it; totalJsKB still counts it.)
 *   - The total counts all client JS (~327.5 KiB over 22 files), including
 *     the search island's interaction runtime — the Zag combobox state
 *     machine + Floating UI positioning (~98.5 KiB uncompressed, a dynamic
 *     chunk fetched on the first search open, so no byte of it reaches first
 *     paint). totalJsKB moved 400 → 344 (~5% headroom) now that CSS bytes
 *     left the JS total; the earlier raise existed to admit that runtime.
 *     The self-hosted Prism runtime (~40 KiB) that an older paragraph counted
 *     was retired with the build-time highlighter (#1552) — code highlighting
 *     is static page HTML with zero client-JS cost.
 *
 * Exceeding either value fails the official-Site build test; the build
 * manifest reports against the same numbers. Lowering these values is the
 * only way to tighten the SLO. A pageKB dimension exists in the framework's
 * manifestBudget contract but is advisory-only there (build-manifest warnings
 * that never fail), so it is not part of this enforced SLO.
 */
export const SITE_BUDGET = {
  islandKB: 84,
  totalJsKB: 344,
} as const;
