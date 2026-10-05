/**
 * tools/repo/version-bump.test.ts — ten-point stamp contract (#1415, #1508).
 *
 * The dry run is the acceptance surface: it must report exactly the four
 * package manifests, the CREATE_VERSION anchor, the release-state bookkeeping
 * pair, the admitted-train constant and its twin fixture, and the two README
 * source-tree lines — plus the generated-output preview. `--write` is
 * exercised against copies of the tree pieces the knob owns (never the live
 * repo).
 */

import { expect, test } from 'vitest';
import { join } from 'node:path';
import { prereleaseParts } from '../lib/version.ts';
import {
  ADMITTED_TARGET_SOURCE,
  ADMITTED_TWIN_FIXTURE,
  GENERATED_MANIFEST,
  historicalReleaseNameFindings,
  inconsistencyFailures,
  PACKAGE_CONFIGS,
  planVersionBump,
  readConfigVersion,
  readGeneratedManifestVersion,
  RELEASE_STATE,
  README_SOURCE_LINES,
  rewriteAdmittedTarget,
  rewriteConfigVersion,
  rewriteCreateVersion,
  rewriteReadmeSourceLine,
  rewriteReleaseState,
  rewriteTwinFixture,
  SHIPPED_SCAN_ALLOWLIST,
  shippedScanAllowlisted,
  validateVersion,
  VERSION_SOURCE,
} from './version-bump.ts';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const repoRoot = join(import.meta.dirname!, '..', '..');

test('version-bump: the ten points are the named stamp sites', () => {
  expect(PACKAGE_CONFIGS).toEqual([
    'packages/element/package.json',
    'packages/router/package.json',
    'packages/create/package.json',
    'packages/ui/package.json',
  ]);
  expect(VERSION_SOURCE).toEqual('packages/create/src/version.ts');
  expect(RELEASE_STATE).toEqual('docs/release/release-state.json');
  expect(ADMITTED_TARGET_SOURCE).toEqual('tools/repo/check-release-state-machine.ts');
  expect(ADMITTED_TWIN_FIXTURE).toEqual('tools/repo/check-release-state-machine.test.ts');
  expect(GENERATED_MANIFEST).toEqual('packages/ui/src/generated-manifest.json');
  expect(README_SOURCE_LINES).toEqual([
    { path: 'README.md', anchor: 'The source tree is `' },
    { path: 'README.zh.md', anchor: '全新公开基线 `' },
  ]);
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

test('version-bump: the release-state rewriter moves bookkeeping, never registry truth', () => {
  const state = `{
  "sourceVersion": "1.0.0-alpha.2",
  "activeTarget": "v1.0.0-alpha.2",
  "registry": { "latest": "0.43.3", "alpha": "1.0.0-alpha.2" },
  "latestPrerelease": { "version": "1.0.0-alpha.2", "state": "complete" }
}`;
  const rewritten = rewriteReleaseState(state, '1.0.0-alpha.2', '1.0.0-alpha.3');
  expect(rewritten).toContain('"sourceVersion": "1.0.0-alpha.3"');
  expect(rewritten).toContain('"activeTarget": "v1.0.0-alpha.3"');
  // The registry-facing fields stay at the published version by design.
  expect(rewritten).toContain('"alpha": "1.0.0-alpha.2"');
  expect(rewritten).toContain('"version": "1.0.0-alpha.2"');
});

test('version-bump: the admitted-target rewriter anchors the constant only', () => {
  const source = `const ADMITTED_ACTIVE_TARGET = 'v1.0.0-alpha.2';\nconst OTHER = 'v1.0.0-alpha.2';\n`;
  const rewritten = rewriteAdmittedTarget(source, '1.0.0-alpha.2', '1.0.0-alpha.3');
  expect(rewritten).toContain("ADMITTED_ACTIVE_TARGET = 'v1.0.0-alpha.3'");
  expect(rewritten).toContain("const OTHER = 'v1.0.0-alpha.2'");
});

test('version-bump: the twin fixture rewriter moves quoted source tokens only', () => {
  const fixture = `const PINNED_STATE = {
  sourceVersion: '1.0.0-alpha.2',
  activeTarget: 'v1.0.0-alpha.2',
};
const VERSIONS = new Map([
  ['@openelement/element', '1.0.0-alpha.2'],
  ['@openelement/router', '1.0.0-alpha.2'],
]);
const REGISTRY_HISTORY = ['0.41.0-alpha.2'];
const BETA = '0.44.0-beta.2.2';`;
  const rewritten = rewriteTwinFixture(fixture, '1.0.0-alpha.2', '1.0.0-alpha.3');
  expect(rewritten).toContain("sourceVersion: '1.0.0-alpha.3'");
  expect(rewritten).toContain("activeTarget: 'v1.0.0-alpha.3'");
  expect(rewritten.match(/1\.0\.0-alpha\.3/gu)?.length).toEqual(4);
  // Quote anchoring: a router registry history entry sharing the tail token
  // must survive, and the beta line never matched in the first place.
  expect(rewritten).toContain("['0.41.0-alpha.2']");
  expect(rewritten).toContain("const BETA = '0.44.0-beta.2.2'");
});

test('version-bump: the README rewriter anchors the source-tree sentence', () => {
  const en = 'The source tree is `1.0.0-alpha.2`, a baseline. Later: `1.0.0-alpha.2` again.';
  const enRewritten = rewriteReadmeSourceLine(
    en,
    '1.0.0-alpha.2',
    '1.0.0-alpha.3',
    'The source tree is `',
    'README.md',
  );
  expect(enRewritten).toContain('The source tree is `1.0.0-alpha.3`,');
  expect(enRewritten.match(/1\.0\.0-alpha\.3/gu)?.length).toEqual(1);
  const zh = '源码目前是全新公开基线 `1.0.0-alpha.2`。其余提及 `1.0.0-alpha.2` 不动。';
  const zhRewritten = rewriteReadmeSourceLine(
    zh,
    '1.0.0-alpha.2',
    '1.0.0-alpha.3',
    '全新公开基线 `',
    'README.zh.md',
  );
  expect(zhRewritten).toContain('全新公开基线 `1.0.0-alpha.3`。');
  expect(zhRewritten.match(/1\.0\.0-alpha\.3/gu)?.length).toEqual(1);
});

test('version-bump: generated manifest versions are read defensively', () => {
  expect(readGeneratedManifestVersion('{"version": "1.0.0-alpha.2"}')).toEqual('1.0.0-alpha.2');
  expect(readGeneratedManifestVersion('{"schemaVersion": "1.0.0"}')).toEqual(null);
  expect(readGeneratedManifestVersion('not json')).toEqual(null);
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
  if (!parts) {
    throw new Error(`the live tree must declare a prerelease line version, got ${current}`);
  }
  const target = `${parts.base}-${parts.name}.${parts.num + 1}`;
  const plan = await planVersionBump(repoRoot, target);
  expect(plan.currentVersion).toEqual(
    readConfigVersion(await readFile(join(repoRoot, PACKAGE_CONFIGS[0]), 'utf8')),
  );
  expect(plan.currentVersion !== target).toBeTruthy();
  // Points 1-10: four configs + anchor + release-state + admitted constant +
  // twin fixture + two README lines.
  expect(plan.edits.map((edit) => edit.path)).toEqual([
    ...PACKAGE_CONFIGS,
    VERSION_SOURCE,
    RELEASE_STATE,
    ADMITTED_TARGET_SOURCE,
    ADMITTED_TWIN_FIXTURE,
    ...README_SOURCE_LINES.map((line) => line.path),
  ]);
  expect(plan.edits.filter((edit) => edit.point === 'package-config').length).toEqual(4);
  expect(plan.edits.filter((edit) => edit.point === 'create-anchor').length).toEqual(1);
  expect(plan.edits.filter((edit) => edit.point === 'release-state').length).toEqual(1);
  expect(plan.edits.filter((edit) => edit.point === 'admitted-target').length).toEqual(1);
  expect(plan.edits.filter((edit) => edit.point === 'admitted-twin').length).toEqual(1);
  expect(plan.edits.filter((edit) => edit.point === 'readme-line').length).toEqual(2);
  // The generated preview names the tracked manifest.
  expect(plan.generated).toEqual([{ path: GENERATED_MANIFEST, version: current }]);
});

test('version-bump: a plan against the current version is empty (already-at)', async () => {
  const current = readConfigVersion(await readFile(join(repoRoot, PACKAGE_CONFIGS[0]), 'utf8'))!;
  const plan = await planVersionBump(repoRoot, current);
  expect(plan.edits).toEqual([]);
});

test('version-bump: consistency check reports the points that lag', async () => {
  // The live tree is consistent with its own version.
  const current = readConfigVersion(await readFile(join(repoRoot, PACKAGE_CONFIGS[0]), 'utf8'))!;
  expect(await inconsistencyFailures(repoRoot, current)).toEqual([]);
  // A different expected version reports every stamp point (4 configs + anchor
  // + state sourceVersion/activeTarget + admitted + twin pair + two READMEs +
  // generated manifest = 13; the www anchor audit is
  // expected-version-independent, so it adds nothing here on a healthy tree).
  const failures = await inconsistencyFailures(repoRoot, '9.9.9');
  expect(failures.length).toEqual(13);
  expect(
    failures.some((line) => line.startsWith(VERSION_SOURCE)),
    failures.join('\n'),
  ).toBeTruthy();
  expect(
    failures.some((line) => line.startsWith(RELEASE_STATE)),
    failures.join('\n'),
  ).toBeTruthy();
  expect(
    failures.some((line) => line.startsWith(ADMITTED_TARGET_SOURCE)),
    failures.join('\n'),
  ).toBeTruthy();
  expect(
    failures.some((line) => line.startsWith(ADMITTED_TWIN_FIXTURE)),
    failures.join('\n'),
  ).toBeTruthy();
  expect(
    failures.some((line) => line.startsWith(GENERATED_MANIFEST)),
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

test('version-bump: a write against a fixture tree moves all ten points and regenerates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opx-test-'));
  try {
    const version = '1.0.0-alpha.2';
    const next = '1.0.0-alpha.3';
    for (const path of PACKAGE_CONFIGS) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), `{\n  "name": "x",\n  "version": "${version}"\n}`);
    }
    await mkdir(join(root, 'packages/create/src'), { recursive: true });
    await writeFile(join(root, VERSION_SOURCE), `export const CREATE_VERSION = '${version}';\n`);
    await mkdir(join(root, 'docs/release'), { recursive: true });
    await writeFile(
      join(root, RELEASE_STATE),
      `{\n  "sourceVersion": "${version}",\n  "activeTarget": "v${version}"\n}`,
    );
    await mkdir(join(root, 'tools/repo'), { recursive: true });
    await writeFile(
      join(root, ADMITTED_TARGET_SOURCE),
      `const ADMITTED_ACTIVE_TARGET = 'v${version}';\n`,
    );
    await writeFile(
      join(root, ADMITTED_TWIN_FIXTURE),
      `const PINNED_STATE = {\n  sourceVersion: '${version}',\n  activeTarget: 'v${version}',\n};\nconst VERSIONS = new Map([\n  ['@openelement/element', '${version}'],\n]);\n`,
    );
    await writeFile(join(root, 'README.md'), `The source tree is \`${version}\`, a baseline.\n`);
    await writeFile(join(root, 'README.zh.md'), `源码目前是全新公开基线 \`${version}\`。\n`);
    await mkdir(join(root, 'packages/ui/src'), { recursive: true });
    await writeFile(join(root, GENERATED_MANIFEST), `{\n  "version": "${version}"\n}`);

    const plan = await planVersionBump(root, next);
    expect(plan.edits.length).toEqual(10);
    for (const edit of plan.edits) {
      await writeFile(join(root, edit.path), edit.after, 'utf8');
    }
    // generate:all cannot run in the fixture (no workspace); the manifest is
    // regenerated by hand here to stand in for it, then the consistency face
    // must be clean.
    await writeFile(join(root, GENERATED_MANIFEST), `{\n  "version": "${next}"\n}`);
    const failures = await inconsistencyFailures(root, next);
    // The www anchor audit reports the missing www modules on a fixture tree;
    // every other point must be consistent.
    expect(
      failures.filter((line) => !line.includes('www/')),
      failures.join('\n'),
    ).toEqual([]);
  } finally {
    await rm(root, { recursive: true });
  }
});
