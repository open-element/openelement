import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  buildDeclarationClosure,
  declarationCandidates,
  type DeclarationIo,
  packageRootDeclarationIo,
} from './declaration-closure.ts';

function io(files: Record<string, string>): DeclarationIo {
  return {
    exists: (path) => Object.prototype.hasOwnProperty.call(files, path),
    read: (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`missing fixture file ${path}`);
      return content;
    },
  };
}

function graphOf(files: Record<string, string>, roots: string[]) {
  return buildDeclarationClosure(roots, io(files));
}

test('declaration closure: a lone public export reaches itself', () => {
  const graph = graphOf(
    {
      'src/index.d.ts': 'export declare const entry: true;\n',
    },
    ['src/index.d.ts'],
  );
  expect(graph.reached).toEqual(['src/index.d.ts']);
});

test('declaration closure: a missing declaration behind a public .d.ts fails', () => {
  const graph = graphOf(
    {
      'src/index.d.ts':
        "import type { Helper } from './internal/helper.js';\nexport declare const x: Helper;\n",
    },
    ['src/index.d.ts'],
  );
  expect(graph.reached).toEqual(['src/index.d.ts']);
  expect(graph.missing).toEqual([{ from: 'src/index.d.ts', specifier: './internal/helper.js' }]);
  expect(graph.escaped).toEqual([]);
});

test('declaration closure: two and three level indirect references are reached', () => {
  const files = {
    'src/index.d.ts': "export { B } from './b.js';\n",
    'src/b.d.ts': "export type { C } from './internal/c';\n",
    'src/internal/c.d.ts': 'export type C = true;\n',
  };
  const graph = graphOf(files, ['src/index.d.ts']);
  expect(graph.missing).toEqual([]);
  expect(graph.reached).toEqual(['src/b.d.ts', 'src/index.d.ts', 'src/internal/c.d.ts']);
});

test('declaration closure: import("...") type references are followed', () => {
  const graph = graphOf(
    {
      'src/index.d.ts': "export declare const x: import('./types.js').Shape;\n",
      'src/types.d.ts': 'export interface Shape { id: string }\n',
    },
    ['src/index.d.ts'],
  );
  expect(graph.reached).toEqual(['src/index.d.ts', 'src/types.d.ts']);
  expect(graph.missing).toEqual([]);
});

test('declaration closure: triple-slash path references are followed', () => {
  const graph = graphOf(
    {
      'src/index.d.ts': '/// <reference path="./globals.d.ts" />\nexport {};\n',
      'src/globals.d.ts': 'declare global { interface Window { x: true } }\nexport {};\n',
    },
    ['src/index.d.ts'],
  );
  expect(graph.reached).toEqual(['src/globals.d.ts', 'src/index.d.ts']);
});

test('declaration closure: cycles terminate and keep every member', () => {
  const graph = graphOf(
    {
      'src/index.d.ts': "export * from './a.js';\n",
      'src/a.d.ts': "export * from './b.js';\n",
      'src/b.d.ts': "export * from './a.js';\nexport {};\n",
    },
    ['src/index.d.ts'],
  );
  expect(graph.reached).toEqual(['src/a.d.ts', 'src/b.d.ts', 'src/index.d.ts']);
  expect(graph.missing).toEqual([]);
});

test('declaration closure: extensionless and extension fallbacks resolve deterministically', () => {
  expect(declarationCandidates('src/x.js')).toEqual([
    'src/x.d.ts',
    'src/x.d.mts',
    'src/x.d.cts',
    'src/x/index.d.ts',
    'src/x/index.d.mts',
    'src/x/index.d.cts',
  ]);
  const direct = graphOf(
    {
      'src/index.d.ts': "export * from './x';\n",
      'src/x.d.ts': 'export {};\n',
      'src/x/index.d.ts': 'export {};\n',
    },
    ['src/index.d.ts'],
  );
  expect(direct.reached.includes('src/x.d.ts')).toBeTruthy();
  expect(
    !direct.reached.includes('src/x/index.d.ts'),
    '.d.ts beats index when both exist',
  ).toBeTruthy();

  const indexOnly = graphOf(
    {
      'src/index.d.ts': "export * from './y';\n",
      'src/y/index.d.ts': 'export {};\n',
    },
    ['src/index.d.ts'],
  );
  expect(indexOnly.reached).toEqual(['src/index.d.ts', 'src/y/index.d.ts']);

  const ecmaFallback = graphOf(
    {
      'src/index.d.ts': "export * from './z.mjs';\n",
      'src/z.d.mts': 'export {};\n',
    },
    ['src/index.d.ts'],
  );
  expect(ecmaFallback.reached).toEqual(['src/index.d.ts', 'src/z.d.mts']);
});

test('declaration closure: path escapes fail closed', () => {
  const graph = graphOf(
    {
      'src/index.d.ts': "export * from '../../outside.d.ts';\n",
    },
    ['src/index.d.ts'],
  );
  expect(graph.reached).toEqual(['src/index.d.ts']);
  expect(graph.escaped.length).toEqual(1);
  expect(graph.missing).toEqual([]);
});

test('declaration closure: bare npm jsr and node specifiers are external', () => {
  const graph = graphOf(
    {
      'src/index.d.ts':
        "import type { T } from 'npm:typescript@6';\n" +
        "export type { A } from 'jsr:@std/assert';\n" +
        "export type { B } from 'preact';\n" +
        "import type { C } from 'node:buffer';\n" +
        "import type { D } from 'https://esm.sh/thing';\n" +
        'export declare const x: T & A & B & C & D;\n',
    },
    ['src/index.d.ts'],
  );
  expect(graph.reached).toEqual(['src/index.d.ts']);
  expect(graph.missing).toEqual([]);
  expect(graph.escaped).toEqual([]);
});

test('declaration closure: Windows separators behave like POSIX', () => {
  const graph = graphOf(
    {
      'src/index.d.ts': "export * from './internal\\\\helper.js';\n",
      'src/internal/helper.d.ts': 'export {};\n',
    },
    ['src\\index.d.ts'],
  );
  expect(graph.reached).toEqual(['src/index.d.ts', 'src/internal/helper.d.ts']);
  expect(graph.missing).toEqual([]);
  const escaped = graphOf(
    {
      'src/index.d.ts': "export * from '..\\\\..\\\\outside.js';\n",
    },
    ['src/index.d.ts'],
  );
  expect(escaped.escaped.length).toEqual(1);
});

test('packageRootDeclarationIo reads a real extracted tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'declaration-closure-'));
  try {
    await mkdir(`${root}/src`);
    await writeFile(`${root}/src/index.d.ts`, 'export {};\n');
    const files = packageRootDeclarationIo(root);
    expect(files.exists('src/index.d.ts')).toEqual(true);
    expect(files.exists('src/missing.d.ts')).toEqual(false);
    expect(files.read('src/index.d.ts')).toEqual('export {};\n');
  } finally {
    await rm(root, { recursive: true });
  }
});
