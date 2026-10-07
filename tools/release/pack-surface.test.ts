/**
 * pack-surface.test.ts — the npm facade check's own contract.
 *
 * Each case pins one acceptance clause of #1412 with fixtures, so a future
 * loosening of the scanner fails here instead of silently shipping a tarball
 * a consumer cannot read.
 */
import { expect, test } from 'vitest';
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

test('pack surface: metadata parity with packedMetadata()', () => {
  expect(findMetadataViolations('@openelement/element', manifest(), ELEMENT_METADATA)).toEqual([]);
});

test('pack surface: a missing or divergent facade field fails', () => {
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
    expect(messages.length, `${field}=${JSON.stringify(value)} must fail`).toEqual(1);
    expect(messages[0]).toContain(field);
  }
});

test('pack surface: every retained package declares the Node 24.2 floor', () => {
  for (const name of [
    '@openelement/element',
    '@openelement/router',
    '@openelement/create',
    '@openelement/ui',
  ]) {
    expect(packedMetadata(name).engines, name).toEqual({ node: '>=24.2' });
  }
});

test('pack surface: create declares a Node-floor engine and a cli side effect', () => {
  const metadata = packedMetadata('@openelement/create');
  expect(metadata.engines).toEqual({ node: '>=24.2' });
  expect(metadata.sideEffects).toEqual(['./src/cli.js']);
  expect(
    findMetadataViolations('@openelement/create', manifest('@openelement/create'), metadata),
  ).toEqual([]);
  const violations = findMetadataViolations(
    '@openelement/create',
    manifest('@openelement/create', { sideEffects: false }),
    metadata,
  );
  expect(violations.length).toEqual(1);
  expect(violations[0].message).toContain('sideEffects');
});

test('pack surface: repository-internal paths and ADR citations fail', () => {
  const cases: Array<[string, string]> = [
    ['comment', '// see packages/router/src/authoring.ts for the contract'],
    ['task', 'Regenerate with: deno task --cwd packages/ui generate:ui-manifest'],
    ['tools path', 'generator lives in tools/repo/generate-export-files.ts'],
    ['site path', 'wired in www/vite.config.ts'],
    ['adr id', 'compiled authoring (ADR-0143)'],
    ['adr spaced', 'authoring contract (ADR 0143)'],
    ['adr plural', 'historic decision records (ADRs) are maintainer vocabulary'],
  ];
  for (const [label, line] of cases) {
    const violations = findInternalReferences('@openelement/element', 'src/index.js', line);
    expect(violations.length, `${label} must fail: ${line}`).toEqual(1);
    expect(violations[0].line).toEqual(1);
  }
});

test('pack surface: ordinary prose and package-relative paths pass', () => {
  const accepted = [
    // The word "tests" in prose, not a repository directory reference.
    '/** Install the process-wide hook (replaceable for tests, HMR, multi-app pages). */',
    "import { OpenElement } from './internal/core/errors.js';",
    "import manifestData from './generated-manifest.json' with { type: 'json' };",
    'deno task generate:ui-manifest',
    'docs/ is where the consumer keeps their own files',
  ];
  for (const line of accepted) {
    expect(
      findInternalReferences('@openelement/element', 'src/index.js', line),
      `must pass: ${line}`,
    ).toEqual([]);
  }
});

test('pack surface: undocumented export subpaths fail, documented ones pass', () => {
  const readme = 'The package exposes `@openelement/element/compiler` and `/html`.';
  const undocumented = findUndocumentedSubpaths(
    '@openelement/element',
    { '.': './src/index.ts', './compiler': './src/compiler.ts', './logger': './src/logger.ts' },
    readme,
  );
  expect(undocumented.length).toEqual(1);
  expect(undocumented[0].message).toContain('@openelement/element/logger');
  expect(
    findUndocumentedSubpaths(
      '@openelement/element',
      { '.': './src/index.ts', './compiler': './src/compiler.ts' },
      readme,
    ),
  ).toEqual([]);
});

test('pack surface: scanPackedPackage reads the archive shape npm installs', () => {
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
  expect(violations.length).toEqual(2);
  expect(violations[0].path).toEqual('src/html.js');
  expect(violations[0].line).toEqual(1);
  expect(violations[0].message).toContain('docs/');
  expect(violations[1].message).toContain('decision-record');
});

test('pack surface: a missing packed manifest fails closed', () => {
  const violations = scanPackedPackage('@openelement/element', new Map());
  expect(violations.length).toEqual(1);
  expect(violations[0].message).toContain('missing package/package.json');
});

test('pack surface: module-scope global writes are found, nested ones are not', () => {
  const offending = [
    'globalThis.customElements = {};',
    'window.__openElement = true;',
    'document.adoptedStyleSheets = [];',
    'Object.defineProperty(globalThis, "openElement", {});',
    "customElements['x'] = 1;",
  ];
  for (const line of offending) {
    const found = findModuleScopeGlobalWrites(line);
    expect(found.length, `must fail: ${line}`).toEqual(1);
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
    expect(findModuleScopeGlobalWrites(source), `must pass: ${JSON.stringify(source)}`).toEqual([]);
  }
});

test('pack surface: a side-effect-free package with a module-scope write fails', () => {
  const files = new Map<string, string>([
    // Element declares an array (#1425), so this case uses a package that still
    // declares a flat `false`: the rule it pins is the flat claim's.
    ['package/package.json', JSON.stringify(manifest('@openelement/ui'))],
    ['package/README.md', ''],
    ['package/src/index.js', 'globalThis.__openElementBootstrap = true;'],
  ]);
  const violations = scanPackedPackage('@openelement/ui', files);
  expect(violations.length).toEqual(1);
  expect(violations[0].message).toContain('sideEffects');
  expect(violations[0].path).toContain('src/index.js');
});

test('pack surface: create keeps its side-effectful cli out of the scan', () => {
  const files = new Map<string, string>([
    ['package/package.json', JSON.stringify(manifest('@openelement/create'))],
    ['package/README.md', ''],
    ['package/src/cli.js', 'globalThis.__scaffoldOnImport = true;'],
  ]);
  // Create declares sideEffects: ['./src/cli.js'], so the write is expected.
  expect(scanPackedPackage('@openelement/create', files)).toEqual([]);
});

test('pack surface: module-scope seam installs are found, deferred ones are not', () => {
  const offending = ['installClaimExecutor(claimExistingDom);', 'installSeamThing(other);'];
  for (const line of offending) {
    const found = findModuleScopeSeamInstalls(line);
    expect(found.length, `must fail: ${line}`).toEqual(1);
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
    expect(findModuleScopeSeamInstalls(source), `must pass: ${JSON.stringify(source)}`).toEqual([]);
  }
});

test('pack surface: an undeclared seam install fails, a declared one passes', () => {
  // The installer path in the fixture is the one the shipped element manifest
  // declares, so "declared" below means the real declaration actually covers
  // the real module — not a coincidental match on a test-only name.
  const INSTALLER_PATH = 'src/internal/compiled/runtime/claim-install.js';
  const packaged = (sideEffects: unknown): Map<string, string> =>
    new Map<string, string>([
      ['package/package.json', JSON.stringify(manifest('@openelement/element', { sideEffects }))],
      ['package/README.md', ''],
      ['package/src/index.js', "import './internal/compiled/runtime/claim-install.js';"],
      [`package/${INSTALLER_PATH}`, 'installClaimExecutor(claimExistingDom);'],
    ]);
  // Only the seam rule's findings: a fixture whose sideEffects differs from
  // packedMetadata() also trips the parity rule, which is not under test here.
  const seam = (sideEffects: unknown): PackSurfaceViolation[] =>
    scanPackedPackage('@openelement/element', packaged(sideEffects)).filter((violation) =>
      violation.message.includes('tree-shaken'),
    );

  // The #1425 shape: `false` lets a bundler drop the installer AND the bare
  // import that reaches it, so the packaged entry silently loses the seam.
  const undeclared = seam(false);
  expect(undeclared.length).toEqual(1);
  expect(undeclared[0].path).toContain(INSTALLER_PATH);

  // The shipped declaration clears it, and clears every other rule too.
  expect(
    scanPackedPackage(
      '@openelement/element',
      packaged(packedMetadata('@openelement/element').sideEffects),
    ),
  ).toEqual([]);

  // Wildcards and a flat `true` are honoured the way npm reads them.
  for (const declared of [['./src/**'], true] as const) {
    expect(seam(declared), `must pass with sideEffects=${JSON.stringify(declared)}`).toEqual([]);
  }

  // Naming only the importer is NOT enough: the installer body is still
  // side-effect-free on its own, which is exactly the half-dropped bundle.
  const importerOnly = seam(['./src/index.js']);
  expect(importerOnly.length).toEqual(1);
  expect(importerOnly[0].path).toContain(INSTALLER_PATH);

  // And the shipped element manifest must not regress to the flat claim. The
  // flagged set names every install edge's importer and installer (#1425
  // class): the default entry, the entries that import one install
  // (`./client-only` → regions, `./no-regions` → claim, #1548), and both
  // installers.
  expect(packedMetadata('@openelement/element').sideEffects).toEqual([
    './src/index.js',
    './src/client-only.js',
    './src/no-regions.js',
    './src/internal/compiled/runtime/claim-install.js',
    './src/internal/compiled/runtime/regions-install.js',
  ]);
});
