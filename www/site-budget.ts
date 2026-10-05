/**
 * The one official-Site performance SLO.
 *
 * These are uncompressed client-JS budgets in KiB. They are deliberately a
 * single explicit product decision shared by the Vite configuration (manifest
 * budget enforcement), the official-Site build tests, and maintainer docs —
 * not the Router framework defaults. Rationale for the values (measured on the
 * 1.0.0-alpha.1 candidate):
 *
 *   - The two largest chunks are the official product's own compiled shell
 *     (`open-layout`, ~95 KiB) and the cinematic home surface
 *     (`open-cinematic-scroll`, ~76 KiB). Their size is dominated by the
 *     compiled Part Program runtime and inlined critical CSS; cutting below
 *     the framework default of 50 KiB would require a framework-level CSS
 *     extraction / runtime-sharing change, which is out of scope for this
 *     remediation.
 *   - The total includes self-hosted Prism (~40 KiB) and all islands (~285
 *     KiB); the prior 200 KiB default and 600/700 KiB soft values contradicted
 *     each other, so this file is now the only budget. C4 (#1507) raised it
 *     to 400 KiB to admit the search island's interaction runtime — the
 *     Zag combobox state machine + Floating UI positioning (~98 KiB
 *     uncompressed, a dynamic chunk fetched on the first search open, so no
 *     byte of it reaches first paint).
 *   - islandKB moved 100 → 102 in the same lane: the app-shell chunk carried
 *     the search dialog's always-shipped shell (shortcut handler, modal focus
 *     trap, dismissal, and the combobox graph's static markup) and measured
 *     99.5 KiB against the old value BEFORE C4 — 0.5 KiB of headroom. The
 *     always-shipped search shell added ~1 KiB; the widget runtime itself
 *     stays out of the island payload (the dynamic chunk above).
 *   - Re-measured 2026-10-06 after the alpha10 train (#1543 minified island
 *     CSS, #1544 the element runtime on its own shared chunk): the largest
 *     `island-*` chunk is open-layout at ~96.5 KiB and total client JS is
 *     ~346 KiB — both caps keep their headroom, values unchanged. (The
 *     ~99 KiB combobox runtime is not an `island-*` chunk, so islandKB does
 *     not apply to it; totalJsKB still counts it.)
 *
 * Exceeding either value fails the official-Site build test; the build
 * manifest reports against the same numbers. Lowering these values is the
 * only way to tighten the SLO. A pageKB dimension exists in the framework's
 * manifestBudget contract but is advisory-only there (build-manifest warnings
 * that never fail), so it is not part of this enforced SLO.
 */
export const SITE_BUDGET = {
  islandKB: 102,
  totalJsKB: 400,
} as const;
