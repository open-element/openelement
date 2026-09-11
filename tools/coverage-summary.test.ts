import { assert, assertEquals } from '@std/assert';
import {
  addUncoveredFiles,
  countCoverableElements,
  enumerateCoverageFiles,
  isCoverageTreeExcluded,
  isPackageSource,
  isProductionPackageSource,
  isToolsLibSource,
  lcovFilePaths,
  parseLcov,
} from './coverage-summary.ts';

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

Deno.test('scope predicates classify package and tools/lib sources', () => {
  assertEquals(isPackageSource('/packages/element/src/foo.ts'), true);
  assertEquals(isPackageSource('/tools/lib/bar.ts'), false);
  assertEquals(isToolsLibSource('/tools/lib/bar.ts'), true);
  assertEquals(isToolsLibSource('/packages/element/src/foo.ts'), false);
  assertEquals(isProductionPackageSource('/packages/element/src/foo.ts'), true);
  assertEquals(isProductionPackageSource('/tools/lib/bar.ts'), true);
});

Deno.test('parseLcov scopes packages and tools/lib separately', () => {
  const packages = parseLcov(SAMPLE, isPackageSource);
  assertEquals(packages.lines, { covered: 1, total: 2, percentage: 50 });

  const tools = parseLcov(SAMPLE, isToolsLibSource);
  assertEquals(tools.lines, { covered: 1, total: 1, percentage: 100 });
});

Deno.test('parseLcov excludes __tests__ files from the default scope', () => {
  const summary = parseLcov(SAMPLE);
  assertEquals(summary.lines, { covered: 2, total: 3, percentage: (2 / 3) * 100 });
});

Deno.test('isCoverageTreeExcluded drops tests, fixtures, generated, and declarations', () => {
  assertEquals(isCoverageTreeExcluded('/repo/packages/element/src/foo.ts'), false);
  assertEquals(isCoverageTreeExcluded('/repo/packages/element/src/__tests__/foo.test.ts'), true);
  assertEquals(isCoverageTreeExcluded('/repo/tools/lib/package-graph.test.ts'), true);
  assertEquals(isCoverageTreeExcluded('/repo/tools/lib/foo.spec.ts'), true);
  assertEquals(isCoverageTreeExcluded('/repo/fixtures/router-request-time/app.ts'), true);
  assertEquals(
    isCoverageTreeExcluded('/repo/third-party component package/src/generated-manifest.ts'),
    true,
  );
  assertEquals(isCoverageTreeExcluded('/repo/packages/element/src/jsx-types.d.ts'), true);
});

Deno.test('lcovFilePaths collects every SF entry', () => {
  const paths = lcovFilePaths(SAMPLE);
  assertEquals(paths.size, 3);
  assert(paths.has('/packages/element/src/foo.ts'));
});

Deno.test('countCoverableElements counts runtime constructs, not type-only code', () => {
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
  assertEquals(counts.lines, 5);
  // f and the arrow function.
  assertEquals(counts.functions, 2);
  // if (2) + && (2) + ternary (2) + ?? (2).
  assertEquals(counts.branches, 8);
});

Deno.test('countCoverableElements ignores declare statements and ambient modules', () => {
  const counts = countCoverableElements(
    ['declare const x: number;', 'declare module "m" { const y: string; }'].join('\n'),
  );
  assertEquals(counts, { lines: 0, branches: 0, functions: 0 });
});

Deno.test('addUncoveredFiles folds never-loaded files in at 0%', () => {
  const base = parseLcov(SAMPLE, isPackageSource);
  const full = addUncoveredFiles(base, [{ lines: 2, branches: 4, functions: 1 }]);
  assertEquals(full.lines, { covered: 1, total: 4, percentage: 25 });
  assertEquals(full.branches.covered, 0);
  assertEquals(full.branches.total, 4);
  assertEquals(full.functions.total, 1);
});

Deno.test('enumerateCoverageFiles finds in-scope sources and skips excluded trees', async () => {
  const root = await Deno.makeTempDir();
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
      await Deno.mkdir(path.substring(0, path.lastIndexOf('/')), { recursive: true });
      await Deno.writeTextFile(path, 'export {};\n');
    }
    const found = await enumerateCoverageFiles(root, isPackageSource);
    assertEquals(
      found.map((path) => path.slice(root.length + 1)),
      ['packages/element/src/foo.ts', 'packages/router/src/bar.ts'],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('full denominator: fake LCOV plus fake tree yields 0%-weighted summary', async () => {
  const root = await Deno.makeTempDir();
  try {
    const coveredPath = `${root}/packages/element/src/covered.ts`;
    const missedPath = `${root}/packages/element/src/missed.ts`;
    await Deno.mkdir(`${root}/packages/element/src`, { recursive: true });
    await Deno.writeTextFile(coveredPath, 'export const a = 1;\n');
    await Deno.writeTextFile(
      missedPath,
      'export function missed(x: number): number {\n  if (x) return 1;\n  return 0;\n}\n',
    );
    const lcov = [
      `SF:${coveredPath}`,
      'DA:1,1',
      'end_of_record',
    ].join('\n');

    const profiled = lcovFilePaths(lcov);
    const uncovered = [];
    const files = await enumerateCoverageFiles(root, isPackageSource);
    for (const path of files) {
      if (!profiled.has(path)) {
        uncovered.push(countCoverableElements(await Deno.readTextFile(path), path));
      }
    }
    const summary = addUncoveredFiles(parseLcov(lcov, isPackageSource), uncovered);
    // covered.ts: 1/1 line. missed.ts adds 3 uncovered lines, 1 function, 2 branches.
    assertEquals(summary.lines, { covered: 1, total: 4, percentage: 25 });
    assertEquals(summary.functions, { covered: 0, total: 1, percentage: 0 });
    assertEquals(summary.branches, { covered: 0, total: 2, percentage: 0 });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
