/**
 * Base entry of @openelement/element (#1548).
 *
 * Byte-identical public surface to the default entry (`index.ts`), with
 * NEITHER optional runtime install: no compiled hydration executor (#1416's
 * `./client-only` axis) and no compiled when/each Block builders (#1548's
 * blocks axis). This is the `base` row of the per-feature floor table —
 * the smallest graph that can mount a compiled element whose programs carry
 * only fixed Parts, with fresh creation only.
 *
 * Use it when — and only when — every island the page can upgrade is
 * client-only AND no compiled element module in the page's client graph
 * lowers a conditional or list Block. The generated client entry makes that
 * two-predicate selection and falls back toward the fuller entries on any
 * doubt (hydration doubt → an entry with the hydration; blocks doubt → an entry
 * with the builders).
 *
 * Both omissions are fail-closed: existing DOM in a resolved root throws
 * (the hydration executor is missing), and a `when`/`each` Part throws
 * (`OE_RUNTIME_BLOCK_BUILDERS_MISSING`) — build-selection bugs report
 * themselves instead of half-rendering.
 */
export * from './public-surface.ts';
