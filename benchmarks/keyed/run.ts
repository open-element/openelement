import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform, release, tmpdir, totalmem, version } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { build } from 'vite';
import type * as Compiler from '@openelement/compiler';

const harness = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(harness, '../..');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const tag = 'oe-keyed-bench';
const workload = { rowCount: 1000, updateStride: 10, updates: 16, warmupSamples: 5 };
const viewport = { width: 1280, height: 900 };

function revision(directory: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
}

function positiveInteger(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error(`Expected a positive integer: ${value}`);
  return number;
}

function macPowerState(option: 'batt' | 'therm'): string | undefined {
  if (platform() !== 'darwin') return undefined;
  try {
    const output = execFileSync('pmset', ['-g', option], { encoding: 'utf8' });
    // Keep the power source and thermal warnings without battery identifiers.
    return option === 'batt' ? output.split('\n', 1)[0] : output.trim();
  } catch {
    return undefined;
  }
}

async function resolveBuildInput(
  buildRoot: string,
  from: ReturnType<typeof createRequire>,
  packageName: 'compiler' | 'element' | 'protocol',
  specifier: string,
): Promise<string> {
  const packageDir = join(buildRoot, 'packages', packageName);
  const resolved = await realpath(from.resolve(specifier));
  const pathInPackage = relative(packageDir, resolved);
  if (!pathInPackage || isAbsolute(pathInPackage) || pathInPackage.split(sep)[0] === '..') {
    throw new Error(`${specifier} resolved to ${resolved} outside ${packageDir}`);
  }
  return resolved;
}

async function bundleFixture(
  buildRoot: string,
  directory: string,
  source: string,
): Promise<string> {
  const fromRoot = createRequire(join(buildRoot, 'package.json'));
  const compilerPath = await resolveBuildInput(
    buildRoot,
    fromRoot,
    'compiler',
    '@openelement/compiler',
  );
  const elementEntries = [
    '@openelement/element/internal/compiled/leaf-runtime',
    '@openelement/element/internal/compiled/generated-element/shell',
    '@openelement/element',
  ];
  const aliases = await Promise.all(
    elementEntries.map(async (specifier) => ({
      find: specifier,
      replacement: await resolveBuildInput(buildRoot, fromRoot, 'element', specifier),
    })),
  );

  // Compiler and Element resolve their own Protocol dependencies through
  // package-local links. A root-level resolve would miss swapped links there.
  const protocol = JSON.parse(
    await readFile(join(buildRoot, 'packages/protocol/package.json'), 'utf8'),
  ) as {
    exports: Record<string, string>;
  };
  for (const importer of [compilerPath, ...aliases.map(({ replacement }) => replacement)]) {
    const fromImporter = createRequire(importer);
    await Promise.all(
      Object.keys(protocol.exports).map((entry) =>
        resolveBuildInput(
          buildRoot,
          fromImporter,
          'protocol',
          entry === '.' ? '@openelement/protocol' : `@openelement/protocol/${entry.slice(2)}`,
        ),
      ),
    );
  }

  const compiler = (await import(pathToFileURL(compilerPath).href)) as typeof Compiler;
  const compiled = compiler.compileGeneratedElementIfAdmitted(
    source,
    '/benchmarks/keyed/table.tsx',
    {
      site: { tag },
      authoredSource: source,
    },
  );
  if (!compiled) throw new Error('Compiler declined the keyed generated element');

  const entry = join(directory, 'entry.ts');
  await writeFile(join(directory, 'table.js'), compiled.code);
  await writeFile(
    entry,
    `import Table from './table.js';
import { installBenchmark } from ${JSON.stringify(join(harness, 'browser.ts'))};
installBenchmark(Table, ${JSON.stringify({ tag, ...workload })});\n`,
  );

  const output = await build({
    root: directory,
    configFile: false,
    mode: 'production',
    logLevel: 'error',
    resolve: { alias: aliases },
    build: {
      write: false,
      lib: { entry, formats: ['iife'], name: 'KeyedBenchmark' },
    },
  });
  if (!Array.isArray(output) || output.length !== 1) throw new Error('Expected one browser build');
  const chunk = output[0]?.output.find((item) => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Browser build has no entry chunk');
  return chunk.code;
}

async function measureRun(bundle: string, sampleCount: number) {
  const loadBefore = loadavg();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    await page.setContent('<!doctype html><title>Keyed update</title><main></main>');
    await page.addScriptTag({ content: bundle });
    const samplesMs = await page.evaluate(
      async ({ sampleCount, warmup }) => {
        const run = (
          globalThis as typeof globalThis & {
            runKeyedSample: () => Promise<number>;
          }
        ).runKeyedSample;
        const samples: number[] = [];
        for (let index = 0; index < warmup + sampleCount; index++) {
          const elapsed = await run();
          if (!Number.isFinite(elapsed) || elapsed <= 0)
            throw new Error('Browser timer returned no duration');
          if (index >= warmup) samples.push(elapsed);
        }
        return samples;
      },
      { sampleCount, warmup: workload.warmupSamples },
    );
    if (pageErrors.length)
      throw new AggregateError(pageErrors, 'Browser errors during measurement');
    return {
      browserVersion: browser.version(),
      dpr: await page.evaluate(() => devicePixelRatio),
      loadBefore,
      loadAfter: loadavg(),
      samplesMs,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      runs: { type: 'string', default: '5' },
      samples: { type: 'string', default: '15' },
      'build-root': { type: 'string', default: repo },
      note: { type: 'string', default: '' },
      out: { type: 'string' },
    },
  });
  const count = positiveInteger(values.runs);
  const sampleCount = positiveInteger(values.samples);
  const buildRoot = await realpath(values['build-root']);
  const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: buildRoot,
    encoding: 'utf8',
  }).trim();
  if ((await realpath(gitRoot)) !== buildRoot)
    throw new Error('The build root must be a Git checkout root');
  const buildSha = revision(buildRoot);
  const buildDirty = execFileSync(
    'git',
    [
      'status',
      '--porcelain',
      '--untracked-files=normal',
      '--',
      'packages/compiler',
      'packages/element',
      'packages/protocol',
      'package.json',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
    ],
    { cwd: buildRoot, encoding: 'utf8' },
  ).trim();
  if (buildDirty) {
    throw new Error(
      `Compared Compiler, Element, Protocol and workspace inputs must be clean:\n${buildDirty}`,
    );
  }

  const directory = await mkdtemp(join(tmpdir(), 'oe-keyed-bench-'));
  try {
    const source = await readFile(join(harness, 'table.tsx'), 'utf8');
    const harnessSources = await Promise.all(
      ['run.ts', 'browser.ts', 'table.tsx'].map((name) => readFile(join(harness, name), 'utf8')),
    );
    const bundle = await bundleFixture(buildRoot, directory, source);
    const runs: Awaited<ReturnType<typeof measureRun>>[] = [];
    const recordedAt = new Date().toISOString();
    const power = {
      source: macPowerState('batt'),
      thermalBefore: macPowerState('therm'),
      note: values.note || 'No operator power or thermal note.',
    };
    for (let index = 0; index < count; index++) {
      console.error(`Chromium run ${index + 1}/${count}`);
      runs.push(await measureRun(bundle, sampleCount));
    }
    const report = {
      schemaVersion: 1,
      workload: { ...workload, sampleCount },
      recordedAt,
      buildSha,
      bundleSha256: sha256(bundle),
      harnessSha: revision(repo),
      harnessSha256: sha256(JSON.stringify(harnessSources)),
      machine: {
        cpu: cpus()[0]?.model ?? 'unknown',
        logicalCpus: cpus().length,
        memoryBytes: totalmem(),
        arch: process.arch,
        platform: platform(),
        osVersion: version(),
        osRelease: release(),
        node: process.version,
        viewport,
        headless: true,
      },
      power: { ...power, thermalAfter: macPowerState('therm') },
      runs,
    };
    const result = JSON.stringify(report, null, 2) + '\n';
    if (values.out) await writeFile(values.out, result);
    else process.stdout.write(result);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
