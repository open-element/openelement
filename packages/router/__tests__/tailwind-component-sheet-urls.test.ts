/**
 * The Tailwind component sheet's `url()` contract (alpha15 S lane; the item
 * ADR-0164 recorded as outstanding on 2026-10-12, closed here).
 *
 * The component sheet is compiled by the OFFICIAL Tailwind compiler, not
 * through Vite's CSS graph: the compiler's own `shouldRewriteUrls` rebases
 * every `url()` onto a project-relative FILE path. Emitted as an asset, those
 * targets resolve against the sheet's served location instead of the file's —
 * the official Site's `@fontsource` faces 404'd from exactly such a
 * `/node_modules/.pnpm/...` request. The build now rebases each target onto an
 * asset it emits itself and resolves it in `generateBundle` through Vite's own
 * `getFileName` mapping, so the sheet addresses a resource the build owns.
 *
 * Unit half: the real compiler plus the plugin hooks over a fake context —
 * the placeholder grammar, the shared URL rule, and the sheet name's
 * independence from emission order.
 *
 * Real half: a full Router-build-CLI app whose theme source references one
 * font below Vite's default `assetsInlineLimit` (the document stylesheet
 * inlines it, so there is no document-side asset to borrow — the case that
 * made a bundle-scan join wrong) and one above it (the document pipeline
 * emits it as a content-addressed asset).
 */

import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  COMPONENT_SHEET_SPECIFIER,
  componentStyleSheetPlugin,
  compileComponentStyleSheet,
  type ComponentStyleSheetRecord,
} from '../src/vite/tailwind.ts';
import { styleAssetFileName } from '../src/vite/internal/style-assets.ts';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const ROUTER_BUILD_CLI = join(REPO_ROOT, 'packages', 'router', 'src', 'cli', 'build.ts');

/** A font below Vite's default 4096-byte inline limit, and one above it. */
const SMALL_FONT = Buffer.alloc(2048, 7);
const LARGE_FONT = Buffer.alloc(8192, 11);

const THEME_CSS = [
  '@theme { --color-proof-role: #123456; }',
  "@font-face { font-family: 'Proof Small'; src: url('./fonts/proof-small.woff2') format('woff2'); }",
  "@font-face { font-family: 'Proof Large'; src: url('./fonts/proof-large.woff2') format('woff2'); }",
  '',
].join('\n');

// ─── Unit half: the rebase's placeholder grammar over a fake Vite context ───

const UNIT_FIXTURE = join(import.meta.dirname!, '../__test_fixtures__/tailwind-component-urls');

interface EmittedAsset {
  type: string;
  fileName?: string;
  name?: string;
  source: Uint8Array;
}

function writeUnitFixture(): void {
  rmSync(UNIT_FIXTURE, { recursive: true, force: true });
  mkdirSync(join(UNIT_FIXTURE, 'app', 'fonts'), { recursive: true });
  writeFileSync(join(UNIT_FIXTURE, 'app', 'theme.css'), THEME_CSS, 'utf8');
  writeFileSync(join(UNIT_FIXTURE, 'app', 'fonts', 'proof-small.woff2'), SMALL_FONT);
  writeFileSync(join(UNIT_FIXTURE, 'app', 'fonts', 'proof-large.woff2'), LARGE_FONT);
}

/** The emit/getFileName half of the plugin context, with caller-chosen ids. */
function fakeContext(
  emitted: EmittedAsset[],
  idPrefix: string,
  emittedNames: Map<string, string>,
): {
  emitFile(file: EmittedAsset): string;
  getFileName(referenceId: string): string;
  environment: { config: { base: string } };
} {
  return {
    emitFile(file: EmittedAsset): string {
      emitted.push(file);
      return `${idPrefix}${emitted.length - 1}`;
    },
    getFileName(referenceId: string): string {
      const name = emittedNames.get(referenceId);
      if (name === undefined) throw new Error(`unknown reference ${referenceId}`);
      return name;
    },
    environment: { config: { base: '/client/' } },
  };
}

test('the component sheet rebases every file url() onto an emitted asset, independent of emission order', async () => {
  writeUnitFixture();
  try {
    const options = { theme: ['app/theme.css'], documentReset: true } as const;
    const compiled = await compileComponentStyleSheet(UNIT_FIXTURE, options, ['flex']);
    // Precondition (the failure this test pins): the official compiler writes
    // project-relative FILE targets, unaddressable from the emitted sheet.
    expect(compiled).toContain("url('../app/fonts/proof-small.woff2')");
    expect(compiled).toContain("url('../app/fonts/proof-large.woff2')");

    const run = async (idPrefix: string): Promise<{ fileName: string; sheet: string }> => {
      const emitted: EmittedAsset[] = [];
      const record: ComponentStyleSheetRecord = { fileName: undefined };
      const plugin = componentStyleSheetPlugin(UNIT_FIXTURE, options, () => ['flex'], record);
      const graphId = (plugin.resolveId as (id: string) => string | null)(
        COMPONENT_SHEET_SPECIFIER,
      );
      expect(graphId).toBeTruthy();
      const emittedNames = new Map([
        [`${idPrefix}0`, `assets/proof-small-${idPrefix}0.woff2`],
        [`${idPrefix}1`, `assets/proof-large-${idPrefix}1.woff2`],
      ]);
      const context = fakeContext(emitted, idPrefix, emittedNames);
      const load = plugin.load as (this: unknown, id: string) => Promise<string | null>;
      await load.call(context, graphId!);
      // The referenced bytes are emitted by this build (a document-side asset
      // may not exist: below the inline limit the document sheet inlines them).
      const sheet = emitted.find((asset) => asset.fileName !== undefined);
      expect(sheet, 'the sheet asset is emitted').toBeDefined();
      expect(sheet!.source.toString(), 'no file target survives the rebase').not.toContain(
        '../app/fonts/',
      );
      // The emitted text carries the digest placeholder — the grammar
      // `generateBundle` resolves, never a URL the bundle pass could rewrite.
      expect(sheet!.source.toString()).toContain('__OE_COMPONENT_URL__');
      expect(sheet!.source.toString()).not.toContain('__VITE_ASSET__');
      const source = sheet!.source;
      const bundle: Record<string, { type: string; source: string | Uint8Array }> = {
        [record.fileName!]: { type: 'asset', source },
      };
      const generateBundle = plugin.generateBundle as (
        this: unknown,
        options: unknown,
        bundle: Record<string, { type: string; source: string | Uint8Array }>,
      ) => void;
      generateBundle.call(context, {}, bundle);
      const resolved = bundle[record.fileName!].source.toString();
      expect(resolved).toContain(`url('/client/assets/proof-small-${idPrefix}0.woff2')`);
      expect(resolved).toContain(`url('/client/assets/proof-large-${idPrefix}1.woff2')`);
      expect(resolved).not.toContain('__OE_COMPONENT_URL__');
      expect(resolved).not.toContain('__VITE_ASSET__');
      expect(resolved).not.toContain('node_modules');
      return { fileName: record.fileName!, sheet: resolved };
    };

    const first = await run('a');
    const second = await run('b');
    // The sheet's content address covers the sheet text and the referenced
    // bytes' digests — never a reference id, so a different emission order
    // (different ids) cannot move the name.
    expect(first.fileName).toEqual(second.fileName);
    expect(first.fileName).toMatch(/^assets\/[0-9a-f]{12}\.css$/);
  } finally {
    rmSync(UNIT_FIXTURE, { recursive: true, force: true });
  }
});

test('changing the referenced asset bytes changes the sheet identity — never a stale shared sheet or a missing asset', async () => {
  // The shared-stylesheet contract: a sheet's name is the cache key, so two
  // different referenced byte sets must never fold into one name, and each
  // build's final bytes (after URL replacement) must address the asset that
  // build emitted. Drives the plugin twice over the same authoring bytes with
  // different font content, then once more with the first content again.
  const fixture = join(
    import.meta.dirname!,
    '../__test_fixtures__/tailwind-component-urls-identity',
  );
  const smallFontPath = join(fixture, 'app', 'fonts', 'proof-small.woff2');
  rmSync(fixture, { recursive: true, force: true });
  mkdirSync(join(fixture, 'app', 'fonts'), { recursive: true });
  writeFileSync(join(fixture, 'app', 'theme.css'), THEME_CSS, 'utf8');
  writeFileSync(join(fixture, 'app', 'fonts', 'proof-large.woff2'), LARGE_FONT);
  try {
    const run = async (
      smallBytes: Buffer,
      idPrefix: string,
    ): Promise<{ fileName: string; sheet: string }> => {
      writeFileSync(smallFontPath, smallBytes);
      const emitted: EmittedAsset[] = [];
      const record: ComponentStyleSheetRecord = { fileName: undefined };
      const plugin = componentStyleSheetPlugin(
        fixture,
        { theme: ['app/theme.css'], documentReset: true },
        () => ['flex'],
        record,
      );
      const graphId = (plugin.resolveId as (id: string) => string | null)(
        COMPONENT_SHEET_SPECIFIER,
      );
      expect(graphId).toBeTruthy();
      const emittedNames = new Map([
        [`${idPrefix}0`, `assets/referenced-${idPrefix}.woff2`],
        [`${idPrefix}1`, `assets/large-${idPrefix}.woff2`],
      ]);
      const context = fakeContext(emitted, idPrefix, emittedNames);
      const load = plugin.load as (this: unknown, id: string) => Promise<string | null>;
      await load.call(context, graphId!);
      const sheet = emitted.find((asset) => asset.fileName !== undefined);
      expect(sheet, 'the sheet asset is emitted').toBeDefined();
      // The name is derived from the exact bytes handed to emitFile (the
      // placeholder-carrying text), so the name's preimage always exists under
      // its own name in the bundle — no manifest drift in the emission half.
      expect(record.fileName).toBe(styleAssetFileName(sheet!.source.toString()));
      // The placeholder digest is the referenced bytes' own digest and the
      // build emits exactly those bytes: the URL replacement below can never
      // name an asset this build did not ship.
      const referenced = emitted.find((asset) => asset.name === 'proof-small.woff2');
      expect(referenced, 'the referenced bytes are emitted').toBeDefined();
      expect(Buffer.from(referenced!.source)).toEqual(smallBytes);
      const bundle: Record<string, { type: string; source: string | Uint8Array }> = {
        [record.fileName!]: { type: 'asset', source: sheet!.source },
      };
      const generateBundle = plugin.generateBundle as (
        this: unknown,
        options: unknown,
        bundle: Record<string, { type: string; source: string | Uint8Array }>,
      ) => void;
      generateBundle.call(context, {}, bundle);
      const resolved = bundle[record.fileName!].source.toString();
      expect(resolved).not.toContain('__OE_COMPONENT_URL__');
      expect(resolved).not.toContain('../app/fonts/');
      // The final bytes address THIS run's emitted font, never a sibling run's.
      expect(resolved).toContain(`url('/client/assets/referenced-${idPrefix}.woff2')`);
      return { fileName: record.fileName!, sheet: resolved };
    };

    const first = await run(SMALL_FONT, 'a');
    // Same length, different bytes: only the content digest can move the name.
    const second = await run(Buffer.alloc(SMALL_FONT.length, 9), 'b');
    expect(second.fileName).not.toEqual(first.fileName);
    expect(second.sheet).not.toEqual(first.sheet);
    expect(second.sheet).not.toContain('referenced-a');
    // Determinism: the identical referenced bytes reproduce the identical
    // identity, so a cache key never drifts run to run.
    const again = await run(SMALL_FONT, 'a');
    expect(again.fileName).toEqual(first.fileName);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// ─── Real half: a full build through the Router build CLI ──────────────────

const fixtureRoots: string[] = [];

async function write(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await writeFile(path, content);
}

async function buildFixture(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'oe-tailwind-component-urls-'));
  // Node resolution answers realpaths (macOS /var vs /private/var).
  const root = await realpath(created);
  fixtureRoots.push(created);
  const appDir = join(root, 'app');

  await write(
    join(appDir, 'package.json'),
    JSON.stringify({ name: 'oe-tailwind-component-urls-proof', private: true, type: 'module' }),
  );
  await write(
    join(appDir, 'vite.config.ts'),
    [
      "import { openElement } from '@openelement/router/vite';",
      "import { defineConfig } from 'vite';",
      '',
      "export default defineConfig({ base: '/sub/', plugins: [openElement()] });",
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'openelement.config.ts'),
    [
      "import { defineConfig } from '@openelement/router';",
      '',
      "export default defineConfig({ tailwind: { theme: ['app/theme.css'] } });",
      '',
    ].join('\n'),
  );
  await write(join(appDir, 'app', 'theme.css'), THEME_CSS);
  await write(join(appDir, 'app', 'fonts', 'proof-small.woff2'), SMALL_FONT);
  await write(join(appDir, 'app', 'fonts', 'proof-large.woff2'), LARGE_FONT);
  await write(
    join(appDir, 'app', 'islands', 'proof-island.tsx'),
    [
      "import { defineIslandConfig } from '@openelement/router';",
      "import { element, OpenElement } from '@openelement/element';",
      '',
      "export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true });",
      '',
      "@element('proof-island', { root: 'shadow-open' })",
      'export default class ProofIsland extends OpenElement {',
      '  render() {',
      "    return <div class='flex proof-token'>proof-island</div>;",
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'app', 'components', 'proof-page.tsx'),
    [
      "import { element, OpenElement } from '@openelement/element';",
      '',
      "@element('proof-page', { root: 'shadow-open' })",
      'export default class ProofPage extends OpenElement {',
      '  render() {',
      '    return (',
      '      <div>',
      '        <proof-island></proof-island>',
      '      </div>',
      '    );',
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'app', 'routes', 'index.tsx'),
    [
      "import { definePage } from '@openelement/router';",
      "import ProofPage from '../components/proof-page.tsx';",
      '',
      "export default definePage(ProofPage, { renderIntent: { mode: 'static' } });",
      '',
    ].join('\n'),
  );

  // pnpm-style symlinks to the workspace packages (the layout a consumer has).
  await mkdir(join(appDir, 'node_modules', '@openelement'), { recursive: true });
  await symlink(
    join(REPO_ROOT, 'packages', 'router'),
    join(appDir, 'node_modules', '@openelement', 'router'),
  );
  await symlink(
    join(REPO_ROOT, 'packages', 'element'),
    join(appDir, 'node_modules', '@openelement', 'element'),
  );
  await symlink(join(REPO_ROOT, 'node_modules', 'vite'), join(appDir, 'node_modules', 'vite'));
  await symlink(
    join(REPO_ROOT, 'packages', 'router', 'node_modules', 'hono'),
    join(appDir, 'node_modules', 'hono'),
  );
  await symlink(
    join(REPO_ROOT, 'node_modules', 'tailwindcss'),
    join(appDir, 'node_modules', 'tailwindcss'),
  );
  return appDir;
}

let appDir: string;
let buildLogs = '';

beforeAll(async () => {
  appDir = await buildFixture();
  const build = spawn(process.execPath, [ROUTER_BUILD_CLI], { cwd: appDir });
  build.stdout.on('data', (chunk) => (buildLogs += chunk));
  build.stderr.on('data', (chunk) => (buildLogs += chunk));
  const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? -1)));
  expect(code, `tailwind component url fixture build failed:\n${buildLogs}`).toEqual(0);
  if (process.env.OE_KEEP_FIXTURE) console.log(`[fixture] ${appDir}`);
}, 240_000);

afterAll(async () => {
  if (process.env.OE_KEEP_FIXTURE) return;
  for (const root of fixtureRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

test('the emitted component sheet addresses emitted fonts — never a source path or a placeholder', async () => {
  const assetsDir = join(appDir, 'dist', 'client', 'assets');
  const cssFiles = (await readdir(assetsDir)).filter((file) => file.endsWith('.css'));
  const bodies = await Promise.all(cssFiles.map((file) => readFile(join(assetsDir, file), 'utf8')));

  const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  const linked = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
  expect(linked, 'the document stylesheet is linked').toBeTruthy();
  const documentSheetName = linked!.replace('/sub/client/assets/', '');
  const documentBody = bodies[cssFiles.indexOf(documentSheetName)];
  const componentBodies = bodies.filter((_, index) => cssFiles[index] !== documentSheetName);
  expect(componentBodies, 'the component sheet is emitted').toHaveLength(1);
  const componentSheet = componentBodies[0]!;

  // The document pipeline inlined the small font (below the inline limit), so
  // the component sheet cannot borrow its URL — it must own the emission.
  expect(documentBody, 'the small font is inlined into the document sheet').toContain(
    'data:font/woff2;base64,',
  );

  const urls = [...componentSheet.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]!);
  expect(urls.length).toBeGreaterThanOrEqual(2);
  for (const url of urls) {
    expect(url, 'no source-relative or placeholder target ships').toMatch(
      /^\/sub\/client\/assets\/[^/]+\.woff2$/,
    );
    const emitted = url.replace('/sub/client/assets/', '');
    expect(
      await readFile(join(assetsDir, emitted)).then((bytes) => bytes.length),
      `${url} resolves to a real emitted asset`,
    ).toBeGreaterThan(0);
  }
  expect(componentSheet).not.toContain('__OE_COMPONENT_URL__');
  expect(componentSheet).not.toContain('__VITE_ASSET__');
  expect(componentSheet).not.toContain('node_modules');
  expect(componentSheet).not.toContain('../app/');

  // Both referenced foreign bytes ship, content-identical to the fixture.
  const emittedFonts = (await readdir(assetsDir)).filter((file) => file.endsWith('.woff2'));
  expect(emittedFonts.sort()).toHaveLength(2);
  const small = emittedFonts.find((file) => file.startsWith('proof-small-'));
  const large = emittedFonts.find((file) => file.startsWith('proof-large-'));
  expect(small, 'the inlineable font is emitted for the component sheet').toBeDefined();
  expect(large, 'the document-emitted font is shared').toBeDefined();
  expect(await readFile(join(assetsDir, small!))).toEqual(SMALL_FONT);
  expect(await readFile(join(assetsDir, large!))).toEqual(LARGE_FONT);
});
