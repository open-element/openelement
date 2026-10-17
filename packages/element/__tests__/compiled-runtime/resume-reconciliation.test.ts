/**
 * P0-A — Disconnected signal reconciliation.
 *
 * A signal written while the element is disconnected reaches no subscription:
 * the runtime's own DOM keeps the value it had at disconnect time. The next
 * connect of the same instance is a RESUME, and the documented resume contract
 * (hydrate.ts, CompiledHydrationOptions.resume) binds the runtime's own DOM
 * without re-running the SSR-artifact checks — so the resumed instance must
 * show the CURRENT signal state again, not the stale one:
 *
 *   - value Parts are reconciled in place (node identity preserved);
 *   - a bounded Block range whose content no longer is a render of the current
 *     value is rebuilt from that value (the range holds no anchors, so its
 *     content is a pure function of the signal);
 *   - the resumed subscriptions stay live for the writes that follow.
 *
 * Every case would fail on the pre-fix runtime: text Parts threw `part text
 * drift` on the reconnect, and a same-shape `when` flip silently bound the
 * stale branch.
 */
import { expect, test } from 'vitest';
// The hydration executor is installed by the package entry, not by the kernel
// (#1416); this file reaches the kernel directly, so it installs it exactly as
// the default '@openelement/element' entry does.
import '../../src/internal/compiled/runtime/hydrate-install.ts';
import { CompiledElementKernel } from '../../src/internal/compiled/runtime/kernel.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { TestDocument, type TestElement, type TestText, toHtml } from './test-dom.ts';
import { testProgram } from './test-program.ts';

const TEXT_PROGRAM = testProgram({
  tag: 'oe-resume-text',
  template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [{ k: 'text', index: 0, signal: 'message' }],
});

/** `{value} items` — a text Part immediately followed by a static text node. */
const SUFFIX_PROGRAM = testProgram({
  tag: 'oe-resume-suffix',
  template: [
    {
      k: 'el',
      tag: 'div',
      attrs: [],
      children: [
        { k: 'part', index: 0 },
        { k: 'text', value: ' items' },
      ],
    },
  ],
  parts: [{ k: 'text', index: 0, signal: 'count' }],
});

/** Same-shape branches: the stale branch is only distinguishable by its text. */
const WHEN_PROGRAM = testProgram({
  tag: 'oe-resume-when',
  template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [
    {
      k: 'when',
      index: 0,
      signal: 'open',
      test: { signal: 'open', op: 'truthy', value: true },
      on: [{ k: 'el', tag: 'span', attrs: [], children: [{ k: 'text', value: 'on' }] }],
      off: [{ k: 'el', tag: 'span', attrs: [], children: [{ k: 'text', value: 'off' }] }],
    },
  ],
});

const EACH_PROGRAM = testProgram({
  tag: 'oe-resume-each',
  template: [{ k: 'el', tag: 'ul', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [
    {
      k: 'each',
      index: 0,
      signal: 'items',
      key: 'id',
      field: 'text',
      item: [{ k: 'el', tag: 'li', attrs: [], children: [{ k: 'ival', field: 'text' }] }],
    },
  ],
});

const ATTR_PROGRAM = testProgram({
  tag: 'oe-resume-attr',
  template: [{ k: 'el', tag: 'div', attrs: [['data-mode', '']], children: [] }],
  parts: [{ k: 'attr', index: 0, signal: 'mode', name: 'data-mode', path: [0] }],
});

function host(document: TestDocument, tag: string): TestElement {
  return document.createElement(tag);
}

test('resume reconciles a text Part whose signal changed while disconnected', () => {
  const document = new TestDocument();
  const element = host(document, 'oe-resume-text');
  const message = signal('first');
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, TEXT_PROGRAM, {
    signals: { message },
    handlers: {},
    rootMode: 'light',
  });

  kernel.connect();
  const div = element.childNodes[0] as TestElement;
  const valueNode = div.childNodes[1];
  expect(toHtml(div)).toEqual('<div><!--oe:p0-->first</div>');

  kernel.disconnect();
  message.value = 'second';
  // No subscription is live: the disconnect-time render stands until the
  // resume reconciles it.
  expect(toHtml(div)).toEqual('<div><!--oe:p0-->first</div>');

  expect(
    () => kernel.connect(),
    'a value written while disconnected is not structure drift: the resume must reconcile',
  ).not.toThrow();
  expect(toHtml(div)).toEqual('<div><!--oe:p0-->second</div>');
  expect(div.childNodes[1], 'reconciliation updates the owned node in place').toBe(valueNode);
  expect(kernel.active).toBe(true);

  message.value = 'third';
  expect(toHtml(div), 'the resumed subscription stays live').toEqual(
    '<div><!--oe:p0-->third</div>',
  );
  kernel.dispose();
});

test('resume reconciles a text Part across the empty-value transitions', () => {
  const document = new TestDocument();
  const element = host(document, 'oe-resume-suffix');
  const count = signal<unknown>(3);
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, SUFFIX_PROGRAM, {
    signals: { count },
    handlers: {},
    rootMode: 'light',
  });

  kernel.connect();
  const div = element.childNodes[0] as TestElement;
  expect(toHtml(div)).toEqual('<div><!--oe:p0-->3 items</div>');
  const suffix = div.childNodes[2];
  const valueNode = div.childNodes[1];

  // Value change: in place, and the trailing static text node is untouched.
  kernel.disconnect();
  count.value = 7;
  expect(() => kernel.connect()).not.toThrow();
  expect(toHtml(div)).toEqual('<div><!--oe:p0-->7 items</div>');
  expect(div.childNodes[1]).toBe(valueNode);
  expect(div.childNodes[2], 'the static suffix is not the Part value node').toBe(suffix);

  // Non-empty -> empty: only the value node retires.
  kernel.disconnect();
  count.value = '';
  expect(() => kernel.connect()).not.toThrow();
  expect(toHtml(div)).toEqual('<div><!--oe:p0--> items</div>');
  expect(div.childNodes[1], 'the static suffix survives the empty transition').toBe(suffix);

  // Empty -> non-empty: the value node is re-created before the static suffix.
  kernel.disconnect();
  count.value = 9;
  expect(() => kernel.connect()).not.toThrow();
  expect(toHtml(div)).toEqual('<div><!--oe:p0-->9 items</div>');
  expect(div.childNodes[2]).toBe(suffix);
  kernel.dispose();
});

/**
 * K-Final-1: the ownership rule for the Part's own value node must survive the
 * collision where the stale dynamic value is exactly the static suffix text.
 * The fresh render holds two distinct text nodes with identical data; a resume
 * that mistakes the first for the suffix leaves the stale node behind (an
 * element-level `unexpected trailing nodes` failure, or a duplicated suffix at
 * a root whose trailing count is waived).
 */
test('K-Final-1: a value equal to the static suffix keeps its own node across the resume', () => {
  const document = new TestDocument();
  const element = host(document, 'oe-resume-suffix');
  const count = signal<unknown>(' items');
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, SUFFIX_PROGRAM, {
    signals: { count },
    handlers: {},
    rootMode: 'light',
  });

  kernel.connect();
  const div = element.childNodes[0] as TestElement;
  expect(div.childNodes.length, 'dynamic value + static suffix are two nodes').toBe(3);
  const anchor = div.childNodes[0];
  const valueNode = div.childNodes[1] as TestText;
  const suffix = div.childNodes[2] as TestText;
  expect(valueNode.data).toBe(' items');
  expect(suffix.data).toBe(' items');
  expect(valueNode === suffix, 'the two nodes are distinct').toBe(false);

  kernel.disconnect();
  count.value = 7;
  expect(
    () => kernel.connect(),
    'the colliding stale value must not be read as the suffix',
  ).not.toThrow();
  expect(toHtml(div)).toEqual('<div><!--oe:p0-->7 items</div>');
  expect(div.childNodes.length).toBe(3);
  expect(div.childNodes[0], 'the anchor is untouched').toBe(anchor);
  expect(div.childNodes[1], 'the Part reconciles its own node in place').toBe(valueNode);
  expect(div.childNodes[2], 'the static suffix keeps its identity').toBe(suffix);
  expect(valueNode.data).toBe('7');

  count.value = 'x';
  expect(toHtml(div), 'the resumed subscription stays live').toEqual(
    '<div><!--oe:p0-->x items</div>',
  );
  kernel.dispose();
});

test('K-Final-1: an unchanged colliding value resumes without duplicating the suffix', () => {
  const document = new TestDocument();
  const element = host(document, 'oe-resume-suffix');
  const count = signal<unknown>(' items');
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, SUFFIX_PROGRAM, {
    signals: { count },
    handlers: {},
    rootMode: 'light',
  });

  kernel.connect();
  const div = element.childNodes[0] as TestElement;
  const valueNode = div.childNodes[1];
  const suffix = div.childNodes[2];

  kernel.disconnect();
  expect(() => kernel.connect(), 'no value changed: the resume must be a no-op').not.toThrow();
  expect(toHtml(div)).toEqual('<div><!--oe:p0--> items items</div>');
  expect(div.childNodes.length).toBe(3);
  expect(div.childNodes[1], 'the value node is not re-created').toBe(valueNode);
  expect(div.childNodes[2], 'the suffix node is not re-created').toBe(suffix);
  kernel.dispose();
});

test('K-Final-1: the empty transitions stay correct across a colliding value', () => {
  const document = new TestDocument();
  const element = host(document, 'oe-resume-suffix');
  const count = signal<unknown>(' items');
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, SUFFIX_PROGRAM, {
    signals: { count },
    handlers: {},
    rootMode: 'light',
  });

  kernel.connect();
  const div = element.childNodes[0] as TestElement;
  const suffix = div.childNodes[2];

  // Colliding value -> empty: only the Part's own node retires.
  kernel.disconnect();
  count.value = '';
  expect(() => kernel.connect()).not.toThrow();
  expect(toHtml(div)).toEqual('<div><!--oe:p0--> items</div>');
  expect(div.childNodes.length).toBe(2);
  expect(div.childNodes[1], 'the suffix survives the empty transition').toBe(suffix);

  // Empty -> colliding value: the value node is re-created before the suffix.
  kernel.disconnect();
  count.value = ' items';
  expect(() => kernel.connect()).not.toThrow();
  expect(toHtml(div)).toEqual('<div><!--oe:p0--> items items</div>');
  expect(div.childNodes.length).toBe(3);
  expect(div.childNodes[2], 'the suffix keeps its identity').toBe(suffix);
  expect(div.childNodes[1] === suffix).toBe(false);
  kernel.dispose();
});

test('resume rebuilds a when branch whose condition flipped while disconnected', () => {
  const document = new TestDocument();
  const element = host(document, 'oe-resume-when');
  const open = signal(false);
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, WHEN_PROGRAM, {
    signals: { open },
    handlers: {},
    rootMode: 'light',
  });

  kernel.connect();
  const div = element.childNodes[0] as TestElement;
  expect(toHtml(div)).toEqual('<div><!--oe:p0--><span>off</span><!--oe:/p0--></div>');

  // Driven before the transition: the live update path rebuilds the range.
  open.value = true;
  expect(toHtml(div)).toEqual('<div><!--oe:p0--><span>on</span><!--oe:/p0--></div>');

  kernel.disconnect();
  open.value = false;
  expect(() => kernel.connect()).not.toThrow();
  expect(
    toHtml(div),
    'the stale branch must be rebuilt from the current value, not silently bound',
  ).toEqual('<div><!--oe:p0--><span>off</span><!--oe:/p0--></div>');

  const anchor = div.childNodes[0];
  const end = div.childNodes[2];
  open.value = true;
  expect(toHtml(div), 'the rebuilt branch subscription stays live').toEqual(
    '<div><!--oe:p0--><span>on</span><!--oe:/p0--></div>',
  );
  expect(div.childNodes[0], 'the anchors are preserved through the rebuild').toBe(anchor);
  expect(div.childNodes[2]).toBe(end);
  kernel.dispose();
});

test('resume rebuilds an each list whose items changed while disconnected', () => {
  const document = new TestDocument();
  const element = host(document, 'oe-resume-each');
  const items = signal([
    { id: 'a', text: 'alpha' },
    { id: 'b', text: 'beta' },
  ]);
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, EACH_PROGRAM, {
    signals: { items },
    handlers: {},
    rootMode: 'light',
  });

  kernel.connect();
  const list = element.childNodes[0] as TestElement;
  expect(toHtml(list)).toEqual('<ul><!--oe:p0--><li>alpha</li><li>beta</li><!--oe:/p0--></ul>');

  // Driven before the transition: a live list update.
  items.value = [
    { id: 'a', text: 'alpha' },
    { id: 'b', text: 'beta' },
    { id: 'm', text: 'mid' },
  ];
  expect(toHtml(list)).toEqual(
    '<ul><!--oe:p0--><li>alpha</li><li>beta</li><li>mid</li><!--oe:/p0--></ul>',
  );

  kernel.disconnect();
  items.value = [
    { id: 'a', text: 'ALPHA' },
    { id: 'c', text: 'gamma' },
  ];
  expect(() => kernel.connect()).not.toThrow();
  expect(toHtml(list)).toEqual('<ul><!--oe:p0--><li>ALPHA</li><li>gamma</li><!--oe:/p0--></ul>');

  items.value = [{ id: 'z', text: 'zeta' }];
  expect(toHtml(list), 'the rebuilt list subscription stays live').toEqual(
    '<ul><!--oe:p0--><li>zeta</li><!--oe:/p0--></ul>',
  );
  kernel.dispose();
});

test('resume reconciles a value Part whose signal changed while disconnected', () => {
  const document = new TestDocument();
  const element = host(document, 'oe-resume-attr');
  const mode = signal('one');
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, ATTR_PROGRAM, {
    signals: { mode },
    handlers: {},
    rootMode: 'light',
  });

  kernel.connect();
  const div = element.childNodes[0] as TestElement;
  expect(div.getAttribute('data-mode')).toEqual('one');

  kernel.disconnect();
  mode.value = 'two';
  expect(() => kernel.connect()).not.toThrow();
  expect(
    div.getAttribute('data-mode'),
    'a value Part owned by a signal must show the current value after the resume',
  ).toEqual('two');

  mode.value = 'three';
  expect(div.getAttribute('data-mode')).toEqual('three');
  kernel.dispose();
});
