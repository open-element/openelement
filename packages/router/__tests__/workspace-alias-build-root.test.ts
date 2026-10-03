/**
 * packages/router/__tests__/workspace-alias-build-root.test.ts — the
 * build-side workspace anchor (stable module ids, source-map anchors,
 * route-scan anchors).
 *
 * Since the B2 manifest conversion this repository is a pnpm workspace: no
 * deno.json workspace marker exists, so the Deno-consumer discovery
 * (findWorkspaceRoot, kept for the #1415 hijack guard) returns null here and
 * build identities lost their anchor — absolute build-machine paths leaked
 * into shipped island error copy until findBuildWorkspaceRoot learned the
 * pnpm-workspace.yaml marker.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { join } from '@std/path';
import { findBuildWorkspaceRoot, findWorkspaceRoot } from '../src/vite/workspace-alias.ts';

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

test('build root: a deno.json workspace still anchors, and wins in a hybrid tree', async () => {
  await withTree((tree) => {
    tree.write('deno.json', JSON.stringify({ workspace: ['./packages/element'] }));
    expect(findBuildWorkspaceRoot(tree.path('packages'))).toEqual(tree.root);
    // Hybrid tree: both manifest kinds in one directory — the Deno anchor
    // keeps its pre-B2 precedence.
    tree.write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    expect(findBuildWorkspaceRoot(tree.root)).toEqual(tree.root);
  });
});

test('build root: no marker of either kind means no anchor', async () => {
  await withTree((tree) => {
    tree.write('app/islands/island.tsx', 'export default () => {};\n');
    expect(findBuildWorkspaceRoot(tree.path('app/islands'))).toEqual(null);
  });
});

test('build root: the real repository anchors on its pnpm-workspace.yaml', () => {
  const repoRoot = join(import.meta.dirname!, '..', '..', '..');
  // The fix: this used to be null after the B2 conversion (no deno.json
  // workspace marker), which unanchored every build identity.
  expect(findBuildWorkspaceRoot(repoRoot)).toEqual(repoRoot);
  // The Deno-consumer discovery stays deliberately inert on this tree; the
  // hijack guard test pins the same null.
  expect(findWorkspaceRoot(repoRoot)).toEqual(null);
});
