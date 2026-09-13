// esm-boundary:scanner
import { assertEquals } from '@std/assert';
import { firstCodeLine, scanCjsSyntax, scanExportsConditions } from './check-esm-boundary.ts';

Deno.test('esm gate accepts pure ESM modules', () => {
  assertEquals(
    scanCjsSyntax([{
      path: 'packages/router/src/index.ts',
      text: `import { handler } from './x.js';\nexport const y = 1;\n`,
    }]),
    [],
  );
  assertEquals(
    scanExportsConditions([{ path: 'p/deno.json', exports: { '.': './src/index.ts' } }]),
    [],
  );
});

Deno.test('esm gate flags CJS syntax, tracked extensions, and require conditions', () => {
  const violations = scanCjsSyntax([
    { path: 'a.ts', text: `const x = require('y');\n` },
    { path: 'b.ts', text: `module.exports = {};\n` },
    { path: 'c.ts', text: `console.log(__dirname);\n` },
  ]);
  assertEquals(violations.length, 3);
  assertEquals(
    scanExportsConditions([{
      path: 'p/package.json',
      exports: { '.': { import: './a.js', require: './a.cjs' } },
    }]).length,
    1,
  );
});

Deno.test('esm gate exempts marked scanners only', () => {
  const scanner = `// esm-boundary:scanner\nconst re = /\\bmodule\\.exports\\b/;\n`;
  assertEquals(scanCjsSyntax([{ path: 'tools/check-package-artifacts.ts', text: scanner }]), []);
  assertEquals(
    firstCodeLine('#!/usr/bin/env -S deno run\n\n// esm-boundary:scanner\n'),
    '// esm-boundary:scanner',
  );
});
