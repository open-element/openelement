import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import { join } from '@std/path';
import {
  buildClientAssetManifest,
  collectClientBuildChunks,
  findClientEntryFile,
  moduleIdentityMatches,
  packageIslandChunkName,
  readViteClientManifest,
} from '../src/vite/client-asset-manifest.ts';
import { OpenElementError } from '@openelement/element';
import { ClientAssetErrorCode } from '../src/internal/error-codes.ts';
import {
  EMPTY_CLIENT_ASSET_MANIFEST,
  serializeClientAssetsModule,
} from '../src/vite/internal/protocol/client-assets.ts';
import type { ClientIslandDeliveryEntry } from '../src/vite/internal/ssg/delivery.ts';

function island(overrides: Partial<ClientIslandDeliveryEntry> = {}): ClientIslandDeliveryEntry {
  return {
    tagName: 'open-counter',
    modulePath: '/app/islands/counter.ts',
    strategy: 'idle',
    ...overrides,
  };
}

const ROOT = '/proj';
const MANIFEST_PATH = '/proj/dist/client/.vite/manifest.json';

Deno.test('findClientEntryFile reads the virtual client entry from the build manifest', () => {
  assertEquals(
    findClientEntryFile({
      'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
      'app/islands/counter.ts': { file: 'islands/island-counter-Ab12.js', name: 'island-counter' },
    }),
    'islands/client.js',
  );
  // Position-independent: the entry record wins wherever its key sits —
  // unrelated keys never shadow it and it never shadows them.
  assertEquals(
    findClientEntryFile({
      'app/islands/counter.ts': { file: 'islands/island-counter-Ab12.js' },
      'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
    }),
    'islands/client.js',
  );
  assertEquals(findClientEntryFile({ 'app/islands/counter.ts': { file: 'islands/x.js' } }), null);
});

Deno.test('findClientEntryFile fails closed when several records claim the client entry', () => {
  // Object.entries follows JSON insertion order, which the manifest writer
  // is free to change between builds — a first-hit pick would make the
  // shipped entry depend on that order. Two claiming records are ambiguous
  // in EITHER order, and the failure names every candidate.
  const records = (order: 'virtual-first' | 'copy-first') =>
    order === 'virtual-first'
      ? {
        'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
        'app/_client/open-client-entry.ts': { file: 'islands/client-2.js' },
      }
      : {
        'app/_client/open-client-entry.ts': { file: 'islands/client-2.js' },
        'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
      };
  for (const order of ['virtual-first', 'copy-first'] as const) {
    const error = assertThrows(
      () => findClientEntryFile(records(order), MANIFEST_PATH),
      OpenElementError,
    );
    assertEquals(error.code, ClientAssetErrorCode.ENTRY_AMBIGUOUS);
    assert(
      error.message.includes('islands/client.js') && error.message.includes('islands/client-2.js'),
      `error names every candidate entry: ${error.message}`,
    );
    assert(error.message.includes(MANIFEST_PATH), `error names the manifest: ${error.message}`);
  }
});

Deno.test('buildClientAssetManifest fails when the manifest records several client entries', () => {
  // The builder's join must not depend on key order either: the ambiguity
  // fails Phase 2 before any island is resolved.
  const error = assertThrows(
    () =>
      buildClientAssetManifest({
        root: ROOT,
        base: '/',
        islands: [{ entry: island(), sourceFile: join(ROOT, 'app/islands/counter.ts') }],
        viteManifest: {
          'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
          'app/_client/open-client-entry.ts': { file: 'islands/client-2.js', isEntry: true },
        },
        chunks: [],
        manifestPath: MANIFEST_PATH,
      }),
    OpenElementError,
  );
  assertEquals(error.code, ClientAssetErrorCode.ENTRY_AMBIGUOUS);
});

Deno.test('readViteClientManifest fails closed when the manifest is missing', async () => {
  const error = await assertRejects(
    () => readViteClientManifest(join('/nonexistent', 'manifest.json')),
    OpenElementError,
  );
  assertEquals(error.code, ClientAssetErrorCode.MANIFEST_READ);
  // The failure names the manifest path and the reason.
  assert(
    error.message.includes(join('/nonexistent', 'manifest.json')),
    `error must carry the manifest path, got: ${error.message}`,
  );
  assert(
    error.message.includes('reason:'),
    `error must carry the failure reason: ${error.message}`,
  );
});

Deno.test('readViteClientManifest fails closed when the manifest is corrupted', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, 'manifest.json');
    await Deno.writeTextFile(path, '{ not json');
    const error = await assertRejects(
      () => readViteClientManifest(path),
      OpenElementError,
    );
    assertEquals(error.code, ClientAssetErrorCode.MANIFEST_MALFORMED);
    assert(error.message.includes(path), `error must carry the manifest path: ${error.message}`);
    // A valid manifest still parses.
    await Deno.writeTextFile(path, JSON.stringify({ entry: { file: 'islands/client.js' } }));
    const manifest = await readViteClientManifest(path);
    assertEquals(manifest, { entry: { file: 'islands/client.js' } });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('collectClientBuildChunks keeps chunk outputs and skips assets/watchers', () => {
  const chunks = collectClientBuildChunks({
    output: [
      {
        type: 'chunk',
        fileName: 'islands/client.js',
        facadeModuleId: '\0virtual:entry',
        modules: {},
      },
      { type: 'asset', fileName: 'islands/style.css' },
      {
        type: 'chunk',
        fileName: 'islands/island-counter-Ab12.js',
        modules: { '/proj/app/islands/counter.ts': {} },
      },
    ],
  });
  assertEquals(chunks.length, 2);
  assertEquals(chunks[0].fileName, 'islands/client.js');
  assertEquals(chunks[1].facadeModuleId, undefined);
  // Watcher results (no output array) and plain garbage contribute nothing.
  assertEquals(collectClientBuildChunks({ kind: 'watch' }), []);
  assertEquals(collectClientBuildChunks(undefined), []);
  assertEquals(
    collectClientBuildChunks([{ output: [] }, { output: [{ type: 'chunk', fileName: 'a.js' }] }])
      .length,
    1,
  );
});

Deno.test('buildClientAssetManifest maps islands by Rollup module id, not by output file name', () => {
  const manifest = buildClientAssetManifest({
    root: ROOT,
    base: '/',
    islands: [{
      entry: island({ strategy: 'load' }),
      sourceFile: join(ROOT, 'app/islands/counter.ts'),
    }],
    viteManifest: {
      'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
      'app/islands/counter.ts': {
        file: 'islands/island-counter-Ab12cd.js',
        name: 'island-counter',
      },
    },
    chunks: [
      {
        fileName: 'islands/island-counter-Ab12cd.js',
        facadeModuleId: '/proj/app/islands/counter.ts',
        modules: { '/proj/app/islands/counter.ts': {} },
      },
      { fileName: 'islands/client.js', modules: {} },
    ],
    manifestPath: MANIFEST_PATH,
  });
  assertEquals(manifest.entry, '/client/islands/client.js');
  assertEquals(manifest.islands['open-counter'], {
    file: '/client/islands/island-counter-Ab12cd.js',
    strategy: 'load',
    preload: true,
  });
  assertEquals(manifest.shared, []);
});

Deno.test('buildClientAssetManifest keeps island identity when islands share one chunk', () => {
  // Two islands, one shared chunk: the Rollup module metadata maps BOTH
  // module ids into the same chunk file — no filename parsing.
  const sharedChunk = {
    fileName: 'islands/pair-Xy34zw.js',
    modules: {
      '/proj/app/islands/counter.ts': {},
      '/proj/app/islands/theme.ts': {},
    },
  };
  const manifest = buildClientAssetManifest({
    root: ROOT,
    base: '/',
    islands: [
      { entry: island(), sourceFile: join(ROOT, 'app/islands/counter.ts') },
      {
        entry: island({
          tagName: 'open-theme',
          modulePath: '/app/islands/theme.ts',
          strategy: 'visible',
        }),
        sourceFile: join(ROOT, 'app/islands/theme.ts'),
      },
    ],
    viteManifest: {
      'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
      'app/islands/counter.ts': { file: 'islands/pair-Xy34zw.js' },
    },
    chunks: [
      sharedChunk,
      { fileName: 'islands/client.js', modules: {} },
    ],
    manifestPath: MANIFEST_PATH,
  });
  assertEquals(manifest.islands['open-counter'], {
    file: '/client/islands/pair-Xy34zw.js',
    strategy: 'idle',
  });
  assertEquals(manifest.islands['open-theme'], {
    file: '/client/islands/pair-Xy34zw.js',
    strategy: 'visible',
  });
  assertEquals('preload' in manifest.islands['open-counter'], false);
  assertEquals(manifest.shared, []);
});

Deno.test('buildClientAssetManifest falls back to the Vite manifest source key', () => {
  // No Rollup metadata carried the module id (chunk metadata unavailable);
  // the build manifest's source key still resolves the island hash-agnostically.
  const manifest = buildClientAssetManifest({
    root: ROOT,
    base: '/app/',
    islands: [{ entry: island(), sourceFile: join(ROOT, 'app/islands/counter.ts') }],
    viteManifest: {
      'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
      'app/islands/counter.ts': { file: 'islands/island-counter-Qr56.js' },
    },
    chunks: [],
    manifestPath: MANIFEST_PATH,
  });
  assertEquals(manifest.entry, '/app/client/islands/client.js');
  assertEquals(manifest.islands['open-counter'].file, '/app/client/islands/island-counter-Qr56.js');
});

Deno.test('buildClientAssetManifest matches package islands by exact module identity', () => {
  // Declared specifiers are extensionless; emitted ids carry the extension —
  // the segment-boundary identity rule bridges exactly that difference.
  const manifest = buildClientAssetManifest({
    root: ROOT,
    base: '/',
    islands: [
      {
        entry: island({
          tagName: 'open-callout',
          modulePath: 'open-callout.js',
          isPackage: true,
          strategy: 'idle',
        }),
        sourceFile: null,
      },
    ],
    viteManifest: {
      'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
    },
    chunks: [
      {
        fileName: 'islands/island-open-callout-Zz00.js',
        modules: {
          '/proj/node_modules/@acme/ui/open-callout.js': {},
        },
      },
      { fileName: 'islands/client.js', modules: {} },
    ],
    manifestPath: MANIFEST_PATH,
  });
  assertEquals(
    manifest.islands['open-callout'].file,
    '/client/islands/island-open-callout-Zz00.js',
  );
});

Deno.test('buildClientAssetManifest does not substring-match a package island identity', () => {
  // A lookalike file (`my-open-callout.js`) must never satisfy the identity
  // `open-callout.js` — the old substring first-hit shipped the wrong file.
  const error = assertThrows(
    () =>
      buildClientAssetManifest({
        root: ROOT,
        base: '/',
        islands: [{
          entry: island({
            tagName: 'open-callout',
            modulePath: 'open-callout.js',
            isPackage: true,
          }),
          sourceFile: null,
        }],
        viteManifest: {
          'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
        },
        chunks: [{
          fileName: 'islands/island-open-callout-Zz00.js',
          modules: {
            '/proj/node_modules/@acme/ui/my-open-callout.js': {},
          },
        }],
        manifestPath: MANIFEST_PATH,
      }),
    OpenElementError,
  );
  assertEquals(error.code, ClientAssetErrorCode.ISLAND_UNMAPPED);
  assert(
    error.message.includes('open-callout'),
    `error must carry the island identity: ${error.message}`,
  );
});

Deno.test('buildClientAssetManifest maps delivery tags and export names onto one asset', () => {
  const manifest = buildClientAssetManifest({
    root: ROOT,
    base: '/',
    islands: [
      {
        entry: island({
          tagName: 'open-card',
          tags: ['open-card', 'open-card-panel'],
          exportNames: { 'open-card': 'OpenCard' },
        }),
        sourceFile: join(ROOT, 'app/islands/card.ts'),
      },
    ],
    viteManifest: {
      'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
      'app/islands/card.ts': { file: 'islands/island-card-AA11.js' },
    },
    chunks: [{
      fileName: 'islands/island-card-AA11.js',
      modules: { '/proj/app/islands/card.ts': {} },
    }],
    manifestPath: MANIFEST_PATH,
  });
  assertEquals(
    manifest.islands['open-card'],
    manifest.islands['open-card-panel'],
  );
});

// ─── Fail-closed: delivery-tag ownership is one-to-one ─────────────────

Deno.test('a delivery tag claimed by two islands fails even when both would ship the same asset', () => {
  // Same module, same chunk, same strategy — the duplicate is still a
  // duplicate: "the same answer twice" is not ownership, and a silent
  // overwrite would make the winner depend on the island list's order.
  const error = assertThrows(
    () =>
      buildClientAssetManifest({
        root: ROOT,
        base: '/',
        islands: [
          { entry: island(), sourceFile: join(ROOT, 'app/islands/counter.ts') },
          {
            entry: island({ modulePath: '/app/islands/counter.ts' }),
            sourceFile: join(ROOT, 'app/islands/counter.ts'),
          },
        ],
        viteManifest: {
          'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
          'app/islands/counter.ts': { file: 'islands/island-counter-Ab12.js' },
        },
        chunks: [{
          fileName: 'islands/island-counter-Ab12.js',
          modules: { '/proj/app/islands/counter.ts': {} },
        }],
        manifestPath: MANIFEST_PATH,
      }),
    OpenElementError,
  );
  assertEquals(error.code, ClientAssetErrorCode.ISLAND_TAG_DUPLICATE);
  assert(
    error.message.includes('open-counter'),
    `error names the contested tag: ${error.message}`,
  );
});

Deno.test('a delivery tag claimed by two islands fails across alias lists and strategies', () => {
  // open-card-panel is delivered by open-card's alias list AND declared by
  // another island with a different strategy and chunk — the claim itself
  // fails, whatever asset or strategy each side would resolve to.
  const error = assertThrows(
    () =>
      buildClientAssetManifest({
        root: ROOT,
        base: '/',
        islands: [
          {
            entry: island({
              tagName: 'open-card',
              modulePath: '/app/islands/card.ts',
              tags: ['open-card', 'open-card-panel'],
              strategy: 'load',
            }),
            sourceFile: join(ROOT, 'app/islands/card.ts'),
          },
          {
            entry: island({
              tagName: 'open-card-panel',
              modulePath: '/app/islands/panel.ts',
              strategy: 'visible',
            }),
            sourceFile: join(ROOT, 'app/islands/panel.ts'),
          },
        ],
        viteManifest: {
          'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
          'app/islands/card.ts': { file: 'islands/island-card-AA11.js' },
          'app/islands/panel.ts': { file: 'islands/island-panel-BB22.js' },
        },
        chunks: [{
          fileName: 'islands/island-card-AA11.js',
          modules: { '/proj/app/islands/card.ts': {} },
        }, {
          fileName: 'islands/island-panel-BB22.js',
          modules: { '/proj/app/islands/panel.ts': {} },
        }],
        manifestPath: MANIFEST_PATH,
      }),
    OpenElementError,
  );
  assertEquals(error.code, ClientAssetErrorCode.ISLAND_TAG_DUPLICATE);
  assert(
    error.message.includes('open-card-panel') &&
      error.message.includes('/app/islands/card.ts') &&
      error.message.includes('/app/islands/panel.ts'),
    `error names the tag and both claimants: ${error.message}`,
  );
});

Deno.test('buildClientAssetManifest lists shared chunks sorted, excluding entry and island chunks', () => {
  const manifest = buildClientAssetManifest({
    root: ROOT,
    base: '/',
    islands: [{ entry: island(), sourceFile: join(ROOT, 'app/islands/counter.ts') }],
    viteManifest: {
      'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
      'app/islands/counter.ts': { file: 'islands/island-counter-BB22.js' },
      'node_modules/.deno/preact@10/dist.js': { file: 'islands/preact-CC33.js' },
      'node_modules/.deno/lit@3/core.js': { file: 'islands/lit-runtime-DD44.js' },
      'app/styles.css': { file: 'assets/styles-EE55.css' },
    },
    chunks: [{
      fileName: 'islands/island-counter-BB22.js',
      modules: { '/proj/app/islands/counter.ts': {} },
    }],
    manifestPath: MANIFEST_PATH,
  });
  assertEquals(manifest.shared, [
    '/client/islands/lit-runtime-DD44.js',
    '/client/islands/preact-CC33.js',
  ]);
});

Deno.test('buildClientAssetManifest falls back to the entry chunk when an island has no chunk', () => {
  const manifest = buildClientAssetManifest({
    root: ROOT,
    base: '/',
    islands: [{ entry: island(), sourceFile: join(ROOT, 'app/islands/counter.ts') }],
    viteManifest: {
      'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
    },
    chunks: [{ fileName: 'islands/client.js', modules: {} }],
    manifestPath: MANIFEST_PATH,
  });
  assertEquals(manifest.islands['open-counter'].file, '/client/islands/client.js');
});

// ─── Fail-closed: the manifest the join requires (#1471, alpha6 T1) ─────

Deno.test('buildClientAssetManifest fails when the manifest records no client entry', () => {
  // An admitted island with no "virtual:open-client-entry" record: Phase 2
  // fails instead of shipping entry: '' and dropping the island silently.
  const error = assertThrows(
    () =>
      buildClientAssetManifest({
        root: ROOT,
        base: '/',
        islands: [{ entry: island(), sourceFile: join(ROOT, 'app/islands/counter.ts') }],
        viteManifest: {
          'app/islands/counter.ts': { file: 'islands/island-counter-Ab12.js' },
        },
        chunks: [],
        manifestPath: MANIFEST_PATH,
      }),
    OpenElementError,
  );
  assertEquals(error.code, ClientAssetErrorCode.ENTRY_MISSING);
  assert(error.message.includes(MANIFEST_PATH), `error names the manifest: ${error.message}`);
  assert(
    error.message.includes('virtual:open-client-entry'),
    `error names the missing record: ${error.message}`,
  );
});

Deno.test('enhanced-forms-only fails when the manifest records no client entry', () => {
  // #569: an island-free app with data-open-enhance forms still needs the
  // client entry — its absence fails instead of shipping entry: ''.
  const error = assertThrows(
    () =>
      buildClientAssetManifest({
        root: ROOT,
        base: '/',
        islands: [],
        viteManifest: {},
        chunks: [],
        manifestPath: MANIFEST_PATH,
      }),
    OpenElementError,
  );
  assertEquals(error.code, ClientAssetErrorCode.ENTRY_MISSING);
  assert(error.message.includes(MANIFEST_PATH), `error names the manifest: ${error.message}`);
});

Deno.test('admitted island without a chunk mapping fails instead of being dropped', () => {
  // The old code `continue`d past an island whose identity mapped to no
  // emitted module (and no entry fallback) — now the island identity and
  // the reason are named and Phase 2 fails.
  const error = assertThrows(
    () =>
      buildClientAssetManifest({
        root: ROOT,
        base: '/',
        islands: [{
          entry: island({
            tagName: 'open-callout',
            modulePath: '@acme/ui/open-callout',
            isPackage: true,
          }),
          sourceFile: null,
        }],
        viteManifest: {
          'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
        },
        chunks: [{ fileName: 'islands/client.js', modules: {} }],
        manifestPath: MANIFEST_PATH,
      }),
    OpenElementError,
  );
  assertEquals(error.code, ClientAssetErrorCode.ISLAND_UNMAPPED);
  assert(
    error.message.includes('open-callout'),
    `error carries the island identity: ${error.message}`,
  );
  assert(
    error.message.includes('@acme/ui/open-callout'),
    `error carries the declared identity: ${error.message}`,
  );
});

// ─── Fail-closed: package island identity is exact (#1471, alpha6 T2) ───

Deno.test('two packages shipping the same-named relative module fail as ambiguous', () => {
  // @acme/ui and @other/ui both declare `open-callout.js`; the graph emits
  // both files. Neither island can claim one of them — the build fails
  // naming the identity and every candidate module.
  const error = assertThrows(
    () =>
      buildClientAssetManifest({
        root: ROOT,
        base: '/',
        islands: [
          {
            entry: island({
              tagName: 'open-a',
              modulePath: 'open-callout.js',
              isPackage: true,
            }),
            sourceFile: null,
          },
          {
            entry: island({
              tagName: 'open-b',
              modulePath: 'open-callout.js',
              isPackage: true,
            }),
            sourceFile: null,
          },
        ],
        viteManifest: {
          'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
        },
        chunks: [
          {
            fileName: 'islands/island-open-a-Aa11.js',
            modules: { '/proj/node_modules/@acme/ui/open-callout.js': {} },
          },
          {
            fileName: 'islands/island-open-b-Bb22.js',
            modules: { '/proj/node_modules/@other/ui/open-callout.js': {} },
          },
        ],
        manifestPath: MANIFEST_PATH,
      }),
    OpenElementError,
  );
  assertEquals(error.code, ClientAssetErrorCode.ISLAND_IDENTITY_AMBIGUOUS);
  assert(
    error.message.includes('open-callout.js'),
    `error carries the declared identity: ${error.message}`,
  );
  assert(
    error.message.includes('@acme/ui/open-callout.js') &&
      error.message.includes('@other/ui/open-callout.js'),
    `error carries every candidate module: ${error.message}`,
  );
});

Deno.test('packageIslandChunkName groups by the same identity rule the resolver joins on', () => {
  const islands = [{ tagName: 'open-callout', identity: '@acme/ui/open-callout' }];
  // Extensionless declared specifier ↔ emitted id with extension.
  assertEquals(
    packageIslandChunkName('/proj/node_modules/@acme/ui/open-callout.js', islands),
    'island-open-callout',
  );
  // A module at a different path is a different module even when its file
  // name ends with the same basename.
  assertEquals(
    packageIslandChunkName('/proj/node_modules/@acme/ui/other/open-callout.js', islands),
    undefined,
  );
  // An unrelated module joins no island chunk.
  assertEquals(packageIslandChunkName('/proj/app/islands/counter.ts', islands), undefined);
  // Islands sharing one identity (one capability module, several tags) share
  // the chunk instead of failing it.
  assertEquals(
    packageIslandChunkName('/proj/node_modules/@acme/ui/open-callout.js', [
      { tagName: 'open-a', identity: '@acme/ui/open-callout' },
      { tagName: 'open-b', identity: '@acme/ui/open-callout' },
    ]),
    'island-open-a',
  );
  // Two distinct identities claiming one module fail closed.
  const error = assertThrows(
    () =>
      packageIslandChunkName('/proj/node_modules/@acme/ui/open-callout.js', [
        { tagName: 'open-a', identity: 'ui/open-callout' },
        { tagName: 'open-b', identity: '@acme/ui/open-callout' },
      ]),
    OpenElementError,
  );
  assertEquals(error.code, ClientAssetErrorCode.ISLAND_IDENTITY_AMBIGUOUS);
});

Deno.test('moduleIdentityMatches is segment-exact and extension-insensitive', () => {
  const matches = moduleIdentityMatches;
  assert(matches('/proj/node_modules/@acme/ui/open-callout.js', '@acme/ui/open-callout'));
  assert(matches('/proj/node_modules/@acme/ui/open-callout.js', 'open-callout.js'));
  assert(matches('/proj/src/open-card.tsx', '/proj/src/open-card.tsx'));
  // Segment boundary: a longer basename is a different module.
  assert(!matches('/proj/node_modules/@acme/ui/my-open-callout.js', 'open-callout.js'));
  // Path boundary: a longer tail is a different module.
  assert(!matches('/proj/node_modules/@acme/ui/open-callout/extra.js', 'open-callout.js'));
  // Query suffixes never leak into the comparison.
  assert(matches('/proj/src/counter.ts?commonjs-exports', 'counter.ts'));
});

Deno.test('serializeClientAssetsModule emits pure structured data', () => {
  const module = serializeClientAssetsModule({
    entry: '/client/islands/client.js',
    islands: { 'open-counter': { file: '/client/islands/island-counter.js', strategy: 'idle' } },
    shared: ['/client/islands/preact.js'],
  });
  assertEquals(
    module.includes('export const clientAssets = '),
    true,
    'named data export, no injection logic',
  );
  assertEquals(module.includes('clientScriptSrc'), false);
  // The emitted module evaluates to the manifest record it was built from.
  // (A `new Function` harness cannot carry import/export — same accommodation
  // as the ADR-0160 S3a entry records for the string-eval harnesses.)
  const body = module.replace('export const clientAssets', 'const clientAssets');
  const value = new Function(`${body}; return clientAssets;`)();
  assertEquals(value, {
    entry: '/client/islands/client.js',
    islands: { 'open-counter': { file: '/client/islands/island-counter.js', strategy: 'idle' } },
    shared: ['/client/islands/preact.js'],
  });
  assertEquals(EMPTY_CLIENT_ASSET_MANIFEST, { entry: '', islands: {}, shared: [] });
});
