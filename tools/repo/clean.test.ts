import { expect, test } from 'vitest';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../tests/lib/vitest-asserts.ts';
import { dirname, join } from 'node:path';
import {
  assertSafeTarget,
  cleanTargets,
  DEEP_TARGETS,
  DEFAULT_TARGETS,
  parseCleanArgs,
} from './clean.ts';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const quiet = { log: () => {} };

async function writeTree(root: string, paths: readonly string[]): Promise<void> {
  for (const relativePath of paths) {
    const absolute = join(root, relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, `${relativePath}\n`);
  }
}

test('clean refuses absolute, home, escaping and broad targets', () => {
  for (const bad of [
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
  ]) {
    assertThrowsIncludes(() => assertSafeTarget(bad), Error, 'clean:', bad);
  }
});

test('clean CLI only accepts allowlisted generated patterns', () => {
  assertThrowsIncludes(() => parseCleanArgs(['docs']), Error, 'not an allowlisted');
  assertThrowsIncludes(() => parseCleanArgs(['README.md']), Error, 'not an allowlisted');
  assertThrowsIncludes(() => parseCleanArgs(['.env']), Error, 'not an allowlisted');
  assertThrowsIncludes(() => parseCleanArgs(['www/app']), Error, 'not an allowlisted');
  assertThrowsIncludes(() => parseCleanArgs(['--nuke']), Error, 'unknown flag');
  expect(parseCleanArgs(['packages/*/dist']).targets).toEqual(['packages/*/dist']);
});

test('clean defaults stay separate from opt-in deep targets', () => {
  expect(parseCleanArgs([]).targets).toEqual(DEFAULT_TARGETS);
  expect(parseCleanArgs([]).deep).toEqual(false);
  expect(parseCleanArgs(['--deep']).deep).toEqual(true);
  expect(parseCleanArgs(['--deep']).targets).toEqual([...DEFAULT_TARGETS, ...DEEP_TARGETS]);
  expect(DEEP_TARGETS.every((target) => !DEFAULT_TARGETS.includes(target))).toBeTruthy();
  // The root dependency tree is opt-in deep clean only.
  expect(DEEP_TARGETS.includes('node_modules')).toBeTruthy();
  expect(!DEFAULT_TARGETS.includes('node_modules')).toBeTruthy();
  // Site E2E output is regenerable and safe by default.
  for (const target of [
    'www/e2e/test-results',
    'www/e2e/playwright-report',
    'www/playwright-report',
  ]) {
    expect(
      DEFAULT_TARGETS.includes(target),
      `${target} must be a default clean target`,
    ).toBeTruthy();
  }
});

test('default clean removes generated output and preserves user content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clean-test-'));
  const generated = [
    'packages/element/dist/index.js',
    'packages/router/dist/index.js',
    'packages/router/dist-test-ssg-render/index.html',
    'packages/router/custom-dist/index.js',
    'packages/ui/dist/index.js',
    'www/dist/index.html',
    'www/.openElement/cache.json',
    'www/e2e/test-results/report.json',
    'www/e2e/playwright-report/index.html',
    'www/playwright-report/index.html',
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
    'www/public/assets/logo.svg',
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
    expect(removed > 0).toBeTruthy();
    for (const relativePath of generated) {
      expect(
        await stat(join(root, relativePath)).then(
          () => false,
          () => true,
        ),
        `expected removed: ${relativePath}`,
      ).toBeTruthy();
    }
    for (const relativePath of user) {
      expect(
        await readFile(join(root, relativePath), 'utf8'),
        `expected preserved: ${relativePath}`,
      ).toEqual(`${relativePath}\n`);
    }
    expect(await cleanTargets(root, DEFAULT_TARGETS, quiet)).toEqual(0);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('clean refuses non-allowlisted targets and symlinks are unlinked, not followed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clean-test-'));
  const outside = await mkdtemp(join(tmpdir(), 'clean-outside-'));
  try {
    await writeTree(root, ['docs/keep.md', '.env']);
    await assertRejectsIncludes(
      () => cleanTargets(root, ['docs'], quiet),
      Error,
      'not an allowlisted',
    );
    await writeFile(join(outside, 'keep.txt'), 'keep');
    await symlink(outside, join(root, 'coverage'));
    expect(await cleanTargets(root, ['coverage'], quiet)).toEqual(1);
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toEqual('keep');
    expect(await readFile(join(root, '.env'), 'utf8')).toEqual('.env\n');

    // A generated target behind a symlinked parent must not delete outside.
    await writeTree(outside, ['site-src/dist/keep.txt']);
    await mkdir(join(root, 'apps'), { recursive: true });
    await symlink(join(outside, 'site-src'), join(root, 'www'));
    await assertRejectsIncludes(
      () => cleanTargets(root, ['www/dist'], quiet),
      Error,
      'resolves outside',
    );
    expect(await readFile(join(outside, 'site-src/dist/keep.txt'), 'utf8')).toEqual(
      'site-src/dist/keep.txt\n',
    );
  } finally {
    await rm(root, { recursive: true });
    await rm(outside, { recursive: true });
  }
});
