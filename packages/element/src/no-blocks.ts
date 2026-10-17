/**
 * No-blocks entry of @openelement/element (#1548).
 *
 * Byte-identical public surface to the default entry (`index.ts`), minus the
 * compiled when/each Block builders: a bundle built from this entry carries
 * no Block construction, update, or hydration-update machinery at all. For an
 * app whose compiled Part Programs carry no `when`/`each` Parts, that is
 * bundle weight that could never have run — the blocks axis of the
 * runtime-shape specialization (#1548), mirroring the hydration axis of
 * `./client-only` (#1416).
 *
 * Use it when — and only when — NO compiled element module in the page's
 * client graph lowers a conditional or list Block. The generated client
 * entry does exactly that: it selects this entry (over the default) only
 * when the island blocks scan proves no admitted island module produces
 * Block Parts, and falls back to the full entry on any doubt. An app whose
 * programs DO use Blocks MUST use the default entry (or `./client-only`).
 *
 * Consequence of omitting the install, and it is fail-closed: a program with
 * a `when`/`each` Part reaching this entry throws with the message naming the
 * entries that install the builders (`OE_RUNTIME_BLOCK_BUILDERS_MISSING`) —
 * a build-selection bug, never a silent mis-render.
 *
 * The hydration executor stays installed: dropping Blocks says nothing about
 * hydration, so this entry keeps the claim install exactly like the default.
 */
import './internal/compiled/runtime/hydrate-install.ts';

export * from './public-surface.ts';
