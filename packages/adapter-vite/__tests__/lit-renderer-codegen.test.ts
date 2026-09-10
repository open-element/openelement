/**
 * @openelement/adapter-vite - Lit renderer codegen fork tests (Beta.2.2, #1339)
 *
 * The renderer option is explicit config, never inferred: 'lit' forks page tag
 * resolution (openElementPageTag), page SSR (renderLitPageToHtml), the
 * page-data channel and the client entry, while loader/action/protocol code
 * and the native default stay byte-identical.
 */

import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { buildEntryDescriptor, renderEntry } from '../src/internal/ssg/index.ts';
import { generateClientEntry } from '../src/internal/ssg/entry-client-codegen.ts';
import { analyzeModuleSemantics } from '../src/internal/compiler/semantic-core/module-analysis.ts';
import type { RouteEntry } from '../src/internal/protocol/framework.ts';

const litRoutes: RouteEntry[] = [
  { path: '/notes', filePath: 'notes.ts', type: 'page', varName: 'pageNotes', definePage: true },
];

Deno.test('lit renderer: descriptor forks imports and rejects a compiled appShell', () => {
  const desc = buildEntryDescriptor(litRoutes, { renderer: 'lit', appShell: false });
  assertEquals(desc.renderer, 'lit');
  const elementImport = desc.imports.find((imp) => imp.from === '@openelement/element');
  assertEquals(elementImport?.names.includes('renderDsd'), false);
  const litImport = desc.imports.find((imp) => imp.from === '@openelement/app/lit-ssr');
  assertEquals(litImport?.names, ['renderLitPageToHtml']);

  assertThrows(
    () =>
      buildEntryDescriptor(litRoutes, {
        renderer: 'lit',
        appShell: { tagName: 'app-shell', import: './shell.ts' },
      }),
    Error,
    "renderer: 'lit' does not support a compiled appShell",
  );
});

Deno.test('lit renderer: native descriptor shape is unchanged (renderer absent)', () => {
  const desc = buildEntryDescriptor(litRoutes);
  assertEquals('renderer' in desc, false);
  const elementImport = desc.imports.find((imp) => imp.from === '@openelement/element');
  assertEquals(elementImport?.names.includes('renderDsd'), true);
});

Deno.test('lit renderer: entry forks tag resolution, page render and the data channel', () => {
  const litEntry = renderEntry(
    buildEntryDescriptor(litRoutes, { renderer: 'lit', appShell: false, ssg: true }),
  );
  // First import installs the lit DOM shim before any route module evaluates.
  assertEquals(
    litEntry.startsWith("import '@lit-labs/ssr/lib/install-global-dom-shim.js';"),
    true,
  );
  assertStringIncludes(litEntry, 'routeModule.default.openElementPageTag');
  assertStringIncludes(litEntry, '__renderLitPageToHtml({ tag, props })');
  assertStringIncludes(litEntry, '__litPageDataScript(__pageDataProps)');
  assertStringIncludes(litEntry, 'data-open-element-page-data');
  // The compiled serializer / Part Program kernel is never referenced.
  assertEquals(litEntry.includes('renderDsd'), false);
  assertEquals(litEntry.includes('__partProgram'), false);

  // Loader/action protocol stays: the lit entry keeps the shared machinery.
  assertStringIncludes(litEntry, '__runActionProtocol');

  const nativeEntry = renderEntry(buildEntryDescriptor(litRoutes, { ssg: true }));
  assertStringIncludes(nativeEntry, 'renderDsd');
  assertEquals(nativeEntry.includes('__litPageDataScript'), false);
});

Deno.test('lit renderer: client entry installs hydrate-support first and stays element-free', () => {
  const client = generateClientEntry(
    [{ tagName: 'note-counter', modulePath: '/app/islands/note-counter.ts', strategy: 'load' }],
    { enhancedForms: true, renderer: 'lit' },
  );
  const importLines = client.split('\n').filter((line) => line.startsWith('import '));
  assertEquals(importLines[0], "import '@lit-labs/ssr-client/lit-element-hydrate-support.js';");
  assertEquals(importLines.some((line) => line.includes('@openelement/element')), false);
  assertStringIncludes(client, 'createEnhanceClient');
  assertStringIncludes(client, '__liftDeferHydration');
  // The header comment names the native claim helpers to document their
  // absence; assert the CALLS are gone, not the words.
  assertEquals(client.includes('ensurePreHydrationClickCapture();'), false);
  assertEquals(client.includes('ensureDeepFragmentNavigation();'), false);

  const nativeClient = generateClientEntry(
    [{ tagName: 'note-counter', modulePath: '/app/islands/note-counter.ts', strategy: 'load' }],
    { enhancedForms: true },
  );
  assertStringIncludes(nativeClient, "from '@openelement/element'");
  assertEquals(nativeClient.includes('lit-element-hydrate-support'), false);
});

Deno.test('lit renderer: route scanner semantics accept defineLitPage from @openelement/app/lit', () => {
  const source = [
    "import { defineLitPage } from '@openelement/app/lit';",
    "import { NotesPage } from '../components/notes-page.ts';",
    "export default defineLitPage('notes-list-page', NotesPage, {});",
  ].join('\n');
  assertEquals(analyzeModuleSemantics(source, 'notes.ts').definePage, true);
  // A same-named foreign binding must not count.
  const foreign = [
    "import { defineLitPage } from './local.ts';",
    'export default defineLitPage(x, y, {});',
  ].join('\n');
  assertEquals(analyzeModuleSemantics(foreign, 'notes.ts').definePage, false);
});
