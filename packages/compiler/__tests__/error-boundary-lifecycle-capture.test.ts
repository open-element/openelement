/**
 * packages/compiler/__tests__/error-boundary-lifecycle-capture.test.ts — the
 * compiler emits the error-boundary capture wrapper around platform
 * lifecycle callback bodies (alpha.13 artifact honesty; module ABI v2).
 *
 * The audit finding: authored lifecycle overrides were emitted verbatim, so a
 * `connectedCallback()` throw escaped straight to window with no boundary.
 * The fix is a compile-time wrapper (P2: the cost is paid here, the runtime
 * delta is one method call on the failure path) around EXACTLY the platform
 * entry points the browser invokes outside any application stack —
 * `_captureError` on the base class then performs the nearest-boundary climb
 * (React error boundaries are the prior art; the compiled difference is that
 * the capture point is materialized at compile time instead of living in a
 * runtime render/lifecycle dispatcher).
 *
 * Pins:
 *   - every platform lifecycle callback body is wrapped, others are verbatim;
 *   - the emitted module still type-checks against the workspace declarations
 *     (the wrapper calls the protected base-class method);
 *   - the module ABI banner stamps the bumped version (the generated-module
 *     contract changed shape).
 *
 * The Source Map v3 half of the wrapper's contract (the wrapped body keeps
 * resolving to its authored positions through a standard consumer) lives in
 * packages/element/__tests__/compiler-lifecycle-capture-source-map.test.ts —
 * the element project owns the @jridgewell/trace-mapping dependency the
 * standard-consumer assertions ride (same split as compiler-source-map-v3).
 */

import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPILED_MODULE_ABI_VERSION } from '@openelement/protocol/part-program';
import { compileElementProgram } from '../src/internal/compiler/semantic-core/compile.ts';
import { typeCheckEmittedModule } from '../src/internal/compiler/semantic-core/type-check.ts';
import { readPackage } from '../../../tools/lib/package-graph.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FILE = '/proj/app/components/lifecycle-capture.tsx';

/** The workspace module-resolution map (element sources), as the base-admission suite builds it. */
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

const SOURCE = [
  "import { element, ErrorBoundary, OpenElement, property } from '@openelement/element';",
  '',
  "@element('oe-lifecycle-capture')",
  'export class LifecycleCapture extends ErrorBoundary {',
  '  @property({ reflect: false, attribute: false })',
  '  hasError = false;',
  '',
  '  override connectedCallback(): void {',
  '    super.connectedCallback();',
  "    throw new Error('boom at connect');",
  '  }',
  '',
  '  override disconnectedCallback(): void {',
  '    super.disconnectedCallback();',
  '  }',
  '',
  '  override attributeChangedCallback(',
  '    name: string,',
  '    oldValue: string | null,',
  '    newValue: string | null,',
  '  ): void {',
  '    super.attributeChangedCallback(name, oldValue, newValue);',
  '  }',
  '',
  '  override formResetCallback(): void {',
  '    this.reset();',
  '  }',
  '',
  '  detonate(): void {',
  '    this.hasError = true;',
  '  }',
  '',
  '  onButtonClick(event: unknown): void {',
  '    void event;',
  '  }',
  '',
  '  render() {',
  '    return <div>{this.hasError ? <p>failed</p> : <slot></slot>}</div>',
  '  }',
  '}',
].join('\n');

const CATCH_LINE = '  } catch (error) { if (!this._captureError(error)) throw error; }';

function compiled(): string {
  return compileElementProgram(SOURCE, FILE).code;
}

test('every platform lifecycle callback body is wrapped in the capture contract', () => {
  const code = compiled();
  const lines = code.split('\n');
  for (const [signature, headerEnd] of [
    ['override connectedCallback(): void {', 'override connectedCallback(): void {'],
    ['override disconnectedCallback(): void {', 'override disconnectedCallback(): void {'],
    // The multiline parameter list keeps its authored lines; the wrapper
    // opens after the header's own closing line.
    ['override attributeChangedCallback(', '  ): void {'],
    ['override formResetCallback(): void {', 'override formResetCallback(): void {'],
  ] as const) {
    const start = lines.findIndex((line) => line.includes(signature));
    expect(start, `the emitted module carries ${signature}`).toBeGreaterThan(-1);
    const headerLine = lines.findIndex((line, index) => index >= start && line.includes(headerEnd));
    expect(
      lines[headerLine + 1],
      'the wrapper opens a try block directly after the signature',
    ).toEqual('  try {');
    // The wrapper closes with the routing catch, then the method's own brace.
    const catchIndex = lines.indexOf(CATCH_LINE, start);
    expect(catchIndex, 'the routing catch closes the wrapper').toBeGreaterThan(start);
    expect(lines[catchIndex + 1]).toEqual('  }');
  }
  // One wrapper per lifecycle method — exactly four here.
  expect(lines.filter((line) => line === CATCH_LINE).length).toEqual(4);
  // The routing call is the compiled contract: capture or rethrow.
  expect(code).toContain('if (!this._captureError(error)) throw error;');
});

test('non-lifecycle author methods ride the class verbatim (no wrapper)', () => {
  const code = compiled();
  const lines = code.split('\n');
  for (const [signature, body] of [
    // Verbatim copies carry the class prefix on every authored line: the
    // authored 4-space body rides at 2 + 4 = 6 generated columns.
    ['detonate(): void {', '      this.hasError = true;'],
    ['onButtonClick(event: unknown): void {', '      void event;'],
  ] as const) {
    const start = lines.findIndex((line) => line.includes(signature));
    expect(start).toBeGreaterThan(-1);
    expect(lines[start + 1], `${signature} body follows verbatim`).toEqual(body);
    expect(lines[start + 1]).not.toEqual('  try {');
  }
  // The render stub and overrides the base admission suite pins stay untouched.
  expect(code).toContain('override connectedCallback(): void {');
  expect(code).toContain('render(): never {');
});

test('the wrapped body keeps its authored bytes (map pins live in the element project)', () => {
  const code = compiled();
  const lines = code.split('\n');
  // The wrapped body line is byte-identical to the authored one — the
  // continuation mapping's premise (line i at authored column, verbatim).
  // The element-project suite resolves it through a standard consumer.
  const needle = "throw new Error('boom at connect');";
  const generatedIndex = lines.findIndex((line) => line.includes(needle));
  expect(generatedIndex).toBeGreaterThan(-1);
  expect(lines[generatedIndex]).toEqual(`    ${needle}`);
  const superCall = 'super.attributeChangedCallback(name, oldValue, newValue);';
  expect(lines.find((line) => line === `    ${superCall}`)).toBeTruthy();
});

test('the wrapped module type-checks against the workspace declarations', () => {
  const { code } = compileElementProgram(SOURCE, FILE);
  const diagnostics = typeCheckEmittedModule(code, FILE, { paths: PATHS });
  expect(
    diagnostics,
    `the wrapped module must type-check; got:\n${diagnostics
      .map(
        (diagnostic) =>
          `${diagnostic.line}:${diagnostic.character} TS${diagnostic.code} ${diagnostic.message}`,
      )
      .join('\n')}`,
  ).toEqual([]);
});

test('the emitted wrapper stays deterministic across compiles', () => {
  const first = compileElementProgram(SOURCE, FILE).code;
  const second = compileElementProgram(SOURCE, FILE).code;
  expect(second).toEqual(first);
});

test('the module ABI banner stamps the bumped contract version', () => {
  // The wrapper is a generated-module contract change: generated code now
  // requires a runtime facade carrying the protected _captureError seam.
  expect(COMPILED_MODULE_ABI_VERSION).toEqual(2);
  const banner = compiled().split('\n')[0];
  expect(banner).toContain(`module ABI ${COMPILED_MODULE_ABI_VERSION}`);
});

test('an empty-body lifecycle callback still emits valid wrapped syntax', () => {
  const source = [
    "import { element, OpenElement, property } from '@openelement/element';",
    "@element('oe-empty-lifecycle')",
    'export class EmptyLifecycle extends OpenElement {',
    '  @property({ reflect: false }) label = "";',
    '  override adoptedCallback(): void {}',
    '  render() { return <div>{this.label}</div>; }',
    '}',
  ].join('\n');
  const { code } = compileElementProgram(source, FILE);
  const lines = code.split('\n');
  const start = lines.findIndex((line) => line.includes('override adoptedCallback(): void {'));
  expect(start).toBeGreaterThan(-1);
  expect(lines[start + 1]).toEqual('  try {');
  expect(lines.indexOf(CATCH_LINE, start)).toEqual(start + 2);
  expect(lines[start + 3]).toEqual('  }');
  expect(typeCheckEmittedModule(code, FILE, { paths: PATHS })).toEqual([]);
});

test('the element runtime carries the protected seam the wrapper calls (pairing)', () => {
  // ABI pairing, consumer form: the emitted wrapper's `_captureError` must
  // exist on the shipped base class this compile targets. The declarations
  // are the shipped surface (the typecheck above proves call-site legality;
  // this proves the member itself is the runtime's, not a test double).
  const elementSource = readFileSync(
    resolve(REPO_ROOT, 'packages/element/src/open-element-implementation.ts'),
    'utf8',
  );
  expect(elementSource).toContain('protected _captureError(error: unknown): boolean');
});
