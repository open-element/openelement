/**
 * M03-I-3 — runtime mechanism-purity guard for the erasure/lowering path.
 *
 * Design rule (M03-B §3/§10): Route 2 (`ts.transpileModule`) is an ORACLE API
 * used by tests to check TypeScript's erasure; Route 1 (`ts.createProgram` /
 * `program.emit`) is a documented fallback that is NOT pre-authorized. The
 * production lowering path must use neither.
 *
 * This file mocks the `typescript` default export as a proxy whose
 * `transpileModule` and `createProgram` throw, then runs the production
 * resolver + lowering corpus through it. Any accidental delegation fails the
 * test loudly. The mock is file-scoped, so the differential oracle file keeps
 * the real API.
 */

import { describe, expect, test, vi } from 'vitest';

vi.mock('typescript', async (importOriginal) => {
  const original = await importOriginal<typeof import('typescript')>();
  const real = (original as unknown as { default: object }).default;
  const guarded = new Proxy(real, {
    get(target, property, receiver) {
      if (property === 'transpileModule' || property === 'createProgram') {
        return () => {
          throw new Error(
            `production lowering called the oracle-only TypeScript API '${String(property)}'`,
          );
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return { ...original, default: guarded };
});

import ts from 'typescript';
import { createExpressionRegistry } from '../../src/internal/compiler/semantic-core/expression-registry.ts';
import { resolveModule } from '../../src/internal/compiler/semantic-core/scope-resolution.ts';

const FILE = '/proj/src/erasure-purity.tsx';

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

function lowerOne(expression: string): void {
  const source = `function Fixture(value, fn, items) { return ${expression}; }`;
  const sourceFile = ts.createSourceFile(
    FILE,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  const module = resolveModule(sourceFile, { components: [] });
  const registry = createExpressionRegistry({ module, recipeReference: () => undefined });
  const expressionNode = findAllNodes(sourceFile, (node): node is ts.ReturnStatement =>
    ts.isReturnStatement(node),
  )[0]!.expression!;
  const { record, diagnostics } = registry.lower(expressionNode, 'setup');
  expect(diagnostics).toEqual([]);
  expect(record).not.toBeNull();
}

describe('production lowering under a guard that forbids Route 2 / Route 1 APIs', () => {
  test('the guard mock is active (transpileModule now throws)', () => {
    expect(() => ts.transpileModule('const x = 1;', {})).toThrow(/oracle-only TypeScript API/);
    expect(() => ts.createProgram([], {})).toThrow(/oracle-only TypeScript API/);
  });

  test('the erasure corpus lowers without touching the oracle-only APIs', () => {
    for (const expression of [
      'value as number',
      'value!',
      'fn<string>(value)',
      'value satisfies Shape',
      '(x: number) => x + 1',
      '<T,>(item: T) => item',
      '(() => { const length: number = value; return length; })()',
      '(value as { length: number }).length',
    ]) {
      expect(() => lowerOne(expression), expression).not.toThrow();
    }
  });
});
