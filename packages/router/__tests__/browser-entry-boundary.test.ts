/**
 * @openelement/router — the browser entry's Node boundary (TPL-01).
 *
 * The client build's module graph is the browser's: the generated entry, every
 * island, and everything they import transitively. On HEAD a `node:*` import
 * there is NOT a build failure — Vite's browser resolver replaces it with an
 * empty `__vite-browser-external` stub and only logs "Module node:fs has been
 * externalized for browser compatibility", so the page ships and the feature
 * dies at runtime with no build signal (reproduced: the island fixture exited
 * 0 before the guard). The build boundary must fail closed instead; lint may
 * hint.
 *
 * The proof is three REAL builds of the router CLI on generated fixtures:
 *
 *   island-direct      an island imports `node:fs`               → build fails, code + importer named
 *   island-transitive  an island imports a helper that imports it → build fails (the whole graph, not just direct edges)
 *   loader-node        a route `loader` imports `node:fs/promises` → build PASSES (server-side, zero config)
 *
 * The loader case is the other half of the contract: the check is the CLIENT
 * graph only. A server-side module is allowed to use Node, so the guard is
 * mounted in the client build alone and the SSR/loader graph never sees it.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createServer, optimizeDeps, resolveConfig } from 'vite';
import {
  BrowserEntryBoundaryErrorCode,
  browserEntryBoundaryPlugin,
  isNodeBuiltinSpecifier,
} from '../src/vite/internal/browser-entry-boundary.ts';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const ROUTER_BUILD_CLI = join(REPO_ROOT, 'packages', 'router', 'src', 'cli', 'build.ts');
const CODE = BrowserEntryBoundaryErrorCode.NODE_BUILTIN_IMPORT;
const SERVER_ONLY_CODE = BrowserEntryBoundaryErrorCode.SERVER_ONLY_IMPORT;
const SERVER_ONLY_IMPORT = "import '@openelement/protocol/server-only';";

const fixtureRoots: string[] = [];

async function write(path: string, content: string): Promise<void> {
  await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await writeFile(path, content, 'utf8');
}

const PAGE_CLASS = `import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'probe-home', root: 'shadow' });

export default function ProbeHome() {
  return (
    <main>
      <h1>boundary probe</h1>
      <probe-counter></probe-counter>
    </main>
  );
}
`;

/**
 * The island module, with an optional extra import AND the expression that
 * keeps it reachable.
 *
 * The generated-element emitter only carries the bindings its emitted code
 * references (a side-effect-only `import 'node:fs'` is erased with the rest of
 * the unused binding set), so a fixture that wants the specifier in the CLIENT
 * GRAPH must USE it. `extraUse` is that use, evaluated in the component body —
 * the generated lane's root setup, which the emitter lowers into the retained
 * instance factory.
 */
function islandSource(extraImport: string, extraUse = ''): string {
  return `${extraImport}import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'probe-counter',
  root: 'shadow',
  hydrate: 'load',
  ssr: true,
  dsd: true,
  properties: { count: { attribute: false, default: 0 } },
});

export default function ProbeCounter(props: { count: number }) {
  ${extraUse}
  return <span id="count">{props.count}</span>;
}
`;
}

interface FixtureOptions {
  /** Extra import line prepended to the island module. */
  islandImport?: string;
  /** The body expression that USES `islandImport` (see {@link islandSource}). */
  islandUse?: string;
  /** Write a helper module the island imports and uses. */
  helperImportsNode?: boolean;
  /** The transitive fixture's regular helper imports the protocol marker. */
  helperImportsServerMarker?: boolean;
  /** Route module body (defaults to the plain generated page). */
  routeSource?: string;
}

async function makeFixture(name: string, options: FixtureOptions = {}): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), `oe-browser-boundary-${name}-`));
  const root = await realpath(created);
  fixtureRoots.push(created);

  await write(
    join(root, 'package.json'),
    JSON.stringify({ name: `oe-browser-boundary-${name}`, private: true, type: 'module' }),
  );
  await write(
    join(root, 'vite.config.ts'),
    [
      "import { openElement } from '@openelement/router/vite';",
      "import { defineConfig } from 'vite';",
      '',
      'export default defineConfig({',
      "  base: '/',",
      "  oxc: { jsx: { runtime: 'automatic', importSource: '@openelement/element' } },",
      '  plugins: [...openElement({ layout: false })],',
      '});',
      '',
    ].join('\n'),
  );
  await write(join(root, 'app', 'components', 'probe-home.tsx'), PAGE_CLASS);
  const islandImport =
    options.islandImport ??
    (options.helperImportsNode === true
      ? "import { helperReadsNode } from './probe-helper.ts';\n"
      : '');
  await write(
    join(root, 'app', 'islands', 'probe-counter.tsx'),
    islandSource(islandImport, options.islandUse ?? ''),
  );
  if (options.helperImportsNode === true) {
    await write(
      join(root, 'app', 'islands', 'probe-helper.ts'),
      "import { readFileSync } from 'node:fs';\n\nexport const helperReadsNode = (): number => readFileSync('.').length;\n",
    );
  }
  if (options.helperImportsServerMarker === true) {
    await write(
      join(root, 'app', 'islands', 'probe-helper.ts'),
      `${SERVER_ONLY_IMPORT}\nexport const ordinaryMarker = () => 'server-authored marker';\n` +
        'export type MarkerShape = { label: string };\n',
    );
  }
  await write(
    join(root, 'app', 'routes', 'index.tsx'),
    options.routeSource ??
      [
        "import { definePage } from '@openelement/router';",
        "import ProbeHome from '../components/probe-home.tsx';",
        '',
        "export default definePage(ProbeHome, { head: { title: 'boundary probe' } });",
        '',
      ].join('\n'),
  );

  const nodeModules = join(root, 'node_modules');
  await mkdir(join(nodeModules, '@openelement'), { recursive: true });
  for (const pkg of ['router', 'element', 'compiler', 'protocol']) {
    await symlink(join(REPO_ROOT, 'packages', pkg), join(nodeModules, '@openelement', pkg));
  }
  await symlink(join(REPO_ROOT, 'node_modules', 'vite'), join(nodeModules, 'vite'));
  await symlink(
    join(REPO_ROOT, 'packages', 'router', 'node_modules', 'hono'),
    join(nodeModules, 'hono'),
  );
  const devServer = join(REPO_ROOT, 'node_modules', '@hono', 'vite-dev-server');
  if (existsSync(devServer)) {
    await symlink(devServer, join(nodeModules, '@hono', 'vite-dev-server'));
  }
  return root;
}

interface BuildResult {
  code: number | null;
  output: string;
  root: string;
}

function runBuild(root: string): Promise<BuildResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ROUTER_BUILD_CLI, '--diagnostics=json'], { cwd: root });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('exit', (code) => resolve({ code, output, root }));
  });
}

let direct: BuildResult;
let transitive: BuildResult;
let loader: BuildResult;
let markedDirect: BuildResult;
let markedTransitive: BuildResult;

beforeAll(async () => {
  const directRoot = await makeFixture('direct', {
    islandImport: "import { readFileSync } from 'node:fs';\n",
    islandUse: "const marker = readFileSync('.').length;",
  });
  const transitiveRoot = await makeFixture('transitive', {
    helperImportsNode: true,
    islandUse: 'const marker = helperReadsNode();',
  });
  const loaderRoot = await makeFixture('loader', {
    helperImportsServerMarker: true,
    islandImport: "import type { MarkerShape } from './probe-helper.ts';\n",
    routeSource: [
      SERVER_ONLY_IMPORT,
      "import { readFile } from 'node:fs/promises';",
      "import { definePage } from '@openelement/router';",
      "import ProbeHome from '../components/probe-home.tsx';",
      '',
      'export const loader = async () => ({',
      '  size: (await readFile(new URL(import.meta.url))).length,',
      '});',
      '',
      "export default definePage(ProbeHome, { head: { title: 'loader probe' } });",
      '',
    ].join('\n'),
  });
  const markerRoot = await makeFixture('marked-direct', {
    islandImport: SERVER_ONLY_IMPORT + '\n',
  });
  const helperRoot = await makeFixture('marked-transitive', {
    helperImportsServerMarker: true,
    islandImport: "import { ordinaryMarker } from './probe-helper.ts';\n",
    islandUse: 'const marker = ordinaryMarker();',
  });
  [direct, transitive, loader, markedDirect, markedTransitive] = await Promise.all([
    runBuild(directRoot),
    runBuild(transitiveRoot),
    runBuild(loaderRoot),
    runBuild(markerRoot),
    runBuild(helperRoot),
  ]);
}, 240_000);

afterAll(async () => {
  for (const root of fixtureRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

test('the guard matches the node: scheme only', () => {
  expect(isNodeBuiltinSpecifier('node:fs')).toEqual(true);
  expect(isNodeBuiltinSpecifier('node:fs/promises')).toEqual(true);
  expect(isNodeBuiltinSpecifier('node:')).toEqual(false);
  expect(isNodeBuiltinSpecifier('fs')).toEqual(false);
  expect(isNodeBuiltinSpecifier('node-fetch')).toEqual(false);

  const plugin = browserEntryBoundaryPlugin();
  expect(plugin.name).toEqual('open:browser-entry-boundary');
  expect(plugin.enforce).toEqual('pre');
  const resolveId = plugin.resolveId as (source: string, importer?: string) => unknown;
  let thrown: unknown;
  try {
    resolveId('node:fs', '/app/islands/x.tsx');
  } catch (error) {
    thrown = error;
  }
  expect((thrown as { code?: string }).code).toEqual(CODE);
  expect((thrown as Error).message).toContain('node:fs');
  expect((thrown as Error).message).toContain('/app/islands/x.tsx');
  expect(resolveId('fs', '/app/islands/x.tsx')).toEqual(null);
  expect(resolveId('./local.ts', '/app/islands/x.tsx')).toEqual(null);
});

test('an island importing node:* fails the build with the coded diagnostic', () => {
  expect(direct.code, direct.output).not.toEqual(0);
  expect(direct.output).toContain(CODE);
  expect(direct.output).toContain('"node:fs"');
  expect(direct.output).toContain('app/islands/probe-counter.tsx');
});

test('a transitive node:* import fails the build too (the whole client graph)', () => {
  expect(transitive.code, transitive.output).not.toEqual(0);
  expect(transitive.output).toContain(CODE);
  expect(transitive.output).toContain('app/islands/probe-helper.ts');
});

test('a route loader importing node:* still builds: the server graph is not the browser graph', async () => {
  expect(loader.code, loader.output).toEqual(0);
  expect(existsSync(join(loader.root, 'dist', 'index.html'))).toBeTruthy();
  // The island still made it into the client build — the pass is not "no
  // client graph at all".
  const islands = (await readdir(join(loader.root, 'dist', 'client', 'islands'))).filter((name) =>
    name.startsWith('island-probe-counter'),
  );
  expect(islands.length).toBeGreaterThan(0);
});

test('authored server-only markers reject direct side-effect and transitive imports', () => {
  for (const [result, file] of [
    [markedDirect, 'app/islands/probe-counter.tsx'],
    [markedTransitive, 'app/islands/probe-helper.ts'],
  ] as const) {
    expect(result.code, result.output).not.toEqual(0);
    expect(result.output).toContain(SERVER_ONLY_CODE);
    expect(result.output).toContain(file);
    const json = result.output
      .split('\n')
      .find((line) => line.includes('openelement.diagnostics/1'));
    expect(JSON.parse(json ?? '{}').diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: SERVER_ONLY_CODE,
          hint: expect.stringContaining('server loader'),
        }),
      ]),
    );
  }
});

test('development prebundling refuses a dependency that imports the marker', async () => {
  const root = await makeFixture('optimized');
  const dependency = join(root, 'node_modules', 'marked-label');
  await write(
    join(dependency, 'package.json'),
    JSON.stringify({ name: 'marked-label', type: 'module', exports: './index.js' }),
  );
  await write(
    join(dependency, 'index.js'),
    `${SERVER_ONLY_IMPORT}\nexport const label = 'ordinary example';\n`,
  );
  const config = await resolveConfig(
    {
      root,
      configLoader: 'native',
      optimizeDeps: { include: ['marked-label'], noDiscovery: true },
    },
    'serve',
  );
  await expect(optimizeDeps(config, true)).rejects.toThrow(SERVER_ONLY_CODE);
});

test('development checks browser imports and admits the server loader', async () => {
  for (const { root, file, code, helper } of [
    { root: direct.root, file: 'app/islands/probe-counter.tsx', code: CODE },
    { root: transitive.root, file: 'app/islands/probe-helper.ts', code: CODE, helper: true },
    { root: markedDirect.root, file: 'app/islands/probe-counter.tsx', code: SERVER_ONLY_CODE },
    {
      root: markedTransitive.root,
      file: 'app/islands/probe-helper.ts',
      code: SERVER_ONLY_CODE,
      helper: true,
    },
    { root: loader.root, file: 'app/routes/index.tsx' },
  ]) {
    const dev = await createServer({
      root,
      configLoader: 'native',
      server: { middlewareMode: true },
    });
    try {
      if (root === loader.root) {
        const resolved = await dev.ssrLoadModule('/' + file);
        expect(typeof resolved.loader).toBe('function');
      } else {
        if (helper) {
          const island = await dev.transformRequest('/app/islands/probe-counter.tsx');
          expect(island?.code).toContain('probe-helper.ts');
        }
        await expect(dev.transformRequest('/' + file)).rejects.toThrow(code!);
      }
    } finally {
      await dev.close();
    }
  }
}, 30000);
