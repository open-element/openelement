/**
 * M02 Semantic IR feasibility — negative cases and invariants.
 *
 * A spike is only evidence if it fails closed. Every test here asserts a coded
 * diagnostic with a span, never a silent acceptance.
 */

import { describe, expect, test } from 'vitest';
import {
  buildSemanticIr,
  validateSemanticIr,
  type IrComponent,
  type IrDiagnostic,
  type IrNode,
  type IrSpan,
} from '../../src/internal/compiler/semantic-ir/index.ts';

const FILE = '/proj/src/negative.tsx';

function span(start: number, end: number): IrSpan {
  return { file: FILE, start, end, line: 1, column: start + 1 };
}

function buildCodes(source: string): { codes: string[]; hasComponent: boolean } {
  const result = buildSemanticIr(source, FILE);
  const validation =
    result.component === null
      ? []
      : validateSemanticIr(result.component, { sourceLength: source.length });
  return {
    codes: [...result.diagnostics, ...validation].map((diagnostic) => diagnostic.code),
    hasComponent: result.component !== null,
  };
}

function codesOf(diagnostics: readonly IrDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

/** A minimal well-formed component used to inject one invariant violation. */
function componentWith(overrides: Partial<IrComponent>): IrComponent {
  return {
    kind: 'component',
    id: 'c',
    name: 'C',
    file: FILE,
    propsParam: null,
    resources: [],
    recipes: [],
    owners: [{ id: 'owner0', parent: null, reason: 'component' }],
    roots: [],
    owner: { id: 'owner0', parent: null, reason: 'component' },
    span: span(0, 10),
    ...overrides,
  };
}

describe('unsupported authored grammar fails with a coded diagnostic', () => {
  test('spread attributes', () => {
    const { codes } = buildCodes(`function A(props) {
  return <div {...props} />;
}
`);
    expect(codes).toContain('OEIR_SPREAD_UNSUPPORTED');
  });

  test('a non-declaration statement', () => {
    const { codes } = buildCodes(`function A() {
  if (true) { return <div />; }
  return <div />;
}
`);
    expect(codes).toContain('OEIR_STATEMENT_UNSUPPORTED');
  });

  test('a module with no component', () => {
    const result = buildSemanticIr('const x = 1;\n', FILE);
    expect(result.component).toBeNull();
    expect(codesOf(result.diagnostics)).toContain('OEIR_COMPONENT_MISSING');
  });

  test('a syntax error reports OEIR_SYNTAX and builds nothing', () => {
    const result = buildSemanticIr('function A( { return <div />; }\n', FILE);
    expect(result.component).toBeNull();
    expect(codesOf(result.diagnostics)).toContain('OEIR_SYNTAX');
  });

  test('children on a component reference', () => {
    const { codes } = buildCodes(`function A() {
  return <Box><span>x</span></Box>;
}
`);
    expect(codes).toContain('OEIR_COMPONENT_CHILDREN_UNSUPPORTED');
  });

  test('two returns', () => {
    const { codes } = buildCodes(`function A() {
  return <div />;
  return <span />;
}
`);
    expect(codes).toContain('OEIR_MULTIPLE_RETURNS');
  });
});

describe('IR invariants reject malformed IR', () => {
  test('a dynamic slot claiming tracking without a reactive read', () => {
    const node: IrNode = {
      kind: 'dynamic-text',
      id: 'n1',
      tracked: true,
      expression: { kind: 'local', source: 'x', span: span(0, 1), reads: [] },
      span: span(0, 1),
    };
    const diagnostics = validateSemanticIr(componentWith({ roots: [node] }), { sourceLength: 20 });
    expect(codesOf(diagnostics)).toContain('OEIR_TRACKED_WITHOUT_SOURCE');
  });

  test('duplicate node ids', () => {
    const makeText = (): IrNode => ({
      kind: 'text',
      id: 'dup',
      value: 'a',
      span: span(0, 1),
    });
    const element: IrNode = {
      kind: 'element',
      id: 'e1',
      tag: 'div',
      attributes: [],
      children: [makeText()],
      span: span(0, 5),
    };
    // Two texts with the same id, one nested under an element with its own id.
    const second: IrNode = { ...makeText(), span: span(2, 3) };
    const diagnostics = validateSemanticIr(componentWith({ roots: [element, second] }), {
      sourceLength: 20,
    });
    expect(codesOf(diagnostics)).toContain('OEIR_DUPLICATE_ID');
  });

  test('an owner cycle', () => {
    const component = componentWith({
      owner: { id: 'a', parent: 'b', reason: 'component' },
      owners: [
        { id: 'a', parent: 'b', reason: 'component' },
        { id: 'b', parent: 'a', reason: 'insertion' },
      ],
      roots: [],
    });
    const diagnostics = validateSemanticIr(component, { sourceLength: 20 });
    expect(codesOf(diagnostics)).toContain('OEIR_OWNER_CYCLE');
  });

  test('an insertion site referencing an unknown recipe', () => {
    const site: IrNode = {
      kind: 'insertion-site',
      id: 's1',
      recipeId: 'missing',
      ownerId: 'owner1',
      span: span(0, 1),
    };
    const diagnostics = validateSemanticIr(componentWith({ roots: [site] }), { sourceLength: 20 });
    expect(codesOf(diagnostics)).toContain('OEIR_INSERTION_UNKNOWN_RECIPE');
  });

  test('a span outside the authored source', () => {
    const element: IrNode = {
      kind: 'element',
      id: 'e1',
      tag: 'div',
      attributes: [],
      children: [],
      span: span(5, 999),
    };
    const diagnostics = validateSemanticIr(componentWith({ roots: [element] }), {
      sourceLength: 20,
    });
    expect(codesOf(diagnostics)).toContain('OEIR_SPAN_OUT_OF_RANGE');
  });

  test('the IR rejects functions and class instances', () => {
    const withFunction = componentWith({ resources: [] });
    // Inject a function through a loosely-typed hole: the validator must catch it.
    (withFunction as unknown as { extra: unknown }).extra = () => 1;
    const diagnostics = validateSemanticIr(withFunction, { sourceLength: 20 });
    expect(codesOf(diagnostics)).toContain('OEIR_DATA_FUNCTION');

    const withInstance = componentWith({ resources: [] });
    (withInstance as unknown as { extra: unknown }).extra = new Date(0);
    const diagnostics2 = validateSemanticIr(withInstance, { sourceLength: 20 });
    expect(codesOf(diagnostics2)).toContain('OEIR_DATA_INSTANCE');
  });

  test('two insertion sites sharing one owner', () => {
    const component = componentWith({
      recipes: [
        {
          kind: 'recipe',
          id: 'r1',
          target: { kind: 'component-ref', id: 'x', name: 'X', props: [], span: span(0, 3) },
          span: span(0, 3),
        },
      ],
      roots: [
        { kind: 'insertion-site', id: 's1', recipeId: 'r1', ownerId: 'o1', span: span(0, 1) },
        { kind: 'insertion-site', id: 's2', recipeId: 'r1', ownerId: 'o1', span: span(2, 3) },
      ],
    });
    const diagnostics = validateSemanticIr(component, { sourceLength: 20 });
    expect(codesOf(diagnostics)).toContain('OEIR_INSERTION_SHARED_OWNER');
  });
});
