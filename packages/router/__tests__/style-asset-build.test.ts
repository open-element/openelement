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
import { styleAssetFileName, styleAssetHash } from '../src/vite/internal/style-assets.ts';

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

const fixtureRoots: string[] = [];

async function write(joinPath: string, content: string): Promise<void> {
  await mkdir(joinPath.slice(0, joinPath.lastIndexOf('/')), { recursive: true });
  await writeFile(joinPath, content, 'utf8');
}

function islandSource(tag: string): string {
  const className = tag
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return [
    '/** Styled island of the style-edge proof fixture (#1558). */',
    "import { defineIslandConfig } from '@openelement/router';",
    "import { element, OpenElement } from '@openelement/element';",
    `import sheet from './${tag}.css';`,
    '',
    "export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true });",
    '',
    `@element('${tag}', { root: 'shadow-open' })`,
    `export default class ${className} extends OpenElement {`,
    '  static override styles = [sheet];',
    '  render() {',
    `    return <div class='${tag === 'oe-style-c' ? 'c-rule' : 'shared-rule'}'>${tag}</div>;`,
    '  }',
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
      'export default defineConfig({ plugins: [openElement()] });',
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
  await write(
    join(appDir, 'app', 'components', 'proof-page.tsx'),
    [
      '/** Page component referencing all three islands by tag. */',
      "import { element, OpenElement } from '@openelement/element';",
      '',
      "@element('oe-style-page', { root: 'shadow-open' })",
      'export default class ProofPage extends OpenElement {',
      '  render() {',
      '    return (',
      "      <div class='proof'>",
      '        <oe-style-a></oe-style-a>',
      '        <oe-style-b></oe-style-b>',
      '        <oe-style-c></oe-style-c>',
      '      </div>',
      '    );',
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'app', 'components', 'proof-live-page.tsx'),
    [
      '/** Dynamic-route page component (forces the request-time server entry). */',
      "import { element, OpenElement } from '@openelement/element';",
      '',
      "@element('oe-style-live-page', { root: 'shadow-open' })",
      'export default class ProofLivePage extends OpenElement {',
      '  render() {',
      "    return <div class='proof-live'>request-time proof</div>;",
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

test('the emitted .css assets exist with the exact sheet bytes', async () => {
  const assetsDir = join(appDir, 'dist', 'client', 'assets');
  const cssFiles = (await readdir(assetsDir)).filter((file) => file.endsWith('.css'));
  // Content-addressed: the two islands sharing bytes reuse ONE asset.
  const sharedName = styleAssetFileName(SHARED_SHEET).replace('assets/', '');
  const cName = styleAssetFileName(C_SHEET).replace('assets/', '');
  expect(cssFiles.sort()).toEqual([cName, sharedName]);
  expect(await readFile(join(assetsDir, sharedName), 'utf8')).toEqual(SHARED_SHEET);
  expect(await readFile(join(assetsDir, cName), 'utf8')).toEqual(C_SHEET);
});

test('the client asset manifest records the deduplicated styles preload URLs', async () => {
  const moduleText = await readFile(join(appDir, 'dist', 'server', 'client-assets.js'), 'utf8');
  const body = moduleText.replace('export const clientAssets', 'const clientAssets');
  const manifest = new Function(`${body}; return clientAssets;`)() as {
    entry: string;
    styles: string[];
  };
  expect(manifest.entry).toMatch(/^\/client\/islands\/.*\.js$/);
  // Two distinct sheets, one URL each — the shared sheet appears once.
  expect(manifest.styles).toEqual([
    `/client/${styleAssetFileName(C_SHEET)}`,
    `/client/${styleAssetFileName(SHARED_SHEET)}`,
  ]);
});

test('the prerendered DSD style text is byte-equal to the emitted assets', async () => {
  const html = await readFile(join(appDir, 'dist', 'index.html'), 'utf8');
  const dsdTexts = [...html.matchAll(/<style data-oe-static-styles>([\s\S]*?)<\/style>/g)].map(
    (match) => match[1],
  );
  // One DSD node per styled island instance: shared twice, c once.
  expect(dsdTexts).toHaveLength(3);
  const sharedAsset = await readFile(
    join(appDir, 'dist', 'client', styleAssetFileName(SHARED_SHEET)),
    'utf8',
  );
  const cAsset = await readFile(
    join(appDir, 'dist', 'client', styleAssetFileName(C_SHEET)),
    'utf8',
  );
  expect(dsdTexts.filter((text) => text === sharedAsset)).toHaveLength(2);
  expect(dsdTexts.filter((text) => text === cAsset)).toHaveLength(1);
  // And the DSD bytes hash to the same content hash the client build
  // recorded — the drift reconciliation, observed in the deployable tree.
  expect(styleAssetHash(sharedAsset)).toEqual(styleAssetHash(SHARED_SHEET));
  expect(styleAssetHash(cAsset)).toEqual(styleAssetHash(C_SHEET));
});
