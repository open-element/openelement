import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform, release, tmpdir, totalmem, version } from 'node:os';
import { join, resolve } from 'node:path';
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

async function bundleFixture(
  buildRoot: string,
  directory: string,
  source: string,
): Promise<string> {
  const require = createRequire(join(buildRoot, 'package.json'));
  const compiler = (await import(
    pathToFileURL(require.resolve('@openelement/compiler')).href
  )) as typeof Compiler;
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
    resolve: {
      alias: [
        '@openelement/element/internal/compiled/leaf-runtime',
        '@openelement/element/internal/compiled/generated-element/shell',
        '@openelement/element',
      ].map((specifier) => ({ find: specifier, replacement: require.resolve(specifier) })),
    },
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
  const buildDirty = execFileSync(
    'git',
    [
      'status',
      '--porcelain',
      '--untracked-files=no',
      '--',
      'packages/compiler',
      'packages/element',
      'pnpm-lock.yaml',
    ],
    {
      cwd: buildRoot,
      encoding: 'utf8',
    },
  ).trim();
  if (buildDirty) throw new Error('The compared compiler, Element and lockfile must be clean');

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
      buildSha: revision(buildRoot),
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
