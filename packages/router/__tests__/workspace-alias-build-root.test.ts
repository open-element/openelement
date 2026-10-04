/**
 * packages/router/__tests__/workspace-alias-build-root.test.ts — the
 * build-side workspace anchor (stable module ids, source-map anchors,
 * route-scan anchors).
 *
 * The anchor is a pure pnpm-workspace.yaml ancestor discovery: it exists so
 * build identities stay machine-independent, not to synthesize aliases or
 * resolve packages — those belong to the package manager and the consumer's
 * own vite config.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { join } from 'node:path';
import { findBuildWorkspaceRoot } from '../src/vite/workspace-alias.ts';

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
    expect(findBuildWorkspaceRoot(tree.path('www/app/islands'))).toEqual(tree.root);
    expect(findBuildWorkspaceRoot(tree.root)).toEqual(tree.root);
  });
});

test('build root: no pnpm-workspace.yaml marker means no anchor', async () => {
  await withTree((tree) => {
    // A deno.json — even a workspace-shaped one — is not the anchor: the
    // supported consumer surface is Node/pnpm.
    tree.write('deno.json', JSON.stringify({ workspace: ['./packages/element'] }));
    tree.write('app/islands/island.tsx', 'export default () => {};\n');
    expect(findBuildWorkspaceRoot(tree.path('app/islands'))).toEqual(null);
    expect(findBuildWorkspaceRoot(tree.root)).toEqual(null);
  });
});

test('build root: the real repository anchors on its pnpm-workspace.yaml', () => {
  const repoRoot = join(import.meta.dirname!, '..', '..', '..');
  // The fix: this used to be null after the B2 conversion dropped the
  // workspace marker, which unanchored every build identity.
  expect(findBuildWorkspaceRoot(repoRoot)).toEqual(repoRoot);
});
