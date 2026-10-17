/**
 * check-vp-selector-flags.test.ts — the negative test for the fail-closed
 * `vp run` selector check.
 *
 * The check exists because `vp run <pkg>#<task>` exits 0 without running
 * anything when the package name does not resolve, so a misplaced selector is
 * a silent green gate. A check that only ever reports "0 violations on today's
 * tree" proves nothing about that; this file pins the failure direction:
 *
 *   - the analyzer unit matrix: every rule fires on its own red input, and the
 *     green inputs (a flagged `--filter` selection, a bare root task, a
 *     path-prefixed executable) stay green;
 *   - the end-to-end rule: a workspace fixture with one deliberately
 *     de-flagged or specifier-formed invocation makes `scanRepository` report
 *     exactly that violation — the mutations a developer would actually
 *     reintroduce;
 *   - the live tree: the repository as committed is green.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  ALLOW_MARKER,
  scanFileText,
  scanRepository,
  splitInvocations,
  vpRunArgv,
  type ScanReport,
  type SelectorFacts,
} from './check-vp-selector-flags.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const facts: SelectorFacts = {
  packages: new Map([
    ['@openelement/tools-repo', new Set(['typecheck', 'build'])],
    ['@openelement/www', new Set(['build'])],
    ['openelement', new Set(['fmt', 'check'])],
  ]),
};

function report(): ScanReport {
  return {
    violations: [],
    protectedCount: 0,
    exemptions: [],
    qualifiedCount: 0,
    filesScanned: 0,
  };
}

function scan(text: string): ScanReport {
  const out = report();
  scanFileText('fixture.ts', text, facts, out);
  return out;
}

const kinds = (out: ScanReport): string[] => out.violations.map((v) => v.kind);

test('vp selector flags: the pkg#task specifier form is a violation, flag or not', () => {
  // `--fail-if-no-match` is a property of `--filter`; on the specifier form it
  // is inert (measured on vp 1.0.0), so a "flagged" specifier protects nothing
  // and must not read as protected.
  for (const text of [
    'vp run @openelement/tools-repo#typecheck',
    'vp run --no-cache @openelement/tools-repo#typecheck',
    '  vp run   --fail-if-no-match   @openelement/tools-repo#typecheck  ',
  ]) {
    expect(kinds(scan(text)), text).toEqual(['specifier-form']);
  }
});

test('vp selector flags: a filter selection without the flag is a violation', () => {
  expect(kinds(scan('vp run --filter @openelement/tools-repo typecheck'))).toEqual(['no-flag']);
  expect(kinds(scan('vp run -F @openelement/tools-repo build'))).toEqual(['no-flag']);
  expect(kinds(scan('vp run --filter=@openelement/tools-repo build'))).toEqual(['no-flag']);
});

test('vp selector flags: the specifier defect is reported for every resolution outcome', () => {
  const resolving = scan('vp run --fail-if-no-match @openelement/www#build');
  expect(kinds(resolving)).toEqual(['specifier-form']);
  expect(resolving.violations[0]!.detail).toContain('resolves today');

  const absent = scan('vp run --fail-if-no-match @openelement/absent#build');
  expect(kinds(absent)).toEqual(['specifier-form']);
  expect(absent.violations[0]!.detail).toContain('names no workspace package');

  const missingTask = scan('vp run --fail-if-no-match @openelement/www#absent');
  expect(kinds(missingTask)).toEqual(['specifier-form']);
  expect(missingTask.violations[0]!.detail).toContain("declares no task 'absent'");

  const pathForm = scan('vp run --fail-if-no-match tools/repo#typecheck');
  expect(kinds(pathForm)).toEqual(['specifier-form']);
  expect(pathForm.violations[0]!.detail).toContain('path selector');
});

test('vp selector flags: the effective form, bare root tasks and comments stay green', () => {
  for (const text of [
    'vp run --fail-if-no-match --filter @openelement/tools-repo typecheck',
    'vp run --no-cache --fail-if-no-match --filter @openelement/www build',
    'vp run --fail-if-no-match -F @openelement/www build',
    'vp run --fail-if-no-match --filter=@openelement/www build',
    'vp run --fail-if-no-match -w check',
    'vp run fmt',
    'vp run check',
    'vp run --no-cache --fail-if-no-match --filter @openelement/www build # trailing prose',
  ]) {
    const out = scan(text);
    expect(kinds(out), text).toEqual([]);
    const qualified = text.includes('--filter') || text.includes('-F');
    expect(out.qualifiedCount, text).toEqual(qualified ? 1 : 0);
  }
});

test('vp selector flags: a path-prefixed executable is the same invocation', () => {
  // The git hooks must spell the binary with its path (a git hook inherits no
  // node_modules/.bin PATH); the matcher used to look for the literal token
  // `vp` and scanned none of them.
  for (const text of [
    'node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo typecheck',
    './node_modules/.bin/vp run --no-cache --fail-if-no-match --filter openelement lint',
    '/opt/repo/node_modules/.bin/vp run --no-cache --fail-if-no-match --filter openelement lint',
  ]) {
    const out = scan(text);
    expect(kinds(out), text).toEqual([]);
    expect(out.qualifiedCount, text).toEqual(1);
    expect(out.protectedCount, text).toEqual(1);
  }
  const red = scan('node_modules/.bin/vp run --fail-if-no-match @openelement/tools-repo#typecheck');
  expect(kinds(red)).toEqual(['specifier-form']);
  expect(red.qualifiedCount).toEqual(1);
  expect(red.protectedCount).toEqual(0);
});

test('vp selector flags: the exemption marker needs a written reason', () => {
  // The reviewed exception is the only way to keep a selector that must stay
  // silent on a no-match — and the specifier form is how such an invocation is
  // written (it cannot be made to fail closed by a flag).
  const written = scan(
    `vp run --fail-if-no-match @openelement/www#absent # ${ALLOW_MARKER} the probe package is optional`,
  );
  expect(kinds(written)).toEqual([]);
  expect(written.exemptions.length).toEqual(1);
  expect(written.exemptions[0]!.reason).toEqual('the probe package is optional');
  const empty = scan(`vp run --fail-if-no-match @openelement/www#absent # ${ALLOW_MARKER}`);
  expect(kinds(empty)).toEqual(['specifier-form']);
  expect(empty.exemptions).toEqual([]);
});

test('vp selector flags: one line can carry two invocations and only one is protected', () => {
  const out = scan(
    'vp run --no-cache --fail-if-no-match --filter @openelement/www build && vp run --filter @openelement/www build',
  );
  expect(out.qualifiedCount).toEqual(2);
  expect(out.protectedCount).toEqual(1);
  expect(kinds(out)).toEqual(['no-flag']);
});

test('vp selector flags: the tokenizer keeps specifier hashes and drops comments', () => {
  expect(splitInvocations('vp run --fail-if-no-match @openelement/www#build')).toEqual([
    ['vp', 'run', '--fail-if-no-match', '@openelement/www#build'],
  ]);
  expect(vpRunArgv(splitInvocations('echo hi; vp run fmt')[0]!)).toBeNull();
  expect(vpRunArgv(splitInvocations('echo hi; vp run fmt')[1]!)).toEqual(['fmt']);
  // A path-prefixed executable is the same CLI; `vp exec` is not `vp run`.
  expect(
    vpRunArgv(splitInvocations('node_modules/.bin/vp run --filter @openelement/www build')[0]!),
  ).toEqual(['--filter', '@openelement/www', 'build']);
  expect(vpRunArgv(splitInvocations('node_modules/.bin/vp exec vitest run')[0]!)).toBeNull();
  expect(vpRunArgv(splitInvocations('node_modules/.bin/vp.cmd run fmt')[0]!)).toEqual(['fmt']);
  expect(vpRunArgv(splitInvocations('./does-not-exist/vp-tool run fmt')[0]!)).toBeNull();
});

// ---------------------------------------------------------------------------
// End-to-end: a real fixture tree, and the live repository
// ---------------------------------------------------------------------------

interface Fixture {
  root: string;
  workflow: string;
}

function writeFixture(workflowRun: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'oe-vp-selector-'));
  mkdirSync(join(root, 'tools'), { recursive: true });
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - .\n  - tools\n');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'openelement', private: true, scripts: { fmt: 'oxfmt' } }, null, 2),
  );
  writeFileSync(
    join(root, 'tools/package.json'),
    JSON.stringify(
      {
        name: '@openelement/tools-repo',
        private: true,
        scripts: { typecheck: 'tsc --noEmit', build: 'tsc' },
      },
      null,
      2,
    ),
  );
  const workflow = join(root, '.github/workflows/ci.yml');
  writeFileSync(
    workflow,
    [
      'name: fixture',
      'on: push',
      'jobs:',
      '  lint:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: |',
      `          ${workflowRun}`,
      '',
    ].join('\n'),
  );
  return { root, workflow };
}

test('vp selector flags: the fixture tree is green, then each mutant goes red', async () => {
  const green = writeFixture(
    'node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo typecheck',
  );
  try {
    const clean = await scanRepository(green.root);
    expect(clean.violations).toEqual([]);
    expect(clean.qualifiedCount).toEqual(1);
    expect(clean.protectedCount).toEqual(1);
  } finally {
    rmSync(green.root, { recursive: true, force: true });
  }

  // Mutant 1: drop the flag from a real step.
  const red = writeFixture('vp run --filter @openelement/tools-repo typecheck');
  try {
    const found = await scanRepository(red.root);
    expect(found.violations.map((v) => `${v.kind}@${v.file}:${v.line}`)).toEqual([
      'no-flag@.github/workflows/ci.yml:8',
    ]);
    expect(found.violations[0]!.invocation).toEqual(
      'vp run --filter @openelement/tools-repo typecheck',
    );
    expect(found.protectedCount).toEqual(0);
  } finally {
    rmSync(red.root, { recursive: true, force: true });
  }

  // Mutant 2: the form this lane exists for — a path-prefixed specifier whose
  // inert flag the old matcher never even looked at (it searched for the
  // literal token `vp`).
  const inert = writeFixture(
    'node_modules/.bin/vp run --fail-if-no-match @openelement/tools-repo#typecheck',
  );
  try {
    const found = await scanRepository(inert.root);
    expect(found.violations.map((v) => `${v.kind}@${v.file}:${v.line}`)).toEqual([
      'specifier-form@.github/workflows/ci.yml:8',
    ]);
    expect(found.qualifiedCount).toEqual(1);
    expect(found.protectedCount).toEqual(0);
  } finally {
    rmSync(inert.root, { recursive: true, force: true });
  }

  // Mutant 3: the same defect hidden in the root manifest, which is not a
  // workspace member of the live repository and used to be skipped entirely.
  const rootManifest = writeFixture(
    'vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo typecheck',
  );
  try {
    writeFileSync(
      join(rootManifest.root, 'package.json'),
      JSON.stringify({
        name: 'openelement',
        private: true,
        scripts: {
          fmt: 'oxfmt',
          prepare: 'vp run --fail-if-no-match @openelement/tools-repo#hooks:install',
        },
      }),
    );
    // Detach the root from the workspace list so the root-manifest scan is the
    // only reader, exactly like the live repository.
    writeFileSync(join(rootManifest.root, 'pnpm-workspace.yaml'), 'packages:\n  - tools\n');
    const found = await scanRepository(rootManifest.root);
    expect(found.violations.map((v) => `${v.kind}@${v.file}:${v.line}`)).toEqual([
      'specifier-form@package.json:1',
    ]);
  } finally {
    rmSync(rootManifest.root, { recursive: true, force: true });
  }
});

test('vp selector flags: the live repository is green', async () => {
  const live = await scanRepository(repoRoot);
  expect(live.violations).toEqual([]);
  // Guards against a vacuous pass: a scan that reads nothing must never look
  // like a scan that found nothing wrong.
  expect(live.qualifiedCount).toBeGreaterThan(0);
  expect(live.filesScanned).toBeGreaterThan(0);
});
