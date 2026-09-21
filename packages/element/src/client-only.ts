/**
 * Client-only entry of @openelement/element (#1416).
 *
 * Byte-identical public surface to the default entry (`index.ts`), minus the
 * compiled claim executor: a bundle built from this entry carries no
 * claim-time validation, no recovery builders, and no structure walker at
 * all. For a page where no island can hydrate server DOM, that is ~9 KB of
 * bundle that could never have run — measured on the JFB keyed-table harness
 * (77,639 B full graph → 68,203 B from this entry).
 *
 * Use it when — and only when — every island the page can upgrade is
 * client-only (`ssr: false, dsd: false`, i.e. `hydrate: 'only'`). The
 * generated client entry does exactly that: it selects this entry only when
 * no island on the page declares `ssr` or `dsd` true, and falls back to the
 * full entry on any doubt. A page that hydrates server markup MUST use the
 * default entry.
 *
 * Consequence of omitting the install, and it is fail-closed: an element
 * connected through this entry that already has content in its resolved root
 * (a server-rendered tree, or light-DOM children standing in for the
 * template) has nothing to hydrate it, and throws with the message pointing
 * back at the full entry. A client-only island's host is empty in source —
 * the SSG client-only stub emits `<tag data-client-only="true"></tag>` — so
 * this is an authoring error, never a silent mis-render.
 */
export * from './public-surface.ts';
