import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import type { RouteEntry } from '@openelement/protocol/framework';
import {
  generateClientEntry,
  ELEMENT_SERVICES_RUNTIME_SPECIFIERS,
} from '../src/vite/internal/ssg/entry-client-codegen.ts';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderEntry } from '../src/vite/internal/ssg/entry-orchestrator.ts';
import { selectRendererAdapter } from '../src/vite/internal/ssg/renderer-adapter.ts';

const routes: RouteEntry[] = [
  {
    path: '/',
    filePath: 'index.ts',
    type: 'page',
    varName: 'pageIndex',
  },
];

test('native selection keeps the document and island wiring on their runtime boundaries', () => {
  const adapter = selectRendererAdapter('native');
  expect(adapter.mode).toEqual('native');
  // The compiled stream channel retired with the class lane (C09/C10): the adapter declares none.
  expect('supportsCompiledStream' in adapter).toBe(false);
  expect(adapter.hydration).toEqual('compiled-hydration');
  const descriptor = buildEntryDescriptor(routes, { renderer: 'native' });
  const server = renderEntry(descriptor);
  const client = generateClientEntry(
    [
      {
        tagName: 'x-probe',
        modulePath: '/app/islands/x.ts',
        strategy: 'load',
        ssr: true,
        dsd: true,
      },
    ],
    { renderer: 'native' },
  );
  expect(server).toContain('scripts: __clientScriptDescriptors(content)');
  expect(server).toContain('__locales.length > 0 ? __localeFromPath');
  expect(client).toContain('__installPreHydrationCapture(document, __tags);');
  expect(client).toContain(`import('${ELEMENT_SERVICES_RUNTIME_SPECIFIERS.full}')`);
  expect(client).not.toContain(process.cwd());
  expect(descriptor.imports.some((entry) => entry.from === '@openelement/element')).toEqual(true);
  expect(selectRendererAdapter(undefined).mode).toEqual('native');
  assertThrowsIncludes(() => selectRendererAdapter('future'), Error, "renderer must be 'native'");
});

test('the retired lit renderer fails with an explicit migration error', () => {
  assertThrowsIncludes(() => selectRendererAdapter('lit'), Error, 'retired');
});
