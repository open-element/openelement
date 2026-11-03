/**
 * M02.1 Semantic IR feasibility — negative cases and invariants.
 *
 * A spike is only evidence if it fails closed. Every test here asserts a coded
 * diagnostic, and the diagnostics must say where they can be located.
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

function buildCodes(source: string): { codes: string[]; diagnostics: IrDiagnostic[] } {
  const result = buildSemanticIr(source, FILE);
  const validation =
    result.component === null
      ? []
      : validateSemanticIr(result.component, { sourceLength: source.length });
  const diagnostics = [...result.diagnostics, ...validation];
  return { codes: diagnostics.map((diagnostic) => diagnostic.code), diagnostics };
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
    expect(buildCodes('function A(props) {\n  return <div {...props} />;\n}\n').codes).toContain(
      'OEIR_SPREAD_UNSUPPORTED',
    );
  });

  test('a non-declaration statement', () => {
    expect(
      buildCodes('function A() {\n  if (true) { return <div />; }\n  return <div />;\n}\n').codes,
    ).toContain('OEIR_STATEMENT_UNSUPPORTED');
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
    expect(buildCodes('function A() {\n  return <Box><span>x</span></Box>;\n}\n').codes).toContain(
      'OEIR_COMPONENT_CHILDREN_UNSUPPORTED',
    );
  });

  test('two returns', () => {
    expect(
      buildCodes('function A() {\n  return <div />;\n  return <span />;\n}\n').codes,
    ).toContain('OEIR_MULTIPLE_RETURNS');
  });
});

describe('diagnostics declare where they can be located', () => {
  test('module-level findings say `module`, never pretending to be source', () => {
    const missing = buildSemanticIr('const x = 1;\n', FILE);
    expect(missing.diagnostics.every((diagnostic) => diagnostic.origin === 'module')).toBe(true);

    const syntax = buildSemanticIr('function A( { return <div />; }\n', FILE);
    expect(syntax.diagnostics.every((diagnostic) => diagnostic.origin === 'module')).toBe(true);
  });

  test('authored-grammar findings point at source', () => {
    const { diagnostics } = buildCodes('function A(props) {\n  return <div {...props} />;\n}\n');
    const spread = diagnostics.find((diagnostic) => diagnostic.code === 'OEIR_SPREAD_UNSUPPORTED');
    expect(spread).toBeDefined();
    expect(spread!.origin).toBe('source');
    expect(spread!.span.file).toBe(FILE);
    expect(spread!.span.end).toBeGreaterThan(spread!.span.start);
  });

  test('IR-object findings point at the IR object', () => {
    const node: IrNode = {
      kind: 'dynamic-text',
      id: 'n1',
      tracked: true,
      expression: { kind: 'local', source: 'x', span: span(0, 1), reads: [] },
      span: span(0, 1),
    };
    const diagnostics = validateSemanticIr(componentWith({ roots: [node] }), { sourceLength: 20 });
    const tracked = diagnostics.find(
      (diagnostic) => diagnostic.code === 'OEIR_TRACKED_WITHOUT_SOURCE',
    );
    expect(tracked).toBeDefined();
    expect(tracked!.origin).toBe('source');
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
    const makeText = (): IrNode => ({ kind: 'text', id: 'dup', value: 'a', span: span(0, 1) });
    const element: IrNode = {
      kind: 'element',
      id: 'e1',
      tag: 'div',
      attributes: [],
      children: [makeText()],
      span: span(0, 5),
    };
    const diagnostics = validateSemanticIr(componentWith({ roots: [element, makeText()] }), {
      sourceLength: 20,
    });
    expect(codesOf(diagnostics)).toContain('OEIR_DUPLICATE_ID');
  });

  test('an owner cycle', () => {
    const diagnostics = validateSemanticIr(
      componentWith({
        owner: { id: 'a', parent: 'b', reason: 'component' },
        owners: [
          { id: 'a', parent: 'b', reason: 'component' },
          { id: 'b', parent: 'a', reason: 'insertion' },
        ],
      }),
      { sourceLength: 20 },
    );
    expect(codesOf(diagnostics)).toContain('OEIR_OWNER_CYCLE');
  });

  test('a duplicate owner id', () => {
    const diagnostics = validateSemanticIr(
      componentWith({
        owners: [
          { id: 'o1', parent: null, reason: 'component' },
          { id: 'o1', parent: null, reason: 'insertion' },
        ],
      }),
      { sourceLength: 20 },
    );
    expect(codesOf(diagnostics)).toContain('OEIR_OWNER_DUPLICATE');
  });

  test('an insertion site referencing an unknown recipe', () => {
    const site: IrNode = {
      kind: 'insertion-site',
      id: 's1',
      recipeId: 'missing',
      ownerId: 'owner0',
      span: span(0, 1),
    };
    const diagnostics = validateSemanticIr(componentWith({ roots: [site] }), { sourceLength: 20 });
    expect(codesOf(diagnostics)).toContain('OEIR_INSERTION_UNKNOWN_RECIPE');
  });

  test('an insertion site whose owner does not exist', () => {
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
        { kind: 'insertion-site', id: 's1', recipeId: 'r1', ownerId: 'ghost', span: span(0, 1) },
      ],
    });
    const diagnostics = validateSemanticIr(component, { sourceLength: 20 });
    expect(codesOf(diagnostics)).toContain('OEIR_INSERTION_OWNER_MISSING');
  });

  test('two insertion sites sharing one owner', () => {
    const component = componentWith({
      owners: [
        { id: 'owner0', parent: null, reason: 'component' },
        { id: 'shared', parent: 'owner0', reason: 'insertion' },
      ],
      recipes: [
        {
          kind: 'recipe',
          id: 'r1',
          target: { kind: 'component-ref', id: 'x', name: 'X', props: [], span: span(0, 3) },
          span: span(0, 3),
        },
      ],
      roots: [
        { kind: 'insertion-site', id: 's1', recipeId: 'r1', ownerId: 'shared', span: span(0, 1) },
        { kind: 'insertion-site', id: 's2', recipeId: 'r1', ownerId: 'shared', span: span(2, 3) },
      ],
    });
    const diagnostics = validateSemanticIr(component, { sourceLength: 20 });
    expect(codesOf(diagnostics)).toContain('OEIR_INSERTION_SHARED_OWNER');
  });

  test('a list naming a missing owner', () => {
    const node: IrNode = {
      kind: 'list',
      id: 'l1',
      ownerId: 'ghost',
      itemOwner: 'per-entry',
      items: { kind: 'local', source: 'x', span: span(0, 1), reads: [] },
      key: null,
      template: [{ kind: 'text', id: 't1', value: 'a', span: span(0, 1) }],
      span: span(0, 5),
    };
    const diagnostics = validateSemanticIr(componentWith({ roots: [node] }), { sourceLength: 20 });
    expect(codesOf(diagnostics)).toContain('OEIR_LIST_OWNER_MISSING');
  });

  test('a children projection naming a missing owner', () => {
    const node: IrNode = {
      kind: 'children-projection',
      id: 'p1',
      ownerId: 'ghost',
      span: span(0, 2),
    };
    const diagnostics = validateSemanticIr(componentWith({ roots: [node] }), { sourceLength: 20 });
    expect(codesOf(diagnostics)).toContain('OEIR_PROJECTION_OWNER_MISSING');
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

  test('an attribute span outside the source is caught too', () => {
    const element: IrNode = {
      kind: 'element',
      id: 'e1',
      tag: 'div',
      attributes: [
        {
          kind: 'dynamic-attribute',
          name: 'value',
          channel: 'property',
          expression: { kind: 'local', source: 'x', span: span(0, 1), reads: [] },
          tracked: false,
          span: span(30, 40),
        },
      ],
      children: [],
      span: span(0, 5),
    };
    const diagnostics = validateSemanticIr(componentWith({ roots: [element] }), {
      sourceLength: 20,
    });
    expect(codesOf(diagnostics)).toContain('OEIR_SPAN_OUT_OF_RANGE');
  });

  test('the IR rejects functions and class instances', () => {
    const withFunction = componentWith({});
    (withFunction as unknown as { extra: unknown }).extra = () => 1;
    expect(codesOf(validateSemanticIr(withFunction, { sourceLength: 20 }))).toContain(
      'OEIR_DATA_FUNCTION',
    );

    const withInstance = componentWith({});
    (withInstance as unknown as { extra: unknown }).extra = new Date(0);
    expect(codesOf(validateSemanticIr(withInstance, { sourceLength: 20 }))).toContain(
      'OEIR_DATA_INSTANCE',
    );
  });
});

describe('M02.2 — dynamic slots are collected from every surface', () => {
  const trackedWithoutSource =
    (): import('../../src/internal/compiler/semantic-ir/index.ts').IrDynamicAttribute => ({
      kind: 'dynamic-attribute',
      name: 'value',
      channel: 'property',
      expression: { kind: 'local', source: 'x', span: span(0, 1), reads: [] },
      tracked: true,
      span: span(0, 2),
    });

  test('a component-ref prop claiming tracking is checked', () => {
    const child: IrNode = {
      kind: 'component-ref',
      id: 'c1',
      name: 'Child',
      props: [trackedWithoutSource()],
      span: span(0, 3),
    };
    const diagnostics = validateSemanticIr(componentWith({ roots: [child] }), { sourceLength: 20 });
    expect(codesOf(diagnostics)).toContain('OEIR_TRACKED_WITHOUT_SOURCE');
  });

  test('a recipe target prop claiming tracking is checked', () => {
    const component = componentWith({
      recipes: [
        {
          kind: 'recipe',
          id: 'r1',
          target: {
            kind: 'component-ref',
            id: 'x',
            name: 'Child',
            props: [trackedWithoutSource()],
            span: span(0, 3),
          },
          span: span(0, 3),
        },
      ],
      roots: [
        { kind: 'insertion-site', id: 's1', recipeId: 'r1', ownerId: 'owner0', span: span(0, 1) },
      ],
    });
    const diagnostics = validateSemanticIr(component, { sourceLength: 20 });
    expect(codesOf(diagnostics)).toContain('OEIR_TRACKED_WITHOUT_SOURCE');
  });

  test('two lists sharing one region owner are rejected', () => {
    const makeList = (id: string): IrNode => ({
      kind: 'list',
      id,
      ownerId: 'shared-list-owner',
      itemOwner: 'per-entry',
      items: { kind: 'local', source: 'x', span: span(0, 1), reads: [] },
      key: null,
      template: [{ kind: 'text', id: `${id}-t`, value: 'a', span: span(0, 1) }],
      span: span(0, 5),
    });
    const diagnostics = validateSemanticIr(
      componentWith({
        owners: [
          { id: 'owner0', parent: null, reason: 'component' },
          { id: 'shared-list-owner', parent: 'owner0', reason: 'list-item' },
        ],
        roots: [makeList('l1'), makeList('l2')],
      }),
      { sourceLength: 20 },
    );
    expect(codesOf(diagnostics)).toContain('OEIR_LIST_SHARED_OWNER');
  });
});
