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
 *     package island (@openelement/ui's open-callout, via its package
 *     manifest — the same pattern the reference site uses) each attribute to
 *     exactly one emitted chunk, and the per-page island manifests carry the
 *     joined chunk URLs.
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
      '// declares open-callout exactly as the reference site consumes it.',
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
    join(appDir, 'app', 'islands', 'oe-proof-counter.tsx'),
    [
      '/** Local island of the external-consumer proof fixture. */',
      "import { defineIslandConfig } from '@openelement/router';",
      "import { element, OpenElement, property } from '@openelement/element';",
      "import { conditionTarget } from '@acme/conditions';",
      "import { flavor } from '@acme/conditions/flavor';",
      "import { sharedTag } from '@shared/tag.ts';",
      '',
      "export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });",
      '',
      "@element('oe-proof-counter', { root: 'shadow-open' })",
      'export default class OeProofCounter extends OpenElement {',
      '  @property({ reflect: false, attribute: false })',
      "  proofSource = 'proof-counter-source';",
      '',
      '  // Plain class code: the compiled render grammar takes literals, so the',
      '  // imported condition value is observed here, outside the render grammar.',
      '  connectedCallback(): void {',
      '    super.connectedCallback();',
      "    this.setAttribute('data-proof', `${conditionTarget}:${sharedTag}:${flavor}`);",
      '  }',
      '',
      '  render() {',
      "    return <span class='source'>{this.proofSource}</span>;",
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  await write(
    join(appDir, 'app', 'components', 'proof-page.tsx'),
    [
      '/** Page component referencing both islands by tag. */',
      "import { element, OpenElement } from '@openelement/element';",
      '',
      "@element('oe-proof-page', { root: 'shadow-open' })",
      'export default class ProofPage extends OpenElement {',
      '  render() {',
      '    return (',
      "      <div class='proof'>",
      '        <oe-proof-counter></oe-proof-counter>',
      "        <open-callout type='info' label='Note'>External consumer proof.</open-callout>",
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
      'export default definePage(ProofPage, { renderIntent: { mode: ' + "'static'" + ' } });',
      '',
    ].join('\n'),
  );
  // A dynamic route forces the request-time SSR bundle (dist/server) so the
  // import-condition target of the exports map is exercised for real.
  // The dynamic route gets its OWN page class: definePage attaches the
  // descriptor to the class itself, so a shared class would carry whichever
  // descriptor evaluated last.
  await write(
    join(appDir, 'app', 'components', 'proof-live-page.tsx'),
    [
      '/** Dynamic-route page component (own class, own descriptor). */',
      "import { element, OpenElement } from '@openelement/element';",
      '',
      "@element('oe-proof-live-page', { root: 'shadow-open' })",
      'export default class ProofLivePage extends OpenElement {',
      '  render() {',
      "    return <div class='proof-live'>request-time proof</div>;",
      '  }',
      '}',
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
  // The workspace vite is the app's vite. The generated server entry imports
  // hono directly, so the app declares it — the same declaration a pnpm
  // consumer makes (pnpm does not hoist transitive dependencies).
  await symlink(join(REPO_ROOT, 'node_modules', 'vite'), join(appDir, 'node_modules', 'vite'));
  await symlink(
    join(REPO_ROOT, 'packages', 'router', 'node_modules', 'hono'),
    join(appDir, 'node_modules', 'hono'),
  );

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
  const calloutChunk = clientIslands.find((file) => file.startsWith('island-open-callout'));
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
  const calloutEntry = entries.find((entry) => entry.tagName === 'open-callout');
  expect(counterEntry?.chunkUrl).toEqual(`/client/islands/${counterChunk}`);
  expect(calloutEntry?.chunkUrl).toEqual(`/client/islands/${calloutChunk}`);
});

test('external consumer: the client chunk bundles the browser condition and the alias target', async () => {
  const distDir = join(fixture.appDir, 'dist');
  const clientIslands = await readdir(join(distDir, 'client', 'islands'));
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
});

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
  expect(homeHtml).not.toContain('condition-browser-target');
});
