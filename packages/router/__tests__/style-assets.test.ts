/**
 * @openelement/router — the island style asset protocol's intercepting plugin
 * (ADR-0164, #1553 production lane).
 *
 * Unit coverage of the router-side seam: the fail-closed intercept of the
 * compiler's `.oe-style.css` requests, the client build's `.css` emission
 * (content-hashed file name, verbatim bytes, emission records), the sheet
 * adapter forms (fetch + TLA today; the native form behind the recorded
 * capability verdict), and the SSR half's same-asset read with the recorded
 * hash reconciliation. The real-build consumer form — island JS without
 * component CSS text, the emitted asset, the manifest styles field,
 * multi-island reuse — is pinned by style-asset-build.test.ts.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, expect, test } from 'vitest';
import {
  clearStyleRequests,
  registerStyleRequest,
  styleRequestModuleId,
} from '@openelement/element/compiler';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { OpenElementError } from '@openelement/element';
import { ClientBuildErrorCode } from '../src/internal/error-codes.ts';
import {
  type StyleAssetRecord,
  clientStyleAssetPlugin,
  devStyleAssetPlugin,
  fetchSheetAdapterModule,
  nativeSheetAdapterModule,
  serverStyleAssetPlugin,
  sheetAdapterForm,
  styleAssetFileName,
  styleAssetGraphId,
  styleAssetHash,
  styleAssetRegistryKey,
} from '../src/vite/internal/style-assets.ts';

const IMPORTER = '/proj/app/islands/open-layout.tsx';
const REGISTRY_KEY = styleRequestModuleId(IMPORTER, './open-layout.oe-style.css');
const SHEET = ':host { display: block; }\n.open-layout { color: red; }\n';

interface EmittedAsset {
  fileName: string;
  source: string;
}

/** A hook harness: the plugin context shape the hooks actually touch. */
function harness(emitted: EmittedAsset[]) {
  return {
    emitFile(file: { type: string; fileName: string; source: string }): string {
      emitted.push({ fileName: file.fileName, source: file.source });
      return `ref-${emitted.length}`;
    },
  };
}

function serverLoad(
  records: ReadonlyMap<string, StyleAssetRecord>,
  clientOutDir: string,
  graphId: string,
): Promise<string | null> {
  const plugin = serverStyleAssetPlugin({ styleAssets: records, clientOutDir });
  const load = plugin.load as (this: unknown, id: string) => Promise<string | null>;
  return load.call({}, graphId);
}

beforeEach(() => {
  clearStyleRequests();
  registerStyleRequest({
    tag: 'open-layout',
    specifier: './open-layout.oe-style.css',
    css: SHEET,
    moduleId: REGISTRY_KEY,
    importer: IMPORTER,
  });
});

afterEach(() => {
  clearStyleRequests();
});

test('graph ids round-trip the registry key behind a JS-typed virtual id', () => {
  const graphId = styleAssetGraphId(REGISTRY_KEY);
  // The id must not end with the reserved suffix: the toolchain infers the
  // module type from the extension, and a .css-suffixed id is processed as a
  // CSS module — the load result is ignored (reproduced MISSING_EXPORT).
  expect(graphId.endsWith('.oe-style.css')).toBe(false);
  expect(graphId.endsWith('.js')).toBe(true);
  expect(styleAssetRegistryKey(graphId)).toEqual(REGISTRY_KEY);
  expect(styleAssetRegistryKey('./open-layout.oe-style.css')).toBeUndefined();
});

test('the client plugin resolves registered requests and leaves everything else alone', () => {
  const plugin = clientStyleAssetPlugin(new Map<string, StyleAssetRecord>());
  const resolveId = plugin.resolveId as (
    this: unknown,
    source: string,
    importer?: string,
  ) => string | null;
  expect(resolveId.call({}, './open-layout.oe-style.css', IMPORTER)).toEqual(
    styleAssetGraphId(REGISTRY_KEY),
  );
  // Non-request specifiers pass through untouched.
  expect(resolveId.call({}, './open-layout.css', IMPORTER)).toEqual(null);
  expect(resolveId.call({}, './styles.css', IMPORTER)).toEqual(null);
});

test('the client plugin fails closed on a request with no registered payload', () => {
  const plugin = clientStyleAssetPlugin(new Map<string, StyleAssetRecord>());
  const resolveId = plugin.resolveId as (
    this: unknown,
    source: string,
    importer?: string,
  ) => string | null;
  // A hand-written import of the reserved suffix: no payload channel exists.
  const error = assertThrowsIncludes(
    () => resolveId.call({}, './rogue.oe-style.css', IMPORTER),
    OpenElementError,
  );
  expect(error.code).toEqual(ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED);
  // An importer-less request has no registry key to answer with.
  const noImporter = assertThrowsIncludes(
    () => resolveId.call({}, './open-layout.oe-style.css'),
    OpenElementError,
  );
  expect(noImporter.code).toEqual(ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED);
});

test('the client build emits the verbatim sheet under a content-hashed file name', () => {
  const emitted: EmittedAsset[] = [];
  const records = new Map<string, StyleAssetRecord>();
  const plugin = clientStyleAssetPlugin(records);
  const load = plugin.load as (
    this: { emitFile(file: unknown): string },
    id: string,
  ) => string | null;
  load.call(harness(emitted), styleAssetGraphId(REGISTRY_KEY));

  expect(emitted).toHaveLength(1);
  // The artifact owner is the client build; the bytes are the request's own
  // CSS, verbatim — the DSD text and the runtime replace() text derive from
  // exactly these bytes.
  expect(emitted[0].source).toEqual(SHEET);
  expect(emitted[0].fileName).toEqual(styleAssetFileName(SHEET));
  expect(emitted[0].fileName).toMatch(/^assets\/[0-9a-f]{12}\.css$/);
  expect(records.get(REGISTRY_KEY)).toEqual({
    fileName: emitted[0].fileName,
    hash: styleAssetHash(SHEET),
  });
});

test('identical sheet bytes deduplicate into one emission (multi-island reuse)', () => {
  // A second island module carries the same sheet: a distinct registry key,
  // the same content hash — one emitted asset, one URL, two adapters.
  const otherImporter = '/proj/app/islands/open-dock.tsx';
  const otherKey = styleRequestModuleId(otherImporter, './open-dock.oe-style.css');
  registerStyleRequest({
    tag: 'open-dock',
    specifier: './open-dock.oe-style.css',
    css: SHEET,
    moduleId: otherKey,
    importer: otherImporter,
  });
  const emitted: EmittedAsset[] = [];
  const records = new Map<string, StyleAssetRecord>();
  const plugin = clientStyleAssetPlugin(records);
  const load = plugin.load as (
    this: { emitFile(file: unknown): string },
    id: string,
  ) => string | null;
  const first = load.call(harness(emitted), styleAssetGraphId(REGISTRY_KEY));
  const second = load.call(harness(emitted), styleAssetGraphId(otherKey));
  expect(emitted).toHaveLength(1);
  expect(records.get(otherKey)).toEqual(records.get(REGISTRY_KEY));
  // Both adapters reference the same build-global file-URL reference, which
  // the bundler rewrites to the same hashed asset URL in each chunk.
  const firstUrl = /import\.meta\.ROLLUP_FILE_URL_(\w+)/.exec(first)?.[1];
  const secondUrl = /import\.meta\.ROLLUP_FILE_URL_(\w+)/.exec(second)?.[1];
  expect(secondUrl).toEqual(firstUrl);
});

test('the fetch adapter exports the sheet, TLA-guarded, with no document.head', () => {
  const adapter = fetchSheetAdapterModule('ref-1');
  expect(adapter).toContain('import.meta.ROLLUP_FILE_URL_ref-1');
  expect(adapter).toContain('await fetch(sheetUrl)');
  expect(adapter).toContain('await sheet.replace(await response.text())');
  expect(adapter).toContain('export default sheet;');
  // No document-head sink of any kind: the adapter's only CSS channel is the
  // constructable sheet it exports.
  expect(adapter).not.toContain('appendChild');
  expect(adapter).not.toContain("createElement('style')");
  expect(adapter).not.toContain('createElement("style")');
  // Fail-closed failure mode: a non-ok response throws, so the importing
  // island module never evaluates against an empty sheet (ADR-0164 App. D).
  expect(adapter).toContain('throw new Error');
});

test('the native adapter form is the import-attribute shape and stays behind the verdict', () => {
  expect(nativeSheetAdapterModule('import.meta.ROLLUP_FILE_URL_ref-1')).toContain(
    "import sheet from import.meta.ROLLUP_FILE_URL_ref-1 with { type: 'css' };",
  );
  expect(nativeSheetAdapterModule('x')).not.toContain('document.head');
  // The recorded verdict: the fetch adapter ships on this toolchain (module
  // doc carries the evidence and the retirement condition).
  expect(sheetAdapterForm()).toEqual('fetch');
});

test('the SSR half serves the same emitted asset, hash-checked against the record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-style-assets-'));
  try {
    const fileName = styleAssetFileName(SHEET);
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, fileName), SHEET, 'utf8');
    const records = new Map<string, StyleAssetRecord>([
      [REGISTRY_KEY, { fileName, hash: styleAssetHash(SHEET) }],
    ]);
    const adapter = await serverLoad(records, dir, styleAssetGraphId(REGISTRY_KEY));
    // The sheet text is the asset's own bytes — the DSD text cannot drift
    // from the client sheet (both are these bytes).
    expect(adapter).toContain(`sheet.replaceSync(${JSON.stringify(SHEET)});`);
    expect(adapter).toContain("import { StyleSheet } from '@openelement/element';");
    expect(adapter).not.toContain('document.head');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the SSR half fails closed when the asset record, file or hash is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-style-assets-'));
  try {
    const fileName = styleAssetFileName(SHEET);
    await mkdir(join(dir, 'assets'), { recursive: true });
    // No record at all: Phase 2 never ran for this graph.
    const unmapped = await assertRejectsIncludes(
      () => serverLoad(new Map(), dir, styleAssetGraphId(REGISTRY_KEY)),
      OpenElementError,
    );
    expect(unmapped.code).toEqual(ClientBuildErrorCode.STYLE_ASSET_UNMAPPED);

    // A record whose file is gone (stale dist).
    const missing = await assertRejectsIncludes(
      () =>
        serverLoad(
          new Map([[REGISTRY_KEY, { fileName, hash: styleAssetHash(SHEET) }]]),
          dir,
          styleAssetGraphId(REGISTRY_KEY),
        ),
      OpenElementError,
    );
    expect(missing.code).toEqual(ClientBuildErrorCode.STYLE_ASSET_UNMAPPED);

    // The file exists but its bytes were rewritten: the DSD text would no
    // longer be the bytes the client sheet serves.
    await writeFile(join(dir, fileName), ':host { display: none; }\n', 'utf8');
    const mismatch = await assertRejectsIncludes(
      () =>
        serverLoad(
          new Map([[REGISTRY_KEY, { fileName, hash: styleAssetHash(SHEET) }]]),
          dir,
          styleAssetGraphId(REGISTRY_KEY),
        ),
      OpenElementError,
    );
    expect(mismatch.code).toEqual(ClientBuildErrorCode.STYLE_ASSET_HASH_MISMATCH);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the dev plugin serves the inline adapter from the registry, fail-closed', () => {
  const plugin = devStyleAssetPlugin();
  const resolveId = plugin.resolveId as (
    this: unknown,
    source: string,
    importer?: string,
  ) => string | null;
  expect(resolveId.call({}, './open-layout.oe-style.css', IMPORTER)).toEqual(
    styleAssetGraphId(REGISTRY_KEY),
  );
  // Same fail-closed posture as the builds: an unregistered request has no
  // payload channel in dev either.
  const error = assertThrowsIncludes(
    () => resolveId.call({}, './rogue.oe-style.css', IMPORTER),
    OpenElementError,
  );
  expect(error.code).toEqual(ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED);

  // The dev adapter rides the module (no emitted asset to fetch): element's
  // cross-realm StyleSheet + replaceSync, no document-head sink.
  const load = plugin.load as (this: unknown, id: string) => string | null;
  const adapter = load.call({}, styleAssetGraphId(REGISTRY_KEY)) as string;
  expect(adapter).toContain("import { StyleSheet } from '@openelement/element';");
  expect(adapter).toContain(`sheet.replaceSync(${JSON.stringify(SHEET)});`);
  expect(adapter).toContain('export default sheet;');
  expect(adapter).not.toContain('appendChild');
  expect(adapter).not.toContain('await fetch(');
});
