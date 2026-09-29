import { assertEquals } from '@std/assert';
import { join } from '@std/path';
import {
  buildClientAssetManifest,
  collectClientBuildChunks,
  findClientEntryFile,
  readViteClientManifest,
} from '../src/vite/client-asset-manifest.ts';
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

Deno.test('findClientEntryFile reads the virtual client entry from the build manifest', () => {
  assertEquals(
    findClientEntryFile({
      'virtual:open-client-entry': { file: 'islands/client.js', isEntry: true },
      'app/islands/counter.ts': { file: 'islands/island-counter-Ab12.js', name: 'island-counter' },
    }),
    'islands/client.js',
  );
  assertEquals(findClientEntryFile({ 'app/islands/counter.ts': { file: 'islands/x.js' } }), null);
});

Deno.test('readViteClientManifest returns null for a missing or malformed manifest', async () => {
  assertEquals(await readViteClientManifest(join('/nonexistent', 'manifest.json')), null);
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, 'manifest.json');
    await Deno.writeTextFile(path, '{ not json');
    assertEquals(await readViteClientManifest(path), null);
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
  });
  assertEquals(manifest.entry, '/app/client/islands/client.js');
  assertEquals(manifest.islands['open-counter'].file, '/app/client/islands/island-counter-Qr56.js');
});

Deno.test('buildClientAssetManifest matches package islands by declared module-path fragment', () => {
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
  });
  assertEquals(
    manifest.islands['open-callout'].file,
    '/client/islands/island-open-callout-Zz00.js',
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
  });
  assertEquals(
    manifest.islands['open-card'],
    manifest.islands['open-card-panel'],
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
  });
  assertEquals(manifest.islands['open-counter'].file, '/client/islands/client.js');
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
