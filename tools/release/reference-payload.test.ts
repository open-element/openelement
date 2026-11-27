import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { Manifest } from 'vite';
import {
  BROWSER_ENTRY_GRAPH_ARTIFACT_FILE,
  BROWSER_ENTRY_GRAPH_KIND,
  BROWSER_ENTRY_GRAPH_SCHEMA_VERSION,
  type BrowserEntryGraphCore,
  browserEntryGraphGateListDigest,
  deriveBrowserEntryGraphSummary,
  executorEntryModuleIds,
} from '../../packages/router/src/vite/internal/browser-entry-graph-artifact.ts';
import type { PageIslandManifest } from '../../packages/router/src/vite/internal/ssg/island-manifest.ts';
import { clientImportGraph, payloadClosure } from './payload-closure.ts';
import {
  REFERENCE_GZIP_LIMITS,
  referencePayloadFailures,
  referencePayloadUrls,
} from './reference-payload.ts';

const viteManifest: Manifest = {
  entry: {
    file: 'client.js',
    imports: ['runtime', 'helper'],
    dynamicImports: ['runtime', 'counter', 'timer', 'settings'],
  },
  runtime: { file: 'runtime.js' },
  helper: { file: 'helper.js' },
  counter: { file: 'counter.js', imports: ['runtime', 'adapter'], dynamicImports: ['controls'] },
  timer: { file: 'timer.js', imports: ['runtime', 'adapter'] },
  settings: { file: 'settings.js', imports: ['runtime'] },
  adapter: { file: 'adapter.js' },
  controls: { file: 'controls.js', imports: ['adapter'], dynamicImports: ['counter'] },
};

const browser = {
  entry: { moduleId: '\0virtual:open-client-entry', chunkFile: 'client.js' },
  islands: [
    { tag: 'my-counter', chunkFile: 'counter.js' },
    { tag: 'live-timer', chunkFile: 'timer.js' },
    { tag: 'settings-panel', chunkFile: 'settings.js' },
  ],
};

const html = `<!doctype html><link rel="modulepreload" href="/client/runtime.js">
<script type="application/json">{"example":true}</script>
<script type="module" src="/client/client.js"></script>`;

const page: Pick<PageIslandManifest, 'islands'> = {
  islands: [
    {
      tagName: 'my-counter',
      chunkUrl: '/client/counter.js',
      strategy: 'idle',
      layer: 'dsd-interactive',
    },
    { tagName: 'live-timer', chunkUrl: '/client/timer.js', strategy: 'only', layer: 'pure-island' },
  ],
};

describe('Client payload closure', () => {
  test('the Site-style static closure only follows eager imports and deduplicates shared files', () => {
    const closure = payloadClosure(clientImportGraph(viteManifest), [
      '/client/client.js',
      '/client/counter.js',
    ]);
    expect(closure).toEqual(
      new Set([
        '/client/client.js',
        '/client/runtime.js',
        '/client/helper.js',
        '/client/counter.js',
        '/client/adapter.js',
      ]),
    );
  });

  test('accounts for eager and deferred page bytes once and excludes other routes', () => {
    const urls = referencePayloadUrls(viteManifest, browser, html, page);
    expect(urls.shared).toEqual(
      new Set([
        '/client/client.js',
        '/client/runtime.js',
        '/client/helper.js',
        '/client/adapter.js',
      ]),
    );
    expect(urls.referenceIsland).toEqual(new Set(['/client/counter.js', '/client/controls.js']));
    expect(urls.referenceWithShared).toEqual(
      new Set([
        '/client/counter.js',
        '/client/controls.js',
        '/client/runtime.js',
        '/client/adapter.js',
      ]),
    );
    expect(urls.home).toEqual(
      new Set([...urls.shared, ...urls.referenceIsland, '/client/timer.js']),
    );
  });

  test.each(['</ScRiPt \t\n\f\r>', '</script/>', '</script data-note="1 > 0">'])(
    'accounts for external scripts and rejects inline code ending with %j',
    (endTag) => {
      const baseline = referencePayloadUrls(viteManifest, browser, html, page);
      const manifest = { ...viteManifest, preload: { file: 'preload.js' } };
      const external = `${html}<script src="/client/settings.js">${endTag}
<link rel="modulepreload" href="/client/preload.js">`;
      expect(referencePayloadUrls(manifest, browser, external, page).home).toEqual(
        new Set([...baseline.home, '/client/settings.js', '/client/preload.js']),
      );
      const inline = `${html}<script>void 0;${endTag}`;
      expect(() => referencePayloadUrls(viteManifest, browser, inline, page)).toThrow(
        'Reference home has executable inline JavaScript',
      );
    },
  );

  test('rejects a missing Vite edge and a stale page manifest', () => {
    const missingControls = { ...viteManifest };
    delete missingControls.controls;
    expect(() => referencePayloadUrls(missingControls, browser, html, page)).toThrow(
      'Client manifest import target missing: counter -> controls',
    );
    const staleBrowser = { ...browser, islands: browser.islands.slice(1) };
    expect(() => referencePayloadUrls(viteManifest, staleBrowser, html, page)).toThrow(
      'Reference home island is missing from the client graph: my-counter',
    );
  });

  test('ignores same-size raw/Brotli values and fails above each fixed gzip limit', () => {
    const bytes = (gzip: number) => ({ raw: 100_000, gzip, brotli: 20_000 });
    const totals = {
      sharedRuntime: bytes(REFERENCE_GZIP_LIMITS.sharedRuntime),
      referenceIsland: bytes(REFERENCE_GZIP_LIMITS.referenceIsland),
      home: bytes(REFERENCE_GZIP_LIMITS.home),
    };
    expect(referencePayloadFailures(totals)).toEqual([]);
    for (const metric of Object.keys(totals) as Array<keyof typeof totals>) {
      expect(
        referencePayloadFailures({ ...totals, [metric]: bytes(totals[metric].gzip + 1) }),
      ).toEqual([
        `${metric}: ${totals[metric].gzip + 1} B gzip exceeds ${totals[metric].gzip} B by 1 B`,
      ]);
    }
  });
});

test('packed starter checker reads emitted files and exits red when a shared file grows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-reference-payload-'));
  try {
    const dist = join(root, 'my-blog', 'dist');
    const client = join(dist, 'client');
    const manifestDir = join(dist, 'island-manifests');
    await Promise.all([
      mkdir(join(client, '.vite'), { recursive: true }),
      mkdir(manifestDir, { recursive: true }),
    ]);
    const islands = browser.islands.map((island) => ({
      ...island,
      specifier: `./app/islands/${island.tag}.tsx`,
      moduleId: `app/islands/${island.tag}.tsx`,
      strategy: 'load',
    }));
    const core: BrowserEntryGraphCore = {
      schemaVersion: BROWSER_ENTRY_GRAPH_SCHEMA_VERSION,
      kind: BROWSER_ENTRY_GRAPH_KIND,
      status: 'complete',
      producer: { package: '@openelement/router', version: '0.0.0-reference-test' },
      app: { root: '.', outDir: 'dist/client', base: '/' },
      element: {
        packageRoot: 'node_modules/@openelement/element',
        version: '0.0.0-reference-test',
      },
      ...browser,
      islands,
      chunks: Object.values(viteManifest).map((chunk) => {
        const island = islands.find((candidate) => candidate.chunkFile === chunk.file);
        const isEntry = chunk.file === browser.entry.chunkFile;
        const module = isEntry ? browser.entry.moduleId : island?.moduleId;
        return {
          file: chunk.file,
          isEntry,
          isDynamicEntry: !!island,
          facadeModuleId: module ?? null,
          imports: (chunk.imports ?? []).map((key) => viteManifest[key].file),
          dynamicImports: (chunk.dynamicImports ?? []).map((key) => viteManifest[key].file),
          implicitlyLoadedBefore: [],
          modules: module ? [{ id: module, renderedLength: 14 }] : [],
        };
      }),
      parsedModuleIds: [browser.entry.moduleId, ...islands.map((island) => island.moduleId)],
    };
    const artifact = {
      ...core,
      predicate: {
        ...deriveBrowserEntryGraphSummary(core),
        gateListDigest: browserEntryGraphGateListDigest(),
        executorEntry: executorEntryModuleIds(core.element.packageRoot),
      },
    };
    await Promise.all([
      writeFile(join(client, '.vite/manifest.json'), JSON.stringify(viteManifest)),
      writeFile(join(client, BROWSER_ENTRY_GRAPH_ARTIFACT_FILE), JSON.stringify(artifact)),
      writeFile(join(dist, 'index.html'), html),
      writeFile(join(manifestDir, 'home.json'), JSON.stringify({ route: '/', ...page })),
      ...Object.values(viteManifest).map(({ file }) => writeFile(join(client, file), 'export {};')),
    ]);
    const run = () =>
      spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./check-reference-payload.ts', import.meta.url))],
        { env: { ...process.env, STARTER_SMOKE_WORK_DIR: root }, encoding: 'utf8' },
      );
    const pass = run();
    expect(pass.stderr).toBe('');
    expect(pass.status).toBe(0);
    expect(JSON.parse(pass.stdout).totals.home.raw).toBe(7 * 'export {};'.length);
    await writeFile(
      join(client, 'runtime.js'),
      Buffer.concat(
        Array.from({ length: 160 }, (_, index) =>
          createHash('sha256').update(String(index)).digest(),
        ),
      ),
    );
    const fail = run();
    expect(fail.status).toBe(1);
    expect(fail.stderr).toMatch(/sharedRuntime: \d+ B gzip exceeds 4500 B/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
