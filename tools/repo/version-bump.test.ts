/**
 * tools/repo/version-bump.test.ts — five-point bump contract (#1415).
 *
 * The dry run is the acceptance surface: it must report exactly the four
 * package manifests plus the CREATE_VERSION anchor. `--write` is exercised
 * against a copy of the tree pieces it owns (never the live repo).
 */

import { expect, test } from 'vitest';
import { join } from '@std/path';
import { prereleaseParts } from '../lib/version.ts';
import {
  historicalReleaseNameFindings,
  inconsistencyFailures,
  PACKAGE_CONFIGS,
  planVersionBump,
  readConfigVersion,
  rewriteConfigVersion,
  rewriteCreateVersion,
  SHIPPED_SCAN_ALLOWLIST,
  shippedScanAllowlisted,
  validateVersion,
  VERSION_SOURCE,
} from './version-bump.ts';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const repoRoot = join(import.meta.dirname!, '..', '..');

test('version-bump: the five points are the four manifests and the anchor', () => {
  expect(PACKAGE_CONFIGS).toEqual([
    'packages/element/package.json',
    'packages/router/package.json',
    'packages/create/package.json',
    'packages/ui/package.json',
  ]);
  expect(VERSION_SOURCE).toEqual('packages/create/src/version.ts');
});

test('version-bump: version input is validated', () => {
  expect(validateVersion('1.0.0-alpha.4')).toEqual(null);
  expect(validateVersion('1.0.0')).toEqual(null);
  for (const bad of ['alpha', 'v1.0.0-alpha.4', '^1.0.0', '', '1.0']) {
    expect(validateVersion(bad), `"${bad}" must be rejected`).toBeTruthy();
  }
});

test('version-bump: rewriters move only the version token', () => {
  const config = `{\n  "name": "@openelement/element",\n  "version": "1.0.0-alpha.2",\n  "description": "1.0.0-alpha.2 stays"\n}`;
  expect(rewriteConfigVersion(config, '1.0.0-alpha.2', '1.0.0-alpha.3')).toEqual(
    `{\n  "name": "@openelement/element",\n  "version": "1.0.0-alpha.3",\n  "description": "1.0.0-alpha.2 stays"\n}`,
  );
  const anchor =
    "/** The published CLI version. */\nexport const CREATE_VERSION = '1.0.0-alpha.2';\n\nexport const VITE_STARTER_PIN = '8.0.16';\n";
  const rewritten = rewriteCreateVersion(anchor, '1.0.0-alpha.2', '1.0.0-alpha.3');
  expect(rewritten.includes("CREATE_VERSION = '1.0.0-alpha.3'"), rewritten).toBeTruthy();
  expect(rewritten.includes("VITE_STARTER_PIN = '8.0.16'"), rewritten).toBeTruthy();
});

test('version-bump: dry run reports every point against the live tree', async () => {
  // The dry-run target is derived from the live tree, not hardcoded: this test
  // once pinned `1.0.0-alpha.4` as the "next" version, which is exactly the
  // version the tree reaches after the alpha.4 bump — at which point the dry run
  // correctly reports "nothing to do" and the assertions below fail on a
  // legitimate tree. Advancing the trailing prerelease identifier keeps the
  // test about the knob's reporting contract instead of about which train is
  // being cut.
  const current = readConfigVersion(await readFile(join(repoRoot, PACKAGE_CONFIGS[0]), 'utf8'));
  const parts = prereleaseParts(current ?? '');
  expect(
    parts,
    `the live tree must declare a prerelease line version, got ${current}`,
  ).toBeTruthy();
  const target = `${parts.base}-${parts.name}.${parts.num + 1}`;
  const plan = await planVersionBump(repoRoot, target);
  expect(plan.currentVersion).toEqual(
    readConfigVersion(await readFile(join(repoRoot, PACKAGE_CONFIGS[0]), 'utf8')),
  );
  expect(plan.currentVersion !== target).toBeTruthy();
  // Points 1-5: all four configs plus the anchor carry the bumped token.
  expect(plan.edits.map((edit) => edit.path)).toEqual([...PACKAGE_CONFIGS, VERSION_SOURCE]);
  expect(plan.edits.filter((edit) => edit.point === 'package-config').length).toEqual(4);
  expect(plan.edits.filter((edit) => edit.point === 'create-anchor').length).toEqual(1);
});

test('version-bump: consistency check reports the points that lag', async () => {
  // The live tree is consistent with its own version.
  const current = readConfigVersion(await readFile(join(repoRoot, PACKAGE_CONFIGS[0]), 'utf8'))!;
  expect(await inconsistencyFailures(repoRoot, current)).toEqual([]);
  // A different expected version reports every point (the www anchor audit is
  // expected-version-independent, so it adds nothing here on a healthy tree).
  const failures = await inconsistencyFailures(repoRoot, '9.9.9');
  expect(failures.length).toEqual(5);
  expect(
    failures.some((line) => line.startsWith(VERSION_SOURCE)),
    failures.join('\n'),
  ).toBeTruthy();
});

test('version-bump: the allowlist matcher scopes the shipped-source scan', () => {
  const cases: readonly [string, string, boolean][] = [
    ['docs/', 'docs/release/notes.md', true],
    ['docs/', 'packages/element/src/docs.md', false],
    ['CHANGELOG.md', 'CHANGELOG.md', true],
    ['www/content/', 'www/content/docs/x.md', true],
    ['**/__fixtures__/**', 'packages/element/src/__fixtures__/old.ts', true],
    ['**/__fixtures__/**', 'packages/element/src/internal/old.ts', false],
    ['pnpm-lock.yaml', 'pnpm-lock.yaml', true],
    ['pnpm-lock.yaml', 'tests/fixtures/x/pnpm-lock.yaml', false],
  ];
  for (const [pattern, path, expected] of cases) {
    expect(shippedScanAllowlisted(pattern, path), `${pattern} vs ${path}`).toEqual(expected);
  }
  // The ask's allowlist is registered verbatim.
  expect(SHIPPED_SCAN_ALLOWLIST).toEqual([
    'docs/',
    'CHANGELOG.md',
    'www/content/',
    '**/__fixtures__/**',
    'pnpm-lock.yaml',
  ]);
});

test('version-bump: the live shipped source carries no historical release names', async () => {
  expect(await historicalReleaseNameFindings(repoRoot)).toEqual([]);
});

test('version-bump: the scan finds a leaked release name and honors the allowlist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opx-test-'));
  try {
    const src = join(root, 'packages/element/src');
    await mkdir(join(src, '__fixtures__'), { recursive: true });
    await writeFile(
      join(src, 'banner.ts'),
      '// <auto-generated by open:compiled-element; v0.44.0-alpha.1 - do not edit>\n',
    );
    await writeFile(
      join(src, '__fixtures__/history.ts'),
      '// v0.42.0-alpha.5 hardened the form enhancement.\n',
    );
    await mkdir(join(root, 'packages/router/src'), { recursive: true });
    await writeFile(
      join(root, 'packages/router/src/clean.ts'),
      '// part-program format 1 / module ABI 1\n',
    );

    const findings = await historicalReleaseNameFindings(root);
    expect(findings).toEqual([
      {
        path: 'packages/element/src/banner.ts',
        line: 1,
        text: '// <auto-generated by open:compiled-element; v0.44.0-alpha.1 - do not edit>',
      },
    ]);
  } finally {
    await rm(root, { recursive: true });
  }
});
