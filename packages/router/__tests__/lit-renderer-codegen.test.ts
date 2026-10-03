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
import { analyzeModuleSemantics } from '@openelement/element/compiler';
import { ROUTER_MODULE_VOCABULARY } from '../src/vite/internal/protocol/module-vocabulary.ts';
import type { RouteEntry } from '../src/vite/internal/protocol/framework.ts';

const litRoutes: RouteEntry[] = [
  { path: '/notes', filePath: 'notes.ts', type: 'page', varName: 'pageNotes', definePage: true },
];

test('lit renderer: descriptor forks imports and rejects a compiled appShell', () => {
  const desc = buildEntryDescriptor(litRoutes, { renderer: 'lit', appShell: false });
  expect(desc.renderer).toEqual('lit');
  // The lit server entry never imports the runtime barrel at all; the pure
  // HTML utilities arrive through the kernel-free @openelement/element/html
  // leaf (proven at module-graph level in lit-graph-boundary.test.ts).
  const barrelImport = desc.imports.find((imp) => imp.from === '@openelement/element');
  expect(barrelImport).toEqual(undefined);
  const htmlImport = desc.imports.find((imp) => imp.from === '@openelement/element/html');
  expect(htmlImport?.names).toEqual(['trustedHtml', 'escapeHtml', 'wrapInDocument']);
  const litImport = desc.imports.find((imp) => imp.from === '@openelement/router/lit-ssr');
  expect(litImport?.names).toEqual(['renderLitPageToHtml']);

  assertThrowsIncludes(
    () =>
      buildEntryDescriptor(litRoutes, {
        renderer: 'lit',
        appShell: { tagName: 'app-shell', import: './shell.ts' },
      }),
    Error,
    "renderer: 'lit' does not support a compiled appShell",
  );
});

test('lit renderer: native descriptor shape is unchanged (renderer absent)', () => {
  const desc = buildEntryDescriptor(litRoutes);
  expect('renderer' in desc).toEqual(false);
  const elementImport = desc.imports.find((imp) => imp.from === '@openelement/element');
  expect(elementImport?.names.includes('renderDsd')).toEqual(true);
});

test('lit renderer: entry forks tag resolution and page render (no page-data side channel)', () => {
  const litEntry = renderEntry(
    buildEntryDescriptor(litRoutes, { renderer: 'lit', appShell: false, ssg: true }),
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
  expect(litEntry.includes('renderDsd')).toEqual(false);
  expect(litEntry.includes('__partProgram')).toEqual(false);

  // Loader/action protocol stays: the lit entry keeps the shared machinery.
  expect(litEntry).toContain('__runActionProtocol');

  const nativeEntry = renderEntry(buildEntryDescriptor(litRoutes, { ssg: true }));
  expect(nativeEntry).toContain('renderDsd');
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
  expect(nativeClient).toContain("from '@openelement/element'");
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
