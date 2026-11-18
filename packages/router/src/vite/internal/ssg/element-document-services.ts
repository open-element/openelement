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
 * THE CHUNK CAVEAT. `elementRuntimeChunkName` groups EVERY module under the
 * resolved `@openelement/element` package root into `element-runtime-<hash>.js`
 * (#1544), and this wrapper's single import sits under that root — so a build
 * whose entry statically imports this module is a build whose entry statically
 * reaches the shared runtime chunk. `requireEntryStaticGraphFreeOfRuntime`
 * fails such a build by design. The static import is therefore emitted ONLY
 * when the entry would already fetch that chunk (a class-lane island or the
 * enhanced-form layer): on precisely those pages the services were already
 * installed by the lazy loader, so the static call is the single installer and
 * the chunk is not new bytes. On a generated-lane-only page the entry takes
 * the lazy branch instead (it must — see the caller), and the deep-fragment
 * half is installed from the executor-free subpath.
 */
export {
  ensureDeepFragmentNavigation,
  ensurePreHydrationClickCapture,
} from '@openelement/element/document-services';
