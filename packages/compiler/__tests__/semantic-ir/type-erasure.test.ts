/**
 * M03-I-3 — erasure visitor matrix + integrated lowering pipeline tests.
 *
 * Authority: `docs/architecture/m03-expression-identity.md` (M03-B) §3 Route 3
 * step 2a, §6 context-sensitive matrix, §8 lowering rules, §9 risks, §10 matrix.
 * The differential `ts.transpileModule` oracle lives in
 * `erasure-oracle.test.ts` (oracle-only by design); this file exercises the
 * production erasure semantics directly against the A2 pipeline.
 */

import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import {
  EXPRESSION_LOWERING_TRANSFORM_VERSION,
  isJsxNode,
  lowerExpressionText,
  type LoweredAnchor,
} from '../../src/internal/compiler/semantic-core/expression-lowering.ts';
import {
  createExpressionRegistry,
  type LoweredExpressionRecord,
} from '../../src/internal/compiler/semantic-core/expression-registry.ts';
import { eraseTypeScriptSyntax } from '../../src/internal/compiler/semantic-core/type-erasure.ts';
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

const FILE = '/proj/src/erasure.tsx';
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
  readonly registry: ReturnType<typeof createExpressionRegistry>;
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
  const jsxNodes = findAllNodes(
    sourceFile,
    (node): node is ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment => isJsxNode(node),
  );
  const registry = createExpressionRegistry({
    module,
    recipeReference:
      options.recipeReference ??
      ((jsx) => {
        const index = jsxNodes.indexOf(jsx);
        return index < 0 ? undefined : { callee: RECIPE_CALLEE, id: `r${index}` };
      }),
  });
  return { source, sourceFile, module, registry };
}

/** Wrap one expression in a component fixture with declarations it may read. */
function fixtureSource(
  expression: string,
  declarations = '',
  extraParams = 'value, fn, items, obj',
): string {
  return `${declarations}
function Fixture(${extraParams}) {
  return ${expression};
}`;
}

function lowerExpression(
  harnessValue: Harness,
  mode: LoweredExpressionRecord['mode'] = 'setup',
): {
  readonly record: LoweredExpressionRecord | null;
  readonly diagnostics: readonly ScopeDiagnostic[];
} {
  const expression = findNode(harnessValue.sourceFile, ts.isReturnStatement).expression!;
  return harnessValue.registry.lower(expression, mode);
}

function squeeze(text: string): string {
  return text.replace(/\s+/g, '');
}

function codesOf(diagnostics: readonly ScopeDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

/** Parse the lowered text in an expression position (statement-position
 * function expressions are legal only when parenthesized). */
function parsesAsJs(text: string): boolean {
  const out = ts.transpileModule(`(${text});`, {
    fileName: 'lowered.js',
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, allowJs: true },
  });
  return (out.diagnostics ?? []).length === 0;
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
  if (slice !== undefined)
    expect(source.slice(diagnostic!.span.start, diagnostic!.span.end)).toBe(slice);
  return diagnostic!;
}

function bindingNames(module: ResolvedModule, ids: readonly BindingId[]): string[] {
  const names = new Map(
    module.bindings.map((binding) => [
      `${binding.id.scope.path}#${binding.id.name}#${binding.id.declarationOrder}`,
      binding.id.name,
    ]),
  );
  return ids.map(
    (id) => names.get(`${id.scope.path}#${id.name}#${id.declarationOrder}`) ?? id.name,
  );
}

function anchorAt(
  record: LoweredExpressionRecord,
  authoredStart: number,
): LoweredAnchor | undefined {
  return record.anchors.find((anchor) => anchor.authoredStart === authoredStart);
}

/** 1-based generated line, 0-based generated column for an offset. */
function generatedPoint(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  return { line: before.split('\n').length, column: offset - (before.lastIndexOf('\n') + 1) };
}

function segmentsAt(
  segments: readonly EmissionSegment[],
  point: { line: number; column: number },
): EmissionSegment[] {
  return segments.filter(
    (segment) => segment.generatedLine === point.line && segment.generatedColumn === point.column,
  );
}

// ─── Erasure matrix: each admitted form is stripped ─────────────────────────

describe('M03-B §8 rule 2 — admitted erasure set', () => {
  interface Case {
    readonly expression: string;
    readonly squeezed: string;
    readonly declarations?: string;
  }

  const CASES: readonly Case[] = [
    { expression: 'value as number', squeezed: 'value' },
    { expression: 'value as unknown as string', squeezed: 'value' },
    { expression: 'value as const', squeezed: 'value' },
    { expression: 'value!', squeezed: 'value' },
    { expression: 'fn<string>(value)', squeezed: 'fn(value)' },
    {
      expression: 'new Box<string>(value)',
      squeezed: 'newBox(value)',
      declarations: 'class Box {}',
    },
    { expression: 'value satisfies Shape', squeezed: 'value' },
    { expression: '(value as { length: number }).length', squeezed: '(value).length' },
    { expression: '(x: number) => x + 1', squeezed: '(x)=>x+1' },
    { expression: '<T,>(item: T) => item', squeezed: '(item)=>item' },
    { expression: '(x: number, y?: string) => x', squeezed: '(x,y)=>x' },
    { expression: '(x: number): number => x', squeezed: '(x)=>x' },
    {
      expression: 'function (this: unknown, value: number) { return value; }',
      squeezed: 'function(value){returnvalue;}',
    },
    { expression: '(() => { return value as number; })()', squeezed: '(()=>{returnvalue;})()' },
    { expression: 'fn<string>(value as number, () => value!)', squeezed: 'fn(value,()=>value)' },
    { expression: 'items.map((item: Item) => item.id)', squeezed: 'items.map((item)=>item.id)' },
    {
      expression: '(() => { const length: number = value; return length; })()',
      squeezed: '(()=>{constlength=value;returnlength;})()',
    },
    {
      expression:
        '((value) => { try { return value; } catch (error: unknown) { return error; } })()',
      squeezed: '((value)=>{try{returnvalue;}catch(error){returnerror;}})()',
    },
    {
      expression:
        '(function () { function inner(x: number): number { return x; } return inner(value); })()',
      squeezed: '(function(){functioninner(x){returnx;}returninner(value);})()',
    },
    {
      expression: '({ method(x: number): number { return x; } }).method(value)',
      squeezed: '({method(x){returnx;}}).method(value)',
    },
  ];

  for (const entry of CASES) {
    test(`erases: ${entry.expression}`, () => {
      const harnessValue = harness(fixtureSource(entry.expression, entry.declarations ?? ''));
      const { record, diagnostics } = lowerExpression(harnessValue);
      expect(diagnostics).toEqual([]);
      expect(record).not.toBeNull();
      expect(squeeze(record!.lowered)).toBe(entry.squeezed);
      expect(parsesAsJs(record!.lowered)).toBe(true);
      expect(codesOf(diagnostics)).not.toContain('OEIR_ERASURE_DEFERRED');
      expect(codesOf(diagnostics)).not.toContain('OEIR_ERASURE_UNSUPPORTED');
    });
  }

  test('an instantiation expression (`f<string>` as a value) erases to its inner expression', () => {
    const sourceFile = ts.createSourceFile(
      'instantiation.ts',
      'const g = f<string>;',
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
    const initializer = findNode(sourceFile, (node): node is ts.VariableDeclaration =>
      ts.isVariableDeclaration(node),
    ).initializer!;
    const erased = eraseTypeScriptSyntax(initializer, (node) => node);
    expect(erased).toBeDefined();
    expect(ts.isIdentifier(erased!)).toBe(true);
    expect((erased as ts.Identifier).text).toBe('f');
  });

  test('A1 follow-up: type-parameter declaration names are not value reads', () => {
    const harnessValue = harness(fixtureSource('<T,>(item: T) => item'));
    const arrow = findNode(harnessValue.sourceFile, ts.isArrowFunction);
    const resolution = harnessValue.module.resolveExpression(arrow, 'derived');
    expect(resolution.diagnostics).toEqual([]);
  });

  test('the erased record keeps provenance and the data-only contract', () => {
    const harnessValue = harness(fixtureSource('(value as number) + 1'));
    const { record } = lowerExpression(harnessValue);
    expect(record!.provenance.typescriptVersion).toBe(ts.version);
    expect(record!.provenance.transformerVersion).toBe(EXPRESSION_LOWERING_TRANSFORM_VERSION);
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
    expect(record!.segments.length).toBeGreaterThan(0);
  });
});

// ─── Erasure integrated into the A2 pipeline (JSX, anchors, segments) ──────

describe('erasure integrated with the A2 marked-print pipeline', () => {
  test('erasure inside a nested arrow body and around JSX in one lowering', () => {
    const harnessValue = harness(`function Fixture(items) {
      return items.map((item: Item) => <Row value={item as number} />);
    }`);
    const expression = findNode(harnessValue.sourceFile, ts.isReturnStatement).expression!;
    const { record, diagnostics } = harnessValue.registry.lower(expression, 'per-entry');
    expect(diagnostics).toEqual([]);
    expect(record!.lowered).not.toContain('<');
    expect(record!.lowered).toContain(`${RECIPE_CALLEE}("r0")`);
    expect(squeeze(record!.lowered)).toBe('items.map((item)=>__oe_recipe_ref("r0"))');
    expect(parsesAsJs(record!.lowered)).toBe(true);
  });

  test('a JSX value erased by an `as` wrapper still lowers to the recipe reference', () => {
    const harnessValue = harness(`function Fixture(props) {
      return (<A value={props.value} /> as unknown);
    }`);
    const expression = findNode(harnessValue.sourceFile, ts.isReturnStatement).expression!;
    const { record } = harnessValue.registry.lower(expression, 'per-entry');
    expect(squeeze(record!.lowered)).toBe(`(${RECIPE_CALLEE}("r0"))`);
    expect(record!.anchors.some((anchor) => anchor.fromJsx)).toBe(true);
  });

  test('anchors keep pointing at authored starts after erasure shifted the text', () => {
    const harnessValue = harness(fixtureSource('(value as number) + 1'));
    const { record } = lowerExpression(harnessValue);
    const expression = findNode(harnessValue.sourceFile, ts.isReturnStatement).expression!;
    const identifier = findNode(
      expression,
      (node): node is ts.Identifier => ts.isIdentifier(node) && node.text === 'value',
    );
    const anchor = anchorAt(record!, identifier.getStart(harnessValue.sourceFile));
    expect(anchor).toBeDefined();
    expect(squeeze(record!.lowered.slice(anchor!.generatedStart, anchor!.generatedEnd))).toBe(
      'value',
    );
    const point = generatedPoint(record!.lowered, anchor!.generatedStart);
    const segments = segmentsAt(record!.segments, point);
    expect(segments).toHaveLength(1);
    const authored = harnessValue.sourceFile.getLineAndCharacterOfPosition(
      identifier.getStart(harnessValue.sourceFile),
    );
    expect(segments[0]!.sourceLine).toBe(authored.line + 1);
    expect(segments[0]!.sourceColumn).toBe(authored.character);
  });

  test('erased expressions still round-trip through Source Map v3 segments', () => {
    const harnessValue = harness(fixtureSource('fn<string>(value as number)'));
    const { record } = lowerExpression(harnessValue);
    const builder = new SourceMapSegmentBuilder();
    for (const segment of record!.segments) builder.add(segment);
    const map = builder.build('erasure.tsx', harnessValue.source);
    expect(map.mappings.length).toBeGreaterThan(0);
    expect(map.sources).toEqual(['erasure.tsx']);
    expect(map.names).toContain('value');
  });

  test('lowering an erased expression is deterministic and repeatable', () => {
    const harnessValue = harness(fixtureSource('items.map((item: Item) => item as Item)'));
    const first = lowerExpression(harnessValue).record!;
    const second = lowerExpression(harnessValue).record!;
    expect(second.id).not.toBe(first.id);
    expect(second.lowered).toBe(first.lowered);
    expect(second.anchors).toEqual(first.anchors);
    expect(second.segments).toEqual(first.segments);
  });

  test('dispose and AST hygiene still hold for an erased expression', () => {
    const harnessValue = harness(fixtureSource('(value as number) + 1'));
    const expression = findNode(harnessValue.sourceFile, ts.isReturnStatement).expression!;
    const events: string[] = [];
    const result = lowerExpressionText(harnessValue.sourceFile, expression, {
      recipeReference: () => undefined,
      lifecycle: { created: () => events.push('created'), disposed: () => events.push('disposed') },
    });
    expect(result.diagnostics).toEqual([]);
    expect(events).toEqual(['created', 'disposed']);
    const visit = (node: ts.Node): void => {
      expect(ts.getSyntheticLeadingComments(node)).toBeUndefined();
      expect(ts.getSyntheticTrailingComments(node)).toBeUndefined();
      ts.forEachChild(node, visit);
    };
    visit(expression);
  });

  test('A1 resolver facts survive erasure (captures/dependencies are unchanged)', () => {
    const harnessValue = harness(
      `import { signal } from 'runtime';
function Fixture(props) {
  const s = signal(0);
  const read = () => (s.value as number);
  return read;
}`,
    );
    const read = findNode(
      harnessValue.sourceFile,
      (node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'read',
    );
    const { record, diagnostics } = harnessValue.registry.lower(read.initializer!, 'derived');
    expect(diagnostics).toEqual([]);
    expect(bindingNames(harnessValue.module, record!.captures)).toEqual(['s']);
    expect(bindingNames(harnessValue.module, record!.dependencies)).toEqual(['s']);
    expect(squeeze(record!.lowered)).toBe('()=>(s.value)');
  });

  test('erasure does not mask an A1 resolution failure', () => {
    const harnessValue = harness(fixtureSource('(missing as number)'));
    const { record, diagnostics } = lowerExpression(harnessValue);
    expect(record).toBeNull();
    expectDiagnostic(diagnostics, 'OEIR_UNRESOLVED_BINDING', harnessValue.source, 'missing');
  });
});

// ─── Fail-closed boundary outside the admitted erasure set ──────────────────

describe('fail-closed boundary outside the admitted erasure set', () => {
  test('a class expression is refused rather than half-erased', () => {
    const harnessValue = harness(fixtureSource('(class Node { field: number })'));
    const { record, diagnostics } = lowerExpression(harnessValue);
    expect(record).toBeNull();
    expectDiagnostic(diagnostics, 'OEIR_ERASURE_UNSUPPORTED', harnessValue.source);
  });

  test('a class declaration inside a nested function body is refused too', () => {
    const harnessValue = harness(
      fixtureSource('function () { class Local { field: number } return Local; }'),
    );
    const { record, diagnostics } = lowerExpression(harnessValue);
    expect(record).toBeNull();
    expectDiagnostic(diagnostics, 'OEIR_ERASURE_UNSUPPORTED', harnessValue.source);
  });

  test('a type-only declaration inside a nested body is refused (outside the erasure set)', () => {
    const harnessValue = harness(
      fixtureSource('function () { type Alias = number; return value; }'),
    );
    const { record, diagnostics } = lowerExpression(harnessValue);
    expect(record).toBeNull();
    expectDiagnostic(diagnostics, 'OEIR_ERASURE_UNSUPPORTED', harnessValue.source);
  });

  test('a `declare` declaration inside a nested body is refused', () => {
    const harnessValue = harness(
      fixtureSource('function () { declare const local: number; return local; }'),
    );
    const { record, diagnostics } = lowerExpression(harnessValue);
    expect(record).toBeNull();
    expectDiagnostic(diagnostics, 'OEIR_ERASURE_UNSUPPORTED', harnessValue.source);
  });

  test('the retired A2 code OEIR_ERASURE_DEFERRED is not emitted anywhere any more', () => {
    for (const expression of [
      'value as number',
      'value!',
      'fn<string>(value)',
      'value satisfies Shape',
      '(value: number) => value',
    ]) {
      const harnessValue = harness(fixtureSource(expression));
      const { diagnostics } = lowerExpression(harnessValue);
      expect(codesOf(diagnostics)).not.toContain('OEIR_ERASURE_DEFERRED');
    }
  });
});

// ─── Context-sensitive matrix (M03-B §6) ───────────────────────────────────

describe('M03-B §6 — context-sensitive matrix fails closed (no supported form in M03-I)', () => {
  const CASES: ReadonlyArray<{ expression: string; code: string; slice: string }> = [
    { expression: 'this.props', code: 'OEIR_UNSUPPORTED_THIS', slice: 'this' },
    { expression: 'arguments.length', code: 'OEIR_UNSUPPORTED_ARGUMENTS', slice: 'arguments' },
    { expression: 'super.value', code: 'OEIR_UNSUPPORTED_SUPER', slice: 'super' },
    { expression: '(() => new.target)', code: 'OEIR_UNSUPPORTED_NEW_TARGET', slice: 'new.target' },
    { expression: 'await pending', code: 'OEIR_AWAIT_OUTSIDE_ASYNC', slice: 'await pending' },
    {
      expression: 'function* () { yield 1; }',
      code: 'OEIR_UNSUPPORTED_GENERATOR',
      slice: 'yield 1',
    },
    { expression: "eval('1')", code: 'OEIR_DYNAMIC_SCOPE', slice: 'eval' },
  ];

  for (const entry of CASES) {
    test(`refuses ${entry.expression} with ${entry.code} and emits nothing`, () => {
      const harnessValue = harness(fixtureSource(entry.expression));
      const { record, diagnostics } = lowerExpression(harnessValue);
      expect(record).toBeNull();
      expect(harnessValue.registry.size).toBe(0);
      expectDiagnostic(diagnostics, entry.code, harnessValue.source, entry.slice);
    });
  }

  test('a context-sensitive construct inside a JSX recipe interior is recipe-owned, not this expression', () => {
    const harnessValue = harness(`function Fixture(props) {
      return <A value={() => this} />;
    }`);
    const expression = findNode(harnessValue.sourceFile, ts.isReturnStatement).expression!;
    const { record, diagnostics } = harnessValue.registry.lower(expression, 'per-entry');
    expect(diagnostics).toEqual([]);
    expect(record).not.toBeNull();
  });
});
