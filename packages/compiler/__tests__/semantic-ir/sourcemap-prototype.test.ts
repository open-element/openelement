/**
 * M03-I-0 — source-map prototype experiments (anchor-based revision, round 2).
 *
 * Verification is independent of the mapping arithmetic: node text comes from a
 * separate `printer.printNode` call, JSX replacements are located by an
 * independent string search for the recipe call, and the produced Source Map v3
 * is fully decoded (all five VLQ fields) and compared coordinate by coordinate.
 */

import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import {
  authoredPosition,
  extendNamespace,
  generatedPosition,
  hashText,
  mappingPointsFor,
  markerNamespaceFor,
  printExpressionWithAnchors,
  rebaseAnchors,
  resolveAnchor,
  scanMarkers,
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

function findDescendant<T extends ts.Node>(
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

function squeeze(text: string): string {
  return text.replace(/\s+/g, '');
}

function anchorExact(
  anchors: readonly PrintAnchor[],
  start: number,
  end: number,
): PrintAnchor | undefined {
  return anchors.find((anchor) => anchor.authoredStart === start && anchor.authoredEnd === end);
}

function narrowestAt(
  anchors: readonly PrintAnchor[],
  authoredStart: number,
): PrintAnchor | undefined {
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

  test('author comments that mimic markers survive', () => {
    const source = 'const r = a /*__oe_marker_s0*/ ? b : c; // /*__oe_m_deadbeef_s1*/ too';
    const sf = parse(source);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);
    expect(result.diagnostics).toEqual([]);
    expect(result.js).toContain('__oe_marker_s0');
  });

  test('the namespace extension branch is exercised when the source contains a candidate', () => {
    const source = 'const r = /*__oe_m_abc_*/ a;';
    // A candidate that occurs in the source must be extended until it does not.
    expect(extendNamespace(source, '__oe_m_abc_')).toBe('__oe_m_abc_x');
    expect(extendNamespace('no collision here', '__oe_m_abc_')).toBe('__oe_m_abc_');
    // Deterministic for the same input.
    const sf = parse(source);
    expect(markerNamespaceFor(sf)).toBe(markerNamespaceFor(sf));
    expect(sf.text.includes(markerNamespaceFor(sf))).toBe(false);
    expect(hashText('abc')).toBe(hashText('abc'));
  });

  test('unknown, duplicate, missing and unpaired markers fail closed', () => {
    const namespace = '__oe_m_test_';
    const expected = new Set([0]);
    const good = `/*${namespace}s0*/ a /*${namespace}e0*/`;
    expect(scanMarkers(good, namespace, expected).diagnostics).toEqual([]);

    const unknown = `/*${namespace}s9*/ a`;
    expect(scanMarkers(unknown, namespace, expected).diagnostics.join()).toContain(
      'unknown marker id 9',
    );

    const duplicate = `/*${namespace}s0*/a/*${namespace}s0*/`;
    expect(scanMarkers(duplicate, namespace, expected).diagnostics.join()).toContain(
      'appears 2 times',
    );

    const missingEnd = `/*${namespace}s0*/ a`;
    expect(scanMarkers(missingEnd, namespace, expected).diagnostics.join()).toContain(
      'end marker 0 is missing',
    );

    const unpaired = `/*${namespace}e0*/ a`;
    expect(scanMarkers(unpaired, namespace, expected).diagnostics.join()).toContain(
      'start marker 0 is missing',
    );
  });
});

describe('M1 — check 1: both conditional branches', () => {
  test('each branch anchor matches its own printed form', () => {
    const sf = parse(NESTED_JSX);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);

    const consequent = anchorExact(
      result.anchors,
      conditional.whenTrue.getStart(sf),
      conditional.whenTrue.getEnd(),
    )!;
    expect(squeeze(result.js.slice(consequent.generatedStart, consequent.generatedEnd))).toContain(
      'props.items.map',
    );

    const alternate = anchorExact(
      result.anchors,
      conditional.whenFalse.getStart(sf),
      conditional.whenFalse.getEnd(),
    )!;
    expect(alternate.fromJsx).toBe(true);
    expect(squeeze(result.js.slice(alternate.generatedStart, alternate.generatedEnd))).toContain(
      '__oe_recipe_ref("r1")',
    );
  });
});

describe('M1 — check 2: exact ArrowFunction anchor', () => {
  test('the arrow anchor is selected by its full authored span and matches the generated arrow', () => {
    const sf = parse(NESTED_JSX);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const arrow = findDescendant(conditional.whenTrue, ts.isArrowFunction)!;
    const result = printExpressionWithAnchors(sf, conditional);

    const anchor = anchorExact(result.anchors, arrow.getStart(sf), arrow.getEnd(sf));
    expect(anchor, 'no anchor covering the whole arrow').toBeDefined();
    expect(anchor!.kind).toBe('ArrowFunction');

    // Independent generated position: the arrow starts at its parameter.
    const arrowMatch = /item\s*=>/.exec(result.js);
    expect(arrowMatch, 'arrow not found in the generated text').not.toBeNull();
    expect(anchor!.generatedStart).toBe(arrowMatch!.index);
    expect(anchor!.fromJsx).toBe(false);
  });
});

describe('M1 — check 3: JSX replacement anchors for Row and Fallback', () => {
  test('both recipe calls are found independently and anchor to their JSX spans', () => {
    const sf = parse(NESTED_JSX);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const row = findDescendant(conditional.whenTrue, ts.isJsxSelfClosingElement)!;
    const fallback = conditional.whenFalse;
    const result = printExpressionWithAnchors(sf, conditional);

    const cases: Array<{ id: string; jsx: ts.Node; authored: string }> = [
      { id: 'r0', jsx: row, authored: '<Row value={item.value} />' },
      { id: 'r1', jsx: fallback, authored: '<Fallback />' },
    ];

    for (const entry of cases) {
      const call = `__oe_recipe_ref("${entry.id}")`;
      const generatedOffset = result.js.indexOf(call);
      expect(generatedOffset, `${entry.id} not found`).toBeGreaterThan(-1);

      const anchor = anchorExact(result.anchors, entry.jsx.getStart(sf), entry.jsx.getEnd(sf));
      expect(anchor, `${entry.id} has no anchor`).toBeDefined();
      expect(anchor!.fromJsx).toBe(true);
      expect(sf.text.slice(anchor!.authoredStart, anchor!.authoredEnd)).toBe(entry.authored);
      expect(anchor!.generatedStart).toBe(generatedOffset);

      // A replacement longer than its authored text must not drift internally.
      for (let delta = 0; delta < call.length; delta++) {
        expect(resolveAnchor(result.anchors, generatedOffset + delta)!.authoredStart).toBe(
          entry.jsx.getStart(sf),
        );
      }
    }
  });
});

describe('M1 — check 4: operators, parentheses, comments', () => {
  test('the parenthesized node maps to its independently printed text', () => {
    const sf = parse('const r = (a + b) * 2;');
    const binary = firstExpression(sf, ts.isBinaryExpression);
    const left = binary.left;
    const result = printExpressionWithAnchors(sf, binary);
    const anchor = narrowestAt(result.anchors, left.getStart(sf))!;
    const printed = ts.createPrinter().printNode(ts.EmitHint.Expression, left, sf);
    expect(printed).toBe('(a + b)');
    expect(squeeze(result.js.slice(anchor.generatedStart, anchor.generatedEnd))).toBe(
      squeeze(printed),
    );
  });

  test('precedence-heavy text anchors each node at its own text', () => {
    const sf = parse('const r = a + b * c - (d - e);');
    const outer = firstExpression(sf, ts.isBinaryExpression);
    const result = printExpressionWithAnchors(sf, outer);
    const right = outer.right;
    const anchor = narrowestAt(result.anchors, right.getStart(sf))!;
    expect(squeeze(result.js.slice(anchor.generatedStart, anchor.generatedEnd))).toBe(
      squeeze(ts.createPrinter().printNode(ts.EmitHint.Expression, right, sf)),
    );
  });

  test('authored comments survive and do not break anchors', () => {
    const sf = parse('const r = a /* keep */ ? b : c;');
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);
    expect(result.diagnostics).toEqual([]);
    expect(parsesAsJs(result.js)).toBe(true);
    expect(result.js).toContain('keep');
    const alternate = narrowestAt(result.anchors, conditional.whenFalse.getStart(sf))!;
    expect(squeeze(result.js.slice(alternate.generatedStart, alternate.generatedEnd))).toBe('c');
  });
});

describe('M1 — check 5: multiple positions and real deepest-wins tie breaking', () => {
  test('every identifier anchor matches its own name', () => {
    const sf = parse('const r = a ? `x=${b}` : c ? d : e;');
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);
    const identifiers: ts.Identifier[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) identifiers.push(node);
      ts.forEachChild(node, visit);
    };
    visit(conditional);
    for (const identifier of identifiers) {
      const anchor = narrowestAt(result.anchors, identifier.getStart(sf));
      expect(anchor, `no anchor for ${identifier.text}`).toBeDefined();
      expect(squeeze(result.js.slice(anchor!.generatedStart, anchor!.generatedEnd))).toBe(
        identifier.text,
      );
    }
  });

  test('at one generated position the deepest anchor wins and carries its own span', () => {
    const sf = parse('const r = a + b;');
    const binary = firstExpression(sf, ts.isBinaryExpression);
    const left = binary.left; // `a`
    const result = printExpressionWithAnchors(sf, binary);

    const binaryAnchor = anchorExact(result.anchors, binary.getStart(sf), binary.getEnd(sf))!;
    const leftAnchor = narrowestAt(result.anchors, left.getStart(sf))!;
    // Both start at the same generated offset: the parent and its first child.
    expect(binaryAnchor.generatedStart).toBe(leftAnchor.generatedStart);

    const candidates = result.anchors.filter(
      (anchor) => anchor.generatedStart === binaryAnchor.generatedStart,
    );
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    const deepest = candidates.reduce((best, anchor) =>
      anchor.depth > best.depth ? anchor : best,
    );
    expect(deepest.authoredEnd - deepest.authoredStart).toBe(1); // identifier `a`
    expect(deepest.authoredStart).toBe(sf.text.indexOf('a + b'));

    const resolved = resolveAnchor(result.anchors, binaryAnchor.generatedStart)!;
    expect(resolved.depth).toBe(deepest.depth);
    expect(resolved.authoredStart).toBe(leftAnchor.authoredStart);
    expect(resolved.authoredEnd).toBe(leftAnchor.authoredEnd);
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

    const jsx = anchorExact(
      result.anchors,
      conditional.whenFalse.getStart(sf),
      conditional.whenFalse.getEnd(),
    )!;
    const shifted = rebased.find((anchor) => anchor.authoredStart === jsx.authoredStart)!;
    const position = generatedPosition(generated, shifted.generatedStart);
    expect(position.line).toBe(2);
    expect(authoredPosition(sf, shifted.authoredStart)).toEqual(
      authoredPosition(sf, jsx.authoredStart),
    );
  });
});

describe('M1 — unary operators and ASI-sensitive adjacency', () => {
  const cases = ['a + +b', 'a - -b', 'a++', '++b', 'a + ++b', 'x ?? y', 'a\n+ b'];

  for (const source of cases) {
    test(`"${source.replace(/\n/g, '\\n')}" survives markers and keeps its meaning`, () => {
      const sf = parse(`const r = ${source};`);
      const declaration = findDescendant(sf, ts.isVariableDeclaration)!;
      const initializer = declaration.initializer!;
      const result = printExpressionWithAnchors(sf, initializer);
      expect(result.diagnostics).toEqual([]);
      expect(parsesAsJs(result.js)).toBe(true);
      // The stripped text evaluates the same way as the authored expression.
      const strip = (text: string): string => text.replace(/\s+/g, '');
      expect(strip(result.js)).toBe(
        strip(sf.text.slice(initializer.getStart(sf), initializer.getEnd())),
      );
    });
  }

  test('a newline inside the expression does not change stripping or parsing', () => {
    const sf = parse('const r = a\n  + b;');
    const binary = firstExpression(sf, ts.isBinaryExpression);
    const result = printExpressionWithAnchors(sf, binary);
    expect(result.diagnostics).toEqual([]);
    expect(parsesAsJs(result.js)).toBe(true);
    expect(result.js.replace(/\s+/g, '')).toBe('a+b');
  });
});

describe('M1 — Source Map v3 with full coordinates', () => {
  test('merged mapping points decode back to the same generated/source coordinates', () => {
    const sf = parse(NESTED_JSX);
    const conditional = firstExpression(sf, ts.isConditionalExpression);
    const result = printExpressionWithAnchors(sf, conditional);

    const points = mappingPointsFor(result.anchors, result.js, sf);
    // One point per generated line/column, deepest node survives.
    const keys = points.map((point) => `${point.generatedLine}:${point.generatedColumn}`);
    expect(new Set(keys).size).toBe(points.length);

    const builder = new SourceMapSegmentBuilder();
    for (const point of points) builder.add(point);
    const map = builder.build('fixture.tsx', sf.text);
    const decoded = decodeMappings(map.mappings);

    expect(decoded.length).toBe(points.length);
    for (let index = 0; index < decoded.length; index++) {
      const entry = decoded[index]!;
      const point = points[index]!;
      expect(entry.generatedLine).toBe(point.generatedLine);
      expect(entry.generatedColumn).toBe(point.generatedColumn);
      expect(entry.sourceIndex).toBe(0);
      expect(entry.sourceLine).toBe(point.sourceLine);
      expect(entry.sourceColumn).toBe(point.sourceColumn);
      expect(entry.nameIndex).toBeGreaterThanOrEqual(0);
      expect(map.names[entry.nameIndex]).toBe(point.name);
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

interface DecodedSegment {
  generatedLine: number;
  generatedColumn: number;
  sourceIndex: number;
  sourceLine: number;
  sourceColumn: number;
  nameIndex: number;
}

/** Full Source Map v3 `mappings` decoder for one source (all five fields). */
function decodeMappings(mappings: string): DecodedSegment[] {
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const decodeVlq = (segment: string): number[] => {
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
  };

  const out: DecodedSegment[] = [];
  const lines = mappings.split(';');
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let nameIndex = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let generatedColumn = 0;
    for (const segment of lines[lineIndex]!.split(',')) {
      if (segment.length === 0) continue;
      const values = decodeVlq(segment);
      generatedColumn += values[0]!;
      if (values.length >= 4) {
        sourceIndex += values[1]!;
        sourceLine += values[2]!;
        sourceColumn += values[3]!;
        if (values.length >= 5) nameIndex += values[4]!;
        out.push({
          generatedLine: lineIndex + 1,
          generatedColumn,
          sourceIndex,
          sourceLine: sourceLine + 1,
          sourceColumn,
          nameIndex,
        });
      }
    }
  }
  return out;
}
