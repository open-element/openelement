/**
 * @openelement/router - ssg-asset-manifest.test.ts (#1471 item 6, S4b)
 *
 * The nine-scenario matrix for manifest-driven client asset injection
 * (ADR-0160 rule d): chunk hashes change, chunk file names change (Rolldown
 * default and manualChunks naming), manualChunks off, shared chunks appear,
 * an island without its own chunk rides the client entry, several islands
 * share one chunk, native and lit both render the tag at document time, and
 * an enhanced-forms-only project with zero islands still gets the entry.
 *
 * The load-bearing scenario is the FILE NAME one: island identity (the
 * delivery tag) must never drift when an output chunk is renamed or
 * rehashed. Identity is joined at build time on module ids — no code parses
 * chunk file names — so every scenario here re-proves the same invariant
 * from a different angle: the tag maps through the manifest record, and the
 * document renderer emits the final script tag at render time.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { wrapInDocument } from '@openelement/element';
import { resolvePageDocument } from '../src/document.ts';
import type { PagePropsContext } from '../src/index.ts';
import { buildClientAssetManifest } from '../src/vite/client-asset-manifest.ts';
import type {
  ClientBuildChunk,
  ViteClientManifestEntry,
} from '../src/vite/client-asset-manifest.ts';
import type { ClientAssetManifest } from '@openelement/protocol/client-assets';
import {
  islandChunkMapFromAssetManifest,
  postProcessClientIslandBuild,
} from '../src/vite/internal/ssg/build-postprocess.ts';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderEntry } from '../src/vite/internal/ssg/entry-orchestrator.ts';
import type { RouteEntry } from '@openelement/protocol/framework';
import type { ClientIslandDeliveryEntry } from '../src/vite/internal/ssg/delivery.ts';

const ROOT = '/proj';
const BASE = '/';
const MANIFEST_PATH = '/proj/dist/client/.vite/manifest.json';

function island(overrides: Partial<ClientIslandDeliveryEntry> = {}): ClientIslandDeliveryEntry {
  return {
    tagName: 'open-counter',
    modulePath: '/app/islands/counter.ts',
    strategy: 'idle',
    ...overrides,
  };
}

function input(
  overrides: Partial<ClientIslandDeliveryEntry> = {},
  sourceFile: string | null = join(ROOT, 'app/islands/counter.ts'),
) {
  return { entry: island(overrides), sourceFile };
}

/** The client-entry manifest record every scenario's build carries. */
const ENTRY_RECORD: [string, ViteClientManifestEntry] = [
  'virtual:open-client-entry',
  { file: 'islands/client.js', isEntry: true },
];

function manifest(
  islands: ClientAssetIslandLike[],
  viteManifest: Record<string, ViteClientManifestEntry>,
  chunks: ClientBuildChunk[],
): ClientAssetManifest {
  return buildClientAssetManifest({
    root: ROOT,
    base: BASE,
    islands,
    viteManifest,
    chunks,
    manifestPath: MANIFEST_PATH,
  });
}

type ClientAssetIslandLike = ReturnType<typeof input>;

function ctx(overrides: Partial<PagePropsContext> = {}): PagePropsContext {
  return {
    data: undefined,
    actionData: undefined,
    params: {},
    route: { path: '/' },
    meta: {},
    ...overrides,
  };
}

/** The document-renderer step the generated entries run (#1471). */
function renderDocument(doc: ReturnType<typeof resolvePageDocument>): string {
  return wrapInDocument('<open-counter></open-counter>', {
    title: doc.title,
    lang: doc.lang,
    links: doc.links,
    structuredData: doc.structuredData || [],
    scripts: doc.clientScripts || [],
  });
}

/** The generated wiring both renderer adapters emit (asserted per mode). */
function assertDocumentTimeInjection(code: string): void {
  expect(code).toContain(
    'const __doc = __resolvePageDocument(__page.head, __pageContext, __clientScriptDescriptors());',
  );
  expect(code).toContain('scripts: __doc.clientScripts || [],');
  // No post-build script surgery may reappear.
  expect(
    !code.includes('insertBeforeBodyClose'),
    'no HTML surgery in generated entries',
  ).toBeTruthy();
}

/** One end-to-end document render carrying the manifest-driven script. */
function assertScriptAtBodyEnd(html: string, src: string): void {
  const tag = `<script type="module" src="${src}"></script>`;
  expect(html).toContain(tag);
  // Correct position: the tag is the last markup before the body close —
  // the same slot the retired post-build injector spliced into.
  expect(
    html.endsWith(`${tag}\n</body>\n</html>`),
    `script tag must sit immediately before </body>, got: ...${html.slice(-120)}`,
  ).toBeTruthy();
}

// ─── 1. chunk hash 变 ─────────────────────────────────────────────────

test('matrix 1 — a content-hash change re-keys the tag to the new asset, identity intact', () => {
  const modules = { [`${ROOT}/app/islands/counter.ts`]: {} };
  const before = manifest(
    [input()],
    {
      ...Object.fromEntries([ENTRY_RECORD]),
      'app/islands/counter.ts': { file: 'islands/island-counter-Ab12cd.js' },
    },
    [
      {
        fileName: 'islands/island-counter-Ab12cd.js',
        facadeModuleId: `${ROOT}/app/islands/counter.ts`,
        modules,
      },
    ],
  );
  expect(before.islands['open-counter'].file).toEqual('/client/islands/island-counter-Ab12cd.js');

  // The next build rehashes the chunk (content changed). Same module id,
  // different output name — the tag follows the module, not the name.
  const after = manifest(
    [input()],
    {
      ...Object.fromEntries([ENTRY_RECORD]),
      'app/islands/counter.ts': { file: 'islands/island-counter-Xy98wa.js' },
    },
    [
      {
        fileName: 'islands/island-counter-Xy98wa.js',
        facadeModuleId: `${ROOT}/app/islands/counter.ts`,
        modules,
      },
    ],
  );
  expect(after.islands['open-counter'].file).toEqual('/client/islands/island-counter-Xy98wa.js');
  expect(after.islands['open-counter'].strategy).toEqual('idle');

  // The rendered document carries the fresh address at render time.
  const doc = resolvePageDocument(undefined, ctx(), [{ type: 'module', src: after.entry }]);
  assertScriptAtBodyEnd(renderDocument(doc), after.entry);
});

// ─── 2. chunk 文件名变（身份不随文件名漂移 —— 本段的立段之本） ──────────

test('matrix 2a — Rolldown default naming: a full rename cannot move the tag identity', () => {
  // Rolldown names the chunk after the source basename; the build then
  // renames it (chunk grouping change) to a name sharing NOTHING with the
  // tag. The retired filename-prefix matcher would have dropped or
  // misattributed this chunk; the manifest join on module ids cannot drift.
  const modules = { [`${ROOT}/app/islands/counter.ts`]: {} };
  const renamed = manifest(
    [input()],
    {
      ...Object.fromEntries([ENTRY_RECORD]),
      'app/islands/counter.ts': { file: 'islands/chunk-9f3e2a.js' },
    },
    [
      {
        fileName: 'islands/chunk-9f3e2a.js',
        facadeModuleId: `${ROOT}/app/islands/counter.ts`,
        modules,
      },
    ],
  );
  expect(renamed.islands['open-counter'].file).toEqual('/client/islands/chunk-9f3e2a.js');

  // The per-page island manifest (strategy/layer pass) reads the same record.
  const chunkMap = islandChunkMapFromAssetManifest(renamed, ['open-counter']);
  expect(chunkMap).toEqual({ 'open-counter': '/client/islands/chunk-9f3e2a.js' });
});

test('matrix 2b — manualChunks naming: renaming across naming schemes keeps the identity', () => {
  // manualChunks names the chunk island-<tag>; a later build moves the
  // module into a shared-manual chunk. Same module id, two naming schemes —
  // the tag maps correctly in both, and never picks up the other name's
  // identity.
  const modules = { [`${ROOT}/app/islands/counter.ts`]: {} };
  const manual = manifest(
    [input()],
    {
      ...Object.fromEntries([ENTRY_RECORD]),
      'app/islands/counter.ts': { file: 'islands/island-open-counter-Qq77.js' },
    },
    [
      {
        fileName: 'islands/island-open-counter-Qq77.js',
        facadeModuleId: `${ROOT}/app/islands/counter.ts`,
        modules,
      },
    ],
  );
  expect(manual.islands['open-counter'].file).toEqual(
    '/client/islands/island-open-counter-Qq77.js',
  );

  const shared = manifest(
    [input()],
    {
      ...Object.fromEntries([ENTRY_RECORD]),
      'app/islands/counter.ts': { file: 'islands/vendor-common-Ww22.js' },
    },
    [
      {
        fileName: 'islands/vendor-common-Ww22.js',
        facadeModuleId: `${ROOT}/app/islands/counter.ts`,
        modules,
      },
    ],
  );
  expect(shared.islands['open-counter'].file).toEqual('/client/islands/vendor-common-Ww22.js');
});

// ─── 3. manualChunks 关 ───────────────────────────────────────────────

test('matrix 3 — manualChunks off: default chunk naming keys through facade/module metadata', () => {
  // With manualChunks off, Rolldown's default names the chunk <basename>-<hash>
  // and the facade module id — not any naming convention — carries identity.
  const modules = { [`${ROOT}/app/islands/counter.ts`]: {} };
  const result = manifest(
    [
      input(
        { tagName: 'open-gadget', modulePath: '/app/islands/gadget.ts' },
        join(ROOT, 'app/islands/gadget.ts'),
      ),
    ],
    {
      ...Object.fromEntries([ENTRY_RECORD]),
      'app/islands/gadget.ts': { file: 'islands/gadget-Dd55.js' },
    },
    [
      {
        fileName: 'islands/gadget-Dd55.js',
        facadeModuleId: `${ROOT}/app/islands/gadget.ts`,
        modules,
      },
    ],
  );
  expect(result.islands['open-gadget'].file).toEqual('/client/islands/gadget-Dd55.js');
  expect(result.entry).toEqual('/client/islands/client.js');
  expect(result.shared).toEqual([]);
});

// ─── 4. 新增共享 chunk ────────────────────────────────────────────────

test('matrix 4 — a new shared chunk lands in shared[] and leaves island mappings untouched', () => {
  const modules = { [`${ROOT}/app/islands/counter.ts`]: {} };
  const before = manifest(
    [input()],
    {
      ...Object.fromEntries([ENTRY_RECORD]),
      'app/islands/counter.ts': { file: 'islands/island-counter-Ab12.js' },
    },
    [
      {
        fileName: 'islands/island-counter-Ab12.js',
        facadeModuleId: `${ROOT}/app/islands/counter.ts`,
        modules,
      },
    ],
  );

  // The next build extracts a vendor chunk (e.g. a new dependency).
  const after = manifest(
    [input()],
    {
      ...Object.fromEntries([ENTRY_RECORD]),
      'app/islands/counter.ts': { file: 'islands/island-counter-Ab12.js' },
      'node_modules/.pnpm/flexsearch@0.8/dist.js': { file: 'islands/flexsearch-Cc33.js' },
    },
    [
      {
        fileName: 'islands/island-counter-Ab12.js',
        facadeModuleId: `${ROOT}/app/islands/counter.ts`,
        modules,
      },
    ],
  );
  expect(after.islands).toEqual(before.islands);
  expect(after.shared).toEqual(['/client/islands/flexsearch-Cc33.js']);
});

// ─── 5. island 无独立 chunk（走 client.js 兜底） ──────────────────────

test('matrix 5 — an island without its own chunk rides the client entry fallback', () => {
  const result = manifest([input()], { ...Object.fromEntries([ENTRY_RECORD]) }, [
    { fileName: 'islands/client.js', modules: {} },
  ]);
  expect(result.islands['open-counter'].file).toEqual('/client/islands/client.js');

  // The document and the island manifest both resolve to the fallback URL.
  const doc = resolvePageDocument(undefined, ctx(), [{ type: 'module', src: result.entry }]);
  assertScriptAtBodyEnd(renderDocument(doc), '/client/islands/client.js');
  expect(islandChunkMapFromAssetManifest(result, ['open-counter'])).toEqual({
    'open-counter': '/client/islands/client.js',
  });
});

// ─── 6. 多 island 共 chunk ────────────────────────────────────────────

test('matrix 6 — islands sharing one chunk keep distinct identities', () => {
  // One chunk carries both modules: each delivery tag maps to the same file
  // through its own module id — no name parsing could tell them apart.
  const sharedChunk = {
    fileName: 'islands/pair-Ee66.js',
    facadeModuleId: null,
    modules: {
      [`${ROOT}/app/islands/counter.ts`]: {},
      [`${ROOT}/app/islands/theme.ts`]: {},
    },
  };
  const result = manifest(
    [
      input(),
      input(
        { tagName: 'open-theme', modulePath: '/app/islands/theme.ts' },
        join(ROOT, 'app/islands/theme.ts'),
      ),
    ],
    {
      ...Object.fromEntries([ENTRY_RECORD]),
      'app/islands/counter.ts': { file: 'islands/pair-Ee66.js' },
    },
    [sharedChunk, { fileName: 'islands/client.js', modules: {} }],
  );
  expect(result.islands['open-counter'].file).toEqual('/client/islands/pair-Ee66.js');
  expect(result.islands['open-theme'].file).toEqual('/client/islands/pair-Ee66.js');
  expect(result.islands['open-counter']).toEqual(result.islands['open-theme']);
  // Shared: the chunk is island-dedicated, so it is not double-listed.
  expect(result.shared).toEqual([]);
});

// ─── 7/8. native / lit ────────────────────────────────────────────────

const pageRoute: RouteEntry[] = [
  { path: '/', filePath: 'index.ts', type: 'page', varName: 'pageIndex' },
];

test('matrix 7 — native: every document channel renders the script tag at document time', () => {
  const nativeEntry = renderEntry(
    buildEntryDescriptor(pageRoute, { ssg: true, renderer: 'native' }),
  );
  assertDocumentTimeInjection(nativeEntry);

  // The resolved-document step the emitted wiring performs, driven for real:
  // the manifest's entry URL reaches the serializer as the final tag.
  const doc = resolvePageDocument(undefined, ctx(), [
    { type: 'module', src: '/client/islands/client.js' },
  ]);
  assertScriptAtBodyEnd(renderDocument(doc), '/client/islands/client.js');
});

test('matrix 8 — lit: same document-time injection over the lit adapter and package islands', () => {
  const litEntry = renderEntry(buildEntryDescriptor(pageRoute, { ssg: true, renderer: 'lit' }));
  assertDocumentTimeInjection(litEntry);

  // A lit project's island is typically a package module: identity joins on
  // the declared module-path fragment, never the chunk name.
  const result = manifest(
    [
      {
        entry: island({ tagName: 'open-callout', modulePath: 'open-callout.js' }),
        sourceFile: null,
      },
    ],
    { ...Object.fromEntries([ENTRY_RECORD]) },
    [
      {
        fileName: 'islands/island-open-callout-Bb44.js',
        facadeModuleId: null,
        modules: { [`${ROOT}/node_modules/@acme/ui/open-callout.js`]: {} },
      },
    ],
  );
  expect(result.islands['open-callout'].file).toEqual(
    '/client/islands/island-open-callout-Bb44.js',
  );

  const doc = resolvePageDocument(undefined, ctx(), [{ type: 'module', src: result.entry }]);
  assertScriptAtBodyEnd(renderDocument(doc), '/client/islands/client.js');
});

// ─── 9. 无 island + enhanced-forms-only ───────────────────────────────

test('matrix 9 — zero islands, enhanced-forms-only: the entry script still reaches the document', () => {
  // Phase 2 runs for enhanced forms too (#569), so the manifest carries an
  // entry and no island records; the document embeds the entry so the
  // enhance runtime can attach.
  const result = manifest([], { ...Object.fromEntries([ENTRY_RECORD]) }, [
    { fileName: 'islands/client.js', modules: {} },
  ]);
  expect(result.entry).toEqual('/client/islands/client.js');
  expect(result.islands).toEqual({});

  const doc = resolvePageDocument(undefined, ctx(), [{ type: 'module', src: result.entry }]);
  assertScriptAtBodyEnd(renderDocument(doc), '/client/islands/client.js');

  // The island-manifest pass records no islands for the page, without warning.
  const chunkMap = islandChunkMapFromAssetManifest(result, []);
  expect(chunkMap).toEqual({});
});

// ─── End-to-end: the SSG post-processing pass on a rendered tree ──────

test('matrix — postProcessClientIslandBuild honors the manifest on a real temp tree', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'open-matrix-'));
  try {
    const dist = join(tmp, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(
      join(dist, 'index.html'),
      '<html><body><open-counter></open-counter></body></html>',
    );
    const manifestRecord: ClientAssetManifest = {
      entry: '/client/islands/client.js',
      islands: {
        'open-counter': { file: '/client/islands/chunk-9f3e2a.js', strategy: 'idle' },
      },
      shared: [],
      styles: [],
    };
    await postProcessClientIslandBuild({
      phase3: { root: tmp, outDir: 'dist', base: '/', upgradeStrategy: 'idle' },
      phase1: {
        islandTagNames: ['open-counter'],
        islandFiles: ['counter.ts'],
        packageIslandDecls: [],
        compilerBehaviorDecls: [],
        islandMeta: {},
      },
      clientAssetManifest: manifestRecord,
    });
    const files = readdirSync(join(dist, 'island-manifests'), { withFileTypes: true }).map(
      (e) => e.name,
    );
    expect(files.length).toEqual(1);
    const pageManifest = JSON.parse(
      readFileSync(join(dist, 'island-manifests', files[0]), 'utf8'),
    ) as { islands: Array<{ tagName: string; chunkUrl: string }> };
    expect(pageManifest.islands[0].tagName).toEqual('open-counter');
    expect(pageManifest.islands[0].chunkUrl).toEqual('/client/islands/chunk-9f3e2a.js');
    // HTML untouched: scripts were embedded at render time, not spliced here.
    expect(readFileSync(join(dist, 'index.html'), 'utf8')).toEqual(
      '<html><body><open-counter></open-counter></body></html>',
    );
  } finally {
    await rm(tmp, { recursive: true });
  }
});

// ─── Document-seam validation for the descriptor channel ──────────────

test('matrix — clientScripts validation: malformed wiring fails loudly, empty lists omit the field', () => {
  // Framework wiring bugs must fail the render, not silently drop scripts.
  for (const bad of [
    [{}, 'must carry a src or an inline code body'],
    [{ src: '' }, 'src must be a non-empty string'],
    [{ src: 42 }, 'src must be a non-empty string'],
    [{ code: 7 }, 'code must be a string'],
    'not-an-object',
    null,
  ] as unknown[]) {
    assertThrowsClientScripts(bad);
  }
  // An empty descriptor list is meaningless presence: the field is omitted
  // so the resolved document keeps its exact script-free shape.
  expect(resolvePageDocument(undefined, ctx(), [])).toEqual({ links: [] });
});

function assertThrowsClientScripts(bad: unknown): void {
  let threw: unknown;
  try {
    resolvePageDocument(undefined, ctx(), [bad] as never);
  } catch (error) {
    threw = error;
  }
  expect(threw, `expected clientScripts ${JSON.stringify(bad)} to fail resolution`).toEqual(
    expect.anything(),
  );
  expect(
    String((threw as Error).message).includes('[openElement] resolvePageDocument:'),
    `unexpected error text: ${(threw as Error).message}`,
  ).toBeTruthy();
}
