import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import {
  detectCycles,
  extractOpenImports,
  normalizeDep,
  normalizeInternalDep,
  type PackageInfo,
  readPackage,
  releasePublishOrder,
  topologicalSort,
} from './package-graph.ts';

function pkg(name: string, version: string, deps: string[] = []): PackageInfo {
  return {
    name,
    version,
    dir: `packages/${name.replace('@openelement/', '')}`,
    deps,
    exports: {},
    importKeys: new Set(),
    importValues: {},
  };
}

Deno.test('extractOpenImports finds static, type and dynamic imports', () => {
  const source = `
    import { foo } from '@openelement/element';
    import type { Bar } from '@openelement/router';
    export { Baz } from '@openelement/create';
    const x = await import('@openelement/create');
    // not an open import:
    import { y } from 'npm:react';
  `;
  const imports = extractOpenImports(source).sort();
  assertEquals(imports, [
    '@openelement/create',
    '@openelement/element',
    '@openelement/router',
  ]);
});

Deno.test('extractOpenImports ignores comments and nested template text', () => {
  const source = `
    // import '@openelement/comment';
    const sample = \`text \${\`import('@openelement/string')\`}\`;
    const actual = import(\`@openelement/router/router\`);
  `;
  assertEquals(extractOpenImports(source), ['@openelement/router/router']);
});

Deno.test('detectCycles reports a cycle in the dependency graph', () => {
  const graph = new Map<string, string[]>([
    ['a', ['b']],
    ['b', ['c']],
    ['c', ['a']],
  ]);
  const cycles = detectCycles(graph);
  assertEquals(cycles.length, 1);
  const cycle = cycles[0];
  assertEquals([...new Set(cycle)].sort(), ['a', 'b', 'c']);
  assertEquals(cycle[0], 'a');
  assertEquals(cycle[cycle.length - 1], 'a');
});

Deno.test('detectCycles returns nothing for a DAG', () => {
  const graph = new Map<string, string[]>([
    ['a', ['b', 'c']],
    ['b', []],
    ['c', []],
  ]);
  assertEquals(detectCycles(graph), []);
});

Deno.test('topologicalSort orders dependencies before dependents', () => {
  const graph = new Map<string, string[]>([
    ['app', ['element']],
    ['element', []],
    ['router', ['element']],
  ]);
  const order = topologicalSort(graph);
  const pos = (n: string) => order.indexOf(n);
  assert(pos('element') < pos('app'));
  assert(pos('element') < pos('router'));
  assertEquals(order.length, graph.size);
});

Deno.test('topologicalSort throws on a cycle', () => {
  const graph = new Map<string, string[]>([
    ['a', ['b']],
    ['b', ['a']],
  ]);
  assertThrows(() => topologicalSort(graph), Error, 'cycle');
});

Deno.test('releasePublishOrder respects dependency and priority constraints', () => {
  const packages = [
    pkg('@openelement/element', '1.0.0'),
    pkg('@openelement/router', '1.0.0', ['@openelement/element']),
    pkg('@openelement/create', '1.0.0', ['@openelement/router']),
  ];
  const order = releasePublishOrder(packages).map((p) => p.name);
  const pos = (n: string) => order.indexOf(n);
  // dependencies before dependents
  assert(pos('@openelement/element') < pos('@openelement/router'));
  assert(pos('@openelement/router') < pos('@openelement/create'));
  assertEquals(order.length, packages.length);
});

Deno.test('normalizeInternalDep rejects non-internal specifiers', () => {
  assertEquals(
    normalizeInternalDep('@openelement/element/jsx-runtime', '@openelement/router'),
    '@openelement/element',
  );
  assertEquals(normalizeInternalDep('@openelement/router', '@openelement/router'), null);
  assertEquals(normalizeInternalDep('npm:react', '@openelement/router'), null);
  assertEquals(normalizeInternalDep('react', '@openelement/router'), null);
});

Deno.test('normalizeDep passes non-internal specifiers through unchanged', () => {
  assertEquals(
    normalizeDep('@openelement/element/jsx-runtime', '@openelement/router'),
    '@openelement/element',
  );
  assertEquals(normalizeDep('@openelement/router', '@openelement/router'), null);
  assertEquals(normalizeDep('npm:react', '@openelement/router'), 'npm:react');
  assertEquals(normalizeDep('react', '@openelement/router'), 'react');
});

Deno.test('readPackage returns null when deno.json does not exist', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'package-graph-missing-' });
  try {
    assertEquals(await readPackage(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('readPackage fails loud on unparseable deno.json (#753)', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'package-graph-corrupt-' });
  try {
    await Deno.writeTextFile(`${dir}/deno.json`, '{ "name": "@openelement/x", // jsonc\n}');
    const error = await assertRejects(() => readPackage(dir), Error);
    assert(
      error.message.includes(`${dir}/deno.json`),
      `error must name the corrupt file: ${error.message}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
