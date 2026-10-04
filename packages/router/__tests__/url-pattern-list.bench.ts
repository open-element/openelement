/**
 * Bounded diagnostic, not a ranking: run with Node
 * (`node packages/router/__tests__/url-pattern-list.bench.ts`; not part of
 * the vitest suite). The qualified construction/hit/miss/memory evidence for
 * #1324 lives in the maintained fork: open-element/url-pattern-list
 * BENCHMARKS.md (Node, GC-controlled).
 */
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import process from 'node:process';
import { ScriptTarget, transpileModule } from 'typescript';

const execFile = promisify(execFileCallback);
import { RouteTable } from '../src/internal/router/route-table.ts';
import { URLPatternList } from '@openelement/url-pattern-list';

if (typeof globalThis.URLPattern !== 'function') {
  throw new TypeError(
    'URLPattern bench requires the Web Standard URLPattern API, which is unavailable in this runtime.',
  );
}
const NativeURLPattern = globalThis.URLPattern;

async function main(): Promise<void> {
  const base = '0d826954cb96b3a9306119830defd6000a798c95';
  // The baseline predates the router package extraction: the table lived in
  // packages/app/src/internal/router/.
  const { stdout } = await execFile('git', [
    'show',
    `${base}:packages/app/src/internal/router/route-table.ts`,
  ]);
  const baselineCode = stdout
    .replace(
      '@openelement/element/build-utils',
      new URL('../src/internal/router/route-pattern.ts', import.meta.url).href,
    )
    // The baseline's retired 'urlpattern-polyfill' fallback import: the
    // maintained fork no longer exports a URLPattern class, and the baseline
    // itself prefers globalThis.URLPattern when it exists (it does on every
    // supported Node), so the fallback binds to the native constructor.
    .replace(
      "import { URLPattern as URLPatternPolyfill } from 'urlpattern-polyfill';",
      'const URLPatternPolyfill = globalThis.URLPattern;',
    );
  // The baseline uses parameter properties, which Node's type stripping
  // rejects: transpile to plain JavaScript before importing.
  const baselineJs = transpileModule(baselineCode, {
    compilerOptions: {
      target: ScriptTarget.Latest,
      module: ScriptTarget.ESNext,
    },
  }).outputText;
  const dir = await mkdtemp(join(tmpdir(), 'oe-url-pattern-bench-'));
  const file = join(dir, 'route-table.baseline.mjs');
  await writeFile(file, baselineJs);
  try {
    const { RouteTable: Baseline } = await import(pathToFileURL(file).href);
    console.log(
      JSON.stringify({
        node: process.version,
        baseline: base,
        memory: 'measured in the fork: open-element/url-pattern-list BENCHMARKS.md',
        samples: 5,
        lookupsPerSample: 100,
      }),
    );
    const median = (values: number[]) =>
      values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    for (const count of [100, 1000, 5000]) {
      for (const conservative of [false, true]) {
        const paths = Array.from({ length: count }, (_, i) => `/shared/catalog/${i}/details`);
        if (conservative) paths.unshift('/shared/:path*');
        const records = paths.map((path) => ({ path }));
        const build: number[] = [];
        let entries: Array<readonly [URLPattern, number]> = [];
        let list!: URLPatternList<number>;
        for (let sample = 0; sample < 5; sample++) {
          const start = performance.now();
          entries = paths.map((pathname, i) => [new NativeURLPattern({ pathname }), i] as const);
          list = new URLPatternList();
          for (const [pattern, value] of entries) list.addPattern(pattern, value);
          build.push(performance.now() - start);
        }
        const oldBuild = performance.now();
        const old = new Baseline(records, NativeURLPattern);
        const oldBuildMs = performance.now() - oldBuild;
        const current = new RouteTable(records, NativeURLPattern);
        const linear = (url: URL) => entries.find(([pattern]) => pattern.exec(url.href));
        for (const path of [
          `/shared/catalog/${count - 1}/details`,
          '/shared/catalog/missing/details',
        ]) {
          const url = new URL(path, 'https://localhost');
          const times: Record<string, number> = {};
          for (const [name, match] of Object.entries({
            original: () => old.match(path),
            linear: () => linear(url),
            ownedList: () => list.match(url),
            table: () => current.match(url),
          })) {
            match();
            const samples = [];
            for (let sample = 0; sample < 5; sample++) {
              const start = performance.now();
              for (let i = 0; i < 100; i++) match();
              samples.push((performance.now() - start) / 100);
            }
            times[name] = median(samples);
          }
          console.log(
            JSON.stringify({
              count,
              conservative,
              path,
              buildListMedianMs: median(build),
              originalBuildSingleMs: oldBuildMs,
              matchMedianMs: times,
            }),
          );
        }
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
