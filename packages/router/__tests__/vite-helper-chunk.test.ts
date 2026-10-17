/**
 * @openelement/router - internal/vite-helper-chunk.ts tests (B2 gap (a))
 *
 * Vite's injected preload helper is a real module the generated client entry
 * must import statically, so it can never be homed inside a lazily-loaded
 * island chunk: the entry would then statically reach that island, and through
 * the island's own #1544 runtime import, the shared element runtime — on every
 * page, including pages whose island manifest is empty. The grouping identity
 * is Vite's own declared module id, and the emitted-chunk guard fails closed
 * on a helper homed anywhere but the one dedicated `vite-helper` chunk, and on
 * a helper split across chunks (its `seen` de-duplication map is only correct
 * while it is a single instance).
 */

import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { OpenElementError } from '@openelement/element';
import {
  VITE_HELPER_CHUNK_NAME,
  VITE_PRELOAD_HELPER_ID,
  findViteHelperChunkFile,
  requireViteHelperChunk,
  viteHelperChunkName,
} from '../src/vite/internal/vite-helper-chunk.ts';
import type { ClientBuildChunk } from '../src/vite/client-asset-manifest.ts';
import { ClientBuildErrorCode } from '../src/internal/error-codes.ts';

function chunk(
  fileName: string,
  moduleIds: string[],
  extra: Partial<ClientBuildChunk> = {},
): ClientBuildChunk {
  return {
    fileName,
    facadeModuleId: null,
    modules: Object.fromEntries(moduleIds.map((id) => [id, {}])),
    ...extra,
  };
}

test('VITE_PRELOAD_HELPER_ID is Vite\u2019s own declared id, NUL-prefixed and exact', () => {
  // The id is a contract with Vite, not a name we chose: Vite declares it and
  // matches it with exactRegex in its own plugins. A changed value here is a
  // changed contract, so it is pinned literally.
  expect(VITE_PRELOAD_HELPER_ID).toEqual('\0vite/preload-helper.js');
  expect(VITE_PRELOAD_HELPER_ID.startsWith('\0')).toEqual(true);
  expect(VITE_HELPER_CHUNK_NAME).toEqual('vite-helper');
});

test('viteHelperChunkName matches the helper id by exact identity and nothing else', () => {
  expect(viteHelperChunkName(VITE_PRELOAD_HELPER_ID)).toEqual(VITE_HELPER_CHUNK_NAME);
  // Exact identity, never a prefix or substring: a sibling virtual module
  // under the same namespace, and a path that merely contains the id, must
  // both stay unclaimed.
  expect(viteHelperChunkName('\0vite/preload-helper.js.extra')).toBeUndefined();
  expect(viteHelperChunkName('\0vite/modulepreload-polyfill.js')).toBeUndefined();
  expect(viteHelperChunkName('\0vite/dynamic-import-helper.js')).toBeUndefined();
  expect(viteHelperChunkName(`/app/node_modules/${VITE_PRELOAD_HELPER_ID}`)).toBeUndefined();
  expect(viteHelperChunkName('/app/islands/counter.ts')).toBeUndefined();
  expect(viteHelperChunkName('')).toBeUndefined();
});

test('requireViteHelperChunk accepts a graph with no injected helper at all', () => {
  // Legal and expected: a graph with no dynamic import anywhere never needs
  // the helper, so the grouping rule had nothing to claim.
  expect(() =>
    requireViteHelperChunk([chunk('islands/client.js', ['/app/entry.ts'], { isEntry: true })]),
  ).not.toThrow();
});

test('requireViteHelperChunk accepts the one dedicated helper chunk', () => {
  expect(() =>
    requireViteHelperChunk([
      chunk('islands/client.js', ['/app/entry.ts'], {
        isEntry: true,
        imports: ['islands/vite-helper-abc123.js'],
      }),
      chunk('islands/vite-helper-abc123.js', [VITE_PRELOAD_HELPER_ID]),
      chunk('islands/island-open-search-def456.js', ['/app/islands/open-search.tsx']),
    ]),
  ).not.toThrow();
});

test('requireViteHelperChunk fails closed when the helper is homed in an island chunk', () => {
  // The exact emitted layout B2 gap (a) exists to prevent: the entry imports
  // the helper, the helper lives in an island chunk, so the entry statically
  // reaches that island (and the element runtime behind it).
  const error = assertThrowsIncludes(
    () =>
      requireViteHelperChunk([
        chunk('islands/client.js', ['\0virtual:open-client-entry'], {
          isEntry: true,
          imports: ['islands/island-open-search-def456.js'],
        }),
        chunk('islands/island-open-search-def456.js', [
          '/app/islands/open-search.tsx',
          VITE_PRELOAD_HELPER_ID,
        ]),
      ]),
    OpenElementError,
    'instead of the shared vite-helper chunk',
  );
  expect(error.code).toEqual(ClientBuildErrorCode.VITE_HELPER_CHUNK_MISSING);
  expect(error.phase).toEqual('build');
  // The message names where it actually landed — the diagnosis is the point.
  expect(error.message).toContain('islands/island-open-search-def456.js');
});

test('requireViteHelperChunk fails closed when the helper is split across chunks', () => {
  // Two instances means the module-level `seen` map is no longer shared, so
  // preload de-duplication silently stops working — a different defect with
  // the same cause, and equally unshippable.
  const error = assertThrowsIncludes(
    () =>
      requireViteHelperChunk([
        chunk('islands/vite-helper-abc123.js', [VITE_PRELOAD_HELPER_ID]),
        chunk('islands/island-open-search-def456.js', [VITE_PRELOAD_HELPER_ID]),
      ]),
    OpenElementError,
    'across 2 chunks',
  );
  expect(error.code).toEqual(ClientBuildErrorCode.VITE_HELPER_CHUNK_MISSING);
});

test('requireViteHelperChunk reads a facade module id as well as the module map', () => {
  // The helper arriving as a chunk's facade is the same claim: the guard must
  // not depend on which of the two id surfaces rolldown populates.
  const error = assertThrowsIncludes(
    () =>
      requireViteHelperChunk([
        chunk('islands/island-open-search-def456.js', [], {
          facadeModuleId: VITE_PRELOAD_HELPER_ID,
        }),
      ]),
    OpenElementError,
    'instead of the shared vite-helper chunk',
  );
  expect(error.code).toEqual(ClientBuildErrorCode.VITE_HELPER_CHUNK_MISSING);
});

test('findViteHelperChunkFile reads the emitted address by grouping name plus hash', () => {
  expect(
    findViteHelperChunkFile([
      'islands/client.js',
      'islands/element-runtime-abc.js',
      `islands/${VITE_HELPER_CHUNK_NAME}-abc123.js`,
      'islands/island-counter-def.js',
    ]),
  ).toEqual(`islands/${VITE_HELPER_CHUNK_NAME}-abc123.js`);
  // A base-prefixed URL form resolves the same way (the head projection reads
  // emitted asset URLs, the build reads output names).
  expect(
    findViteHelperChunkFile(['/client/islands/vite-helper-abc123.js', 'islands/client.js']),
  ).toEqual('/client/islands/vite-helper-abc123.js');
  // Nothing claimed: the address read is a lookup, not a guess — a chunk that
  // merely CONTAINS the name is not a hit.
  expect(findViteHelperChunkFile(['islands/client.js', 'islands/other-abc.js'])).toBeUndefined();
  expect(findViteHelperChunkFile([`islands/${VITE_HELPER_CHUNK_NAME}.js`])).toBeUndefined();
});
