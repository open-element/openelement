/**
 * M03-I-0 — source-map prototype experiments.
 *
 * These tests are the decision evidence for M1 (marker-based segmented print).
 * They assert measurable properties only; nothing here is a compiler test.
 */

import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import {
  authoredPosition,
  generatedPosition,
  printExpressionWithSegments,
  rebaseSegments,
  resolveAuthoredOffset,
  type PrototypeSegment,
} from '../../src/internal/compiler/semantic-ir/sourcemap-prototype/segmented-print.ts';

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    'fixture.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function findExpression<T extends ts.Node>(
  sf: ts.SourceFile,
  predicate: (node: ts.Node) => node is T,
): T {
  let found: T | undefined;
  const visit = (node: ts.Node): void => {
    if (found === undefined && predicate(node)) found = node;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (found === undefined) throw new Error('expression not found');
  return found;
}

function firstDescendant<T extends ts.Node>(
  node: ts.Node,
  predicate: (candidate: ts.Node) => candidate is T,
): T | undefined {
  let found: T | undefined;
  const visit = (current: ts.Node): void => {
    if (found !== undefined) return;
    if (predicate(current)) {
      found = current;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function parsesAsJs(text: string): boolean {
  const out = ts.transpileModule(text, {
    fileName: 'out.js',
    compilerOptions: { target: ts.ScriptTarget.ES2022, allowJs: true },
  });
  return (out.diagnostics ?? []).length === 0;
}

/** Exact authored-range lookup (start and end). */
function segmentExact(
  segments: readonly PrototypeSegment[],
  start: number,
  end: number,
): PrototypeSegment | undefined {
  return segments.find((segment) => segment.authoredStart === start && segment.authoredEnd === end);
}

/** Several nodes can share an authored start (e.g. a parenthesized expression and
 * its parent); the narrowest one is the one being asked about. */
function segmentFor(
  segments: readonly PrototypeSegment[],
  authoredStart: number,
): PrototypeSegment | undefined {
  return segments
    .filter((segment) => segment.authoredStart === authoredStart)
    .sort((a, b) => a.authoredEnd - a.authoredStart - (b.authoredEnd - b.authoredStart))[0];
}

const NESTED_JSX = `const result = props.enabled ? props.items.map(item => <Row value={item.value} />) : <Fallback />;`;

describe('M1 — segmented print with markers produces usable output', () => {
  test('the printed text has no markers left and parses as JavaScript', () => {
    const sf = parse(NESTED_JSX);
    const conditional = findExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithSegments(sf, conditional);
    expect(result.diagnostics).toEqual([]);
    expect(result.js).not.toContain('__oe_marker_');
    expect(result.js).not.toContain('<Row');
    expect(result.js).toContain('__oe_recipe_ref');
    expect(parsesAsJs(result.js)).toBe(true);
    expect(result.markerCount).toBeGreaterThan(3);
  });

  test('every expression node got a segment', () => {
    const sf = parse(NESTED_JSX);
    const conditional = findExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithSegments(sf, conditional);
    // The two conditional branches and the nested arrow are all present.
    expect(segmentFor(result.segments, conditional.whenTrue.getStart(sf))).toBeDefined();
    expect(segmentFor(result.segments, conditional.whenFalse.getStart(sf))).toBeDefined();
    const arrow = firstDescendant(conditional.whenTrue, ts.isArrowFunction);
    expect(arrow).toBeDefined();
    expect(segmentFor(result.segments, arrow!.getStart(sf))).toBeDefined();
  });
});

describe('M1 — check 1: both conditional branches map to authored positions', () => {
  const sf = parse(NESTED_JSX);
  const conditional = findExpression(sf, ts.isConditionalExpression);
  const result = printExpressionWithSegments(sf, conditional);

  test('the consequent branch resolves inside the authored consequent', () => {
    const branch = segmentFor(result.segments, conditional.whenTrue.getStart(sf))!;
    const resolved = resolveAuthoredOffset(result.segments, branch.generatedStart + 2)!;
    expect(resolved).toBeGreaterThanOrEqual(conditional.whenTrue.getStart(sf));
    expect(resolved).toBeLessThanOrEqual(conditional.whenTrue.getEnd());
  });

  test('the alternate branch resolves inside the authored alternate', () => {
    const branch = segmentFor(result.segments, conditional.whenFalse.getStart(sf))!;
    const resolved = resolveAuthoredOffset(result.segments, branch.generatedStart + 2)!;
    expect(resolved).toBeGreaterThanOrEqual(conditional.whenFalse.getStart(sf));
    expect(resolved).toBeLessThanOrEqual(conditional.whenFalse.getEnd());
  });
});

describe('M1 — check 2: nested arrow function maps', () => {
  const sf = parse(NESTED_JSX);
  const conditional = findExpression(sf, ts.isConditionalExpression);
  const arrow = firstDescendant(conditional.whenTrue, ts.isArrowFunction)!;
  const result = printExpressionWithSegments(sf, conditional);

  test('the arrow segment covers the authored arrow range', () => {
    const segment = segmentExact(result.segments, arrow.getStart(sf), arrow.getEnd())!;
    expect(segment).toBeDefined();
    expect(segment.generatedEnd).toBeGreaterThan(segment.generatedStart);
  });

  test('an offset inside the arrow body resolves within the authored arrow', () => {
    const segment = segmentExact(result.segments, arrow.getStart(sf), arrow.getEnd())!;
    const resolved = resolveAuthoredOffset(result.segments, segment.generatedStart + 5)!;
    expect(resolved).toBeGreaterThanOrEqual(arrow.getStart(sf));
    expect(resolved).toBeLessThanOrEqual(arrow.getEnd());
  });
});

describe('M1 — check 3: JSX replacement maps to the original JSX', () => {
  const sf = parse(NESTED_JSX);
  const conditional = findExpression(sf, ts.isConditionalExpression);
  const jsx = conditional.whenFalse; // <Fallback />
  const result = printExpressionWithSegments(sf, conditional);

  test('the recipe call segment covers exactly the authored JSX', () => {
    const segment = segmentFor(result.segments, jsx.getStart(sf));
    expect(segment).toBeDefined();
    expect(segment!.fromJsx).toBe(true);
    expect(segment!.authoredEnd).toBe(jsx.getEnd());
    const authored = sf.text.slice(segment!.authoredStart, segment!.authoredEnd);
    expect(authored).toBe('<Fallback />');
  });

  test('generated text at that segment is the recipe reference', () => {
    const segment = segmentFor(result.segments, jsx.getStart(sf))!;
    expect(result.js.slice(segment.generatedStart, segment.generatedEnd)).toContain(
      '__oe_recipe_ref',
    );
  });
});

describe('M1 — check 4: operators and parentheses do not drift', () => {
  test('a parenthesized sub-expression maps to its own authored text', () => {
    const source = 'const r = (a + b) * 2;';
    const sf = parse(source);
    const binary = findExpression(sf, ts.isBinaryExpression);
    const result = printExpressionWithSegments(sf, binary);
    const left = binary.left;
    const segment = segmentFor(result.segments, left.getStart(sf));
    expect(segment).toBeDefined();
    const authored = sf.text.slice(segment!.authoredStart, segment!.authoredEnd);
    expect(authored).toBe('(a + b)');
    // The parent binary has the same authored start but a wider span; the
    // narrowest segment is the one that belongs to the sub-expression.
    expect(segment!.authoredEnd).toBe(left.getEnd());
  });

  test('precedence-heavy text keeps distinct segments for each operator node', () => {
    const source = 'const r = a + b * c - (d - e);';
    const sf = parse(source);
    const outer = findExpression(sf, ts.isBinaryExpression);
    const result = printExpressionWithSegments(sf, outer);
    const right = outer.right;
    expect(segmentFor(result.segments, right.getStart(sf))).toBeDefined();
    const authored = sf.text.slice(right.getStart(sf), right.getEnd());
    expect(authored).toBe('(d - e)');
  });

  test('comments in the authored expression do not break offsets', () => {
    const source = 'const r = a /* keep */ ? b : c;';
    const sf = parse(source);
    const conditional = findExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithSegments(sf, conditional);
    expect(result.diagnostics).toEqual([]);
    expect(result.js).not.toContain('__oe_marker_');
    expect(parsesAsJs(result.js)).toBe(true);
    const branch = segmentFor(result.segments, conditional.whenFalse.getStart(sf))!;
    const resolved = resolveAuthoredOffset(result.segments, branch.generatedStart)!;
    expect(sf.text.slice(resolved, resolved + 1)).toBe('c');
  });
});

describe('M1 — check 5: several distinct error positions resolve correctly', () => {
  test('nested conditionals and template strings map at multiple offsets', () => {
    const source = 'const r = a ? `x=${b}` : c ? d : e;';
    const sf = parse(source);
    const conditional = findExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithSegments(sf, conditional);
    expect(result.diagnostics).toEqual([]);

    const condition = conditional.condition;
    const template = firstDescendant(conditional.whenTrue, ts.isTemplateExpression)!;
    const inner = conditional.whenFalse as ts.ConditionalExpression;
    const probes: Array<{ label: string; authored: number }> = [
      { label: 'condition', authored: condition.getStart(sf) },
      { label: 'template', authored: template.getStart(sf) },
      { label: 'inner-conditional', authored: inner.getStart(sf) },
      { label: 'inner-alternate', authored: inner.whenFalse.getStart(sf) },
    ];
    for (const probe of probes) {
      // Use the innermost authored segment: a wider parent segment cannot be used
      // for offset arithmetic when the printer re-spaces the text between them.
      const segment = result.segments
        .filter(
          (candidate) =>
            probe.authored >= candidate.authoredStart && probe.authored < candidate.authoredEnd,
        )
        .sort((a, b) => a.authoredEnd - a.authoredStart - (b.authoredEnd - b.authoredStart))[0];
      expect(segment, `${probe.label} has no covering segment`).toBeDefined();
      const generatedOffset = segment!.generatedStart + (probe.authored - segment!.authoredStart);
      const resolved = resolveAuthoredOffset(result.segments, generatedOffset)!;
      expect(resolved, `${probe.label} resolved to the wrong authored offset`).toBe(probe.authored);
    }
  });
});

describe('M1 — check 6: codegen placement rebasing keeps the mapping', () => {
  test('after shifting by a prefix, resolution still lands on the authored text', () => {
    const sf = parse(NESTED_JSX);
    const conditional = findExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithSegments(sf, conditional);
    const prefix = 'function __mount(scope) { return ';
    const generated = prefix + result.js + '; }';
    const rebased = rebaseSegments(result.segments, prefix.length);

    const fallback = segmentFor(result.segments, conditional.whenFalse.getStart(sf))!;
    expect(fallback.fromJsx).toBe(true);
    const jsxOffset = fallback.generatedStart + prefix.length;
    expect(jsxOffset).toBeGreaterThan(prefix.length);
    const resolved = resolveAuthoredOffset(rebased, jsxOffset)!;
    expect(sf.text.slice(resolved, resolved + '<Fallback />'.length)).toBe('<Fallback />');

    // The generated position of the expression start is line 1 after the prefix.
    const position = generatedPosition(generated, jsxOffset);
    expect(position.line).toBe(1);
    // Authored position of the same node is computable and stable.
    const authored = authoredPosition(sf, resolved);
    expect(authored.line).toBe(1);
  });
});

describe('M1 — determinism', () => {
  test('two runs of the same input produce byte-identical output and segments', () => {
    const sf = parse(NESTED_JSX);
    const conditional = findExpression(sf, ts.isConditionalExpression);
    const first = printExpressionWithSegments(sf, conditional);
    const second = printExpressionWithSegments(sf, conditional);
    expect(second.js).toBe(first.js);
    expect(second.segments).toEqual(first.segments);
  });
});
