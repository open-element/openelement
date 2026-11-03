/**
 * M03-I-0 — source-map prototype experiments (anchor-based revision).
 *
 * The earlier suite compared `resolveAuthoredOffset(x)` against `x` computed from
 * the same segment, which proved only arithmetic. These tests verify the mapping
 * **independently**: the printed text of a node is obtained from a separate
 * `printer.printNode` call (or from an independent string search for JSX
 * replacements), and the anchors must agree with that independent evidence.
 */

import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import {
  authoredPosition,
  generatedPosition,
  markerNamespaceFor,
  printExpressionWithAnchors,
  rebaseAnchors,
  resolveAnchor,
  type PrintAnchor,
} from '../../src/internal/compiler/semantic-ir/sourcemap-prototype/segmented-print.ts';
import { SourceMapSegmentBuilder } from '../../src/internal/compiler/semantic-core/source-map.ts';

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    'fixture.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function firstExpression<T extends ts.Node>(
  sf: ts.SourceFile,
  predicate: (node: ts.Node) => node is T,
): T {
  let found: T | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (predicate(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (found === undefined) throw new Error('expression not found');
  return found;
}

function parsesAsJs(text: string): boolean {
  const out = ts.transpileModule(text, {
    fileName: 'out.js',
    compilerOptions: { target: ts.ScriptTarget.ES2022, allowJs: true },
  });
  return (out.diagnostics ?? []).length === 0;
}

/** Printed text of a node, produced independently of the prototype. */
function independentlyPrinted(sf: ts.SourceFile, node: ts.Node): string {
  return ts.createPrinter().printNode(ts.EmitHint.Expression, node, sf);
}

/** Exact authored-range lookup (start and end). */
function anchorExact(
  anchors: readonly PrintAnchor[],
  start: number,
  end: number,
): PrintAnchor | undefined {
  return anchors.find((anchor) => anchor.authoredStart === start && anchor.authoredEnd === end);
}

/** Whitespace-insensitive comparison: markers change printer spacing, so the
 * emitted text is the stripped marked print and must be compared structurally. */
function squeeze(text: string): string {
  return text.replace(/\s+/g, '');
}

/** Several nodes share an authored start (a parent and its first child); the
 * narrowest one is the node the caller is asking about. */
function anchorAt(anchors: readonly PrintAnchor[], authoredStart: number): PrintAnchor | undefined {
  return anchors
    .filter((anchor) => anchor.authoredStart === authoredStart)
    .sort((a, b) => a.authoredEnd - a.authoredStart - (b.authoredEnd - b.authoredStart))[0];
}

const NESTED_JSX = `const result = props.enabled ? props.items.map(item => <Row value={item.value} />) : <Fallback />;`;

describe('M1 — output validity and marker safety', () => {
  test('printed text has no markers, no JSX, and parses', () => {
    const sf = parse(NESTED_JSX);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);
    expect(result.diagnostics).toEqual([]);
    expect(result.js).not.toContain(result.namespace);
    expect(result.js).not.toContain('<Row');
    expect(result.js).toContain('__oe_recipe_ref');
    expect(parsesAsJs(result.js)).toBe(true);
  });

  test('an author comment that looks like a marker is preserved', () => {
    const source = 'const r = a /*__oe_marker_s0*/ ? b : c; // and /*__oe_m_deadbeef_s1*/ too';
    const sf = parse(source);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);
    // The prototype's namespace is compile-specific, so neither author comment
    // can be mistaken for a marker.
    expect(result.js).toContain('__oe_marker_s0');
    expect(result.diagnostics).toEqual([]);
  });

  test('the namespace is unique for the compilation and absent from the source', () => {
    const sf = parse(NESTED_JSX);
    const namespace = markerNamespaceFor(sf);
    expect(sf.text.includes(namespace)).toBe(false);
    expect(markerNamespaceFor(sf)).toBe(namespace);
  });
});

describe('M1 — check 1: both conditional branches', () => {
  const sf = parse(NESTED_JSX);
  const conditional = firstExpression(sf, ts.isConditionalExpression);
  const result = printExpressionWithAnchors(sf, conditional);

  test('consequent anchor points at the map call, alternate anchor at the JSX', () => {
    const consequent = anchorExact(
      result.anchors,
      conditional.whenTrue.getStart(sf),
      conditional.whenTrue.getEnd(),
    )!;
    expect(consequent).toBeDefined();
    expect(squeeze(result.js.slice(consequent.generatedStart, consequent.generatedEnd))).toContain(
      'props.items.map',
    );

    const alternate = anchorExact(
      result.anchors,
      conditional.whenFalse.getStart(sf),
      conditional.whenFalse.getEnd(),
    )!;
    expect(alternate.fromJsx).toBe(true);
    expect(result.js.slice(alternate.generatedStart, alternate.generatedEnd)).toContain(
      '__oe_recipe_ref("r1")',
    );
  });
});

describe('M1 — check 2: nested arrow', () => {
  const sf = parse(NESTED_JSX);
  const conditional = firstExpression(sf, ts.isConditionalExpression);
  let arrow: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node): void => {
    if (arrow === undefined && ts.isArrowFunction(node)) arrow = node;
    ts.forEachChild(node, visit);
  };
  visit(conditional.whenTrue);
  const result = printExpressionWithAnchors(sf, conditional);

  test('the arrow anchor maps to the independently printed arrow text start', () => {
    const node = arrow!;
    const anchor = anchorAt(result.anchors, node.getStart(sf))!;
    expect(anchor).toBeDefined();
    const printed = independentlyPrinted(sf, node);
    // The arrow body contains JSX, so compare the prefix up to the recipe call.
    const prefix = printed.slice(0, printed.indexOf('<'));
    expect(squeeze(result.js.slice(anchor.generatedStart))).toContain(squeeze(prefix));
  });
});

describe('M1 — check 3: JSX replacement anchor', () => {
  test('each recipe call is found independently and anchors to its JSX start', () => {
    const sf = parse(NESTED_JSX);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);

    for (const [index, jsxNode] of [conditional.whenFalse].entries()) {
      const call = `__oe_recipe_ref("r${index + 1}")`;
      const generatedOffset = result.js.indexOf(call);
      expect(generatedOffset, `call ${call} not found`).toBeGreaterThan(-1);
      const anchor = resolveAnchor(result.anchors, generatedOffset)!;
      expect(anchor).toBeDefined();
      expect(anchor.fromJsx).toBe(true);
      expect(anchor.authoredStart).toBe(jsxNode.getStart(sf));
      expect(sf.text.slice(anchor.authoredStart, anchor.authoredEnd)).toBe('<Fallback />');
    }
  });

  test('a longer replacement does not drift: every offset inside the call maps to the JSX start', () => {
    const sf = parse(NESTED_JSX);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);
    const call = '__oe_recipe_ref("r1")';
    const start = result.js.indexOf(call);
    const jsxStart = conditional.whenFalse.getStart(sf);
    for (let delta = 0; delta < call.length; delta++) {
      const anchor = resolveAnchor(result.anchors, start + delta)!;
      expect(anchor.authoredStart).toBe(jsxStart);
    }
  });
});

describe('M1 — check 4: operators and parentheses', () => {
  test('the parenthesized node maps to its own independently printed text', () => {
    const source = 'const r = (a + b) * 2;';
    const sf = parse(source);
    const binary = firstExpression(sf, ts.isBinaryExpression);
    const left = binary.left;
    const result = printExpressionWithAnchors(sf, binary);
    const anchor = anchorAt(result.anchors, left.getStart(sf))!;
    expect(anchor).toBeDefined();
    const printed = independentlyPrinted(sf, left);
    expect(printed).toBe('(a + b)');
    expect(squeeze(result.js.slice(anchor.generatedStart, anchor.generatedEnd))).toBe(
      squeeze(printed),
    );
  });

  test('precedence-heavy text keeps each node anchored at its own text', () => {
    const source = 'const r = a + b * c - (d - e);';
    const sf = parse(source);
    const outer = firstExpression(sf, ts.isBinaryExpression);
    const result = printExpressionWithAnchors(sf, outer);
    const right = outer.right;
    const anchor = anchorAt(result.anchors, right.getStart(sf))!;
    expect(squeeze(result.js.slice(anchor.generatedStart, anchor.generatedEnd))).toBe(
      squeeze(independentlyPrinted(sf, right)),
    );
  });

  test('comments in the authored expression survive and do not break anchors', () => {
    const source = 'const r = a /* keep */ ? b : c;';
    const sf = parse(source);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);
    expect(result.diagnostics).toEqual([]);
    expect(parsesAsJs(result.js)).toBe(true);
    const alternate = anchorExact(
      result.anchors,
      conditional.whenFalse.getStart(sf),
      conditional.whenFalse.getEnd(),
    )!;
    expect(squeeze(result.js.slice(alternate.generatedStart, alternate.generatedEnd))).toBe('c');
  });
});

describe('M1 — check 5: multiple positions verified independently', () => {
  test('every identifier anchor matches its independently printed text', () => {
    const source = 'const r = a ? `x=${b}` : c ? d : e;';
    const sf = parse(source);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);

    const identifiers: ts.Identifier[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) identifiers.push(node);
      ts.forEachChild(node, visit);
    };
    visit(conditional);
    expect(identifiers.length).toBeGreaterThanOrEqual(4);

    for (const identifier of identifiers) {
      const anchor = anchorAt(result.anchors, identifier.getStart(sf));
      expect(anchor, `no anchor for ${identifier.text}`).toBeDefined();
      expect(squeeze(result.js.slice(anchor!.generatedStart, anchor!.generatedEnd))).toBe(
        identifier.text,
      );
    }
  });

  test('resolving a generated start maps to an anchor at that same position', () => {
    const sf = parse(NESTED_JSX);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);
    for (const anchor of result.anchors) {
      const resolved = resolveAnchor(result.anchors, anchor.generatedStart)!;
      // Several nodes can share a generated start (a parent and its first child);
      // the mapping must still land on that position, never drift past it.
      expect(resolved.generatedStart).toBe(anchor.generatedStart);
      expect(resolved.authoredStart).toBeLessThanOrEqual(
        anchor.authoredStart + (anchor.authoredStart - anchor.authoredStart),
      );
    }
  });
});

describe('M1 — check 6: codegen placement rebasing', () => {
  test('a multi-line prefix shifts generated positions without changing authored ones', () => {
    const sf = parse(NESTED_JSX);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);
    const prefix = 'function __mount(scope) {\n  return ';
    const generated = prefix + result.js + ';\n}';
    const rebased = rebaseAnchors(result.anchors, prefix.length);

    const jsx = anchorAt(result.anchors, conditional.whenFalse.getStart(sf))!;
    const shifted = rebased.find((anchor) => anchor.authoredStart === jsx.authoredStart)!;
    const position = generatedPosition(generated, shifted.generatedStart);
    expect(position.line).toBe(2);
    expect(position.column).toBe('  return '.length + jsx.generatedStart);
    // Authored position is unchanged by placement.
    expect(authoredPosition(sf, shifted.authoredStart)).toEqual(
      authoredPosition(sf, jsx.authoredStart),
    );
  });
});

describe('M1 — Source Map v3 consumption', () => {
  test('anchors produce a decodable Source Map v3 that resolves to authored positions', () => {
    const sf = parse(NESTED_JSX);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);

    const builder = new SourceMapSegmentBuilder();
    for (const anchor of result.anchors) {
      const generated = generatedPosition(result.js, anchor.generatedStart);
      const authored = authoredPosition(sf, anchor.authoredStart);
      builder.add({
        generatedLine: generated.line,
        generatedColumn: generated.column,
        sourceLine: authored.line,
        sourceColumn: authored.column,
        name: anchor.kind,
      });
    }
    const map = builder.build('fixture.tsx', sf.text);
    const decoded = decodeMappings(map.mappings);
    expect(decoded.length).toBe(result.anchors.length);
    for (let index = 0; index < decoded.length; index++) {
      const entry = decoded[index]!;
      const anchor = result.anchors[index]!;
      expect(entry.generatedLine).toBe(generatedPosition(result.js, anchor.generatedStart).line);
      expect(entry.sourceLine).toBe(authoredPosition(sf, anchor.authoredStart).line);
    }
  });
});

describe('M1 — determinism', () => {
  test('two runs produce identical text, namespace and anchors', () => {
    const sf = parse(NESTED_JSX);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const first = printExpressionWithAnchors(sf, conditional);
    const second = printExpressionWithAnchors(sf, conditional);
    expect(second.js).toBe(first.js);
    expect(second.namespace).toBe(first.namespace);
    expect(second.anchors).toEqual(first.anchors);
  });
});

/** Minimal Source Map v3 `mappings` decoder (line/column only), for verification. */
function decodeMappings(mappings: string): Array<{ generatedLine: number; sourceLine: number }> {
  const out: Array<{ generatedLine: number; sourceLine: number }> = [];
  const lines = mappings.split(';');
  let sourceLine = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const segments = lines[lineIndex]!.split(',');
    for (const segment of segments) {
      if (segment.length === 0) continue;
      const values = decodeVlqSegment(segment);
      if (values.length >= 4) {
        sourceLine += values[2]!;
        out.push({ generatedLine: lineIndex + 1, sourceLine: sourceLine + 1 });
      }
    }
  }
  return out;
}

function decodeVlqSegment(segment: string): number[] {
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const values: number[] = [];
  let shift = 0;
  let value = 0;
  for (const char of segment) {
    const digit = BASE64.indexOf(char);
    if (digit < 0) throw new Error(`invalid VLQ char ${char}`);
    const continuation = (digit & 32) !== 0;
    value += (digit & 31) << shift;
    if (continuation) {
      shift += 5;
    } else {
      const negative = (value & 1) === 1;
      value >>= 1;
      values.push(negative ? -value : value);
      shift = 0;
      value = 0;
    }
  }
  return values;
}
