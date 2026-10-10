/**
 * packages/element/__tests__/compiler-lifecycle-capture-source-map.test.ts —
 * the Source Map v3 half of the compile-time lifecycle capture wrapper
 * (alpha.13 artifact honesty; module ABI v2).
 *
 * The compiler suite (error-boundary-lifecycle-capture.test.ts) pins the
 * wrapper's shape; this suite pins that inserting the `try {` / `} catch`
 * scaffolding kept the map honest: the wrapped body's bytes and columns are
 * unchanged from the verbatim emission, so a STANDARD consumer
 * (@jridgewell/trace-mapping — the dependency lives in this project) still
 * resolves lifecycle body lines to their authored positions and the
 * signature line to the authored method start. The scaffolding lines
 * themselves stay unmapped (pure generated code falls through to the nearest
 * real construct), which is why nothing may map onto them.
 */

import { expect, test } from 'vitest';
import { eachMapping, originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { compileElementProgram } from '../../../packages/compiler/src/internal/compiler/semantic-core/compile.ts';

const FILE = '/project/app/components/lifecycle-map.tsx';

const SOURCE = `import { element, ErrorBoundary, property } from '@openelement/element';

@element('oe-lifecycle-map')
export class LifecycleMap extends ErrorBoundary {
  @property({ reflect: false, attribute: false })
  hasError = false;

  override connectedCallback(): void {
    super.connectedCallback();
    throw new Error('boom at connect');
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
  }

  detonate(): void {
    this.hasError = true;
  }

  render() {
    return <div>{this.hasError ? <p>failed</p> : <slot></slot>}</div>;
  }
}
`;

/** 1-based line / 0-based column of the first occurrence of needle. */
function positionOf(haystack: string, needle: string): { line: number; column: number } {
  const offset = haystack.indexOf(needle);
  expect(offset >= 0, `needle not found: ${needle}`).toBeTruthy();
  const before = haystack.slice(0, offset);
  return {
    line: before.split('\n').length,
    column: offset - (before.lastIndexOf('\n') + 1),
  };
}

test('the wrapped lifecycle body resolves to its authored line and column', () => {
  const { code, map } = compileElementProgram(SOURCE, FILE);
  const trace = new TraceMap(map as ConstructorParameters<typeof TraceMap>[0]);
  const decoded: unknown[] = [];
  eachMapping(trace, (mapping) => decoded.push(mapping));
  expect(decoded.length > 20, 'the segment table stays dense').toBeTruthy();

  const lines = code.split('\n');
  const needle = "throw new Error('boom at connect');";
  const generatedIndex = lines.findIndex((line) => line.includes(needle));
  expect(generatedIndex, 'the wrapped body rides the emitted module').toBeGreaterThan(-1);
  // Byte-identical to the authored line, at its authored column — the
  // continuation mapping's premise.
  expect(lines[generatedIndex]).toEqual(`    ${needle}`);
  const authored = positionOf(SOURCE, needle);
  const resolved = originalPositionFor(trace, {
    line: generatedIndex + 1,
    column: 4,
  });
  expect({ source: resolved.source, line: resolved.line, column: resolved.column }).toEqual({
    source: FILE,
    line: authored.line,
    column: 4,
  });

  // The super call (the line before) keeps its own authored position.
  const superCall = 'super.connectedCallback();';
  const superGenerated = lines.findIndex((line) => line.includes(superCall));
  const superAuthored = positionOf(SOURCE, superCall);
  const superResolved = originalPositionFor(trace, {
    line: superGenerated + 1,
    column: 4,
  });
  expect(superResolved.line).toEqual(superAuthored.line);
  expect(superResolved.column).toEqual(4);
});

test('the lifecycle signature resolves to the authored method start, non-lifecycle methods verbatim', () => {
  const { code, map } = compileElementProgram(SOURCE, FILE);
  const trace = new TraceMap(map as ConstructorParameters<typeof TraceMap>[0]);
  const lines = code.split('\n');

  const signature = 'override connectedCallback(): void {';
  const signatureGenerated = lines.findIndex((line) => line === `  ${signature}`);
  const signatureAuthored = positionOf(SOURCE, signature);
  expect(signatureGenerated).toBeGreaterThan(-1);
  const resolved = originalPositionFor(trace, {
    line: signatureGenerated + 1,
    column: 2,
  });
  expect({
    source: resolved.source,
    line: resolved.line,
    column: resolved.column,
    name: resolved.name,
  }).toEqual({
    source: FILE,
    line: signatureAuthored.line,
    column: 2,
    name: 'connectedCallback',
  });

  // A non-lifecycle method keeps the verbatim emission mapping (unwrapped).
  const detonate = 'detonate(): void {';
  const detonateGenerated = lines.findIndex((line) => line === `  ${detonate}`);
  expect(detonateGenerated).toBeGreaterThan(-1);
  const detonateAuthored = positionOf(SOURCE, detonate);
  const detonateResolved = originalPositionFor(trace, {
    line: detonateGenerated + 1,
    column: 2,
  });
  expect(detonateResolved.line).toEqual(detonateAuthored.line);
  expect(detonateResolved.name).toEqual('detonate');
});

test('the wrapper scaffolding lines carry no mapping of their own', () => {
  const { code, map } = compileElementProgram(SOURCE, FILE);
  const trace = new TraceMap(map as ConstructorParameters<typeof TraceMap>[0]);
  const lines = code.split('\n');
  const tryIndex = lines.findIndex(
    (line, index) =>
      line === '  try {' && lines[index - 1]?.includes('override connectedCallback(): void {'),
  );
  expect(tryIndex).toBeGreaterThan(-1);
  const resolved = originalPositionFor(trace, { line: tryIndex + 1, column: 2 });
  // No segment was emitted for the `try {` line: the consumer falls through
  // to the nearest real construct (the method's own first-line mapping on the
  // signature line above), never a fabricated authored position.
  expect(resolved.line).toEqual(null);
  expect(resolved.column).toEqual(null);
});
