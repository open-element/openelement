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
  findElementRuntimeChunkFile,
  requireElementRuntimeChunk,
  requireEntryStaticGraphFreeOfRuntime,
  resolveElementRuntimeIdentity,
} from '../src/vite/internal/element-runtime-chunk.ts';
import type { ClientBuildChunk } from '../src/vite/client-asset-manifest.ts';
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

// ─── findElementRuntimeChunkFile: the projected address (#1544/B2) ────
//
// The head projection that modulepreloads the runtime on island-bearing
// pages reads the chunk's ADDRESS from the build's own output. These are the
// guard forms of that read: the identity is the grouping name plus the hash
// `chunkFileNames` appends, exactly one file may carry it, and an output with
// none is left to the caller (a lit graph legally has none).

test('findElementRuntimeChunkFile reads the emitted chunk file and its base-prefixed asset URL', () => {
  const files = [
    'islands/client.js',
    'islands/island-open-badge-9qf3dl.js',
    `islands/${ELEMENT_RUNTIME_CHUNK_NAME}-Bh4sh.js`,
  ];
  expect(findElementRuntimeChunkFile(files)).toEqual(
    `islands/${ELEMENT_RUNTIME_CHUNK_NAME}-Bh4sh.js`,
  );
  // The same list as the client asset manifest serves it: base-prefixed URLs.
  expect(findElementRuntimeChunkFile(files.map((file) => `/client/${file}`))).toEqual(
    `/client/islands/${ELEMENT_RUNTIME_CHUNK_NAME}-Bh4sh.js`,
  );
  // Zero matches is NOT an error here: lit's entry is element-free (#1339),
  // so a lit graph legally carries no runtime chunk. Callers that require the
  // chunk fail closed themselves (requireElementRuntimeChunk above).
  expect(findElementRuntimeChunkFile(['islands/client.js'])).toEqual(undefined);
  // Near-misses never count: the hash suffix is required, and a chunk that
  // merely CONTAINS the name is a different chunk.
  expect(findElementRuntimeChunkFile([`islands/${ELEMENT_RUNTIME_CHUNK_NAME}.js`])).toEqual(
    undefined,
  );
  expect(findElementRuntimeChunkFile([`islands/x-${ELEMENT_RUNTIME_CHUNK_NAME}-Bh4sh.js`])).toEqual(
    undefined,
  );
});

test('findElementRuntimeChunkFile rejects a split layout instead of taking the first hit', () => {
  const split = [
    `islands/${ELEMENT_RUNTIME_CHUNK_NAME}-Bh4sh.js`,
    `islands/${ELEMENT_RUNTIME_CHUNK_NAME}-Zx9qp.js`,
  ];
  const error = assertThrowsIncludes(
    () => findElementRuntimeChunkFile(split),
    OpenElementError,
    'requires exactly one shared runtime chunk',
  );
  expect(error.code).toEqual(ClientBuildErrorCode.ELEMENT_RUNTIME_CHUNK_MISSING);
  expect(error.phase).toEqual('build');
});

// ─── requireEntryStaticGraphFreeOfRuntime: B2's own property ───────────
//
// The entry is the one client chunk EVERY page loads, so a static edge from it
// to the shared runtime makes the runtime an unconditional download on pages
// whose island manifest is empty. This guard is the property itself, and it is
// the one that survives Vite renaming its preload helper: the helper-group
// guard above would then match nothing and pass, while this one fails the
// moment the runtime reappears in the entry's static closure.

/** One emitted chunk record, `imports` written as rolldown writes them. */
function emittedChunk(
  fileName: string,
  moduleIds: string[],
  imports: string[],
  isEntry = false,
): ClientBuildChunk {
  return {
    fileName,
    facadeModuleId: moduleIds[0] ?? null,
    modules: Object.fromEntries(moduleIds.map((id) => [id, {}])),
    isEntry,
    imports,
  };
}

const RUNTIME_FILE = `islands/${ELEMENT_RUNTIME_CHUNK_NAME}-Bh4sh.js`;
const HELPER_FILE = 'islands/vite-helper-r-i9IPxf.js';
const ISLAND_FILE = 'islands/island-open-search-BRyKVKhp.js';

test('requireEntryStaticGraphFreeOfRuntime accepts the post-B2 entry graph', () => {
  // The measured real www graph after B2 + gap (a): the entry statically
  // imports the dedicated helper chunk and nothing else; the runtime is
  // reached only through the entry's DYNAMIC island/service imports, which is
  // outside the static closure by construction.
  expect(() =>
    requireEntryStaticGraphFreeOfRuntime(
      [
        emittedChunk('islands/client.js', ['\0virtual:open-client-entry'], [HELPER_FILE], true),
        emittedChunk(HELPER_FILE, ['\0vite/preload-helper.js'], []),
        emittedChunk(RUNTIME_FILE, ['/site/packages/element/src/index.ts'], []),
        emittedChunk(
          ISLAND_FILE,
          ['/site/app/islands/open-search.tsx'],
          [RUNTIME_FILE, HELPER_FILE],
        ),
      ],
      WORKSPACE_IDENTITY,
    ),
  ).not.toThrow();
});

test('requireEntryStaticGraphFreeOfRuntime fails closed on the measured pre-fix www graph', () => {
  // The exact emitted shape gap (a) produced on the real site: the entry
  // statically imports an ISLAND chunk (to reach the preload helper homed
  // there), and that island chunk statically imports the runtime. B2's lazy
  // entry surface was intact and the runtime was still in the page floor.
  const error = assertThrowsIncludes(
    () =>
      requireEntryStaticGraphFreeOfRuntime(
        [
          emittedChunk('islands/client.js', ['\0virtual:open-client-entry'], [ISLAND_FILE], true),
          emittedChunk(
            ISLAND_FILE,
            ['/site/app/islands/open-search.tsx'],
            [RUNTIME_FILE, 'islands/rolldown-runtime-DK3Fl9T5.js'],
          ),
          emittedChunk(RUNTIME_FILE, ['/site/packages/element/src/index.ts'], []),
        ],
        WORKSPACE_IDENTITY,
      ),
    OpenElementError,
    'statically reaches the shared element runtime',
  );
  expect(error.code).toEqual(ClientBuildErrorCode.ENTRY_STATIC_GRAPH_REACHES_RUNTIME);
  expect(error.phase).toEqual('build');
  // The trail names the hop that carried the edge — the diagnosis is the point.
  expect(error.message).toContain(ISLAND_FILE);
  expect(error.message).toContain(RUNTIME_FILE);
});

test('requireEntryStaticGraphFreeOfRuntime ignores dynamic edges', () => {
  // The entry chunk's own record never lists its dynamic targets in `imports`;
  // a chunk that IS a dynamic target of the entry must therefore not make the
  // guard fire even when it carries the runtime. This is the whole reason the
  // walk reads `imports` and not `dynamicImports`.
  expect(() =>
    requireEntryStaticGraphFreeOfRuntime(
      [
        emittedChunk('islands/client.js', ['\0virtual:open-client-entry'], [HELPER_FILE], true),
        emittedChunk(HELPER_FILE, ['\0vite/preload-helper.js'], []),
        emittedChunk(ISLAND_FILE, ['/site/app/islands/open-search.tsx'], [RUNTIME_FILE]),
        emittedChunk(RUNTIME_FILE, ['/site/packages/element/src/index.ts'], []),
      ],
      WORKSPACE_IDENTITY,
    ),
  ).not.toThrow();
});

test('requireEntryStaticGraphFreeOfRuntime passes when the graph carries no runtime at all', () => {
  // A zero-island app legitimately has no runtime chunk; there is nothing to
  // reach, and the guard answers honestly instead of failing.
  expect(() =>
    requireEntryStaticGraphFreeOfRuntime(
      [
        emittedChunk('islands/client.js', ['\0virtual:open-client-entry'], [HELPER_FILE], true),
        emittedChunk(HELPER_FILE, ['\0vite/preload-helper.js'], []),
      ],
      WORKSPACE_IDENTITY,
    ),
  ).not.toThrow();
});

test('requireEntryStaticGraphFreeOfRuntime fails closed when no entry chunk is identifiable', () => {
  // "No entry found" and "entry proven clean" are not the same fact: a guard
  // that cannot see the page floor must not report it as safe.
  const error = assertThrowsIncludes(
    () =>
      requireEntryStaticGraphFreeOfRuntime(
        [emittedChunk(RUNTIME_FILE, ['/site/packages/element/src/index.ts'], [])],
        WORKSPACE_IDENTITY,
      ),
    OpenElementError,
    'reports no entry chunk',
  );
  expect(error.code).toEqual(ClientBuildErrorCode.ENTRY_STATIC_GRAPH_REACHES_RUNTIME);
  expect(error.phase).toEqual('build');
});

test('requireEntryStaticGraphFreeOfRuntime finds the runtime behind an island reached transitively', () => {
  // The runtime need not be a direct import of the entry: any chunk in the
  // static closure that carries it counts, which is exactly how the pre-fix
  // graph smuggled it in.
  const error = assertThrowsIncludes(
    () =>
      requireEntryStaticGraphFreeOfRuntime(
        [
          emittedChunk(
            'islands/client.js',
            ['\0virtual:open-client-entry'],
            ['islands/mid-a.js'],
            true,
          ),
          emittedChunk('islands/mid-a.js', ['/site/app/mid-a.ts'], ['islands/mid-b.js']),
          emittedChunk('islands/mid-b.js', ['/site/app/mid-b.ts'], [RUNTIME_FILE]),
          emittedChunk(RUNTIME_FILE, ['/site/packages/element/src/index.ts'], []),
        ],
        WORKSPACE_IDENTITY,
      ),
    OpenElementError,
    'statically reaches the shared element runtime',
  );
  expect(error.code).toEqual(ClientBuildErrorCode.ENTRY_STATIC_GRAPH_REACHES_RUNTIME);
});
