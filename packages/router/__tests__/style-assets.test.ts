/**
 * @openelement/router — the style-edge intercept (the ADR-0164 protocol after
 * the #1558 file-based authoring retirement).
 *
 * Unit coverage of the router-side seam: the fail-closed intercept of a
 * compiled module's authored `.css` edges, the client build's `.css` emission
 * (content-hashed file name, verbatim file bytes, emission records), the
 * sheet adapter forms (fetch + TLA today; the native form behind the recorded
 * capability verdict), the SSR half reading the same authored file, and the
 * dev inline adapter. The real-build consumer form — island JS without
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
  styleRequestFile,
  styleRequestModuleId,
} from '@openelement/compiler';
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

const SPECIFIER = './open-layout.css';
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

let sheetDir: string;
let importer: string;
let sheetFile: string;
let registryKey: string;

beforeEach(async () => {
  clearStyleRequests();
  sheetDir = await mkdtemp(join(tmpdir(), 'oe-style-assets-'));
  // A tracked importing module and its authored sheet file: the protocol's
  // one byte source.
  importer = join(sheetDir, 'app', 'islands', 'open-layout.tsx');
  sheetFile = styleRequestFile(importer, SPECIFIER);
  registryKey = styleRequestModuleId(importer, SPECIFIER);
  await mkdir(join(sheetDir, 'app', 'islands'), { recursive: true });
  await writeFile(sheetFile, SHEET, 'utf8');
  registerStyleRequest({
    moduleId: registryKey,
    importer,
    specifier: SPECIFIER,
    file: sheetFile,
  });
});

afterEach(async () => {
  clearStyleRequests();
  await rm(sheetDir, { recursive: true, force: true });
});

test('graph ids round-trip the registry key behind a JS-typed virtual id', () => {
  const graphId = styleAssetGraphId(registryKey);
  // The id must not end with a css suffix: the toolchain infers the module
  // type from the extension, and a .css-suffixed id is processed as a CSS
  // module — the load result is ignored (reproduced MISSING_EXPORT).
  expect(graphId.endsWith('.css')).toBe(false);
  expect(graphId.endsWith('.js')).toBe(true);
  expect(styleAssetRegistryKey(graphId)).toEqual(registryKey);
  expect(styleAssetRegistryKey('./open-layout.css')).toBeUndefined();
});

test('the client plugin intercepts edges from tracked importers only', () => {
  const plugin = clientStyleAssetPlugin(new Map<string, StyleAssetRecord>());
  const resolveId = plugin.resolveId as (
    this: unknown,
    source: string,
    importer?: string,
  ) => string | null;
  expect(resolveId.call({}, SPECIFIER, importer)).toEqual(styleAssetGraphId(registryKey));
  // A plain app stylesheet (importer with no registered edges) passes
  // through to vite's own CSS channel untouched.
  expect(resolveId.call({}, './global.css', '/proj/app/other.ts')).toEqual(null);
  // An importer-less .css source is never an authored module edge.
  expect(resolveId.call({}, SPECIFIER)).toEqual(null);
  // Query-suffixed specifiers (string channels) are not sheet edges.
  expect(resolveId.call({}, './open-layout.css?raw', importer)).toEqual(null);
});

test('the client plugin fails closed on a tracked edge with no registry entry', () => {
  const plugin = clientStyleAssetPlugin(new Map<string, StyleAssetRecord>());
  const resolveId = plugin.resolveId as (
    this: unknown,
    source: string,
    importer?: string,
  ) => string | null;
  // A tracked importer whose .css edge carries no entry: a defect (the
  // compiled-element transform registers every edge it admits).
  registerStyleRequest({
    moduleId: styleRequestModuleId(importer, './tracked.css'),
    importer,
    specifier: './tracked.css',
    file: styleRequestFile(importer, './tracked.css'),
  });
  const error = assertThrowsIncludes(
    () => resolveId.call({}, './rogue.css', importer),
    OpenElementError,
  );
  expect(error.code).toEqual(ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED);
});

test('the client build emits the authored file bytes under a content-hashed name', async () => {
  const emitted: EmittedAsset[] = [];
  const records = new Map<string, StyleAssetRecord>();
  const plugin = clientStyleAssetPlugin(records);
  const load = plugin.load as (
    this: { emitFile(file: unknown): string },
    id: string,
  ) => Promise<string | null>;
  const adapter = (await load.call(harness(emitted), styleAssetGraphId(registryKey))) as string;

  expect(emitted).toHaveLength(1);
  // The artifact owner is the client build; the bytes are the authored
  // file's own — the DSD text and the runtime replace() text derive from
  // exactly these bytes.
  expect(emitted[0].source).toEqual(SHEET);
  expect(emitted[0].fileName).toEqual(styleAssetFileName(SHEET));
  expect(emitted[0].fileName).toMatch(/^assets\/[0-9a-f]{12}\.css$/);
  expect(records.get(registryKey)).toEqual({
    fileName: emitted[0].fileName,
    hash: styleAssetHash(SHEET),
  });
  // The fetch adapter references the emission for the sheet.
  expect(adapter).toContain(`import.meta.ROLLUP_FILE_URL_ref-1`);
});

test('identical sheet bytes deduplicate into one emission (multi-island reuse)', async () => {
  // A second island carries the same sheet: a distinct registry key, the
  // same content hash — one emitted asset, one URL, two adapters.
  const otherImporter = join(sheetDir, 'app', 'islands', 'open-dock.tsx');
  const otherSpecifier = './open-dock.css';
  const otherKey = styleRequestModuleId(otherImporter, otherSpecifier);
  registerStyleRequest({
    moduleId: otherKey,
    importer: otherImporter,
    specifier: otherSpecifier,
    file: styleRequestFile(otherImporter, otherSpecifier),
  });
  const parts = styleRequestFile(otherImporter, otherSpecifier).split('/');
  await mkdir(parts.slice(0, -1).join('/'), { recursive: true });
  await writeFile(styleRequestFile(otherImporter, otherSpecifier), SHEET, 'utf8');

  const emitted: EmittedAsset[] = [];
  const records = new Map<string, StyleAssetRecord>();
  const plugin = clientStyleAssetPlugin(records);
  const load = plugin.load as (
    this: { emitFile(file: unknown): string },
    id: string,
  ) => Promise<string | null>;
  const first = (await load.call(harness(emitted), styleAssetGraphId(registryKey))) as string;
  const second = (await load.call(harness(emitted), styleAssetGraphId(otherKey))) as string;
  expect(emitted).toHaveLength(1);
  expect(records.get(otherKey)).toEqual(records.get(registryKey));
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

test('the SSR half embeds the authored file bytes — one fact, no reconciliation', async () => {
  const plugin = serverStyleAssetPlugin();
  const load = plugin.load as (this: unknown, id: string) => Promise<string | null>;
  const adapter = (await load.call({}, styleAssetGraphId(registryKey))) as string;
  // The sheet text is the authored file's own bytes — the same bytes the
  // client build emitted content-hashed — so the DSD text cannot drift from
  // the client sheet.
  expect(adapter).toContain(`sheet.replaceSync(${JSON.stringify(SHEET)});`);
  expect(adapter).toContain("import { StyleSheet } from '@openelement/element';");
  expect(adapter).not.toContain('document.head');
});

test('the SSR half fails closed when the sheet file is missing', async () => {
  await rm(sheetFile);
  const plugin = serverStyleAssetPlugin();
  const load = plugin.load as (this: unknown, id: string) => Promise<string | null>;
  const error = await assertRejectsIncludes(
    () => load.call({}, styleAssetGraphId(registryKey)),
    OpenElementError,
  );
  expect(error.code).toEqual(ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED);
});

test('the dev plugin serves the inline adapter from the authored file, fail-closed', async () => {
  const plugin = devStyleAssetPlugin();
  const resolveId = plugin.resolveId as (
    this: unknown,
    source: string,
    importer?: string,
  ) => string | null;
  expect(resolveId.call({}, SPECIFIER, importer)).toEqual(styleAssetGraphId(registryKey));
  // Same fail-closed posture as the builds: a tracked edge without a
  // registry entry fails the resolve.
  registerStyleRequest({
    moduleId: styleRequestModuleId(importer, './tracked.css'),
    importer,
    specifier: './tracked.css',
    file: styleRequestFile(importer, './tracked.css'),
  });
  const error = assertThrowsIncludes(
    () => resolveId.call({}, './rogue.css', importer),
    OpenElementError,
  );
  expect(error.code).toEqual(ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED);

  // The dev adapter rides the module (no emitted asset to fetch): element's
  // cross-realm StyleSheet + replaceSync with the authored bytes, no
  // document-head sink.
  const load = plugin.load as (this: unknown, id: string) => Promise<string | null>;
  const adapter = (await load.call({}, styleAssetGraphId(registryKey))) as string;
  expect(adapter).toContain("import { StyleSheet } from '@openelement/element';");
  expect(adapter).toContain(`sheet.replaceSync(${JSON.stringify(SHEET)});`);
  expect(adapter).toContain('export default sheet;');
  expect(adapter).not.toContain('appendChild');
  expect(adapter).not.toContain('await fetch(');
});
