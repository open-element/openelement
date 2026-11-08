/**
 * M03-I-3 — differential erasure oracle (Route 2 as oracle ONLY).
 *
 * Authority: `docs/architecture/m03-expression-identity.md` (M03-B) §3 Route 3,
 * §9 risk table ("erasure visitor incomplete for admitted syntax"), §10
 * ("Differential oracle scope"): Route 2 `ts.transpileModule` is an oracle for
 * TypeScript's erasure, not for OpenElement's semantics, and the production
 * mechanism must never delegate to it.
 *
 * What this file proves:
 * 1. for an erasure-only corpus, the production erasure output is
 *    **semantically equivalent** to Route 2's erased output — compared as a
 *    normalized AST shape (syntax kind + structural children + literal text),
 *    never as raw text equality (spacing, parentheses and quoting differ);
 * 2. the production lowering path never calls `ts.transpileModule`,
 *    `ts.createProgram` or `program.emit` — proven twice: a runtime spy while
 *    the corpus lowers, and a static source scan of the production modules;
 * 3. the TypeScript version the oracle runs against is pinned and recorded.
 *
 * Route 1 (`ts.Program`/`program.emit`) is NOT used or pre-authorized; this
 * file only uses the one-shot `transpileModule` API in tests.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { EXPRESSION_LOWERING_TRANSFORM_VERSION } from '../../src/internal/compiler/semantic-core/expression-lowering.ts';
import {
  createExpressionRegistry,
  type LoweredExpressionRecord,
} from '../../src/internal/compiler/semantic-core/expression-registry.ts';
import { resolveModule } from '../../src/internal/compiler/semantic-core/scope-resolution.ts';

const FILE = '/proj/src/erasure-oracle.tsx';

// ─── Production lowering ────────────────────────────────────────────────────

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

function productionLower(
  expressionText: string,
  declarations = '',
): { readonly record: LoweredExpressionRecord | null; readonly sourceFile: ts.SourceFile } {
  const source = `${declarations}
function Fixture(value, fn, items, obj) {
  return ${expressionText};
}`;
  const sourceFile = ts.createSourceFile(
    FILE,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  const module = resolveModule(sourceFile, { components: [] });
  const registry = createExpressionRegistry({
    module,
    recipeReference: () => undefined,
  });
  const expression = findNode(sourceFile, ts.isReturnStatement).expression!;
  const { record, diagnostics } = registry.lower(expression, 'setup');
  if (diagnostics.length > 0) {
    throw new Error(
      `production lowering refused ${expressionText}: ${diagnostics.map((d) => d.code).join(', ')}`,
    );
  }
  return { record, sourceFile };
}

// ─── Route 2 oracle (tests only) ───────────────────────────────────────────

/** `true` once the oracle actually delegated to `ts.transpileModule`. */
let oracleCallCount = 0;

/** Route 2: erase through TypeScript's own one-shot emitter (ORACLE ONLY). */
function route2ErasedExpression(authoredExpressionText: string): ts.Expression {
  oracleCallCount += 1;
  const result = ts.transpileModule(`const __oe_oracle = (\n${authoredExpressionText}\n);`, {
    fileName: 'oracle.tsx',
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
  });
  expect(result.diagnostics ?? []).toEqual([]);
  const outputFile = ts.createSourceFile(
    'oracle.js',
    result.outputText,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const declaration = findNode(
    outputFile,
    (node): node is ts.VariableDeclaration =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === '__oe_oracle',
  );
  return declaration.initializer!;
}

/** Parse a lowered text as one expression (statement position needs parens). */
function parseLoweredExpression(loweredText: string): ts.Expression {
  const sourceFile = ts.createSourceFile(
    'lowered.js',
    `(${loweredText});`,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const statement = sourceFile.statements[0];
  if (statement === undefined || !ts.isExpressionStatement(statement)) {
    throw new Error(`lowered text did not parse as an expression: ${loweredText}`);
  }
  let expression: ts.Expression = statement.expression;
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  return expression;
}

/**
 * Semantic-shape normalization: syntax kind + structural children + literal
 * text. Parentheses are insignificant (unwrapped); positions and trivia are
 * ignored. Two expressions with the same shape evaluate identically modulo
 * identifier bindings, which the corpus keeps equal.
 */
function normalizedShape(node: ts.Node): string {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  if (ts.isIdentifier(current)) return `id:${current.text}`;
  if (ts.isStringLiteralLike(current)) return `str:${current.text}`;
  if (ts.isNumericLiteral(current)) return `num:${current.text}`;
  if (ts.isBigIntLiteral(current)) return `bigint:${current.text}`;
  if (ts.isRegularExpressionLiteral(current)) return `re:${current.text}`;
  if (current.kind === ts.SyntaxKind.TrueKeyword) return 'kw:true';
  if (current.kind === ts.SyntaxKind.FalseKeyword) return 'kw:false';
  if (current.kind === ts.SyntaxKind.NullKeyword) return 'kw:null';
  const children: string[] = [];
  ts.forEachChild(current, (child) => children.push(normalizedShape(child)));
  return `${ts.SyntaxKind[current.kind]}(${children.join('|')})`;
}

// ─── Corpus (erasure-only; JSX is A2's separate matrix) ────────────────────

interface CorpusEntry {
  readonly expression: string;
  /** Declarations the expression may read (class declarations for `new`). */
  readonly declarations?: string;
}

const CORPUS: readonly CorpusEntry[] = [
  { expression: 'value as number' },
  { expression: 'value as unknown as string' },
  { expression: 'value as const' },
  { expression: 'value!' },
  { expression: 'fn<string>(value)' },
  { expression: 'new Box<string>(value)', declarations: 'class Box {}' },
  { expression: 'value satisfies Shape' },
  { expression: '(value as { length: number }).length' },
  { expression: '(x: number) => x + 1' },
  { expression: '<T,>(item: T) => item' },
  { expression: '(x: number, y?: string) => x' },
  { expression: '(x: number): number => x' },
  { expression: 'function (this: unknown, value: number) { return value; }' },
  { expression: '(() => { const length: number = value; return length; })()' },
  {
    expression: '((value) => { try { return value; } catch (error: unknown) { return error; } })()',
  },
  {
    expression:
      '(function () { function inner(x: number): number { return x; } return inner(value); })()',
  },
  { expression: '({ method(x: number): number { return x; } }).method(value)' },
  { expression: 'fn<string>(value as number, (item: Item) => item)' },
  { expression: 'items.map((item: Item) => item as Item)' },
];

describe('M03-B §10 differential erasure oracle (production vs Route 2)', () => {
  for (const entry of CORPUS) {
    test(`normalized erasure parity: ${entry.expression}`, () => {
      const { record, sourceFile } = productionLower(entry.expression, entry.declarations ?? '');
      expect(record).not.toBeNull();
      // The authored corpus entry really contains TypeScript-only syntax…
      expect(entry.expression).toMatch(/ as | satisfies |!|:\s*\w|<[A-Za-z,]+>/);
      // …the production text is JavaScript…
      const production = parseLoweredExpression(record!.lowered);
      // …and it has the same normalized shape as TypeScript's own erasure.
      const authored = findNode(sourceFile, (node): node is ts.ReturnStatement =>
        ts.isReturnStatement(node),
      ).expression!;
      const oracle = route2ErasedExpression(authored.getText(sourceFile));
      expect(normalizedShape(production)).toBe(normalizedShape(oracle));
    });
  }

  test('the oracle is a real erasure and not a tautology', () => {
    const before = oracleCallCount;
    const oracle = route2ErasedExpression('value as number');
    expect(oracleCallCount).toBe(before + 1);
    expect(normalizedShape(oracle)).toBe(normalizedShape(parseLoweredExpression('value')));
    expect(normalizedShape(oracle)).not.toBe(
      normalizedShape(parseLoweredExpression('value as number')),
    );
  });

  test('the pinned TypeScript version is the one the oracle ran against', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(ts.version).toBe(manifest.dependencies?.typescript);
    const { record } = productionLower('value as number');
    expect(record!.provenance.typescriptVersion).toBe(ts.version);
    expect(record!.provenance.transformerVersion).toBe(EXPRESSION_LOWERING_TRANSFORM_VERSION);
  });
});

// ─── Mechanism purity: Route 2/Route 1 are oracle-only ─────────────────────
//
// The runtime guard (a mocked `typescript` default whose `transpileModule` /
// `createProgram` throw) lives in `erasure-mechanism-purity.test.ts`, because
// module mocking must apply to the production imports in that file only.

describe('the production mechanism never delegates to Route 2 or Route 1', () => {
  test('static proof: the production modules contain no Route 2/Route 1 call', () => {
    const files = ['expression-lowering.ts', 'expression-registry.ts', 'type-erasure.ts'];
    for (const file of files) {
      const source = readFileSync(
        new URL(`../../src/internal/compiler/semantic-core/${file}`, import.meta.url),
        'utf8',
      );
      expect(source, `${file} must not call ts.transpileModule`).not.toMatch(
        /ts\.transpileModule\s*\(/,
      );
      expect(source, `${file} must not call ts.createProgram`).not.toMatch(
        /ts\.createProgram\s*\(/,
      );
      expect(source, `${file} must not call program.emit`).not.toMatch(/\.emit\s*\(/);
    }
    // The oracle side is the only place that delegates (and it is a test file).
    const oracleSource = readFileSync(new URL(import.meta.url), 'utf8');
    expect(oracleSource).toMatch(/ts\.transpileModule\s*\(/);
  });
});
