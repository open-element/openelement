/**
 * packages/router/__tests__/style-asset-build.test.ts — the style-edge
 * protocol's consumer-form proof (#1558, after the file-based authoring
 * retirement; seams.md "Island stylesheet asset" row).
 *
 * A temporary fixture app OUTSIDE this repository is built through the real
 * Router build CLI in a plain Node child process — the same harness as
 * external-consumer-build.test.ts — and the DEPLOYABLE TREE is scanned the
 * way downstream consumers see it:
 *
 *   - island chunks carry NO component CSS text: the compiled island modules
 *     import sheet adapters over authored `.css` files, not stylesheet bytes
 *     (the zero-inline guarantee's consumer form);
 *   - the emitted `.css` assets exist under dist/client/assets with the
 *     exact bytes of the authored files;
 *   - the client asset manifest records the preloadable style URLs (the
 *     `styles` field, read from the generated dist/server/client-assets.js);
 *   - islands carrying identical sheet bytes reuse ONE asset (content
 *     hash = the cache key), and the manifest URL set is deduplicated;
 *   - the prerendered DSD `<style data-oe-static-styles>` text is byte-equal
 *     to the corresponding emitted asset — the server read derives from the
 *     same artifact the client sheet serves, so DSD and adopted styles
 *     cannot drift.
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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { styleAssetFileName } from '../src/vite/internal/style-assets.ts';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const ROUTER_BUILD_CLI = join(REPO_ROOT, 'packages', 'router', 'src', 'cli', 'build.ts');

/** Sheets authored to round-trip the SSR rule parser byte-for-byte (one rule
 * per line, no nested braces, trailing newline): the DSD text is the parsed
 * rules joined with '\n', so byte-equality with the asset proves the same
 * artifact feeds both channels. */
const SHARED_SHEET = `:host { display: grid; }
.shared-rule { color: red; }
`;
const C_SHEET = `:host { display: block; }
.c-rule { color: blue; }
`;
/** The unreferenced island's sheet — distinct bytes, so its asset cannot be
 * confused with a sheet some page already reaches (S-C1.4, #1609). */
const UNREFERENCED_SHEET = `:host { display: inline; }
.d-rule { color: green; }
`;

const fixtureRoots: string[] = [];

async function write(joinPath: string, content: string): Promise<void> {
  await mkdir(joinPath.slice(0, joinPath.lastIndexOf('/')), { recursive: true });
  await writeFile(joinPath, content, 'utf8');
}

function islandSource(tag: string): string {
  return [
    '/** Styled island of the style-edge proof fixture (#1558). */',
    "import { defineIslandConfig } from '@openelement/router';",
    '',
    // GENERATED lane (F16: class → function): the class's `static override
    // styles = [sheet]` over a `.css` default import becomes the sidecar's
    // `styles` list, resolved relative to this module. `root: 'shadow-open'`
    // maps to `'shadow'` — the same open DSD root, which is also what makes
    // this module's sheet a shadow edge (verbatim bytes, no `@scope`).
    'export const openElement = defineIslandConfig({',
    `  tag: '${tag}',`,
    "  hydrate: 'idle',",
    '  ssr: true,',
    "  root: 'shadow',",
    `  styles: ['./${tag}.css'],`,
    '});',
    '',
    `export default function ${componentName(tag)}() {`,
    `  return <div class='${tag === 'oe-style-c' ? 'c-rule' : 'shared-rule'}'>${tag}</div>;`,
    '}',
    '',
  ].join('\n');
}

/** The default export's function name for one tag (the class lane's class name). */
function componentName(tag: string): string {
  return tag
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * A CLIENT-ONLY styled island, referenced by the page.
 *
 * The class lane delivered every island's sheet through a module-graph adapter
 * in the island's own chunk, because `static styles` bound the sheet object at
 * module scope. The generated lane splits the delivery by root/SSR shape: an
 * SSR shadow island declares its sheet as a marked `<link>` inside its DSD
 * template, and only a CLIENT-ONLY island — which has no template — carries the
 * chunk-level adapter. This island is what keeps the chunk-adapter half of the
 * zero-inline guarantee measured; it reuses `C_SHEET` bytes on purpose, so the
 * content-addressed asset set stays exactly the three sheets the suite counts.
 */
function clientOnlyIslandSource(): string {
  return [
    '/** Client-only styled island (the chunk-level sheet adapter). */',
    "import { defineIslandConfig } from '@openelement/router';",
    '',
    'export const openElement = defineIslandConfig({',
    "  tag: 'oe-style-e',",
    "  hydrate: 'only',",
    '  ssr: false,',
    "  root: 'shadow',",
    "  styles: ['./oe-style-e.css'],",
    '});',
    '',
    'export default function OeStyleE() {',
    "  return <div class='c-rule'>oe-style-e</div>;",
    '}',
    '',
  ].join('\n');
}

/**
 * An island the fixture DECLARES and no page references (S-C1.4, #1609): the
 * generated SSR entry imports its module — the entry registers every admitted
 * tag, so the tag can render in server markup — which puts its `.css` edge in
 * the SSR build's graph. The client build must therefore emit its sheet
 * (external, content-addressed, recorded in the manifest), while the rendered
 * page declares NO link for it: nothing rendered the tag.
 */
function unreferencedIslandSource(): string {
  return [
    '/** Declared island no page references (S-C1.4, #1609). */',
    "import { defineIslandConfig } from '@openelement/router';",
    '',
    'export const openElement = defineIslandConfig({',
    "  tag: 'oe-style-d',",
    "  hydrate: 'idle',",
    '  ssr: true,',
    "  root: 'shadow',",
    "  styles: ['./oe-style-d.css'],",
    '});',
    '',
    'export default function OeStyleD() {',
    "  return <div class='d-rule'>oe-style-d</div>;",
    '}',
    '',
  ].join('\n');
}

async function buildFixture(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'oe-style-asset-'));
  // Node resolution answers realpaths (macOS /var vs /private/var).
  const root = await realpath(created);
  fixtureRoots.push(created);
  const appDir = join(root, 'app');

  await write(
    join(appDir, 'package.json'),
    JSON.stringify({ name: 'oe-style-asset-proof', private: true, type: 'module' }),
  );
  await write(
    join(appDir, 'vite.config.ts'),
    [
      "import { openElement } from '@openelement/router/vite';",
      "import { defineConfig } from 'vite';",
      '',
      // A non-root production base: every emitted URL, manifest entry and
      // rendered `<link>` must carry it (S-C1.3 follow-up).
      "export default defineConfig({ base: '/sub/', plugins: [openElement()] });",
      '',
    ].join('\n'),
  );
  // Two islands importing the IDENTICAL sheet bytes (multi-island reuse; the
  // shared sheet is its own .css file both import) and one with its own.
  await write(join(appDir, 'app', 'islands', 'shared-sheet.css'), SHARED_SHEET);
  await write(join(appDir, 'app', 'islands', 'oe-style-a.css'), SHARED_SHEET);
  await write(join(appDir, 'app', 'islands', 'oe-style-b.css'), SHARED_SHEET);
  await write(join(appDir, 'app', 'islands', 'oe-style-c.css'), C_SHEET);
  await write(join(appDir, 'app', 'islands', 'oe-style-a.tsx'), islandSource('oe-style-a'));
  await write(join(appDir, 'app', 'islands', 'oe-style-b.tsx'), islandSource('oe-style-b'));
  await write(join(appDir, 'app', 'islands', 'oe-style-c.tsx'), islandSource('oe-style-c'));
  // The client-only island reuses C_SHEET's bytes, so the content-addressed
  // asset set is unchanged: one asset per distinct sheet, not per island.
  await write(join(appDir, 'app', 'islands', 'oe-style-e.css'), C_SHEET);
  await write(join(appDir, 'app', 'islands', 'oe-style-e.tsx'), clientOnlyIslandSource());
  await write(join(appDir, 'app', 'islands', 'oe-style-d.css'), UNREFERENCED_SHEET);
  await write(join(appDir, 'app', 'islands', 'oe-style-d.tsx'), unreferencedIslandSource());
  // The page is a generated SHADOW page root: classification requires the
  // compiler-emitted DSD host producer, which a light root does not have. Its
  // tag is declared because `app/components/` is outside the islands directory.
  await write(
    join(appDir, 'app', 'components', 'proof-page.tsx'),
    [
      '/** Page component referencing all three islands by tag. */',
      "import { defineIslandConfig } from '@openelement/router';",
      '',
      "export const openElement = defineIslandConfig({ tag: 'oe-style-page', root: 'shadow' });",
      '',
      'export default function ProofPage() {',
      '  return (',
      "    <div class='proof'>",
      '      <oe-style-a></oe-style-a>',
      '      <oe-style-b></oe-style-b>',
      '      <oe-style-c></oe-style-c>',
      '      <oe-style-e></oe-style-e>',
      '    </div>',
      '  );',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'app', 'components', 'proof-live-page.tsx'),
    [
      '/** Dynamic-route page component (forces the request-time server entry). */',
      "import { defineIslandConfig } from '@openelement/router';",
      '',
      "export const openElement = defineIslandConfig({ tag: 'oe-style-live-page', root: 'shadow' });",
      '',
      'export default function ProofLivePage() {',
      "  return <div class='proof-live'>request-time proof</div>;",
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
    join(appDir, 'app', 'routes', 'proof-live.tsx'),
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

let appDir: string;
let buildLogs = '';

beforeAll(async () => {
  appDir = await buildFixture();
  const build = spawn(process.execPath, [ROUTER_BUILD_CLI], { cwd: appDir });
  build.stdout.on('data', (chunk) => (buildLogs += chunk));
  build.stderr.on('data', (chunk) => (buildLogs += chunk));
  const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? -1)));
  expect(code, `style-asset fixture build failed:\n${buildLogs}`).toEqual(0);
  if (process.env.OE_KEEP_FIXTURE) console.log(`[fixture] ${appDir}`);
}, 240_000);

afterAll(async () => {
  if (process.env.OE_KEEP_FIXTURE) return;
  for (const root of fixtureRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

test('island chunks carry no component CSS text — only sheet-adapter references', async () => {
  const islandsDir = join(appDir, 'dist', 'client', 'islands');
  const chunks = (await readdir(islandsDir)).filter((file) => file.endsWith('.js'));
  expect(chunks.length).toBeGreaterThan(0);
  const cssMarkers = ['display: grid', 'display: block', 'color: red', 'color: blue'];
  for (const chunk of chunks) {
    const code = await readFile(join(islandsDir, chunk), 'utf8');
    for (const marker of cssMarkers) {
      expect(
        code.includes(marker),
        `${chunk} must not carry CSS text ${JSON.stringify(marker)}`,
      ).toBe(false);
    }
  }
  // The styled islands' chunks reference the emitted assets through the
  // sheet adapters' rewritten file URLs (quoting varies under minification;
  // `new CSSStyleSheet` loses its call parens).
  const styled = await Promise.all(
    chunks.map((chunk) => readFile(join(islandsDir, chunk), 'utf8')),
  );
  const joined = styled.join('\n');
  expect(joined).toContain('new CSSStyleSheet');
  expect(joined).toMatch(/new URL\((["'`])\.\.\/assets\/[0-9a-f]{12}\.css\1, ?import\.meta\.url\)/);
});

test('the emitted .css assets carry the authored rules at content-addressed names', async () => {
  const assetsDir = join(appDir, 'dist', 'client', 'assets');
  const cssFiles = (await readdir(assetsDir)).filter((file) => file.endsWith('.css'));
  // Content-addressed: the two islands sharing bytes reuse ONE asset, and the
  // name is the hash of the bytes the asset actually serves (the emitted text
  // is Vite's own processing of the authored sheet — imports resolved, urls
  // rewritten — so the address describes the served resource, not the source).
  // The third is the declared-but-unreferenced island's sheet (S-C1.4, #1609).
  expect(cssFiles).toHaveLength(3);
  const bodies = await Promise.all(cssFiles.map((file) => readFile(join(assetsDir, file), 'utf8')));
  for (const [index, body] of bodies.entries()) {
    expect(
      styleAssetFileName(body).replace('assets/', ''),
      `${cssFiles[index]} is named after the bytes it serves`,
    ).toEqual(cssFiles[index]);
  }
  const shared = bodies.find((body) => body.includes('.shared-rule'));
  const own = bodies.find((body) => body.includes('.c-rule'));
  expect(shared, 'the shared sheet is emitted once').toBeDefined();
  expect(own, "the island's own sheet is emitted").toBeDefined();
  // The rules survive Vite's processing (whitespace-insensitive comparison).
  expect(shared!.replace(/\s+/g, '')).toMatch(/\.shared-rule\{color:(red|#f00)\}/);
  expect(own!.replace(/\s+/g, '')).toMatch(/\.c-rule\{color:(blue|#00f)\}/);
  expect(shared!.replace(/\s+/g, '')).toContain(':host{display:grid}');
});

/**
 * The RED consumer for the discovery gap S-C1.4 shipped with (#1609, packed
 * `@openelement/ui` consumer): an island module the generated SSR entry imports
 * but no page references. Its `.css` edge is in the SSR build's graph, so the
 * asset must exist — and it must NOT be declared in the rendered page, because
 * nothing rendered the tag: admission is resource-level, the declarative
 * `<link>` stays per rendered instance.
 */
test('an island the SSR entry imports but no page references still emits its sheet', async () => {
  const assetsDir = join(appDir, 'dist', 'client', 'assets');
  const cssFiles = (await readdir(assetsDir)).filter((file) => file.endsWith('.css'));
  const bodies = await Promise.all(cssFiles.map((file) => readFile(join(assetsDir, file), 'utf8')));
  const unreferenced = bodies.find((body) => body.includes('.d-rule'));
  expect(unreferenced, 'the unreferenced island sheet is emitted').toBeDefined();

  const moduleText = await readFile(join(appDir, 'dist', 'server', 'client-assets.js'), 'utf8');
  const body = moduleText.replace('export const clientAssets', 'const clientAssets');
  const manifest = new Function(`${body}; return clientAssets;`)() as { styles: string[] };
  const emittedHref = `/sub/client/${styleAssetFileName(unreferenced!)}`;
  expect(manifest.styles, 'the emitted asset is recorded in the manifest').toContain(emittedHref);

  const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  // No HOST rendered the tag. The resource is admitted at the RESOURCE level
  // (emitted + manifested above), which is exactly the distinction this row
  // exists to pin: the island's sheet ships, yet no DSD template was produced for
  // a host nobody wrote.
  expect(html, 'nothing rendered the unreferenced tag').not.toContain('<oe-style-d');
});

test('the client asset manifest records the deduplicated styles preload URLs', async () => {
  const moduleText = await readFile(join(appDir, 'dist', 'server', 'client-assets.js'), 'utf8');
  const body = moduleText.replace('export const clientAssets', 'const clientAssets');
  const manifest = new Function(`${body}; return clientAssets;`)() as {
    entry: string;
    styles: string[];
  };
  expect(manifest.entry).toBe('/sub/client/islands/client.js');
  // Three distinct sheets (the shared sheet appears once, and the
  // declared-but-unreferenced island's sheet is admitted like any other), one
  // URL each — every URL base-prefixed and present on disk.
  expect(manifest.styles).toHaveLength(3);
  for (const href of manifest.styles) {
    expect(href).toMatch(/^\/sub\/client\/assets\/[0-9a-f]{12}\.css$/);
    await readFile(join(appDir, 'dist', href.slice('/sub/'.length)), 'utf8');
  }
});

test('the prerendered DSD declares the emitted assets as external resources (S5-C)', async () => {
  const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  // The authored sheets are NOT inlined any more: the DSD templates declare
  // them as marked, parser-visible `<link>`s (the client build's
  // content-addressed asset), and no framework style node remains.
  expect(html, 'no inlined framework stylesheet').not.toContain('<style data-oe-static-styles>');

  /** The marked hrefs declared by the template that starts at `openIndex`. */
  const templateAt = (openIndex: number): string => {
    const start = html.indexOf('<template shadowrootmode="open">', openIndex);
    expect(start, 'the host rendered a DSD template').toBeGreaterThan(openIndex);
    return html.slice(start, html.indexOf('</template>', start));
  };
  const hrefsIn = (markup: string): string[] =>
    [...markup.matchAll(/<link rel="stylesheet" href="([^"]+)" data-oe-static-styles \/>/g)].map(
      (match) => match[1]!,
    );

  /** Every marked href is an emitted, correctly content-addressed asset. */
  const assertEmitted = async (href: string): Promise<void> => {
    expect(href).toMatch(/^\/sub\/client\/assets\/[0-9a-f]{12}\.css$/);
    const body = await readFile(join(appDir, 'dist', href.slice('/sub/'.length)), 'utf8');
    expect(styleAssetFileName(body)).toEqual(href.slice('/sub/client/'.length));
  };

  // Each styled SHADOW island's own template declares ITS sheet: the sheet is a
  // shadow-tree resource, so the template is the only delivery that reaches it.
  for (const [tag, rule] of [
    ['oe-style-a', '.shared-rule'],
    ['oe-style-b', '.shared-rule'],
    ['oe-style-c', '.c-rule'],
  ] as const) {
    const own = templateAt(html.indexOf(`<${tag}>`));
    const declared = hrefsIn(own);
    expect(declared.length, `<${tag}> declares a stylesheet`).toBeGreaterThan(0);
    const bodies = await Promise.all(
      [...new Set(declared)].map(async (href) => {
        await assertEmitted(href);
        return [href, await readFile(join(appDir, 'dist', href.slice('/sub/'.length)), 'utf8')];
      }),
    );
    expect(
      bodies.filter(([, body]) => body!.includes(rule)).map(([href]) => href),
      `<${tag}> declares the sheet that carries its own rules`,
    ).not.toHaveLength(0);
  }

  // The two instances of the SHARED sheet address ONE emitted asset — the hash
  // is the cache key, so identical bytes cannot ship twice.
  const sharedCss = (await readdir(join(appDir, 'dist', 'client', 'assets')))
    .filter((file) => file.endsWith('.css'))
    .filter((file) => file !== undefined);
  const sharedAssets = (
    await Promise.all(
      sharedCss.map(async (file) => ({
        file,
        body: await readFile(join(appDir, 'dist', 'client', 'assets', file), 'utf8'),
      })),
    )
  ).filter((entry) => entry.body.includes('.shared-rule'));
  expect(sharedAssets, 'the shared sheet is emitted once').toHaveLength(1);
});
