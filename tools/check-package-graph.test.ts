import { assert, assertEquals } from '@std/assert';
import {
  collectWorkspaceSpecifiers,
  createVersionFailures,
  isAllowedDependencyDirection,
  packageSetFailures,
} from './check-package-graph.ts';
import { PACKAGE_VERSION } from './project-constants.ts';
import type { PackageInfo } from './lib/package-graph.ts';

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

Deno.test('package graph: subpath export keys join the package name without a stray dot', () => {
  const specifiers = collectWorkspaceSpecifiers([
    fixture('@openelement/router', { '.': './src/index.ts', './model': './src/model.ts' }),
  ]);
  assertEquals(specifiers.has('@openelement/router'), true);
  assertEquals(specifiers.has('@openelement/router/model'), true);
  assertEquals(specifiers.has('@openelement/router./model'), false);
});

Deno.test('package graph: direction rules encode the package layering', () => {
  assertEquals(isAllowedDependencyDirection('@openelement/router', '@openelement/element'), true);
  assertEquals(
    isAllowedDependencyDirection('@openelement/adapter-vite', '@openelement/router'),
    true,
  );
  assertEquals(isAllowedDependencyDirection('@openelement/element', '@openelement/router'), false);
  assertEquals(isAllowedDependencyDirection('@openelement/create', '@openelement/element'), false);
});

Deno.test('package surface: retained set is accepted regardless of order', () => {
  assertEquals(packageSetFailures(['b', 'a'], ['a', 'b']), []);
});

Deno.test('package surface: missing and unowned packages are reported', () => {
  assertEquals(packageSetFailures(['element', 'ui'], ['element', 'app']), [
    'missing retained package: app',
    'unowned workspace package: ui',
  ]);
});

Deno.test('package configs: embedded create CLI version matches the package line', () => {
  assertEquals(
    createVersionFailures(`export const CREATE_VERSION = '${PACKAGE_VERSION}';\n`),
    [],
  );
});

Deno.test('package configs: drifted create CLI version is rejected', () => {
  const failures = createVersionFailures("export const CREATE_VERSION = '0.0.0-alpha.0';\n");
  assertEquals(failures.length, 1);
  assert(failures[0].includes('does not match'));
  assert(failures[0].includes(PACKAGE_VERSION));
});

Deno.test('package configs: missing CREATE_VERSION anchor is rejected', () => {
  const failures = createVersionFailures('export const SOMETHING_ELSE = 1;\n');
  assertEquals(failures.length, 1);
  assert(failures[0].includes('CREATE_VERSION anchor missing'));
});

Deno.test('package configs: real repo create version source is in sync with release state', () => {
  // main() runs this against disk; asserting it here keeps the embedded CLI
  // version honest when a bump forgets packages/create/src/version.ts (#713).
  assertEquals(createVersionFailures(Deno.readTextFileSync('packages/create/src/version.ts')), []);
});
