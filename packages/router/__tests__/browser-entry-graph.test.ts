/**
 * @openelement/router — M10-P1 browser-entry module-graph evidence.
 *
 * The claim under test (plan §12a, ADR-0174 scope): **no production browser
 * entry LOADS the generic Part Program executor**. The evidence is the
 * observer plugin mounted in the real client build plus the checker that
 * evaluates its artifact. This suite proves the tool rather than the tree:
 * the tree is expected red today, and P1 is NOT claimed here.
 *
 * Real-build proof matrix (no synthetic all-green fixture is the only
 * evidence — every positive/negative below is a real Vite/Rolldown build):
 *
 *   T1  real router CLI build of a class-island app → the artifact is emitted,
 *       deterministic/normalized, and VIOLATED with named executor entries.
 *   T2  direct Vite build of the generated-element shell + neutral primitives
 *       (write:false) → MET; report categories still listed.
 *   T3  an unused re-export of `convertToAttribute` from `facade-host.ts` →
 *       parsed-only executor residue recorded, loaded set MET, checker exit 0.
 *   T4  exact identity: a `node_modules/probe/facade-host.ts` copy is NOT the
 *       element executor entry (no suffix matching).
 *   T5  forged artifacts derived from T1/T2 (missing/malformed/incomplete/
 *       absolute/dangling/unreachable/self-inconsistent) → checker UNPROVEN
 *       exit 2; a forged "green" summary cannot hide a loaded violation.
 *   T6  observer purity: chunk file names, module ids, imports/dynamicImports
 *       and chunk code sha256 are identical with and without the plugin.
 *   T7  determinism: two plugin builds produce byte-identical artifacts.
 *
 * Fixtures are programmatic temp directories at the repo root (`.tmp-*`,
 * Git-ignored). They live INSIDE the workspace so the real router build finds
 * the same `pnpm-workspace.yaml` anchor and every emitted id normalizes to a
 * workspace-relative spelling — the artifact must never carry a machine path.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { build as viteBuild } from 'vite';
import { browserEntryGraphPlugin } from '../src/vite/internal/browser-entry-graph.ts';
import {
  BROWSER_ENTRY_GRAPH_ARTIFACT_FILE,
  EXECUTOR_ENTRY_RELATIVE_MODULES,
  STYLE_ASSET_VIRTUAL_MODULE_PREFIX,
  browserEntryGraphGateListDigest,
  evaluateBrowserEntryGraphArtifact,
  executorEntryModuleIds,
  isNormalizedBrowserEntryGraphModuleId,
  type BrowserEntryGraphArtifact,
} from '../src/vite/internal/browser-entry-graph-artifact.ts';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const ELEMENT_ROOT = join(REPO_ROOT, 'packages', 'element');
const ROUTER_BUILD_CLI = join(REPO_ROOT, 'packages', 'router', 'src', 'cli', 'build.ts');
const CHECKER_CLI = join(REPO_ROOT, 'tools', 'repo', 'check-browser-entry-graph.ts');
const TMP_PREFIX = join(REPO_ROOT, '.tmp-browser-entry-graph-');
const GRAPH_ASSET = BROWSER_ENTRY_GRAPH_ARTIFACT_FILE;

const fixtureRoots: string[] = [];

afterAll(async () => {
  for (const root of fixtureRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Fixtures                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

async function writeFixtureFile(path: string, content: string): Promise<void> {
  await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(TMP_PREFIX);
  fixtureRoots.push(root);
  return root;
}

/** Symlink the workspace packages a real router build resolves through npm layout. */
async function linkRouterPackages(root: string): Promise<void> {
  const nodeModules = join(root, 'node_modules');
  await mkdir(join(nodeModules, '@openelement'), { recursive: true });
  for (const pkg of ['router', 'element', 'compiler', 'protocol']) {
    await symlink(join(REPO_ROOT, 'packages', pkg), join(nodeModules, '@openelement', pkg), 'dir');
  }
  await symlink(join(REPO_ROOT, 'node_modules', 'vite'), join(nodeModules, 'vite'), 'dir');
  await symlink(
    join(REPO_ROOT, 'packages', 'router', 'node_modules', 'hono'),
    join(nodeModules, 'hono'),
    'dir',
  );
  const devServer = join(REPO_ROOT, 'node_modules', '@hono', 'vite-dev-server');
  if (existsSync(devServer)) {
    await symlink(devServer, join(nodeModules, '@hono', 'vite-dev-server'), 'dir');
  }
}

/**
 * The fixture's page — a SERVER FUNCTION PAGE, so it contributes NO island.
 *
 * The class page this replaces was a compiled page CLASS: a route artifact, not
 * an island. The generated lane has no island-free page COMPONENT (a declared
 * sidecar makes the module an island by construction), so the same "one island,
 * one page" fixture shape is spelled as the route module declaring its own
 * component. That keeps `artifact.islands` measuring the island the suite is
 * about instead of also counting the page.
 */
const PAGE_SOURCE = `import { definePage } from '@openelement/router';

export function ProbeHome() {
  return (
    <main>
      <h1>module graph probe</h1>
      <probe-counter></probe-counter>
    </main>
  );
}

export default definePage(ProbeHome, { head: { title: 'module graph probe' } });
`;

/**
 * The fixture island — VIOLATED BY CONSTRUCTION, through the one door the
 * generated lane still leaves open.
 *
 * The class lane reached the generic Part Program executor because every
 * compiled class RENDERED through its kernel, so any class island's chunk
 * closure contained the executor entries. That path is gone: a generated
 * element mounts through the shell and touches no Part Program. What remains is
 * the package ROOT barrel — `@openelement/element` is flagged `sideEffects`
 * (it installs the hydration and Block edges) and re-exports `renderToString`,
 * so a client module that imports a RUNTIME value from the root drags
 * `runtime-program.ts` / `runtime/hydrate.ts` / `runtime/program-kernel.ts`
 * into the island's chunk. That is the documented P1 cost of the root-barrel
 * error-boundary surface, and the exact class this observer exists to catch.
 *
 * The leak rides a plain helper module rather than the component body: the
 * compiler's tracked-slot classification (correctly) refuses an unclassified
 * root-barrel binding inside JSX, and a real application reaches the barrel
 * from ordinary module code.
 */
const ISLAND_HELPER = `import { renderToString } from '@openelement/element';

export const helperReachesTheRootBarrel = typeof renderToString;
`;

/**
 * The island module, parameterized by its hydration strategy.
 *
 * `hydrate: 'only'` (client-only) is what makes the sheet a MODULE-GRAPH edge:
 * with no server render there is no DSD template to declare the `<link>` in, so
 * the emitted module carries a real `./probe-counter.css` import and the style
 * plan turns it into a `\0oe-style-asset:` graph id. An SSR/DSD island's sheet
 * rides the marked `<link>` inside its template instead, and its chunk carries
 * no style edge at all — so the strategy is a fixture parameter, not a detail.
 */
function islandSource(hydrate: string, ssr: boolean, dsd: boolean): string {
  return `import { defineIslandConfig } from '@openelement/router';
import { helperReachesTheRootBarrel } from './probe-helper.ts';

export const openElement = defineIslandConfig({
  tag: 'probe-counter',
  root: 'shadow',
  hydrate: '${hydrate}',
  ssr: ${ssr},
  dsd: ${dsd},
  styles: ['./probe-counter.css'],
  properties: { count: { attribute: false, default: 0 } },
});

export default function ProbeCounter(props: { count: number }) {
  return <span id="count" data-barrel={helperReachesTheRootBarrel}>{props.count}</span>;
}
`;
}

/** T1's island: client-only, so its authored sheet is a client style edge. */
const ISLAND_CLASS = islandSource('only', false, false);

/** The real router-CLI fixture: one generated island + one generated page. */
async function makeRouterFixture(): Promise<string> {
  const root = await makeTempRoot();
  await writeFixtureFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'oe-browser-graph-router-probe', private: true, type: 'module' }),
  );
  await writeFixtureFile(
    join(root, 'vite.config.ts'),
    [
      "import { openElement } from '@openelement/router/vite';",
      "import { defineConfig } from 'vite';",
      '',
      "export default defineConfig({ base: '/', plugins: [...openElement({ layout: false })] });",
      '',
    ].join('\n'),
  );
  await writeFixtureFile(join(root, 'app', 'islands', 'probe-helper.ts'), ISLAND_HELPER);
  await writeFixtureFile(join(root, 'app', 'islands', 'probe-counter.tsx'), ISLAND_CLASS);
  await writeFixtureFile(
    join(root, 'app', 'islands', 'probe-counter.css'),
    ':host { display: inline-block; }\n',
  );
  await writeFixtureFile(join(root, 'app', 'routes', 'index.tsx'), PAGE_SOURCE);
  await linkRouterPackages(root);
  return root;
}

/** A direct-Vite fixture: one source entry + the element package resolvable. */
async function makeDirectFixture(name: string, entrySource: string): Promise<string> {
  const root = await makeTempRoot();
  await writeFixtureFile(
    join(root, 'package.json'),
    JSON.stringify({ name: `oe-browser-graph-${name}`, private: true, type: 'module' }),
  );
  await writeFixtureFile(join(root, 'src', 'entry.ts'), entrySource);
  const nodeModules = join(root, 'node_modules');
  await mkdir(join(nodeModules, '@openelement'), { recursive: true });
  await symlink(
    join(REPO_ROOT, 'packages', 'element'),
    join(nodeModules, '@openelement', 'element'),
    'dir',
  );
  return root;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Builds                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

interface RouterBuildResult {
  code: number | null;
  output: string;
  root: string;
}

function runRouterBuild(root: string): Promise<RouterBuildResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ROUTER_BUILD_CLI], { cwd: root });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('exit', (code) => resolve({ code, output, root }));
  });
}

interface EmittedChunk {
  fileName: string;
  code: string;
  moduleIds: string[];
  imports: string[];
  dynamicImports: string[];
}

interface DirectBuildResult {
  chunks: EmittedChunk[];
  assets: Map<string, string>;
}

interface BuildOutputItem {
  type?: string;
  fileName?: string;
  code?: string;
  source?: string | Uint8Array;
  modules?: Record<string, unknown>;
  imports?: string[];
  dynamicImports?: string[];
}

function collectDirectBuildOutput(result: unknown): DirectBuildResult {
  const builds = Array.isArray(result) ? result : [result];
  const chunks: EmittedChunk[] = [];
  const assets = new Map<string, string>();
  for (const build of builds) {
    const output = (build as { output?: BuildOutputItem[] } | null)?.output ?? [];
    for (const item of output) {
      if (item.type === 'asset' && typeof item.fileName === 'string') {
        const source = item.source;
        assets.set(
          item.fileName,
          typeof source === 'string' ? source : Buffer.from(source ?? '').toString('utf8'),
        );
        continue;
      }
      if (
        item.type !== 'chunk' ||
        typeof item.fileName !== 'string' ||
        typeof item.code !== 'string'
      ) {
        continue;
      }
      chunks.push({
        fileName: item.fileName,
        code: item.code,
        moduleIds: Object.keys(item.modules ?? {}).sort(),
        imports: [...(item.imports ?? [])].sort(),
        dynamicImports: [...(item.dynamicImports ?? [])].sort(),
      });
    }
  }
  chunks.sort((left, right) =>
    left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0,
  );
  return { chunks, assets };
}

/** Mount the observer exactly as the client build does (minimal direct form). */
function directPluginOptions(root: string): Parameters<typeof browserEntryGraphPlugin>[0] {
  return {
    root,
    outDir: join(root, 'dist', 'client'),
    base: '/',
    workspaceRoot: REPO_ROOT,
    clientEntryModuleId: '\0virtual:open-client-entry',
    getElementPackageRoot: () => ELEMENT_ROOT,
    islands: [],
    islandModuleIds: new Map(),
  };
}

interface DirectBuildOptions {
  root: string;
  entry?: string;
  plugin?: boolean;
  /** Exact module-id alias (test-only): bare specifier → absolute module path. */
  aliases?: Record<string, string>;
}

async function runDirectBuild(options: DirectBuildOptions): Promise<DirectBuildResult> {
  const aliasEntries = Object.entries(options.aliases ?? {}).map(([find, replacement]) => ({
    find,
    replacement,
  }));
  const result = await viteBuild({
    configFile: false,
    root: options.root,
    base: '/',
    logLevel: 'warn',
    ...(aliasEntries.length === 0 ? {} : { resolve: { alias: aliasEntries } }),
    build: {
      write: false,
      minify: false,
      manifest: false,
      rollupOptions: {
        input: { client: options.entry ?? join(options.root, 'src', 'entry.ts') },
        output: {
          format: 'esm',
          entryFileNames: 'islands/[name].js',
          chunkFileNames: 'islands/[name]-[hash].js',
        },
      },
    },
    plugins:
      options.plugin === true ? [browserEntryGraphPlugin(directPluginOptions(options.root))] : [],
  });
  return collectDirectBuildOutput(result);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Shared real builds (T1/T2 artifacts feed T5 too)                          */
/* ────────────────────────────────────────────────────────────────────────── */

const SHELL_ENTRY = [
  "import { createGeneratedElementClass } from '@openelement/element/internal/compiled/generated-element/shell';",
  '// A real side effect: an app build tree-shakes an exports-only entry to an',
  '// empty chunk (measured), so the fixture must keep the shell reachable.',
  'globalThis.__oeBrowserGraphProbe = typeof createGeneratedElementClass;',
  '',
].join('\n');

interface RealEvidence {
  t1: {
    root: string;
    build: RouterBuildResult;
    artifact: BrowserEntryGraphArtifact;
    source: string;
  };
  t2?: { root: string; artifact: BrowserEntryGraphArtifact; source: string };
}

let evidence: RealEvidence | undefined;

function readGraphArtifact(source: string, label: string): BrowserEntryGraphArtifact {
  const evaluation = evaluateBrowserEntryGraphArtifact(JSON.parse(source) as unknown);
  expect(evaluation.reason, `${label}: ${evaluation.detail ?? 'no detail'}`).toBeNull();
  return JSON.parse(source) as BrowserEntryGraphArtifact;
}

test('T1 real router CLI build emits a normalized, VIOLATED browser-entry graph', async () => {
  const root = await makeRouterFixture();
  const build = await runRouterBuild(root);
  expect(build.code, build.output).toBe(0);

  const artifactPath = join(root, 'dist', 'client', GRAPH_ASSET);
  expect(existsSync(artifactPath), `artifact missing; build output:\n${build.output}`).toBe(true);
  const source = await readFile(artifactPath, 'utf8');
  expect(source.endsWith('\n')).toBe(true);

  // No machine paths, no fixture roots, no secrets-shaped spellings.
  expect(source).not.toContain(REPO_ROOT);
  expect(source).not.toContain('/Users/');
  expect(source).not.toContain('/private/');
  expect(source).not.toContain('file://');

  const artifact = readGraphArtifact(source, 'T1');
  expect(artifact.app.root.startsWith('.tmp-browser-entry-graph-')).toBe(true);
  expect(artifact.app.outDir).toBe('dist/client');
  expect(artifact.app.base).toBe('/');
  expect(artifact.element.packageRoot).toBe('packages/element');
  expect(artifact.entry.moduleId).toBe('\0virtual:open-client-entry');
  expect(artifact.entry.chunkFile).toBe('islands/client.js');
  expect(artifact.islands).toHaveLength(1);
  expect(artifact.islands[0]!.tag).toBe('probe-counter');
  expect(artifact.islands[0]!.moduleId).toMatch(
    /\.tmp-browser-entry-graph-[^/]+\/app\/islands\/probe-counter\.tsx$/u,
  );
  expect(artifact.islands[0]!.chunkFile).toMatch(/^islands\/island-probe-counter/u);
  expect(artifact.parsedModuleIds.length).toBeGreaterThan(0);
  expect(artifact.predicate.gateListDigest).toBe(browserEntryGraphGateListDigest());

  // Every module id in the artifact is normalized (no raw absolute ids).
  for (const chunk of artifact.chunks) {
    for (const moduleRecord of chunk.modules) {
      expect(isNormalizedBrowserEntryGraphModuleId(moduleRecord.id), moduleRecord.id).toBe(true);
      expect(moduleRecord.renderedLength).toBeGreaterThanOrEqual(0);
    }
  }
  // Tree-shaken modules may be listed with renderedLength 0, but the emitted
  // graph the browser downloads must have a rendered floor.
  expect(
    artifact.chunks.some((chunk) => chunk.modules.some((module) => module.renderedLength > 0)),
  ).toBe(true);
  // Dynamic/implicit chunk edges are materialized, not dropped.
  expect(artifact.chunks.some((chunk) => chunk.dynamicImports.length > 0)).toBe(true);

  // B1 privacy: the style-asset graph id is base64url of the sheet's ABSOLUTE
  // path in the bundler. The artifact must carry the decoded, workspace-anchored
  // spelling — never the opaque id and never the machine path.
  const allArtifactIds = [
    ...artifact.parsedModuleIds,
    ...artifact.chunks.flatMap((chunk) => chunk.modules.map((module) => module.id)),
    ...artifact.chunks.map((chunk) => chunk.facadeModuleId ?? ''),
  ];
  const styleAssetIds = allArtifactIds.filter((id) =>
    id.startsWith(STYLE_ASSET_VIRTUAL_MODULE_PREFIX),
  );
  expect(styleAssetIds.length, 'the fixture must exercise a real style-asset edge').toBeGreaterThan(
    0,
  );
  for (const id of styleAssetIds) {
    expect(id).toMatch(
      /^\0oe-style-asset:file:\.tmp-browser-entry-graph-[^/]+\/app\/islands\/probe-counter\.css$/u,
    );
  }
  for (const id of allArtifactIds) {
    expect(id).not.toContain('/Users/');
    expect(id).not.toContain(REPO_ROOT);
  }

  const evaluation = evaluateBrowserEntryGraphArtifact(artifact);
  expect(evaluation.verdict).toBe('VIOLATED');
  expect(evaluation.violations.length).toBeGreaterThan(0);
  const gateIds = new Set(executorEntryModuleIds(artifact.element.packageRoot));
  for (const violation of evaluation.violations) {
    expect(gateIds.has(violation.moduleId), violation.moduleId).toBe(true);
    expect(artifact.chunks.some((chunk) => chunk.file === violation.chunkFile)).toBe(true);
  }
  // The island's chunk closure contains the executor chunk: the violation is
  // attributable to the island, not to an unreachable module.
  expect(
    evaluation.violations.some((violation) => violation.islands.includes('probe-counter')),
    JSON.stringify(evaluation.violations, null, 2),
  ).toBe(true);

  // The checker's real CLI agrees, and names an executor entry in its output.
  // Output discipline: a failing human run keeps stdout (the data channel)
  // empty — the verdict block moves to stderr, and the structured verdict
  // lives in the `--json` machine document.
  const artifactArg = relative(REPO_ROOT, artifactPath);
  const checked = await runChecker([artifactArg]);
  expect(checked.code, checked.stderr).toBe(1);
  expect(checked.stdout).toBe('');
  expect(checked.stderr).toContain('VIOLATED');
  expect(checked.stderr).toContain('loaded ');

  const cliReport = JSON.parse((await runChecker(['--json', artifactArg])).stdout) as {
    format: string;
    exitCode: number;
    artifacts: Array<{
      verdict: string;
      violations: Array<{ moduleId: string; islands: string[] }>;
    }>;
    summary: { met: number; violated: number; unproven: number };
  };
  expect(cliReport.format).toBe('openelement.browser-entry-graph-check/1');
  expect(cliReport.exitCode).toBe(1);
  expect(cliReport.summary).toEqual({ met: 0, violated: 1, unproven: 0 });
  expect(cliReport.artifacts).toHaveLength(1);
  expect(cliReport.artifacts[0]!.verdict).toBe('VIOLATED');
  expect(
    cliReport.artifacts[0]!.violations.some((violation) => gateIds.has(violation.moduleId)),
    JSON.stringify(cliReport.artifacts[0]!.violations),
  ).toBe(true);

  evidence = { t1: { root, build, artifact, source } };
});

test('T2 real Vite build of the generated shell + neutral primitives is MET', async () => {
  const root = await makeDirectFixture('shell-met', SHELL_ENTRY);
  const build = await runDirectBuild({ root, plugin: true });
  const source = build.assets.get(GRAPH_ASSET);
  expect(source, 'the observer must emit its asset in a write:false build').toBeDefined();
  expect(source).not.toContain(REPO_ROOT);

  const artifact = readGraphArtifact(source!, 'T2');
  expect(artifact.entry.chunkFile).toBe('islands/client.js');
  expect(artifact.islands).toEqual([]);
  expect(artifact.element.packageRoot).toBe('packages/element');

  const evaluation = evaluateBrowserEntryGraphArtifact(artifact);
  expect(evaluation.verdict, JSON.stringify(evaluation, null, 2)).toBe('MET');
  expect(evaluation.violations).toEqual([]);
  // The report still shows what the sanctioned leaf path imports.
  expect(evaluation.diagnostics.leafSurface).toContain(
    'packages/element/src/internal/compiled/runtime/recipe.ts',
  );
  expect(evaluation.loadedModuleCount).toBeGreaterThan(0);

  if (evidence !== undefined) {
    evidence.t2 = { root, artifact, source: source! };
  }
});

test('T2b an SSR-only (hydrate:none) island is not an island-attribution input', async () => {
  // A `hydrate: 'none'` island has NO module in the emitted client bundle by
  // design: the generated entry emits no import for it. Feeding it to the
  // island-attribution pass asked the writer to resolve a module that cannot
  // exist there, and the writer's fail-closed contract turned the WHOLE
  // artifact incomplete (`island-chunk-unresolved` / `module-not-in-chunk`),
  // which the checker reports as UNPROVEN rather than a verdict. The build's
  // own `strategy !== 'none'` filter keeps that artifact complete while the
  // writer keeps refusing a genuinely absent island (next test).
  const root = await makeTempRoot();
  await writeFixtureFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'oe-browser-graph-ssr-only', private: true, type: 'module' }),
  );
  await writeFixtureFile(
    join(root, 'vite.config.ts'),
    [
      "import { openElement } from '@openelement/router/vite';",
      "import { defineConfig } from 'vite';",
      '',
      "export default defineConfig({ base: '/', plugins: [...openElement({ layout: false })] });",
      '',
    ].join('\n'),
  );
  await writeFixtureFile(
    join(root, 'app', 'islands', 'probe-counter.tsx'),
    islandSource('none', true, true),
  );
  await writeFixtureFile(join(root, 'app', 'islands', 'probe-helper.ts'), ISLAND_HELPER);
  await writeFixtureFile(
    join(root, 'app', 'islands', 'probe-counter.css'),
    ':host { display: inline-block; }\n',
  );
  // The route is the same page as T1; only the island's strategy differs.
  await writeFixtureFile(join(root, 'app', 'routes', 'index.tsx'), PAGE_SOURCE);
  await linkRouterPackages(root);

  const build = await runRouterBuild(root);
  expect(build.code, build.output).toBe(0);
  const artifactPath = join(root, 'dist', 'client', GRAPH_ASSET);
  expect(existsSync(artifactPath), `artifact missing; build output:\n${build.output}`).toBe(true);
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as BrowserEntryGraphArtifact;

  // The capture completed and the SSR-only island is absent from the island
  // list — not present-with-a-missing-chunk.
  expect(artifact.status, JSON.stringify(artifact, null, 2)).toBe('complete');
  expect(artifact.islands).toEqual([]);
  // A complete capture is a verdict, not UNPROVEN, at the checker boundary.
  const evaluation = evaluateBrowserEntryGraphArtifact(artifact);
  expect(evaluation.reason, evaluation.detail ?? 'no detail').toBeNull();
  expect(evaluation.islandCount).toBe(0);
});

test('T2c the writer still fails closed on a strategy-resolved island with no emitted module', () => {
  // The complement of T2b: the build-side filter must not weaken the writer.
  // An island the build DOES feed (strategy !== 'none') whose resolved module
  // the emitted bundle does not carry is a broken capture, not a category
  // error — the artifact must stay `incomplete` / `island-chunk-unresolved`.
  // The id is a real workspace-relative spelling that simply is not in the
  // bundle, so it normalizes and reaches the chunk-attribution check.
  const missingModuleId = 'www/app/islands/probe-absent.ts';
  const specifier = './app/islands/probe-absent.ts';
  const plugin = browserEntryGraphPlugin({
    ...directPluginOptions(join(REPO_ROOT, 'www')),
    islands: [{ tag: 'probe-absent', specifier, strategy: 'load' }],
    islandModuleIds: new Map([[specifier, missingModuleId]]),
  });
  const emitted: Array<{ fileName: string; source: string }> = [];
  const context = {
    emitFile: (asset: { fileName: string; source: string }) => emitted.push(asset),
    getModuleInfo: (id: string) => ({ id }),
  };
  (
    plugin.generateBundle as unknown as (this: unknown, options: object, bundle: object) => void
  ).call(
    context,
    {},
    {
      'islands/client.js': {
        type: 'chunk',
        fileName: 'islands/client.js',
        isEntry: true,
        isDynamicEntry: false,
        facadeModuleId: '\0virtual:open-client-entry',
        imports: [],
        dynamicImports: [],
        implicitlyLoadedBefore: [],
        modules: { '\0virtual:open-client-entry': { renderedLength: 10 } },
      },
    },
  );
  expect(emitted).toHaveLength(1);
  const artifact = JSON.parse(emitted[0]!.source) as {
    status: string;
    reason: string;
    diagnostics: string[];
  };
  expect(artifact.status).toBe('incomplete');
  expect(artifact.reason).toBe('island-chunk-unresolved');
  expect(artifact.diagnostics).toEqual(['module-not-in-chunk']);
  expect(evaluateBrowserEntryGraphArtifact(artifact).verdict).toBe('UNPROVEN');
});

test('T3 a parsed-but-unused executor entry is a diagnostic, not a gate failure', async () => {
  // The re-exported executor entry is a PARSE-ONLY residue: the bundler parses
  // the module to build its export table and then tree-shakes the binding, so
  // nothing of it loads. `runtime-program.ts` is the surviving gate-table entry
  // that still exports a real value (`normalizePartProgram`) — the deleted
  // facade module cannot carry this fixture, and using a live member of the
  // frozen table keeps the assertion measuring the same predicate.
  const root = await makeDirectFixture(
    'parsed-only',
    [
      "import { createGeneratedElementClass } from '@openelement/element/internal/compiled/generated-element/shell';",
      "export { normalizePartProgram } from 'oe-executor-entry';",
      'globalThis.__oeBrowserGraphProbe = typeof createGeneratedElementClass;',
      '',
    ].join('\n'),
  );
  const build = await runDirectBuild({
    root,
    plugin: true,
    aliases: {
      'oe-executor-entry': join(ELEMENT_ROOT, 'src', 'internal', 'compiled', 'runtime-program.ts'),
    },
  });
  const source = build.assets.get(GRAPH_ASSET);
  expect(source).toBeDefined();
  const artifact = readGraphArtifact(source!, 'T3');
  const executorEntry = 'packages/element/src/internal/compiled/runtime-program.ts';

  expect(artifact.parsedModuleIds).toContain(executorEntry);
  const evaluation = evaluateBrowserEntryGraphArtifact(artifact);
  expect(evaluation.verdict, JSON.stringify(evaluation, null, 2)).toBe('MET');
  expect(evaluation.parsedOnlyExecutorResidues).toContain(executorEntry);

  const artifactPath = join(root, 'parsed-only.json');
  await writeFile(artifactPath, source!, 'utf8');
  const reportPath = join(root, 'parsed-only-report.txt');
  const checked = await runChecker([
    relative(REPO_ROOT, artifactPath),
    '--report',
    relative(REPO_ROOT, reportPath),
  ]);
  expect(checked.code, checked.stderr).toBe(0);
  // Output discipline: the passing run's stdout is exactly one summary line.
  const summaryLines = checked.stdout.split('\n').filter((line) => line.length > 0);
  expect(summaryLines).toHaveLength(1);
  expect(checked.stdout).toContain('MET');
  // The parsed-only residue is diagnostic detail: it lives in the --report
  // artifact, never on the one-line stdout.
  expect(checked.stdout).not.toContain(executorEntry);
  const reportText = await readFile(reportPath, 'utf8');
  expect(reportText).toContain('parsed-only executor residues');
  expect(reportText).toContain(executorEntry);
});

test('T4 exact identity: a foreign same-named module is not the element executor entry', async () => {
  const root = await makeDirectFixture(
    'foreign-identity',
    [
      "import { createGeneratedElementClass } from '@openelement/element/internal/compiled/generated-element/shell';",
      "import { convertToAttribute } from '../node_modules/probe/facade-host.ts';",
      'globalThis.__oeBrowserGraphProbe = [typeof createGeneratedElementClass, convertToAttribute];',
      '',
    ].join('\n'),
  );
  await writeFixtureFile(
    join(root, 'node_modules', 'probe', 'facade-host.ts'),
    ['export function convertToAttribute(): string {', "  return 'foreign';", '}', ''].join('\n'),
  );
  const build = await runDirectBuild({ root, plugin: true });
  const source = build.assets.get(GRAPH_ASSET);
  expect(source).toBeDefined();
  const artifact = readGraphArtifact(source!, 'T4');

  const foreignId = 'node_modules/probe/facade-host.ts';
  const loadedIds = artifact.chunks.flatMap((chunk) => chunk.modules.map((module) => module.id));
  expect(loadedIds).toContain(foreignId);

  const evaluation = evaluateBrowserEntryGraphArtifact(artifact);
  expect(evaluation.verdict, JSON.stringify(evaluation, null, 2)).toBe('MET');
  expect(evaluation.violations).toEqual([]);
  const reported = [
    ...evaluation.diagnostics.executorSupport,
    ...evaluation.diagnostics.serverPrivate,
    ...evaluation.diagnostics.authoring,
    ...evaluation.diagnostics.leafSurface,
  ];
  expect(reported).not.toContain(foreignId);
  // The real executor entry is not in this graph at all.
  expect(loadedIds).not.toContain('packages/element/src/internal/compiled/runtime-program.ts');
});

test('T5 forged/derived artifacts fail closed: UNPROVEN exit 2, never a green claim', async () => {
  expect(evidence?.t1, 'T1 real artifact is required').toBeDefined();
  expect(evidence?.t2, 'T2 real artifact is required').toBeDefined();
  const realEvidence = evidence!;
  const forgedDir = await makeTempRoot();
  const t2Source = realEvidence.t2!.source;

  const cloneT1 = () => JSON.parse(realEvidence.t1.source) as Record<string, unknown>;
  const cloneT2 = () => JSON.parse(t2Source) as Record<string, unknown>;
  const writeForged = async (name: string, value: unknown): Promise<string> => {
    const path = join(forgedDir, `${name}.json`);
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return relative(REPO_ROOT, path);
  };

  // 1. Incomplete capture.
  const incomplete = cloneT1();
  incomplete.status = 'incomplete';
  incomplete.reason = 'module-parsed-empty';
  incomplete.diagnostics = ['module-parsed-empty'];
  // 2. Malformed JSON.
  const malformedPath = join(forgedDir, 'malformed.json');
  await writeFile(malformedPath, '{"schemaVersion":1,', 'utf8');
  // 3. Missing file.
  const missingPath = relative(REPO_ROOT, join(forgedDir, 'does-not-exist.json'));
  // 4. Absolute module id.
  const absolute = cloneT1();
  (absolute.chunks as Array<{ modules: Array<{ id: string }> }>)[0]!.modules[0]!.id =
    '/abs/machine/path.ts';
  // 5. Missing entry chunk.
  const noEntryChunk = cloneT1();
  (noEntryChunk.entry as { chunkFile: string }).chunkFile = 'islands/not-emitted.js';
  // 6. Dangling chunk edge.
  const dangling = cloneT1();
  (dangling.chunks as Array<{ isEntry: boolean; imports: string[] }>).find(
    (chunk) => chunk.isEntry,
  )!.imports = ['islands/not-emitted.js'];
  // 7. Entry module absent from the parse capture.
  const unparsedEntry = cloneT1();
  const entryModuleId = (unparsedEntry.entry as { moduleId: string }).moduleId;
  unparsedEntry.parsedModuleIds = (unparsedEntry.parsedModuleIds as string[]).filter(
    (id) => id !== entryModuleId,
  );
  // 8. Empty chunk list.
  const emptyChunks = cloneT1();
  emptyChunks.chunks = [];
  // 9. A loaded violation hidden behind an unreachable chunk (forged green).
  const hiddenViolation = cloneT1();
  const entryChunk = (
    hiddenViolation.chunks as Array<{
      isEntry: boolean;
      dynamicImports: string[];
      imports: string[];
    }>
  ).find((chunk) => chunk.isEntry)!;
  entryChunk.dynamicImports = [];
  entryChunk.imports = [];
  // 10. Drifted gate table digest.
  const drifted = cloneT1();
  (drifted.predicate as { gateListDigest: string }).gateListDigest = 'sha256:deadbeef';
  // 11. Self-inconsistent summary that hides a loaded violation (forged green):
  // the chunk facts still load executor entries, so a zeroed summary must be
  // caught rather than reported as MET.
  const hiddenViolationSummary = cloneT1();
  (hiddenViolationSummary.predicate as { loadedViolations: unknown[] }).loadedViolations = [];
  // 12. The bundler's opaque style-asset id (base64url of an absolute path)
  // must never be accepted as an artifact id: it is a machine-path carrier.
  const opaqueStyleId = `\0oe-style-asset:${Buffer.from(
    join(REPO_ROOT, 'packages', 'ui', 'src', 'open-button.css'),
    'utf8',
  )
    .toString('base64url')
    .replace(/=+$/u, '')}.js`;
  const opaqueStyle = cloneT2();
  (
    opaqueStyle.chunks as Array<{ modules: Array<{ id: string; renderedLength: number }> }>
  )[0]!.modules.push({ id: opaqueStyleId, renderedLength: 10 });
  // 13. A non-canonical spelling of a gate id must not evade exact matching.
  const nonCanonicalGate = cloneT1();
  const gateViolation = (
    nonCanonicalGate.predicate as { loadedViolations: Array<{ moduleId: string }> }
  ).loadedViolations[0]!.moduleId;
  const nonCanonicalSpelling = gateViolation.replace('packages/element/', 'packages//element/');
  for (const chunk of nonCanonicalGate.chunks as Array<{
    modules: Array<{ id: string; renderedLength: number }>;
  }>) {
    for (const moduleRecord of chunk.modules) {
      if (moduleRecord.id === gateViolation) moduleRecord.id = nonCanonicalSpelling;
    }
  }
  // 14. An unknown `\0` scheme (possible machine-path carrier) is malformed.
  const unknownVirtual = cloneT2();
  (
    unknownVirtual.chunks as Array<{ modules: Array<{ id: string; renderedLength: number }> }>
  )[0]!.modules.push({ id: '\0oe-compiled:L1VzZXJzL2Fic29sdXRl', renderedLength: 5 });
  // 15. A module id in two chunks (ambiguous loaded-set membership).
  const duplicateModule = cloneT1();
  const chunksOfDuplicate = duplicateModule.chunks as Array<{
    modules: Array<{ id: string; renderedLength: number }>;
  }>;
  const firstModule = chunksOfDuplicate[0]!.modules[0]!;
  chunksOfDuplicate[1]!.modules.push({ ...firstModule, renderedLength: 0 });

  const cases: Array<[name: string, path: string, expected: string]> = [
    ['missing artifact', missingPath, 'artifact-missing'],
    ['malformed JSON', relative(REPO_ROOT, malformedPath), 'artifact-not-json'],
    ['incomplete capture', await writeForged('incomplete', incomplete), 'artifact-incomplete'],
    ['absolute module id', await writeForged('absolute-id', absolute), 'malformed-artifact'],
    [
      'missing entry chunk',
      await writeForged('no-entry-chunk', noEntryChunk),
      'entry-chunk-missing',
    ],
    ['dangling chunk edge', await writeForged('dangling', dangling), 'chunk-reference-dangling'],
    ['entry not parsed', await writeForged('entry-not-parsed', unparsedEntry), 'entry-not-parsed'],
    ['empty chunk list', await writeForged('empty-chunks', emptyChunks), 'malformed-artifact'],
    [
      'unreachable hidden violation',
      await writeForged('hidden-violation', hiddenViolation),
      'chunk-unreachable',
    ],
    ['drifted gate table', await writeForged('gate-drift', drifted), 'gate-list-drift'],
    [
      'hidden violation summary',
      await writeForged('hidden-violation-summary', hiddenViolationSummary),
      'predicate-summary-mismatch',
    ],
    [
      'duplicate module chunk',
      await writeForged('duplicate-module', duplicateModule),
      'module-chunk-ambiguous',
    ],
    [
      'non-canonical gate spelling',
      await writeForged('non-canonical-gate', nonCanonicalGate),
      'malformed-artifact',
    ],
    [
      'unknown virtual scheme',
      await writeForged('unknown-virtual', unknownVirtual),
      'malformed-artifact',
    ],
  ];

  for (const [label, artifactPath, expectedReason] of cases) {
    // The UNPROVEN semantics (verdict + stable reason) are read from the
    // `--json` machine channel; no human mode puts them on stdout.
    const checked = await runChecker(['--json', artifactPath]);
    expect(checked.code, `${label}: ${checked.stdout}${checked.stderr}`).toBe(2);
    const report = JSON.parse(checked.stdout) as {
      exitCode: number;
      artifacts: Array<{ verdict: string; reason: string | null }>;
      summary: { met: number; violated: number; unproven: number };
    };
    expect(report.exitCode, label).toBe(2);
    expect(report.summary, label).toEqual({ met: 0, violated: 0, unproven: 1 });
    expect(report.artifacts, label).toHaveLength(1);
    expect(report.artifacts[0]!.verdict, label).toBe('UNPROVEN');
    expect(report.artifacts[0]!.reason, label).toBe(expectedReason);
  }

  // The opaque style-asset id must not leak the machine path it encodes,
  // through either the artifact or the checker output. `--json` echoes the
  // full evaluation, so a leak there would surface; stderr is checked too.
  const opaqueCheck = await runChecker([
    '--json',
    await writeForged('opaque-style-id-check', opaqueStyle),
  ]);
  expect(opaqueCheck.code).toBe(2);
  expect(opaqueCheck.stdout).not.toContain('/Users/');
  expect(opaqueCheck.stdout).not.toContain(REPO_ROOT);
  expect(opaqueCheck.stderr).not.toContain('/Users/');
  expect(opaqueCheck.stderr).not.toContain(REPO_ROOT);

  // The same real artifacts keep their honest verdicts through the CLI.
  const t2Path = join(forgedDir, 'real-t2.json');
  await writeFile(t2Path, t2Source, 'utf8');
  const met = await runChecker([relative(REPO_ROOT, t2Path)]);
  expect(met.code, met.stderr).toBe(0);
  // A passing run's stdout is exactly one summary line.
  expect(met.stdout.split('\n').filter((line) => line.length > 0)).toHaveLength(1);
  expect(met.stdout).toContain('MET');

  const violated = await runChecker([
    relative(REPO_ROOT, join(realEvidence.t1.root, 'dist', 'client', GRAPH_ASSET)),
  ]);
  expect(violated.code, violated.stderr).toBe(1);
  // A failing human run keeps stdout a data channel (empty).
  expect(violated.stdout).toBe('');

  // --json is a deterministic document and repeats the honesty.
  const jsonChecked = await runChecker([
    '--json',
    relative(REPO_ROOT, join(realEvidence.t1.root, 'dist', 'client', GRAPH_ASSET)),
  ]);
  expect(jsonChecked.code).toBe(1);
  const report = JSON.parse(jsonChecked.stdout) as {
    format: string;
    exitCode: number;
    artifacts: Array<{ verdict: string; violations: unknown[] }>;
    summary: { violated: number };
  };
  expect(report.format).toBe('openelement.browser-entry-graph-check/1');
  expect(report.exitCode).toBe(1);
  expect(report.artifacts[0]!.verdict).toBe('VIOLATED');
  expect(report.artifacts[0]!.violations.length).toBeGreaterThan(0);
  expect(jsonChecked.stdout).not.toContain(REPO_ROOT);

  // Usage errors are fail-closed too (no vacuous pass).
  const noArgs = await runChecker([]);
  expect(noArgs.code).toBe(2);
  expect(noArgs.stderr).toContain('no artifact supplied');
});

test('T6 observer purity: chunks are identical with and without the plugin', async () => {
  const root = await makeDirectFixture('purity', SHELL_ENTRY);
  const baseline = await runDirectBuild({ root, plugin: false });
  const observed = await runDirectBuild({ root, plugin: true });

  expect(baseline.chunks.map((chunk) => chunk.fileName)).toEqual(
    observed.chunks.map((chunk) => chunk.fileName),
  );
  for (const [index, chunk] of baseline.chunks.entries()) {
    const other = observed.chunks[index]!;
    expect(other.moduleIds, chunk.fileName).toEqual(chunk.moduleIds);
    expect(other.imports, chunk.fileName).toEqual(chunk.imports);
    expect(other.dynamicImports, chunk.fileName).toEqual(chunk.dynamicImports);
    expect(other.code.length, chunk.fileName).toBe(chunk.code.length);
    const digest = (code: string) => createHash('sha256').update(code).digest('hex');
    expect(digest(other.code), chunk.fileName).toBe(digest(chunk.code));
  }
  // The only output difference is the observer's own asset.
  expect(baseline.assets.has(GRAPH_ASSET)).toBe(false);
  expect(observed.assets.has(GRAPH_ASSET)).toBe(true);
  expect([...observed.assets.keys()].filter((file) => !baseline.assets.has(file))).toEqual([
    GRAPH_ASSET,
  ]);
});

test('T7 determinism: two observer builds emit byte-identical artifacts', async () => {
  const root = await makeDirectFixture('determinism', SHELL_ENTRY);
  const first = await runDirectBuild({ root, plugin: true });
  const second = await runDirectBuild({ root, plugin: true });
  const firstSource = first.assets.get(GRAPH_ASSET);
  const secondSource = second.assets.get(GRAPH_ASSET);
  expect(firstSource).toBeDefined();
  expect(secondSource).toBeDefined();
  expect(secondSource).toEqual(firstSource);
  const digest = (source: string) => createHash('sha256').update(source).digest('hex');
  expect(digest(secondSource!)).toBe(digest(firstSource!));
  // Same chunk identities in both builds (the artifact's chunk facts are the real ones).
  expect(first.chunks.map((chunk) => chunk.fileName)).toEqual(
    second.chunks.map((chunk) => chunk.fileName),
  );
});

test('the frozen executor-entry table names existing modules and keeps its digest pinned', () => {
  // Four, not six: `facade-host.ts` and `runtime/kernel.ts` were the class lane's
  // own call surfaces and were deleted with the lane, so the gate now names the
  // executor proper. The loop below is the assertion that made the stale naming
  // visible — every id must still resolve on disk.
  expect(EXECUTOR_ENTRY_RELATIVE_MODULES).toHaveLength(4);
  expect(new Set(EXECUTOR_ENTRY_RELATIVE_MODULES).size).toBe(4);
  for (const modulePath of EXECUTOR_ENTRY_RELATIVE_MODULES) {
    expect(existsSync(join(ELEMENT_ROOT, modulePath)), modulePath).toBe(true);
  }
  // A reviewed change to the table changes this literal in the same commit.
  expect(browserEntryGraphGateListDigest()).toBe(
    'sha256:db632836f1e28bbfd8f4b5c876bb4d8c1eceffe4ccdd25a90bff44c8548631b2',
  );
});

test('the observer has no graph-mutating hook and reports incomplete instead of failing the build', () => {
  const plugin = browserEntryGraphPlugin(directPluginOptions(join(REPO_ROOT, 'www')));
  expect(plugin.name).toBe('open:browser-entry-graph');
  expect(plugin.apply).toBe('build');
  // Observer-only: no hook may resolve, load or transform a module.
  for (const hook of ['resolveId', 'load', 'transform', 'transformIndexHtml'] as const) {
    expect(plugin[hook], hook).toBeUndefined();
  }

  const emitted: Array<{ type: string; fileName: string; source: string }> = [];
  const context = {
    emitFile: (asset: { type: string; fileName: string; source: string }) => emitted.push(asset),
  };
  // An empty bundle cannot carry the claim: the hook must still not throw, and
  // the emitted artifact must say UNPROVEN at the checker boundary.
  expect(() =>
    (
      plugin.generateBundle as unknown as (this: unknown, options: object, bundle: object) => void
    ).call(context, {}, {}),
  ).not.toThrow();
  expect(emitted).toHaveLength(1);
  expect(emitted[0]!.fileName).toBe(GRAPH_ASSET);
  const incomplete = JSON.parse(emitted[0]!.source) as { status: string; reason: string };
  expect(incomplete.status).toBe('incomplete');
  expect(incomplete.reason).toBe('no-emitted-chunks');
  const evaluation = evaluateBrowserEntryGraphArtifact(incomplete);
  expect(evaluation.verdict).toBe('UNPROVEN');
  expect(evaluation.reason).toBe('artifact-incomplete');
});

test('the writer decodes the known style-asset virtual id and reports an unknown one incomplete', () => {
  const emitViaPlugin = (bundle: object): { fileName: string; source: string } => {
    const plugin = browserEntryGraphPlugin(directPluginOptions(join(REPO_ROOT, 'www')));
    const emitted: Array<{ type: string; fileName: string; source: string }> = [];
    const context = {
      emitFile: (asset: { type: string; fileName: string; source: string }) => emitted.push(asset),
      // generateBundle's documented fallback: every emitted module answers.
      getModuleInfo: (id: string) => ({ id }),
    };
    (
      plugin.generateBundle as unknown as (this: unknown, options: object, bundle: object) => void
    ).call(context, {}, bundle);
    expect(emitted).toHaveLength(1);
    return { fileName: emitted[0]!.fileName, source: emitted[0]!.source };
  };
  const chunk = (moduleId: string) => ({
    'islands/client.js': {
      type: 'chunk',
      fileName: 'islands/client.js',
      isEntry: true,
      isDynamicEntry: false,
      facadeModuleId: '\0virtual:open-client-entry',
      imports: [],
      dynamicImports: [],
      implicitlyLoadedBefore: [],
      modules: {
        '\0virtual:open-client-entry': { renderedLength: 10 },
        [moduleId]: { renderedLength: 20 },
      },
    },
  });

  // Known scheme: the absolute CSS path is decoded and re-anchored; the raw
  // opaque id and the machine path never reach the artifact.
  const cssPath = join(REPO_ROOT, 'packages', 'ui', 'src', 'open-button.css');
  const encoded = `\0oe-style-asset:${Buffer.from(cssPath, 'utf8').toString('base64url')}.js`;
  const decoded = emitViaPlugin(chunk(encoded));
  expect(decoded.fileName).toBe(GRAPH_ASSET);
  expect(decoded.source).not.toContain(cssPath);
  expect(decoded.source).not.toContain(encoded);
  const decodedArtifact = JSON.parse(decoded.source) as {
    status: string;
    parsedModuleIds?: string[];
    chunks?: Array<{ modules: Array<{ id: string }> }>;
  };
  expect(decodedArtifact.status).toBe('complete');
  const decodedIds = [
    ...(decodedArtifact.parsedModuleIds ?? []),
    ...(decodedArtifact.chunks ?? []).flatMap((chunk) => chunk.modules.map((module) => module.id)),
  ];
  expect(decodedIds).toContain('\0oe-style-asset:file:packages/ui/src/open-button.css');
  expect(evaluateBrowserEntryGraphArtifact(decodedArtifact).verdict).toBe('MET');

  // Unknown `\0` scheme: incomplete, never an opaque publication.
  const unknown = emitViaPlugin(chunk('\0oe-unknown:<opaque-machine-stuff>'));
  const unknownArtifact = JSON.parse(unknown.source) as { status: string; reason: string };
  expect(unknownArtifact.status).toBe('incomplete');
  expect(unknownArtifact.reason).toBe('module-id-unnormalizable');
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Subprocesses                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

interface SubprocessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runChecker(args: string[]): Promise<SubprocessResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHECKER_CLI, ...args], { cwd: REPO_ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}
