import { assert, assertEquals } from '@std/assert';
import { checkNativePack } from './native-pack-check.ts';
import type { PackageInfo } from '../lib/package-graph.ts';

function pkg(name: string): PackageInfo {
  return {
    name,
    dir: `packages/${name}`,
    version: '1.0.0-alpha.1',
    deps: [],
    exports: {},
    importKeys: new Set<string>(),
    importValues: {},
  };
}

Deno.test('native pack check passes when every package dry-runs clean', async () => {
  const seen: string[] = [];
  const failed = await checkNativePack([pkg('a'), pkg('b')], {
    runDryRun: (dir: string) => {
      seen.push(dir);
      return Promise.resolve({ code: 0, stderr: '' });
    },
  });
  assertEquals(failed, []);
  assertEquals(seen, ['packages/a', 'packages/b']);
});

Deno.test('native pack check reports every failing package fail-closed', async () => {
  const failed = await checkNativePack([pkg('a'), pkg('b')], {
    runDryRun: (dir: string) =>
      dir.endsWith('/a')
        ? Promise.resolve({ code: 0, stderr: '' })
        : Promise.resolve({ code: 1, stderr: 'boom' }),
  });
  assertEquals(failed.length, 1);
  assert(failed[0].includes('b'));
  assert(failed[0].includes('boom'));
});
