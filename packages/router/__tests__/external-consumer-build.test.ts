/**
 * packages/router/__tests__/external-consumer-build.test.ts — the plain Node
 * external-consumer build proof.
 *
 * A temporary fixture app OUTSIDE this repository is built through the real
 * Router build CLI in a plain Node child process — no Vitest resolver, no
 * test-runner module graph, no experimental flags. The fixture proves the
 * consumer surface the shipped package promises:
 *
 *   - pnpm-style symlink layout: node_modules carries symlinks to the
 *     workspace packages and to a fixture package stored outside the app
 *     directory, exactly like a pnpm store;
 *   - browser/import/require conditional exports: the client build bundles
 *     the browser target, the SSR bundle the import target, and the require
 *     target appears in neither;
 *   - a user resolve.alias: the aliased module is bundled into the island
 *     chunk the alias was imported from (the alias table travels from the
 *     outer resolved Vite config into the client build);
 *   - island chunks and the client asset manifest: the local island and the
 *     package island (@openelement/ui's open-button, via its package
 *     manifest — the same pattern the reference site uses) each attribute to
 *     exactly one emitted chunk, and the per-page island manifests carry the
 *     joined chunk URLs.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
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
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { serveFetch } from '../src/internal/node-http.ts';
import { createFetchHandler } from '../src/vite/internal/static-serve.ts';
import type { BrowserEntryGraphArtifact } from '../src/vite/internal/browser-entry-graph-artifact.ts';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const ROUTER_BUILD_CLI = join(REPO_ROOT, 'packages', 'router', 'src', 'cli', 'build.ts');

interface Fixture {
  appDir: string;
}

const fixtureRoots: string[] = [];

async function write(joinPath: string, content: string): Promise<void> {
  await mkdir(joinPath.slice(0, joinPath.lastIndexOf('/')), { recursive: true });
  await writeFile(joinPath, content, 'utf8');
}

async function buildFixture(): Promise<Fixture> {
  const created = await mkdtemp(join(tmpdir(), 'oe-external-consumer-'));
  // Node resolution answers realpaths, so every expected module id must be
  // built from the real root (macOS tmpdir() hands out a /var/... path whose
  // realpath is /private/var).
  const root = await realpath(created);
  fixtureRoots.push(created);
  const appDir = join(root, 'app');

  // The linked island/condition package, outside the app dir — a pnpm store
  // layout: node_modules carries a symlink into it.
  const conditionsPkg = join(root, 'store', '@acme', 'conditions');
  await write(
    join(conditionsPkg, 'package.json'),
    JSON.stringify(
      {
        name: '@acme/conditions',
        version: '1.0.0',
        type: 'module',
        exports: {
          '.': {
            browser: './dist/browser.mjs',
            import: './dist/import.mjs',
            require: './dist/require.cjs',
          },
          './flavor': {
            // Only a custom resolve condition names this target: the client
            // build bundling it proves the captured resolve.conditions list
            // (not the client defaults) drives package-island resolution.
            'oe-proof-flavor': './dist/flavor-custom.mjs',
            import: './dist/flavor-import.mjs',
          },
        },
      },
      null,
      2,
    ),
  );
  // Each condition target ships a distinguishable marker: the build must
  // bundle exactly the condition its environment names.
  await write(
    join(conditionsPkg, 'dist', 'browser.mjs'),
    "export const conditionTarget = 'condition-browser-target';\n",
  );
  await write(
    join(conditionsPkg, 'dist', 'import.mjs'),
    "export const conditionTarget = 'condition-import-target';\n",
  );
  await write(
    join(conditionsPkg, 'dist', 'require.cjs'),
    "module.exports = { conditionTarget: 'condition-require-target' };\n",
  );
  await write(
    join(conditionsPkg, 'dist', 'flavor-custom.mjs'),
    "export const flavor = 'flavor-custom-target';\n",
  );
  await write(
    join(conditionsPkg, 'dist', 'flavor-import.mjs'),
    "export const flavor = 'flavor-import-target';\n",
  );

  // The consumer app.
  await write(
    join(appDir, 'package.json'),
    JSON.stringify({ name: 'oe-proof-app', private: true, type: 'module' }),
  );
  await write(
    join(appDir, 'openelement.config.ts'),
    [
      "import { defineConfig } from '@openelement/router';",
      '',
      '// Package islands come from the real workspace UI package — its manifest',
      '// declares open-button exactly as the reference site consumes it.',
      'export default defineConfig({ packageIslands: [',
      "  '@openelement/ui',",
      '] });',
      '',
    ].join('\n'),
  );
  // The user alias is the consumer's own vite config decision — the client
  // build must honor it through the resolved-config capture.
  await write(
    join(appDir, 'vite.config.ts'),
    [
      "import { openElement } from '@openelement/router/vite';",
      "import { defineConfig } from 'vite';",
      '',
      'export default defineConfig({',
      '  resolve: {',
      '    alias: {',
      "      '@shared': new URL('./app/shared', import.meta.url).pathname,",
      '    },',
      '    // A custom browser condition: only a client build carrying the',
      "    // resolved config's condition list can resolve '@acme/conditions/flavor'",
      '    // to the custom target.',
      "    conditions: ['oe-proof-flavor', 'module', 'browser', 'development|production'],",
      '  },',
      '  environments: {',
      "    client: { resolve: { extensions: ['.ts', '.js', '.jsx', '.tsx', '.mjs', '.mts', '.json'] } },",
      "    ssr: { resolve: { extensions: ['.jsx', '.js', '.ts', '.tsx', '.mjs', '.mts', '.json'] } },",
      '  },',
      '  plugins: [openElement()],',
      '});',
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'app', 'shared', 'tag.ts'),
    "export const sharedTag = 'shared-alias-target';\n",
  );
  await write(
    join(appDir, 'app/shared/environment-priority.ts'),
    "export const extensionPriority = 'client-extension-priority';\n",
  );
  await write(
    join(appDir, 'app/shared/environment-priority.js'),
    "export const extensionPriority = 'server-extension-priority';\n",
  );
  await write(
    join(appDir, 'app/shared/proof-authoring.js'),
    `export const itemLabels = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
];
export const formatLabel = (label) => label?.trim() ?? 'Untitled';
`,
  );
  await write(
    join(appDir, 'app/shared/proof-authoring-barrel.js'),
    `export { itemLabels, formatLabel as labelFor } from './proof-authoring.js';
`,
  );
  await write(
    join(appDir, 'app/shared/proof-copy.ts'),
    `export type ProofLabel = string;
export const readProofLabel = (label: ProofLabel): string => label;
`,
  );
  await write(
    join(appDir, 'app/shared/proof-copy-barrel.ts'),
    `export type { ProofLabel } from './proof-copy.ts';
export { readProofLabel as proofText } from './proof-copy.ts';
`,
  );
  // B2 gap (a) fixture shape: a module this island reaches ONLY through a
  // nested dynamic `import()` of its own. This is the www `open-search` shape
  // — it is what makes the bundler inject the preload helper into the ISLAND
  // chunk rather than leaving it to the entry, and therefore what makes the
  // entry acquire a static island edge (and the runtime with it) unless the
  // helper is given its own eager chunk. Deliberately NOT under `app/islands/`
  // so the island-directory grouping rule does not claim it: the point is a
  // nested dynamic edge, not a new island.
  await write(
    join(appDir, 'app', 'shared', 'proof-lazy-gadget.ts'),
    "export const lazyGadgetMarker = 'proof-lazy-gadget-target';\n",
  );
  await write(
    join(appDir, 'app', 'islands', 'oe-proof-counter.tsx'),
    [
      '/** Local island of the external-consumer proof fixture. */',
      "import { defineIslandConfig } from '@openelement/router';",
      "import { onConnect } from '@openelement/element';",
      "import { conditionTarget } from '@acme/conditions';",
      "import { flavor } from '@acme/conditions/flavor';",
      "import { sharedTag } from '@shared/tag.ts';",
      "import { extensionPriority } from '../shared/environment-priority';",
      "import { proofText } from '../shared/proof-copy-barrel.ts';",
      "import type { ProofLabel } from '../shared/proof-copy-barrel.ts';",
      '',
      'export const openElement = defineIslandConfig({',
      "  tag: 'oe-proof-counter',",
      "  root: 'shadow',",
      "  hydrate: 'idle',",
      '  ssr: true,',
      '  dsd: true,',
      "  properties: { proofSource: { attribute: false, default: 'proof-counter-source' } },",
      '});',
      '',
      'export default function OeProofCounter(props: { proofSource: string }) {',
      '  // The nested dynamic import itself (B2 gap (a)). Never awaited by the',
      '  // assertions — its only job is to exist in the emitted island chunk, and',
      "  // `onConnect` is the generated lane's activation point (it is where the",
      "  // class lane's `connectedCallback` and both hydration hooks went).",
      '  onConnect(() => {',
      "    void import('@shared/proof-lazy-gadget.ts');",
      '  });',
      '',
      '  // The imported condition values are observed on a host ATTRIBUTE so the',
      '  // resolution reaches the emitted terminal bytes. A module-scope statement',
      '  // is not part of the admitted component grammar: the generated lane lowers',
      '  // the component body, not arbitrary top-level side effects.',
      "  return <span class='source' data-proof={`${conditionTarget}:${sharedTag}:${flavor}:${extensionPriority}`}>{proofText(props.proofSource as ProofLabel)}</span>;",
      '}',
      '',
    ].join('\n'),
  );
  // A SERVER FUNCTION PAGE, not a generated page component: the route module
  // declares the component itself, so nothing in this page's module graph
  // declares an element sidecar and the page therefore owns no island chunk of
  // its own. The two components it RENDERS are islands (one local, one from the
  // admitted package), and they are what the assertions below attribute.
  await write(
    join(appDir, 'app', 'routes', 'index.tsx'),
    [
      "import { definePage } from '@openelement/router';",
      '',
      'export function ProofPage() {',
      '  return (',
      "    <div class='proof'>",
      '      <oe-proof-counter></oe-proof-counter>',
      "      <open-button variant='primary'>External consumer proof.</open-button>",
      '    </div>',
      '  );',
      '}',
      '',
      "export default definePage(ProofPage, { renderIntent: { mode: 'static' } });",
      '',
    ].join('\n'),
  );
  // A dynamic route forces the request-time SSR bundle (dist/server) so the
  // import-condition target of the exports map is exercised for real.
  // The dynamic route gets its OWN page class: definePage attaches the
  // descriptor to the class itself, so a shared class would carry whichever
  // descriptor evaluated last.
  await write(
    join(appDir, 'app', 'routes', 'proof-live.tsx'),
    [
      "import { definePage } from '@openelement/router';",
      '',
      'export function ProofLivePage() {',
      "  return <div class='proof-live'>request-time proof</div>;",
      '}',
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

  // #1544/B2: a PRERENDERED page with no island at all — the zero-island half
  // of the runtime-preload projection. A generated page COMPONENT cannot be
  // island-free (its declared sidecar tag is an island by construction), so the
  // honest zero-island form is a server function page: the route module declares
  // the component, and nothing in the graph declares an element sidecar.
  await write(
    join(appDir, 'app', 'routes', 'proof-static.tsx'),
    [
      "import { definePage } from '@openelement/router';",
      '',
      'export function ProofStaticPage() {',
      "  return <div class='proof-static'>zero-island proof</div>;",
      '}',
      '',
      "export default definePage(ProofStaticPage, { renderIntent: { mode: 'static' } });",
      '',
    ].join('\n'),
  );

  await write(
    join(appDir, 'app/components/jsx-heading.jsx'),
    `export const JsxHeading = () => <h1>JSX authoring</h1>;
`,
  );
  await write(
    join(appDir, 'app/components/jsx-heading.tsx'),
    `export const ExactHeading = () => <h2>Explicit TSX import</h2>;
`,
  );
  await write(
    join(appDir, 'app/components/jsx-heading.js'),
    `export const JsxHeading = 'This is an ordinary value, not a JSX component';
`,
  );
  await write(
    join(appDir, 'app/components/jsx-aside.jsx'),
    `import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'oe-jsx-aside', root: 'shadow', ssr: true });
export default function Aside() {
  return <aside>Discovered JSX component</aside>;
}
`,
  );
  await write(
    join(appDir, 'app/islands/oe-jsx-list.jsx'),
    `import { computed, signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
import { itemLabels, labelFor } from '../shared/proof-authoring-barrel.js';

export const openElement = defineIslandConfig({
  root: 'shadow',
  hydrate: 'load',
  ssr: true,
  properties: { heading: { default: 'Default JSX list' } },
});

function Panel(props) {
  return <section aria-label={props.title}>{props.children}</section>;
}

/** @param {{ heading: string }} props */
export default function JsxList(props) {
  const flipped = signal(false);
  const items = computed(() => flipped.value ? [...itemLabels].reverse() : itemLabels);
  return (
    <Panel title={props.heading}>
      <button type="button" onClick={() => { flipped.value = !flipped.value; }}>Reverse</button>
      {flipped.value && <p>Reversed</p>}
      <ul>{items.value.map((item) => <li key={item.id}>{labelFor(item.label)}</li>)}</ul>
    </Panel>
  );
}
`,
  );
  await write(
    join(appDir, 'app/routes/proof-jsx.jsx'),
    `import { definePage } from '@openelement/router';
import { JsxHeading as Heading } from '../components/jsx-heading';
import { ExactHeading } from '../components/jsx-heading.tsx';
import '../components/jsx-aside.jsx';

export function JsxPage() {
  return <main><Heading /><ExactHeading /><oe-jsx-list heading="JSX list"></oe-jsx-list><oe-jsx-aside></oe-jsx-aside></main>;
}

export default definePage(JsxPage, { renderIntent: { mode: 'static' } });
`,
  );

  // pnpm-style symlinks: the app's node_modules links the workspace packages
  // and the store package. Realpath resolution keeps every module id
  // machine-real while the layout stays a consumer layout.
  await mkdir(join(appDir, 'node_modules', '@openelement'), { recursive: true });
  await mkdir(join(appDir, 'node_modules', '@acme'), { recursive: true });
  // Absolute targets: the store layout is what makes this pnpm-style (the
  // app's node_modules entries are symlinks, resolved to realpaths), and the
  // workspace checkout lies outside the fixture tree.
  await symlink(
    join(REPO_ROOT, 'packages', 'router'),
    join(appDir, 'node_modules', '@openelement', 'router'),
  );
  await symlink(
    join(REPO_ROOT, 'packages', 'element'),
    join(appDir, 'node_modules', '@openelement', 'element'),
  );
  await symlink(
    join(REPO_ROOT, 'packages', 'ui'),
    join(appDir, 'node_modules', '@openelement', 'ui'),
  );
  await symlink(
    '../../../store/@acme/conditions',
    join(appDir, 'node_modules', '@acme', 'conditions'),
  );
  // The workspace vite is the app's vite. The generated server entry composes
  // on the internal WinterCG layer (#1560) and imports no hono — the build
  // must succeed with NO hono copy in the consumer's node_modules.
  await symlink(join(REPO_ROOT, 'node_modules', 'vite'), join(appDir, 'node_modules', 'vite'));

  return { appDir };
}

let fixture: Fixture;
let buildLogs = '';

beforeAll(async () => {
  fixture = await buildFixture();
  // Plain Node child process — the same launcher the fixture harnesses and
  // generated projects use. No test-runner resolver, no experimental flags.
  const build = spawn(process.execPath, [ROUTER_BUILD_CLI], { cwd: fixture.appDir });
  build.stdout.on('data', (chunk) => (buildLogs += chunk));
  build.stderr.on('data', (chunk) => (buildLogs += chunk));
  const code = await new Promise<number>((resolve) => build.on('exit', (c) => resolve(c ?? -1)));
  expect(code, `external consumer build failed:\n${buildLogs}`).toEqual(0);
  if (process.env.OE_KEEP_FIXTURE) console.log(`[fixture] ${fixture.appDir}`);
}, 240_000);

afterAll(async () => {
  // OE_KEEP_FIXTURE=1 keeps the temp tree for artifact inspection.
  if (process.env.OE_KEEP_FIXTURE) return;
  for (const root of fixtureRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

test('external consumer: both islands attribute to exactly one emitted chunk each', async () => {
  const distDir = join(fixture.appDir, 'dist');
  const clientIslands = await readdir(join(distDir, 'client', 'islands'));
  // The local island chunk (named by the islandsDir rule) and the package
  // island chunk (named by the resolved module identity through the build's
  // own resolver) both exist.
  const counterChunk = clientIslands.find((file) => file.startsWith('island-oe-proof-counter'));
  const calloutChunk = clientIslands.find((file) => file.startsWith('island-open-button'));
  expect(counterChunk, `client islands: ${clientIslands.join(', ')}`).toBeTruthy();
  expect(calloutChunk, `client islands: ${clientIslands.join(', ')}`).toBeTruthy();

  // The per-page island manifest carries the joined chunk URLs — the client
  // asset manifest's identity join, made visible in the deployable tree.
  const manifestsDir = join(distDir, 'island-manifests');
  const manifestFiles = await readdir(manifestsDir);
  const pageManifests = await Promise.all(
    manifestFiles.map((file) => readFile(join(manifestsDir, file), 'utf8')),
  );
  const entries = pageManifests.flatMap((text) => {
    const parsed = JSON.parse(text) as {
      islands: Array<{ tagName: string; chunkUrl: string }>;
    };
    return parsed.islands;
  });
  const counterEntry = entries.find((entry) => entry.tagName === 'oe-proof-counter');
  const calloutEntry = entries.find((entry) => entry.tagName === 'open-button');
  expect(counterEntry?.chunkUrl).toEqual(`/client/islands/${counterChunk}`);
  expect(calloutEntry?.chunkUrl).toEqual(`/client/islands/${calloutChunk}`);
});

test('external consumer: the client chunk bundles the browser condition and the alias target', async () => {
  const distDir = join(fixture.appDir, 'dist');
  const clientIslands = await readdir(join(distDir, 'client', 'islands'));
  // Single-chunk read, as before the executor-split experiment (withdrawn in
  // 07963b738 — this assertion was not rolled back with it). The pre-split
  // layout is back: the counter island's own chunk IS the whole static closure of
  // the modules it reaches, so the condition/alias resolution must be IN that
  // chunk — the assertions judge the client graph's CONTENT, and reading one
  // chunk is the honest unit for a one-importer static edge. Only the counter
  // imports these marker modules, so the test reads its complete static closure.
  const counterChunk = clientIslands.find((file) => file.startsWith('island-oe-proof-counter'))!;
  const code = await readFile(join(distDir, 'client', 'islands', counterChunk), 'utf8');
  // The browser-condition target of @acme/conditions was bundled (not the
  // import or require target), and the user alias resolved into the chunk.
  expect(code).toContain('condition-browser-target');
  expect(code).toContain('shared-alias-target');
  expect(code).not.toContain('condition-import-target');
  expect(code).not.toContain('condition-require-target');
  // The CUSTOM condition from the app's vite config reached the client
  // build: the flavor subpath resolved to the custom target, which the
  // client defaults (no oe-proof-flavor) would never name.
  expect(code).toContain('flavor-custom-target');
  expect(code).not.toContain('flavor-import-target');
  expect(code).toContain('client-extension-priority');
  expect(code).not.toContain('server-extension-priority');
});

test('external consumer: dev SSR resolves the same nested JSX as the production build', async () => {
  const { createServer } = await import('vite');
  const previousCwd = process.cwd();
  process.chdir(fixture.appDir);
  try {
    const vite = await createServer({
      root: fixture.appDir,
      server: { middlewareMode: true, ws: false },
      logLevel: 'silent',
    });
    const server = createHttpServer((request, response) => {
      vite.middlewares(request, response, (error: unknown) => {
        response.statusCode = error ? 500 : 404;
        response.end(error instanceof Error ? error.message : 'Not found');
      });
    });
    try {
      const listening = once(server, 'listening');
      server.listen(0, '127.0.0.1');
      await listening;
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('No loopback address');
      const response = await fetch(`http://127.0.0.1:${address.port}/proof-jsx`);
      const html = await response.text();
      expect(response.status, html).toBe(200);
      expect(html).toContain('<h1>JSX authoring</h1>');
      expect(html).toContain('<h2>Explicit TSX import</h2>');
    } finally {
      try {
        if (server.listening) {
          const closed = once(server, 'close');
          server.close();
          await closed;
        }
      } finally {
        await vite.close();
      }
    }
  } finally {
    process.chdir(previousCwd);
  }
}, 30_000);

test('external consumer: a JSX route prerenders and a JSX island claims and updates in the browser', async () => {
  const distDir = join(fixture.appDir, 'dist');
  const html = await readFile(join(distDir, 'proof-jsx/index.html'), 'utf8');
  expect(html).toContain('<h1>JSX authoring</h1>');
  expect(html).toContain('<h2>Explicit TSX import</h2>');
  expect(html).toContain('Discovered JSX component</aside>');
  expect(html).toContain('<oe-jsx-list heading="JSX list"><template shadowrootmode="open">');
  expect(html).toContain('<section aria-label="JSX list">');
  expect(html).toContain('Alpha');
  expect(html).toContain('Beta');

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const server = serveFetch({
    hostname: '127.0.0.1',
    port: 0,
    handler: createFetchHandler({ distDir }),
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No loopback address');
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.goto(`http://127.0.0.1:${address.port}/proof-jsx/`);
    await page.waitForFunction(() => customElements.get('oe-jsx-list') !== undefined);
    const island = page.locator('oe-jsx-list');
    const panel = island.getByRole('region', { name: 'JSX list' });
    const items = panel.getByRole('listitem');
    expect(await items.allTextContents()).toEqual(['Alpha', 'Beta']);
    const alpha = await items.first().elementHandle();
    await panel.getByRole('button', { name: 'Reverse' }).click();
    await panel.getByText('Reversed').waitFor();
    expect(await items.allTextContents()).toEqual(['Beta', 'Alpha']);
    expect(await items.last().evaluate((node, original) => node === original, alpha)).toBe(true);
    await island.evaluate((host) => host.setAttribute('heading', 'Updated JSX list'));
    await island.getByRole('region', { name: 'Updated JSX list' }).waitFor();
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}, 30_000);

test('external consumer: the SSR bundle and prerendered HTML carry the import condition', async () => {
  const distDir = join(fixture.appDir, 'dist');
  const serverEntry = join(distDir, 'server', 'entry.js');
  const code = await readFile(serverEntry, 'utf8');
  // The node-side environment resolves the import condition target.
  expect(code).toContain('condition-import-target');
  expect(code).toContain('shared-alias-target');
  expect(code).not.toContain('condition-browser-target');
  expect(code).not.toContain('condition-require-target');
  // The prerendered page rendered the island shadow content, and no client
  // (browser-condition) marker leaked into the server-rendered document.
  const homeHtml = await readFile(join(distDir, 'index.html'), 'utf8');
  expect(homeHtml).toContain('proof-counter-source');
  expect(homeHtml).toContain('server-extension-priority');
  expect(homeHtml).not.toContain('client-extension-priority');
  expect(homeHtml).not.toContain('condition-browser-target');
});

test('external consumer (#1544/B2): the runtime preload is a per-page projection and the runtime leaves the entry static graph', async () => {
  const distDir = join(fixture.appDir, 'dist');
  const islandsDir = join(distDir, 'client', 'islands');
  const homeHtml = await readFile(join(distDir, 'index.html'), 'utf8');
  const preloads = [
    ...homeHtml.matchAll(
      /<link rel="modulepreload" href="\/client\/([^"]+)" data-open-element-runtime-preload>/g,
    ),
  ].map((match) => match[1]);
  expect(preloads.length).toBeGreaterThan(0);

  const staticHtml = await readFile(join(distDir, 'proof-static', 'index.html'), 'utf8');
  expect(staticHtml).not.toMatch(/modulepreload|client\.js|data-open-island-prefetch/);

  const graph = JSON.parse(
    await readFile(join(distDir, 'client', '.vite', 'oe-browser-entry-graph.json'), 'utf8'),
  ) as BrowserEntryGraphArtifact;
  expect(graph.status).toBe('complete');
  const chunks = new Map(graph.chunks.map((chunk) => [chunk.file, chunk]));
  function closure(roots: string[]): Set<string> {
    const seen = new Set<string>();
    for (const file of roots) {
      if (seen.has(file)) continue;
      seen.add(file);
      const chunk = chunks.get(file);
      expect(chunk, file).toBeDefined();
      roots.push(...chunk!.imports);
    }
    return seen;
  }
  const eager = closure([graph.entry.chunkFile]);
  const home = closure(
    graph.islands
      .filter((island) => homeHtml.includes(`<${island.tag}`))
      .map((island) => island.chunkFile),
  );
  expect(eager.size).toBeGreaterThan(1);
  for (const preload of preloads) {
    expect(home).toContain(preload);
    expect(eager).not.toContain(preload);
  }
  // Guard against a vacuous pass: the same entry does carry the island wiring
  // and its dynamic island imports.
  const entryCode = await readFile(join(islandsDir, 'client.js'), 'utf8');
  expect(entryCode).toContain('oe-proof-counter');
  expect(entryCode).toMatch(/import\(`?["']?\.\//);
});

test('a native-only package registers both delivery tags without requesting the Element runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-consumer-native-islands-'));
  fixtureRoots.push(root);
  const appDir = join(root, 'app');
  const foreign = join(appDir, 'node_modules', '@acme', 'foreign');
  await write(join(appDir, 'package.json'), '{"name":"native-island-proof","type":"module"}');
  await write(
    join(appDir, 'vite.config.ts'),
    `
import { openElement } from '@openelement/router/vite';
export default { plugins: [openElement({ packageIslands: ['@acme/foreign'], layout: false })] };
`,
  );
  await write(
    join(appDir, 'app/routes/index.tsx'),
    `
import { definePage } from '@openelement/router';
export function Page() {
  return <main><foreign-button></foreign-button><foreign-badge></foreign-badge></main>;
}
export default definePage(Page);
`,
  );
  await write(
    join(foreign, 'package.json'),
    JSON.stringify({
      name: '@acme/foreign',
      type: 'module',
      exports: { './manifest': './manifest.js', './cards': './cards.js' },
    }),
  );
  await write(
    join(foreign, 'manifest.js'),
    `export const manifest = ${JSON.stringify({
      schemaVersion: 1,
      packageName: '@acme/foreign',
      version: '1.0.0',
      declarations: ['foreign-button', 'foreign-badge'].map((tagName, index) => ({
        tagName,
        className: index === 0 ? 'ForeignButton' : 'ForeignBadge',
        openElement: {
          ssr: false,
          dsd: false,
          hydrate: 'only',
          module: '@acme/foreign/cards',
          export: index === 0 ? 'ForeignButton' : 'ForeignBadge',
        },
      })),
    })};`,
  );
  await write(
    join(foreign, 'cards.js'),
    `
export class ForeignButton extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<button type="button">Activate native control</button>';
    this.querySelector('button').addEventListener('click', () => { this.dataset.active = 'true'; });
  }
}
customElements.define('foreign-badge', class extends HTMLElement {
  connectedCallback() { this.textContent = 'Registered by its own module'; }
});
`,
  );
  await symlink(
    join(fixture.appDir, 'node_modules', '@openelement'),
    join(appDir, 'node_modules', '@openelement'),
  );
  await symlink(join(REPO_ROOT, 'node_modules', 'vite'), join(appDir, 'node_modules', 'vite'));

  let logs = '';
  const build = spawn(process.execPath, [ROUTER_BUILD_CLI], { cwd: appDir });
  build.stdout.on('data', (chunk) => (logs += chunk));
  build.stderr.on('data', (chunk) => (logs += chunk));
  const [code] = await once(build, 'exit');
  expect(code, logs).toBe(0);
  const distDir = join(appDir, 'dist');
  const html = await readFile(join(distDir, 'index.html'), 'utf8');
  expect(html).toContain('/client/islands/client.js');
  expect(html).not.toContain('data-open-element-runtime-preload');
  expect(await readdir(join(distDir, 'client', 'islands'))).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/^element-runtime-/)]),
  );

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const server = serveFetch({
    hostname: '127.0.0.1',
    port: 0,
    handler: createFetchHandler({ distDir }),
  });
  try {
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No loopback address');
    const page = await browser.newPage();
    const scripts = new Set<string>();
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.add(new URL(request.url()).pathname);
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByRole('button', { name: 'Activate native control' }).click();
    expect(await page.locator('foreign-button').getAttribute('data-active')).toBe('true');
    expect(await page.locator('foreign-badge').textContent()).toBe('Registered by its own module');
    expect([...scripts].filter((url) => /\/island-/.test(url))).toHaveLength(1);
    expect([...scripts].some((url) => /\/element-runtime-/.test(url))).toBe(false);
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
