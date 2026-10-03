import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  collectWorkspaceSpecifiers,
  createVersionFailures,
  isAllowedDependencyDirection,
  packageSetFailures,
} from './check-package-graph.ts';
import { PACKAGE_VERSION } from '../repo/project-constants.ts';
import type { PackageInfo } from '../lib/package-graph.ts';

function fixture(name: string, exports: unknown): PackageInfo {
  return {
    name,
    version: '0.43.0-alpha.1',
    dir: `packages/${name.split('/')[1]}`,
    deps: [],
    exports,
    importKeys: new Set(),
    importValues: {},
  };
}

test('package graph: subpath export keys join the package name without a stray dot', () => {
  const specifiers = collectWorkspaceSpecifiers([
    fixture('@openelement/router', { '.': './src/index.ts', './model': './src/model.ts' }),
  ]);
  expect(specifiers.has('@openelement/router')).toEqual(true);
  expect(specifiers.has('@openelement/router/model')).toEqual(true);
  expect(specifiers.has('@openelement/router./model')).toEqual(false);
});

test('package graph: direction rules encode the package layering', () => {
  expect(isAllowedDependencyDirection('@openelement/router', '@openelement/element')).toEqual(true);
  expect(isAllowedDependencyDirection('@openelement/element', '@openelement/router')).toEqual(
    false,
  );
  expect(isAllowedDependencyDirection('@openelement/create', '@openelement/element')).toEqual(
    false,
  );
});

test('package surface: retained set is accepted regardless of order', () => {
  expect(packageSetFailures(['b', 'a'], ['a', 'b'])).toEqual([]);
});

test('package surface: missing and unowned packages are reported', () => {
  expect(packageSetFailures(['element', 'ui'], ['element', 'app'])).toEqual([
    'missing retained package: app',
    'unowned workspace package: ui',
  ]);
});

test('package configs: embedded create CLI version matches the package line', () => {
  expect(createVersionFailures(`export const CREATE_VERSION = '${PACKAGE_VERSION}';\n`)).toEqual(
    [],
  );
});

test('package configs: drifted create CLI version is rejected', () => {
  const failures = createVersionFailures("export const CREATE_VERSION = '0.0.0-alpha.0';\n");
  expect(failures.length).toEqual(1);
  expect(failures[0].includes('does not match')).toBeTruthy();
  expect(failures[0].includes(PACKAGE_VERSION)).toBeTruthy();
});

test('package configs: missing CREATE_VERSION anchor is rejected', () => {
  const failures = createVersionFailures('export const SOMETHING_ELSE = 1;\n');
  expect(failures.length).toEqual(1);
  expect(failures[0].includes('CREATE_VERSION anchor missing')).toBeTruthy();
});

test('package configs: real repo create version source is in sync with release state', () => {
  // main() runs this against disk; asserting it here keeps the embedded CLI
  // version honest when a bump forgets packages/create/src/version.ts (#713).
  expect(createVersionFailures(readFileSync('packages/create/src/version.ts', 'utf8'))).toEqual([]);
});
