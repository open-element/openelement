/**
 * Drift guard for the fixture typecheck inventory (#1615).
 *
 * The scanner's pure logic is pinned on synthetic trees; the live-tree test
 * is the drift guard the issue asks for: a new application-shaped fixture
 * without a standing `typecheck` task fails here (CI runs the tools project),
 * a fixture that loses coverage fails, and a waiver that no longer matches
 * the tree fails.
 */

import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  COVERAGE_WAIVERS,
  isApplicationShaped,
  scanFixtureTypecheckCoverage,
  type DirentShape,
} from './check-fixture-typecheck-coverage.ts';

describe('application-shape detection', () => {
  const file = (name: string): DirentShape => ({
    name,
    isFile: () => true,
    isDirectory: () => false,
  });
  const dir = (name: string): DirentShape => ({
    name,
    isFile: () => false,
    isDirectory: () => true,
  });

  test('an app/, server/ or e2e/ directory marks the fixture application-shaped', () => {
    expect(isApplicationShaped([dir('app'), file('package.json')])).toBe(true);
    expect(isApplicationShaped([dir('server'), file('proof.ts')])).toBe(true);
    expect(isApplicationShaped([dir('e2e'), file('package.json')])).toBe(true);
  });

  test('top-level TypeScript drivers mark a driver-only fixture', () => {
    expect(isApplicationShaped([file('qualify.ts'), file('package.json')])).toBe(true);
    expect(isApplicationShaped([file('proof.ts')])).toBe(true);
  });

  test('a lockfile-only or config-only fixture is not application-shaped', () => {
    expect(isApplicationShaped([file('package-lock.json'), file('package.json')])).toBe(false);
    expect(isApplicationShaped([file('README.md'), file('package.json')])).toBe(false);
    expect(isApplicationShaped([file('tsconfig.json')])).toBe(false);
    expect(isApplicationShaped([dir('dist'), dir('node_modules')])).toBe(false);
  });
});

describe('coverage scanner on synthetic trees', () => {
  let root = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'oe-typecheck-coverage-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function scaffold(fixture: string, files: string[]): Promise<void> {
    for (const file of files) {
      const path = join(root, 'tests/fixtures', fixture, file);
      await mkdir(join(path, '..'), { recursive: true });
      if (file === 'package.json') {
        await writeFile(path, JSON.stringify({ name: fixture, private: true }));
      } else {
        await writeFile(path, '// fixture source\n');
      }
    }
  }

  test('a fixture app without coverage is uncovered; with the task and tsconfig it is covered', async () => {
    await scaffold('probe-a', ['app/routes/page.tsx', 'package.json']);
    await scaffold('probe-b', ['app/routes/page.tsx', 'package.json', 'tsconfig.json']);
    await writeFile(
      join(root, 'tests/fixtures/probe-b/package.json'),
      JSON.stringify({ scripts: { typecheck: 'tsc --noEmit -p tsconfig.json' } }),
    );
    const report = await scanFixtureTypecheckCoverage(root);
    expect(report.uncovered).toContain('probe-a');
    expect(report.covered).toContain('probe-b');
  });

  test('an e2e payload package without coverage is uncovered', async () => {
    await mkdir(join(root, 'tests/e2e/smoke-payload'), { recursive: true });
    await writeFile(
      join(root, 'tests/e2e/smoke-payload/smoke.spec.ts'),
      'import { test } from "@playwright/test";\n',
    );
    await writeFile(
      join(root, 'tests/e2e/smoke-payload/package.json'),
      JSON.stringify({ name: 'smoke-payload', private: true }),
    );
    const report = await scanFixtureTypecheckCoverage(root);
    expect(report.uncovered).toContain('smoke-payload');
  });
});

describe('live-tree drift guard', () => {
  /** Every application-shaped surface that must keep its standing task. */
  const EXPECTED_COVERED = [
    'router-base-path',
    'router-lit-framework',
    'router-native-framework',
    'router-nitro',
    'router-request-time',
    'router-static-only',
    'router-ui-dogfood',
    'router-unocss-probe',
    'site-light-probe',
    'starter-smoke',
    'third-party-web-components',
    'web-component-interop',
  ];

  test('every inventoried application-shaped surface carries a typecheck task', async () => {
    const repoRoot = join(import.meta.dirname!, '..', '..');
    const report = await scanFixtureTypecheckCoverage(repoRoot);
    expect(
      report.uncovered,
      'new application-shaped fixtures need a typecheck task (or a reasoned waiver)',
    ).toEqual([]);
    expect(report.staleWaivers, 'coverage waivers must match the tree').toEqual([]);
    for (const expected of EXPECTED_COVERED) {
      expect(report.covered).toContain(expected);
    }
  });

  test('every recorded waiver names a live carve-out reason', () => {
    for (const [name, waiver] of Object.entries(COVERAGE_WAIVERS)) {
      expect(waiver.directory, `${name} waiver names a directory`).toBeTruthy();
      expect(waiver.reason.length, `${name} waiver carries a reason`).toBeGreaterThan(20);
    }
  });
});
