import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../tests/lib/vitest-asserts.ts';
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

test('extractOpenImports finds static, type and dynamic imports', () => {
  const source = `
    import { foo } from '@openelement/element';
    import type { Bar } from '@openelement/router';
    export { Baz } from '@openelement/create';
    const x = await import('@openelement/create');
    // not an open import:
    import { y } from 'npm:react';
  `;
  const imports = extractOpenImports(source).sort();
  expect(imports).toEqual(['@openelement/create', '@openelement/element', '@openelement/router']);
});

test('extractOpenImports ignores comments and nested template text', () => {
  const source = `
    // import '@openelement/comment';
    const sample = \`text \${\`import('@openelement/string')\`}\`;
    const actual = import(\`@openelement/router/router\`);
  `;
  expect(extractOpenImports(source)).toEqual(['@openelement/router/router']);
});

test('detectCycles reports a cycle in the dependency graph', () => {
  const graph = new Map<string, string[]>([
    ['a', ['b']],
    ['b', ['c']],
    ['c', ['a']],
  ]);
  const cycles = detectCycles(graph);
  expect(cycles.length).toEqual(1);
  const cycle = cycles[0];
  expect([...new Set(cycle)].sort()).toEqual(['a', 'b', 'c']);
  expect(cycle[0]).toEqual('a');
  expect(cycle[cycle.length - 1]).toEqual('a');
});

test('detectCycles returns nothing for a DAG', () => {
  const graph = new Map<string, string[]>([
    ['a', ['b', 'c']],
    ['b', []],
    ['c', []],
  ]);
  expect(detectCycles(graph)).toEqual([]);
});

test('topologicalSort orders dependencies before dependents', () => {
  const graph = new Map<string, string[]>([
    ['app', ['element']],
    ['element', []],
    ['router', ['element']],
  ]);
  const order = topologicalSort(graph);
  const pos = (n: string) => order.indexOf(n);
  expect(pos('element') < pos('app')).toBeTruthy();
  expect(pos('element') < pos('router')).toBeTruthy();
  expect(order.length).toEqual(graph.size);
});

test('topologicalSort throws on a cycle', () => {
  const graph = new Map<string, string[]>([
    ['a', ['b']],
    ['b', ['a']],
  ]);
  assertThrowsIncludes(() => topologicalSort(graph), Error, 'cycle');
});

test('releasePublishOrder respects dependency and priority constraints', () => {
  const packages = [
    pkg('@openelement/element', '1.0.0'),
    pkg('@openelement/router', '1.0.0', ['@openelement/element']),
    pkg('@openelement/create', '1.0.0', ['@openelement/router']),
  ];
  const order = releasePublishOrder(packages).map((p) => p.name);
  const pos = (n: string) => order.indexOf(n);
  // dependencies before dependents
  expect(pos('@openelement/element') < pos('@openelement/router')).toBeTruthy();
  expect(pos('@openelement/router') < pos('@openelement/create')).toBeTruthy();
  expect(order.length).toEqual(packages.length);
});

test('normalizeInternalDep rejects non-internal specifiers', () => {
  expect(normalizeInternalDep('@openelement/element/jsx-runtime', '@openelement/router')).toEqual(
    '@openelement/element',
  );
  expect(normalizeInternalDep('@openelement/router', '@openelement/router')).toEqual(null);
  expect(normalizeInternalDep('npm:react', '@openelement/router')).toEqual(null);
  expect(normalizeInternalDep('react', '@openelement/router')).toEqual(null);
});

test('normalizeDep passes non-internal specifiers through unchanged', () => {
  expect(normalizeDep('@openelement/element/jsx-runtime', '@openelement/router')).toEqual(
    '@openelement/element',
  );
  expect(normalizeDep('@openelement/router', '@openelement/router')).toEqual(null);
  expect(normalizeDep('npm:react', '@openelement/router')).toEqual('npm:react');
  expect(normalizeDep('react', '@openelement/router')).toEqual('react');
});

test('readPackage returns null when package.json does not exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'package-graph-missing-'));
  try {
    expect(await readPackage(dir)).toEqual(null);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('readPackage fails loud on unparseable package.json (#753)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'package-graph-corrupt-'));
  try {
    await writeFile(`${dir}/package.json`, '{ not json');
    const error = await assertRejectsIncludes(() => readPackage(dir), Error);
    expect(
      error.message.includes(`${dir}/package.json`),
      `error must name the corrupt file: ${error.message}`,
    ).toBeTruthy();
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('readPackage does not report source self-imports as dependencies', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'package-graph-self-import-'));
  try {
    await mkdir(`${dir}/src`);
    await writeFile(
      `${dir}/package.json`,
      JSON.stringify({
        name: '@openelement/router',
        version: '1.0.0-alpha.1',
        exports: './src/index.ts',
      }),
    );
    await writeFile(
      `${dir}/src/index.ts`,
      ["export * from '@openelement/router/model';", "export * from '@openelement/element';"].join(
        '\n',
      ),
    );

    const info = await readPackage(dir);
    expect(info?.deps).toEqual(['@openelement/element']);
  } finally {
    await rm(dir, { recursive: true });
  }
});
