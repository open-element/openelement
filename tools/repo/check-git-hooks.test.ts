/**
 * check-git-hooks.test.ts — hook contract tripwires (#1541, task-14/16).
 *
 * Two seams live in the hooks:
 *   - pre-push carries a copy of the release task's selector, crossing git's
 *     push lifecycle → vp task dispatch. This file asserts the copy against
 *     the single sources (.githooks/pre-push's dispatch and
 *     tools/release/package.json's task table), plus the per-clone enablement
 *     (hooks:install, re-asserted by the root prepare).
 *   - pre-commit guards the commit identity, crossing git's commit lifecycle →
 *     the effective `git var GIT_AUTHOR_IDENT`/`GIT_COMMITTER_IDENT`. The
 *     RED/GREEN below runs the real hook text in a throwaway repository.
 *
 * The fail-closed FORM of every scanned vp invocation (the `--filter` shape,
 * the flag, the specifier ban) is deliberately not re-asserted here: its owner
 * is tools/repo/check-vp-selector-flags.ts, which scans `.githooks/**` with the
 * path-prefixed matcher the hooks need. A second, weaker copy of that policy
 * in this file would be the parallel mechanism the policy forbids.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { spawnCommandSync, type CommandResult } from './node-command.ts';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const hook = await readFile(join(repoRoot, '.githooks/pre-push'), 'utf8');
const preCommitHook = await readFile(join(repoRoot, '.githooks/pre-commit'), 'utf8');

test('git hooks contract: pre-push dispatches the pack-surface gate through the canonical vp selector', () => {
  expect(
    /node_modules\/\.bin\/vp run --no-cache --fail-if-no-match --filter @openelement\/tools-release pack-surface:check/.test(
      hook,
    ),
    'the pre-push hook must dispatch pack-surface:check in the fail-closed --filter form via node_modules/.bin/vp',
  ).toBeTruthy();
});

test('git hooks contract: the dispatched task exists in the release package', async () => {
  const release = JSON.parse(
    await readFile(join(repoRoot, 'tools/release/package.json'), 'utf8'),
  ) as {
    scripts: Record<string, string>;
  };
  expect(
    release.scripts['pack-surface:check'],
    'pack-surface:check must stay a tools/release task — the pre-push hook dispatches it',
  ).toBeTruthy();
});

test('git hooks contract: enablement is owned by hooks:install and re-asserted by root prepare', async () => {
  const repoConfig = JSON.parse(
    await readFile(join(repoRoot, 'tools/repo/package.json'), 'utf8'),
  ) as {
    scripts: Record<string, string>;
  };
  const install = repoConfig.scripts['hooks:install'];
  expect(
    install.includes('core.hooksPath .githooks') && install.includes('.githooks/pre-push'),
    'hooks:install must enable the .githooks directory and cover pre-push',
  ).toBeTruthy();
  const rootConfig = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  expect(
    rootConfig.scripts.prepare?.includes('hooks:install'),
    'root prepare must re-assert hook enablement on every install, through hooks:install only',
  ).toBeTruthy();
});

// ---------------------------------------------------------------------------
// The pre-commit identity guard, run for real in a throwaway repository
// ---------------------------------------------------------------------------

const EXPECTED_IDENTITY = 'Zhi <146103794+SisyphusZheng@users.noreply.github.com>';
const WRONG_IDENTITY = { name: 'ab-evidence', email: 'ab-evidence@localhost' };

/** `git commit --allow-empty` in a scratch repo carrying the real hook text. */
function commitInScratchRepo(identity: { name: string; email: string }): {
  ok: boolean;
  output: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'oe-hook-identity-'));
  try {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
    // The repository's own process helper (single owner for spawning), with
    // stdin closed exactly like the gate dispatch does.
    const git = (args: string[]): CommandResult =>
      spawnCommandSync('git', { args, cwd: root, env, stdin: 'null' });
    const decoder = new TextDecoder();
    const init = git(['init', '-q']);
    expect(init.success, decoder.decode(init.stderr)).toBeTruthy();
    // The hook's own bytes, executed by git from the scratch repo's hooks dir.
    const hooksDir = join(root, '.git', 'hooks');
    const installed = join(hooksDir, 'pre-commit');
    writeFileSync(installed, preCommitHook, 'utf8');
    chmodSync(installed, 0o755);
    // The gate lines after the identity check need a task runner; identity is
    // the subject here, so a no-op shim stands in for it. A missing shim would
    // fail the hook for an unrelated reason and make the GREEN case a lie.
    const binDir = join(root, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const shim = join(binDir, 'vp');
    writeFileSync(shim, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(shim, 0o755);

    const commit = git([
      '-c',
      `user.name=${identity.name}`,
      '-c',
      `user.email=${identity.email}`,
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'hook identity probe',
    ]);
    return {
      ok: commit.success,
      output: `${decoder.decode(commit.stdout)}${decoder.decode(commit.stderr)}`,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('git hooks contract: pre-commit refuses a commit whose identity is not the expected one', () => {
  expect(
    preCommitHook.includes(`expected_identity='${EXPECTED_IDENTITY}'`),
    'the hook must carry the expected identity this test exercises',
  ).toBeTruthy();

  const red = commitInScratchRepo(WRONG_IDENTITY);
  expect(red.ok, red.output).toBe(false);
  expect(red.output).toContain('refusing this commit');
  expect(red.output).toContain('ab-evidence <ab-evidence@localhost>');
  expect(red.output).toContain(EXPECTED_IDENTITY);
  expect(red.output).toContain('git config user.email');

  const green = commitInScratchRepo({
    name: 'Zhi',
    email: '146103794+SisyphusZheng@users.noreply.github.com',
  });
  expect(green.ok, green.output).toBe(true);
});
