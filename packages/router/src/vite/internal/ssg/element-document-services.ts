/**
 * The document-services surface the generated client entry imports STATICALLY
 * (generated-lane page floor).
 *
 * One module, one job: re-export the two document-level installers from
 * `@openelement/element/document-services` so the generated entry can install
 * them without the generic executor. It is the static sibling of the lazy
 * `element-services-*` wrappers above, and the two have deliberately opposite
 * shapes:
 *
 *   - `element-services-*` are DYNAMIC-import targets. They exist because a
 *     dynamic import's namespace object is opaque to tree-shaking, so
 *     `import('@openelement/element')` keeps the whole public surface in the
 *     client graph; re-exporting exactly the called bindings restores it.
 *   - THIS module is a STATIC import target, which is why it re-exports only
 *     what the entry calls and nothing else: a static import is tree-shaken
 *     per-binding, so the wrapper adds no surface of its own. The element-side
 *     module it re-exports from is `src/document-services.ts`, whose value
 *     edges are two leaf modules and NO executor entry (see that module's
 *     header; `packages/element/__tests__/document-services-subpath.test.ts`
 *     pins it).
 *
 * WHY A WRAPPER AT ALL, rather than a direct `@openelement/element/...` import
 * in the emitted entry: the generated entry is a virtual module in both hosts,
 * so the specifier it carries must be a stable virtual id (an absolute path
 * bakes the build machine's checkout into the emitted bytes; a relative path
 * would resolve against the Vite ROOT, not the router package). This module is
 * what {@linkcode ELEMENT_DOCUMENT_SERVICES_RUNTIME_SPECIFIER} resolves to, on
 * the same one-resolution-rule the scheduler/enhance specifiers use.
 *
 * THE CHUNK CAVEAT, per emission shape (B2 restated). The #1544 chunk rule
 * (`elementRuntimeChunkName`) groups EVERY module under the resolved
 * `@openelement/element` package root into `element-runtime-<hash>.js`, and
 * this wrapper's single import sits under that root — so a build whose entry
 * statically imports this module is a build whose entry statically reaches the
 * shared runtime chunk. The entry therefore emits this static import on
 * exactly ONE shape: `needsElementRuntime === false`
 * (`staticDocumentServices = !needsElementRuntime` in
 * `entry-client-codegen.ts`), i.e. a page whose client-activatable islands are
 * ALL generated-lane (M11-3). That shape IS the generated-lane page floor: the
 * entry carries client JS but no `__loadElementRuntime` and no lazy
 * `element-services-*` import, so nothing else would install the two services;
 * this static import and its two calls are the one installer there. The
 * reverse is what must not be written: on the needs-runtime shape (a
 * class-lane island) the entry deliberately does
 * NOT static-import this module — the lazy loader already fetches the chunk
 * and installs both services, so a static edge would duplicate the installer
 * for no service, and `requireEntryStaticGraphFreeOfRuntime` fails the build
 * when the entry statically reaches the runtime chunk on that shape (the guard
 * runs only when the entry needs the runtime — see
 * `build-client.ts`/`element-runtime-chunk.ts`).
 *
 * The B2 property is therefore stated over the emitted evidence per shape, not
 * as "the entry has no static edge to the runtime chunk": on the
 * all-generated-lane shape that edge is expected, and the property becomes "the
 * page floor carries no executor entry module, and a page with no
 * client-activatable island fetches no runtime". See
 * `www/__tests__/build-output.test.ts` (the direct property, its retired-proxy
 * comment and its negative controls) and
 * `docs/architecture/16b-migration-note.md` (the measured 324→328 KB raw /
 * 87→89 KB gzip static install cost, and why the old edge-absence assertion was
 * only a proxy for this one).
 */
export {
  ensureDeepFragmentNavigation,
  ensurePreHydrationClickCapture,
} from '@openelement/element/document-services';
