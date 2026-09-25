/**
 * #1455 keyed Region measurement. Fake DOM excludes layout/paint; this
 * measures the compiled runtime and counts actual insertBefore operations.
 * Timings are evidence, never a CI threshold or a claim about an old build.
 *
 * deno run --allow-write --allow-run benchmarks/micro/keyed-reorder.ts \
 *   --samples 10 --out /tmp/openelement-keyed-reorder.json
 */
import {
  type CompiledRuntimeHost,
  createFreshDom,
} from '../../packages/element/src/internal/compiled/runtime.ts';
import { signal } from '../../packages/element/src/internal/signal/framework.ts';
import { testProgram } from '../../packages/element/__tests__/compiled-runtime/test-program.ts';
import { FDocument, FElement } from './counting-dom.ts';

interface Row {
  id: string;
  text: string;
}

const program = testProgram({
  tag: 'oe-keyed-measure',
  template: [{ k: 'el', tag: 'ul', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [{
    k: 'each',
    index: 0,
    signal: 'items',
    key: 'id',
    field: 'text',
    item: [{
      k: 'el',
      tag: 'li',
      attrs: [],
      iattrs: [['data-id', 'id']],
      children: [{ k: 'ival', field: 'text' }],
    }],
  }],
});

function measure(size: number, scenario: 'swap' | 'rotate') {
  const initial: Row[] = Array.from({ length: size }, (_, index) => ({
    id: String(index),
    text: String(index),
  }));
  const next = initial.slice();
  if (scenario === 'swap') {
    [next[1], next[size - 2]] = [next[size - 2], next[1]];
  } else {
    next.push(next.shift()!);
  }
  const items = signal(initial);
  const host = { signals: { items }, handlers: {} } as unknown as CompiledRuntimeHost;
  const document = new FDocument();
  const root = document.createElement('host');
  const instance = createFreshDom(program, host, root as unknown as Node);
  try {
    const list = root.childNodes[0] as FElement;
    const before = list.childNodes.filter((node): node is FElement => node instanceof FElement);
    document.resetCounts();
    const start = performance.now();
    items.value = next;
    const ms = performance.now() - start;
    const after = list.childNodes.filter((node): node is FElement => node instanceof FElement);
    const identityPreserved = after.length === size &&
      after.every((row, index) =>
        row === before[Number(next[index].id)] &&
        row.getAttribute('data-id') === next[index].id
      );
    const moves = document.counts.insertions;
    if (
      !identityPreserved || moves !== (scenario === 'swap' ? 2 : 1) ||
      document.counts.removals !== 0
    ) {
      throw new Error(
        `keyed ${size} ${scenario} drift: identity=${identityPreserved}, moves=${moves}, removals=${document.counts.removals}`,
      );
    }
    return { ms, moves, removals: document.counts.removals, identityPreserved };
  } finally {
    instance.dispose();
  }
}

if (import.meta.main) {
  const option = (name: string, fallback?: string): string | undefined => {
    const position = Deno.args.indexOf(name);
    return position < 0 ? fallback : Deno.args[position + 1];
  };
  const sampleCount = Number(option('--samples', '10'));
  const out = option('--out');
  if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount > 100 || !out) {
    throw new Error('pass --samples 2..100 and --out <path>');
  }
  const git = new Deno.Command('git', {
    args: ['rev-parse', 'HEAD'],
    stdout: 'piped',
    stderr: 'null',
  });
  const revision = new TextDecoder().decode((await git.output()).stdout).trim();
  const cases = [];
  for (const size of [1000, 10000]) {
    for (const scenario of ['swap', 'rotate'] as const) {
      measure(size, scenario);
      const samples = [];
      for (let index = 0; index < sampleCount; index++) {
        samples.push(measure(size, scenario));
      }
      cases.push({ size, scenario, samples });
    }
  }
  const report = {
    schemaVersion: 1,
    issue: 1455,
    recordedAt: new Date().toISOString(),
    environment: {
      revision,
      workspaceDirty: true,
      deno: Deno.version.deno,
      os: Deno.build.os,
      arch: Deno.build.arch,
      logicalCores: navigator.hardwareConcurrency,
      dom: 'counting fake DOM; no browser layout or paint',
    },
    sampleCount,
    cases,
  };
  await Deno.writeTextFile(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `keyed reorder evidence: ${cases.length} cases, ${sampleCount} samples each -> ${out}`,
  );
}
