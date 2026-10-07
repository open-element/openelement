import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { join } from 'node:path';
import { stableModuleId } from '../../../packages/compiler/src/internal/compiler/plugin.ts';

/** A temp checkout-shaped tree; anchors are passed explicitly, never read. */
async function fixtureRepo(
  files: Record<string, string>,
  fn: (root: string) => void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'stable-module-id-'));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const path = join(root, relative);
      await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      await writeFile(path, content);
    }
    fn(root);
  } finally {
    await rm(root, { recursive: true });
  }
}

test('stableModuleId: anchors on the workspace root, not path substrings', async () => {
  await fixtureRepo(
    {
      'www/app/islands/open-layout.tsx': '// island\n',
      'packages/element/src/x.ts': '// module\n',
    },
    (root) => {
      expect(stableModuleId(`${root}/www/app/islands/open-layout.tsx`, undefined, root)).toEqual(
        'www/app/islands/open-layout.tsx',
      );
      expect(stableModuleId(`${root}/packages/element/src/x.ts`, undefined, root)).toEqual(
        'packages/element/src/x.ts',
      );
    },
  );
});

test('stableModuleId: an unrelated path segment never becomes the anchor', async () => {
  // A checkout living under a directory called www must not get identity
  // relative to that directory; only the explicit root may cut the path.
  await fixtureRepo(
    {
      'packages/element/src/x.ts': '// module\n',
    },
    (root) => {
      const nested = join(root, 'srv', 'www', 'openelement');
      const file = join(nested, 'packages/element/src/x.ts');
      expect(stableModuleId(file, undefined, nested)).toEqual('packages/element/src/x.ts');
    },
  );
});

test('stableModuleId: the explicit root wins; linked files fall back to the workspace', async () => {
  await fixtureRepo(
    {
      'www/app/islands/open-layout.tsx': '// island\n',
      'packages/ui/src/open-button.tsx': '// linked package\n',
    },
    (root) => {
      const wwwRoot = `${root}/www`;
      expect(stableModuleId(`${root}/www/app/islands/open-layout.tsx`, wwwRoot, root)).toEqual(
        'app/islands/open-layout.tsx',
      );
      expect(stableModuleId(`${root}/packages/ui/src/open-button.tsx`, wwwRoot, root)).toEqual(
        'packages/ui/src/open-button.tsx',
      );
    },
  );
});

test('stableModuleId: paths outside any known root pass through unchanged', () => {
  // The frozen compiler fixtures and non-Deno projects legitimately have no
  // anchor; returning the id verbatim is the documented contract.
  const orphan = '/tmp/no-workspace-here-' + crypto.randomUUID() + '/src/x.ts';
  expect(stableModuleId(orphan, undefined)).toEqual(orphan);
  expect(stableModuleId('/project/app/islands/counter.tsx', undefined)).toEqual(
    '/project/app/islands/counter.tsx',
  );
});

test('stableModuleId: non-path ids pass through unchanged', () => {
  expect(stableModuleId('virtual:island', undefined)).toEqual('virtual:island');
  expect(stableModuleId('virtual:island?x=1', undefined)).toEqual('virtual:island');
});
