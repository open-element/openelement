/**
 * Non-blocking local performance census. Measurements are observations, never
 * admission predicates: write the JSON to PERF_RECORD_OUTPUT when it should be
 * retained, otherwise it stays in the OS temp directory.
 */

import { walk } from '@std/fs/walk';
import { join } from '@std/path';
import { runMicroSuite } from '../benchmarks/micro/micro.ts';

interface CommandMeasurement {
  command: string;
  durationMs: number;
  ok: boolean;
  output?: string;
}

async function measure(command: string, args: string[]): Promise<CommandMeasurement> {
  const started = performance.now();
  const result = await new Deno.Command(command, {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  return {
    command: `${command} ${args.join(' ')}`,
    durationMs: Math.round(performance.now() - started),
    ok: result.success,
    ...(result.success ? {} : { output: output.slice(-4_000) }),
  };
}

async function outputSummary(root: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  try {
    for await (const entry of walk(root, { includeDirs: false })) {
      files++;
      bytes += (await Deno.stat(entry.path)).size;
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return { files, bytes };
}

async function gitSha(): Promise<string> {
  const result = await new Deno.Command('git', { args: ['rev-parse', 'HEAD'], stdout: 'piped' })
    .output();
  return new TextDecoder().decode(result.stdout).trim();
}

const build = {
  element: await measure(Deno.execPath(), ['task', '--filter', '@openelement/element', 'build']),
  router: await measure(Deno.execPath(), ['task', '--filter', '@openelement/router', 'build']),
  requestTimeFixture: await measure(Deno.execPath(), ['task', 'fixture:router-request-time:build']),
};
const { report: micro } = runMicroSuite({ openElementSha: await gitSha() });
const evidence = {
  schemaVersion: 1,
  kind: 'non-blocking-performance-record',
  recordedAt: new Date().toISOString(),
  sha: await gitSha(),
  build,
  outputs: {
    browserBundle: await outputSummary(join('fixtures', 'router-request-time', 'dist', 'client')),
    server: await outputSummary(join('fixtures', 'router-request-time', 'dist', 'server')),
  },
  routerMicroAndMemory: {
    compilerMedianMs: micro.compiler.medianMs,
    heapGrowthBytes: micro.stability.heapGrowthBytes,
    retainedSubscriptions: micro.stability.retainedSubscriptions,
    retainedListeners: micro.stability.retainedListeners,
  },
};
const output = Deno.env.get('PERF_RECORD_OUTPUT') ?? await Deno.makeTempFile({
  prefix: 'openelement-perf-',
  suffix: '.json',
});
await Deno.writeTextFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(`Performance record (non-blocking): ${output}`);
