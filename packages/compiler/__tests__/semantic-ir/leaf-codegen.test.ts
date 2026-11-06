/**
 * Alpha16a M05 — the first G1 slice: generated leaf mount/update/dispose runs.
 *
 * Unlike examples.test.ts (IR expressiveness only), these tests execute the
 * emitted text against a minimal DOM. They prove the artifact is concrete DOM
 * instructions rather than a serialized program for a generic interpreter.
 *
 * Conditions carry a branch-local refresh closure, so tracked text and
 * dynamic attributes inside the active branch are refreshed by update; nested
 * conditions are an explicit negative. Still out of scope: component refs,
 * lists, event/ref/key attributes, ownership, claim, SSR and source maps. No
 * production build path consumes this generator yet.
 */

import { describe, expect, test } from 'vitest';
import {
  buildSemanticIr,
  validateSemanticIr,
} from '../../src/internal/compiler/semantic-ir/index.ts';
import type {
  IrComponent,
  IrDynamicText,
  IrElement,
} from '../../src/internal/compiler/semantic-ir/types.ts';
import {
  generateLeafRecipe,
  type LeafRecipe,
} from '../../src/internal/compiler/semantic-ir/leaf-codegen/generate.ts';

const FILE = '/proj/src/leaf.tsx';

function component(source: string): IrComponent {
  const result = buildSemanticIr(source, FILE);
  if (result.component === null) {
    throw new Error(`expected a component: ${result.diagnostics.map((d) => d.code).join(', ')}`);
  }
  const errors = [
    ...result.diagnostics,
    ...validateSemanticIr(result.component, { sourceLength: source.length }),
  ].filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`unexpected IR errors: ${errors.map((d) => d.code).join(', ')}`);
  }
  return result.component;
}

function recipe(source: string): LeafRecipe {
  const result = generateLeafRecipe(component(source));
  if (result.recipe === null) {
    throw new Error(`expected a recipe: ${result.diagnostics.map((d) => d.code).join(', ')}`);
  }
  return result.recipe;
}

/** The smallest DOM the generated instructions need — no third-party DOM shim. */
class FakeNode {
  readonly tagName: string | null;
  nodeValue: string;
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();

  constructor(tagName: string | null, nodeValue = '') {
    this.tagName = tagName;
    this.nodeValue = nodeValue;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  appendChild(child: FakeNode): FakeNode {
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeNode): void {
    const index = this.children.indexOf(child);
    if (index < 0) throw new Error('removeChild: node is not a child');
    this.children.splice(index, 1);
  }

  insertBefore(node: FakeNode, reference: FakeNode): void {
    const index = this.children.indexOf(reference);
    if (index < 0) throw new Error('insertBefore: reference is not a child');
    this.children.splice(index, 0, node);
  }
}

const fakeDocument = {
  createElement(tag: string): FakeNode {
    return new FakeNode(tag);
  },
  createTextNode(value: string): FakeNode {
    return new FakeNode(null, value);
  },
};

type HostValues = Record<string, unknown>;
interface Instance {
  update(nextValues: HostValues): void;
  dispose(): void;
}
type Mount = (host: FakeNode, values: HostValues) => Instance;

/** Evaluate the generated body — this is the "actually executes" proof. */
function evaluate(generated: LeafRecipe): Mount {
  const factory = new Function('document', `${generated.body}\nreturn mount;`) as (
    document: typeof fakeDocument,
  ) => Mount;
  return factory(fakeDocument);
}

const COUNTER = 'function Counter(props) { return <p class="note">Count: {props.count}</p>; }';

describe('G1 slice — generated artifact shape', () => {
  test('emits mount/update/dispose as concrete DOM instructions', () => {
    const generated = recipe(COUNTER);
    expect(generated.module).toContain('export function mount(host, values)');
    expect(generated.body).not.toContain('export function');
    expect(generated.module).toContain('function update(nextValues)');
    expect(generated.module).toContain('function dispose()');
    expect(generated.module).toContain('document.createElement("p")');
    expect(generated.module).toContain('setAttribute("class", "note")');
    expect(generated.module).toContain('createTextNode("Count: ")');
    expect(generated.module).toContain('renderDynamic()');
  });

  test('contains no generic-interpreter program or walker', () => {
    const generated = recipe(COUNTER);
    for (const forbidden of ['__partProgram', 'JSON.parse', 'switch', 'while (']) {
      expect(generated.module, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  test('reports the tracked and snapshot text nodes it generated', () => {
    expect(recipe(COUNTER).trackedTextIds).toHaveLength(1);
    expect(recipe(COUNTER).snapshotTextIds).toHaveLength(0);
    const snapshot = recipe(
      'function Snapshot(props) { const name = props.name; return <p>{name}</p>; }',
    );
    expect(snapshot.trackedTextIds).toHaveLength(0);
    expect(snapshot.snapshotTextIds).toHaveLength(1);
  });
});

describe('G1 slice — the generated code executes', () => {
  test('mount builds the tree, update refreshes only tracked text, dispose removes it', () => {
    const mount = evaluate(recipe(COUNTER));
    const host = new FakeNode(null);
    const instance = mount(host, { props: { count: 1 } });

    expect(host.children).toHaveLength(1);
    const paragraph = host.children[0]!;
    expect(paragraph.tagName).toBe('p');
    expect(paragraph.attributes.get('class')).toBe('note');
    expect(paragraph.children).toHaveLength(2);

    const staticText = paragraph.children[0]!;
    const dynamicText = paragraph.children[1]!;
    expect(staticText.nodeValue).toBe('Count: ');
    expect(dynamicText.nodeValue).toBe('1');

    instance.update({ props: { count: 2 } });
    expect(dynamicText.nodeValue).toBe('2');
    expect(paragraph.children[0]).toBe(staticText);
    expect(staticText.nodeValue).toBe('Count: ');
    expect(host.children).toHaveLength(1);

    instance.dispose();
    expect(host.children).toHaveLength(0);
    // A disposed instance is inert: no throw, no resurrection.
    expect(() => instance.update({ props: { count: 3 } })).not.toThrow();
    expect(host.children).toHaveLength(0);
    instance.dispose();
    expect(host.children).toHaveLength(0);
  });

  test('a snapshot dynamic text is evaluated exactly once at mount', () => {
    const generated = recipe(
      'function Snapshot(props) { const name = props.name; return <p>{name}</p>; }',
    );
    const mount = evaluate(generated);
    const host = new FakeNode(null);
    const instance = mount(host, { name: 'Ada' });
    const text = host.children[0]!.children[0]!;

    expect(text.nodeValue).toBe('Ada');
    instance.update({ name: 'Grace' });
    expect(text.nodeValue).toBe('Ada');
  });

  test('a fragment with multiple roots mounts and disposes every top-level node', () => {
    const generated = recipe('function Page() { return <><span>A</span><span>B</span></>; }');
    const mount = evaluate(generated);
    const host = new FakeNode(null);
    const instance = mount(host, {});

    expect(host.children.map((child) => child.tagName)).toEqual(['span', 'span']);
    expect(host.children[0]!.children[0]!.nodeValue).toBe('A');
    expect(host.children[1]!.children[0]!.nodeValue).toBe('B');

    instance.dispose();
    expect(host.children).toHaveLength(0);
  });
});

describe('G1 slice — dynamic property/attribute values', () => {
  const FIELDS = 'function Fields(props) { return <input value={props.name} data-x={10} />; }';

  test('tracked properties go into update, snapshots stay at mount', () => {
    const generated = recipe(FIELDS);
    expect(generated.module).toContain('e0["value"] = props.name;');
    expect(generated.module).toContain('e0["data-x"] = 10;');
    const afterMount = generated.module.slice(generated.module.indexOf('function renderDynamic'));
    expect(afterMount).toContain('e0["value"] = props.name;');
    expect(afterMount).not.toContain('e0["data-x"] = 10;');
  });

  test('update refreshes the tracked property without touching the snapshot', () => {
    const mount = evaluate(recipe(FIELDS));
    const host = new FakeNode(null);
    const instance = mount(host, { props: { name: 'Ada' } });
    const input = host.children[0] as unknown as Record<string, unknown>;

    expect(input['value']).toBe('Ada');
    expect(input['data-x']).toBe(10);
    instance.update({ props: { name: 'Grace' } });
    expect(input['value']).toBe('Grace');
    expect(input['data-x']).toBe(10);
  });
});

describe('G1 slice — conditional branches', () => {
  const MAYBE =
    'function Maybe(props) { return <div>{props.ok ? <span>on</span> : <em>off</em>}</div>; }';

  test('emits an anchor, a branch builder and a selector as concrete DOM code', () => {
    const generated = recipe(MAYBE);
    expect(generated.module).toContain('document.createTextNode("")');
    expect(generated.module).toContain('.insertBefore(');
    expect(generated.module).toContain('document.createElement("span")');
    expect(generated.module).toContain('document.createElement("em")');
    expect(generated.module).not.toContain('__partProgram');
  });

  test('switching the test swaps only the branch DOM, never rebuilding the host', () => {
    const mount = evaluate(recipe(MAYBE));
    const host = new FakeNode(null);
    const instance = mount(host, { props: { ok: true } });
    const div = host.children[0]!;
    const tags = () =>
      div.children.filter((child) => child.tagName !== null).map((child) => child.tagName);

    expect(tags()).toEqual(['span']);
    expect(div.children.find((c) => c.tagName === 'span')!.children[0]!.nodeValue).toBe('on');

    instance.update({ props: { ok: false } });
    expect(tags()).toEqual(['em']);
    expect(div.children.find((c) => c.tagName === 'em')!.children[0]!.nodeValue).toBe('off');
    expect(host.children[0]).toBe(div);

    instance.update({ props: { ok: true } });
    expect(tags()).toEqual(['span']);

    instance.dispose();
    expect(host.children).toHaveLength(0);
  });
});

describe('G1 slice — dynamic nodes inside a condition branch', () => {
  const MIXED =
    'function Maybe(props) { const label = props.label; return <div>{props.ok ? <span>{label} / {props.n}</span> : <em>{props.other}</em>}</div>; }';

  function branchElement(host: FakeNode): FakeNode {
    const div = host.children[0]!;
    return div.children.find((child) => child.tagName !== null)!;
  }

  test('the artifact emits a per-branch refresh closure and calls it after select', () => {
    const generated = recipe(MIXED);
    expect(generated.module).toContain('refresh = function () {');
    expect(generated.module).toContain('= built.refresh;');
    expect(generated.module).toContain('_refresh();');
    // Branch text ids are reported as part of the same recipe.
    expect(generated.trackedTextIds).toHaveLength(2);
    expect(generated.snapshotTextIds).toHaveLength(1);
  });

  test('tracked text in the active branch refreshes, snapshots stay at build time', () => {
    const mount = evaluate(recipe(MIXED));
    const host = new FakeNode(null);
    const instance = mount(host, {
      label: 'L',
      props: { ok: true, n: 1, other: 'x' },
    });
    const span = branchElement(host);

    expect(span.tagName).toBe('span');
    expect(span.children[0]!.nodeValue).toBe('L');
    expect(span.children[2]!.nodeValue).toBe('1');

    const snapshotNode = span.children[0]!;
    const trackedNode = span.children[2]!;
    instance.update({ label: 'L2', props: { ok: true, n: 2, other: 'y' } });
    expect(trackedNode.nodeValue).toBe('2');
    expect(snapshotNode.nodeValue).toBe('L');
    expect(branchElement(host)).toBe(span);
  });

  test('switching branches refreshes the newly active branch from current values', () => {
    const mount = evaluate(recipe(MIXED));
    const host = new FakeNode(null);
    const instance = mount(host, {
      label: 'L',
      props: { ok: true, n: 1, other: 'x' },
    });
    const div = host.children[0]!;

    instance.update({ label: 'L', props: { ok: false, n: 1, other: 'y' } });
    const em = branchElement(host);
    expect(em.tagName).toBe('em');
    expect(em.children[0]!.nodeValue).toBe('y');

    // Rebuilding the consequent evaluates its snapshot again, against the
    // current values, and refresh sees the newest tracked value.
    instance.update({ label: 'L2', props: { ok: true, n: 3, other: 'z' } });
    const span = branchElement(host);
    expect(span.tagName).toBe('span');
    expect(span.children[0]!.nodeValue).toBe('L2');
    expect(span.children[2]!.nodeValue).toBe('3');
    expect(host.children[0]).toBe(div);

    instance.dispose();
    expect(host.children).toHaveLength(0);
  });

  test('a dynamic property inside a branch refreshes and disappears on swap', () => {
    const mount = evaluate(
      recipe(
        'function Maybe(props) { return <div>{props.ok ? <input value={props.name} /> : <em>off</em>}</div>; }',
      ),
    );
    const host = new FakeNode(null);
    const instance = mount(host, { props: { ok: true, name: 'Ada' } });
    const input = branchElement(host) as unknown as Record<string, unknown>;

    expect(branchElement(host).tagName).toBe('input');
    expect(input['value']).toBe('Ada');
    instance.update({ props: { ok: true, name: 'Grace' } });
    expect(input['value']).toBe('Grace');

    instance.update({ props: { ok: false, name: 'Grace' } });
    expect(branchElement(host).tagName).toBe('em');
    expect(branchElement(host).children[0]!.nodeValue).toBe('off');

    instance.dispose();
    expect(host.children).toHaveLength(0);
  });
});

describe('G1 slice — unsupported shapes fail closed', () => {
  function codes(source: string): string[] {
    return generateLeafRecipe(component(source)).diagnostics.map((diagnostic) => diagnostic.code);
  }

  test('a component ref is refused, not silently dropped', () => {
    const result = generateLeafRecipe(component('function Page() { return <><Header /></>; }'));
    expect(result.recipe).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('OEIR_LEAF_UNSUPPORTED_NODE');
  });

  test('a nested condition inside a condition branch is refused', () => {
    const result = generateLeafRecipe(
      component(
        'function Maybe(props) { return <div>{props.ok ? <span>{props.ok ? <b>x</b> : <i>y</i>}</span> : <em>off</em>}</div>; }',
      ),
    );
    expect(result.recipe).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('OEIR_LEAF_NESTED_CONDITION');
  });

  test('an event attribute is refused', () => {
    expect(
      codes('function Btn(props) { return <button onClick={props.onClick}>x</button>; }'),
    ).toContain('OEIR_LEAF_UNSUPPORTED_ATTRIBUTE');
  });

  test('a component with no roots is refused', () => {
    const base = component(COUNTER);
    const empty: IrComponent = { ...base, roots: [] };
    const result = generateLeafRecipe(empty);
    expect(result.recipe).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('OEIR_LEAF_EMPTY_OUTPUT');
  });

  test('statement-level syntax in an authored expression is refused', () => {
    const base = component(COUNTER);
    const paragraph = base.roots[0] as IrElement;
    const dynamic = paragraph.children[1] as IrDynamicText;
    const forged: IrComponent = {
      ...base,
      roots: [
        {
          ...paragraph,
          children: [
            ...paragraph.children.slice(0, 1),
            {
              ...dynamic,
              expression: { ...dynamic.expression, source: 'props.count; globalThis.pwned = 1' },
            },
          ],
        },
      ],
    };
    const result = generateLeafRecipe(forged);
    expect(result.recipe).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('OEIR_LEAF_UNSAFE_EXPRESSION');
  });
});
