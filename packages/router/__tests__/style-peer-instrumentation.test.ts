/**
 * Peer-load and compile-call instrumentation (alpha15 Stage 3).
 *
 * The style contract matrix ("OFF means no engine was touched; a declaration
 * means the declared engine — and only it — was loaded and really compiled")
 * is stated as a plan DECISION in `style-plan.ts` and pinned as unit tests in
 * `style-provider.test.ts`. Neither can OBSERVE it: `resolveStylePlan`
 * returning `undefined` and a build that imports the engine anyway look
 * identical from the plan alone, and a hand-invoked `compileComponents` says
 * nothing about what the real pipeline does. So this file measures the
 * OBSERVATION behind the matrix, in a child process per row (one engine import
 * per process — a second row in the same process would hit the module cache and
 * its loads would be invisible).
 *
 * THE FOUR LAYERS, KEPT DISTINCT (they are four facts, not one):
 *
 *   1. RESOLVE ATTEMPT — the `resolve` hook records every specifier as written.
 *      A failed attempt is still an attempt (the record precedes the throw),
 *      which is how the missing-peer row can see the attempt that failed.
 *   2. MODULE LOAD — the `load` hook records each resolved `file:` URL: the
 *      last step before evaluation. Evaluation itself sits below the hooks;
 *      its evidence is the engine's own output (layer 4), never the load alone.
 *   3. PROVIDER COMPILE — the calls the REAL pipeline makes into the provider
 *      object (`StyleBuildIntegration.provider`), recorded by passive wrappers
 *      the test installs ON that object before handing the integration's own
 *      plugins to a real Vite build. The probe never calls a compile itself and
 *      no counter is advanced by hand: the only caller after the wrapper goes
 *      on is the sheet-plugin pipeline (`style-provider.ts` builds its
 *      `compile` closures over that same object; the client build mounts those
 *      plugins at `build-client.ts:468` the same way). SHAPE NOTE: the
 *      Tailwind build path compiles through module functions
 *      (`compileComponentStyleSheet`), not through the provider object, so its
 *      `providerCalls` is legitimately empty — its compile evidence lives in
 *      layers 2 and 4 below, and rows that need a count use the UnoCSS shape.
 *   4. ENGINE GENERATOR/BUILD — `generator.generate` / the official
 *      `compile().build()` are engine internals: not hookable without
 *      engine-owned instrumentation, which would put statistics inside third
 *      parties. Observed indirectly, and honestly labelled as indirect: the
 *      engine package's own module loads (layer 2) plus the CSS bytes the
 *      compile produced (asserted markers: a real utility rule, the reset, a
 *      token only the engine's own extractor could have found).
 *
 * WHAT THE CHANNEL SEES AND WHAT IT CANNOT SEE. The hooks are Node's module
 * customization hooks, registered synchronously (`module.registerHooks`, so the
 * records land in the SAME thread the probe reads — the asynchronous
 * `module.register` runs hooks on a separate thread whose `globalThis` the
 * main thread never sees, which silently produced empty traces before this
 * lane). Observed: every resolution that crosses Node's module loaders in the
 * child — ESM `import` in every spelling (bare, relative, absolute path,
 * `file:` URL), `createRequire(...).resolve(...)`, `require(...)`, and
 * `import.meta.resolve(...)`. Not observed: resolution done INSIDE the bundler
 * graph (the app entry's imports, and the official Tailwind plugin's own
 * `@import 'tailwindcss'` resolution run on `enhanced-resolve`, below Node's
 * loaders) and anything after the load hook (evaluation, engine-internal
 * calls). The rows below only ask questions the seen layers can answer.
 *
 * THE plan===undefined BOUNDARY. A row whose plan is `undefined` asserts the
 * trace is empty of engine spellings — never the reverse. `plan === undefined`
 * is the decision fact (asserted, and pinned by the plan unit tests in
 * `style-provider.test.ts`), but it is NOT evidence of zero loading in a real
 * application: only the observed trace is, and only within the "cannot see"
 * limits above.
 */

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { PresetErrorCode } from '../src/internal/error-codes.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const routerSrc = join(here, '../src');
const routerPackageJson = join(here, '../package.json');
const ROUTER_SRC_URL = pathToFileURL(routerSrc).href;
/** The fixture whose `unocss` install the adapter resolves from the app root. */
const UNOCSS_FIXTURE_ROOT = realpathSync(join(here, '../../../tests/fixtures/router-unocss-probe'));

/**
 * The hook module, registered through `--import` before the probe runs. The
 * records live on `globalThis` of the child's MAIN thread — the same object
 * the probe reads back — because `registerHooks` hooks run synchronously in
 * that thread.
 */
const HOOK_REGISTRATION = `
import { registerHooks } from 'node:module';
const trace = (globalThis.__a15Trace = { resolves: [], loads: [] });
registerHooks({
  resolve(specifier, context, nextResolve) {
    trace.resolves.push(specifier);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    trace.loads.push(url);
    return nextLoad(url, context);
  },
});
`;

/** What one probe run is told to do (the row's declaration and pipeline input). */
interface ProbeConfig {
  tailwind?: boolean | { theme?: string[] };
  unocss?: boolean | { theme?: string[] };
  /** Admitted package declarations, as the manifest scan would hand them over. */
  declarations?: Array<{
    packageName: string;
    tagName: string;
    required: boolean;
    dialect: string;
    sources: string[];
  }>;
  /** The candidates the discovery pass would have admitted (real tokens). */
  candidates?: string[];
  documentCandidates?: string[];
  /** The module texts the discovery walk would have read (id → source). */
  sources?: Record<string, string>;
  /**
   * Negative control only: after the plan resolves `undefined`, load this
   * package anyway — through the router's own resolution, the same one
   * `tailwind.ts` uses for its peer (`import.meta.resolve` from the source
   * tree) — so the instrument must report an engine the contract says is
   * absent. The bare root has no install, so the deliberate load cannot ride
   * the app's resolution.
   */
  deliberateEngineLoad?: 'unocss';
}

/** What one probe run observed. Field names match the four layers above. */
interface Trace {
  plan: boolean;
  provider: string | null;
  errorCode: string | undefined;
  buildOk: boolean | undefined;
  buildError: string | undefined;
  deliberateLoad: string | undefined;
  /** Layer 3: pipeline-driven provider compiles (never probe-driven ones). */
  providerCalls: Array<{
    method: string;
    candidates: string[];
    sourceCount: number;
    css: string;
  }>;
  componentRecord: string | undefined;
  documentRecord: string | undefined;
  /** Layer 4 evidence for the graph halves: the emitted CSS assets. */
  cssAssets: Array<{ fileName: string; css: string }>;
  /** Layer 1: every specifier as written, failed attempts included. */
  resolves: string[];
  /** Layer 2: every module that reached a load, by resolved URL. */
  loads: string[];
}

/** The probe: plan → integration → a real Vite build through its own plugins. */
const PROBE = `
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.argv[2];
const config = JSON.parse(process.argv[3]);
const reportFile = process.argv[4];
const report = {
  plan: false,
  provider: null,
  errorCode: undefined,
  buildOk: undefined,
  buildError: undefined,
  deliberateLoad: undefined,
  providerCalls: [],
  componentRecord: undefined,
  documentRecord: undefined,
  cssAssets: [],
};
// The report goes to a FILE, not stdout: a trace carrying whole compiled
// sheets outgrows a pipe buffer, and stdout writes do not survive process.exit.
const emit = () => {
  const trace = globalThis.__a15Trace ?? { resolves: [], loads: [] };
  writeFileSync(
    reportFile,
    JSON.stringify({ ...report, resolves: trace.resolves, loads: trace.loads }),
    'utf8',
  );
};
const fail = (error) => {
  report.errorCode = error && error.code ? error.code : 'UNCODED:' + String(error).slice(0, 200);
  emit();
};

const { resolveStylePlan } = await import(${JSON.stringify(join(routerSrc, 'vite/internal/style-plan.ts'))});
const { createStyleBuildIntegration } = await import(${JSON.stringify(join(routerSrc, 'vite/internal/style-provider.ts'))});

let plan;
try {
  plan = resolveStylePlan({
    root,
    tailwind: config.tailwind,
    unocss: config.unocss,
    declarations: config.declarations ?? [],
  });
} catch (error) {
  fail(error);
}
if (plan === undefined) {
  if (config.deliberateEngineLoad !== undefined) {
    const requireFromRouter = createRequire(${JSON.stringify(routerPackageJson)});
    const entry = requireFromRouter.resolve(config.deliberateEngineLoad);
    await import(new URL('file://' + entry).href);
    report.deliberateLoad = config.deliberateEngineLoad;
  }
  emit();
}
report.plan = true;
report.provider = plan.provider;

let integration;
try {
  integration = await createStyleBuildIntegration({
    root,
    plan,
    unocss: config.unocss,
    componentSheetCandidates: () => config.candidates ?? [],
    documentCandidates: () => config.documentCandidates ?? [],
    sources: () => Object.entries(config.sources ?? {}),
  });
} catch (error) {
  fail(error);
}

// The observation seam (layer 3): passive wrappers ON the provider object the
// sheet plugins closed over. From here the probe calls no compile itself — the
// only caller is the plugin pipeline inside the real Vite build below.
const provider = integration.provider;
for (const method of ['compileComponents', 'compileDocument']) {
  const original = provider[method];
  if (original === undefined) continue;
  provider[method] = async (input) => {
    const css = await original.call(provider, input);
    report.providerCalls.push({
      method,
      candidates: [...input.candidates],
      sourceCount: [...input.sources].length,
      css,
    });
    return css;
  };
}

// The real consumer half: the integration's own plugins, mounted in a real
// Vite build the way the client build mounts them, with a real entry importing
// both sheet modules the way the generated client entry does.
const requireFromRouter = createRequire(${JSON.stringify(routerPackageJson)});
const viteEntry = requireFromRouter.resolve('vite');
const { build } = await import(new URL('file://' + viteEntry).href);
const scratch = mkdtempSync(join(tmpdir(), 'oe-a15-probe-entry-'));
const entryFile = join(scratch, 'entry.mjs');
writeFileSync(
  entryFile,
  [
    'import ' + JSON.stringify(provider.componentSheetSpecifier) + ';',
    'import ' + JSON.stringify(provider.documentSheetModule) + ';',
    '',
  ].join('\\n'),
  'utf8',
);
try {
  const result = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [...integration.graphPlugins, ...integration.sheetPlugins],
    build: {
      write: false,
      outDir: join(scratch, 'dist'),
      emptyOutDir: false,
      rollupOptions: { input: { entry: entryFile } },
    },
  });
  report.buildOk = true;
  const output = Array.isArray(result) ? result[0].output : result.output;
  report.cssAssets = output
    .filter((item) => item.type === 'asset' && String(item.fileName).endsWith('.css'))
    .map((item) => ({ fileName: item.fileName, css: String(item.source) }));
} catch (error) {
  report.buildOk = false;
  report.buildError = String(error).slice(0, 400);
}
report.componentRecord = integration.componentRecord.fileName;
report.documentRecord = integration.documentRecord ? integration.documentRecord.fileName : undefined;
emit();
`;

/** One probe run in a fresh child process. */
function probe(root: string, config: ProbeConfig): Trace {
  const scratch = mkdtempSync(join(tmpdir(), 'oe-a15-instrument-'));
  try {
    const script = join(scratch, 'probe.mjs');
    const reportFile = join(scratch, 'report.json');
    writeFileSync(script, PROBE, 'utf8');
    // The vitest worker exports `NODE_PATH`, which would let the child resolve
    // the repo's own install from ANY root — the opposite of a bare root (the
    // missing-peer row depends on that bareness). Clean resolution environment.
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    delete childEnv.NODE_PATH;
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(HOOK_REGISTRATION)}`,
        script,
        root,
        JSON.stringify(config),
        reportFile,
      ],
      { encoding: 'utf8', env: childEnv, maxBuffer: 16 * 1024 * 1024 },
    );
    let raw: string;
    try {
      raw = readFileSync(reportFile, 'utf8');
    } catch {
      throw new Error(
        `the probe produced no report (status ${run.status}):\n${run.stdout}\n${run.stderr}`,
      );
    }
    return JSON.parse(raw) as Trace;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * An app root with nothing installed. A peer load from here is a real resolve,
 * and a resolve that cannot find its package is the failure the missing-peer
 * row asks for. (The guarantee these rows need is "no ENGINE is resolvable
 * from this root's chain", not "the chain is empty" — the tmp parent chain may
 * carry unrelated packages.)
 */
function bareRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'oe-a15-bare-app-'));
  writeFileSync(join(root, 'package.json'), '{"name":"a15-bare-app","type":"module"}\n', 'utf8');
  return root;
}

/**
 * An app root with the ONE package a Tailwind consumer must install itself:
 * `tailwindcss` (the router's `@tailwindcss/vite` optional peer resolves from
 * the router's own tree, but the entry's `@import 'tailwindcss…'` resolves
 * from the APPLICATION root, so the real consumer's install is part of the
 * real path). Symlinked the way the other router fixtures link their deps.
 */
function tailwindRoot(): string {
  const root = bareRoot();
  const requireFromRouter = createRequire(routerPackageJson);
  const entry = requireFromRouter.resolve('tailwindcss');
  let dir = dirname(entry);
  for (let depth = 0; depth < 6; depth += 1) {
    if (basename(dir) === 'tailwindcss') break;
    dir = dirname(dir);
  }
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(realpathSync(dir), join(root, 'node_modules', 'tailwindcss'));
  return root;
}

/**
 * Engine entries in a trace, for ONE engine. Relative spellings and file URLs
 * under the router's own source tree are the framework's own adapter modules
 * (`providers/unocss.ts`, `../tailwind.ts`) — loaded whenever the integration
 * module loads, engine or no engine — so they are not engine evidence.
 */
const engineEntries = (trace: Trace, engine: 'unocss' | 'tailwind'): string[] =>
  [...trace.resolves, ...trace.loads].filter(
    (entry) =>
      (engine === 'unocss' ? entry.includes('unocss') : entry.includes('tailwindcss')) &&
      !entry.startsWith('.') &&
      !entry.startsWith(`${ROUTER_SRC_URL}/`),
  );

/** Layer-2 only: engine modules that reached a load (adapter modules excluded). */
const engineLoads = (trace: Trace, engine: 'unocss' | 'tailwind'): string[] =>
  trace.loads.filter(
    (url) =>
      (engine === 'unocss' ? url.includes('unocss') : url.includes('tailwindcss')) &&
      !url.startsWith('.') &&
      !url.startsWith(`${ROUTER_SRC_URL}/`),
  );

/** The emitted CSS asset a build record names (the sheet's actual bytes). */
const emittedCss = (trace: Trace, fileName: string | undefined): string | undefined =>
  fileName === undefined
    ? undefined
    : trace.cssAssets.find((asset) => asset.fileName === fileName)?.css;

// ─── The contract matrix, observed ─────────────────────────────────────────

test('no declaration and no requirement resolves no engine and compiles nothing', () => {
  // OFF, on a root with no engine installed: the promised success is that the
  // closed path does not even LOOK for a peer. The evidence is the observed
  // trace — `plan === false` alone is the decision, not the zero-load proof.
  const trace = probe(bareRoot(), {});
  expect(trace.plan, 'no declaration selects nothing').toBe(false);
  expect(trace.providerCalls, 'no compile was driven by any pipeline').toEqual([]);
  expect(
    trace.resolves.length,
    'the instrument heard the process at all (not a deaf run)',
  ).toBeGreaterThan(10);
  expect(engineEntries(trace, 'unocss'), 'no UnoCSS resolve or load').toEqual([]);
  expect(engineEntries(trace, 'tailwind'), 'no Tailwind resolve or load').toEqual([]);
});

test('the instrument is alive: a deliberately loaded engine is observed with no plan', () => {
  // The negative control: the SAME OFF configuration, plus one deliberate
  // engine import the contract forbids. The instrument MUST report it — this
  // row is what makes the empty trace above mean "nothing was loaded" instead
  // of "nothing was heard". (Under the retired async-registration channel this
  // row fails: the hook thread's records never reach the main thread.)
  const trace = probe(bareRoot(), { deliberateEngineLoad: 'unocss' });
  expect(trace.plan, 'the OFF plan still selected nothing').toBe(false);
  expect(trace.deliberateLoad, 'the probe ran the deliberate load').toBe('unocss');
  expect(trace.providerCalls, 'a module load compiles nothing').toEqual([]);
  expect(trace.resolves, 'the resolve attempt of the engine was observed (layer 1)').toContain(
    'unocss',
  );
  expect(
    engineLoads(trace, 'unocss').length,
    'the engine package was observed loading (layer 2)',
  ).toBeGreaterThan(0);
});

test('an explicit UnoCSS declaration drives the real engine through the real pipeline', () => {
  // Positive control (load + compile): the declaration selects UnoCSS, the
  // peer is resolved from the APPLICATION root (the real consumer path), and
  // the real Vite build — not the probe — drives exactly one compile of each
  // sheet, whose bytes are UnoCSS's own output.
  const trace = probe(UNOCSS_FIXTURE_ROOT, {
    unocss: { theme: ['app/styles/tokens.css'] },
    candidates: ['gap-2', 'px-6', 'rounded-lg', 'bg-primary/14'],
    documentCandidates: ['mt-9'],
    sources: { '/app/routes/index.tsx': '<p class="mt-9 py-7">source token</p>' },
  });
  expect(trace.plan, 'an explicit declaration selects the pipeline').toBe(true);
  expect(trace.provider, 'the UnoCSS provider was built').toBe('unocss');
  expect(trace.errorCode).toBeUndefined();
  expect(trace.buildOk, 'the real build completed').toBe(true);

  const components = trace.providerCalls.filter((call) => call.method === 'compileComponents');
  const document = trace.providerCalls.filter((call) => call.method === 'compileDocument');
  expect(components.length, 'the pipeline compiled the component sheet exactly once').toBe(1);
  expect(document.length, 'the pipeline compiled the document sheet exactly once').toBe(1);

  expect(
    components[0]!.candidates,
    'the pipeline handed the admitted candidates to the provider',
  ).toEqual(['gap-2', 'px-6', 'rounded-lg', 'bg-primary/14']);
  expect(
    components[0]!.css,
    'the compile reached the engine: a real utility rule came back (layer 4)',
  ).toMatch(/\.gap-2\s*\{/);

  expect(
    document[0]!.sourceCount,
    'the pipeline delivered the walked module texts to the document compile',
  ).toBe(1);
  expect(
    document[0]!.css,
    'the document sheet carries the theme layer (layer 4: engine preflight/theme)',
  ).toContain('--spacing');
  expect(
    document[0]!.css,
    'a token found ONLY by the engine’s own extractor over the walked source compiled',
  ).toMatch(/\.py-7\s*\{/);

  expect(
    trace.resolves,
    'the peer was resolved from the app root (layer 1: the attempt as written)',
  ).toContain('unocss');
  expect(
    engineEntries(trace, 'unocss').length,
    'the engine and its own dependency tree loaded (layer 2)',
  ).toBeGreaterThan(1);
  expect(emittedCss(trace, trace.componentRecord), 'the component sheet was emitted').toBeDefined();
  expect(trace.componentRecord, 'the document sheet was emitted').toBeDefined();

  expect(engineEntries(trace, 'tailwind'), 'the other engine was never resolved or loaded').toEqual(
    [],
  );
});

test('an explicit Tailwind declaration runs the official peer inside the graph', () => {
  // Positive control for the graph-entry engine: the official Vite plugin is
  // mounted (layer 2: its package loads), the component sheet compiles through
  // the official compiler (@tailwindcss/node loads), and the emitted bytes are
  // the compiler's own output (layer 4). providerCalls is legitimately empty
  // here — the Tailwind build path compiles through module functions, not the
  // provider object (see the layer-3 shape note in the header).
  const root = tailwindRoot();
  const trace = probe(root, { tailwind: true, candidates: ['gap-2'] });
  expect(trace.plan, 'an explicit declaration selects the pipeline').toBe(true);
  expect(trace.provider, 'the Tailwind provider was built').toBe('tailwind');
  expect(trace.errorCode).toBeUndefined();
  expect(trace.buildOk, 'the real build completed').toBe(true);
  expect(trace.providerCalls, 'no provider-object calls on this engine’s shape').toEqual([]);

  expect(trace.resolves, 'the official Vite peer was resolved (layer 1)').toContain(
    '@tailwindcss/vite',
  );
  expect(trace.resolves, 'the official compiler was resolved through the peer (layer 1)').toContain(
    '@tailwindcss/node',
  );
  expect(
    engineLoads(trace, 'tailwind').length,
    'the peer packages loaded (layer 2)',
  ).toBeGreaterThan(1);
  const componentCss = emittedCss(trace, trace.componentRecord);
  expect(
    componentCss,
    'the component sheet was emitted with the official compiler’s bytes (layer 4)',
  ).toMatch(/\.gap-2\s*\{/);
  expect(
    trace.cssAssets.length,
    'the graph carries exactly the two sheets: component + document entry',
  ).toBe(2);
  const documentCss = trace.cssAssets.find((asset) => asset.fileName !== trace.componentRecord);
  expect(
    documentCss?.css,
    'the application-owned document got the reset it asked for (layer 4)',
  ).toContain('box-sizing');

  expect(engineEntries(trace, 'unocss'), 'the other engine was never resolved or loaded').toEqual(
    [],
  );
});

test('an admitted package requirement enables the default engine with no declaration', () => {
  // Automatic mode: the package requirement is the only demand. The default
  // engine runs, and the reduced entry it enables is observable as the ABSENT
  // reset — a package's requirement never restyles the host document.
  const root = tailwindRoot();
  const trace = probe(root, {
    declarations: [
      {
        packageName: '@acme/widgets',
        tagName: 'acme-widget',
        required: true,
        dialect: 'tailwind4',
        sources: [],
      },
    ],
    candidates: ['gap-2'],
  });
  expect(trace.plan, 'the admitted requirement enables the pipeline').toBe(true);
  expect(trace.provider, 'the default engine compiles it').toBe('tailwind');
  expect(trace.buildOk, 'the real build completed').toBe(true);
  expect(trace.resolves, 'the default engine’s peer was resolved (layer 1)').toContain(
    '@tailwindcss/node',
  );
  expect(
    emittedCss(trace, trace.componentRecord),
    'the admitted candidate compiled through the official compiler (layer 4)',
  ).toMatch(/\.gap-2\s*\{/);
  expect(trace.cssAssets.length, 'exactly the two sheets, as for the declared shape').toBe(2);
  const documentCss = trace.cssAssets.find((asset) => asset.fileName !== trace.componentRecord);
  expect(
    documentCss?.css,
    'automatic mode never resets the application’s document (the reduced entry, observed)',
  ).not.toContain('box-sizing');
  expect(engineEntries(trace, 'unocss'), 'the other engine was never resolved or loaded').toEqual(
    [],
  );
});

test('a disabled entry that conflicts with an admitted requirement fails closed before any load', () => {
  const trace = probe(bareRoot(), {
    tailwind: false,
    declarations: [
      {
        packageName: '@acme/widgets',
        tagName: 'acme-widget',
        required: true,
        dialect: 'tailwind4',
        sources: [],
      },
    ],
  });
  expect(trace.errorCode, 'the conflict is a coded failure').toBe(
    PresetErrorCode.TAILWIND_REQUIRED_DISABLED,
  );
  expect(trace.plan, 'the plan never resolved').toBe(false);
  expect(trace.providerCalls, 'no compile ever ran').toEqual([]);
  expect(
    engineEntries(trace, 'tailwind'),
    'fail closed means fail BEFORE any engine resolution or load',
  ).toEqual([]);
  expect(engineEntries(trace, 'unocss'), 'neither the other engine').toEqual([]);
});

test('an enabled engine with no peer installed fails with its code, after a real attempt', () => {
  // The four layers in one row: the resolve ATTEMPT happened and is observed
  // (layer 1), no module ever loaded (layer 2), so no pipeline could compile
  // (layer 3) and no engine bytes exist (layer 4) — and the failure is the
  // entry seam's coded diagnostic, not a raw MODULE_NOT_FOUND.
  const trace = probe(bareRoot(), { unocss: true });
  expect(trace.errorCode, 'a missing peer is a coded failure').toBe(
    PresetErrorCode.UNOCSS_UNRESOLVABLE,
  );
  expect(trace.plan, 'the declaration still selected the pipeline').toBe(true);
  expect(trace.resolves, 'the peer resolve was ATTEMPTED from the app root (layer 1)').toContain(
    'unocss',
  );
  expect(engineLoads(trace, 'unocss'), 'and no engine module loaded (layer 2)').toEqual([]);
  expect(trace.providerCalls, 'no compile ran (layer 3)').toEqual([]);

  // NOT RUNNABLE HERE, stated rather than hidden: the Tailwind mirror of this
  // row cannot be produced in this repository. The router resolves
  // `@tailwindcss/vite` from its OWN installed tree (import.meta.resolve from
  // the source — `tailwind.ts`), and this repo installs it, so an in-repo
  // child always finds it. That resolution fact IS the optional-peer
  // installation contract; a consumer without the peer is covered by the
  // coded TAILWIND_UNRESOLVABLE diagnostics, whose presence is pinned by the
  // source, not by an in-repo reproduction.
});

// The plan-level conditions (false-authoritative, dialect support, ordering,
// document ownership) stay pinned where they belong — the plan unit tests in
// `style-provider.test.ts`. This file adds only what those cannot show: what
// the real pipeline LOADED and really COMPILED.
