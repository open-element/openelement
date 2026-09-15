// esm-boundary:scanner — this test names the Node constructs the scanner finds.
import { assertEquals, assertFalse, assertStringIncludes } from '@std/assert';
import {
  allowlistCoverageFailures,
  allowlistMatches,
  NODE_HOST_ALLOWLIST,
  policyFor,
  scanDenoApiSource,
  scanPath,
} from './check-deno-api-free.ts';

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

Deno.test('deno-api-free detects Node globals in code, not comments or strings', () => {
  const issues = scanDenoApiSource(
    'packages/ui/src/fixture.tsx',
    `
    // process.env and Buffer.from are banned here.
    const note = "require('x') and module.exports";
    process.env.OPEN_ELEMENT = '1';
    const view = Buffer.from('x');
    const dir = __dirname;
    module.exports = {};
    export {};
  `,
  );
  const text = issues.join('\n');
  assertEquals(issues.length, 4);
  assertStringIncludes(text, 'Node global: process');
  assertStringIncludes(text, 'Node global: Buffer');
  assertStringIncludes(text, 'Node global: __dirname');
  assertStringIncludes(text, 'Node global: module.exports');
  assertFalse(text.includes('require'));
});

Deno.test('deno-api-free scans require() calls, not require declarations', () => {
  const issues = scanDenoApiSource(
    'packages/ui/src/fixture.tsx',
    `
    function require(name: string) { return name; }
    require('x');
    export {};
  `,
  );
  // The local declaration is not a call; the call is still reported because
  // the scanner cannot see across module boundaries (fail closed).
  assertEquals(issues.length, 1);
  assertStringIncludes(issues.join('\n'), 'Node global: require');
});

Deno.test('deno-api-free classifies product, Deno-host, and Node-host paths', () => {
  assertEquals(policyFor('packages/ui/src/open-button.tsx').kind, 'product');
  assertEquals(policyFor('packages/element/src/internal/compiler/x.ts'), {
    kind: 'product',
    denoApis: 'allow',
    npm: 'allow',
  });
  assertEquals(policyFor('tests/fixtures/router-native-framework/app/routes/index.tsx'), {
    kind: 'product',
    denoApis: 'allow',
    npm: 'allow',
  });
  assertEquals(policyFor('tools/repo/check-esm-boundary.ts').kind, 'deno-host');
  assertEquals(
    policyFor('tests/fixtures/router-native-framework/e2e/server.ts').kind,
    'node-host',
  );
  assertEquals(policyFor('benchmarks/jfb/harness/run.ts').kind, 'node-host');
  assertEquals(policyFor('www/e2e/playwright.config.ts').kind, 'node-host');
  assertEquals(policyFor('README.md').kind, 'skip');
});

Deno.test('deno-api-free product scan bars Node APIs while Deno-host scan allows Deno', () => {
  const source = `import { join } from 'node:path';\nDeno.cwd();\nprocess.exit(0);\n`;
  const product = scanPath('packages/ui/src/fixture.tsx', source);
  assertEquals(product.length, 3);
  const denoHost = scanPath('tools/repo/fixture.ts', source);
  assertEquals(denoHost.length, 2);
  assertStringIncludes(denoHost.join('\n'), 'node import');
  assertStringIncludes(denoHost.join('\n'), 'Node global: process');
  const nodeHost = scanPath('tests/fixtures/router-native-framework/e2e/server.ts', source);
  assertEquals(nodeHost, []);
});

Deno.test('deno-api-free fails stale allowlist entries', () => {
  assertEquals(
    allowlistCoverageFailures([{ path: 'gone.ts', reason: 'test' }], () => false),
    ['stale allowlist entry (path no longer exists): gone.ts'],
  );
  assertEquals(
    allowlistCoverageFailures(
      [{ path: 'kept/', reason: 'test' }],
      (path) => path === 'kept',
    ),
    [],
  );
  assertEquals(NODE_HOST_ALLOWLIST.every((entry) => entry.reason !== ''), true);
});

Deno.test('deno-api-free expands directory allowlist entries for CI output', () => {
  const matches = allowlistMatches(
    [
      { path: 'host/', reason: 'dir' },
      { path: 'host/one.ts', reason: 'file' },
    ],
    ['host/one.ts', 'host/two.ts', 'product/three.ts'],
  );
  assertEquals(matches[0].matches, ['host/one.ts', 'host/two.ts']);
  assertEquals(matches[1].matches, ['host/one.ts']);
});
