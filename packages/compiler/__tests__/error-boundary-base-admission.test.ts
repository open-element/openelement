/**
 * packages/compiler/__tests__/error-boundary-base-admission.test.ts — the
 * compiler admits the README's error-boundary authoring form (alpha.13 I2,
 * KR-11).
 *
 * packages/element/README.md documents ErrorBoundary as (README line 17,
 * verbatim): an error boundary "(`static isErrorBoundary = true`) that
 * automatically captures subtree render failures … A subclass `render()`
 * branches on `hasError` to swap in the … fallback UI; `retry()` re-renders
 * both the boundary and the captured source element, `reset()` clears the
 * state entirely."
 *
 * The compiler refused that form on three counts: `extends ErrorBoundary`
 * failed the canonical-base check (OEC9003), and a member named `hasError`
 * declared to carry the state failed as a non-`@property` field (OEC9005).
 * The fix is admission, not documentation: the canonical-base check now admits
 * `OpenElement` or `ErrorBoundary` — both must still be runtime named imports
 * of '@openelement/element', the binding-source check is unchanged — and the
 * boundary's `hasError` is a normal base-class member a compiled subclass can
 * declare as its state property. README unchanged; the compiler honors it.
 *
 * This suite pins the full documented pattern as a consumer writes it:
 * compile in, emitted module type-checks against the workspace declarations
 * out, the `hasError` branch lowers to a `when` Region over the declared
 * signal, and `catchError`/`retry` ride the generated class verbatim.
 */

import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CompiledElementError,
  compileElementProgram,
} from '../src/internal/compiler/semantic-core/compile.ts';
import { typeCheckEmittedModule } from '../src/internal/compiler/semantic-core/type-check.ts';
import { analyzeModuleSemantics } from '../src/internal/compiler/semantic-core/module-analysis.ts';
import { compileElementModule } from '../src/internal/compiler/plugin.ts';
import { readPackage } from '../../../tools/lib/package-graph.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FILE = '/proj/app/components/my-boundary.tsx';

/**
 * The workspace module-resolution map (`@openelement/element` → this
 * checkout's sources), in the same form the emitted-module typecheck gate
 * builds it. The emitted boundary subclass is checked against the REAL
 * declarations — which is what pins that the documented `hasError` declaration
 * is legal over the shipped base class, not merely over a test double.
 */
async function workspacePaths(): Promise<Record<string, string[]>> {
  const packagesDir = resolve(REPO_ROOT, 'packages');
  const paths: Record<string, string[]> = {};
  for (const name of readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    const pkg = await readPackage(resolve(packagesDir, name));
    if (!pkg) continue;
    const exports = typeof pkg.exports === 'string' ? { '.': pkg.exports } : (pkg.exports ?? {});
    for (const [subpath, source] of Object.entries(exports)) {
      const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, '')}`;
      paths[specifier] = [resolve(pkg.dir, String(source).replace(/^\.\//, ''))];
    }
  }
  return paths;
}

const PATHS = await workspacePaths();

/**
 * The README's documented pattern, written the way a consumer writes it: the
 * boundary subclass declares its error state as the compiled property its
 * `render()` branches on, and overrides `catchError`/`retry` to keep the
 * boundary contract.
 */
const README_BOUNDARY_SOURCE = [
  "import { element, ErrorBoundary, property } from '@openelement/element';",
  '',
  "@element('my-boundary', { root: 'shadow-open' })",
  'export class MyBoundary extends ErrorBoundary {',
  '  @property({ reflect: false, attribute: false })',
  '  hasError = false;',
  '',
  '  override catchError(error: Error, source?: unknown): void {',
  '    super.catchError(error, source);',
  '  }',
  '',
  '  override retry(): void {',
  '    super.retry();',
  '  }',
  '',
  '  render() {',
  '    return (',
  '      <div>',
  "        {this.hasError ? <p class='fallback'>Something went wrong</p> : <slot></slot>}",
  '      </div>',
  '    );',
  '  }',
  '}',
].join('\n');

/** Compile one authored module and return its OEC diagnostic, or throw. */
function compileFailure(source: string): CompiledElementError {
  try {
    compileElementProgram(source, FILE);
  } catch (error) {
    if (error instanceof CompiledElementError) return error;
    throw error;
  }
  throw new Error('expected the compile to fail closed');
}

test('the README pattern compiles: subclass ErrorBoundary, branch on hasError', () => {
  const result = compileElementProgram(README_BOUNDARY_SOURCE, FILE);
  // The heritage the README teaches is the admitted one, and the generated
  // class extends exactly the authored binding.
  expect(result.code).toContain('export class MyBoundary extends ErrorBoundary {');
  // The branch is a compiled `when` Region over the declared hasError signal.
  const whenParts = result.program.parts.filter((part) => part.k === 'when');
  expect(whenParts.length).toEqual(1);
  expect(whenParts[0]).toMatchObject({
    k: 'when',
    signal: 'hasError',
    test: { signal: 'hasError', op: 'truthy', value: true },
  });
  // Both overrides ride the generated class verbatim — the boundary contract
  // is plain class code the compiler carries, not rewrites.
  expect(result.code).toContain('override catchError(error: Error, source?: unknown): void {');
  expect(result.code).toContain('override retry(): void {');
  expect(result.code).toContain('super.catchError(error, source);');
  expect(result.code).toContain('super.retry();');
});

test('the admitted base set is exactly OpenElement and ErrorBoundary', () => {
  // OpenElement keeps working (regression), including alongside an imported
  // ErrorBoundary — the resolution must pick the authored base, not the first
  // candidate.
  const openElementSource = [
    "import { element, OpenElement, ErrorBoundary, property } from '@openelement/element';",
    "@element('my-open-element')",
    'export class MyOpenElement extends OpenElement {',
    '  @property({ reflect: false }) label = "";',
    '  render() { return <div>{this.label}</div>; }',
    '}',
  ].join('\n');
  const result = compileElementProgram(openElementSource, FILE);
  expect(result.code).toContain('export class MyOpenElement extends OpenElement {');

  // A third base keeps failing closed — the admitted set did not widen
  // beyond OpenElement or ErrorBoundary. (Two different downstream bases, so
  // neither candidate name matches the written one.)
  const foreignSource = [
    "import { element, ErrorBoundary } from 'some-other-package';",
    "@element('my-foreign')",
    'export class MyForeign extends ErrorBoundary {',
    "  @property({ reflect: false }) label = '';",
    '  render() { return <div>{this.label}</div>; }',
    '}',
  ].join('\n');
  // The decorator is foreign too, so the module never enters the compiler as
  // a compiled module; the semantic facts are the gate the plugin reads.
  const facts = analyzeModuleSemantics(foreignSource, FILE);
  expect(facts.compiledElementDecorator).toEqual(false);
  expect(compileElementModule(foreignSource, FILE)).toEqual(null);
});

test('binding-source validation is unchanged: only @openelement/element named imports count', () => {
  const cases: Array<[string, string, string]> = [
    [
      'a local class named ErrorBoundary',
      [
        "import { element, OpenElement, property } from '@openelement/element';",
        'declare const ErrorBoundary: new () => OpenElement;',
        "@element('oe-local-boundary')",
        'export class LocalBoundary extends ErrorBoundary {',
        '  @property({ reflect: false }) x = 0;',
        '  render() { return <div>{this.x}</div>; }',
        '}',
      ].join('\n'),
      'ErrorBoundary',
    ],
    [
      'a default import of ErrorBoundary',
      [
        "import { element, property } from '@openelement/element';",
        "import ErrorBoundary from '@openelement/element';",
        "@element('oe-default-boundary')",
        'export class DefaultBoundary extends ErrorBoundary {',
        '  @property({ reflect: false }) x = 0;',
        '  render() { return <div>{this.x}</div>; }',
        '}',
      ].join('\n'),
      'requires a runtime named import',
    ],
    [
      'a type-only import of ErrorBoundary',
      [
        "import { element, property } from '@openelement/element';",
        "import type { ErrorBoundary } from '@openelement/element';",
        "@element('oe-type-boundary')",
        'export class TypeBoundary extends ErrorBoundary {',
        '  @property({ reflect: false }) x = 0;',
        '  render() { return <div>{this.x}</div>; }',
        '}',
      ].join('\n'),
      'type-only import',
    ],
    [
      'a namespace-qualified ErrorBoundary',
      [
        "import { element, property } from '@openelement/element';",
        "import * as el from '@openelement/element';",
        "@element('oe-namespace-boundary')",
        'export class NamespaceBoundary extends el.ErrorBoundary {',
        '  @property({ reflect: false }) x = 0;',
        '  render() { return <div>{this.x}</div>; }',
        '}',
      ].join('\n'),
      'namespace-qualified',
    ],
    [
      'a relative re-export of ErrorBoundary',
      [
        "import { element, property } from '@openelement/element';",
        "import { ErrorBoundary } from './boundary-re-export.ts';",
        "@element('oe-reexport-boundary')",
        'export class ReexportBoundary extends ErrorBoundary {',
        '  @property({ reflect: false }) x = 0;',
        '  render() { return <div>{this.x}</div>; }',
        '}',
      ].join('\n'),
      're-export provenance',
    ],
    [
      'conflicting module-scope bindings for ErrorBoundary',
      [
        "import { element, property } from '@openelement/element';",
        "import { ErrorBoundary } from '@openelement/element';",
        "import { ErrorBoundary } from './other.ts';",
        "@element('oe-conflict-boundary')",
        'export class ConflictBoundary extends ErrorBoundary {',
        '  @property({ reflect: false }) x = 0;',
        '  render() { return <div>{this.x}</div>; }',
        '}',
      ].join('\n'),
      'conflicting module-scope bindings for "ErrorBoundary"',
    ],
  ];

  for (const [label, source, expected] of cases) {
    const error = compileFailure(source);
    const diagnostic = error.diagnostics[0]!;
    expect(diagnostic.code, label).toEqual('OEC9003');
    expect(diagnostic.message, label).toContain(expected);
  }
});

test('the emitted README-pattern module type-checks against the workspace declarations', () => {
  const { code } = compileElementProgram(README_BOUNDARY_SOURCE, FILE);
  const diagnostics = typeCheckEmittedModule(code, FILE, { paths: PATHS });
  expect(
    diagnostics,
    `the emitted boundary module must type-check; got:\n${diagnostics
      .map(
        (diagnostic) =>
          `${diagnostic.line}:${diagnostic.character} TS${diagnostic.code} ${diagnostic.message}`,
      )
      .join('\n')}`,
  ).toEqual([]);
});

test('a default-exported boundary subclass is discoverable as a compiled component', () => {
  // The router's static-component scanner collects `defaultCompiledTag` from
  // module semantics; a boundary used as a page component must be admitted
  // there too, or the documented form would compile and still be dropped.
  const source = [
    "import { element, ErrorBoundary, property } from '@openelement/element';",
    '',
    "@element('my-boundary', { root: 'shadow-open' })",
    'export default class MyBoundary extends ErrorBoundary {',
    '  @property({ reflect: false, attribute: false })',
    '  hasError = false;',
    '  render() {',
    '    return <div>{this.hasError ? <p>failed</p> : <slot></slot>}</div>;',
    '  }',
    '}',
  ].join('\n');
  const facts = analyzeModuleSemantics(source, FILE);
  expect(facts.compiledElementDecorator).toEqual(true);
  expect(facts.defaultCompiledTag).toEqual('my-boundary');
});

test('the README is unchanged by this admission (the doc is the contract)', () => {
  // The lane's ruling: the compiler honors the README, the README is not
  // edited to match the compiler. Pin the sentence this admission answers.
  const readme = readFileSync(resolve(REPO_ROOT, 'packages/element/README.md'), 'utf8');
  expect(readme).toContain('A subclass `render()` branches on `hasError`');
  expect(readme).toContain(
    '`retry()` re-renders both the boundary and the captured source element',
  );
});
