import { assertEquals, assertThrows } from '@std/assert';
import { join } from '@std/path';
import { stableModuleId } from '../src/internal/compiler/plugin.ts';

/** A temp checkout whose root deno.json declares a workspace list. */
async function fixtureRepo(
  files: Record<string, string>,
  fn: (root: string) => void,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: 'stable-module-id-' });
  try {
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify({ workspace: ['./www', './packages/element'] }),
    );
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
      stableModuleId(`${root}/www/app/islands/open-layout.tsx`, undefined),
      'www/app/islands/open-layout.tsx',
    );
    assertEquals(
      stableModuleId(`${root}/packages/element/src/x.ts`, undefined),
      'packages/element/src/x.ts',
    );
  });
});

Deno.test('stableModuleId: a checkout under a www-named directory is not fooled', async () => {
  // Old heuristic anchored on the first '/www/' segment; a repository living
  // under a directory called www produced a wrong (doubled) identity.
  const parent = await Deno.makeTempDir({ prefix: 'stable-module-id-parent-' });
  const root = join(parent, 'www', 'openelement');
  try {
    await Deno.mkdir(join(root, 'packages', 'element', 'src'), { recursive: true });
    await Deno.writeTextFile(
      join(root, 'deno.json'),
      JSON.stringify({ workspace: ['./packages/element'] }),
    );
    const file = join(root, 'packages/element/src/x.ts');
    await Deno.writeTextFile(file, '// module\n');
    assertEquals(stableModuleId(file, undefined), 'packages/element/src/x.ts');
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});

Deno.test('stableModuleId: the explicit root wins; linked files fall back to the workspace', async () => {
  await fixtureRepo({
    'www/app/islands/open-layout.tsx': '// island\n',
    'packages/ui/src/open-button.tsx': '// linked package\n',
  }, (root) => {
    const wwwRoot = `${root}/www`;
    assertEquals(
      stableModuleId(`${root}/www/app/islands/open-layout.tsx`, wwwRoot),
      'app/islands/open-layout.tsx',
    );
    assertEquals(
      stableModuleId(`${root}/packages/ui/src/open-button.tsx`, wwwRoot),
      'packages/ui/src/open-button.tsx',
    );
  });
});

Deno.test('stableModuleId: no workspace root fails closed', () => {
  const orphan = '/tmp/no-workspace-here-' + crypto.randomUUID() + '/src/x.ts';
  assertThrows(() => stableModuleId(orphan, undefined), Error, 'no workspace root');
});

Deno.test('stableModuleId: non-path ids pass through unchanged', () => {
  assertEquals(stableModuleId('virtual:island', undefined), 'virtual:island');
  assertEquals(stableModuleId('virtual:island?x=1', undefined), 'virtual:island');
});
