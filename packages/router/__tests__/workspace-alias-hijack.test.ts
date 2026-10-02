/**
 * packages/router/__tests__/workspace-alias-hijack.test.ts — Finding A guard
 * (#1415, same family as #1371).
 *
 * An app created inside a framework checkout pins `@openelement/*` at registry
 * versions, but the workspace aliases generated from the enclosing checkout
 * would silently resolve them to the checkout's sources. The guard refuses
 * that state; repo-owned fixtures (relative source paths) and workspace members
 * must stay unaffected.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { expect, test } from 'vitest';
import { join } from '@std/path';
import { openElement } from '../src/vite/app-vite.ts';
import {
  detectWorkspaceAliasHijack,
  findWorkspaceRoot,
  workspaceAliasHijackError,
} from '../src/vite/workspace-alias.ts';

interface TempRepo {
  root: string;
  write(relativePath: string, content: string): void;
}

async function withRepo(fn: (repo: TempRepo) => void): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'oe-hijack-'));
  const repo: TempRepo = {
    root,
    write(relativePath, content) {
      const path = join(root, relativePath);
      mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      writeFileSync(path, content);
    },
  };
  try {
    fn(repo);
  } finally {
    await rm(root, { recursive: true });
  }
}

function scaffoldApp(repo: TempRepo, appPath: string, imports: Record<string, string>): string {
  repo.write('deno.json', JSON.stringify({ workspace: ['./packages/element'] }));
  repo.write('packages/element/deno.json', JSON.stringify({ name: '@openelement/element' }));
  repo.write(`${appPath}/deno.json`, JSON.stringify({ imports }, null, 2));
  return join(repo.root, appPath);
}

test('hijack guard: a registry-pinned app inside a checkout is refused', async () => {
  await withRepo((repo) => {
    const appDir = scaffoldApp(repo, 'my-app', {
      '@openelement/router': 'npm:@openelement/router@1.0.0-alpha.2',
      '@openelement/element': 'npm:@openelement/element@1.0.0-alpha.2',
    });
    const hijack = detectWorkspaceAliasHijack(appDir);
    expect(hijack, 'a scaffolded app inside the checkout must be detected').toBeTruthy();
    expect(hijack.appRoot).toEqual(appDir);
    expect(hijack.workspaceRoot).toEqual(repo.root);
    expect(hijack.pinned.map((entry) => entry.specifier)).toEqual([
      '@openelement/router',
      '@openelement/element',
    ]);

    const message = workspaceAliasHijackError(hijack).message;
    // The error must name the state, both paths, and the fix.
    expect(message.includes('npm:@openelement/router@1.0.0-alpha.2'), message).toBeTruthy();
    expect(message.includes(appDir), message).toBeTruthy();
    expect(message.includes(repo.root), message).toBeTruthy();
    expect(message.includes('move the app'), message).toBeTruthy();
  });
});

test('hijack guard: repo-owned fixtures with relative source pins are untouched', async () => {
  await withRepo((repo) => {
    // The shape every in-repo fixture uses: relative paths express "use the
    // checkout's sources on purpose".
    const appDir = scaffoldApp(repo, 'tests/fixtures/router-native-framework', {
      '@openelement/router': '../../../packages/router/src/index.ts',
      '@openelement/element': '../../../packages/element/src/index.ts',
    });
    expect(detectWorkspaceAliasHijack(appDir)).toEqual(null);
  });
});

test('hijack guard: a workspace member is exempt', async () => {
  await withRepo((repo) => {
    repo.write('deno.json', JSON.stringify({ workspace: ['./apps/saas'] }));
    repo.write(
      'apps/saas/deno.json',
      JSON.stringify({
        name: '@openelement/saas',
        imports: { '@openelement/router': 'npm:@openelement/router@1.0.0-alpha.2' },
      }),
    );
    expect(detectWorkspaceAliasHijack(join(repo.root, 'apps/saas'))).toEqual(null);
  });
});

test('hijack guard: an app outside any workspace is untouched', async () => {
  await withRepo((repo) => {
    repo.write(
      'my-app/deno.json',
      JSON.stringify({
        imports: { '@openelement/router': 'npm:@openelement/router@1.0.0-alpha.2' },
      }),
    );
    expect(detectWorkspaceAliasHijack(join(repo.root, 'my-app'))).toEqual(null);
  });
});

test('hijack guard: a workspace root that IS the app root is untouched', async () => {
  await withRepo((repo) => {
    repo.write(
      'deno.json',
      JSON.stringify({
        workspace: ['./packages/element'],
        imports: { '@openelement/router': 'npm:@openelement/router@1.0.0-alpha.2' },
      }),
    );
    expect(detectWorkspaceAliasHijack(repo.root)).toEqual(null);
  });
});

test('hijack guard: jsr pins are caught the same way', async () => {
  await withRepo((repo) => {
    const appDir = scaffoldApp(repo, 'my-app', {
      '@openelement/router': 'jsr:@openelement/router@1.0.0-alpha.2',
    });
    const hijack = detectWorkspaceAliasHijack(appDir);
    expect(hijack).toBeTruthy();
    expect(hijack.pinned[0].target).toEqual('jsr:@openelement/router@1.0.0-alpha.2');
  });
});

test('hijack guard: the real repo does not trip on its own tree', () => {
  // Since the B2 manifest conversion the repository is a pnpm workspace, not
  // a Deno workspace: no deno.json workspace marker exists above the packages,
  // so the Deno-consumer hijack guard is inert here. The guard itself stays
  // for external Deno-ecosystem consumers (deno.json import maps are a
  // product feature of the router).
  const repoRoot = join(import.meta.dirname!, '..', '..', '..');
  expect(detectWorkspaceAliasHijack(repoRoot)).toEqual(null);
  expect(findWorkspaceRoot(repoRoot)).toEqual(null);
});

test('hijack guard: openElement() refuses to build such an app (#1415 Finding A)', async () => {
  await withRepo((repo) => {
    const appDir = scaffoldApp(repo, 'my-app', {
      '@openelement/router': 'npm:@openelement/router@1.0.0-alpha.2',
    });
    const origCwd = process.cwd();
    try {
      process.chdir(appDir);
      // The plugin factory throws before any alias is generated, so the error
      // reaches the user as a build failure, not as a silent wrong-version
      // build with the ordinary "Auto-generated N resolve alias(es)" log line.
      let thrown: unknown;
      try {
        openElement();
      } catch (error) {
        thrown = error;
      }
      expect(thrown instanceof Error, 'openElement() must refuse the hijacked app').toBeTruthy();
      expect(
        (thrown as Error).message.includes('silently replace'),
        (thrown as Error).message,
      ).toBeTruthy();
    } finally {
      process.chdir(origCwd);
    }
  });
});
