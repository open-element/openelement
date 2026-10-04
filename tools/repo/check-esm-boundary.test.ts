// esm-boundary:scanner
import { expect, test } from 'vitest';
import { firstCodeLine, scanCjsSyntax, scanExportsConditions } from './check-esm-boundary.ts';

test('esm gate accepts pure ESM modules', () => {
  expect(
    scanCjsSyntax([
      {
        path: 'packages/router/src/index.ts',
        text: `import { handler } from './x.js';\nexport const y = 1;\n`,
      },
    ]),
  ).toEqual([]);
  expect(
    scanExportsConditions([{ path: 'p/package.json', exports: { '.': './src/index.ts' } }]),
  ).toEqual([]);
});

test('esm gate flags CJS syntax, tracked extensions, and require conditions', () => {
  const violations = scanCjsSyntax([
    { path: 'a.ts', text: `const x = require('y');\n` },
    { path: 'b.ts', text: `module.exports = {};\n` },
    { path: 'c.ts', text: `console.log(__dirname);\n` },
  ]);
  expect(violations.length).toEqual(3);
  expect(
    scanExportsConditions([
      {
        path: 'p/package.json',
        exports: { '.': { import: './a.js', require: './a.cjs' } },
      },
    ]).length,
  ).toEqual(1);
});

test('esm gate exempts marked scanners only', () => {
  const scanner = `// esm-boundary:scanner\nconst re = /\\bmodule\\.exports\\b/;\n`;
  expect(scanCjsSyntax([{ path: 'tools/check-package-artifacts.ts', text: scanner }])).toEqual([]);
  expect(firstCodeLine('#!/usr/bin/env -S deno run\n\n// esm-boundary:scanner\n')).toEqual(
    '// esm-boundary:scanner',
  );
});
