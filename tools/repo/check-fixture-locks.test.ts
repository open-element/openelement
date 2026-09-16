import { assertEquals, assertStringIncludes } from '@std/assert';
import {
  absolutePathFailures,
  type FixtureLockEntry,
  type FixtureLockFiles,
  lockVersionFailures,
  registryFailures,
  sharedUniverseFailures,
  taskNpmSpecifiers,
} from './check-fixture-locks.ts';

const ENTRIES: FixtureLockEntry[] = [
  { fixture: 'a', purpose: 'fixture a', entrypoint: 'app/routes/index.tsx' },
  {
    fixture: 'b',
    purpose: 'fixture b',
    entrypoint: 'app/routes/index.tsx',
    sharedUniverseWith: 'a',
  },
];

Deno.test('fixture locks: registry fails on unlisted and missing locks', () => {
  const unregistered = registryFailures(['a', 'b', 'new-fixture'], ENTRIES);
  assertEquals(unregistered.length, 1);
  assertStringIncludes(unregistered[0], 'unregistered fixture lockfile');
  assertStringIncludes(unregistered[0], 'new-fixture');
  const missing = registryFailures(['a'], ENTRIES);
  assertEquals(missing.length, 1);
  assertStringIncludes(
    missing[0],
    'registered fixture lockfile is missing: tests/fixtures/b/deno.lock',
  );
});

Deno.test('fixture locks: rejects host-absolute paths', () => {
  assertEquals(absolutePathFailures('a', '{"version":"5"}'), []);
  assertStringIncludes(absolutePathFailures('a', 'file:///Users/x')[0], 'host-absolute path');
});

Deno.test('fixture locks: shared universes must be byte-identical', () => {
  const lock = '{"version":"5","specifiers":{}}';
  const config = '{"imports":{"@openelement/router":"../../../packages/router/src/index.ts"}}';
  const files = new Map<string, FixtureLockFiles>([
    ['a', { lock, config }],
    ['b', { lock, config }],
  ]);
  assertEquals(sharedUniverseFailures(ENTRIES, files), []);

  const drifted = new Map(files);
  drifted.set('b', { lock: '{"version":"5","specifiers":{"x":1}}', config });
  assertStringIncludes(
    sharedUniverseFailures(ENTRIES, drifted)[0],
    'lockfiles differ',
  );

  const importsDrifted = new Map(files);
  importsDrifted.set('b', {
    lock,
    config: '{"imports":{"@openelement/router":"../../../packages/router/src/other.ts"}}',
  });
  assertStringIncludes(
    sharedUniverseFailures(ENTRIES, importsDrifted)[0],
    'deno.json imports differ',
  );
});

Deno.test('fixture locks: task npm specifiers join the lock universe', () => {
  const config = JSON.stringify({
    tasks: {
      e2e: 'deno run --allow-read --allow-run npm:@playwright/test@1.59.1 test',
      build: ['deno', 'run', 'npm:vite@8.0.16', 'build'],
      dev: 'vite dev',
    },
  });
  assertEquals(taskNpmSpecifiers(config), ['npm:@playwright/test@1.59.1', 'npm:vite@8.0.16']);
  assertEquals(taskNpmSpecifiers('{"tasks":{"check":"deno lint"}}'), []);
  assertEquals(taskNpmSpecifiers('not json'), []);
});

Deno.test('fixture locks: lock version must be supported JSON', () => {
  assertEquals(lockVersionFailures('a', '{"version":"5"}'), []);
  assertStringIncludes(lockVersionFailures('a', '{"version":"3"}')[0], 'unsupported');
  assertStringIncludes(lockVersionFailures('a', 'not json')[0], 'not valid JSON');
});
