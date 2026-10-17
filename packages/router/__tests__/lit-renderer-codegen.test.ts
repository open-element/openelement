/**
 * @openelement/router - Lit renderer codegen fork tests (Beta.2.2, #1339)
 *
 * The renderer option is explicit config, never inferred: 'lit' forks page tag
 * resolution (openElementPageTag), page SSR (renderLitPageToHtml) and the
 * client entry, while loader/action/protocol code and the native default stay
 * byte-identical. (Beta.2.2 review: the unconsumed page-data JSON channel was
 * removed; its absence is pinned below.)
 */

import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
import { generateClientEntry } from '../src/vite/internal/ssg/entry-client-codegen.ts';
import { defineLitPage } from '../src/lit.ts';
import { analyzeModuleSemantics } from '@openelement/compiler';
import { ROUTER_MODULE_VOCABULARY } from '@openelement/protocol/module-vocabulary';
import type { RouteEntry } from '@openelement/protocol/framework';

const litRoutes: RouteEntry[] = [
  { path: '/notes', filePath: 'notes.ts', type: 'page', varName: 'pageNotes', definePage: true },
];

test('lit renderer: descriptor forks imports and rejects a compiled layout', () => {
  const desc = buildEntryDescriptor(litRoutes, { renderer: 'lit', layout: false });
  expect(desc.renderer).toEqual('lit');
  // The lit server entry never imports the runtime barrel at all; the pure
  // HTML utilities arrive through the kernel-free @openelement/element/html
  // leaf (proven at module-graph level in lit-graph-boundary.test.ts).
  const barrelImport = desc.imports.find((imp) => imp.from === '@openelement/element');
  expect(barrelImport).toEqual(undefined);
  const htmlImport = desc.imports.find((imp) => imp.from === '@openelement/element/html');
  expect(htmlImport?.names).toEqual([
    'createDocumentStyleResources',
    'trustedHtml',
    'escapeHtml',
    'wrapInDocument',
  ]);
  const litImport = desc.imports.find((imp) => imp.from === '@openelement/router/lit-ssr');
  expect(litImport?.names).toEqual(['renderLitPageToHtml']);

  assertThrowsIncludes(
    () =>
      buildEntryDescriptor(litRoutes, {
        renderer: 'lit',
        layout: { tagName: 'app-layout', import: './shell.ts' },
      }),
    Error,
    "renderer: 'lit' does not support a compiled layout",
  );
});

test('lit renderer: native descriptor shape is unchanged (renderer absent)', () => {
  const desc = buildEntryDescriptor(litRoutes);
  expect('renderer' in desc).toEqual(false);
  const elementImport = desc.imports.find((imp) => imp.from === '@openelement/element');
  expect(elementImport?.names.includes('renderToString')).toEqual(true);
});

test('lit renderer: entry forks tag resolution and page render (no page-data side channel)', () => {
  const litEntry = renderEntry(
    buildEntryDescriptor(litRoutes, { renderer: 'lit', layout: false, ssg: true }),
  );
  // First import installs the lit DOM shim before any route module evaluates.
  expect(litEntry.startsWith("import '@lit-labs/ssr/lib/install-global-dom-shim.js';")).toEqual(
    true,
  );
  // The lit forks bind through the typed runtime seam (ADR-0160 rule a): the
  // lit page-tag resolver is an import and the lit page renderer is bound
  // inside the generated-app factory via the pageRuntime config (#1470
  // block e); the call sites stay renderer-neutral.
  expect(litEntry).toContain(
    "import { resolveLitPageTag as __resolvePageTag } from '@openelement/router/server-runtime'",
  );
  expect(litEntry).toContain(
    "import { renderLitPageToHtml as __renderLitPageToHtml } from '@openelement/router/lit-ssr'",
  );
  expect(litEntry).toContain("mode: 'lit',");
  expect(litEntry).toContain('renderLitPageToHtml: __renderLitPageToHtml,');
  // Beta.2.2 review: the embedded page-data JSON channel had no consumer —
  // it is removed and its absence is pinned on both renderers.
  expect(litEntry.includes('__litPageDataScript')).toEqual(false);
  expect(litEntry.includes('data-open-element-page-data')).toEqual(false);
  // The compiled serializer / Part Program kernel is never referenced — the
  // typed renderer modules carry no Element edge of their own.
  expect(litEntry.includes('renderToString')).toEqual(false);
  expect(litEntry.includes('__partProgram')).toEqual(false);

  // Loader/action protocol stays: the lit entry keeps the shared machinery.
  expect(litEntry).toContain('__runActionProtocol');

  const nativeEntry = renderEntry(buildEntryDescriptor(litRoutes, { ssg: true }));
  expect(nativeEntry).toContain('renderToString');
  expect(nativeEntry.includes('__litPageDataScript')).toEqual(false);
});

test('lit renderer: client entry installs hydrate-support first and stays element-free', () => {
  const client = generateClientEntry(
    [{ tagName: 'note-counter', modulePath: '/app/islands/note-counter.ts', strategy: 'load' }],
    { enhancedForms: true, renderer: 'lit' },
  );
  const importLines = client.split('\n').filter((line) => line.startsWith('import '));
  expect(importLines[0]).toEqual("import '@lit-labs/ssr-client/lit-element-hydrate-support.js';");
  expect(importLines.some((line) => line.includes('@openelement/element'))).toEqual(false);
  expect(client).toContain('createEnhanceClient');
  expect(client).toContain('__liftDeferHydration');
  // The header comment names the native claim helpers to document their
  // absence; assert the CALLS are gone, not the words.
  expect(client.includes('ensurePreHydrationClickCapture();')).toEqual(false);
  expect(client.includes('ensurePreHydrationClickCapture(document, __tags);')).toEqual(false);
  expect(client.includes('ensureDeepFragmentNavigation();')).toEqual(false);

  const nativeClient = generateClientEntry(
    [{ tagName: 'note-counter', modulePath: '/app/islands/note-counter.ts', strategy: 'load' }],
    { enhancedForms: true },
  );
  // Native (B2/#1544): the entry carries NO static import from the element
  // package at all — not even the logger leaf, which lives under the same
  // package root as the shared runtime chunk and would therefore put the
  // whole `element-runtime-<hash>.js` back into a zero-island page's static
  // graph. The runtime is reached only by the lazy surface module's dynamic
  // import.
  const nativeImportLines = nativeClient.split('\n').filter((line) => line.startsWith('import '));
  expect(nativeImportLines.some((line) => line.includes('@openelement/element'))).toEqual(false);
  expect(nativeClient).toContain("import('");
  expect(nativeClient).toContain('element-services');
  expect(nativeClient.includes('lit-element-hydrate-support')).toEqual(false);
});

test('lit renderer: route scanner semantics accept defineLitPage from @openelement/router/lit', () => {
  const source = [
    "import { defineLitPage } from '@openelement/router/lit';",
    "import { NotesPage } from '../components/notes-page.ts';",
    "export default defineLitPage('notes-list-page', NotesPage, {});",
  ].join('\n');
  expect(
    analyzeModuleSemantics(source, 'notes.ts', {
      vocabulary: ROUTER_MODULE_VOCABULARY,
    }).definePage,
  ).toEqual(true);
  // A same-named foreign binding must not count — even with the vocabulary
  // injected, admission stays a canonical import binding.
  const foreign = [
    "import { defineLitPage } from './local.ts';",
    'export default defineLitPage(x, y, {});',
  ].join('\n');
  expect(
    analyzeModuleSemantics(foreign, 'notes.ts', {
      vocabulary: ROUTER_MODULE_VOCABULARY,
    }).definePage,
  ).toEqual(false);
});

/**
 * The R2 discriminant's LitElement arm, pinned at the REAL runtime call: a
 * LitElement page class carries no `__partProgram`, so the plain
 * "function without __partProgram" rule would misroute it to the server
 * function page branch — the ES-class shape check must keep it on the class
 * branch, and its descriptor must be the class descriptor (`kind: 'page'`)
 * with the tag recorded as `openElementPageTag`.
 */
test('lit renderer: defineLitPage routes a LitElement class through the class branch', () => {
  // A bare class stands in for the LitElement subclass (the node test env has
  // no DOM): the discriminant reads class syntax, not the base class.
  class NotesPage {}
  const page = defineLitPage('notes-list-page', NotesPage as unknown as CustomElementConstructor, {
    head: { title: 'Notes' },
    props: ({ data }) => ({ notes: (data as { notes?: unknown[] })?.notes ?? [] }),
  }) as unknown as {
    openElementPage: { kind: string; render?: unknown };
    openElementPageTag?: string;
    __partProgram?: unknown;
  };
  // The class branch, NOT the function-page branch: no render field, and the
  // descriptor kind is the class page's.
  expect(page.openElementPage.kind).toEqual('page');
  expect(page.openElementPage.render).toEqual(undefined);
  expect(page.__partProgram).toEqual(undefined);
  // The lit host tag rides the openElementPageTag static the lit entry reads.
  expect(page.openElementPageTag).toEqual('notes-list-page');
  // The descriptor's metadata is the ordinary definePage one.
  expect(page.openElementPage.head).toEqual({ title: 'Notes' });
  expect(typeof (page.openElementPage as { props?: unknown }).props).toEqual('function');
  // And the extension itself is untouched — definePage returns the class.
  expect(page).toEqual(NotesPage);
});
