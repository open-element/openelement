/**
 * No-regions entry of @openelement/element (#1548).
 *
 * Byte-identical public surface to the default entry (`index.ts`), minus the
 * compiled when/each Region builders: a bundle built from this entry carries
 * no Region construction, update, or claim-update machinery at all. For an
 * app whose compiled Part Programs carry no `when`/`each` Parts, that is
 * bundle weight that could never have run — the regions axis of the
 * runtime-shape specialization (#1548), mirroring the claim axis of
 * `./client-only` (#1416).
 *
 * Use it when — and only when — NO compiled element module in the page's
 * client graph lowers a conditional or list Region. The generated client
 * entry does exactly that: it selects this entry (over the default) only
 * when the island regions scan proves no admitted island module produces
 * Region Parts, and falls back to the full entry on any doubt. An app whose
 * programs DO use Regions MUST use the default entry (or `./client-only`).
 *
 * Consequence of omitting the install, and it is fail-closed: a program with
 * a `when`/`each` Part reaching this entry throws with the message naming the
 * entries that install the builders (`OE_RUNTIME_REGION_BUILDERS_MISSING`) —
 * a build-selection bug, never a silent mis-render.
 *
 * The claim executor stays installed: dropping Regions says nothing about
 * hydration, so this entry keeps the claim install exactly like the default.
 */
import './internal/compiled/runtime/claim-install.ts';

export * from './public-surface.ts';
