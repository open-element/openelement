import { assertEquals, assertFalse, assertStringIncludes } from '@std/assert';
import { scanDenoApiSource } from './check-deno-api-free.ts';
import { isAllowedDependencyDirection } from './check-package-graph.ts';
import { findSignalBoundaryImports } from './check-signal-protocol-boundary.ts';

Deno.test('deno-api-free uses syntax nodes for node imports and Deno access', () => {
  const issues = scanDenoApiSource(
    'fixture.ts',
    `
    import fs from \`node:fs\`;
    Deno.readTextFile('x');
    Deno['writeTextFile']('x', 'y');
    const harmless = "Deno.remove('not code')";
  `,
  );
  assertEquals(issues.length, 3);
  assertStringIncludes(issues.join('\n'), 'node import');
  assertStringIncludes(issues.join('\n'), 'Deno API');
});

Deno.test('deno-api-free catches globalThis.Deno, destructuring, aliases, and npm specifiers', () => {
  const issues = scanDenoApiSource(
    'fixture.ts',
    `
    globalThis.Deno.env.get('X');
    const { readTextFile } = Deno;
    const D = Deno;
    D.mkdir('x');
    import pad from 'npm:left-pad@1.0.0';
    import { signal } from 'npm:@preact/signals-core@1.12.1';
  `,
  );
  // env.get, destructured readTextFile, aliased mkdir, and the npm: import;
  // @preact/signals-core is the chartered exception.
  assertEquals(issues.length, 4);
  const text = issues.join('\n');
  assertStringIncludes(text, 'Deno.env');
  assertStringIncludes(text, 'Deno.readTextFile');
  assertStringIncludes(text, 'Deno.mkdir');
  assertStringIncludes(text, 'npm import: npm:left-pad@1.0.0');
  assertFalse(text.includes('signals-core'));
});

Deno.test('package graph direction rules encode the package layering', () => {
  assertEquals(isAllowedDependencyDirection('@openelement/app', '@openelement/element'), true);
  assertEquals(isAllowedDependencyDirection('@openelement/adapter-vite', '@openelement/app'), true);
  assertEquals(isAllowedDependencyDirection('@openelement/element', '@openelement/app'), false);
  assertEquals(isAllowedDependencyDirection('@openelement/create', '@openelement/element'), false);
});

Deno.test('signal boundary only reports real static and dynamic imports', () => {
  assertEquals(
    findSignalBoundaryImports(`
      // import '@preact/signals-core';
      const text = "@preact/signals";
      import { signal } from '@preact/signals-core';
      await import('@preact/signals');
    `),
    ['@preact/signals-core', '@preact/signals'],
  );
});
