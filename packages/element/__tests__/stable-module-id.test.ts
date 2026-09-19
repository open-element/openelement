import { assertEquals } from '@std/assert';
import { join } from '@std/path';
import { stableModuleId } from '../src/internal/compiler/plugin.ts';

/** A temp checkout-shaped tree; anchors are passed explicitly, never read. */
async function fixtureRepo(
  files: Record<string, string>,
  fn: (root: string) => void,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: 'stable-module-id-' });
  try {
    for (const [relative, content] of Object.entries(files)) {
      const path = join(root, relative);
      await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      await Deno.writeTextFile(path, content);
    }
    fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test('stableModuleId: anchors on the workspace root, not path substrings', async () => {
  await fixtureRepo({
    'www/app/islands/open-layout.tsx': '// island\n',
    'packages/element/src/x.ts': '// module\n',
  }, (root) => {
    assertEquals(
      stableModuleId(`${root}/www/app/islands/open-layout.tsx`, undefined, root),
      'www/app/islands/open-layout.tsx',
    );
    assertEquals(
      stableModuleId(`${root}/packages/element/src/x.ts`, undefined, root),
      'packages/element/src/x.ts',
    );
  });
});

Deno.test('stableModuleId: an unrelated path segment never becomes the anchor', async () => {
  // A checkout living under a directory called www must not get identity
  // relative to that directory; only the explicit root may cut the path.
  await fixtureRepo({
    'packages/element/src/x.ts': '// module\n',
  }, (root) => {
    const nested = join(root, 'srv', 'www', 'openelement');
    const file = join(nested, 'packages/element/src/x.ts');
    assertEquals(
      stableModuleId(file, undefined, nested),
      'packages/element/src/x.ts',
    );
  });
});

Deno.test('stableModuleId: the explicit root wins; linked files fall back to the workspace', async () => {
  await fixtureRepo({
    'www/app/islands/open-layout.tsx': '// island\n',
    'packages/ui/src/open-button.tsx': '// linked package\n',
  }, (root) => {
    const wwwRoot = `${root}/www`;
    assertEquals(
      stableModuleId(`${root}/www/app/islands/open-layout.tsx`, wwwRoot, root),
      'app/islands/open-layout.tsx',
    );
    assertEquals(
      stableModuleId(`${root}/packages/ui/src/open-button.tsx`, wwwRoot, root),
      'packages/ui/src/open-button.tsx',
    );
  });
});

Deno.test('stableModuleId: paths outside any known root pass through unchanged', () => {
  // The frozen compiler fixtures and non-Deno projects legitimately have no
  // anchor; returning the id verbatim is the documented contract.
  const orphan = '/tmp/no-workspace-here-' + crypto.randomUUID() + '/src/x.ts';
  assertEquals(stableModuleId(orphan, undefined), orphan);
  assertEquals(
    stableModuleId('/project/app/islands/counter.tsx', undefined),
    '/project/app/islands/counter.tsx',
  );
});

Deno.test('stableModuleId: non-path ids pass through unchanged', () => {
  assertEquals(stableModuleId('virtual:island', undefined), 'virtual:island');
  assertEquals(stableModuleId('virtual:island?x=1', undefined), 'virtual:island');
});
