/**
 * The narrow element-runtime surface the generated client entry loads lazily
 * (B2 / #1544).
 *
 * The native client entry no longer statically imports `@openelement/element`:
 * a page whose island manifest is empty must not download the runtime. The
 * entry reaches the runtime through a dynamic `import()` of THIS module
 * instead of the package entry, for one measured reason: a dynamic import's
 * namespace object is opaque to the bundler, so `import('@openelement/element')`
 * keeps the package's WHOLE public surface in the client graph — server-only
 * renderers included. Measured on the canonical starter probe build: the
 * shared `element-runtime-<hash>.js` chunk grows 86 KB raw / 27 KB gzip →
 * 124 KB raw / 39 KB gzip, i.e. +38 KB raw / +12 KB gzip on every page that
 * ever loads the runtime. Re-exporting the three bindings the entry actually
 * calls restores the static-import tree-shaking the entry used to get, while
 * the import stays dynamic: this module is reached only once an island (or
 * the enhanced-form layer) actually starts, so island-free pages still fetch
 * nothing.
 *
 * One module per element-entry axis (#1416 claim / #1548 blocks), because the
 * install side effects those entries carry are exactly what the generated
 * entry's specifier choice selects:
 *
 *   - {@linkcode ./element-services-full.ts} — `@openelement/element`
 *     (hydrate + blocks); the client build's #1548 blocks alias rewrites that
 *     bare specifier to `no-blocks` for the whole graph when the island
 *     blocks scan proved no Block Parts, so both blocks rows ride this one
 *     wrapper — a fourth wrapper would only restate what the alias does;
 *   - {@linkcode ./element-services-client-only.ts} — `./client-only`
 *     (blocks, no hydration executor);
 *   - {@linkcode ./element-services-base.ts} — `./base` (neither install).
 *
 * The all-client-only rows need their own wrappers because the alias is
 * anchored to the bare specifier and never rewrites those subpaths.
 *
 * `entry-client-codegen.ts` is the one selector; the wrappers are never
 * imported by the entry statically.
 */
export {
  ensureDeepFragmentNavigation,
  ensurePreHydrationClickCapture,
  OpenElement,
} from '@openelement/element';
