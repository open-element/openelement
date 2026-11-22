/**
 * Generated-island styles — REAL router CLI build evidence (GH issue #1800,
 * option a).
 *
 * A temporary fixture app OUTSIDE this repository is built through the real
 * Router build CLI in a plain Node child process (the same harness as
 * `style-asset-build.test.ts`). The owner-approved slice wires a generated
 * island's authored `styles` list into the EXISTING router style plan — the
 * same compiler style-edge registry, Vite CSS pipeline, content-addressed
 * client asset and client asset manifest record the class lane's `static
 * styles` imports ride — and this row proves the consumer form:
 *
 *   - a LIGHT-root generated-element island declaring `styles` emits a real
 *     content-addressed `.css` asset, scoped with the island's tag exactly like
 *     a light-root class component's sheet (native `@scope (<tag>)`), recorded
 *     in the client asset manifest's `styles` field;
 *   - the island chunk carries no CSS text (the zero-inline guarantee's
 *     consumer form);
 *   - an island that declares NO styles is byte-identical whether or not a
 *     sibling island declares styles: the declaration adds an asset, never a
 *     byte of JS (the published slice does not adopt the sheet — see the gap
 *     note below);
 *   - a SHADOW-root generated island declaring `styles` fails the build with
 *     the coded `OE_ISLAND_STYLE_SHADOW_UNWIRED` diagnostic, which names the
 *     missing DSD style-link carrier (M09-2e owed) and GH issue #1800.
 *
 * DELIVERY GAP (recorded, not claimed): this slice's delivery for a light root
 * is the emitted asset + the manifest record. The document-level application of
 * that asset (the class lane's light-root head `<link>`) is not wired to the
 * generated-element render path yet, and a shadow root has no carrier at all
 * (M09-2e). Both belong to the Alpha17 generated-island style adoption slice,
 * GH issue #1800.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { styleAssetFileName } from '../src/vite/internal/style-assets.ts';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const ROUTER_BUILD_CLI = join(REPO_ROOT, 'packages', 'router', 'src', 'cli', 'build.ts');
const BASE = '/sub/';
const STYLED_TAG = 'gen-style-card';
const PLAIN_TAG = 'gen-style-plain';
/** The authored sheet: one rule for the island's own class and one for a child. */
const SHEET = `.gen-style-card { color: rgb(1, 2, 3); }\n.card-title { font-weight: 700; }\n`;

const fixtureRoots: string[] = [];

async function write(joinPath: string, content: string): Promise<void> {
  await mkdir(joinPath.slice(0, joinPath.lastIndexOf('/')), { recursive: true });
  await writeFile(joinPath, content, 'utf8');
}

/** One generated-element (function) island module, light root by default. */
function generatedIslandSource(
  tag: string,
  options: {
    readonly styles?: boolean;
    readonly root?: 'light' | 'shadow';
    readonly ssr?: boolean;
  } = {},
): string {
  const className = tag
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return [
    '/** @jsxImportSource @openelement/element */',
    "import { defineIslandConfig } from '@openelement/router';",
    '',
    'export const openElement = defineIslandConfig({',
    "  hydrate: 'load',",
    `  ssr: ${options.ssr === true ? 'true' : 'false'},`,
    `  root: '${options.root ?? 'light'}',`,
    // The no-styles form keeps ONE sidecar line in the same position, so the
    // two fixtures differ only in the declaration itself (the generated module
    // embeds authored source positions; a shifted JSX line would change the
    // chunk hash for a reason that has nothing to do with the style channel).
    options.styles === true ? "  styles: ['./gen-style-card.css']," : '  // no styles declared',
    '});',
    '',
    `export default function ${className}() {`,
    "  return <article class='gen-style-card'><h2 class='card-title'>card</h2></article>;",
    '}',
    '',
  ].join('\n');
}

/** The real app shell: a page that renders both islands, plus a dynamic route. */
async function createFixture(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'oe-island-style-build-'));
  const root = await realpath(created);
  fixtureRoots.push(created);
  const appDir = join(root, 'app');

  await write(
    join(appDir, 'package.json'),
    JSON.stringify({ name: 'oe-island-style-proof', private: true, type: 'module' }),
  );
  await write(
    join(appDir, 'vite.config.ts'),
    [
      "import { openElement } from '@openelement/router/vite';",
      "import { defineConfig } from 'vite';",
      '',
      `export default defineConfig({ base: '${BASE}', plugins: [openElement()] });`,
      '',
    ].join('\n'),
  );
  await write(join(appDir, 'app', 'islands', 'gen-style-card.css'), SHEET);
  await write(
    join(appDir, 'app', 'islands', `${STYLED_TAG}.tsx`),
    generatedIslandSource(STYLED_TAG, { styles: true }),
  );
  await write(join(appDir, 'app', 'islands', `${PLAIN_TAG}.tsx`), generatedIslandSource(PLAIN_TAG));
  // The page is a generated SHADOW page root: classification requires the
  // compiler-emitted DSD host producer, which a light root does not have. Its
  // tag is declared because `app/components/` is outside the islands directory,
  // so no path convention owns it.
  await write(
    join(appDir, 'app', 'components', 'proof-page.tsx'),
    [
      "import { defineIslandConfig } from '@openelement/router';",
      '',
      "export const openElement = defineIslandConfig({ tag: 'gen-style-page', root: 'shadow' });",
      '',
      'export default function ProofPage() {',
      '  return (',
      "    <div class='proof'>",
      '      <gen-style-card></gen-style-card>',
      '      <gen-style-plain></gen-style-plain>',
      '    </div>',
      '  );',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'app', 'components', 'proof-live-page.tsx'),
    [
      "import { defineIslandConfig } from '@openelement/router';",
      '',
      'export const openElement = defineIslandConfig({',
      "  tag: 'gen-style-live-page',",
      "  root: 'shadow',",
      '});',
      '',
      'export default function ProofLivePage() {',
      '  return (',
      "    <div class='proof-live'>",
      '      <gen-style-card></gen-style-card>',
      '    </div>',
      '  );',
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
  await write(
    join(appDir, 'app', 'routes', 'live.tsx'),
    [
      "import { definePage } from '@openelement/router';",
      "import ProofLivePage from '../components/proof-live-page.tsx';",
      '',
      'export default definePage(ProofLivePage, {',
      "  renderIntent: { mode: 'dynamic' },",
      '  props() {',
      '    return {};',
      '  },',
      '});',
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
  return appDir;
}

/** Run the real Router build CLI in the fixture app. */
async function runBuild(
  appDir: string,
  extraArgs: readonly string[] = [],
): Promise<{ code: number; output: string }> {
  const build = spawn(process.execPath, [ROUTER_BUILD_CLI, ...extraArgs], { cwd: appDir });
  let output = '';
  build.stdout.on('data', (chunk) => (output += chunk));
  build.stderr.on('data', (chunk) => (output += chunk));
  const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? -1)));
  return { code, output };
}

/** The emitted `.css` asset file names (`dist/client/assets`), sorted. */
async function emittedCssAssets(appDir: string): Promise<string[]> {
  const assetsDir = join(appDir, 'dist', 'client', 'assets');
  if (!existsSync(assetsDir)) return [];
  return (await readdir(assetsDir)).filter((file) => file.endsWith('.css')).sort();
}

/** Every emitted client chunk under `dist/client/islands`, name → bytes. */
async function clientIslandArtifacts(appDir: string): Promise<Map<string, Buffer>> {
  const islandsDir = join(appDir, 'dist', 'client', 'islands');
  const files = (await readdir(islandsDir)).filter((file) => file.endsWith('.js')).sort();
  const artifacts = new Map<string, Buffer>();
  for (const file of files) artifacts.set(file, await readFile(join(islandsDir, file)));
  return artifacts;
}

/** Read the generated `dist/server/client-assets.js` manifest (structured data). */
async function readClientAssetManifest(
  appDir: string,
): Promise<{ entry: string; styles: string[] }> {
  const moduleText = await readFile(join(appDir, 'dist', 'server', 'client-assets.js'), 'utf8');
  const body = moduleText.replace('export const clientAssets', 'const clientAssets');
  return new Function(`${body}; return clientAssets;`)() as {
    entry: string;
    styles: string[];
  };
}

/** The chunk file name that carries one island tag, or undefined. */
function islandChunkName(artifacts: ReadonlyMap<string, Buffer>, tag: string): string | undefined {
  return [...artifacts.keys()].find((name) => name.startsWith(`island-${tag}-`));
}

let appDir: string;
let styledBuild: { code: number; output: string };
let plainBuild: { code: number; output: string };
let styledArtifacts: Map<string, Buffer>;
let plainArtifacts: Map<string, Buffer>;
let styledCssAssets: string[];
let styledCssBytes: Map<string, string>;
let plainCssAssets: string[];
let styledManifest: { entry: string; styles: string[] };
let plainManifest: { entry: string; styles: string[] };
/** Build A's rendered page + request-time server entry (captured before build B). */
let styledHtml: string;
let styledServerEntry: string;
/** Build B's rendered page (a styled island declaration must add no link). */
let plainHtml: string;

beforeAll(async () => {
  appDir = await createFixture();

  // Build A: the styled island declares its sheet through the sidecar.
  styledBuild = await runBuild(appDir);
  expect(styledBuild.code, `styled fixture build failed:\n${styledBuild.output}`).toBe(0);
  styledArtifacts = await clientIslandArtifacts(appDir);
  styledCssAssets = await emittedCssAssets(appDir);
  styledCssBytes = new Map();
  for (const file of styledCssAssets) {
    styledCssBytes.set(
      file,
      await readFile(join(appDir, 'dist', 'client', 'assets', file), 'utf8'),
    );
  }
  styledManifest = await readClientAssetManifest(appDir);
  // Capture build A's rendered artifacts before build B overwrites the output.
  styledHtml = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  styledServerEntry = await readFile(join(appDir, 'dist', 'server', 'entry.js'), 'utf8');

  // Build B: the SAME fixture, with the declaration removed. The island source
  // line count changes (so that island's own chunk hash may change), while the
  // unstyled sibling's module is byte-identical source and must stay
  // byte-identical output.
  await write(
    join(appDir, 'app', 'islands', `${STYLED_TAG}.tsx`),
    generatedIslandSource(STYLED_TAG),
  );
  plainBuild = await runBuild(appDir);
  expect(plainBuild.code, `unstyled fixture build failed:\n${plainBuild.output}`).toBe(0);
  plainArtifacts = await clientIslandArtifacts(appDir);
  plainCssAssets = await emittedCssAssets(appDir);
  plainManifest = await readClientAssetManifest(appDir);
  plainHtml = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
}, 300_000);

afterAll(async () => {
  for (const root of fixtureRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

test('light-root generated island: the declared sheet is a real content-addressed build asset', () => {
  expect(styledBuild.code).toBe(0);
  expect(styledCssAssets).toHaveLength(1);
  const cssFile = styledCssAssets[0]!;
  const css = styledCssBytes.get(cssFile)!;
  // Content-addressed, exactly like every class-lane sheet: the file name is
  // the hash of the bytes the asset actually serves.
  expect(styleAssetFileName(css).replace('assets/', '')).toBe(cssFile);
  // One pipeline, one scope decision: the island's tag rides as the light-root
  // scope tag, so the asset is the native `@scope (<tag>)` projection a
  // light-root class component's authored sheet gets.
  const compact = css.replace(/\s+/g, '');
  expect(compact).toContain(`@scope(${STYLED_TAG})`);
  expect(compact).toContain('.gen-style-card{color:#010203}');
  expect(compact).toContain('.card-title{font-weight:700}');
  // The manifest records the preloadable style URL under the configured base.
  expect(styledManifest.styles).toEqual([`${BASE}client/${styleAssetFileName(css)}`]);
});

test('light-root generated island: the static document head declares the emitted sheet', () => {
  expect(styledBuild.code).toBe(0);
  const cssFile = styledCssAssets[0]!;
  const href = `${BASE}client/assets/${cssFile}`;
  const head = styledHtml.slice(0, styledHtml.indexOf('</head>'));
  // Parser-visible, marked, exactly once in the head: the document is the light
  // root's delivery, and the marker is what the client's adoption guard reads.
  expect(head.split(`href="${href}" data-oe-static-styles`).length - 1).toBe(1);
  // Exactly one declaration in the WHOLE document — no duplicate delivery.
  expect(styledHtml.split(`href="${href}" data-oe-static-styles`).length - 1).toBe(1);
  // The light host is the plain tag the compiler emits (no SSR producer, so no
  // DSD template and no inline framework stylesheet papers over the link).
  expect(styledHtml).toContain(`<${STYLED_TAG}></${STYLED_TAG}>`);
  expect(/<style[^>]*data-oe-static-styles/.test(styledHtml)).toBe(false);
});

test('light-root generated island: the request-time entry carries the same route→sheet fact', () => {
  expect(styledBuild.code).toBe(0);
  const cssFile = styledCssAssets[0]!;
  const href = `${BASE}client/assets/${cssFile}`;
  // ONE fact, two renderers: the generated request-time server artifact carries
  // the literal data channel the shared document renderer seeds into the head,
  // and the live route's seed reads its own key.
  expect(styledServerEntry).toContain('__routeDocumentStyleLinks');
  expect(styledServerEntry).toContain(href);
  expect(styledServerEntry).toContain('"/live"');
});

test('without any styles declaration the document declares no marked link', () => {
  expect(plainBuild.code).toBe(0);
  expect(plainHtml.includes('data-oe-static-styles')).toBe(false);
});

test('the emitted island chunks carry no CSS text (zero-inline guarantee)', () => {
  expect(styledBuild.code).toBe(0);
  for (const tag of [STYLED_TAG, PLAIN_TAG]) {
    const chunkName = islandChunkName(styledArtifacts, tag);
    expect(chunkName, `island chunk for ${tag}`).toBeDefined();
    const code = styledArtifacts.get(chunkName!)!.toString('utf8');
    for (const marker of [
      'color:#010203',
      'color:rgb(1,2,3)',
      '.gen-style-card{',
      'font-weight:700',
    ]) {
      expect(code.includes(marker), `${chunkName} must not carry CSS text ${marker}`).toBe(false);
    }
  }
});

test("a client-only island's styles declaration adds its sheet import — and nothing to the shared chunks", () => {
  expect(plainBuild.code).toBe(0);
  expect(styledBuild.code).toBe(0);
  // 2026-11-20 (the `ssr: false` client style-adoption slice): the fixture's
  // styled island is CLIENT-ONLY by default (`ssr: false`), so its declaration
  // now adds the module-graph edge its sheet needs — a real `.css` import that
  // the router's style intercept answers with the sheet adapter, plus the
  // descriptor `styles` row the shell adopts. This test used to pin the
  // opposite ("zero JS bytes"), which was true only while the declaration was
  // pure build metadata: the same island rendered completely unstyled in the
  // browser. The declaration is still ONE fact — the emitted asset, the client
  // asset manifest entry and the server-side document link are untouched.
  const styledIslandName = islandChunkName(styledArtifacts, STYLED_TAG);
  const plainIslandName = islandChunkName(plainArtifacts, STYLED_TAG);
  expect(styledIslandName).toBeDefined();
  expect(plainIslandName).toBeDefined();
  expect(plainIslandName).not.toEqual(styledIslandName);
  const styledChunk = styledArtifacts.get(styledIslandName!)!.toString('utf8');
  // The emitted import resolved to the ONE content-addressed asset: the adapter
  // in the chunk fetches exactly the file the build emitted and the manifest
  // records (no second asset, no inlined CSS text).
  const cssFile = styledCssAssets[0]!;
  expect(styledChunk).toContain(cssFile);
  expect(styledChunk).not.toContain('color:#010203');
  // Every OTHER island and shared chunk stays byte-identical: the declaration
  // adds work to the island that declares it, never to a sibling or the
  // runtime.
  for (const [name, bytes] of plainArtifacts) {
    if (name === 'client.js') continue; // the entry's island-chunk map names the hashes
    if (name === plainIslandName) continue;
    expect(styledArtifacts.has(name), `${name} must exist in the styled build`).toBe(true);
    expect(styledArtifacts.get(name)!.equals(bytes), `${name} must be byte-identical`).toBe(true);
  }
  // The unstyled sibling is the consumer-form instance of the same fact.
  const styledPlainName = islandChunkName(styledArtifacts, PLAIN_TAG);
  const plainPlainName = islandChunkName(plainArtifacts, PLAIN_TAG);
  expect(styledPlainName).toBeDefined();
  expect(plainPlainName).toEqual(styledPlainName);
  expect(plainArtifacts.get(plainPlainName!)!.equals(styledArtifacts.get(styledPlainName!)!)).toBe(
    true,
  );
});

test('without any styles declaration no stylesheet asset is emitted and the manifest records none', () => {
  expect(plainBuild.code).toBe(0);
  expect(plainCssAssets).toEqual([]);
  expect(plainManifest.styles).toEqual([]);
});

test('a styled shadow generated island builds and declares the marked DSD link', async () => {
  // M09-2e / #1803, real Router CLI build: the shadow island is SSR-admitted
  // and its class page renders it through the generated entry. The emitted
  // server HTML must carry the canonical marked link INSIDE the DSD template,
  // before the authored content, and the link must name the emitted asset.
  const app = await createFixture();
  await write(
    join(app, 'app', 'islands', `${STYLED_TAG}.tsx`),
    generatedIslandSource(STYLED_TAG, { styles: true, root: 'shadow', ssr: true }),
  );
  const build = await runBuild(app);
  expect(build.code, `styled shadow build failed:\n${build.output}`).toBe(0);

  const assets = await emittedCssAssets(app);
  expect(assets).toHaveLength(1);
  // A shadow-root edge ships the authored bytes verbatim (no `@scope` wrapper):
  // the single emitted asset IS the sheet, never a scoped projection.
  const expectedAsset = await readFile(join(app, 'dist', 'client', 'assets', assets[0]!), 'utf8');
  expect(expectedAsset).not.toContain('@scope');
  expect(expectedAsset).toContain('.gen-style-card');

  const html = await readFile(join(app, 'dist', 'index.html'), 'utf8');
  const hostOpen = html.indexOf(`<${STYLED_TAG}`);
  expect(hostOpen).toBeGreaterThan(-1);
  const templateOpen = html.indexOf('<template shadowrootmode="open">', hostOpen);
  const link = html.indexOf('<link rel="stylesheet"', templateOpen);
  const content = html.indexOf('<article class="gen-style-card">', templateOpen);
  expect(templateOpen).toBeGreaterThan(hostOpen);
  expect(link).toBeGreaterThan(templateOpen);
  expect(content).toBeGreaterThan(link);
  expect(html.slice(link, content)).toContain(`href="${BASE}client/assets/${assets[0]!}"`);
  expect(html.slice(link, content)).toContain('data-oe-static-styles');
  // Exactly one link for this host: the claim's prefix walk consumes the same
  // node the server declared, never a duplicate.
  expect((html.slice(hostOpen, content).match(/<link rel="stylesheet"/g) ?? []).length).toBe(1);
  // The emitted client asset manifest records the sheet too (same plan, no
  // second pipeline).
  const manifest = await readClientAssetManifest(app);
  expect(manifest.styles).toContain(`${BASE}client/assets/${assets[0]!}`);
}, 240_000);
