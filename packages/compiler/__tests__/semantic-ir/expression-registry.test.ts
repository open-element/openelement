/**
 * M03-I-2 — expression lowering + ExpressionRegistry tests.
 *
 * Authority: `docs/architecture/m03-expression-identity.md` (M03-B §4/§5/§6/§8/§9)
 * and `docs/architecture/m03-i0-sourcemap-prototype.md` (adopted M1 anchors).
 *
 * The suite covers the A2 half of the M03-I matrix: JSX→recipe-reference
 * substitution and evaluation order, anchors-not-ranges, deepest-wins merge,
 * the `EmissionSegment`/`SourceMapSegmentBuilder` convention and codegen
 * rebase, determinism, transform disposal/AST hygiene, the data-only registry
 * contract, fail-closed refusals with source locations, and the A1
 * resolver→registry integration (captures/dependencies are A1's answer, never
 * re-derived here).
 *
 * Erasure (`as`/`satisfies`/non-null/type arguments/annotations) is M03-I-3
 * (A3): A2 fails closed on it, and the refusal tests pin that boundary.
 */

import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import {
  EXPRESSION_LOWERING_TRANSFORM_VERSION,
  isJsxNode,
  lowerExpressionText,
  markerNamespaceFor,
  rebaseSegments,
  scanLoweringMarkers,
} from '../../src/internal/compiler/semantic-core/expression-lowering.ts';
import {
  createExpressionRegistry,
  type ExpressionRegistry,
  type LoweredExpressionRecord,
} from '../../src/internal/compiler/semantic-core/expression-registry.ts';
import {
  SourceMapSegmentBuilder,
  type EmissionSegment,
} from '../../src/internal/compiler/semantic-core/source-map.ts';
import {
  resolveModule,
  type BindingId,
  type ImportClassifier,
  type ResolvedModule,
  type ScopeDiagnostic,
} from '../../src/internal/compiler/semantic-core/scope-resolution.ts';

const FILE = '/proj/src/expression.tsx';
const RECIPE_CALLEE = '__oe_recipe_ref';

// ─── Harness ────────────────────────────────────────────────────────────────

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
}

function findAllNodes<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T,
): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node): void => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function findNode<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T {
  const found = findAllNodes(root, predicate);
  if (found.length === 0) throw new Error('node not found');
  return found[0]!;
}

/** Capitalized declarations are treated as components (props-param origin etc.). */
function collectComponents(sourceFile: ts.SourceFile): ts.FunctionDeclaration[] {
  return findAllNodes(
    sourceFile,
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) &&
      node.body !== undefined &&
      node.name !== undefined &&
      /^[A-Z]/.test(node.name.text),
  );
}

const JSX_PREDICATE = (
  node: ts.Node,
): node is ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment => isJsxNode(node);

function runtimeClassifier(): ImportClassifier {
  return {
    classifySymbol: (specifier, importedName) => {
      if (specifier !== 'runtime') return undefined;
      if (importedName === 'signal' || importedName === 'computed') return 'factory';
      return undefined;
    },
    classifyValue: () => undefined,
    classifyCall: (specifier, importedName) =>
      specifier === 'runtime' && importedName === 'signal' ? { call: 'signal' } : undefined,
  };
}

interface Harness {
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly module: ResolvedModule;
  readonly registry: ExpressionRegistry;
  readonly jsxNodes: readonly ts.Node[];
}

function harness(
  source: string,
  options: {
    readonly classifier?: ImportClassifier;
    readonly recipeReference?: (jsx: ts.Node) => { callee: string; id: string } | undefined;
  } = {},
): Harness {
  const sourceFile = parse(source);
  const module = resolveModule(sourceFile, {
    components: collectComponents(sourceFile),
    importClassifier: options.classifier ?? runtimeClassifier(),
  });
  const jsxNodes = findAllNodes(sourceFile, JSX_PREDICATE);
  const registry = createExpressionRegistry({
    module,
    recipeReference:
      options.recipeReference ??
      ((jsx) => {
        const index = jsxNodes.indexOf(jsx);
        return index < 0 ? undefined : { callee: RECIPE_CALLEE, id: `r${index}` };
      }),
  });
  return { source, sourceFile, module, registry, jsxNodes };
}

function parsesAsJs(text: string): boolean {
  const out = ts.transpileModule(text, {
    fileName: 'lowered.js',
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, allowJs: true },
  });
  return (out.diagnostics ?? []).length === 0;
}

function squeeze(text: string): string {
  return text.replace(/\s+/g, '');
}

function codesOf(diagnostics: readonly ScopeDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function expectDiagnostic(
  diagnostics: readonly ScopeDiagnostic[],
  code: string,
  source: string,
  slice?: string,
): ScopeDiagnostic {
  const diagnostic = diagnostics.find((candidate) => candidate.code === code);
  expect(diagnostic, `expected ${code}; got [${codesOf(diagnostics).join(', ')}]`).toBeDefined();
  expect(diagnostic!.origin).toBe('source');
  if (slice !== undefined) {
    expect(source.slice(diagnostic!.span.start, diagnostic!.span.end)).toBe(slice);
  }
  return diagnostic!;
}

function declarationInitializer(sourceFile: ts.SourceFile, name: string): ts.Expression {
  const declaration = findNode(
    sourceFile,
    (node): node is ts.VariableDeclaration =>
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name,
  );
  if (declaration.initializer === undefined) throw new Error(`'${name}' has no initializer`);
  return declaration.initializer;
}

function bindingNames(module: ResolvedModule, ids: readonly BindingId[]): string[] {
  const names = new Map(
    module.bindings.map((binding) => [bindingKeyOf(binding.id), binding.id.name]),
  );
  return ids.map((id) => names.get(bindingKeyOf(id)) ?? id.name);
}

function bindingKeyOf(id: BindingId): string {
  return `${id.scope.path}#${id.name}#${id.declarationOrder}`;
}

/** Nearest preceding anchor (deepest wins on equal generated starts). */
function resolveAnchor(
  record: LoweredExpressionRecord,
  generatedOffset: number,
): { readonly authoredStart: number } | undefined {
  let best: (typeof record.anchors)[number] | undefined;
  for (const anchor of record.anchors) {
    if (anchor.generatedStart > generatedOffset) continue;
    if (
      best === undefined ||
      anchor.generatedStart > best.generatedStart ||
      (anchor.generatedStart === best.generatedStart && anchor.depth > best.depth)
    ) {
      best = anchor;
    }
  }
  return best;
}

function walkAstNodes(root: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return nodes;
}

interface DecodedSegment {
  generatedLine: number;
  generatedColumn: number;
  sourceIndex: number;
  sourceLine: number;
  sourceColumn: number;
  nameIndex: number;
}

/** Full Source Map v3 `mappings` decoder for one source (all five VLQ fields). */
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

// ─── Source snippets ────────────────────────────────────────────────────────

const CONDITIONAL_SOURCE = `function Fixture(props) {
  return props.ok ? <A title="t">{props.name}</A> : null;
}`;

const LIST_SOURCE = `function Fixture(props) {
  return props.items.map((item) => <Row item={item} />);
}`;

// ─── Lowered text: JSX substitution, validity, evaluation order ─────────────

describe('M03-B §6 — JSX is replaced 1:1 by a recipe reference at the same position', () => {
  test('a JSX branch lowers to a recipe reference call; no JSX survives and the text parses as JS', () => {
    const { sourceFile, module, registry, source } = harness(CONDITIONAL_SOURCE);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const { record, diagnostics } = registry.lower(conditional, 'inline');
    expect(diagnostics).toEqual([]);
    expect(record).not.toBeNull();
    expect(record!.lowered).not.toContain('<');
    expect(record!.lowered).not.toContain('</');
    expect(record!.lowered).toContain(`${RECIPE_CALLEE}("r0")`);
    expect(parsesAsJs(record!.lowered)).toBe(true);
    expect(source.slice(conditional.getStart(sourceFile), conditional.getEnd())).toContain('<A');

    // The replacement anchor points at the JSX start and the generated call.
    const jsx = findAllNodes(conditional, JSX_PREDICATE)[0]!;
    const anchor = record!.anchors.find((candidate) => candidate.fromJsx === true);
    expect(anchor).toBeDefined();
    expect(anchor!.authoredStart).toBe(jsx.getStart(sourceFile));
    expect(anchor!.authoredEnd).toBe(jsx.getEnd());
    const call = `${RECIPE_CALLEE}("r0")`;
    expect(record!.lowered.slice(anchor!.generatedStart, anchor!.generatedEnd)).toBe(call);
    expect(record!.authoredSpan.start).toBe(conditional.getStart(sourceFile));
    expect(module.moduleId).toBe(FILE);
  });

  test('JSX attribute, text and child-expression positions all sit inside the replaced JSX span', () => {
    const { sourceFile, registry } = harness(CONDITIONAL_SOURCE);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const { record } = registry.lower(conditional, 'inline');
    const replaced = record!.anchors.find((anchor) => anchor.fromJsx)!;
    const jsx = findAllNodes(conditional, JSX_PREDICATE)[0]!;
    for (const node of walkAstNodes(jsx)) {
      if (node === jsx) continue;
      expect(node.getStart(sourceFile)).toBeGreaterThanOrEqual(replaced.authoredStart);
      expect(node.getEnd()).toBeLessThanOrEqual(replaced.authoredEnd);
    }
  });

  test('two JSX positions are replaced in evaluation order', () => {
    const { sourceFile, registry } = harness(`function Fixture(props) {
      return props.ok ? <A /> : <B />;
    }`);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const { record } = registry.lower(conditional, 'inline');
    const consequent = record!.lowered.indexOf(`${RECIPE_CALLEE}("r0")`);
    const alternate = record!.lowered.indexOf(`${RECIPE_CALLEE}("r1")`);
    expect(consequent).toBeGreaterThan(-1);
    expect(alternate).toBeGreaterThan(consequent);
    expect(record!.lowered.indexOf(RECIPE_CALLEE, consequent + 1)).toBe(alternate);
    expect(parsesAsJs(record!.lowered)).toBe(true);
  });

  test('nested JSX is not inlined: only the outermost node becomes a reference', () => {
    const { sourceFile, registry } = harness(`function Fixture(props) {
      return props.ok ? <A><B /></A> : null;
    }`);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const { record } = registry.lower(conditional, 'inline');
    expect(record!.lowered.split(RECIPE_CALLEE)).toHaveLength(2); // one call
    expect(record!.anchors.filter((anchor) => anchor.fromJsx)).toHaveLength(1);
    expect(parsesAsJs(record!.lowered)).toBe(true);
  });

  test('a list mapper body JSX is replaced and the text stays valid JavaScript', () => {
    const { sourceFile, registry } = harness(LIST_SOURCE);
    const call = findNode(
      sourceFile,
      (node): node is ts.CallExpression =>
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'map',
    );
    const { record } = registry.lower(call, 'per-entry');
    expect(record!.lowered).toContain(`${RECIPE_CALLEE}("r0")`);
    expect(parsesAsJs(record!.lowered)).toBe(true);
  });

  test('a JSX node inside a template substitution is replaced and the template stays intact', () => {
    const { sourceFile, registry } = harness(`function Fixture(props) {
      return props.ok ? \`x=\${(<b />)}\` : null;
    }`);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const { record } = registry.lower(conditional, 'inline');
    expect(record!.lowered).toContain(`${RECIPE_CALLEE}("r0")`);
    expect(squeeze(record!.lowered)).toContain('`x=${(');
    expect(parsesAsJs(record!.lowered)).toBe(true);
  });

  test('plain expressions are printed without JSX and without marker residue', () => {
    const { sourceFile, registry } = harness(CONDITIONAL_SOURCE);
    const content = findNode(
      sourceFile,
      (node): node is ts.PropertyAccessExpression =>
        ts.isPropertyAccessExpression(node) && node.name.text === 'ok',
    );
    const { record } = registry.lower(content, 'setup');
    expect(squeeze(record!.lowered)).toBe('props.ok');
    expect(parsesAsJs(record!.lowered)).toBe(true);
  });
});

// ─── Whole-JSX expression roots ────────────────────────────────────────────

describe('a JSX node as the expression root lowers to a recipe reference', () => {
  test('the root JSX is replaced and its recipe-interior reads belong to the recipe', () => {
    const harnessValue = harness(`function Fixture(props) {
      return props.ok ? <A value={props.name} /> : null;
    }`);
    const conditional = findNode(harnessValue.sourceFile, ts.isConditionalExpression);
    const jsx = findAllNodes(conditional, JSX_PREDICATE)[0]!;
    const { record } = harnessValue.registry.lower(jsx, 'per-entry');
    expect(squeeze(record!.lowered)).toBe(`${RECIPE_CALLEE}("r0")`);
    expect(record!.reads).toEqual([]);
    expect(record!.dependencies).toEqual([]);
    expect(record!.anchors.filter((anchor) => anchor.fromJsx)).toHaveLength(1);
    expect(record!.authoredSpan.start).toBe(jsx.getStart(harnessValue.sourceFile));
  });

  test("TypeScript-only syntax inside a recipe interior is not this expression's refusal", () => {
    const harnessValue = harness(`function Fixture(props) {
      return <A value={props.value as number} />;
    }`);
    const jsx = findNode(harnessValue.sourceFile, JSX_PREDICATE);
    const { record, diagnostics } = harnessValue.registry.lower(jsx, 'per-entry');
    expect(diagnostics).toEqual([]);
    expect(record).not.toBeNull();
  });
});

// ─── Anchors, not ranges; deepest-wins ─────────────────────────────────────

describe('M03-I-0 adopted rules — anchors are node starts, deepest wins', () => {
  test('parenthesized and precedence-heavy nodes anchor at their own text', () => {
    const { sourceFile, registry } = harness(`function Fixture(a, b) {
      return (a + b) * 2;
    }`);
    const binary = findNode(sourceFile, ts.isBinaryExpression);
    const { record } = registry.lower(binary, 'setup');
    const left = (binary as ts.BinaryExpression).left;
    const leftAnchor = record!.anchors.find(
      (anchor) =>
        anchor.authoredStart === left.getStart(sourceFile) && anchor.authoredEnd === left.getEnd(),
    );
    expect(leftAnchor).toBeDefined();
    expect(
      squeeze(record!.lowered.slice(leftAnchor!.generatedStart, leftAnchor!.generatedEnd)),
    ).toBe(squeeze(ts.createPrinter().printNode(ts.EmitHint.Expression, left, sourceFile)));
    expect(squeeze(record!.lowered)).toBe('(a+b)*2');
    expect(parsesAsJs(record!.lowered)).toBe(true);
  });

  test('a replacement longer than its authored text does not drift inside the call', () => {
    const { sourceFile, registry } = harness(CONDITIONAL_SOURCE);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const { record } = registry.lower(conditional, 'inline');
    const jsx = findAllNodes(conditional, JSX_PREDICATE)[0]!;
    const call = `${RECIPE_CALLEE}("r0")`;
    const generatedStart = record!.lowered.indexOf(call);
    expect(record!.lowered.length).toBeGreaterThan(
      conditional.getEnd() - conditional.getStart(sourceFile),
    );
    for (let offset = generatedStart; offset < generatedStart + call.length; offset++) {
      const resolved = resolveAnchor(record!, offset);
      expect(resolved).toBeDefined();
      expect(resolved!.authoredStart).toBe(jsx.getStart(sourceFile));
    }
  });

  test('at one generated position the deepest anchor wins and yields one segment', () => {
    const { sourceFile, registry } = harness(`function Fixture(a, b) {
      return a + b;
    }`);
    const binary = findNode(sourceFile, ts.isBinaryExpression);
    const { record } = registry.lower(binary, 'setup');
    const left = (binary as ts.BinaryExpression).left;
    const competing = record!.anchors.filter(
      (anchor) =>
        anchor.generatedStart === Math.min(...record!.anchors.map((entry) => entry.generatedStart)),
    );
    expect(competing.length).toBeGreaterThanOrEqual(2);
    const deepest = competing.reduce((best, anchor) => (anchor.depth > best.depth ? anchor : best));
    expect(deepest.authoredStart).toBe(left.getStart(sourceFile));
    expect(deepest.name).toBe('a');
    const before = record!.lowered.slice(0, deepest.generatedStart);
    const generatedLine = before.split('\n').length;
    const generatedColumn = deepest.generatedStart - (before.lastIndexOf('\n') + 1);
    const segmentsAtStart = record!.segments.filter(
      (segment) =>
        segment.generatedLine === generatedLine && segment.generatedColumn === generatedColumn,
    );
    expect(segmentsAtStart).toHaveLength(1);
    const authored = sourceFile.getLineAndCharacterOfPosition(left.getStart(sourceFile));
    expect(segmentsAtStart[0]!.sourceLine).toBe(authored.line + 1);
    expect(segmentsAtStart[0]!.sourceColumn).toBe(authored.character);
  });

  test('every segment has a unique generated position and a name only for identifiers', () => {
    const { sourceFile, registry } = harness(CONDITIONAL_SOURCE);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const { record } = registry.lower(conditional, 'inline');
    const keys = record!.segments.map(
      (segment) => `${segment.generatedLine}:${segment.generatedColumn}`,
    );
    expect(new Set(keys).size).toBe(record!.segments.length);
    expect(record!.segments.some((segment) => segment.name === 'props')).toBe(true);
    for (const segment of record!.segments) {
      expect(Number.isInteger(segment.generatedLine)).toBe(true);
      expect(segment.generatedLine).toBeGreaterThanOrEqual(1);
      expect(segment.generatedColumn).toBeGreaterThanOrEqual(0);
      expect(segment.sourceLine).toBeGreaterThanOrEqual(1);
      expect(segment.sourceColumn).toBeGreaterThanOrEqual(0);
    }
  });

  test('authored comments survive lowering and do not break anchors', () => {
    const { sourceFile, registry } = harness(`function Fixture(a, b, c) {
      return a /* keep */ ? b : c;
    }`);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const { record } = registry.lower(conditional, 'inline');
    expect(record!.lowered).toContain('keep');
    expect(parsesAsJs(record!.lowered)).toBe(true);
    const alternate = findNode(
      conditional,
      (node): node is ts.Identifier => ts.isIdentifier(node) && node.text === 'c',
    );
    const anchor = record!.anchors.find(
      (entry) => entry.authoredStart === alternate.getStart(sourceFile),
    );
    expect(anchor).toBeDefined();
    expect(squeeze(record!.lowered.slice(anchor!.generatedStart, anchor!.generatedEnd))).toBe('c');
  });

  const ASI_CASES = ['a + +b', 'a - -b', 'a++', '++b', 'a ?? b'];
  for (const source of ASI_CASES) {
    test(`marker printing keeps the meaning of "${source}"`, () => {
      const { sourceFile, registry } = harness(`function Fixture(a, b) {
        return ${source};
      }`);
      const expression = findNode(
        sourceFile,
        (node): node is ts.Expression =>
          ts.isExpression(node) &&
          node.getStart(sourceFile) ===
            sourceFile.text.indexOf(source, sourceFile.text.indexOf('return')),
      );
      const { record } = registry.lower(expression, 'setup');
      expect(record!.lowered).not.toContain(markerNamespaceFor(sourceFile));
      expect(squeeze(record!.lowered)).toBe(squeeze(source));
      expect(parsesAsJs(record!.lowered)).toBe(true);
    });
  }
});

// ─── Source-map segments (EmissionSegment convention + codegen rebase) ─────

describe('M03-B §5 — segments reuse the SourceMapSegmentBuilder convention', () => {
  test('merged points round-trip through Source Map v3 with all five VLQ fields', () => {
    const { sourceFile, registry, source } = harness(CONDITIONAL_SOURCE);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const { record } = registry.lower(conditional, 'inline');
    const builder = new SourceMapSegmentBuilder();
    for (const segment of record!.segments) builder.add(segment);
    const map = builder.build('expression.tsx', source);
    const decoded = decodeMappings(map.mappings);
    expect(decoded).toHaveLength(record!.segments.length);
    for (let index = 0; index < decoded.length; index++) {
      const entry = decoded[index]!;
      const segment = record!.segments[index]!;
      expect(entry.generatedLine).toBe(segment.generatedLine);
      expect(entry.generatedColumn).toBe(segment.generatedColumn);
      expect(entry.sourceIndex).toBe(0);
      expect(entry.sourceLine).toBe(segment.sourceLine);
      expect(entry.sourceColumn).toBe(segment.sourceColumn);
      if (segment.name === undefined) {
        expect(entry.nameIndex).toBeGreaterThanOrEqual(0);
      } else {
        expect(map.names[entry.nameIndex]).toBe(segment.name);
      }
    }
    expect(map.names).toContain('props');
  });

  test('codegen placement rebases segments without recomputing them', () => {
    const segments: EmissionSegment[] = [
      { generatedLine: 1, generatedColumn: 0, sourceLine: 3, sourceColumn: 4, name: 'a' },
      { generatedLine: 1, generatedColumn: 9, sourceLine: 3, sourceColumn: 13 },
      { generatedLine: 2, generatedColumn: 2, sourceLine: 4, sourceColumn: 0 },
    ];
    const rebased = rebaseSegments(segments, { generatedLine: 5, generatedColumn: 7 });
    expect(rebased).toEqual([
      { generatedLine: 5, generatedColumn: 7, sourceLine: 3, sourceColumn: 4, name: 'a' },
      { generatedLine: 5, generatedColumn: 16, sourceLine: 3, sourceColumn: 13 },
      { generatedLine: 6, generatedColumn: 2, sourceLine: 4, sourceColumn: 0 },
    ]);
    // Authored coordinates are never recomputed by rebasing.
    expect(rebased.map((segment) => `${segment.sourceLine}:${segment.sourceColumn}`)).toEqual(
      segments.map((segment) => `${segment.sourceLine}:${segment.sourceColumn}`),
    );
  });

  test('a multi-line lowered text rebases by line and keeps later columns', () => {
    const { sourceFile, registry } = harness(`function Fixture(a, b, c) {
      return a /* first
      second */ ? b : c;
    }`);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const { record } = registry.lower(conditional, 'inline');
    expect(record!.lowered).toContain('\n');
    expect(new Set(record!.segments.map((segment) => segment.generatedLine)).size).toBeGreaterThan(
      1,
    );
    const rebased = rebaseSegments(record!.segments, { generatedLine: 10, generatedColumn: 4 });
    for (let index = 0; index < record!.segments.length; index++) {
      const segment = record!.segments[index]!;
      const shifted = rebased[index]!;
      expect(shifted.generatedLine).toBe(10 + segment.generatedLine - 1);
      expect(shifted.generatedColumn).toBe(
        segment.generatedLine === 1 ? 4 + segment.generatedColumn : segment.generatedColumn,
      );
      expect(shifted.sourceLine).toBe(segment.sourceLine);
      expect(shifted.sourceColumn).toBe(segment.sourceColumn);
    }
  });

  test('invalid placements fail closed', () => {
    expect(() => rebaseSegments([], { generatedLine: 0, generatedColumn: 0 })).toThrow(RangeError);
    expect(() => rebaseSegments([], { generatedLine: 1, generatedColumn: -1 })).toThrow(RangeError);
    expect(() => rebaseSegments([], { generatedLine: 1.5, generatedColumn: 0 })).toThrow(
      RangeError,
    );
  });
});

// ─── Determinism, site identity, registry keying ───────────────────────────

describe('M03-B §7/§10 — ExprId uniqueness, site identity, determinism', () => {
  test('two expressions with identical text get two ExprIds and two records', () => {
    const { sourceFile, registry } = harness(`function Fixture(a) {
      const one = a + 1;
      const two = a + 1;
      return one + two;
    }`);
    const first = registry.lower(declarationInitializer(sourceFile, 'one'), 'setup');
    const second = registry.lower(declarationInitializer(sourceFile, 'two'), 'setup');
    expect(first.record).not.toBeNull();
    expect(second.record).not.toBeNull();
    expect(first.record!.id).not.toBe(second.record!.id);
    expect(squeeze(first.record!.lowered)).toBe(squeeze(second.record!.lowered));
    expect(registry.size).toBe(2);
    expect(registry.expressions.map((record) => record.id)).toEqual([
      first.record!.id,
      second.record!.id,
    ]);
    expect(registry.get(first.record!.id)).toBe(first.record);
    expect(registry.get('missing')).toBeUndefined();
  });

  test('lowering the same node twice is deterministic; records stay distinct', () => {
    const { sourceFile, registry } = harness(CONDITIONAL_SOURCE);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const first = registry.lower(conditional, 'inline').record!;
    const second = registry.lower(conditional, 'inline').record!;
    expect(first.id).not.toBe(second.id);
    expect(second.lowered).toBe(first.lowered);
    expect(second.anchors).toEqual(first.anchors);
    expect(second.segments).toEqual(first.segments);
  });

  test('two registries over the same source are byte-identical', () => {
    const first = harness(CONDITIONAL_SOURCE);
    const second = harness(CONDITIONAL_SOURCE);
    const firstRecord = first.registry.lower(
      findNode(first.sourceFile, ts.isConditionalExpression),
      'inline',
    ).record!;
    const secondRecord = second.registry.lower(
      findNode(second.sourceFile, ts.isConditionalExpression),
      'inline',
    ).record!;
    expect(secondRecord).toEqual(firstRecord);
  });

  test('records carry the pinned TypeScript and transformer versions', () => {
    const { sourceFile, registry } = harness(CONDITIONAL_SOURCE);
    const { record } = registry.lower(findNode(sourceFile, ts.isConditionalExpression), 'inline');
    expect(record!.provenance.typescriptVersion).toBe(ts.version);
    expect(record!.provenance.transformerVersion).toBe(EXPRESSION_LOWERING_TRANSFORM_VERSION);
    expect(registry.typescriptVersion).toBe(ts.version);
    expect(registry.transformerVersion).toBe(EXPRESSION_LOWERING_TRANSFORM_VERSION);
  });
});

// ─── Disposal / AST hygiene / data-only registry ───────────────────────────

describe('M03-B §8 rule 6 — TransformationResult dispose and no retained AST', () => {
  test('the transform result is created once and disposed once per lowering', () => {
    const { sourceFile } = harness(CONDITIONAL_SOURCE);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const events: string[] = [];
    const result = lowerExpressionText(sourceFile, conditional, {
      recipeReference: () => ({ callee: RECIPE_CALLEE, id: 'r0' }),
      lifecycle: {
        created: () => events.push('created'),
        disposed: () => events.push('disposed'),
      },
    });
    expect(result.diagnostics).toEqual([]);
    expect(events).toEqual(['created', 'disposed']);

    // A refusal before the transform never creates one.
    const erasureSourceFile = parse(`function Fixture(value) { return value as number; }`);
    const asExpression = findNode(erasureSourceFile, ts.isAsExpression);
    events.length = 0;
    const refused = lowerExpressionText(erasureSourceFile, asExpression, {
      recipeReference: () => ({ callee: RECIPE_CALLEE, id: 'r0' }),
      lifecycle: {
        created: () => events.push('created'),
        disposed: () => events.push('disposed'),
      },
    });
    expect(codesOf(refused.diagnostics)).toContain('OEIR_ERASURE_DEFERRED');
    expect(events).toEqual([]);
  });

  test('a transform created before a refusal is disposed (missing recipe reference)', () => {
    const { sourceFile } = harness(CONDITIONAL_SOURCE);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const events: string[] = [];
    const result = lowerExpressionText(sourceFile, conditional, {
      recipeReference: () => undefined,
      lifecycle: {
        created: () => events.push('created'),
        disposed: () => events.push('disposed'),
      },
    });
    expect(codesOf(result.diagnostics)).toContain('OEIR_RECIPE_REFERENCE_MISSING');
    expect(events).toEqual(['created', 'disposed']);
  });

  test('after lowering, the authored AST carries no synthetic marker comments', () => {
    const { sourceFile, registry } = harness(CONDITIONAL_SOURCE);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    registry.lower(conditional, 'inline');
    for (const node of walkAstNodes(conditional)) {
      expect(ts.getSyntheticLeadingComments(node)).toBeUndefined();
      expect(ts.getSyntheticTrailingComments(node)).toBeUndefined();
    }
    // The authored source keeps its JSX and the printer output has no markers.
    const printed = ts.createPrinter().printNode(ts.EmitHint.Expression, conditional, sourceFile);
    expect(printed).toContain('<A');
    expect(printed).not.toContain(markerNamespaceFor(sourceFile));
  });

  test('pre-existing synthetic comments are restored after lowering', () => {
    const { sourceFile, registry } = harness(CONDITIONAL_SOURCE);
    const conditional = findNode(sourceFile, ts.isConditionalExpression);
    const identifier = findNode(
      conditional,
      (node): node is ts.Identifier => ts.isIdentifier(node) && node.text === 'props',
    );
    ts.addSyntheticLeadingComment(
      identifier,
      ts.SyntaxKind.MultiLineCommentTrivia,
      'authored-synthetic',
      false,
    );
    registry.lower(conditional, 'inline');
    expect(ts.getSyntheticLeadingComments(identifier)?.map((comment) => comment.text)).toEqual([
      'authored-synthetic',
    ]);
    ts.setSyntheticLeadingComments(identifier, undefined);
  });

  test('records are data-only: JSON round-trip and no ts.Node/functions', () => {
    const { sourceFile, registry } = harness(CONDITIONAL_SOURCE);
    const { record } = registry.lower(findNode(sourceFile, ts.isConditionalExpression), 'inline');
    expect(() => JSON.stringify(record)).not.toThrow();
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
    const scan = (value: unknown, path: string): void => {
      if (typeof value === 'function') throw new Error(`function at ${path}`);
      if (value === null || typeof value !== 'object') return;
      if (typeof (value as { getSourceFile?: unknown }).getSourceFile === 'function') {
        throw new Error(`AST node at ${path}`);
      }
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        scan(entry, `${path}.${key}`);
      }
    };
    scan(record, 'record');
  });
});

// ─── Fail-closed refusals (source-located) ────────────────────────────────

describe('A2 fails closed where A3 (erasure) or the model has no lowering', () => {
  const wrap = (expression: string): string =>
    `function Fixture(value, fn, items) { return ${expression}; }`;

  const ERASURE_CASES: ReadonlyArray<{ expression: string; slice: string }> = [
    { expression: 'value as number', slice: 'value as number' },
    { expression: 'value!', slice: 'value!' },
    { expression: 'fn<string>(value)', slice: 'string' },
    { expression: 'value satisfies T', slice: 'value satisfies T' },
    { expression: 'items.map((item: Item) => item)', slice: 'Item' },
  ];
  for (const entry of ERASURE_CASES) {
    test(`erasure-required expression is refused: ${entry.expression}`, () => {
      const harnessValue = harness(wrap(entry.expression));
      const expression = findNode(harnessValue.sourceFile, ts.isReturnStatement).expression!;
      const { record, diagnostics } = harnessValue.registry.lower(expression, 'setup');
      expect(record).toBeNull();
      expectDiagnostic(diagnostics, 'OEIR_ERASURE_DEFERRED', harnessValue.source, entry.slice);
      expect(harnessValue.registry.size).toBe(0);
    });
  }

  const CONTEXT_CASES: ReadonlyArray<{ expression: string; code: string; slice: string }> = [
    { expression: 'this.props', code: 'OEIR_UNSUPPORTED_THIS', slice: 'this' },
    { expression: 'arguments.length', code: 'OEIR_UNSUPPORTED_ARGUMENTS', slice: 'arguments' },
    { expression: "eval('1')", code: 'OEIR_DYNAMIC_SCOPE', slice: 'eval' },
    { expression: '(() => new.target)', code: 'OEIR_UNSUPPORTED_NEW_TARGET', slice: 'new.target' },
    { expression: 'await pending', code: 'OEIR_AWAIT_OUTSIDE_ASYNC', slice: 'await pending' },
    {
      expression: 'function* () { yield 1; }',
      code: 'OEIR_UNSUPPORTED_GENERATOR',
      slice: 'yield 1',
    },
  ];
  for (const entry of CONTEXT_CASES) {
    test(`context-sensitive expression is refused: ${entry.expression}`, () => {
      const harnessValue = harness(wrap(entry.expression));
      const expression = findNode(harnessValue.sourceFile, ts.isReturnStatement).expression!;
      const { record, diagnostics } = harnessValue.registry.lower(expression, 'setup');
      expect(record).toBeNull();
      expectDiagnostic(diagnostics, entry.code, harnessValue.source, entry.slice);
    });
  }

  test('JSX without a recipe reference is refused with the JSX span', () => {
    const harnessValue = harness(CONDITIONAL_SOURCE, { recipeReference: () => undefined });
    const { record, diagnostics } = harnessValue.registry.lower(
      findNode(harnessValue.sourceFile, ts.isConditionalExpression),
      'inline',
    );
    expect(record).toBeNull();
    expectDiagnostic(
      diagnostics,
      'OEIR_RECIPE_REFERENCE_MISSING',
      harnessValue.source,
      '<A title="t">{props.name}</A>',
    );
  });

  test('an invalid recipe-reference callee is refused', () => {
    const harnessValue = harness(CONDITIONAL_SOURCE, {
      recipeReference: () => ({ callee: 'not-valid!', id: 'r0' }),
    });
    const { record, diagnostics } = harnessValue.registry.lower(
      findNode(harnessValue.sourceFile, ts.isConditionalExpression),
      'inline',
    );
    expect(record).toBeNull();
    expectDiagnostic(diagnostics, 'OEIR_RECIPE_CALLEE_INVALID', harnessValue.source);
  });

  test('a non-expression node is refused with OEIR_EXPRESSION_INVALID', () => {
    const harnessValue = harness(`function Fixture(props) {
      return props.ok ? <A /> : null;
    }`);
    const statement = findNode(harnessValue.sourceFile, ts.isReturnStatement);
    const { record, diagnostics } = harnessValue.registry.lower(statement, 'setup');
    expect(record).toBeNull();
    expectDiagnostic(
      diagnostics,
      'OEIR_EXPRESSION_INVALID',
      harnessValue.source,
      'return props.ok ? <A /> : null;',
    );
  });

  test('a foreign node is refused as a module-origin diagnostic', () => {
    const harnessValue = harness(CONDITIONAL_SOURCE);
    const foreignSourceFile = parse(`function Foreign(x) { return x + 1; }`);
    const foreign = findNode(foreignSourceFile, ts.isBinaryExpression);
    const { record, diagnostics } = harnessValue.registry.lower(foreign, 'setup');
    expect(record).toBeNull();
    expect(codesOf(diagnostics)).toEqual(['OEIR_EXPRESSION_FOREIGN']);
    expect(diagnostics[0]!.origin).toBe('module');
  });

  test('marker scan fails closed for missing, duplicate, unknown and unpaired markers', () => {
    const namespace = '__oe_lm_test_';
    const expected = new Set([0]);
    expect(
      scanLoweringMarkers(`/*${namespace}s0*/ a /*${namespace}e0*/`, namespace, expected)
        .diagnostics,
    ).toEqual([]);
    expect(
      scanLoweringMarkers(`/*${namespace}s9*/ a`, namespace, expected).diagnostics.join(),
    ).toContain('unknown marker id 9');
    expect(
      scanLoweringMarkers(
        `/*${namespace}s0*/a/*${namespace}s0*/ /*${namespace}e0*/`,
        namespace,
        expected,
      ).diagnostics.join(),
    ).toContain('appears 2 times');
    expect(
      scanLoweringMarkers(`/*${namespace}s0*/ a`, namespace, expected).diagnostics.join(),
    ).toContain('end marker 0 is missing');
    expect(
      scanLoweringMarkers(`/*${namespace}e0*/ a`, namespace, expected).diagnostics.join(),
    ).toContain('start marker 0 is missing');
  });

  test('marker namespace is deterministic and cannot collide with authored text', () => {
    const sourceFile = parse(`const r = /* __oe_lm_abc_ */ a;`);
    expect(markerNamespaceFor(sourceFile)).toBe(markerNamespaceFor(sourceFile));
    expect(sourceFile.text.includes(markerNamespaceFor(sourceFile))).toBe(false);
  });
});

// ─── A1 resolver → registry integration ───────────────────────────────────

const RESOLVER_SOURCE = `import { signal } from 'runtime';
function Fixture(props) {
  const s = signal(0);
  const derivedValue = () => s.value;
  const handler = () => { s.value++; };
  const { snapshot } = props;
  const snapshotRead = snapshot;
  const trackedProp = props.name;
  return derivedValue;
}`;

describe('M03-I-2 integration — A1 resolveExpression feeds the registry record', () => {
  test("captures and dependencies are A1's answer for derived and handler modes", () => {
    const harnessValue = harness(RESOLVER_SOURCE);
    const derived = findNode(
      harnessValue.sourceFile,
      (node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'derivedValue',
    );
    const handler = findNode(
      harnessValue.sourceFile,
      (node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'handler',
    );
    const derivedResult = harnessValue.registry.lower(derived.initializer!, 'derived').record!;
    expect(bindingNames(harnessValue.module, derivedResult.captures)).toEqual(['s']);
    expect(bindingNames(harnessValue.module, derivedResult.dependencies)).toEqual(['s']);
    const handlerResult = harnessValue.registry.lower(handler.initializer!, 'handler').record!;
    expect(bindingNames(harnessValue.module, handlerResult.captures)).toEqual(['s']);
    expect(handlerResult.dependencies).toEqual([]);
  });

  test('destructured props snapshot is not tracked; a direct props property read is', () => {
    const harnessValue = harness(RESOLVER_SOURCE);
    const snapshotRead = findNode(
      harnessValue.sourceFile,
      (node): node is ts.Identifier =>
        ts.isIdentifier(node) && node.text === 'snapshot' && !ts.isBindingElement(node.parent),
    );
    const snapshot = harnessValue.registry.lower(snapshotRead, 'inline').record!;
    expect(snapshot.dependencies).toEqual([]);
    const tracked = findNode(
      harnessValue.sourceFile,
      (node): node is ts.PropertyAccessExpression =>
        ts.isPropertyAccessExpression(node) && node.name.text === 'name',
    );
    const propRead = harnessValue.registry.lower(tracked, 'inline').record!;
    expect(bindingNames(harnessValue.module, propRead.dependencies)).toEqual(['props']);
  });

  test('unresolved reads fail the lowering closed with the A1 diagnostic', () => {
    const harnessValue = harness(`function Fixture(props) { return missing; }`);
    const expression = findNode(harnessValue.sourceFile, ts.isReturnStatement).expression!;
    const { record, diagnostics } = harnessValue.registry.lower(expression, 'setup');
    expect(record).toBeNull();
    expectDiagnostic(diagnostics, 'OEIR_UNRESOLVED_BINDING', harnessValue.source, 'missing');
  });

  test("JSX-interior reads move to the recipe: they are not this expression's reads", () => {
    const harnessValue = harness(`function Fixture(props, other) {
      return props.ok ? <A value={other} /> : null;
    }`);
    const conditional = findNode(harnessValue.sourceFile, ts.isConditionalExpression);
    const resolution = harnessValue.module.resolveExpression(conditional, 'inline');
    // A1 sees both bindings: props (outside the JSX) and other (inside it)…
    expect(resolution.reads.map((read) => read.name).sort()).toEqual(['other', 'props']);
    // …the lowered expression only keeps the read outside the replaced JSX.
    const { record } = harnessValue.registry.lower(conditional, 'inline');
    expect(record!.reads.map((read) => read.name)).toEqual(['props']);
  });

  test('JSX-interior resolution diagnostics do not fail-closed the outer expression', () => {
    const harnessValue = harness(`function Fixture(props) {
      return props.ok ? <A value={missing} /> : null;
    }`);
    const conditional = findNode(harnessValue.sourceFile, ts.isConditionalExpression);
    expect(
      harnessValue.module.resolveExpression(conditional, 'inline').diagnostics.map((d) => d.code),
    ).toContain('OEIR_UNRESOLVED_BINDING');
    const { record, diagnostics } = harnessValue.registry.lower(conditional, 'inline');
    expect(diagnostics).toEqual([]);
    expect(record).not.toBeNull();
  });

  test('record mode is echoed and dependencies stay legal for the mode', () => {
    const harnessValue = harness(RESOLVER_SOURCE);
    const tracked = findNode(
      harnessValue.sourceFile,
      (node): node is ts.PropertyAccessExpression =>
        ts.isPropertyAccessExpression(node) && node.name.text === 'name',
    );
    for (const mode of ['setup', 'handler', 'key'] as const) {
      const result = harnessValue.registry.lower(tracked, mode).record!;
      expect(result.mode).toBe(mode);
      expect(result.dependencies).toEqual([]);
    }
    const inline = harnessValue.registry.lower(tracked, 'inline').record!;
    expect(bindingNames(harnessValue.module, inline.dependencies)).toEqual(['props']);
  });

  test('the registry is per compilation: two registries share no state', () => {
    const first = harness(RESOLVER_SOURCE);
    const second = harness(RESOLVER_SOURCE);
    first.registry.lower(findNode(first.sourceFile, ts.isReturnStatement).expression!, 'setup');
    expect(first.registry.size).toBe(1);
    expect(second.registry.size).toBe(0);
    expect(first.registry.get(first.registry.expressions[0]!.id)).toBeDefined();
    expect(second.registry.get(first.registry.expressions[0]!.id)).toBeUndefined();
  });
});
