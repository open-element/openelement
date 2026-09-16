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
 *     each other, so this file is now the only budget.
 *
 * Exceeding either value fails the official-Site build test; the build
 * manifest reports against the same numbers. Lowering these values is the
 * only way to tighten the SLO. A pageKB dimension exists in the framework's
 * manifestBudget contract but is advisory-only there (build-manifest warnings
 * that never fail), so it is not part of this enforced SLO.
 */
export const SITE_BUDGET = {
  islandKB: 100,
  totalJsKB: 300,
} as const;
