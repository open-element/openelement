/**
 * packages/router/__tests__/workspace-alias-build-root.test.ts — the
 * build-side workspace anchor (stable module ids, source-map anchors,
 * route-scan anchors).
 *
 * The anchor is a pure pnpm-workspace.yaml ancestor discovery: it exists so
 * build identities stay machine-independent, not to synthesize aliases or
 * resolve packages — those belong to the package manager and the consumer's
 * own vite config.
 *
 * The lookup answers three-way: `found` / `absent` (the legal silence for
 * standalone single-package consumers) / `error` (the walk itself failed —
 * the one case that must surface as a diagnostic, never laundered into a
 * quiet "no anchor").
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { join } from 'node:path';
import {
  findBuildWorkspaceRoot,
  findBuildWorkspaceRootOrUndefined,
} from '../src/vite/workspace-alias.ts';

interface TempTree {
  root: string;
  write(relativePath: string, content: string): void;
  path(relativePath: string): string;
}

async function withTree(fn: (tree: TempTree) => void): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'oe-build-root-'));
  const tree: TempTree = {
    root,
    write(relativePath, content) {
      const path = join(root, relativePath);
      mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      writeFileSync(path, content);
    },
    path(relativePath) {
      return join(root, relativePath);
    },
  };
  try {
    fn(tree);
  } finally {
    await rm(root, { recursive: true });
  }
}

test('build root: a pnpm workspace marker anchors nested modules', async () => {
  await withTree((tree) => {
    tree.write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    tree.write('www/app/islands/island.tsx', 'export default () => {};\n');
    expect(findBuildWorkspaceRoot(tree.path('www/app/islands'))).toEqual({
      status: 'found',
      root: tree.root,
    });
    expect(findBuildWorkspaceRoot(tree.root)).toEqual({ status: 'found', root: tree.root });
    expect(findBuildWorkspaceRootOrUndefined(tree.root)).toEqual(tree.root);
  });
});

test('build root: no pnpm-workspace.yaml marker means absent — the legal silence', async () => {
  await withTree((tree) => {
    // A deno.json — even a workspace-shaped one — is not the anchor: the
    // supported consumer surface is Node/pnpm.
    tree.write('deno.json', JSON.stringify({ workspace: ['./packages/element'] }));
    tree.write('app/islands/island.tsx', 'export default () => {};\n');
    expect(findBuildWorkspaceRoot(tree.path('app/islands'))).toEqual({ status: 'absent' });
    expect(findBuildWorkspaceRoot(tree.root)).toEqual({ status: 'absent' });
    expect(findBuildWorkspaceRootOrUndefined(tree.root)).toEqual(undefined);
  });
});

test.skipIf(
  // Root (CI containers) reads through a 0000 mode, and Windows has no
  // enforcing chmod: the EACCES precondition only exists on a normal uid.
  process.getuid?.() === 0 || process.platform === 'win32',
)('build root: an unprobeable ancestor is an error, not a silent no-anchor', async () => {
  // Root runs as the uid that owns this temp tree, so a 0000 directory makes
  // the probe fail with EACCES; the lookup must surface that as `error`
  // instead of walking past it as an absence.
  const root = await mkdtemp(join(tmpdir(), 'oe-build-root-err-'));
  try {
    mkdirSync(join(root, 'sealed'), { recursive: true });
    writeFileSync(join(root, 'sealed', 'island.tsx'), 'export default () => {};\n');
    chmodSync(join(root, 'sealed'), 0o000);
    const lookup = findBuildWorkspaceRoot(join(root, 'sealed'));
    expect(lookup.status).toEqual('error');
    if (lookup.status === 'error') {
      expect(lookup.reason.length).toBeGreaterThan(0);
    }
    expect(findBuildWorkspaceRootOrUndefined(join(root, 'sealed'))).toEqual(undefined);
  } finally {
    chmodSync(join(root, 'sealed'), 0o755);
    await rm(root, { recursive: true });
  }
});

test('build root: the real repository anchors on its pnpm-workspace.yaml', () => {
  const repoRoot = join(import.meta.dirname!, '..', '..', '..');
  // The fix: this used to be null after the B2 conversion dropped the
  // workspace marker, which unanchored every build identity.
  expect(findBuildWorkspaceRoot(repoRoot)).toEqual({ status: 'found', root: repoRoot });
});
