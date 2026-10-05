/**
 * tools/repo/version-bump.test.ts — stamp contract (#1415, #1508, #1524).
 *
 * The dry run is the acceptance surface: it must report exactly the four
 * package manifests, the CREATE_VERSION anchor, the release-state bookkeeping
 * pair, the admitted-train constant and its twin fixture, and the two README
 * source-tree lines — plus every release-line-shaped workspace member that
 * lags the train (#1524), and the generated-output preview. `--write` is
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
  isReleaseLineShape,
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
  WORKSPACE_ROOT_CONFIG,
  workspaceMemberConfigPaths,
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
  expect(WORKSPACE_ROOT_CONFIG).toEqual('package.json');
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

test('version-bump: the release-line shape keys on base plus prerelease train', () => {
  // Same base on a prerelease train — the stampable form.
  expect(isReleaseLineShape('1.0.0-alpha.1', '1.0.0-alpha.9')).toEqual(true);
  expect(isReleaseLineShape('1.0.0-alpha.9', '1.0.0-alpha.9')).toEqual(true);
  // Not the line's shape: a different base, a stable version, or garbage.
  expect(isReleaseLineShape('0.0.0', '1.0.0-alpha.9')).toEqual(false);
  expect(isReleaseLineShape('1.0.0', '1.0.0-alpha.9')).toEqual(false);
  expect(isReleaseLineShape('2.0.0-alpha.1', '1.0.0-alpha.9')).toEqual(false);
  expect(isReleaseLineShape('workspace:*', '1.0.0-alpha.9')).toEqual(false);
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
  // The ten release-line points: four configs + anchor + release-state +
  // admitted constant + twin fixture + two README lines.
  expect(
    plan.edits.filter((edit) => edit.point !== 'workspace-member').map((edit) => edit.path),
  ).toEqual([
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
  // #1524: every release-line-shaped member lags the advanced target, so each
  // one gets an edit; the member audit lists the skipped fixtures too.
  const memberPaths = plan.members.map((member) => member.path);
  expect(memberPaths.length).toEqual((await workspaceMemberConfigPaths(repoRoot)).length);
  // #1534: the workspace root's own manifest is enumerated too — no
  // `packages:` glob names it, so its presence here is the explicit append
  // working on the live tree.
  expect(memberPaths).toContain(WORKSPACE_ROOT_CONFIG);
  for (const member of plan.members) {
    expect(member.status === 'stamped' || member.status === 'skipped', member.path).toBeTruthy();
  }
  const stampedPaths = plan.members
    .filter((member) => member.status === 'stamped')
    .map((member) => member.path);
  expect(
    plan.edits.filter((edit) => edit.point === 'workspace-member').map((edit) => edit.path),
  ).toEqual(stampedPaths);
  // The published roster must never reappear in the member walk (point 1-4
  // owns those files).
  for (const config of PACKAGE_CONFIGS) {
    expect(memberPaths.includes(config), config).toBeFalsy();
  }
  // The generated preview names the tracked manifest.
  expect(plan.generated).toEqual([{ path: GENERATED_MANIFEST, version: current }]);
});

test('version-bump: a plan against the current version carries member stamps only', async () => {
  const current = readConfigVersion(await readFile(join(repoRoot, PACKAGE_CONFIGS[0]), 'utf8'))!;
  const plan = await planVersionBump(repoRoot, current);
  // The release line is converged by construction (it defines the current
  // version); what may lag it is exactly the release-line-shaped member set.
  expect(plan.edits.filter((edit) => edit.point !== 'workspace-member')).toEqual([]);
  const lagging = plan.members.filter((member) => member.status === 'stamped');
  expect(plan.edits.map((edit) => edit.path)).toEqual(lagging.map((member) => member.path));
  for (const member of lagging) {
    // A stamp edit moves the member's own current version to the target.
    const edit = plan.edits.find((candidate) => candidate.path === member.path)!;
    expect(edit.before).toContain(`"version": "${member.version}"`);
    expect(edit.after).toContain(`"version": "${current}"`);
  }
});

test('version-bump: consistency check reports the points that lag', async () => {
  // The live tree's release line is consistent with its own version; what may
  // lag it is exactly the release-line-shaped member set (the #1524 straggler
  // state, reported until a --write converges it).
  const current = readConfigVersion(await readFile(join(repoRoot, PACKAGE_CONFIGS[0]), 'utf8'))!;
  const memberPaths = await workspaceMemberConfigPaths(repoRoot);
  const atCurrent = await inconsistencyFailures(repoRoot, current);
  expect(atCurrent.filter((line) => !memberPaths.some((path) => line.startsWith(path)))).toEqual(
    [],
  );
  const laggingNow = (await planVersionBump(repoRoot, current)).members.filter(
    (member) => member.status === 'stamped',
  ).length;
  expect(
    atCurrent.filter((line) => memberPaths.some((path) => line.startsWith(path))).length,
  ).toEqual(laggingNow);
  // A different expected version reports every stamp point: 4 configs + anchor
  // + state sourceVersion/activeTarget + admitted + twin pair + two READMEs +
  // generated manifest = 13, plus every member riding the tree's train (the
  // #1524 stamps — none can carry a 9.9.9 target); the www anchor audit is
  // expected-version-independent, so it adds nothing here on a healthy tree.
  const allMembers = await planVersionBump(repoRoot, '9.9.9');
  const trainMembers = allMembers.members.filter((member) => member.status !== 'skipped').length;
  const failures = await inconsistencyFailures(repoRoot, '9.9.9');
  expect(failures.length).toEqual(13 + trainMembers);
  // The skipped (non-release-line) fixtures stay exempt from the stamp check.
  expect(allMembers.members.some((member) => member.status === 'skipped')).toBeTruthy();
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
  // #1524: an expected version ON the tree's train also reports the members
  // that do not carry it, in proportion to the live lagging set.
  const parts = prereleaseParts(current);
  if (parts === undefined) throw new Error(`fixture version is not a prerelease: ${current}`);
  const next = `${parts.base}-${parts.name}.${parts.num + 1}`;
  const atNext = await inconsistencyFailures(repoRoot, next);
  const laggingAtNext = (await planVersionBump(repoRoot, next)).members.filter(
    (member) => member.status === 'stamped',
  ).length;
  expect(atNext.filter((line) => memberPaths.some((path) => line.startsWith(path))).length).toEqual(
    laggingAtNext,
  );
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

test('version-bump: workspace members ride the stamp on a fixture tree (#1524)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opx-test-'));
  try {
    const version = '1.0.0-alpha.2';
    const next = '1.0.0-alpha.3';
    // The release-line points, minimized to what the plan reads.
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
      `const PINNED_STATE = { sourceVersion: '${version}', activeTarget: 'v${version}' };\n`,
    );
    await writeFile(join(root, 'README.md'), `The source tree is \`${version}\`, a baseline.\n`);
    await writeFile(join(root, 'README.zh.md'), `源码目前是全新公开基线 \`${version}\`。\n`);
    await mkdir(join(root, 'packages/ui/src'), { recursive: true });
    await writeFile(join(root, GENERATED_MANIFEST), `{\n  "version": "${version}"\n}`);
    // The workspace: one member lagging on the train, one already at the
    // target, one fixture on a non-release-line version, and one excluded
    // path. The published roster is absent entirely — the member walk must
    // not invent it.
    await writeFile(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - www\n  - apps/*\n  - tests/fixtures/*\n  - "!apps/secret"\n',
    );
    // The workspace root itself, lagging the same train (#1534): no glob
    // names it, so only the explicit append can pick it up.
    await writeFile(
      join(root, 'package.json'),
      `{\n  "name": "openelement",\n  "private": true,\n  "version": "${version}"\n}`,
    );
    await mkdir(join(root, 'www'), { recursive: true });
    await writeFile(
      join(root, 'www/package.json'),
      `{\n  "name": "@x/www",\n  "private": true,\n  "version": "${version}"\n}`,
    );
    await mkdir(join(root, 'tests/fixtures/thing'), { recursive: true });
    await writeFile(
      join(root, 'tests/fixtures/thing/package.json'),
      '{\n  "name": "@x/fixture-thing",\n  "private": true,\n  "version": "0.0.0"\n}',
    );
    await mkdir(join(root, 'apps/secret'), { recursive: true });
    await writeFile(
      join(root, 'apps/secret/package.json'),
      `{\n  "name": "@x/secret",\n  "private": true,\n  "version": "${version}"\n}`,
    );

    const plan = await planVersionBump(root, next);
    // Ten release-line points + the lagging workspace root (#1534) + the one
    // lagging member.
    expect(plan.edits.map((edit) => edit.path)).toEqual([
      ...PACKAGE_CONFIGS,
      WORKSPACE_ROOT_CONFIG,
      'www/package.json',
      VERSION_SOURCE,
      RELEASE_STATE,
      ADMITTED_TARGET_SOURCE,
      ADMITTED_TWIN_FIXTURE,
      ...README_SOURCE_LINES.map((line) => line.path),
    ]);
    const wwwEdit = plan.edits.find((edit) => edit.path === 'www/package.json')!;
    expect(wwwEdit.point).toEqual('workspace-member');
    expect(wwwEdit.before).toContain(`"version": "${version}"`);
    expect(wwwEdit.after).toContain(`"version": "${next}"`);
    const rootEdit = plan.edits.find((edit) => edit.path === WORKSPACE_ROOT_CONFIG)!;
    expect(rootEdit.point).toEqual('workspace-member');
    expect(rootEdit.before).toContain(`"version": "${version}"`);
    expect(rootEdit.after).toContain(`"version": "${next}"`);
    const rootStamp = plan.members.find((member) => member.path === WORKSPACE_ROOT_CONFIG)!;
    expect(rootStamp.status).toEqual('stamped');
    // The full member audit: stamped, skipped (fixture), excluded.
    const wwwStamp = plan.members.find((member) => member.path === 'www/package.json')!;
    expect(wwwStamp.status).toEqual('stamped');
    const fixtureStamp = plan.members.find(
      (member) => member.path === 'tests/fixtures/thing/package.json',
    )!;
    expect(fixtureStamp.status).toEqual('skipped');
    expect(fixtureStamp.reason).toContain('not on the release line');
    expect(plan.members.some((member) => member.path === 'apps/secret/package.json')).toBeFalsy();

    // Applying the plan converges the tree: consistency is clean for the
    // stamp points the fixture carries (the manifest is regenerated by hand
    // to stand in for generate:all, and the www anchor audit is filtered —
    // the fixture carries no www modules), and a plan against the NEW version
    // is empty — the already-at state.
    await writeFile(join(root, GENERATED_MANIFEST), `{\n  "version": "${next}"\n}`);
    for (const edit of plan.edits) {
      await writeFile(join(root, edit.path), edit.after, 'utf8');
    }
    const failures = await inconsistencyFailures(root, next);
    expect(
      failures.filter((line) => !line.includes('www/app/data/')),
      failures.join('\n'),
    ).toEqual([]);
    const converged = await planVersionBump(root, next);
    expect(converged.edits).toEqual([]);
    // Sorted member paths: the root (#1534, now current), the skipped
    // fixture, and the stamped-then-converged www member.
    expect(converged.members.map((member) => member.path)).toEqual([
      WORKSPACE_ROOT_CONFIG,
      'tests/fixtures/thing/package.json',
      'www/package.json',
    ]);
    expect(converged.members.map((member) => member.status)).toEqual([
      'current',
      'skipped',
      'current',
    ]);
  } finally {
    await rm(root, { recursive: true });
  }
});
