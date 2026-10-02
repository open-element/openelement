import { assert, assertEquals } from '@std/assert';
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

Deno.test('declaration closure: a lone public export reaches itself', () => {
  const graph = graphOf(
    {
      'src/index.d.ts': 'export declare const entry: true;\n',
    },
    ['src/index.d.ts'],
  );
  assertEquals(graph.reached, ['src/index.d.ts']);
});

Deno.test('declaration closure: a missing declaration behind a public .d.ts fails', () => {
  const graph = graphOf(
    {
      'src/index.d.ts':
        "import type { Helper } from './internal/helper.js';\nexport declare const x: Helper;\n",
    },
    ['src/index.d.ts'],
  );
  assertEquals(graph.reached, ['src/index.d.ts']);
  assertEquals(graph.missing, [{ from: 'src/index.d.ts', specifier: './internal/helper.js' }]);
  assertEquals(graph.escaped, []);
});

Deno.test('declaration closure: two and three level indirect references are reached', () => {
  const files = {
    'src/index.d.ts': "export { B } from './b.js';\n",
    'src/b.d.ts': "export type { C } from './internal/c';\n",
    'src/internal/c.d.ts': 'export type C = true;\n',
  };
  const graph = graphOf(files, ['src/index.d.ts']);
  assertEquals(graph.missing, []);
  assertEquals(graph.reached, ['src/b.d.ts', 'src/index.d.ts', 'src/internal/c.d.ts']);
});

Deno.test('declaration closure: import("...") type references are followed', () => {
  const graph = graphOf(
    {
      'src/index.d.ts': "export declare const x: import('./types.js').Shape;\n",
      'src/types.d.ts': 'export interface Shape { id: string }\n',
    },
    ['src/index.d.ts'],
  );
  assertEquals(graph.reached, ['src/index.d.ts', 'src/types.d.ts']);
  assertEquals(graph.missing, []);
});

Deno.test('declaration closure: triple-slash path references are followed', () => {
  const graph = graphOf(
    {
      'src/index.d.ts': '/// <reference path="./globals.d.ts" />\nexport {};\n',
      'src/globals.d.ts': 'declare global { interface Window { x: true } }\nexport {};\n',
    },
    ['src/index.d.ts'],
  );
  assertEquals(graph.reached, ['src/globals.d.ts', 'src/index.d.ts']);
});

Deno.test('declaration closure: cycles terminate and keep every member', () => {
  const graph = graphOf(
    {
      'src/index.d.ts': "export * from './a.js';\n",
      'src/a.d.ts': "export * from './b.js';\n",
      'src/b.d.ts': "export * from './a.js';\nexport {};\n",
    },
    ['src/index.d.ts'],
  );
  assertEquals(graph.reached, ['src/a.d.ts', 'src/b.d.ts', 'src/index.d.ts']);
  assertEquals(graph.missing, []);
});

Deno.test('declaration closure: extensionless and extension fallbacks resolve deterministically', () => {
  assertEquals(declarationCandidates('src/x.js'), [
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
  assert(direct.reached.includes('src/x.d.ts'));
  assert(!direct.reached.includes('src/x/index.d.ts'), '.d.ts beats index when both exist');

  const indexOnly = graphOf(
    {
      'src/index.d.ts': "export * from './y';\n",
      'src/y/index.d.ts': 'export {};\n',
    },
    ['src/index.d.ts'],
  );
  assertEquals(indexOnly.reached, ['src/index.d.ts', 'src/y/index.d.ts']);

  const ecmaFallback = graphOf(
    {
      'src/index.d.ts': "export * from './z.mjs';\n",
      'src/z.d.mts': 'export {};\n',
    },
    ['src/index.d.ts'],
  );
  assertEquals(ecmaFallback.reached, ['src/index.d.ts', 'src/z.d.mts']);
});

Deno.test('declaration closure: path escapes fail closed', () => {
  const graph = graphOf(
    {
      'src/index.d.ts': "export * from '../../outside.d.ts';\n",
    },
    ['src/index.d.ts'],
  );
  assertEquals(graph.reached, ['src/index.d.ts']);
  assertEquals(graph.escaped.length, 1);
  assertEquals(graph.missing, []);
});

Deno.test('declaration closure: bare npm jsr and node specifiers are external', () => {
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
  assertEquals(graph.reached, ['src/index.d.ts']);
  assertEquals(graph.missing, []);
  assertEquals(graph.escaped, []);
});

Deno.test('declaration closure: Windows separators behave like POSIX', () => {
  const graph = graphOf(
    {
      'src/index.d.ts': "export * from './internal\\\\helper.js';\n",
      'src/internal/helper.d.ts': 'export {};\n',
    },
    ['src\\index.d.ts'],
  );
  assertEquals(graph.reached, ['src/index.d.ts', 'src/internal/helper.d.ts']);
  assertEquals(graph.missing, []);
  const escaped = graphOf(
    {
      'src/index.d.ts': "export * from '..\\\\..\\\\outside.js';\n",
    },
    ['src/index.d.ts'],
  );
  assertEquals(escaped.escaped.length, 1);
});

Deno.test('packageRootDeclarationIo reads a real extracted tree', async () => {
  const root = await Deno.makeTempDir({ prefix: 'declaration-closure-' });
  try {
    await Deno.mkdir(`${root}/src`);
    await Deno.writeTextFile(`${root}/src/index.d.ts`, 'export {};\n');
    const files = packageRootDeclarationIo(root);
    assertEquals(files.exists('src/index.d.ts'), true);
    assertEquals(files.exists('src/missing.d.ts'), false);
    assertEquals(files.read('src/index.d.ts'), 'export {};\n');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
