/**
 * @openelement/router — the style-edge intercept (the ADR-0164 protocol after
 * the #1558 file-based authoring retirement).
 *
 * Unit coverage of the router-side seam: the fail-closed intercept of a
 * compiled module's authored `.css` edges, the client build's `.css` emission
 * (content-hashed file name, verbatim file bytes, emission records), the
 * sheet adapter forms (fetch today — synchronous sheet, asynchronous readiness
 * recorded under the protocol key; the native form behind the recorded
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
import { STYLE_SHEET_READY } from '@openelement/protocol/style-sheet';
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

/**
 * A hook harness: the plugin context shape the hooks actually touch. The sheet
 * text arrives from Vite's `?inline` CSS module (the build's own processing of
 * the authored file), so the harness stubs that module exactly as Vite serves
 * it — a module whose first statement is the CSS text as a JSON string.
 */
function harness(emitted: EmittedAsset[], sheetText: string = SHEET) {
  const requested: string[] = [];
  return {
    requested,
    emitFile(file: { type: string; fileName: string; source: string }): string {
      emitted.push({ fileName: file.fileName, source: file.source });
      return `ref-${emitted.length}`;
    },
    load(options: { id: string }): Promise<unknown> {
      // Recorded, not ignored: the plugin reads the sheet through Vite's
      // `?inline` CSS module, never from the file itself.
      requested.push(options.id);
      return Promise.resolve(undefined);
    },
    getModuleInfo(id: string): { code?: string } | null {
      return id.endsWith('?inline')
        ? { code: `export default ${JSON.stringify(sheetText)}` }
        : null;
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
  const sheetText = SHEET;
  const context = harness(emitted, sheetText);
  const adapter = (await load.call(context, styleAssetGraphId(registryKey))) as string;
  expect(context.requested, 'the sheet text comes from Vite`s ?inline CSS module').toEqual([
    `${sheetFile}?inline`,
  ]);

  expect(emitted).toHaveLength(1);
  // The artifact owner is the client build; the bytes are Vite's processing of
  // the authored file — the same text the dev resource endpoint serves, and
  // what the runtime's replace() parses.
  expect(emitted[0].source).toEqual(SHEET);
  expect(emitted[0].source).toEqual(sheetText);
  expect(emitted[0].fileName).toEqual(styleAssetFileName(SHEET));
  expect(emitted[0].fileName).toMatch(/^assets\/[0-9a-f]{12}\.css$/);
  expect(records.get(registryKey)).toEqual({
    fileName: emitted[0].fileName,
    hash: styleAssetHash(sheetText),
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

test('the asset placeholder grammar is the installed Vite writer`s own (bare and postfix forms)', () => {
  // Verified against the installed toolchain, not a comment: Vite 8.0.16
  // writes `__VITE_ASSET__${referenceId}__${postfix ? `$_${postfix}__` : ``}`
  // (node_modules/.pnpm/vite@8.0.16…/vite/dist/node/chunks/node.js:19285) and
  // reads it back with /__VITE_ASSET__([\w$]+)__(?:\$_(.*?)__)?/g (node.js:19078)
  // — the same literal this module carries. A reader that required a different
  // trailing spelling would leave the placeholder in the shipped sheet.
  const plugin = clientStyleAssetPlugin(new Map<string, StyleAssetRecord>());
  const bundle: Record<string, { type: string; source: string }> = {
    'assets/sheet.css': {
      type: 'asset',
      source:
        "@font-face { src: url(__VITE_ASSET__ref$1__) format('woff2'); }\n" +
        "@font-face { src: url(__VITE_ASSET__ref$2__$_?v=2__) format('woff2'); }\n",
    },
  };
  const generateBundle = plugin.generateBundle as (
    this: unknown,
    options: unknown,
    bundle: unknown,
  ) => void;
  const names = new Map([
    ['ref$1', 'assets/proof-a1b2c3.woff2'],
    ['ref$2', 'assets/proof-d4e5f6.woff2'],
  ]);
  generateBundle.call(
    {
      environment: { config: { base: '/client/' } },
      getFileName: (referenceId: string) => names.get(referenceId),
    },
    {},
    bundle,
  );
  expect(bundle['assets/sheet.css'].source).toContain('url(/client/assets/proof-a1b2c3.woff2)');
  // The writer's postfix rides after the mapped file name, exactly as Vite's
  // own CSS pass appends it.
  expect(bundle['assets/sheet.css'].source).toContain('url(/client/assets/proof-d4e5f6.woff2?v=2)');
  expect(bundle['assets/sheet.css'].source).not.toContain('__VITE_ASSET__');

  // The relative-base spelling is the other half of the same rule: the URL is
  // the emitted file's path relative to the sheet's own directory.
  const relative: Record<string, { type: string; source: string }> = {
    'assets/sheet.css': { type: 'asset', source: 'a{background:url(__VITE_ASSET__ref$3__)}' },
  };
  generateBundle.call(
    { environment: { config: { base: '' } }, getFileName: () => 'assets/font-aa.woff2' },
    {},
    relative,
  );
  expect(relative['assets/sheet.css'].source).toEqual('a{background:url(./font-aa.woff2)}');
});

test('the fetch adapter exports the sheet synchronously and records readiness', () => {
  const adapter = fetchSheetAdapterModule('ref-1');
  expect(adapter).toContain('import.meta.ROLLUP_FILE_URL_ref-1');
  // The sheet exists synchronously: the compiled class binds it in `static
  // styles`, so the class export must not sit behind the asset's evaluation
  // (the WebKit overlapping-evaluation race, KR-2).
  expect(adapter).not.toContain('await fetch(sheetUrl)');
  expect(adapter).not.toContain('await sheet.replace(');
  expect(adapter.indexOf('const sheet = new CSSStyleSheet();')).toBeLessThan(
    adapter.indexOf('const ready = fetch(sheetUrl)'),
  );
  expect(adapter).toContain('.then((css) => sheet.replace(css));');
  expect(adapter).toContain('export default sheet;');
  // Readiness rides the protocol's one canonical key, and the stored promise
  // keeps its rejected state: the catch only prevents an unhandled rejection
  // before a root consumes it.
  expect(adapter).toContain(`sheet['${STYLE_SHEET_READY}'] = ready;`);
  expect(adapter).toContain('void ready.catch(() => {});');
  // No document-head sink of any kind: the adapter's only CSS channel is the
  // constructable sheet it exports.
  expect(adapter).not.toContain('appendChild');
  expect(adapter).not.toContain("createElement('style')");
  expect(adapter).not.toContain('createElement("style")');
  // Fail-closed failure mode: a non-ok response and a failed replace both reject
  // the readiness promise the runtime gates on (ADR-0164 App. D).
  expect(adapter).toContain('if (!response.ok)');
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

test("the SSR half declares the client build's emitted asset, never its text", async () => {
  const plugin = serverStyleAssetPlugin({
    files: new Map([[registryKey, 'assets/0123456789ab.css']]),
    base: '/sub/',
  });
  const load = plugin.load as (this: unknown, id: string) => Promise<string | null>;
  const adapter = (await load.call({}, styleAssetGraphId(registryKey))) as string;
  // One resource, one delivery: the server half names the emitted asset under
  // the configured base and carries NO sheet text — the DSD template then
  // declares a parser-visible link instead of an inline stylesheet.
  expect(adapter).toContain('/sub/client/assets/0123456789ab.css');
  expect(adapter).not.toContain('replaceSync');
  expect(adapter).not.toContain(SHEET.trim());
  expect(adapter).not.toContain('document.head');
});

test('a registered in-root edge with no emitted asset fails closed', async () => {
  const plugin = serverStyleAssetPlugin();
  const load = plugin.load as (this: unknown, id: string) => Promise<string | null>;
  // Discovery walks every server-rendered source through the bundler resolver,
  // so an in-root sheet without an emitted asset is a build defect: it is
  // reported with a stable code instead of being inlined.
  const context = {
    environment: { config: { root: sheetDir } },
    warn(): void {},
  };
  const error = await assertRejectsIncludes(
    () => load.call(context, styleAssetGraphId(registryKey)),
    OpenElementError,
  );
  expect(error.code).toEqual(ClientBuildErrorCode.STYLE_ASSET_UNREGISTERED);
  expect(error.message).toContain('has no emitted asset');
});

test('an out-of-root package sheet keeps the diagnosed text path', async () => {
  const plugin = serverStyleAssetPlugin();
  const load = plugin.load as (this: unknown, id: string) => Promise<string | null>;
  const warnings: string[] = [];
  const context = {
    // A root that does NOT contain the sheet: the package case.
    environment: { config: { root: join(sheetDir, 'elsewhere') } },
    warn(message: string): void {
      warnings.push(message);
    },
  };
  const adapter = (await load.call(context, styleAssetGraphId(registryKey))) as string;
  expect(adapter).toContain('replaceSync');
  expect(warnings.join('\n')).toContain('outside the project root');
});

test('the dev plugin serves the resource-URL adapter, fail-closed', async () => {
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

  // The client half carries the dev resource URL and the live-sheet holder —
  // never the authored bytes, never a `replaceSync` of text, never a node.
  const load = plugin.load as (this: unknown, id: string) => Promise<string | null>;
  const clientAdapter = (await load.call(
    { environment: { name: 'client' } },
    styleAssetGraphId(registryKey),
  )) as string;
  expect(clientAdapter).toContain('fetch(');
  expect(clientAdapter).toMatch(/\/\.openElement\/authored-css\.[0-9a-f]{16}\.css/);
  expect(clientAdapter).toContain('__openElementDevStyleSheets');
  expect(clientAdapter, 'the live flag makes an edit reach connected roots').toContain(
    '__openElementStyleSheetLive',
  );
  expect(clientAdapter, 'no authored CSS text rides the module').not.toContain(SHEET);
  expect(clientAdapter).not.toContain('replaceSync');
  expect(clientAdapter).not.toContain('appendChild');
  expect(clientAdapter).toContain('export default sheet;');

  // The server half declares the same resource and never fetches it: its
  // delivery is the parser-visible link the DSD template / head carries.
  const serverAdapter = (await load.call({}, styleAssetGraphId(registryKey))) as string;
  expect(serverAdapter).toContain("import { StyleSheet } from '@openelement/element';");
  expect(serverAdapter).toMatch(
    /sheet\['__openElementStyleSheetUrl'\] = "\/\.openElement\/authored-css\.[0-9a-f]{16}\.css";/,
  );
  expect(serverAdapter, 'no authored CSS text rides the shim').not.toContain(SHEET);
  expect(serverAdapter).not.toContain('fetch(');
});
