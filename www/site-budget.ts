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
 *     is the compiled layout (`open-layout`) at 81.6 KiB raw; islandKB
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
 *   - 2026-11-17 (owner decision): totalJsKB 344 → 376. The Alpha16
 *     generated-element migration moves islands off the class lane, and a
 *     generated island carries its own compiled recipe instead of sharing the
 *     class runtime's one chunk. Measured at the first two moved islands
 *     (`open-dragon-live-gaze`, `open-cinematic-scroll`): 353.5 KiB total, i.e.
 *     +8.8 KiB for two islands. 376 keeps ~6% headroom over that measurement
 *     and covers the remaining three www islands plus normal drift; it is a
 *     deliberate product decision, not a measurement artefact. Lowering this
 *     value again is the way to tighten the SLO. (P1's end state removes the
 *     generic executor from the shared chunk once every island has moved —
 *     re-measure and re-decide the budget at that point rather than carrying
 *     this number as permanent slack.)
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
  totalJsKB: 376,
} as const;

/**
 * Report-only dimensions (T10 R7, G3-approved): the numbers the enforced SLO
 * above never covered — page HTML, first-view CSS, the font artifact and the
 * home page's off-origin hero media. They are BASELINES measured on the
 * alpha.15 candidate build (2026-10-18, lane/t10-audit), not aspirations:
 * `www/tools/check-site-budget.ts` prints actual-vs-baseline and exits 0
 * unless `--strict` is passed, so this phase records the shape of the site
 * without turning a fresh measurement into a red gate.
 *
 * Why report-only first: these are whole-page figures measured on one machine.
 * The repository already documents the cross-runner byte spread (the tolerance
 * notes in www/tools/check-doc-figures.ts), so widening the SLO needs a
 * tolerance policy and a stable CI baseline — a deliberate follow-up, not a
 * detail to guess at now.
 *
 * `mediaKB` is deliberately the largest number in this file: the home page's
 * dragon frames and idle video are fetched from assets.openelement.org and are
 * a research target (HERO constraint: study only, never gated). It is listed so
 * the figure is visible next to the others, not so a gate can fail on it.
 */
export const SITE_BUDGET_REPORT_ONLY = {
  /** Median gzipped bytes of a page's HTML (the generated mega-page excluded). */
  htmlMedianKB: 15,
  /** Largest gzipped HTML page — the generated /reference index. */
  htmlMaxKB: 230,
  /** Gzipped bytes of every stylesheet one page links (both big sheets). */
  cssKB: 43,
  /** Every font file the artifact ships, raw bytes (woff2 is already compressed). */
  fontKB: 377,
  /**
   * Media bytes INSIDE the artifact that a built page references. Deliberately
   * 0: the site ships no same-origin images beyond SVG icons, and the home
   * page's ~10 MB of dragon media lives on assets.openelement.org (HEAD-measured
   * 59 frames approx 5.6 MB + a 5,061,261 B idle mp4, recorded in the T10
   * register §2.7). A number copied from that origin into this file would be a
   * stale claim the build cannot verify, so the off-origin figure stays in the
   * register where its measurement command lives.
   */
  mediaKB: 0,
} as const;
