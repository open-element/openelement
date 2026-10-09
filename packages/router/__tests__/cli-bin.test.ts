/**
 * @openelement/router — the `openelement` bin dispatcher (#1633).
 *
 * The packed manifest declares `src/cli/cli.ts` as the `openelement` bin, and
 * the generated starter's scripts run `openelement build` / `openelement
 * start`. This suite pins the dispatch contract against the two subpath
 * entries it fronts, so the bin can never drift from them:
 *
 *   1. `start [--mode=preview]` behaves exactly like running `cli/start.ts`
 *      with the same arguments (the flag passes through verbatim);
 *   2. `build` behaves exactly like running `cli/build.ts`;
 *   3. the usage paths answer without loading either subcommand's module
 *      graph — `start` must resolve in a consumer tree that has no Vite
 *      install (the same resolution `cli/start.ts` has), which an eager
 *      import of the build entry would break.
 */

import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { join } from 'node:path';

const cliBin = join(import.meta.dirname!, '../src/cli/cli.ts');
const startEntry = join(import.meta.dirname!, '../src/cli/start.ts');
const buildEntry = join(import.meta.dirname!, '../src/cli/build.ts');

async function run(
  executable: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; output: string }> {
  const child = spawn(process.execPath, [executable, ...args], { cwd });
  const [out, err] = await Promise.all([
    Array.fromAsync(child.stdout),
    Array.fromAsync(child.stderr),
  ]);
  const output = Buffer.concat([...out, ...err]).toString();
  const code = await new Promise<number>((resolve) => {
    child.once('exit', (c) => resolve(c ?? -1));
  });
  return { code, output };
}

test('openelement bin: usage and unknown commands fail closed without a subcommand load', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-bin-'));
  try {
    const bare = await run(cliBin, [], dir);
    expect(bare.code).toEqual(1);
    expect(bare.output).toContain('Usage: openelement <command> [options]');
    expect(bare.output).toContain('build');
    expect(bare.output).toContain('start');

    const unknown = await run(cliBin, ['frobnicate'], dir);
    expect(unknown.code).toEqual(1);
    expect(unknown.output).toContain('Unknown command "frobnicate".');

    const help = await run(cliBin, ['--help'], dir);
    expect(help.code).toEqual(0);
    expect(help.output).toContain('Usage: openelement <command> [options]');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('openelement bin: start and preview dispatch identically to the cli/start entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-bin-'));
  try {
    // Both paths must agree on the missing-dist refusal (the cheapest shared
    // outcome: no build needed, and it proves the arguments reached the same
    // parser).
    const binStart = await run(cliBin, ['start'], dir);
    const entryStart = await run(startEntry, [], dir);
    expect(binStart.output).toEqual(entryStart.output);
    expect(binStart.code).toEqual(entryStart.code);

    // The preview mode flag passes through verbatim, and the refusal names the
    // bin's own spelling as the alternative (#1633).
    await mkdir(join(dir, 'dist', 'server'), { recursive: true });
    await writeFile(join(dir, 'dist', 'server', 'index.js'), 'export default () => {};\n');
    const binPreview = await run(cliBin, ['start', '--mode=preview'], dir);
    const entryPreview = await run(startEntry, ['--mode=preview'], dir);
    expect(binPreview.output).toEqual(entryPreview.output);
    expect(binPreview.code).toEqual(1);
    expect(binPreview.output).toContain('request-time routes');
    expect(binPreview.output).toContain('pnpm start');
    expect(binPreview.output).toContain('(or: openelement start)');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('openelement bin: build dispatches identically to the cli/build entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-bin-'));
  try {
    // No app in the directory: both paths fail the same way, which pins that
    // `build` reaches buildApp through the same error rendering. Vite writes
    // its own progress lines first, so the shared contract is the rendered
    // `Build failed:` line (message plus the dispatcher's stack frame).
    const binBuild = await run(cliBin, ['build'], dir);
    const entryBuild = await run(buildEntry, [], dir);
    expect(binBuild.code).toEqual(entryBuild.code);
    expect(binBuild.code).toEqual(1);
    for (const output of [binBuild.output, entryBuild.output]) {
      expect(output).toContain('Build failed:');
      expect(output).toContain('Cannot resolve entry module index.html');
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});
