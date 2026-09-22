/**
 * pack-surface.test.ts — the npm facade check's own contract.
 *
 * Each case pins one acceptance clause of #1412 with fixtures, so a future
 * loosening of the scanner fails here instead of silently shipping a tarball
 * a consumer cannot read.
 */
import { assertEquals, assertStringIncludes } from '@std/assert';
import {
  findInternalReferences,
  findMetadataViolations,
  findModuleScopeGlobalWrites,
  findModuleScopeSeamInstalls,
  findUndocumentedSubpaths,
  type PackSurfaceViolation,
  scanPackedPackage,
} from './pack-surface.ts';
import { packedMetadata } from './npm-manifest.ts';

const ELEMENT_METADATA = packedMetadata('@openelement/element');

/** A packed manifest for `name` carrying that package's expected facade. */
function manifest(
  name = '@openelement/element',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const metadata = packedMetadata(name);
  return {
    name,
    version: '1.0.0-alpha.2',
    homepage: metadata.homepage,
    keywords: metadata.keywords,
    engines: metadata.engines,
    sideEffects: metadata.sideEffects,
    exports: { '.': {} },
    ...overrides,
  };
}

Deno.test('pack surface: metadata parity with packedMetadata()', () => {
  assertEquals(findMetadataViolations('@openelement/element', manifest(), ELEMENT_METADATA), []);
});

Deno.test('pack surface: a missing or divergent facade field fails', () => {
  const fields: Array<[string, unknown]> = [
    ['homepage', undefined],
    ['homepage', 'https://example.com'],
    ['keywords', ['openelement']],
    ['keywords', undefined],
    ['engines', { node: '>=18' }],
    ['engines', undefined],
    ['sideEffects', true],
    ['sideEffects', undefined],
  ];
  for (const [field, value] of fields) {
    const messages = findMetadataViolations(
      '@openelement/element',
      manifest('@openelement/element', { [field]: value }),
      ELEMENT_METADATA,
    ).map((violation) => violation.message);
    assertEquals(messages.length, 1, `${field}=${JSON.stringify(value)} must fail`);
    assertStringIncludes(messages[0], field);
  }
});

Deno.test('pack surface: create declares a Deno-floor engine and a cli side effect', () => {
  const metadata = packedMetadata('@openelement/create');
  assertEquals(metadata.engines, { deno: '>=2.9' });
  assertEquals(metadata.sideEffects, ['./src/cli.js']);
  assertEquals(
    findMetadataViolations('@openelement/create', manifest('@openelement/create'), metadata),
    [],
  );
  const violations = findMetadataViolations(
    '@openelement/create',
    manifest('@openelement/create', { sideEffects: false }),
    metadata,
  );
  assertEquals(violations.length, 1);
  assertStringIncludes(violations[0].message, 'sideEffects');
});

Deno.test('pack surface: repository-internal paths and ADR citations fail', () => {
  const cases: Array<[string, string]> = [
    ['comment', '// see packages/router/src/authoring.ts for the contract'],
    ['task', 'Regenerate with: deno task --cwd packages/ui generate:ui-tokens'],
    ['tools path', 'generator lives in tools/repo/generate-export-files.ts'],
    ['site path', 'wired in www/vite.config.ts'],
    ['adr id', 'compiled authoring (ADR-0143)'],
    ['adr spaced', 'authoring contract (ADR 0143)'],
    ['adr plural', 'historic decision records (ADRs) are maintainer vocabulary'],
  ];
  for (const [label, line] of cases) {
    const violations = findInternalReferences('@openelement/element', 'src/index.js', line);
    assertEquals(violations.length, 1, `${label} must fail: ${line}`);
    assertEquals(violations[0].line, 1);
  }
});

Deno.test('pack surface: ordinary prose and package-relative paths pass', () => {
  const accepted = [
    // The word "tests" in prose, not a repository directory reference.
    '/** Install the process-wide hook (replaceable for tests, HMR, multi-app pages). */',
    "import { OpenElement } from './internal/core/errors.js';",
    "import manifestData from './generated-manifest.json' with { type: 'json' };",
    'deno task generate:ui-tokens',
    'docs/ is where the consumer keeps their own files',
  ];
  for (const line of accepted) {
    assertEquals(
      findInternalReferences('@openelement/element', 'src/index.js', line),
      [],
      `must pass: ${line}`,
    );
  }
});

Deno.test('pack surface: undocumented export subpaths fail, documented ones pass', () => {
  const readme = 'The package exposes `@openelement/element/compiler` and `/html`.';
  const undocumented = findUndocumentedSubpaths(
    '@openelement/element',
    { '.': './src/index.ts', './compiler': './src/compiler.ts', './logger': './src/logger.ts' },
    readme,
  );
  assertEquals(undocumented.length, 1);
  assertStringIncludes(undocumented[0].message, '@openelement/element/logger');
  assertEquals(
    findUndocumentedSubpaths(
      '@openelement/element',
      { '.': './src/index.ts', './compiler': './src/compiler.ts' },
      readme,
    ),
    [],
  );
});

Deno.test('pack surface: scanPackedPackage reads the archive shape npm installs', () => {
  const files = new Map<string, string>([
    [
      'package/package.json',
      JSON.stringify(
        manifest('@openelement/element', {
          exports: { '.': './src/index.js', './html': './src/html.js' },
        }),
      ),
    ],
    ['package/README.md', 'Import `@openelement/element/html` for document helpers.'],
    ['package/src/index.js', "export * from './internal/core/errors.js';"],
    ['package/src/html.js', '// see docs/adr/ADR-0150 for the trust boundary'],
  ]);
  const violations = scanPackedPackage('@openelement/element', files);
  // One line, two independent rules: a repository path and a decision citation.
  assertEquals(violations.length, 2);
  assertEquals(violations[0].path, 'src/html.js');
  assertEquals(violations[0].line, 1);
  assertStringIncludes(violations[0].message, 'docs/');
  assertStringIncludes(violations[1].message, 'decision-record');
});

Deno.test('pack surface: a missing packed manifest fails closed', () => {
  const violations = scanPackedPackage('@openelement/element', new Map());
  assertEquals(violations.length, 1);
  assertStringIncludes(violations[0].message, 'missing package/package.json');
});

Deno.test('pack surface: module-scope global writes are found, nested ones are not', () => {
  const offending = [
    'globalThis.customElements = {};',
    'window.__openElement = true;',
    'document.adoptedStyleSheets = [];',
    'Object.defineProperty(globalThis, "openElement", {});',
    "customElements['x'] = 1;",
  ];
  for (const line of offending) {
    const found = findModuleScopeGlobalWrites(line);
    assertEquals(found.length, 1, `must fail: ${line}`);
  }

  const accepted = [
    // Inside a function, an arrow callback, or a block: import-time free.
    'function install() {\n  globalThis.customElements = {};\n}',
    'const install = () => {\n  window.__x = 1;\n};',
    'if (needsPolyfill()) {\n  document.x = 1;\n}',
    // Inside an emitted template literal (the SSR polyfill banner shape).
    'export function banner() {\n  return `\nif (typeof globalThis.customElements === "undefined") {\n  globalThis.customElements = {};\n}\n`;\n}',
    // Inside a string or a comment.
    'const sample = "globalThis.customElements = {};";',
    '// globalThis.customElements = {};',
    '/*\nglobalThis.customElements = {};\n*/',
    // An indented write is not a module-scope statement head.
    '  globalThis.customElements = {};',
  ];
  for (const source of accepted) {
    assertEquals(
      findModuleScopeGlobalWrites(source),
      [],
      `must pass: ${JSON.stringify(source)}`,
    );
  }
});

Deno.test('pack surface: a side-effect-free package with a module-scope write fails', () => {
  const files = new Map<string, string>([
    // Element declares an array (#1425), so this case uses a package that still
    // declares a flat `false`: the rule it pins is the flat claim's.
    ['package/package.json', JSON.stringify(manifest('@openelement/ui'))],
    ['package/README.md', ''],
    ['package/src/index.js', 'globalThis.__openElementBootstrap = true;'],
  ]);
  const violations = scanPackedPackage('@openelement/ui', files);
  assertEquals(violations.length, 1);
  assertStringIncludes(violations[0].message, 'sideEffects');
  assertStringIncludes(violations[0].path, 'src/index.js');
});

Deno.test('pack surface: create keeps its side-effectful cli out of the scan', () => {
  const files = new Map<string, string>([
    ['package/package.json', JSON.stringify(manifest('@openelement/create'))],
    ['package/README.md', ''],
    ['package/src/cli.js', 'globalThis.__scaffoldOnImport = true;'],
  ]);
  // Create declares sideEffects: ['./src/cli.js'], so the write is expected.
  assertEquals(scanPackedPackage('@openelement/create', files), []);
});

Deno.test('pack surface: module-scope seam installs are found, deferred ones are not', () => {
  const offending = [
    'installClaimExecutor(claimExistingDom);',
    'installSeamThing(other);',
  ];
  for (const line of offending) {
    const found = findModuleScopeSeamInstalls(line);
    assertEquals(found.length, 1, `must fail: ${line}`);
  }

  const accepted = [
    // Inside a function or a block: not an import-time install.
    'function wire() {\n  installClaimExecutor(claimExistingDom);\n}',
    'if (ready) {\n  installClaimExecutor(claimExistingDom);\n}',
    // An indented call is not a module-scope statement head.
    '  installClaimExecutor(claimExistingDom);',
    // A factory call is not an install: it has no seam naming convention, and
    // Router's pure reachability imports must stay unflagged (#1425 scope).
    'createIslandScheduler({ log, win, doc });',
    'export { installClaimExecutor } from "./claim-seam.js";',
  ];
  for (const source of accepted) {
    assertEquals(
      findModuleScopeSeamInstalls(source),
      [],
      `must pass: ${JSON.stringify(source)}`,
    );
  }
});

Deno.test('pack surface: an undeclared seam install fails, a declared one passes', () => {
  // The installer path in the fixture is the one the shipped element manifest
  // declares, so "declared" below means the real declaration actually covers
  // the real module — not a coincidental match on a test-only name.
  const INSTALLER_PATH = 'src/internal/compiled/runtime/claim-install.js';
  const packaged = (sideEffects: unknown): Map<string, string> =>
    new Map<string, string>([
      [
        'package/package.json',
        JSON.stringify(manifest('@openelement/element', { sideEffects })),
      ],
      ['package/README.md', ''],
      ['package/src/index.js', "import './internal/compiled/runtime/claim-install.js';"],
      [`package/${INSTALLER_PATH}`, 'installClaimExecutor(claimExistingDom);'],
    ]);
  // Only the seam rule's findings: a fixture whose sideEffects differs from
  // packedMetadata() also trips the parity rule, which is not under test here.
  const seam = (sideEffects: unknown): PackSurfaceViolation[] =>
    scanPackedPackage('@openelement/element', packaged(sideEffects))
      .filter((violation) => violation.message.includes('tree-shaken'));

  // The #1425 shape: `false` lets a bundler drop the installer AND the bare
  // import that reaches it, so the packaged entry silently loses the seam.
  const undeclared = seam(false);
  assertEquals(undeclared.length, 1);
  assertStringIncludes(undeclared[0].path, INSTALLER_PATH);

  // The shipped declaration clears it, and clears every other rule too.
  assertEquals(
    scanPackedPackage(
      '@openelement/element',
      packaged(packedMetadata('@openelement/element').sideEffects),
    ),
    [],
  );

  // Wildcards and a flat `true` are honoured the way npm reads them.
  for (const declared of [['./src/**'], true] as const) {
    assertEquals(seam(declared), [], `must pass with sideEffects=${JSON.stringify(declared)}`);
  }

  // Naming only the importer is NOT enough: the installer body is still
  // side-effect-free on its own, which is exactly the half-dropped bundle.
  const importerOnly = seam(['./src/index.js']);
  assertEquals(importerOnly.length, 1);
  assertStringIncludes(importerOnly[0].path, INSTALLER_PATH);

  // And the shipped element manifest must not regress to the flat claim.
  assertEquals(packedMetadata('@openelement/element').sideEffects, [
    './src/index.js',
    './src/internal/compiled/runtime/claim-install.js',
  ]);
});
