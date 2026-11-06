/**
 * Compiler-private leaf-codegen prototype — unit evidence (NOT G1).
 *
 * These tests execute the emitted text against a minimal lifecycle DOM stub.
 * The stub models structure and lifecycle only (appendChild/removeChild/
 * insertBefore plus a name→value attribute map); real DOM attribute semantics
 * are asserted in leaf-codegen.browser.test.ts against Playwright engines.
 *
 * What this file covers, beyond mount/update/dispose shape:
 *
 * - security sinks fail closed from the canonical protocol deny lists (static
 *   and dynamic names/tags/URLs), including forged IR that never passed the
 *   builder or validator;
 * - expression screening with the repository `typescript` parser (TS/JSX-only
 *   syntax, statement injection, assignments/updates/await/yield) and the
 *   legal multi-line / template / regex cases the old `;`/newline blacklist
 *   wrongly refused;
 * - generator hygiene: `__oe_`-prefixed internals, reserved/invalid binding
 *   rejection, host `requiredValues` validation, and display coercion;
 * - the attribute/boolean/property channel shapes the IR now distinguishes.
 *
 * This is a prototype artifact, not G1 evidence: M03 expression lowering, M04
 * ownership, signals/computed evaluation, claim/SSR and source maps are absent.
 */

import { describe, expect, test } from 'vitest';
import {
  buildSemanticIr,
  validateSemanticIr,
} from '../../src/internal/compiler/semantic-ir/index.ts';
import type {
  IrComponent,
  IrDynamicAttribute,
  IrDynamicText,
  IrElement,
  IrExpressionKind,
} from '../../src/internal/compiler/semantic-ir/types.ts';
import {
  generateLeafRecipe,
  type LeafCodegenResult,
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

function generate(source: string): LeafCodegenResult {
  return generateLeafRecipe(component(source));
}

/** Generate from a hand-forged IR object that never passed the builder. */
function generateIr(forged: IrComponent): LeafCodegenResult {
  return generateLeafRecipe(forged);
}

function codes(source: string): string[] {
  return generate(source).diagnostics.map((diagnostic) => diagnostic.code);
}

function recipe(source: string): LeafRecipe {
  const result = generate(source);
  if (result.recipe === null) {
    throw new Error(`expected a recipe: ${result.diagnostics.map((d) => d.code).join(', ')}`);
  }
  return result.recipe;
}

const COUNTER = 'function Counter(props) { return <p class="note">Count: {props.count}</p>; }';
const FIELDS = 'function Fields(props) { return <input value={props.name} data-x={10} />; }';

/**
 * The smallest lifecycle DOM the generated instructions need — no third-party
 * DOM shim. Attribute channel tests assert the `attributes` map directly; they
 * do NOT claim browser semantics (that is the browser test's job).
 */
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

  removeAttribute(name: string): void {
    this.attributes.delete(name);
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

/**
 * Evaluate the generated body. The `"use strict"` prelude matches the strict
 * module shape of `recipe.module`; the old sloppy `new Function` could hide
 * strict-only binding failures.
 */
function evaluate(generated: LeafRecipe): Mount {
  const factory = new Function('document', `"use strict";\n${generated.body}\nreturn mount;`) as (
    document: typeof fakeDocument,
  ) => Mount;
  return factory(fakeDocument);
}

/** Mutate the dynamic-text expression of the COUNTER base component. */
function forgeDynamicText(source: string, kind?: IrExpressionKind): IrComponent {
  const base = component(COUNTER);
  const paragraph = base.roots[0] as IrElement;
  const dynamic = paragraph.children[1] as IrDynamicText;
  return {
    ...base,
    roots: [
      {
        ...paragraph,
        children: [
          paragraph.children[0]!,
          {
            ...dynamic,
            expression: {
              ...dynamic.expression,
              source,
              ...(kind === undefined ? {} : { kind }),
            },
          },
        ],
      },
    ],
  };
}

describe('leaf recipe — artifact shape and hygiene', () => {
  test('emits mount/update/dispose as concrete DOM instructions with __oe_ internals', () => {
    const generated = recipe(COUNTER);
    expect(generated.module).toContain('export function mount(__oe_host, __oe_values)');
    expect(generated.body).not.toContain('export function');
    expect(generated.module).toContain('function __oe_update(__oe_values)');
    expect(generated.module).toContain('function __oe_dispose()');
    expect(generated.module).toContain('function __oe_renderDynamic()');
    expect(generated.module).toContain('__oe_getDocument().createElement("p")');
    expect(generated.module).toContain('setAttribute("class", "note")');
    expect(generated.module).toContain('createTextNode("Count: ")');
    expect(generated.module).toContain('__oe_renderDynamic()');
  });

  test('generator-private identifiers are namespaced; authored names cannot collide', () => {
    const generated = recipe(COUNTER);
    // Standalone (non-`__oe_`) uses of the old private names would mean the
    // generated scope could collide with an authored binding again.
    for (const name of ['current', 'values', 'host', 'disposed', 'renderDynamic']) {
      expect(generated.body, `generated body uses a bare '${name}' identifier`).not.toMatch(
        new RegExp(`\\b${name}\\b`),
      );
    }
    expect(generated.body).toMatch(/__oe_e\d+/);
    expect(generated.body).toMatch(/__oe_t\d+/);
    expect(generated.body).toContain('__oe_current');
    expect(generated.body).toContain('__oe_disposed');
  });

  test('contains no generic-interpreter program or walker', () => {
    const generated = recipe(COUNTER);
    for (const forbidden of ['__partProgram', 'JSON.parse', 'switch', 'while (']) {
      expect(generated.module, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  test('reports tracked/snapshot text ids and the host requiredValues contract', () => {
    const counted = recipe(COUNTER);
    expect(counted.trackedTextIds).toHaveLength(1);
    expect(counted.snapshotTextIds).toHaveLength(0);
    expect(counted.requiredValues).toEqual(['props']);

    const snapshot = recipe(
      'function Snapshot(props) { const name = props.name; return <p>{name}</p>; }',
    );
    expect(snapshot.trackedTextIds).toHaveLength(0);
    expect(snapshot.snapshotTextIds).toHaveLength(1);
    expect(snapshot.requiredValues).toEqual(['name']);

    expect(recipe('function Page() { return <span>A</span>; }').requiredValues).toEqual([]);
  });

  test('artifact self-check accepts every generated recipe', () => {
    for (const source of [COUNTER, FIELDS, 'function Page() { return <><i>A</i><b>B</b></>; }']) {
      expect(() => new Function(recipe(source).body)).not.toThrow();
    }
  });

  test('a legal artifact carries no sink tokens', () => {
    const sources = [
      COUNTER,
      FIELDS,
      'function Row(props) { return <div class="row" data-id={props.id} title={props.title} />; }',
      'function Maybe(props) { return <div>{props.ok ? <span>{props.n}</span> : <em>off</em>}</div>; }',
      'function Link() { return <a href="/docs">docs</a>; }',
    ];
    for (const source of sources) {
      const body = recipe(source).body;
      expect(body).not.toContain('innerHTML');
      expect(body).not.toContain('srcdoc');
      expect(body).not.toMatch(/\bon[a-z]+\s*=/i);
      expect(body).not.toContain('createElement("script")');
    }
  });
});

describe('leaf recipe — the generated code executes (lifecycle DOM stub)', () => {
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
    const mount = evaluate(
      recipe('function Snapshot(props) { const name = props.name; return <p>{name}</p>; }'),
    );
    const host = new FakeNode(null);
    const instance = mount(host, { name: 'Ada' });
    const text = host.children[0]!.children[0]!;

    expect(text.nodeValue).toBe('Ada');
    instance.update({ name: 'Grace' });
    expect(text.nodeValue).toBe('Ada');
  });

  test('dynamic text uses the production display coercion: null/undefined render empty', () => {
    const mount = evaluate(recipe('function Missing(props) { return <p>{props.missing}</p>; }'));
    const host = new FakeNode(null);
    const instance = mount(host, { props: {} });
    const text = host.children[0]!.children[0]!;

    expect(text.nodeValue).toBe('');
    instance.update({ props: { missing: null } });
    expect(text.nodeValue).toBe('');
    instance.update({ props: { missing: undefined } });
    expect(text.nodeValue).toBe('');
    instance.update({ props: { missing: 0 } });
    expect(text.nodeValue).toBe('0');
    instance.update({ props: { missing: false } });
    expect(text.nodeValue).toBe('false');
    instance.dispose();
  });

  test('a fragment with multiple roots mounts and disposes every top-level node', () => {
    const mount = evaluate(recipe('function Page() { return <><span>A</span><span>B</span></>; }'));
    const host = new FakeNode(null);
    const instance = mount(host, {});

    expect(host.children.map((child) => child.tagName)).toEqual(['span', 'span']);
    expect(host.children[0]!.children[0]!.nodeValue).toBe('A');
    expect(host.children[1]!.children[0]!.nodeValue).toBe('B');

    instance.dispose();
    expect(host.children).toHaveLength(0);
  });

  test('authored bindings that used to collide with generator internals now run', () => {
    const names = [
      'current',
      'values',
      'host',
      'document',
      'e0',
      't0',
      'renderDynamic',
      'nodes',
      'refresh',
      'wanted',
      'built',
      'disposed',
      'update',
      'dispose',
      'name',
      'required',
      't1',
    ];
    for (const name of names) {
      const generated = recipe(`function Leaf(${name}) { return <p>{${name}.n}</p>; }`);
      expect(generated.requiredValues).toEqual([name]);
      const mount = evaluate(generated);
      const host = new FakeNode(null);
      const instance = mount(host, { [name]: { n: 7 } });
      expect(host.children[0]!.children[0]!.nodeValue, `binding ${name}`).toBe('7');
      instance.update({ [name]: { n: 8 } });
      expect(host.children[0]!.children[0]!.nodeValue, `binding ${name} update`).toBe('8');
      instance.dispose();
    }
  });

  test('authored local declarations that used to collide with internals now run', () => {
    for (const name of ['current', 'values', 'host', 'document', 'nodes', 'refresh', 'wanted']) {
      const generated = recipe(
        `function Leaf(props) { const ${name} = props.n; return <p>{${name}}</p>; }`,
      );
      // resources are not evaluated here: the host supplies the local's value.
      expect(generated.requiredValues).toEqual([name]);
      const mount = evaluate(generated);
      const host = new FakeNode(null);
      const instance = mount(host, { [name]: 7 });
      expect(host.children[0]!.children[0]!.nodeValue, `local ${name}`).toBe('7');
      instance.dispose();
    }
  });

  test('mount and update enforce the host requiredValues contract', () => {
    const mount = evaluate(recipe(COUNTER));
    const host = new FakeNode(null);

    expect(() => mount(host, {})).toThrow(/OEIR_LEAF_MISSING_VALUE: props/);
    expect(() => mount(host, null as unknown as HostValues)).toThrow(/OEIR_LEAF_INVALID_VALUES/);
    expect(() => mount(host, 'nope' as unknown as HostValues)).toThrow(/OEIR_LEAF_INVALID_VALUES/);

    const instance = mount(host, { props: { count: 1 } });
    expect(() => instance.update({})).toThrow(/OEIR_LEAF_MISSING_VALUE: props/);
    expect(() => instance.update(null as unknown as HostValues)).toThrow(
      /OEIR_LEAF_INVALID_VALUES/,
    );
    // A refused update does not corrupt the mounted instance.
    expect(host.children[0]!.children[1]!.nodeValue).toBe('1');
    instance.update({ props: { count: 2 } });
    expect(host.children[0]!.children[1]!.nodeValue).toBe('2');
  });
});

describe('leaf recipe — attribute / boolean / property channels', () => {
  test('plain attributes go through setAttribute (no JS expando)', () => {
    const generated = recipe(FIELDS);
    expect(generated.module).toContain('__oe_setAttribute(__oe_e0, "data-x", (10))');
    expect(generated.module).toContain('__oe_e0["value"] = (props.name)');
    expect(generated.module).not.toContain('__oe_e0["data-x"]');

    const mount = evaluate(generated);
    const host = new FakeNode(null);
    const instance = mount(host, { props: { name: 'Ada' } });
    const input = host.children[0]!;
    expect(input.attributes.get('data-x')).toBe('10');
    expect(input.attributes.has('value')).toBe(false);
    expect((input as unknown as Record<string, unknown>)['value']).toBe('Ada');
    instance.update({ props: { name: 'Grace' } });
    expect((input as unknown as Record<string, unknown>)['value']).toBe('Grace');
    expect(input.attributes.get('data-x')).toBe('10');
  });

  test('a tracked plain attribute refreshes and null removes it', () => {
    const generated = recipe(
      'function Tag(props) { return <div title={props.title} aria-label={props.label} />; }',
    );
    const mount = evaluate(generated);
    const host = new FakeNode(null);
    const instance = mount(host, { props: { title: 'a', label: 'b' } });
    const div = host.children[0]!;
    expect(div.attributes.get('title')).toBe('a');
    expect(div.attributes.get('aria-label')).toBe('b');

    instance.update({ props: { title: 'c', label: null } });
    expect(div.attributes.get('title')).toBe('c');
    expect(div.attributes.has('aria-label')).toBe(false);

    instance.update({ props: { title: undefined, label: 'd' } });
    expect(div.attributes.has('title')).toBe(false);
    expect(div.attributes.get('aria-label')).toBe('d');
  });

  test('boolean channel uses presence semantics: set "" / remove', () => {
    const generated = recipe(
      'function Flags(props) { return <input readonly={props.readonly} disabled={props.disabled} />; }',
    );
    expect(generated.module).toContain('__oe_setBoolean(__oe_e0, "readonly"');
    expect(generated.module).toContain('__oe_setBoolean(__oe_e0, "disabled"');
    expect(generated.requiredValues).toEqual(['props']);

    const mount = evaluate(generated);
    const host = new FakeNode(null);
    const instance = mount(host, { props: { readonly: true, disabled: false } });
    const input = host.children[0]!;
    expect(input.attributes.get('readonly')).toBe('');
    expect(input.attributes.has('disabled')).toBe(false);

    instance.update({ props: { readonly: false, disabled: true } });
    expect(input.attributes.has('readonly')).toBe(false);
    expect(input.attributes.get('disabled')).toBe('');
  });

  test('property channel assigns the DOM property', () => {
    const generated = recipe('function Name(props) { return <input value={props.name} />; }');
    expect(generated.module).toContain('__oe_e0["value"] = (props.name)');
    const mount = evaluate(generated);
    const host = new FakeNode(null);
    const instance = mount(host, { props: { name: 'Ada' } });
    const input = host.children[0] as unknown as Record<string, unknown>;

    expect(input['value']).toBe('Ada');
    instance.update({ props: { name: 'Grace' } });
    expect(input['value']).toBe('Grace');
  });
});

describe('leaf recipe — conditions', () => {
  const MAYBE =
    'function Maybe(props) { return <div>{props.ok ? <span>on</span> : <em>off</em>}</div>; }';

  test('emits an anchor, a branch builder and a selector as concrete DOM code', () => {
    const generated = recipe(MAYBE);
    expect(generated.module).toContain('__oe_getDocument().createTextNode("")');
    expect(generated.module).toContain('.insertBefore(');
    expect(generated.module).toContain('__oe_getDocument().createElement("span")');
    expect(generated.module).toContain('__oe_getDocument().createElement("em")');
    expect(generated.module).toMatch(/__oe_c\d+_build/);
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

  test('a literal condition test is still allowed', () => {
    const generated = generate(
      'function Always() { return <div>{true ? <span>on</span> : <em>off</em>}</div>; }',
    );
    expect(generated.recipe).not.toBeNull();
    const mount = evaluate(generated.recipe!);
    const host = new FakeNode(null);
    const instance = mount(host, {});
    expect(host.children[0]!.children.map((c) => c.tagName).filter(Boolean)).toEqual(['span']);
    instance.dispose();
  });

  const MIXED =
    'function Maybe(props) { const label = props.label; return <div>{props.ok ? <span>{label} / {props.n}</span> : <em>{props.other}</em>}</div>; }';

  test('a per-branch refresh closure refreshes tracked values after update', () => {
    const generated = recipe(MIXED);
    // requiredValues covers mount, render, test and branch reads.
    expect(generated.requiredValues).toEqual(['label', 'props']);
    expect(generated.module).toMatch(/__oe_c\d+_refresh = function \(\) \{/);
    expect(generated.module).toContain('= __oe_built.refresh;');
    expect(generated.module).toMatch(/__oe_c\d+_refresh\(\);/);
    // Branch text ids are reported as part of the same recipe.
    expect(generated.trackedTextIds).toHaveLength(2);
    expect(generated.snapshotTextIds).toHaveLength(1);
  });

  test('switching branches refreshes the newly active branch from current values', () => {
    const mount = evaluate(recipe(MIXED));
    const host = new FakeNode(null);
    const instance = mount(host, {
      label: 'L',
      props: { ok: true, n: 1, other: 'x' },
    });
    const branchElement = (): FakeNode =>
      host.children[0]!.children.find((child) => child.tagName !== null)!;

    expect(branchElement().tagName).toBe('span');
    expect(branchElement().children[2]!.nodeValue).toBe('1');

    instance.update({ label: 'L', props: { ok: false, n: 1, other: 'y' } });
    expect(branchElement().tagName).toBe('em');
    expect(branchElement().children[0]!.nodeValue).toBe('y');

    // Rebuilding the consequent evaluates its snapshot again, against the
    // current values, and refresh sees the newest tracked value.
    instance.update({ label: 'L2', props: { ok: true, n: 3, other: 'z' } });
    expect(branchElement().tagName).toBe('span');
    expect(branchElement().children[0]!.nodeValue).toBe('L2');
    expect(branchElement().children[2]!.nodeValue).toBe('3');
    expect(host.children[0]!.tagName).toBe('div');

    instance.dispose();
    expect(host.children).toHaveLength(0);
  });

  test('a dynamic attribute inside a branch refreshes and disappears on swap', () => {
    const mount = evaluate(
      recipe(
        'function Maybe(props) { return <div>{props.ok ? <input data-name={props.name} /> : <em>off</em>}</div>; }',
      ),
    );
    const host = new FakeNode(null);
    const instance = mount(host, { props: { ok: true, name: 'Ada' } });
    const branchElement = (): FakeNode =>
      host.children[0]!.children.find((child) => child.tagName !== null)!;

    expect(branchElement().tagName).toBe('input');
    expect(branchElement().attributes.get('data-name')).toBe('Ada');
    instance.update({ props: { ok: true, name: 'Grace' } });
    expect(branchElement().attributes.get('data-name')).toBe('Grace');

    instance.update({ props: { ok: false, name: 'Grace' } });
    expect(branchElement().tagName).toBe('em');
    expect(branchElement().children[0]!.nodeValue).toBe('off');

    instance.dispose();
    expect(host.children).toHaveLength(0);
  });
});

describe('leaf recipe — expression screening', () => {
  test('multi-line, template and regex expressions are legal', () => {
    const multiline = generate('function Multi(props) { return <p>{props.a +\n  props.b}</p>; }');
    expect(multiline.recipe).not.toBeNull();
    const multilineMount = evaluate(multiline.recipe!);
    const multilineHost = new FakeNode(null);
    multilineMount(multilineHost, { props: { a: 1, b: 2 } });
    expect(multilineHost.children[0]!.children[0]!.nodeValue).toBe('3');

    const template = generate('function Tmpl() { return <p>{`a;b\nc`}</p>; }');
    expect(template.recipe).not.toBeNull();
    const templateMount = evaluate(template.recipe!);
    const templateHost = new FakeNode(null);
    templateMount(templateHost, {});
    expect(templateHost.children[0]!.children[0]!.nodeValue).toBe('a;b\nc');

    const regex = generate('function Re(props) { return <p>{/[;]/.test(props.x)}</p>; }');
    expect(regex.recipe).not.toBeNull();
    const regexMount = evaluate(regex.recipe!);
    const regexHost = new FakeNode(null);
    regexMount(regexHost, { props: { x: ';' } });
    expect(regexHost.children[0]!.children[0]!.nodeValue).toBe('true');

    const comma = generate('function Comma(props) { return <p>{(props.a, props.b)}</p>; }');
    expect(comma.recipe).not.toBeNull();
  });

  test('TypeScript-only syntax is a coded diagnostic', () => {
    const cases: readonly [string, string][] = [
      [
        'as-cast inside an expression',
        'function F(props) { return <p>{(props.name as string).toUpperCase()}</p>; }',
      ],
      [
        'generic call type arguments',
        'function F(props) { return <p>{format<string>(props.x)}</p>; }',
      ],
      [
        'parameter type annotation',
        'function F(props) { return <p>{((value: number) => value)(props.x)}</p>; }',
      ],
    ];
    for (const [label, source] of cases) {
      expect(codes(source), label).toContain('OEIR_LEAF_TS_SYNTAX');
    }
    // Non-null assertions and satisfies are stripped at the top level by the
    // builder, so the forged-IR path below is the defense-in-depth evidence.
    expect(generateIr(forgeDynamicText('props.x!')).diagnostics.map((d) => d.code)).toContain(
      'OEIR_LEAF_TS_SYNTAX',
    );
    expect(
      generateIr(forgeDynamicText('props.x satisfies number')).diagnostics.map((d) => d.code),
    ).toContain('OEIR_LEAF_TS_SYNTAX');
    expect(
      generateIr(forgeDynamicText('<string>props.x')).diagnostics.map((d) => d.code),
    ).toContain('OEIR_LEAF_TS_SYNTAX');
    expect(
      generateIr(forgeDynamicText('props.items.filter((item) => <b>{item}</b>)')).diagnostics.map(
        (d) => d.code,
      ),
    ).toContain('OEIR_LEAF_TS_SYNTAX');
  });

  test('statement injection and unparsable sources are refused', () => {
    const cases: readonly [string, string][] = [
      ['semicolon statement', 'props.count; globalThis.__pwned = 1'],
      ['parenthesis/statement injection', 'props.count), (globalThis.__pwned = 1), (0'],
      ['second declarator injection', '1), b = (globalThis.__pwned = 1), c = (0'],
    ];
    for (const [label, source] of cases) {
      expect(
        generateIr(forgeDynamicText(source)).diagnostics.map((d) => d.code),
        label,
      ).toContain('OEIR_LEAF_INVALID_EXPRESSION');
    }
  });

  test('assignment, update, await and yield are refused', () => {
    const cases: readonly [string, string][] = [
      ['assignment', 'props.x = 5'],
      ['compound assignment', 'props.x += 1'],
      ['increment', 'props.n++'],
      ['decrement', '--props.n'],
      ['await', 'await props.x'],
      ['yield', 'yield props.x'],
    ];
    for (const [label, source] of cases) {
      expect(
        generateIr(forgeDynamicText(source)).diagnostics.map((d) => d.code),
        label,
      ).toContain('OEIR_LEAF_UNSAFE_EXPRESSION');
    }
  });

  test('an empty expression is refused', () => {
    expect(generateIr(forgeDynamicText('')).diagnostics.map((d) => d.code)).toContain(
      'OEIR_LEAF_UNSAFE_EXPRESSION',
    );
  });

  test('the artifact self-check catches an expression that would break the embedded context', () => {
    // A trailing line comment parses inside the validator's parenthesized
    // wrapper but comments out the generated closing tokens: exactly the class
    // of generator/embedding bug the artifact self-check exists for.
    const result = generateIr(forgeDynamicText('props.count // trailing comment'));
    expect(result.recipe).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('OEIR_LEAF_INVALID_ARTIFACT');
  });
});

describe('leaf recipe — security sinks fail closed', () => {
  test('static canonical sink attribute names are refused', () => {
    const cases: readonly [string, string][] = [
      ['static innerHTML', 'function F() { return <div innerHTML="<b>x</b>" />; }'],
      ['static srcdoc', 'function F() { return <div srcdoc="<script>x</script>" />; }'],
      ['static on* handler', 'function F() { return <button onclick="window.x=1">x</button>; }'],
      ['static mixed-case on*', 'function F() { return <div onMouseOver="window.x=1" />; }'],
    ];
    for (const [label, source] of cases) {
      expect(codes(source), label).toContain('OEIR_LEAF_UNSAFE_ATTRIBUTE');
    }
  });

  test('canonical forbidden/raw-text tags are refused', () => {
    const cases: readonly [string, string][] = [
      ['script tag', 'function F() { return <script src="/x.js"></script>; }'],
      ['style tag', 'function F() { return <style>{"#host{color:red}"}</style>; }'],
      ['template tag', 'function F() { return <template><span>x</span></template>; }'],
      ['iframe tag', 'function F() { return <iframe src="/x"></iframe>; }'],
      ['object tag', 'function F() { return <object data="/x"></object>; }'],
      ['embed tag', 'function F() { return <embed src="/x" />; }'],
      ['base tag', 'function F() { return <base href="/" />; }'],
      ['meta tag', 'function F() { return <meta charset="utf-8" />; }'],
      ['link tag', 'function F() { return <link rel="x" href="/y" />; }'],
    ];
    for (const [label, source] of cases) {
      expect(codes(source), label).toContain('OEIR_LEAF_UNSAFE_TAG');
    }
  });

  test('static URL values are value-screened; safe static URLs are allowed', () => {
    const unsafe: readonly [string, string][] = [
      ['javascript scheme', 'function F() { return <a href="javascript:alert(1)">x</a>; }'],
      ['mixed-case javascript', 'function F() { return <a href="JaVaScRiPt:alert(1)">x</a>; }'],
      [
        'leading control characters',
        'function F() { return <a href="\u0009javascript:alert(1)">x</a>; }',
      ],
      [
        'entity-encoded newline',
        'function F() { return <a href="jav&#x0A;ascript:alert(1)">x</a>; }',
      ],
      ['entity-encoded colon', 'function F() { return <a href="javascript&#58;alert(1)">x</a>; }'],
      ['vbscript scheme', 'function F() { return <a href="vbscript:msgbox(1)">x</a>; }'],
      ['data scheme', 'function F() { return <img src="data:text/html,<b>x</b>" />; }'],
      ['xlink:href', 'function F() { return <a xlink:href="javascript:alert(1)">x</a>; }'],
    ];
    for (const [label, source] of unsafe) {
      expect(codes(source), label).toContain('OEIR_LEAF_UNSAFE_ATTRIBUTE');
    }

    const safe = generate('function F() { return <a href="https://example.com/docs">docs</a>; }');
    expect(safe.recipe).not.toBeNull();
    expect(safe.recipe!.body).toContain('setAttribute("href", "https://example.com/docs")');
    expect(generate('function F() { return <img src="/logo.png" />; }').recipe).not.toBeNull();
  });

  test('dynamic URL-carrying attributes are refused (no runtime URL guard in this slice)', () => {
    const cases: readonly [string, string][] = [
      ['href', 'function F(props) { return <a href={props.url}>x</a>; }'],
      ['src', 'function F(props) { return <img src={props.url} />; }'],
      ['action', 'function F(props) { return <form action={props.url}></form>; }'],
      ['formaction', 'function F(props) { return <button formaction={props.url}>x</button>; }'],
      ['xlink:href', 'function F(props) { return <a xlink:href={props.url}>x</a>; }'],
    ];
    for (const [label, source] of cases) {
      expect(codes(source), label).toContain('OEIR_LEAF_URL_SINK_UNSUPPORTED');
    }
  });

  test('event / ref / key channels and lowercase on* names are refused', () => {
    const cases: readonly [string, string][] = [
      [
        'onClick event channel',
        'function F(props) { return <button onClick={props.onClick}>x</button>; }',
      ],
      ['ref channel', 'function F(props) { return <div ref={props.ref} />; }'],
      ['key channel', 'function F(props) { return <div key={props.key} />; }'],
    ];
    for (const [label, source] of cases) {
      expect(codes(source), label).toContain('OEIR_LEAF_UNSUPPORTED_ATTRIBUTE');
    }
    // Lowercase `on*` names classify as plain attributes and are caught by the
    // case-insensitive canonical safe-attribute predicate.
    expect(codes('function F(props) { return <div onclick={props.handler} />; }')).toContain(
      'OEIR_LEAF_UNSAFE_ATTRIBUTE',
    );
  });

  test('dynamic class/style/innerHTML value shapes fail closed', () => {
    expect(codes('function F(props) { return <div class={props.cls} />; }')).toContain(
      'OEIR_LEAF_UNSUPPORTED_VALUE_SHAPE',
    );
    expect(codes('function F(props) { return <div style={props.style} />; }')).toContain(
      'OEIR_LEAF_UNSUPPORTED_VALUE_SHAPE',
    );
    // innerHTML is a canonical forbidden attribute name, checked before the
    // html value-shape branch.
    expect(codes('function F(props) { return <div innerHTML={props.html} />; }')).toContain(
      'OEIR_LEAF_UNSAFE_ATTRIBUTE',
    );
    // Static class/style stay a plain setAttribute.
    const staticShapes = generate('function F() { return <div class="a" style="color:red" />; }');
    expect(staticShapes.recipe).not.toBeNull();
    expect(staticShapes.recipe!.body).toContain('setAttribute("style", "color:red")');
  });

  test('forged IR property-channel prototype-pollution names are refused', () => {
    const base = component('function F(props) { return <div data-x={props.x} />; }');
    const root = base.roots[0] as IrElement;
    const attribute = root.attributes[0] as IrDynamicAttribute;
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      const forged: IrComponent = {
        ...base,
        roots: [
          {
            ...root,
            attributes: [{ ...attribute, name, channel: 'property' }],
          },
        ],
      };
      const result = generateLeafRecipe(forged);
      expect(result.recipe, name).toBeNull();
      expect(
        result.diagnostics.map((d) => d.code),
        name,
      ).toContain('OEIR_LEAF_UNSAFE_PROPERTY');
    }
  });

  test('duplicate attribute names are refused case-insensitively', () => {
    expect(codes('function F() { return <div data-x="1" DATA-X="2" />; }')).toContain(
      'OEIR_LEAF_DUPLICATE_ATTRIBUTE',
    );
    expect(codes('function F(props) { return <div href="/a" HREF={props.x} />; }')).toContain(
      'OEIR_LEAF_DUPLICATE_ATTRIBUTE',
    );
  });

  test('forged IR is refused even when it never passed the builder/validator', () => {
    const base = component('function F() { return <div data-x="1" />; }');
    const root = base.roots[0] as IrElement;
    const forgedTag: IrComponent = {
      ...base,
      roots: [{ ...root, tag: 'script' }],
    };
    expect(generateLeafRecipe(forgedTag).diagnostics.map((d) => d.code)).toContain(
      'OEIR_LEAF_UNSAFE_TAG',
    );

    const forgedInvalidTag: IrComponent = {
      ...base,
      roots: [{ ...root, tag: 'NOT A TAG' }],
    };
    expect(generateLeafRecipe(forgedInvalidTag).diagnostics.map((d) => d.code)).toContain(
      'OEIR_LEAF_INVALID_TAG',
    );

    const forgedName: IrComponent = {
      ...base,
      roots: [
        {
          ...root,
          attributes: [{ ...root.attributes[0]!, name: 'bad name' }],
        },
      ],
    };
    expect(generateLeafRecipe(forgedName).diagnostics.map((d) => d.code)).toContain(
      'OEIR_LEAF_INVALID_ATTRIBUTE',
    );
  });

  test('every refusal is a coded diagnostic with a span and recipe=null', () => {
    const sources = [
      'function F() { return <script src="/x.js"></script>; }',
      'function F() { return <div innerHTML="x" />; }',
      'function F() { return <a href="javascript:alert(1)">x</a>; }',
      'function F(props) { return <a href={props.url}>x</a>; }',
      'function F(props) { return <div class={props.cls} />; }',
      'function F(props) { return <div onclick={props.f} />; }',
      'function F(props) { return <div data-x="1" DATA-X="2" />; }',
      'function F(props) { const ok = props.ok; return <div>{ok ? <i>a</i> : <b>c</b>}</div>; }',
      'function F(props) { return <p>{(props.x as string).length}</p>; }',
      'function F(props) { return <p>{(props.x = 1)}</p>; }',
    ];
    for (const source of sources) {
      const result = generate(source);
      expect(result.recipe).toBeNull();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      for (const diagnostic of result.diagnostics) {
        expect(diagnostic.code).toMatch(/^OEIR_LEAF_[A-Z_]+$/);
        expect(diagnostic.severity).toBe('error');
        expect(diagnostic.span.file).toBe(FILE);
      }
    }
  });
});

describe('leaf recipe — unsupported shapes and bindings fail closed', () => {
  test('a component ref is refused, not silently dropped', () => {
    const result = generate('function Page() { return <><Header /></>; }');
    expect(result.recipe).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('OEIR_LEAF_UNSUPPORTED_NODE');
  });

  test('a nested condition inside a condition branch is refused', () => {
    const result = generate(
      'function Maybe(props) { return <div>{props.ok ? <span>{props.ok ? <b>x</b> : <i>y</i>}</span> : <em>off</em>}</div>; }',
    );
    expect(result.recipe).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('OEIR_LEAF_NESTED_CONDITION');
  });

  test('a component with no roots is refused', () => {
    const base = component(COUNTER);
    const empty: IrComponent = { ...base, roots: [] };
    const result = generateLeafRecipe(empty);
    expect(result.recipe).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('OEIR_LEAF_EMPTY_OUTPUT');
  });

  test('a local snapshot condition test is refused', () => {
    const result = generate(
      'function Maybe(props) { const ok = props.ok; return <div>{ok ? <span>on</span> : <em>off</em>}</div>; }',
    );
    expect(result.recipe).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain('OEIR_LEAF_SNAPSHOT_CONDITION');
  });

  test('reserved __oe_ and invalid binding names are refused', () => {
    expect(codes('function F(__oe_state) { return <p>{__oe_state}</p>; }')).toContain(
      'OEIR_LEAF_RESERVED_BINDING',
    );

    // Forged reads: a name that is not an identifier at all, a strict-mode
    // restricted identifier, and an ESM-reserved word — none of which the
    // builder can ever produce as a read.
    const base = component(COUNTER);
    const paragraph = base.roots[0] as IrElement;
    const dynamic = paragraph.children[1] as IrDynamicText;
    for (const [name, expected] of [
      ['not a name', 'OEIR_LEAF_INVALID_BINDING'],
      ['arguments', 'OEIR_LEAF_INVALID_BINDING'],
      ['await', 'OEIR_LEAF_INVALID_BINDING'],
    ] as const) {
      const forged: IrComponent = {
        ...base,
        roots: [
          {
            ...paragraph,
            children: [
              paragraph.children[0]!,
              {
                ...dynamic,
                expression: {
                  ...dynamic.expression,
                  reads: [{ name, binding: 'unknown' }],
                },
              },
            ],
          },
        ],
      };
      expect(
        generateLeafRecipe(forged).diagnostics.map((d) => d.code),
        name,
      ).toContain(expected);
    }
  });
});
