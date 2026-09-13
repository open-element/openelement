/**
 * Bounded diagnostic, not a ranking: deno run -A this-file. The qualified
 * construction/hit/miss/memory evidence for #1324 lives in the maintained
 * fork: open-element/url-pattern-list BENCHMARKS.md (Node, GC-controlled).
 */
import { RouteTable, URLPatternPolyfillConstructor } from '../src/internal/router/route-table.ts';
import { URLPatternList } from '@openelement/url-pattern-list';

async function main(): Promise<void> {
  const base = '0d826954cb96b3a9306119830defd6000a798c95';
  const source = await new Deno.Command('git', {
    args: ['show', `${base}:packages/router/src/internal/router/route-table.ts`],
    stdout: 'piped',
  }).output();
  if (!source.success) throw new Error('Baseline source unavailable');
  const baselineCode = new TextDecoder().decode(source.stdout)
    .replace(
      '@openelement/element/build-utils',
      new URL('../src/internal/router/route-pattern.ts', import.meta.url).href,
    )
    .replace("'urlpattern-polyfill'", "'npm:urlpattern-polyfill@10.1.0'");
  const file = await Deno.makeTempFile({ suffix: '.ts' });
  await Deno.writeTextFile(file, baselineCode);
  try {
    const { RouteTable: Baseline } = await import(new URL(`file://${file}`).href);
    console.log(
      JSON.stringify({
        deno: Deno.version,
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
          entries = paths.map((pathname, i) =>
            [new URLPatternPolyfillConstructor({ pathname }), i] as const
          );
          list = new URLPatternList();
          for (const [pattern, value] of entries) list.addPattern(pattern, value);
          build.push(performance.now() - start);
        }
        const oldBuild = performance.now();
        const old = new Baseline(records, URLPatternPolyfillConstructor);
        const oldBuildMs = performance.now() - oldBuild;
        const current = new RouteTable(records, URLPatternPolyfillConstructor);
        const linear = (url: URL) => entries.find(([pattern]) => pattern.exec(url.href));
        for (
          const path of [`/shared/catalog/${count - 1}/details`, '/shared/catalog/missing/details']
        ) {
          const url = new URL(path, 'https://localhost');
          const times: Record<string, number> = {};
          for (
            const [name, match] of Object.entries({
              original: () => old.match(path),
              linear: () => linear(url),
              ownedList: () => list.match(url),
              table: () => current.match(url),
            })
          ) {
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
    await Deno.remove(file);
  }
}

if (import.meta.main) await main();
