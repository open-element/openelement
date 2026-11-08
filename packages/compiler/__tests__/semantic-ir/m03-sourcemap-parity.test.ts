/**
 * M03-I-4b — expression-level source-map parity (owner-approved D4 item b).
 *
 * The A2 expression registry emits Source Map v3 segments in the shared
 * `EmissionSegment` convention. This harness decodes them through
 * `@jridgewell/trace-mapping` — the repository's established source-map
 * consumer — and asserts the mapping properties M03 parity requires, against
 * the Alpha15 class frontend's map convention. The END-TO-END generated-module
 * map remains M05; A4b claims expression-level parity only.
 *
 * Corpus: plain expressions, JSX→recipe-ref substitution (longer generated
 * text), erasure (shorter text), multi-line positions, and the
 * anchors-vs-ranges drift case (a position inside a replacement resolves to the
 * authored node start, never to interpolated arithmetic).
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { eachMapping, originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import ts from 'typescript';
import { compileElementProgram } from '../../src/internal/compiler/semantic-core/compile.ts';
import {
  createExpressionRegistry,
  type LoweredExpressionRecord,
} from '../../src/internal/compiler/semantic-core/expression-registry.ts';
import { SourceMapSegmentBuilder } from '../../src/internal/compiler/semantic-core/source-map.ts';
import {
  resolveModule,
  type ImportClassifier,
} from '../../src/internal/compiler/semantic-core/scope-resolution.ts';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';

const FILE = '/proj/src/sourcemap-parity.tsx';
const RECIPE_CALLEE = '__oe_recipe_ref';

const classifier: ImportClassifier = {
  classifySymbol: (specifier, importedName) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal' || importedName === 'computed') return 'factory';
    return 'value';
  },
  classifyValue: () => undefined,
  classifyCall: (specifier, importedName) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal') return { call: 'signal' };
    if (importedName === 'computed') return { call: 'computed' };
    return undefined;
  },
};

function findAll<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function findNode<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T {
  const found = findAll(root, predicate);
  if (found.length === 0) throw new Error('node not found');
  return found[0]!;
}

interface LoweredFixture {
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly record: LoweredExpressionRecord;
  readonly expressionStart: number;
  readonly expressionEnd: number;
  readonly jsxSpans: readonly { start: number; end: number }[];
}

function lowerFixture(
  source: string,
  pick: (sourceFile: ts.SourceFile) => ts.Node,
): LoweredFixture {
  const sourceFile = ts.createSourceFile(
    FILE,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  const module = resolveModule(sourceFile, { components: [], importClassifier: classifier });
  const jsx = findAll(
    sourceFile,
    (node): node is ts.JsxElement | ts.JsxSelfClosingElement =>
      ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node),
  );
  const registry = createExpressionRegistry({
    module,
    recipeReference: (node) => {
      const index = jsx.indexOf(node as ts.JsxElement);
      return index < 0 ? undefined : { callee: RECIPE_CALLEE, id: `r${index}` };
    },
  });
  const expression = pick(sourceFile);
  const result = registry.lower(expression, 'inline');
  expect(result.diagnostics).toEqual([]);
  const record = result.record!;
  return {
    source,
    sourceFile,
    record,
    expressionStart: expression.getStart(sourceFile),
    expressionEnd: expression.getEnd(),
    jsxSpans: jsx.map((node) => ({
      start: node.getStart(sourceFile),
      end: node.getEnd(sourceFile),
    })),
  };
}

/** Build the Source Map v3 for one lowered expression, in the shared convention. */
function expressionMap(fixture: LoweredFixture): TraceMap {
  const builder = new SourceMapSegmentBuilder();
  for (const segment of fixture.record.segments) builder.add(segment);
  const map = builder.build('sourcemap-parity.tsx', fixture.source);
  return new TraceMap(map as unknown as Parameters<typeof TraceMap>[0]);
}

function authoredPosition(
  sourceFile: ts.SourceFile,
  offset: number,
): { line: number; column: number } {
  const position = sourceFile.getLineAndCharacterOfPosition(offset);
  return { line: position.line + 1, column: position.character };
}

function generatedPosition(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  return { line: before.split('\n').length, column: offset - (before.lastIndexOf('\n') + 1) };
}

/** Every segment round-trips through the real consumer to its authored position. */
function expectSegmentsRoundTrip(fixture: LoweredFixture): void {
  const map = expressionMap(fixture);
  for (const segment of fixture.record.segments) {
    const original = originalPositionFor(map, {
      line: segment.generatedLine,
      column: segment.generatedColumn,
    });
    expect(original.source).toBe('sourcemap-parity.tsx');
    expect(original.line).toBe(segment.sourceLine);
    expect(original.column).toBe(segment.sourceColumn);
  }
}

/** `true` when some decoded mapping resolves to the authored position. */
function mapHasAuthoredPosition(
  map: TraceMap,
  position: { line: number; column: number },
): boolean {
  let found = false;
  eachMapping(map, (mapping) => {
    if (mapping.originalLine === position.line && mapping.originalColumn === position.column) {
      found = true;
    }
  });
  return found;
}

const FUNCTION_SOURCE = `function Fixture(props) {
  const count = props.count as number;
  return <main title={props.label}>{count}</main>;
}`;

describe('M03-I-4b — expression segments decode through @jridgewell/trace-mapping', () => {
  test('the pinned consumer version is 0.3.31 (the router/element pin)', () => {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve('@jridgewell/trace-mapping/package.json');
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as { version: string };
    expect(manifest.version).toBe('0.3.31');
  });

  test('plain expression: every segment round-trips to its authored position', () => {
    const fixture = lowerFixture(FUNCTION_SOURCE, (sourceFile) =>
      findNode(
        sourceFile,
        (node): node is ts.Expression =>
          ts.isExpression(node) &&
          node.getStart(sourceFile) === sourceFile.text.indexOf('props.count as number'),
      ),
    );
    expectSegmentsRoundTrip(fixture);
    const map = expressionMap(fixture);
    expect(
      mapHasAuthoredPosition(map, authoredPosition(fixture.sourceFile, fixture.expressionStart)),
    ).toBe(true);
  });

  test('erasure shrink: shorter generated text still maps every segment back', () => {
    const fixture = lowerFixture(FUNCTION_SOURCE, (sourceFile) =>
      findNode(sourceFile, ts.isAsExpression),
    );
    expect(fixture.record.lowered.replace(/\s+/g, '')).toBe('props.count');
    expect(fixture.expressionEnd - fixture.expressionStart).toBeGreaterThan(
      fixture.record.lowered.trim().length,
    );
    expectSegmentsRoundTrip(fixture);
  });

  test('JSX→recipe-ref substitution: an offset inside the longer replacement maps to the JSX start', () => {
    const source = `function Fixture(props) {
  return <main title={props.ok ? <b>yes</b> : <i>no</i>} />;
}`;
    const fixture = lowerFixture(source, (sourceFile) =>
      findNode(sourceFile, ts.isConditionalExpression),
    );
    const map = expressionMap(fixture);
    const jsxAnchor = fixture.record.anchors.find((anchor) => anchor.fromJsx)!;
    expect(jsxAnchor).toBeDefined();
    // The anchor keeps the authored range of the JSX node it replaced.
    expect(jsxAnchor.authoredStart).toBe(fixture.jsxSpans[1]!.start);
    expect(jsxAnchor.authoredEnd).toBe(fixture.jsxSpans[1]!.end);
    const generated = generatedPosition(fixture.record.lowered, jsxAnchor.generatedStart);
    const authored = authoredPosition(fixture.sourceFile, jsxAnchor.authoredStart);
    // The consumer resolves a position inside the replacement to the authored
    // JSX start: anchors are node starts, never interpolated authored offsets.
    for (const delta of [1, 3, 7]) {
      const original = originalPositionFor(map, {
        line: generated.line,
        column: generated.column + delta,
      });
      expect(original.line).toBe(authored.line);
      expect(original.column).toBe(authored.column);
    }
    expectSegmentsRoundTrip(fixture);
  });

  test('multi-line lowered text: later generated lines map to authored lines', () => {
    const source = `function Fixture(a, b, c) {
  return a /* first
  second */ ? b : c;
}`;
    const fixture = lowerFixture(source, (sourceFile) =>
      findNode(sourceFile, ts.isConditionalExpression),
    );
    expect(fixture.record.lowered).toContain('\n');
    const map = expressionMap(fixture);
    expectSegmentsRoundTrip(fixture);
    const multiLine = fixture.record.segments.filter((segment) => segment.generatedLine > 1);
    expect(multiLine.length).toBeGreaterThan(0);
    for (const segment of multiLine) {
      const original = originalPositionFor(map, {
        line: segment.generatedLine,
        column: segment.generatedColumn,
      });
      expect(original.line).toBe(segment.sourceLine);
      expect(original.column).toBe(segment.sourceColumn);
    }
  });
});

// ─── Parity against the Alpha15 class-frontend map convention ──────────────

const CLASS_SOURCE = `import { element, OpenElement, property } from '@openelement/element';
@element('oe-map-parity')
export class MapParity extends OpenElement {
  @property({ reflect: false }) label = 'ready';
  render() {
    return <main title={this.label}>{this.label}</main>;
  }
}
`;

const FUNCTION_PARITY_SOURCE = `import { signal } from '@openelement/element';
function MapParity(props) {
  const label = signal('ready');
  return <main title={label.value}>{label.value}</main>;
}
`;

describe('M03-I-4b — expression-level parity with the Alpha15 map convention', () => {
  test('both frontends decode through the same consumer and resolve to the authored dynamic-construct line', () => {
    // ── Alpha15 class baseline: decode the emitted module map ────────────────
    const compiled = compileElementProgram(CLASS_SOURCE, FILE);
    const classMap = new TraceMap(compiled.map as unknown as Parameters<typeof TraceMap>[0]);
    const classSourceFile = ts.createSourceFile(
      FILE,
      CLASS_SOURCE,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TSX,
    );
    const classRender = findNode(
      classSourceFile,
      (node): node is ts.MethodDeclaration =>
        ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'render',
    );
    // The Alpha15 Part-level map anchors the generated program to the authored
    // render method (the dynamic construct's authored region); it does not emit
    // per-expression anchors — that finer granularity is the function frontend's
    // additive difference, documented below, not a parity break.
    const classConstructLine = authoredPosition(
      classSourceFile,
      classRender.getStart(classSourceFile),
    ).line;
    expect(classMap.sources).toEqual([FILE]);
    const classMappedLines = new Set<number>();
    eachMapping(classMap, (mapping) => {
      if (mapping.originalLine !== null) classMappedLines.add(mapping.originalLine);
    });
    // The class frontend's Part-level map resolves generated lines to the
    // authored line of the render construct (it does not emit expression-level
    // anchors: the dynamic value is evaluated by the Part runtime).
    expect(classMappedLines.has(classConstructLine)).toBe(true);

    // ── Function frontend: decode the A2 expression segments ─────────────────
    const sourceFile = ts.createSourceFile(
      FILE,
      FUNCTION_PARITY_SOURCE,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TSX,
    );
    const module = resolveModule(sourceFile, { components: [], importClassifier: classifier });
    const registry = createExpressionRegistry({
      module,
      recipeReference: () => ({ callee: RECIPE_CALLEE, id: 'r0' }),
    });
    const expression = findNode(
      sourceFile,
      (node): node is ts.PropertyAccessExpression =>
        ts.isPropertyAccessExpression(node) && node.expression.getText(sourceFile) === 'label',
    );
    const result = registry.lower(expression, 'inline');
    expect(result.diagnostics).toEqual([]);
    const builder = new SourceMapSegmentBuilder();
    for (const segment of result.record!.segments) builder.add(segment);
    const functionMap = new TraceMap(
      builder.build(FILE, FUNCTION_PARITY_SOURCE) as unknown as Parameters<typeof TraceMap>[0],
    );
    expect(functionMap.sources).toEqual([FILE]);
    const expressionLine = authoredPosition(sourceFile, expression.getStart(sourceFile)).line;
    const functionMappedLines = new Set<number>();
    eachMapping(functionMap, (mapping) => {
      if (mapping.originalLine !== null) functionMappedLines.add(mapping.originalLine);
    });
    expect(functionMappedLines.has(expressionLine)).toBe(true);

    // ── Parity property ─────────────────────────────────────────────────────
    // Both maps: Source Map v3 through the SAME consumer API, one authored
    // source, 1-based authored line / 0-based authored column, and every mapped
    // authored offset is a real authored character (no interpolated positions).
    for (const [map, source] of [
      [classMap, CLASS_SOURCE] as const,
      [functionMap, FUNCTION_PARITY_SOURCE] as const,
    ]) {
      eachMapping(map, (mapping) => {
        if (mapping.originalLine === null || mapping.originalColumn === null) return;
        const offset = (
          map === classMap ? classSourceFile : sourceFile
        ).getPositionOfLineAndCharacter(mapping.originalLine - 1, mapping.originalColumn);
        expect(source[offset] ?? ' ').not.toBe('\n');
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(source.length);
      });
    }
    // The function frontend additionally resolves *expression-level* anchors: it
    // maps every authored expression node start (the M03 requirement), while the
    // class baseline maps Part-level authored lines only. That difference is the
    // deliberate design difference, not a parity failure.
    expect(result.record!.segments.length).toBeGreaterThanOrEqual(1);
    expect(new Set(result.record!.segments.map((segment) => segment.generatedLine)).size).toBe(1);
    expect(
      result.record!.anchors.some(
        (anchor) => anchor.authoredStart === expression.getStart(sourceFile),
      ),
    ).toBe(true);
  });

  test('A4b asserts expression-level parity only; the end-to-end module map stays M05', () => {
    // The function frontend returns a component model + expression sidecar: no
    // emitted module and no module map exists to decode until M05 codegen.
    const result = compileFunctionModule(
      'function C(props) { return <p>{props.label}</p>; }\n',
      FILE,
    );
    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.module!).sort()).toEqual(['components', 'expressions', 'file']);
    expect(result.module).not.toHaveProperty('code');
    expect(result.module).not.toHaveProperty('map');
    // The class frontend's composed module map is the Alpha15 side; the
    // generated function-module map (mount/update/dispose placement) is M05.
  });
});
