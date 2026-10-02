/**
 * Fail-closed configuration smoke for the element browser suite (B3 port).
 *
 * The OpenElement exit contract: a browser run that executes ZERO tests — or
 * any single failing test, broken transform, or dead browser channel — is a
 * FAILURE, never a silent pass. Under web-test-runner this was proven through
 * the negative/*.config.js fixtures and the zero-tests-guard reporter. Under
 * vitest the same contract is proven against the live runner:
 *
 *   1. failing-assertion   a scratch suite whose test fails   → exit ≠ 0
 *   2. broken-transform    a scratch suite with invalid code  → exit ≠ 0
 *   3. zero-tests          an include matching no files       → exit ≠ 0
 *                             (vitest passWithNoTests defaults to false)
 *
 * (Written as a script because package scripts have no for-loops.)
 *
 * Run from the repo root: pnpm --dir packages/element run browser:negative
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { commandOutput } from '../../../../tools/repo/node-command.ts';
import process from 'node:process';

// tools/ → __wtr__ → element → packages → repo root
const REPO_ROOT = resolve(join(new URL('..', import.meta.url).pathname, '..', '..', '..'));
const VITEST = join(REPO_ROOT, 'node_modules', '.bin', 'vitest');

const CASES: Array<{ name: string; setup: (dir: string) => string[] /* vitest args */ }> = [
  {
    name: 'failing-assertion',
    setup: (dir) => {
      const testFile = join(dir, 'failing.test.js');
      writeFileSync(
        testFile,
        "import { expect, test } from 'vitest';\ntest('must fail', () => { expect(1).toBe(2); });\n",
      );
      return ['run', testFile];
    },
  },
  {
    name: 'broken-transform',
    setup: (dir) => {
      const testFile = join(dir, 'broken.test.ts');
      writeFileSync(testFile, 'const @@ not typescript @@\n');
      return ['run', testFile];
    },
  },
  {
    name: 'zero-tests',
    setup: (dir) => {
      // an include glob that matches nothing in the empty scratch dir
      return ['run', '--dir', dir, join(dir, 'does-not-exist**')];
    },
  },
];

let failed = 0;
const dir = mkdtempSync(join(tmpdir(), 'oe-browser-negative-'));
try {
  for (const { name, setup } of CASES) {
    const args = setup(dir);
    const status = await commandOutput(VITEST, {
      args,
      cwd: REPO_ROOT,
      stdout: 'piped',
      stderr: 'piped',
    });
    if (status.code === 0) {
      failed += 1;
      console.error(`FAIL-CLOSED SMOKE BROKEN: ${name} exited 0 (expected non-zero)`);
    } else {
      console.log(`fail-closed smoke ok (exit ${status.code}): ${name}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (failed > 0) {
  console.error(`${failed} fail-closed smoke(s) broken`);
  process.exit(1);
}
console.log(`all ${CASES.length} fail-closed smoke(s) held`);
