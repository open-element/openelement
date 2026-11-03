/**
 * M02.1 Semantic IR feasibility — the approved worked examples.
 *
 * These tests answer one question only: can the spike IR express the semantics
 * the approved contract requires, with spans, identity, ownership and the
 * ordinary-local / computed / inline-tracking distinction intact?
 *
 * They assert **nothing** about DOM, SSR, claim or codegen: those belong to
 * M05–M08. A green test here is IR expressiveness, not execution.
 */

import { describe, expect, test } from 'vitest';
import {
  buildSemanticIr,
  validateSemanticIr,
  type IrComponent,
  type IrCondition,
  type IrDynamicAttribute,
  type IrDynamicText,
  type IrElement,
  type IrInsertionSite,
  type IrList,
  type IrNode,
} from '../../src/internal/compiler/semantic-ir/index.ts';

const FILE = '/proj/src/example.tsx';

function build(source: string, file = FILE): { component: IrComponent; codes: string[] } {
  const result = buildSemanticIr(source, file);
  const component = result.component;
  if (component === null) {
    throw new Error(
      `expected a component; diagnostics: ${result.diagnostics.map((d) => d.code).join(', ')}`,
    );
  }
  const validation = validateSemanticIr(component, { sourceLength: source.length });
  return { component, codes: [...result.diagnostics, ...validation].map((d) => d.code) };
}

/** Warnings that are expected in specific fixtures. */
const EXPECTED_WARNINGS = new Set(['OEIR_UNKEYED_LIST', 'OEIR_EMPTY_OUTPUT', 'OEIR_RECIPE_UNUSED']);

function errorsOnly(codes: string[]): string[] {
  return codes.filter((code) => !EXPECTED_WARNINGS.has(code));
}

function firstElement(nodes: readonly IrNode[]): IrElement {
  const element = nodes.find((node) => node.kind === 'element');
  if (element === undefined || element.kind !== 'element') throw new Error('expected an element');
  return element;
}

function dynamicAttribute(element: IrElement, name: string): IrDynamicAttribute {
  const attribute = element.attributes.find(
    (candidate): candidate is IrDynamicAttribute =>
      candidate.kind === 'dynamic-attribute' && candidate.name === name,
  );
  if (attribute === undefined) throw new Error(`expected dynamic attribute '${name}'`);
  return attribute;
}

describe('M02 example 1 — static hostless component', () => {
  const source = `function Page() {
  return (
    <>
      <Header />
      <main>Body</main>
      <Footer />
    </>
  );
}
`;

  test('expresses a fragment with component refs and an element', () => {
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    expect(component.roots).toHaveLength(1);
    const root = component.roots[0]!;
    expect(root.kind).toBe('fragment');
    if (root.kind !== 'fragment') throw new Error('expected fragment');
    expect(root.children.map((child) => child.kind)).toEqual([
      'component-ref',
      'element',
      'component-ref',
    ]);
    const main = root.children[1]!;
    if (main.kind !== 'element') throw new Error('expected element');
    expect(main.tag).toBe('main');
    expect(main.children).toHaveLength(1);
    expect(main.children[0]!.kind).toBe('text');
  });

  test('empty output is a legal root with no children', () => {
    const emptySource = 'function Empty() {\n  return <></>;\n}\n';
    const { component, codes } = build(emptySource);
    expect(codes).toContain('OEIR_EMPTY_OUTPUT');
    expect(errorsOnly(codes)).toEqual([]);
    const root = component.roots[0]!;
    expect(root.kind).toBe('fragment');
    if (root.kind !== 'fragment') throw new Error('expected fragment');
    expect(root.children).toHaveLength(0);
  });

  test('a hostless component declares no custom element and no owner host', () => {
    const { component } = build(source);
    expect(component.owner.reason).toBe('component');
    expect(component.owner.parent).toBeNull();
    expect(component.kind).toBe('component');
  });
});

describe('M02 example 2 — signals-driven component', () => {
  const source = `function Counter() {
  const n = signal(0);
  const d = computed(() => n.value * 2);
  return <button onClick={() => { n.value++; }}>{n.value}:{d.value}</button>;
}
`;

  test('keeps signal, computed and inline read as three distinct tiers', () => {
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    expect(component.resources.map((resource) => [resource.name, resource.kind])).toEqual([
      ['n', 'signal'],
      ['d', 'computed'],
    ]);
    const button = firstElement(component.roots);
    const children = button.children.filter(
      (child): child is IrDynamicText => child.kind === 'dynamic-text',
    );
    expect(children).toHaveLength(2);
    expect(children[0]!.expression.kind).toBe('tracked');
    expect(children[0]!.tracked).toBe(true);
    expect(children[0]!.expression.reads).toEqual([{ name: 'n', binding: 'signal' }]);
    expect(children[1]!.expression.reads).toEqual([{ name: 'd', binding: 'computed' }]);
  });

  test('an event handler is a handler expression, never a tracked read', () => {
    const { component } = build(source);
    const button = firstElement(component.roots);
    const onClick = dynamicAttribute(button, 'onClick');
    expect(onClick.channel).toBe('event');
    expect(onClick.expression.kind).toBe('handler');
    expect(onClick.tracked).toBe(false);
  });
});

describe('M02 example 3+5 — one stateful list, shared semantic fixture', () => {
  // The list owns no draft: each Row does. This is the M01 §11.3 shape, and the
  // pair is asserted together so "list structure" and "row-private state" can no
  // longer be proven separately by accident.
  const listSource = `function List(props) {
  return (
    <ul>
      {props.items.map(item => (
        <Row key={item.id} item={item} />
      ))}
    </ul>
  );
}
`;
  const rowSource = `function Row(props) {
  const draft = signal(props.item.name);
  return (
    <li>
      <span>{props.item.name}</span>
      <input value={draft.value} />
    </li>
  );
}
`;

  test('the list references Row with a stable key and per-entry ownership', () => {
    const { component, codes } = build(listSource, '/proj/src/list.tsx');
    expect(errorsOnly(codes)).toEqual([]);
    const list = firstElement(component.roots).children.find(
      (child): child is IrList => child.kind === 'list',
    );
    expect(list).toBeDefined();
    expect(list!.key).not.toBeNull();
    expect(list!.key!.kind).toBe('key');
    // The data source keeps reactive semantics: props.items is a tracked read.
    expect(list!.items.kind).toBe('tracked');
    expect(list!.items.reads).toEqual([{ name: 'props', binding: 'prop' }]);
    // Per-entry ownership is declared, not implied.
    expect(list!.itemOwner).toBe('per-entry');
    expect(component.owners.some((owner) => owner.id === list!.ownerId)).toBe(true);
    // The template is a component reference carrying the item prop.
    expect(list!.template).toHaveLength(1);
    const row = list!.template[0]!;
    expect(row.kind).toBe('component-ref');
    if (row.kind !== 'component-ref') throw new Error('expected component-ref');
    expect(row.name).toBe('Row');
    expect(row.props.map((prop) => prop.name).sort()).toEqual(['item', 'key']);
  });

  test('the Row owns a private draft while reading the current item', () => {
    const { component, codes } = build(rowSource, '/proj/src/row.tsx');
    expect(errorsOnly(codes)).toEqual([]);
    expect(component.resources.map((resource) => [resource.name, resource.kind])).toEqual([
      ['draft', 'signal'],
    ]);
    const li = firstElement(component.roots);
    const span = li.children.find(
      (child): child is IrElement => child.kind === 'element' && child.tag === 'span',
    );
    const label = span!.children[0]!;
    if (label.kind !== 'dynamic-text') throw new Error('expected dynamic text');
    expect(label.tracked).toBe(true);
    expect(label.expression.reads).toEqual([{ name: 'props', binding: 'prop' }]);
    const input = li.children.find(
      (child): child is IrElement => child.kind === 'element' && child.tag === 'input',
    );
    const value = dynamicAttribute(input!, 'value');
    expect(value.tracked).toBe(true);
    expect(value.expression.reads).toEqual([{ name: 'draft', binding: 'signal' }]);
  });

  test('props replacement keeps the row instance: identity lives in key + reference', () => {
    const { component } = build(listSource, '/proj/src/list.tsx');
    const list = firstElement(component.roots).children.find(
      (child): child is IrList => child.kind === 'list',
    );
    const row = list!.template[0]!;
    if (row.kind !== 'component-ref') throw new Error('expected component-ref');
    // Identity is (component reference + key); the item value is a prop, so a new
    // item object can replace the prop without changing either identity input.
    const keyProp = row.props.find(
      (prop): prop is IrDynamicAttribute =>
        prop.kind === 'dynamic-attribute' && prop.channel === 'key',
    );
    const itemProp = row.props.find((prop) => prop.name === 'item');
    expect(keyProp).toBeDefined();
    expect(keyProp!.expression.kind).toBe('key');
    expect(itemProp).toBeDefined();
    expect(itemProp!.kind).toBe('dynamic-attribute');
  });
});

describe('M02 example 4 — reusable JSX value (insertion recipe)', () => {
  const source = `function App() {
  const c = <Counter />;
  return <>{c}{c}</>;
}
`;

  test('one recipe, two insertion sites, two independent owners', () => {
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    expect(component.recipes).toHaveLength(1);
    const root = component.roots[0]!;
    if (root.kind !== 'fragment') throw new Error('expected fragment');
    const sites = root.children.filter(
      (child): child is IrInsertionSite => child.kind === 'insertion-site',
    );
    expect(sites).toHaveLength(2);
    expect(sites[0]!.recipeId).toBe(sites[1]!.recipeId);
    expect(sites[0]!.ownerId).not.toBe(sites[1]!.ownerId);
  });

  test('creating a recipe is not mounting it: the recipe carries no owner', () => {
    const { component } = build(source);
    const recipe = component.recipes[0]!;
    expect(Object.keys(recipe)).not.toContain('owner');
    expect(component.owners.filter((owner) => owner.reason === 'insertion')).toHaveLength(2);
    expect(component.owners.filter((owner) => owner.reason === 'component')).toHaveLength(1);
  });
});

describe('M02.1 — the three evaluation tiers, explicitly', () => {
  test('an ordinary local interpolated into JSX stays a snapshot', () => {
    const source = `function Snapshot(props) {
  const name = props.name;
  return <p>{name}</p>;
}
`;
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    const p = firstElement(component.roots);
    const text = p.children[0]!;
    if (text.kind !== 'dynamic-text') throw new Error('expected dynamic text');
    // The local is not a reactive source, so the slot is not tracked.
    expect(text.expression.kind).toBe('local');
    expect(text.tracked).toBe(false);
  });

  test('a literal attribute is legal and is not marked tracked', () => {
    const source = `function Example() {
  return <input value={1} />;
}
`;
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    const input = firstElement(component.roots);
    const value = dynamicAttribute(input, 'value');
    expect(value.expression.kind).toBe('literal');
    expect(value.tracked).toBe(false);
  });

  test('a plain local attribute is a snapshot, a prop attribute is tracked', () => {
    const source = `function Fields(props) {
  const width = 10;
  return <input value={width} data-name={props.name} />;
}
`;
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    const input = firstElement(component.roots);
    expect(dynamicAttribute(input, 'value').tracked).toBe(false);
    expect(dynamicAttribute(input, 'data-name').tracked).toBe(true);
  });
});

describe('M02.1 — admitted syntax that needs a worked example', () => {
  test('condition is expressible with both branches', () => {
    const source = `function Maybe(props) {
  return <div>{props.ok ? <span>on</span> : <em>off</em>}</div>;
}
`;
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    const div = firstElement(component.roots);
    const condition = div.children.find(
      (child): child is IrCondition => child.kind === 'condition',
    );
    expect(condition).toBeDefined();
    expect(condition!.test.kind).toBe('tracked');
    expect(condition!.consequent).toHaveLength(1);
    expect(condition!.alternate).not.toBeNull();
    expect(condition!.alternate!).toHaveLength(1);
  });

  test('children projection gets its own owner', () => {
    const source = `function Frame(props) {
  return <section>{props.children}</section>;
}
`;
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    const section = firstElement(component.roots);
    const projection = section.children.find((child) => child.kind === 'children-projection');
    expect(projection).toBeDefined();
    if (projection === undefined || projection.kind !== 'children-projection') {
      throw new Error('expected children projection');
    }
    expect(component.owners.some((owner) => owner.id === projection.ownerId)).toBe(true);
  });

  test('the same stateful list carries spans and stays plain data', () => {
    const source = `function Row(props) {
  const draft = signal(props.item.name);
  return <li><span>{props.item.name}</span><input value={draft.value} /></li>;
}
`;
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    expect(codes.filter((code) => code.startsWith('OEIR_DATA_'))).toEqual([]);
    const visit = (nodes: readonly IrNode[]): void => {
      for (const node of nodes) {
        expect(node.span.file).toBe(FILE);
        expect(node.span.start).toBeGreaterThanOrEqual(0);
        expect(node.span.end).toBeLessThanOrEqual(source.length);
        expect(node.span.end).toBeGreaterThanOrEqual(node.span.start);
        expect(node.span.line).toBeGreaterThanOrEqual(1);
        expect(node.span.column).toBeGreaterThanOrEqual(1);
        if (node.kind === 'element' || node.kind === 'fragment') visit(node.children);
      }
    };
    visit(component.roots);
  });
});

describe('M02.2 — component-ref props carry tracking', () => {
  test('a reactive component prop is tracked, a literal one is not', () => {
    const source = `function Panel(props) {
  return <div><Child value={props.value} fixed={1} /></div>;
}
`;
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    const div = firstElement(component.roots);
    const child = div.children.find((node) => node.kind === 'component-ref');
    expect(child).toBeDefined();
    if (child === undefined || child.kind !== 'component-ref')
      throw new Error('expected component-ref');
    const props = child.props.filter(
      (prop): prop is IrDynamicAttribute => prop.kind === 'dynamic-attribute',
    );
    const value = props.find((prop) => prop.name === 'value');
    const fixed = props.find((prop) => prop.name === 'fixed');
    expect(value!.tracked).toBe(true);
    expect(value!.expression.kind).toBe('tracked');
    expect(fixed!.tracked).toBe(false);
    expect(fixed!.expression.kind).toBe('literal');
  });
});
