/**
 * Alpha16a M05 — the first G1 slice: generated leaf mount/update/dispose runs.
 *
 * Unlike examples.test.ts (IR expressiveness only), these tests execute the
 * emitted text against a minimal DOM. They prove the artifact is concrete DOM
 * instructions rather than a serialized program for a generic interpreter.
 *
 * Out of scope here, asserted as explicit negatives: component refs,
 * conditions, lists, dynamic attributes, ownership, claim, SSR and source maps.
 * No production build path consumes this generator yet.
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

describe('G1 slice — unsupported shapes fail closed', () => {
  function codes(source: string): string[] {
    return generateLeafRecipe(component(source)).diagnostics.map((diagnostic) => diagnostic.code);
  }

  test('a component ref is refused, not silently dropped', () => {
    const result = generateLeafRecipe(component('function Page() { return <><Header /></>; }'));
    expect(result.recipe).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('OEIR_LEAF_UNSUPPORTED_NODE');
  });

  test('a condition is refused', () => {
    const result = generateLeafRecipe(
      component(
        'function Maybe(props) { return <div>{props.ok ? <span>on</span> : <em>off</em>}</div>; }',
      ),
    );
    expect(result.recipe).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('OEIR_LEAF_UNSUPPORTED_NODE');
  });

  test('a dynamic attribute is refused', () => {
    expect(codes('function Fields(props) { return <input value={props.name} />; }')).toContain(
      'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
    );
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
