/**
 * @openelement/router — the `openelement` / `oe` bin dispatcher (#1633).
 *
 * The manifest declares `src/cli/cli.ts` as the bin target under two names —
 * `openelement` (the long, unambiguous spelling) and `oe` (the short alias) —
 * and the generated starter's scripts run `openelement build` / `openelement
 * start`. This suite pins the dispatch contract against the two subpath
 * entries the bins front, so the bins can never drift from them:
 *
 *   1. the manifest maps both bin names to the same entry file — the alias
 *      is zero-behavior-difference by construction, and every behavioral
 *      assertion below runs once per declared bin name through the target
 *      the manifest itself names (not a hardcoded path), so a renamed,
 *      dropped, or re-pointed entry fails here first;
 *   2. `start [--mode=preview]` behaves exactly like running `cli/start.ts`
 *      with the same arguments (the flag passes through verbatim);
 *   3. `build` behaves exactly like running `cli/build.ts`;
 *   4. the usage paths answer without loading either subcommand's module
 *      graph — `start` must resolve in a consumer tree that has no Vite
 *      install (the same resolution `cli/start.ts` has), which an eager
 *      import of the build entry would break;
 *   5. `version` / `--version` / `-v` print the executing tree's package
 *      version (read from the router manifest beside the module, not the
 *      working directory), and the usage text names the command and the
 *      `oe` alias.
 */

import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { join } from 'node:path';

const pkgRoot = join(import.meta.dirname!, '..');
const cliBin = join(pkgRoot, 'src/cli/cli.ts');
const startEntry = join(pkgRoot, 'src/cli/start.ts');
const buildEntry = join(pkgRoot, 'src/cli/build.ts');

/**
 * The bin map exactly as the manifest declares it. Every behavioral test
 * iterates over this map, so the suite exercises the bins npm will actually
 * materialize rather than a copy of their declaration.
 */
function declaredBins(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
    bin?: Record<string, string>;
  };
  if (!manifest.bin || typeof manifest.bin !== 'object') {
    throw new Error('[openelement] router package.json declares no bin map');
  }
  return manifest.bin;
}

/** The manifest-declared target of one bin name, resolved to an absolute path. */
function binTarget(binName: string): string {
  const target = declaredBins()[binName];
  if (typeof target !== 'string') {
    throw new Error(`[openelement] router package.json declares no "${binName}" bin`);
  }
  return join(pkgRoot, target.replace(/^\.\//, ''));
}

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

test('router bins: the manifest maps openelement and oe onto one shared entry', () => {
  const bins = declaredBins();
  // Exactly the two names, and both name the same file: the alias cannot
  // diverge behaviorally because there is no second dispatcher to drift.
  expect(Object.keys(bins).sort()).toEqual(['oe', 'openelement']);
  expect(bins.openelement).toEqual(bins.oe);
  // The shared target is the dispatcher this suite exercises, and it is a
  // real shebang-carrying file npm can materialize as a `.bin` shim.
  expect(binTarget('openelement')).toEqual(cliBin);
  expect(readFileSync(cliBin, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
});

test('router bins: usage and unknown commands fail closed without a subcommand load', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-bin-'));
  try {
    // Both bin spellings, each through its manifest-declared target.
    for (const binName of Object.keys(declaredBins())) {
      const bare = await run(binTarget(binName), [], dir);
      expect(bare.code, `${binName} bare`).toEqual(1);
      expect(bare.output).toContain('Usage: openelement <command> [options]');
      expect(bare.output).toContain('build');
      expect(bare.output).toContain('start');

      const unknown = await run(binTarget(binName), ['frobnicate'], dir);
      expect(unknown.code, `${binName} unknown`).toEqual(1);
      expect(unknown.output).toContain('Unknown command "frobnicate".');

      const help = await run(binTarget(binName), ['--help'], dir);
      expect(help.code, `${binName} help`).toEqual(0);
      expect(help.output).toContain('Usage: openelement <command> [options]');
      // The usage text names the version command, its flags (F-2), and the
      // `oe` alias the manifest declares.
      expect(help.output).toContain('version                print the router package version');
      expect(help.output).toContain('--version, -v          print the router package version');
      expect(help.output).toContain('Alias: oe <command> [options] (same entry, same behavior)');
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('router bins: version prints the executing tree manifest, from any cwd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-bin-'));
  try {
    const manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    // Both bin spellings agree, and the answer is the module-relative
    // manifest — never the working directory's (the temp cwd has no manifest
    // at all, so a cwd-relative read would throw instead of printing).
    for (const binName of Object.keys(declaredBins())) {
      for (const args of [['version'], ['--version'], ['-v']]) {
        const result = await run(binTarget(binName), args, dir);
        expect(result.code, `${binName} ${args.join(' ')}`).toEqual(0);
        expect(result.output.trim()).toEqual(manifest.version);
      }
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('router bins: start and preview dispatch identically to the cli/start entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-bin-'));
  try {
    // Both paths must agree on the missing-dist refusal (the cheapest shared
    // outcome: no build needed, and it proves the arguments reached the same
    // parser). Run once per declared bin name.
    for (const binName of Object.keys(declaredBins())) {
      const binStart = await run(binTarget(binName), ['start'], dir);
      const entryStart = await run(startEntry, [], dir);
      expect(binStart.output, `${binName} start output`).toEqual(entryStart.output);
      expect(binStart.code, `${binName} start code`).toEqual(entryStart.code);

      // The preview mode flag passes through verbatim, and the refusal names
      // the bin's own spelling as the alternative (#1633).
      await mkdir(join(dir, 'dist', 'server'), { recursive: true });
      await writeFile(join(dir, 'dist', 'server', 'index.js'), 'export default () => {};\n');
      const binPreview = await run(binTarget(binName), ['start', '--mode=preview'], dir);
      const entryPreview = await run(startEntry, ['--mode=preview'], dir);
      expect(binPreview.output, `${binName} preview output`).toEqual(entryPreview.output);
      expect(binPreview.code, `${binName} preview code`).toEqual(1);
      expect(binPreview.output).toContain('request-time routes');
      expect(binPreview.output).toContain('pnpm start');
      expect(binPreview.output).toContain('(or: openelement start)');
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('router bins: build dispatches identically to the cli/build entry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-bin-'));
  try {
    // No app in the directory: both paths fail the same way, which pins that
    // `build` reaches buildApp through the same error rendering. Vite writes
    // its own progress lines first, so the shared contract is the rendered
    // `Build failed:` line (message plus the dispatcher's stack frame). Run
    // once per declared bin name.
    const entryBuild = await run(buildEntry, [], dir);
    expect(entryBuild.code).toEqual(1);
    expect(entryBuild.output).toContain('Build failed:');
    expect(entryBuild.output).toContain('Cannot resolve entry module index.html');
    for (const binName of Object.keys(declaredBins())) {
      const binBuild = await run(binTarget(binName), ['build'], dir);
      expect(binBuild.code, `${binName} build code`).toEqual(entryBuild.code);
      expect(binBuild.output, `${binName} build output`).toContain('Build failed:');
      expect(binBuild.output).toContain('Cannot resolve entry module index.html');
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});
