/**
 * check-git-hooks.test.ts — push-time gate contract tripwire (#1541).
 *
 * The pre-push hook is the local catch for shipped-artifact violations; CI's
 * gate:packed stays the authoritative verdict. The hook crosses a seam (git's
 * push lifecycle → vp task dispatch): it carries a copy of the release task's
 * selector, so this guard asserts the copy against the single sources —
 * .githooks/pre-push's dispatch and tools/release/package.json's task table.
 */

import { expect, test } from 'vitest';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');
const hook = await readFile(join(repoRoot, '.githooks/pre-push'), 'utf8');

test('git hooks contract: pre-push dispatches the pack-surface gate through the canonical vp selector', () => {
  expect(
    /node_modules\/\.bin\/vp run --fail-if-no-match @openelement\/tools-release#pack-surface:check/.test(
      hook,
    ),
    'the pre-push hook must dispatch @openelement/tools-release#pack-surface:check via node_modules/.bin/vp',
  ).toBeTruthy();
  expect(
    !/vp run (?!--fail-if-no-match)[^\n]*@openelement\//.test(hook),
    'package-qualified vp calls in the hook must carry --fail-if-no-match (the path form silently no-ops)',
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
