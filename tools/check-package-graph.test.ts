import { assertEquals } from '@std/assert';
import { collectWorkspaceSpecifiers } from './check-package-graph.ts';
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
