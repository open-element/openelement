import { expect, test } from 'vitest';
import { join } from '@std/path';
import {
  addUncoveredFiles,
  countCoverableElements,
  enumerateCoverageFiles,
  isCoverageTreeExcluded,
  isPackageSource,
  isProductionPackageSource,
  isToolsLibSource,
  lcovFilePaths,
  normalizeLcovSourcePaths,
  parseLcov,
} from './coverage-summary.ts';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const SAMPLE = [
  'SF:/packages/element/src/foo.ts',
  'DA:1,1',
  'DA:2,0',
  'end_of_record',
  'SF:/tools/lib/bar.ts',
  'DA:1,1',
  'end_of_record',
  'SF:/packages/element/src/__tests__/foo.test.ts',
  'DA:1,1',
  'end_of_record',
].join('\n');

test('scope predicates classify package and tools/lib sources', () => {
  expect(isPackageSource('/packages/element/src/foo.ts')).toEqual(true);
  expect(isPackageSource('/tools/lib/bar.ts')).toEqual(false);
  expect(isToolsLibSource('/tools/lib/bar.ts')).toEqual(true);
  expect(isToolsLibSource('/packages/element/src/foo.ts')).toEqual(false);
  expect(isProductionPackageSource('/packages/element/src/foo.ts')).toEqual(true);
  expect(isProductionPackageSource('/tools/lib/bar.ts')).toEqual(true);
});

test('parseLcov scopes packages and tools/lib separately', () => {
  const packages = parseLcov(SAMPLE, isPackageSource);
  expect(packages.lines).toEqual({ covered: 1, total: 2, percentage: 50 });

  const tools = parseLcov(SAMPLE, isToolsLibSource);
  expect(tools.lines).toEqual({ covered: 1, total: 1, percentage: 100 });
});

test('parseLcov excludes __tests__ files from the default scope', () => {
  const summary = parseLcov(SAMPLE);
  expect(summary.lines).toEqual({ covered: 2, total: 3, percentage: (2 / 3) * 100 });
});

test('isCoverageTreeExcluded drops tests, fixtures, generated, and declarations', () => {
  expect(isCoverageTreeExcluded('/repo/packages/element/src/foo.ts')).toEqual(false);
  expect(isCoverageTreeExcluded('/repo/packages/element/src/__tests__/foo.test.ts')).toEqual(true);
  expect(isCoverageTreeExcluded('/repo/tools/lib/package-graph.test.ts')).toEqual(true);
  expect(isCoverageTreeExcluded('/repo/tools/lib/foo.spec.ts')).toEqual(true);
  expect(isCoverageTreeExcluded('/repo/fixtures/router-request-time/app.ts')).toEqual(true);
  expect(
    isCoverageTreeExcluded('/repo/third-party component package/src/generated-manifest.ts'),
  ).toEqual(true);
  expect(isCoverageTreeExcluded('/repo/packages/element/src/jsx-types.d.ts')).toEqual(true);
});

test('lcovFilePaths collects every SF entry', () => {
  const paths = lcovFilePaths(SAMPLE);
  expect(paths.size).toEqual(3);
  expect(paths.has('/packages/element/src/foo.ts')).toBeTruthy();
});

test('countCoverableElements counts runtime constructs, not type-only code', () => {
  const counts = countCoverableElements(
    [
      'import type { X } from "./types.ts";',
      'import { y } from "./y.ts";',
      'export interface Foo { a: number }',
      'export type Bar = string;',
      'export function f(x: number): number {',
      '  if (x > 0) return 1;',
      '  return x > -1 && y ? 0 : -1;',
      '}',
      'export const g = (x: number) => x ?? 0;',
    ].join('\n'),
  );
  // Runtime lines: import y, function f, if, return ternary, arrow const.
  expect(counts.lines).toEqual(5);
  // f and the arrow function.
  expect(counts.functions).toEqual(2);
  // if (2) + && (2) + ternary (2) + ?? (2).
  expect(counts.branches).toEqual(8);
});

test('countCoverableElements ignores declare statements and ambient modules', () => {
  const counts = countCoverableElements(
    ['declare const x: number;', 'declare module "m" { const y: string; }'].join('\n'),
  );
  expect(counts).toEqual({ lines: 0, branches: 0, functions: 0 });
});

test('addUncoveredFiles folds never-loaded files in at 0%', () => {
  const base = parseLcov(SAMPLE, isPackageSource);
  const full = addUncoveredFiles(base, [{ lines: 2, branches: 4, functions: 1 }]);
  expect(full.lines).toEqual({ covered: 1, total: 4, percentage: 25 });
  expect(full.branches.covered).toEqual(0);
  expect(full.branches.total).toEqual(4);
  expect(full.functions.total).toEqual(1);
});

test('enumerateCoverageFiles finds in-scope sources and skips excluded trees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opx-test-'));
  try {
    const files = [
      'packages/element/src/foo.ts',
      'packages/element/src/__tests__/foo.test.ts',
      'packages/element/src/generated-x.ts',
      'packages/element/src/types.d.ts',
      'packages/router/src/bar.test.ts',
      'packages/router/src/bar.ts',
      'fixtures/router-native-framework/app/main.ts',
      'node_modules/pkg/src/dep.ts',
    ];
    for (const file of files) {
      const path = `${root}/${file}`;
      await mkdir(path.substring(0, path.lastIndexOf('/')), { recursive: true });
      await writeFile(path, 'export {};\n');
    }
    const found = await enumerateCoverageFiles(root, isPackageSource);
    expect(found.map((path) => path.slice(root.length + 1))).toEqual([
      'packages/element/src/foo.ts',
      'packages/router/src/bar.ts',
    ]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('full denominator: fake LCOV plus fake tree yields 0%-weighted summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opx-test-'));
  try {
    const coveredPath = `${root}/packages/element/src/covered.ts`;
    const missedPath = `${root}/packages/element/src/missed.ts`;
    await mkdir(`${root}/packages/element/src`, { recursive: true });
    await writeFile(coveredPath, 'export const a = 1;\n');
    await writeFile(
      missedPath,
      'export function missed(x: number): number {\n  if (x) return 1;\n  return 0;\n}\n',
    );
    const lcov = [`SF:${coveredPath}`, 'DA:1,1', 'end_of_record'].join('\n');

    const profiled = lcovFilePaths(lcov);
    const uncovered = [];
    const files = await enumerateCoverageFiles(root, isPackageSource);
    for (const path of files) {
      if (!profiled.has(path)) {
        uncovered.push(countCoverableElements(await readFile(path, 'utf8'), path));
      }
    }
    const summary = addUncoveredFiles(parseLcov(lcov, isPackageSource), uncovered);
    // covered.ts: 1/1 line. missed.ts adds 3 uncovered lines, 1 function, 2 branches.
    expect(summary.lines).toEqual({ covered: 1, total: 4, percentage: 25 });
    expect(summary.functions).toEqual({ covered: 0, total: 1, percentage: 0 });
    expect(summary.branches).toEqual({ covered: 0, total: 2, percentage: 0 });
  } finally {
    await rm(root, { recursive: true });
  }
});

test('normalizeLcovSourcePaths resolves relative SF lines and keeps absolute ones', () => {
  const root = '/repo';
  const lcov = [
    'TN:',
    'SF:packages/element/src/relative.ts',
    'DA:1,1',
    'end_of_record',
    'SF:/repo/packages/element/src/absolute.ts',
    'DA:1,1',
    'end_of_record',
    'SF:https://unrelated-host/thing.ts',
    'end_of_record',
  ].join('\n');
  const normalized = normalizeLcovSourcePaths(lcov, root);
  const sfLines = normalized.split('\n').filter((line) => line.startsWith('SF:'));
  expect(sfLines).toEqual([
    'SF:/repo/packages/element/src/relative.ts',
    'SF:/repo/packages/element/src/absolute.ts',
    'SF:https://unrelated-host/thing.ts',
  ]);
});
