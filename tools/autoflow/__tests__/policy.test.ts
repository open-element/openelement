import { assert, assertEquals, assertFalse } from '@std/assert';
import { addPaths, gitChangedPaths } from '../cli.ts';
import { allRegisteredGates, selectGates } from '../policy.ts';

Deno.test('generic toolchain checks stay direct CI steps', () => {
  const names = allRegisteredGates().map((gate) => gate.name);
  for (const direct of ['fmt:check', 'lint', 'typecheck', 'lint:markdown']) {
    assertFalse(names.includes(direct));
  }
});

Deno.test('push tier is small and package-aware', () => {
  const names = selectGates('push', ['packages/element/src/index.ts']).map((gate) => gate.name);
  assertEquals(names, ['graph:check', 'package-surface:check', 'export-files:check']);
});

Deno.test('release tier qualifies artifacts and runtimes without publishing', () => {
  const names = selectGates('release', ['packages/app/src/index.ts']).map((gate) => gate.name);
  for (
    const required of [
      'package-artifacts:check',
      'consumer:packaged',
      'consumer:packaged-app',
      'consumer:packaged-router',
      'nitro:proof:node',
      'nitro:proof:workers',
      'publish:npm:dry-run',
    ]
  ) {
    assert(names.includes(required), `${required} missing`);
  }
  assertFalse(names.includes('publish:npm'));
});

Deno.test('addPaths deduplicates paths', () => {
  const paths = new Set<string>();
  addPaths(paths, 'README.md\npackages/element/src/index.ts\n');
  addPaths(paths, 'README.md\r\n');
  assertEquals([...paths].sort(), ['README.md', 'packages/element/src/index.ts']);
});

Deno.test('ci changed paths fall back to root diff', async () => {
  const calls: string[][] = [];
  const paths = await gitChangedPaths('ci', (args) => {
    calls.push(args);
    return Promise.resolve(args[0] === 'diff' ? undefined : 'deno.lock\n');
  });
  assertEquals(paths, ['deno.lock']);
  assertEquals(calls.length, 2);
});
