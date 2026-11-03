/**
 * M02 Semantic IR feasibility — the five approved worked examples.
 *
 * These tests answer one question only: can the spike IR express the semantics
 * the approved contract requires, with spans, identity, ownership and the
 * ordinary-local / computed / inline-tracking distinction intact?
 *
 * They deliberately assert **nothing** about DOM, SSR, claim or codegen: those
 * belong to M05–M08. A green test here is IR expressiveness, not execution.
 */

import { describe, expect, test } from 'vitest';
import {
  buildSemanticIr,
  validateSemanticIr,
  type IrComponent,
  type IrDynamicAttribute,
  type IrDynamicText,
  type IrElement,
  type IrInsertionSite,
  type IrList,
  type IrNode,
} from '../../src/internal/compiler/semantic-ir/index.ts';

const FILE = '/proj/src/example.tsx';

function build(source: string): { component: IrComponent; codes: string[] } {
  const result = buildSemanticIr(source, FILE);
  const component = result.component;
  if (component === null) {
    throw new Error(
      `expected a component; diagnostics: ${result.diagnostics.map((d) => d.code).join(', ')}`,
    );
  }
  const validation = validateSemanticIr(component, { sourceLength: source.length });
  const codes = [...result.diagnostics, ...validation].map((d) => d.code);
  return { component, codes };
}

function errorsOnly(codes: string[]): string[] {
  return codes.filter(
    (code) => !code.startsWith('OEIR_UNKEYED_LIST') && !code.startsWith('OEIR_EMPTY_OUTPUT'),
  );
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
    // No element id is a tag name, and nothing in the IR looks like an element
    // registration: the component itself is not an element.
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
    // An inline JSX expression reading a signal is a tracked read, not a local.
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

describe('M02 example 3 — stateful keyed list', () => {
  const source = `function List(props) {
  const draft = signal('');
  return (
    <ul>
      {props.items.map(item => (
        <li key={item.id} data-draft={draft.value}>{item.name}</li>
      ))}
    </ul>
  );
}
`;

  test('expresses key, item template and per-entry reads', () => {
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    const list = firstElement(component.roots).children.find(
      (child): child is IrList => child.kind === 'list',
    );
    expect(list).toBeDefined();
    expect(list!.key).not.toBeNull();
    expect(list!.key!.kind).toBe('key');
    expect(list!.items.source).toBe('props.items');
    expect(list!.template).toHaveLength(1);
    const row = list!.template[0]!;
    expect(row.kind).toBe('element');
    if (row.kind !== 'element') throw new Error('expected row element');
    expect(row.tag).toBe('li');
    // The key is also present on the row element as a key-channel attribute.
    expect(dynamicAttribute(row, 'key').channel).toBe('key');
    // A draft read inside the row is tracked; identity is per list entry.
    expect(dynamicAttribute(row, 'data-draft').tracked).toBe(true);
  });

  test('an unkeyed list is expressed explicitly as positional identity', () => {
    const unkeyed = `function Positions(props) {
  return <ul>{props.items.map(item => <li>{item.name}</li>)}</ul>;
}
`;
    const { component, codes } = build(unkeyed);
    expect(codes).toContain('OEIR_UNKEYED_LIST');
    expect(errorsOnly(codes)).toEqual([]);
    const list = firstElement(component.roots).children.find(
      (child): child is IrList => child.kind === 'list',
    );
    expect(list!.key).toBeNull();
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
    // Owners exist only for the component itself and the two insertions.
    expect(component.owners.filter((owner) => owner.reason === 'insertion')).toHaveLength(2);
    expect(component.owners.filter((owner) => owner.reason === 'component')).toHaveLength(1);
  });

  test('a recipe that is never inserted is reported, not silently dropped', () => {
    const unused = `function App() {
  const c = <Counter />;
  return <div>static</div>;
}
`;
    const { codes } = build(unused);
    expect(codes).toContain('OEIR_RECIPE_UNUSED');
  });
});

describe('M02 example 5 — the same stateful list, IR expressiveness only', () => {
  const source = `function Row(props) {
  const draft = signal(props.item.name);
  return (
    <li>
      <span>{props.item.name}</span>
      <input value={draft.value} onInput={event => { draft.value = event.currentTarget.value; }} />
    </li>
  );
}
`;

  test('the row used across SSR/claim is expressible with spans and ownership', () => {
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    const row = firstElement(component.roots);
    expect(row.tag).toBe('li');

    const span = row.children.find(
      (child): child is IrElement => child.kind === 'element' && child.tag === 'span',
    );
    const label = span!.children[0]!;
    expect(label.kind).toBe('dynamic-text');
    if (label.kind !== 'dynamic-text') throw new Error('expected dynamic text');
    expect(label.tracked).toBe(true);
    expect(label.expression.reads.some((read) => read.binding === 'prop')).toBe(true);

    const input = row.children.find(
      (child): child is IrElement => child.kind === 'element' && child.tag === 'input',
    );
    const value = dynamicAttribute(input!, 'value');
    expect(value.tracked).toBe(true);
    expect(value.expression.reads).toEqual([{ name: 'draft', binding: 'signal' }]);
    expect(dynamicAttribute(input!, 'onInput').expression.kind).toBe('handler');
  });

  test('every node carries a span inside the authored source', () => {
    const { component } = build(source);
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

  test('the IR is plain data — no functions, no platform objects', () => {
    const { codes } = build(source);
    expect(codes.filter((code) => code.startsWith('OEIR_DATA_'))).toEqual([]);
  });
});
