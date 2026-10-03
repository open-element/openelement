/**
 * Task-wiring tripwire for release scripts.
 *
 * Deno 2.9 rejects a repeated `--allow-run=<name>` flag ("cannot be used
 * multiple times"), so a script that spells two programs as separate
 * `--allow-run=x --allow-run=y` flags starts nothing and silently fails the
 * whole `release:check` chain. These tests read the real script definitions
 * (the package.json task surface since the B2 manifest conversion), not
 * internal functions, and fail if a duplicated flag or a bypassed script is
 * reintroduced.
 */
import { expect, test } from 'vitest';
import { dirname, join } from '@std/path';
import { REQUIRED_PACKED_CONSUMERS } from './candidate-evidence.ts';
import { readFile } from 'node:fs/promises';
import { commandOutput } from './node-command.ts';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

interface TaskFileShape {
  scripts?: Record<string, string>;
}

async function tasks(path: string): Promise<Record<string, string>> {
  return (JSON.parse(await readFile(join(repoRoot, path), 'utf8')) as TaskFileShape).scripts ?? {};
}

const TASK_FILES = [
  'package.json',
  'tools/repo/package.json',
  'tools/release/package.json',
  'packages/element/package.json',
  'packages/router/package.json',
  'packages/ui/package.json',
  'packages/create/package.json',
  'www/package.json',
];

test('task wiring: no single deno invocation repeats a --allow-run flag', async () => {
  for (const path of TASK_FILES) {
    for (const [name, command] of Object.entries(await tasks(path))) {
      // Scripts chain `deno run <outer flags> run-in.ts -- deno run <inner
      // flags>` (sometimes with `&&`); a repeated flag is only fatal within
      // one invocation, so count per deno invocation.
      for (const subCommand of command.split('&&')) {
        for (const part of subCommand.split(/\s--\s/)) {
          const repeats = [...part.matchAll(/--allow-run(?:\s|=|$)/g)].length;
          expect(
            repeats <= 1,
            `${path}#${name}: --allow-run appears ${repeats} times in one invocation; ` +
              `Deno 2.9 rejects repeated flags (combine programs as --allow-run=a,b)`,
          ).toBeTruthy();
        }
      }
    }
  }
});

test('task wiring: release:registry-check runs the state machine from the repo root', async () => {
  const command = (await tasks('tools/repo/package.json'))['release:registry-check'];
  expect(command, 'release:registry-check must exist').toBeTruthy();
  // The former deno-permission assertion (--allow-run=git,npm combined into
  // one flag) retired with the permission model in B2; the invariant that
  // remains is the root-cwd run-in wrapper around the state-machine checker.
  expect(
    command.includes('--root ../..') &&
      command.includes('node tools/repo/check-release-state-machine.ts'),
    'release:registry-check must run check-release-state-machine.ts from the repo root',
  ).toBeTruthy();
  const result = await commandOutput('pnpm', {
    args: ['--dir', 'tools/repo', 'run', 'release:registry-check'],
    cwd: repoRoot,
    stdout: 'piped',
    stderr: 'piped',
  });
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  expect(result.success, `release:registry-check failed:\n${output}`).toEqual(true);
  expect(output.includes('Release state check passed'), output).toBeTruthy();
});

test('task wiring: release:check invokes the registry task, not an internal script', async () => {
  const command = (await tasks('package.json'))['release:check'];
  expect(command, 'release:check must exist').toBeTruthy();
  expect(
    command.includes('tools/repo#release:registry-check'),
    'release:check must call the release:registry-check task',
  ).toBeTruthy();
  expect(
    !command.includes('check-release-state-machine.ts'),
    'release:check must not bypass the task by calling the internal script',
  ).toBeTruthy();
  expect(
    command.includes('tools/release#gate:packed') &&
      command.includes('tools/release#publish:npm:dry-run'),
    'release:check must still run the packed gate and publish dry-run',
  ).toBeTruthy();
});

test('task wiring: release:check generates site data before the registry check', async () => {
  const releaseCheck = (await tasks('package.json'))['release:check'];
  expect(releaseCheck, 'release:check must exist').toBeTruthy();
  const generate = releaseCheck.indexOf('tools/repo#generate:all');
  const registry = releaseCheck.indexOf('tools/repo#release:registry-check');
  expect(generate !== -1, 'release:check must run the generators (generate:all)').toBeTruthy();
  expect(
    registry !== -1,
    'release:check must run the registry check (tools/repo#release:registry-check)',
  ).toBeTruthy();
  // The registry check reads the ignored derived module
  // www/app/data/_generated-release-line.ts, and the release workflow runs
  // from a clean checkout where that module does not exist until the
  // generators have run — so generate:all must come first or the protected
  // release run fails before publication.
  expect(
    generate < registry,
    'release:check must generate site data before release:registry-check ' +
      '(it reads _generated-release-line.ts, absent on a clean checkout)',
  ).toBeTruthy();
});

test('task wiring: gate:source generates site data before typecheck', async () => {
  const gateSource = (await tasks('tools/repo/package.json'))['gate:source'];
  expect(gateSource, 'gate:source must exist').toBeTruthy();
  // generate:all enumerates every generate:* task (including the API
  // reference and site content data the typecheck imports); pinning the
  // individual task names here would re-introduce the hand-maintained
  // coupling generate:all exists to delete.
  const generate = gateSource.indexOf('tools/repo#generate:all');
  const typecheck = gateSource.indexOf('tools/repo#typecheck');
  expect(generate !== -1, 'gate:source must run the generators (generate:all)').toBeTruthy();
  expect(typecheck !== -1, 'gate:source must typecheck').toBeTruthy();
  expect(
    generate < typecheck,
    'gate:source must generate site data before the typecheck that imports it ' +
      '(check-content-examples.ts imports _generated-api-reference.ts)',
  ).toBeTruthy();
});

test('task wiring: gate:release generates site data before its own consumers', async () => {
  const gateRelease = (await tasks('tools/repo/package.json'))['gate:release'];
  expect(gateRelease, 'gate:release must exist').toBeTruthy();
  const generate = gateRelease.indexOf('tools/repo#generate:all');
  expect(generate !== -1, 'gate:release must run the generators (generate:all)').toBeTruthy();
  // Each generator --check in the release train reads the output of
  // generate:all, so the generators must come first there too.
  for (const consumer of ['www#check:api-reference', 'www#check:content-data', 'site:build']) {
    const index = gateRelease.indexOf(consumer);
    expect(index !== -1, `gate:release must run ${consumer}`).toBeTruthy();
    expect(
      generate < index,
      `gate:release must generate before ${consumer} (its --check reads generated output)`,
    ).toBeTruthy();
  }
});

test('task wiring: gate:packed covers every required packed consumer', async () => {
  const gatePacked = (await tasks('tools/release/package.json'))['gate:packed'];
  expect(gatePacked, 'gate:packed must exist').toBeTruthy();
  for (const consumer of REQUIRED_PACKED_CONSUMERS) {
    expect(
      gatePacked.includes(consumer),
      `gate:packed must run the required packed consumer ${consumer}; ` +
        `update the gate or the canonical REQUIRED_PACKED_CONSUMERS list`,
    ).toBeTruthy();
  }
});

test('task wiring: the release workflow qualifies through the official task', async () => {
  const workflow = await readFile(join(repoRoot, '.github/workflows/autoflow-release.yml'), 'utf8');
  expect(
    /run:\s*vp run release:check\b/.test(workflow),
    'the release workflow must call `vp run release:check` (the S3 unified task entry)',
  ).toBeTruthy();
});
