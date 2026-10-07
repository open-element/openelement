/**
 * @openelement/router - internal/element-runtime-chunk.ts tests (#1544)
 *
 * The shared element-runtime chunk's grouping identity: the package root is
 * anchored by a package.json-name walk from a module id the client build's
 * resolver answered, the group matches exactly the ids under that root
 * (segment boundary, query-stripped, separator-normalized), and the native
 * build's emitted-chunk guard fails closed on a wrong layout — zero grouped
 * runtime modules, a runtime split across chunks, or a runtime homed inside
 * an island chunk — per-island runtime copies must never ship silently.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { OpenElementError } from '@openelement/element';
import {
  ELEMENT_RUNTIME_CHUNK_NAME,
  type ElementRuntimeIdentity,
  elementRuntimeChunkName,
  requireElementRuntimeChunk,
  resolveElementRuntimeIdentity,
} from '../src/vite/internal/element-runtime-chunk.ts';
import { ClientBuildErrorCode } from '../src/internal/error-codes.ts';

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
});

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(absolute.slice(0, absolute.lastIndexOf('/')), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  }
}

test('resolveElementRuntimeIdentity anchors the workspace element package root', () => {
  // The repo's own element package: the same layout a workspace-linked
  // client build resolves — <repo>/packages/element/src/index.ts.
  const resolvedEntryId = fileURLToPath(
    new URL('../../../packages/element/src/index.ts', import.meta.url),
  );
  const identity = resolveElementRuntimeIdentity(resolvedEntryId);
  expect(identity.packageRoot.endsWith('/packages/element')).toBe(true);
});

test('resolveElementRuntimeIdentity skips non-matching package.json ancestors and anchors the named one', async () => {
  const root = await realpathTemp(mkdtemp(join(tmpdir(), 'oe-element-runtime-')));
  await writeTree(root, {
    'package.json': JSON.stringify({ name: '@openelement/element', version: '0.0.0' }),
    // A nested scope package with its own (non-matching) manifest: the walk
    // must pass it and anchor at the named ancestor.
    'nested/@acme/other/package.json': JSON.stringify({ name: '@acme/other' }),
    'nested/@acme/other/src/deep/module.ts': 'export const x = 1;\n',
  });
  const identity = resolveElementRuntimeIdentity(
    join(root, 'nested/@acme/other/src/deep/module.ts'),
  );
  expect(identity.packageRoot).toEqual(root);
});

test('resolveElementRuntimeIdentity fails closed when no ancestor names the package', async () => {
  const root = await realpathTemp(mkdtemp(join(tmpdir(), 'oe-element-runtime-')));
  await writeTree(root, {
    'package.json': JSON.stringify({ name: '@acme/unrelated' }),
    'src/index.ts': 'export const x = 1;\n',
  });
  const error = assertThrowsIncludes(
    () => resolveElementRuntimeIdentity(join(root, 'src/index.ts')),
    OpenElementError,
    'cannot be anchored',
  );
  expect(error.code).toEqual(ClientBuildErrorCode.ELEMENT_RUNTIME_IDENTITY_UNRESOLVED);
  expect(error.phase).toEqual('build');
});

async function realpathTemp(created: Promise<string>): Promise<string> {
  // Node resolution answers realpaths (macOS tmpdir() hands out a /var/...
  // path whose realpath is /private/var) — same treatment the external
  // consumer fixture applies.
  const { realpath } = await import('node:fs/promises');
  const path = await created;
  tempRoots.push(path);
  return realpath(path);
}

const WORKSPACE_IDENTITY: ElementRuntimeIdentity = {
  packageRoot: '/site/packages/element',
};

const INSTALLED_IDENTITY: ElementRuntimeIdentity = {
  packageRoot: '/site/node_modules/@openelement/element',
};

test('elementRuntimeChunkName matches exactly the module ids under the package root', () => {
  expect(elementRuntimeChunkName('/site/packages/element/src/index.ts', WORKSPACE_IDENTITY)).toBe(
    ELEMENT_RUNTIME_CHUNK_NAME,
  );
  expect(
    elementRuntimeChunkName(
      '/site/packages/element/src/internal/core/errors.ts',
      WORKSPACE_IDENTITY,
    ),
  ).toBe(ELEMENT_RUNTIME_CHUNK_NAME);
  // The installed layout groups identically: same package name, other root.
  expect(
    elementRuntimeChunkName(
      '/site/node_modules/@openelement/element/src/jsx-runtime.ts',
      INSTALLED_IDENTITY,
    ),
  ).toBe(ELEMENT_RUNTIME_CHUNK_NAME);
});

test('elementRuntimeChunkName never matches on a substring or sibling-prefix hit', () => {
  // Sibling directory sharing the trailing segment: boundary must refuse it.
  expect(
    elementRuntimeChunkName('/site/packages/element-next/src/index.ts', WORKSPACE_IDENTITY),
  ).toBe(undefined);
  // A package whose path merely contains the root as a substring.
  expect(
    elementRuntimeChunkName('/site/packages/element-evil/src/index.ts', WORKSPACE_IDENTITY),
  ).toBe(undefined);
  // The root itself is a directory, not a module.
  expect(elementRuntimeChunkName(WORKSPACE_IDENTITY.packageRoot, WORKSPACE_IDENTITY)).toBe(
    undefined,
  );
  // Foreign modules never match.
  expect(elementRuntimeChunkName('/site/app/islands/open-counter.ts', WORKSPACE_IDENTITY)).toBe(
    undefined,
  );
});

test('elementRuntimeChunkName strips query suffixes and a null identity matches nothing', () => {
  expect(
    elementRuntimeChunkName('/site/packages/element/src/index.ts?v=123', WORKSPACE_IDENTITY),
  ).toBe(ELEMENT_RUNTIME_CHUNK_NAME);
  expect(elementRuntimeChunkName('/site/packages/element/src/index.ts', null)).toBe(undefined);
});

test('requireElementRuntimeChunk accepts the emitted chunk carrying runtime modules', () => {
  const sharedChunk = {
    fileName: 'islands/element-runtime-Bh4sh.js',
    facadeModuleId: null,
    modules: {
      '/site/packages/element/src/index.ts': {},
      '/site/packages/element/src/html.ts': {},
    },
  };
  requireElementRuntimeChunk(
    [sharedChunk, { fileName: 'islands/client.js', facadeModuleId: null, modules: {} }],
    WORKSPACE_IDENTITY,
  );
  // The runtime module riding a facade (no separate module map) counts too.
  requireElementRuntimeChunk(
    [
      {
        fileName: 'islands/element-runtime-Bh4sh.js',
        facadeModuleId: '/site/packages/element/src/index.ts',
        modules: {},
      },
    ],
    WORKSPACE_IDENTITY,
  );
});

test('requireElementRuntimeChunk fails closed on zero grouped runtime modules', () => {
  const islandsOnly = [
    {
      fileName: 'islands/island-open-badge-9qf3dl.js',
      facadeModuleId: '/site/app/islands/open-badge.ts',
      modules: { '/site/app/islands/open-badge.ts': {} },
    },
  ];
  const error = assertThrowsIncludes(
    () => requireElementRuntimeChunk(islandsOnly, WORKSPACE_IDENTITY),
    OpenElementError,
    'shared element-runtime chunk never fired',
  );
  expect(error.code).toEqual(ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING);
  expect(error.phase).toEqual('build');
});

test('requireElementRuntimeChunk rejects a runtime homed inside an island chunk', () => {
  // The group never fired: the runtime modules homed in whichever island
  // chunk their import reached first, so the one carrying chunk is island-
  // named rather than the shared element-runtime identity.
  const islandWithRuntime = [
    {
      fileName: 'islands/island-open-badge-9qf3dl.js',
      facadeModuleId: '/site/app/islands/open-badge.ts',
      modules: {
        '/site/app/islands/open-badge.ts': {},
        '/site/packages/element/src/index.ts': {},
      },
    },
  ];
  const error = assertThrowsIncludes(
    () => requireElementRuntimeChunk(islandWithRuntime, WORKSPACE_IDENTITY),
    OpenElementError,
    'is not the shared element-runtime chunk',
  );
  expect(error.code).toEqual(ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING);
  expect(error.phase).toEqual('build');
});

test('requireElementRuntimeChunk rejects a runtime split across chunks', () => {
  const split = [
    {
      fileName: 'islands/element-runtime-Bh4sh.js',
      facadeModuleId: null,
      modules: { '/site/packages/element/src/index.ts': {} },
    },
    {
      fileName: 'islands/island-open-badge-9qf3dl.js',
      facadeModuleId: null,
      modules: { '/site/packages/element/src/html.ts': {} },
    },
  ];
  const error = assertThrowsIncludes(
    () => requireElementRuntimeChunk(split, WORKSPACE_IDENTITY),
    OpenElementError,
    'across 2 chunks',
  );
  expect(error.code).toEqual(ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING);
  expect(error.phase).toEqual('build');
});

test('requireElementRuntimeChunk fails closed on a missing identity (ordering bug)', () => {
  const error = assertThrowsIncludes(
    () => requireElementRuntimeChunk([], null),
    OpenElementError,
    'identity pass produced no element runtime identity',
  );
  expect(error.code).toEqual(ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING);
  expect(error.phase).toEqual('build');
});
