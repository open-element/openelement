import { assertEquals, assertFalse, assertStringIncludes } from '@std/assert';
import { scanDenoApiSource } from './check-deno-api-free.ts';

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

Deno.test('deno-api-free bars node imports even in chartered host tooling', () => {
  const hostSource =
    `import { join } from 'node:path';\nimport { contentType } from '@std/media-types';\nDeno.cwd();\n`;
  const hostIssues = scanDenoApiSource('packages/router/src/cli/build.ts', hostSource, {
    hostTooling: true,
  });
  assertEquals(hostIssues.length, 1);
  assertStringIncludes(hostIssues.join('\n'), 'node import');
  const runtimeIssues = scanDenoApiSource('packages/router/src/router.ts', hostSource);
  assertEquals(runtimeIssues.length, 2);
});
