import { expect, test } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRejectsIncludes } from '../../tests/lib/vitest-asserts.ts';
import {
  declaresWorkspaceMembers,
  ensureOwnWorkspaceRoot,
} from '../../tests/lib/qualify-harness/workspace-isolation.ts';

// The qualify-harness workspace-isolation contract. The scaffold is
// package-manager neutral since alpha15 (no pnpm-workspace.yaml ships at all),
// so `ensureOwnWorkspaceRoot` takes its ENOENT path and writes the minimal
// `packages: []` marker; the catalog-bearing branch stays live because a
// future scaffold could ship a workspace file again, and clobbering one
// wholesale once destroyed a catalog and the published-consumers run died with
// ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC (run 38057211080). The unit
// surface is ensureOwnWorkspaceRoot (workspace-isolation.ts, extracted with
// zero harness imports precisely so it stays checkable here); the install half
// of installAppDependencies just runs pnpm. This file rides the tools vitest
// project — tests/lib has no project of its own, and the cross-tree import
// follows published-consumer-qualification.test.ts importing tests/lib
// helpers.

const repoRoot = join(import.meta.dirname!, '..', '..');
const templatesDir = join(repoRoot, 'packages', 'create', 'templates');

test('the shipped scaffold carries no pnpm workspace file (package-manager neutral)', async () => {
  // The retired Vite+ form shipped `pnpm-workspace.yaml.tmpl` with the catalog
  // that resolved `vite-plus: "catalog:"`. The neutral scaffold ships none, so
  // a create-side regression to the pnpm-only form fails here, on the repo
  // surface, rather than inside a consumer's install.
  const entries = await readdir(templatesDir);
  expect(entries.filter((name) => name.startsWith('pnpm-workspace.yaml'))).toEqual([]);
});

test('declaresWorkspaceMembers: empty and member-less spellings declare none', () => {
  expect(declaresWorkspaceMembers('packages: []\n')).toBe(false);
  expect(declaresWorkspaceMembers('packages:\n')).toBe(false);
  expect(declaresWorkspaceMembers('catalog:\n  vite-plus: 1.1.0\noverrides:\n')).toBe(false);
});

test('declaresWorkspaceMembers: inline and block member listings declare members', () => {
  expect(declaresWorkspaceMembers("packages: ['web/*']\n")).toBe(true);
  expect(declaresWorkspaceMembers("packages:\n  - 'web/*'\n")).toBe(true);
});

test('declaresWorkspaceMembers: list items under later keys never count', () => {
  // minimumReleaseAgeExclude-style entries belong to their own key; scanning
  // past the next top-level key would false-positive on them.
  expect(declaresWorkspaceMembers("packages: []\nminimumReleaseAgeExclude:\n  - 'x@1.0.0'\n")).toBe(
    false,
  );
});

test('ensureOwnWorkspaceRoot keeps a shipped catalog-bearing file byte-intact', async () => {
  const appDir = await mkdtemp(join(tmpdir(), 'workspace-isolation-shipped-'));
  // A catalog-bearing workspace file (the retired Vite+ shape) must never be
  // rewritten: the app still needs to be its own workspace root, and the file
  // already declares no members.
  const shipped = 'catalog:\n  vite-plus: 1.1.0\noverrides:\n  vite@*: "catalog:"\n';
  await writeFile(join(appDir, 'pnpm-workspace.yaml'), shipped);
  await ensureOwnWorkspaceRoot(appDir);
  expect(await readFile(join(appDir, 'pnpm-workspace.yaml'), 'utf8')).toBe(shipped);
});

test('ensureOwnWorkspaceRoot writes the minimal marker only when the scaffold shipped none', async () => {
  const appDir = await mkdtemp(join(tmpdir(), 'workspace-isolation-absent-'));
  await ensureOwnWorkspaceRoot(appDir);
  expect(await readFile(join(appDir, 'pnpm-workspace.yaml'), 'utf8')).toBe('packages: []\n');
});

test('ensureOwnWorkspaceRoot refuses a shipped file that declares workspace members', async () => {
  const appDir = await mkdtemp(join(tmpdir(), 'workspace-isolation-members-'));
  await writeFile(join(appDir, 'pnpm-workspace.yaml'), "packages:\n  - 'web/*'\n");
  await assertRejectsIncludes(
    () => ensureOwnWorkspaceRoot(appDir),
    Error,
    'must stay its own workspace root',
  );
});
