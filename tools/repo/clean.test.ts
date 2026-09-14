import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import { dirname, join } from '@std/path';
import {
  assertSafeTarget,
  cleanTargets,
  DEEP_TARGETS,
  DEFAULT_TARGETS,
  parseCleanArgs,
} from './clean.ts';

const quiet = { log: () => {} };

async function writeTree(root: string, paths: readonly string[]): Promise<void> {
  for (const relativePath of paths) {
    const absolute = join(root, relativePath);
    await Deno.mkdir(dirname(absolute), { recursive: true });
    await Deno.writeTextFile(absolute, `${relativePath}\n`);
  }
}

Deno.test('clean refuses absolute, home, escaping and broad targets', () => {
  for (
    const bad of [
      '',
      '/',
      '~',
      '~/secrets',
      '..',
      '../outside',
      'packages/../../outside',
      '.',
      'a//b',
      'a/',
      'a\\b',
      'C:/tmp',
      'C:\\tmp',
      '*',
      '**',
      'packages/**',
      '*/*/*',
    ]
  ) {
    assertThrows(() => assertSafeTarget(bad), Error, 'clean:', bad);
  }
});

Deno.test('clean CLI only accepts allowlisted generated patterns', () => {
  assertThrows(() => parseCleanArgs(['docs']), Error, 'not an allowlisted');
  assertThrows(() => parseCleanArgs(['README.md']), Error, 'not an allowlisted');
  assertThrows(() => parseCleanArgs(['.env']), Error, 'not an allowlisted');
  assertThrows(() => parseCleanArgs(['node_modules']), Error, 'not an allowlisted');
  assertThrows(() => parseCleanArgs(['--nuke']), Error, 'unknown flag');
  assertEquals(parseCleanArgs(['packages/*/dist']).targets, ['packages/*/dist']);
});

Deno.test('clean defaults stay separate from opt-in deep targets', () => {
  assertEquals(parseCleanArgs([]).targets, DEFAULT_TARGETS);
  assertEquals(parseCleanArgs([]).deep, false);
  assertEquals(parseCleanArgs(['--deep']).deep, true);
  assertEquals(parseCleanArgs(['--deep']).targets, [...DEFAULT_TARGETS, ...DEEP_TARGETS]);
  assert(DEEP_TARGETS.every((target) => !DEFAULT_TARGETS.includes(target)));
});

Deno.test('default clean removes generated output and preserves user content', async () => {
  const root = await Deno.makeTempDir({ prefix: 'clean-test-' });
  const generated = [
    'packages/element/dist/index.js',
    'packages/router/dist/index.js',
    'packages/router/dist-test-ssg-render/index.html',
    'packages/router/custom-dist/index.js',
    'packages/ui/dist/index.js',
    'apps/site/dist/index.html',
    'apps/site/.openElement/cache.json',
    'apps/saas/dist/index.html',
    'apps/saas/.openElement/cache.json',
    'apps/saas/.output-node/server.js',
    'apps/saas/.output-workers/server.js',
    'apps/saas/.nitro/cache.json',
    'apps/saas/.wrangler/state.json',
    'dist/index.html',
    'custom-dist/index.html',
    'dist-test-ssg-render/index.html',
    'tests/fixtures/router-nitro/.nitro/cache.json',
    'tests/fixtures/router-nitro/.output-node/server.js',
    'tests/fixtures/router-lit-framework/dist/index.html',
    'tests/fixtures/router-lit-framework/test-results/report.json',
    'tests/e2e/starter-smoke/work/package.json',
    'playwright-report/index.html',
    'test-results/report.json',
    'coverage/lcov.info',
    '.coverage-123/lcov.info',
    '.openElement/cache.json',
  ];
  const user = [
    'packages/element/src/index.ts',
    'packages/ui/src/generated-manifest.json',
    'apps/site/public/assets/logo.svg',
    'apps/saas/lib/stripe-checkout.ts',
    'apps/saas/local.db',
    'docs/release/public-interface-snapshot.json',
    'tests/e2e/starter-smoke/setup.ts',
    '.env',
    '.env.local',
  ];
  try {
    await writeTree(root, [...generated, ...user]);
    const removed = await cleanTargets(root, DEFAULT_TARGETS, quiet);
    assert(removed > 0);
    for (const relativePath of generated) {
      assert(
        await Deno.stat(join(root, relativePath)).then(() => false, () => true),
        `expected removed: ${relativePath}`,
      );
    }
    for (const relativePath of user) {
      assertEquals(
        await Deno.readTextFile(join(root, relativePath)),
        `${relativePath}\n`,
        `expected preserved: ${relativePath}`,
      );
    }
    assertEquals(await cleanTargets(root, DEFAULT_TARGETS, quiet), 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('clean refuses non-allowlisted targets and symlinks are unlinked, not followed', async () => {
  const root = await Deno.makeTempDir({ prefix: 'clean-test-' });
  const outside = await Deno.makeTempDir({ prefix: 'clean-outside-' });
  try {
    await writeTree(root, ['docs/keep.md', '.env']);
    await assertRejects(() => cleanTargets(root, ['docs'], quiet), Error, 'not an allowlisted');
    await Deno.writeTextFile(join(outside, 'keep.txt'), 'keep');
    await Deno.symlink(outside, join(root, 'coverage'));
    assertEquals(await cleanTargets(root, ['coverage'], quiet), 1);
    assertEquals(await Deno.readTextFile(join(outside, 'keep.txt')), 'keep');
    assertEquals(await Deno.readTextFile(join(root, '.env')), '.env\n');

    // A generated target behind a symlinked parent must not delete outside.
    await writeTree(outside, ['site-src/dist/keep.txt']);
    await Deno.mkdir(join(root, 'apps'), { recursive: true });
    await Deno.symlink(join(outside, 'site-src'), join(root, 'apps/site'));
    await assertRejects(
      () => cleanTargets(root, ['apps/site/dist'], quiet),
      Error,
      'resolves outside',
    );
    assertEquals(
      await Deno.readTextFile(join(outside, 'site-src/dist/keep.txt')),
      'site-src/dist/keep.txt\n',
    );
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});
