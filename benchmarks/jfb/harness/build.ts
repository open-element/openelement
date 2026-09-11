/**
 * Builds all JFB harness implementation bundles into an out-of-tree build
 * directory (issue #1219):
 *
 * - `oe`: compiles benchmarks/jfb/src/oe/jfb-table.tsx with the canonical
 *   compileElementProgram, then bundles the generated module with the
 *   repo-pinned Vite (@openelement/element resolved to workspace source).
 * - `vanillajs`: stock sources served verbatim (stock has no build step).
 * - npm comparators (preact-signals, lit, solid, vue, svelte): stock sources
 *   at the pinned JFB commit are bundled in a per-implementation npm sandbox
 *   using the stock package.json dependency ranges, with esbuild doing only
 *   what the stock rollup/vite setups do (JSX transform, decorator
 *   transpile, SFC/Svelte compilation, minification). Exact resolved package
 *   versions are recorded for provenance.
 *
 * All outputs live OUTSIDE the repository (default: <os-tmp>/openelement-jfb)
 * so repo gates never scan generated or third-party files.
 */
import { join } from '@std/path';
import { compileElementProgram } from '../../../packages/element/src/internal/compiler/semantic-core/compile.ts';
import { fetchStockSources, JFB_COMMIT } from './fetch-stock.ts';

const repoRoot = new URL('../../..', import.meta.url).pathname;
const oeSourcePath = join(repoRoot, 'benchmarks/jfb/src/oe/jfb-table.tsx');
const oeIndexPath = join(repoRoot, 'benchmarks/jfb/src/oe/index.html');

export interface ComparatorSandboxSpec {
  id: string;
  /** Stock dependency ranges, verbatim from the stock package.json. */
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

const ESBUILD_VERSION_RANGE = '^0.25.0';

export const COMPARATOR_SANDBOXES: ComparatorSandboxSpec[] = [
  {
    id: 'preact-signals',
    dependencies: { preact: '^10.29.8', '@preact/signals': '^2.3.1' },
    devDependencies: { esbuild: ESBUILD_VERSION_RANGE },
  },
  {
    id: 'lit',
    dependencies: { lit: '^3.0.0' },
    devDependencies: { esbuild: ESBUILD_VERSION_RANGE },
  },
  {
    id: 'solid',
    dependencies: { 'solid-js': '^1.9.3' },
    devDependencies: {
      esbuild: ESBUILD_VERSION_RANGE,
      '@babel/core': '^7.26.0',
      'babel-preset-solid': '^1.9.3',
    },
  },
  {
    id: 'vue',
    dependencies: { vue: '^3.5.39' },
    devDependencies: { esbuild: ESBUILD_VERSION_RANGE, '@vue/compiler-sfc': '^3.5.39' },
  },
  {
    id: 'svelte',
    dependencies: {},
    devDependencies: { esbuild: ESBUILD_VERSION_RANGE, svelte: '^5.42.1' },
  },
];

/**
 * Generic per-comparator bundler executed under Node inside the sandbox.
 * Mirrors the stock build toolchains (rollup+babel / vite+plugin-vue /
 * rollup-plugin-svelte): the transformation semantics are the stock ones,
 * only the orchestration differs. Written verbatim into each sandbox.
 */
const SANDBOX_BUILD_SCRIPT = String.raw`
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const impl = process.argv[2];
mkdirSync('dist', { recursive: true });

async function bundle(entry, extra = {}) {
  await esbuild.build({
    entryPoints: [entry].flat(),
    bundle: true,
    minify: true,
    format: 'iife',
    outfile: 'dist/main.js',
    logLevel: 'silent',
    ...extra,
  });
}

if (impl === 'preact-signals') {
  // Stock: rollup + babel-preset-preact (classic JSX, pragma h).
  await esbuild.build({
    entryPoints: ['src/main.jsx'],
    bundle: true,
    minify: true,
    format: 'iife',
    outfile: 'dist/main.js',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    loader: { '.jsx': 'jsx' },
    logLevel: 'silent',
  });
} else if (impl === 'lit') {
  // Stock: rollup + @rollup/plugin-typescript with the stock tsconfig
  // (experimentalDecorators, target es2017 -> useDefineForClassFields off).
  await bundle(['src/main.ts'], {
    tsconfigRaw: JSON.stringify({
      compilerOptions: {
        target: 'es2017',
        module: 'es2015',
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    }),
  });
} else if (impl === 'solid') {
  // Stock: rollup + babel-preset-solid, then bundle.
  const babel = await import('@babel/core');
  const result = babel.transformFileSync('src/main.jsx', {
    presets: ['babel-preset-solid'],
    filename: 'main.jsx',
    babelrc: false,
    configFile: false,
  });
  writeFileSync('src/main.compiled.js', result.code);
  await bundle(['src/main.compiled.js']);
} else if (impl === 'vue') {
  // Stock: vite + @vitejs/plugin-vue. Compile the SFC with the official
  // compiler-sfc and bundle; stock src/main.js mounts #app unchanged.
  const sfc = await import('@vue/compiler-sfc');
  const source = readFileSync('src/App.vue', 'utf8');
  const { descriptor, errors } = sfc.parse(source, { filename: 'App.vue' });
  if (errors.length) throw new Error('SFC parse failed: ' + errors.join('; '));
  const script = sfc.compileScript(descriptor, { id: 'jfb' });
  const template = sfc.compileTemplate({
    source: descriptor.template.content,
    filename: 'App.vue',
    id: 'jfb',
    compilerOptions: { bindingMetadata: script.bindings },
  });
  if (template.errors.length) throw new Error('template compile failed: ' + template.errors.join('; '));
  const scriptCode = script.content.replace('export default', 'const __sfc__ =');
  const renderCode = template.code.replace('export function render', 'function render');
  writeFileSync('src/App.compiled.js', scriptCode + '\n' + renderCode + '\n__sfc__.render = render;\nexport default __sfc__;\n');
  const main = readFileSync('src/main.js', 'utf8').replace("'./App.vue'", "'./App.compiled.js'");
  writeFileSync('src/main.bundled.js', main);
  await bundle(['src/main.bundled.js']);
} else if (impl === 'svelte') {
  // Stock: rollup + rollup-plugin-svelte.
  const { compile } = await import('svelte/compiler');
  const source = readFileSync('src/Main.svelte', 'utf8');
  const compiled = compile(source, { filename: 'Main.svelte', css: 'injected' });
  writeFileSync('src/Main.compiled.js', compiled.js.code);
  const main = readFileSync('src/main.js', 'utf8').replace('"./Main.svelte"', '"./Main.compiled.js"');
  writeFileSync('src/main.bundled.js', main);
  await bundle(['src/main.bundled.js']);
} else {
  throw new Error('unknown comparator ' + impl);
}
console.log('built', impl);
`;

export interface BuildReport {
  buildDir: string;
  jfbCommit: string;
  stockFetch: Array<{ path: string; sha256: string; source: string }>;
  oe: {
    compileMs: number;
    programBytes: number;
    generatedModuleBytes: number;
    bundleBytes: number;
    parts: string[];
  };
  comparators: Array<{
    id: string;
    built: boolean;
    bundleBytes?: number;
    resolvedVersions?: Record<string, string>;
    error?: string;
  }>;
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  const result = await new Deno.Command(command, {
    args,
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  }).output();
  if (!result.success) {
    throw new Error(`[jfb-build] ${command} ${args.join(' ')} failed in ${cwd}`);
  }
}

async function buildOe(buildDir: string): Promise<BuildReport['oe']> {
  const srcDir = join(buildDir, 'oe-src');
  await Deno.mkdir(srcDir, { recursive: true });
  const source = await Deno.readTextFile(oeSourcePath);
  const compileStarted = performance.now();
  const compiled = compileElementProgram(source, '/benchmarks/jfb/src/oe/jfb-table.tsx');
  const compileMs = performance.now() - compileStarted;
  await Deno.writeTextFile(join(srcDir, 'jfb-table.generated.ts'), compiled.code);
  await Deno.copyFile(join(repoRoot, 'benchmarks/jfb/src/oe/data.ts'), join(srcDir, 'data.ts'));
  await Deno.writeTextFile(
    join(srcDir, 'entry.ts'),
    [
      "import { JfbOeTable } from './jfb-table.generated.ts';",
      "customElements.define('jfb-oe-table', JfbOeTable);",
      "document.getElementById('main')!.appendChild(document.createElement('jfb-oe-table'));",
      '',
    ].join('\n'),
  );
  await Deno.writeTextFile(
    join(srcDir, 'vite.config.ts'),
    [
      '// Plain object export: the sandbox config must not require a vite install.',
      "import { fileURLToPath } from 'node:url';",
      'const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));',
      'export default {',
      '  resolve: {',
      "    alias: { '@openelement/element': " +
      JSON.stringify(join(repoRoot, 'packages/element/src/index.ts')) + ' },',
      '  },',
      '  build: {',
      "    outDir: r('../oe'),",
      '    emptyOutDir: true,',
      '    minify: true,',
      '    rollupOptions: {',
      "      input: r('./entry.ts'),",
      "      output: { entryFileNames: 'main.js', format: 'esm' },",
      '    },',
      '  },',
      '};',
      '',
    ].join('\n'),
  );
  await runCommand('node', [
    join(repoRoot, 'node_modules/vite/bin/vite.js'),
    'build',
    '--config',
    'vite.config.ts',
  ], srcDir);
  await Deno.copyFile(oeIndexPath, join(buildDir, 'oe', 'index.html'));
  const bundle = await Deno.stat(join(buildDir, 'oe', 'main.js'));
  return {
    compileMs,
    programBytes: new TextEncoder().encode(JSON.stringify(compiled.program)).byteLength,
    generatedModuleBytes: new TextEncoder().encode(compiled.code).byteLength,
    bundleBytes: bundle.size,
    parts: compiled.program.parts.map((part) => part.k),
  };
}

async function buildComparator(
  buildDir: string,
  sandboxRoot: string,
  spec: ComparatorSandboxSpec,
): Promise<BuildReport['comparators'][number]> {
  const sandbox = join(sandboxRoot, spec.id);
  await Deno.mkdir(join(sandbox, 'src'), { recursive: true });
  // Copy stock sources (already sha256-verified by fetchStockSources).
  const stockDir = join(buildDir, 'stock/frameworks/keyed', spec.id);
  for await (const entry of Deno.readDir(join(stockDir, 'src'))) {
    await Deno.copyFile(join(stockDir, 'src', entry.name), join(sandbox, 'src', entry.name));
  }
  await Deno.writeTextFile(
    join(sandbox, 'package.json'),
    JSON.stringify(
      {
        name: `jfb-stock-${spec.id}`,
        private: true,
        dependencies: spec.dependencies,
        devDependencies: spec.devDependencies,
      },
      null,
      2,
    ),
  );
  await Deno.writeTextFile(join(sandbox, 'build.mjs'), SANDBOX_BUILD_SCRIPT);
  await runCommand('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], sandbox);
  await runCommand('node', ['build.mjs', spec.id], sandbox);
  const outDir = join(buildDir, spec.id);
  await Deno.mkdir(join(outDir, 'dist'), { recursive: true });
  await Deno.copyFile(join(sandbox, 'dist/main.js'), join(outDir, 'dist/main.js'));
  await Deno.copyFile(join(stockDir, 'index.html'), join(outDir, 'index.html'));
  if (spec.id === 'vue') {
    // Stock vue index.html references ./src/main.js as a module; mirror it.
    await Deno.mkdir(join(outDir, 'src'), { recursive: true });
    await Deno.copyFile(join(sandbox, 'dist/main.js'), join(outDir, 'src/main.js'));
  }
  const resolvedVersions: Record<string, string> = {};
  for (const name of [...Object.keys(spec.dependencies), ...Object.keys(spec.devDependencies)]) {
    try {
      const manifest = JSON.parse(
        await Deno.readTextFile(join(sandbox, 'node_modules', name, 'package.json')),
      ) as { version?: string };
      if (manifest.version) resolvedVersions[name] = manifest.version;
    } catch { /* transitive-only */ }
  }
  const bundleStat = await Deno.stat(join(outDir, 'dist/main.js'));
  return { id: spec.id, built: true, bundleBytes: bundleStat.size, resolvedVersions };
}

export interface BuildOptions {
  buildDir?: string;
  jfbPath?: string;
  /** Skip npm comparators (offline / quick local iteration). */
  localOnly?: boolean;
}

export async function buildHarness(options: BuildOptions = {}): Promise<BuildReport> {
  const buildDir = options.buildDir ?? join(await Deno.makeTempDir(), 'openelement-jfb');
  const sandboxRoot = join(buildDir, 'sandbox');
  await Deno.mkdir(join(buildDir, 'stock'), { recursive: true });
  const stockFetch = await fetchStockSources(join(buildDir, 'stock'), { jfbPath: options.jfbPath });
  // Shared stylesheet (served at /css/currentStyle.css for every page).
  await Deno.mkdir(join(buildDir, 'css'), { recursive: true });
  await Deno.copyFile(
    join(buildDir, 'stock/css/currentStyle.css'),
    join(buildDir, 'css/currentStyle.css'),
  );
  // vanillajs: verbatim stock, no build step (as upstream).
  await Deno.mkdir(join(buildDir, 'vanillajs/src'), { recursive: true });
  await Deno.copyFile(
    join(buildDir, 'stock/frameworks/keyed/vanillajs/index.html'),
    join(buildDir, 'vanillajs/index.html'),
  );
  await Deno.copyFile(
    join(buildDir, 'stock/frameworks/keyed/vanillajs/src/Main.js'),
    join(buildDir, 'vanillajs/src/Main.js'),
  );
  const oe = await buildOe(buildDir);
  const comparators: BuildReport['comparators'] = [];
  for (const spec of COMPARATOR_SANDBOXES) {
    if (options.localOnly) {
      comparators.push({ id: spec.id, built: false, error: 'skipped (--local-only)' });
      continue;
    }
    try {
      comparators.push(await buildComparator(buildDir, sandboxRoot, spec));
    } catch (error) {
      comparators.push({
        id: spec.id,
        built: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { buildDir, jfbCommit: JFB_COMMIT, stockFetch, oe, comparators };
}

if (import.meta.main) {
  const localOnly = Deno.args.includes('--local-only');
  const jfbPathIndex = Deno.args.indexOf('--jfb-path');
  const jfbPath = jfbPathIndex >= 0 ? Deno.args[jfbPathIndex + 1] : undefined;
  const buildDirIndex = Deno.args.indexOf('--build-dir');
  const buildDir = buildDirIndex >= 0 ? Deno.args[buildDirIndex + 1] : undefined;
  const report = await buildHarness({ buildDir, jfbPath, localOnly });
  console.log(JSON.stringify(report, null, 2));
}
