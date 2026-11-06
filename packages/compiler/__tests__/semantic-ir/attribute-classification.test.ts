/**
 * A3 — intrinsic attribute classification (shared classifier, P1-2).
 *
 * The production compiler (`semantic-core/lower-program.ts`) and the Semantic
 * IR builder (`semantic-ir/build.ts`) must answer "what is this dynamic
 * attribute?" identically; otherwise `class` / `data-*` / `aria-*` can be a DOM
 * property expando on one path and an HTML attribute on the other. These tests
 * pin the shared precedence and prove both consumers actually use it.
 */

import { describe, expect, test } from 'vitest';
import {
  BOOLEAN_ATTRIBUTES,
  DOM_PROPERTY_NAMES,
  classifyIntrinsicAttribute,
} from '../../src/internal/compiler/semantic-core/attribute-classification.ts';
import {
  buildSemanticIr,
  validateSemanticIr,
  type IrComponent,
  type IrDynamicAttribute,
  type IrElement,
  type IrNode,
} from '../../src/internal/compiler/semantic-ir/index.ts';

const FILE = '/proj/src/attribute-classification.tsx';

function build(source: string): { component: IrComponent; codes: string[] } {
  const result = buildSemanticIr(source, FILE);
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

/** Authored name → channel for every dynamic attribute on one element. */
function channelsOf(element: IrElement): Record<string, IrDynamicAttribute['channel']> {
  const channels: Record<string, IrDynamicAttribute['channel']> = {};
  for (const attribute of element.attributes) {
    if (attribute.kind === 'dynamic-attribute') channels[attribute.name] = attribute.channel;
  }
  return channels;
}

describe('classifyIntrinsicAttribute — production precedence', () => {
  test('key, ref and event handlers are binding channels', () => {
    expect(classifyIntrinsicAttribute('key', 'div')).toBe('key');
    expect(classifyIntrinsicAttribute('ref', 'div')).toBe('ref');
    expect(classifyIntrinsicAttribute('onClick', 'button')).toBe('event');
    expect(classifyIntrinsicAttribute('onInput', 'input')).toBe('event');
    // The event pattern is case-sensitive: lowercase `onclick` is not an event
    // channel (the production caller rejects it as an unsafe name first).
    expect(classifyIntrinsicAttribute('onclick', 'button')).toBe('attribute');
  });

  test('class, style and innerHTML are value-shape channels', () => {
    expect(classifyIntrinsicAttribute('class', 'div')).toBe('class');
    expect(classifyIntrinsicAttribute('style', 'div')).toBe('style');
    expect(classifyIntrinsicAttribute('innerHTML', 'div')).toBe('html');
    // Only the authored spelling is a value shape; `className` is normalized by
    // the production lowering before classification and is a plain attribute here.
    expect(classifyIntrinsicAttribute('className', 'div')).toBe('attribute');
  });

  test('boolean attributes match the lowercased authored name', () => {
    for (const name of ['readonly', 'disabled', 'checked', 'selected', 'required', 'hidden']) {
      expect(classifyIntrinsicAttribute(name, 'input'), name).toBe('boolean');
    }
    // The HTML parser folds attribute names, so the classification folds too.
    expect(classifyIntrinsicAttribute('READONLY', 'input')).toBe('boolean');
    expect(classifyIntrinsicAttribute('Disabled', 'button')).toBe('boolean');
  });

  test('DOM IDL properties are the property list plus value', () => {
    expect(classifyIntrinsicAttribute('value', 'input')).toBe('property');
    expect(classifyIntrinsicAttribute('value', 'div')).toBe('property');
    for (const name of ['files', 'indeterminate', 'scrollLeft', 'scrollTop']) {
      expect(classifyIntrinsicAttribute(name, 'input'), name).toBe('property');
    }
  });

  test('names in both lists resolve by production order: presence wins', () => {
    // `checked` / `selected` sit in BOOLEAN_ATTRIBUTES and DOM_PROPERTY_NAMES;
    // production checks boolean presence first, so the classifier must too.
    expect(classifyIntrinsicAttribute('checked', 'input')).toBe('boolean');
    expect(classifyIntrinsicAttribute('selected', 'option')).toBe('boolean');
    // `readOnly` is a DOM property spelling, but its lowercased form is the
    // boolean attribute, and the boolean branch runs first.
    expect(classifyIntrinsicAttribute('readOnly', 'input')).toBe('boolean');
  });

  test('data-*/aria-*/for/tabindex are plain HTML attributes, never properties', () => {
    for (const name of ['data-x', 'data-testid', 'aria-label', 'for', 'tabindex', 'title', 'id']) {
      expect(classifyIntrinsicAttribute(name, 'div'), name).toBe('attribute');
    }
    // tag participates only through the `<input value>` rule; it never turns a
    // common attribute into a property.
    expect(classifyIntrinsicAttribute('data-name', 'input')).toBe('attribute');
  });

  test('the <input value> rule sits in the same property branch as value', () => {
    // `name === 'value'` already covers the tag check; both paths must agree so
    // extracting the code cannot change `<input value>` behavior.
    expect(classifyIntrinsicAttribute('value', 'input')).toBe('property');
    expect(classifyIntrinsicAttribute('value', 'textarea')).toBe('property');
    // No other tag-specific rule exists.
    expect(classifyIntrinsicAttribute('disabled', 'input')).toBe('boolean');
    expect(classifyIntrinsicAttribute('disabled', 'button')).toBe('boolean');
  });
});

describe('the shared name lists agree with the classifier', () => {
  test('every boolean attribute name classifies as boolean', () => {
    for (const name of BOOLEAN_ATTRIBUTES) {
      expect(classifyIntrinsicAttribute(name, 'div'), name).toBe('boolean');
    }
  });

  test('every DOM property name classifies as property unless presence outranks it', () => {
    for (const name of DOM_PROPERTY_NAMES) {
      const expected = BOOLEAN_ATTRIBUTES.has(name.toLowerCase()) ? 'boolean' : 'property';
      expect(classifyIntrinsicAttribute(name, 'div'), name).toBe(expected);
    }
  });
});

describe('Semantic IR builder consumes the shared classification', () => {
  test('dynamic class/style/innerHTML are value shapes, not DOM properties', () => {
    const source = `function Panel(props) {
  return <div class={props.cls} style={props.styles} innerHTML={props.html} />;
}
`;
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    expect(channelsOf(firstElement(component.roots))).toEqual({
      class: 'class',
      style: 'style',
      innerHTML: 'html',
    });
  });

  test('common dynamic attributes become attributes, not JS property expandos', () => {
    const source = `function Label(props) {
  return (
    <label
      for={props.for}
      data-testid={props.testId}
      aria-label={props.label}
      tabIndex={props.tab}
      title={props.title}
    />
  );
}
`;
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    const label = firstElement(component.roots);
    expect(channelsOf(label)).toEqual({
      for: 'attribute',
      'data-testid': 'attribute',
      'aria-label': 'attribute',
      tabIndex: 'attribute',
      title: 'attribute',
    });
    for (const channel of Object.values(channelsOf(label))) {
      expect(channel).not.toBe('property');
    }
  });

  test('boolean presence attributes and DOM properties keep the production split', () => {
    const source = `function Fields(props) {
  return (
    <div>
      <input disabled={props.disabled} readonly={props.reading} checked={props.checked} value={props.value} />
      <div scrollTop={props.top} indeterminate={props.indeterminate} />
    </div>
  );
}
`;
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    const container = firstElement(component.roots);
    const input = container.children.find(
      (child): child is IrElement => child.kind === 'element' && child.tag === 'input',
    );
    const scroller = container.children.find(
      (child): child is IrElement =>
        child.kind === 'element' && child.tag === 'div' && child.attributes.length > 0,
    );
    expect(input).toBeDefined();
    expect(scroller).toBeDefined();
    expect(channelsOf(input!)).toEqual({
      disabled: 'boolean',
      readonly: 'boolean',
      checked: 'boolean',
      value: 'property',
    });
    expect(channelsOf(scroller!)).toEqual({
      scrollTop: 'property',
      indeterminate: 'property',
    });
  });

  test('event, key and ref bindings keep their channels and expression kinds', () => {
    const source = `function Actions(props) {
  return (
    <button key={props.itemKey} ref={props.buttonRef} onClick={props.onClick}>
      go
    </button>
  );
}
`;
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    const button = firstElement(component.roots);
    const onClick = dynamicAttribute(button, 'onClick');
    expect(onClick.channel).toBe('event');
    expect(onClick.expression.kind).toBe('handler');
    expect(onClick.tracked).toBe(false);
    const key = dynamicAttribute(button, 'key');
    expect(key.channel).toBe('key');
    expect(key.expression.kind).toBe('key');
    expect(key.tracked).toBe(false);
    expect(dynamicAttribute(button, 'ref').channel).toBe('ref');
  });

  test('a literal dynamic attribute is classified the same way and stays untracked', () => {
    const source = `function Literal() {
  return <input value={1} data-count={2} />;
}
`;
    const { component, codes } = build(source);
    expect(errorsOnly(codes)).toEqual([]);
    const input = firstElement(component.roots);
    expect(dynamicAttribute(input, 'value').channel).toBe('property');
    expect(dynamicAttribute(input, 'value').tracked).toBe(false);
    expect(dynamicAttribute(input, 'data-count').channel).toBe('attribute');
    expect(dynamicAttribute(input, 'data-count').tracked).toBe(false);
  });
});
