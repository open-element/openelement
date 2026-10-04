import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { CompiledErrorBoundary } from '../../src/error-boundary.ts';
import { ElementFormController } from '../../src/open-element-form.ts';
// The claim executor is installed by the package entry, not by the kernel
// (#1416): the kernel resolves it through the claim seam. This file reaches
// the kernel directly, so it installs it exactly as the default
// '@openelement/element' entry does — the claim cases below are about the
// kernel's claim path, which presupposes an installing entry.
import '../../src/internal/compiled/runtime/claim-install.ts';
import { CompiledElementKernel } from '../../src/internal/compiled/runtime/kernel.ts';
import { createFreshDom } from '../../src/internal/compiled/runtime.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { TestDocument, type TestElement, type TestShadowRoot, toHtml } from './test-dom.ts';
import { testProgram } from './test-program.ts';

const KERNEL_PROGRAM = testProgram({
  tag: 'oe-kernel-test',
  template: [
    {
      k: 'el',
      tag: 'div',
      attrs: [['data-static', 'yes']],
      children: [{ k: 'part', index: 0 }],
    },
  ],
  parts: [{ k: 'text', index: 0, signal: 'message' }],
});

const KERNEL_EACH_PROGRAM = testProgram({
  tag: 'oe-kernel-each-test',
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

function elementChild(root: { childNodes: ArrayLike<unknown> }): TestElement {
  return root.childNodes[0] as TestElement;
}

test('compiled kernel owns root, claim reconnect, and lifecycle disposal', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-kernel-test');
  const message = signal('first');
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, KERNEL_PROGRAM, {
    signals: { message },
    handlers: {},
    rootMode: 'open',
  });

  kernel.connect();
  expect(kernel.active).toBeTruthy();
  expect(kernel.lifecycle.active).toBeTruthy();
  const root = kernel.root;
  expect(root !== undefined).toBeTruthy();
  const first = elementChild(root);
  const connectedSignal = kernel.lifecycle.signal;
  expect(toHtml(first)).toEqual('<div data-static="yes"><!--oe:p0-->first</div>');
  message.value = 'second';
  expect(toHtml(first)).toEqual('<div data-static="yes"><!--oe:p0-->second</div>');

  kernel.disconnect();
  expect(kernel.active).toBeFalsy();
  expect(connectedSignal.aborted).toBeTruthy();
  expect(!kernel.lifecycle.signal.aborted).toBeTruthy();
  message.value = 'after-disconnect';
  expect(toHtml(first)).toEqual('<div data-static="yes"><!--oe:p0-->second</div>');
  message.value = 'second';

  kernel.connect();
  expect(kernel.root).toBe(root);
  expect(elementChild(root)).toBe(first);
  expect(kernel.active).toBeTruthy();
  message.value = 'reconnected';
  expect(toHtml(first)).toEqual('<div data-static="yes"><!--oe:p0-->reconnected</div>');
  kernel.dispose();
  expect(kernel.active).toBeFalsy();
  assertThrowsIncludes(() => kernel.connect(), Error, 'kernel is disposed');
});

test('compiled kernel connect returns the activation mode truth', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-kernel-test');
  const message = signal('truth');
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, KERNEL_PROGRAM, {
    signals: { message },
    handlers: {},
    rootMode: 'open',
  });

  // connect() owns the claim-vs-fresh truth (#1213).
  const fresh = kernel.connect() as unknown as { mode: string; root: unknown };
  expect(fresh.mode).toEqual('fresh');
  expect(fresh.root).toBe(kernel.root);

  // A redundant connect while active reports the same activation.
  const again = kernel.connect() as unknown as { mode: string; root: unknown };
  expect(again.mode).toEqual('fresh');
  expect(again.root).toBe(fresh.root);

  kernel.disconnect();

  // Reconnect into the retained content is a claim.
  const reclaimed = kernel.connect() as unknown as { mode: string; root: unknown };
  expect(reclaimed.mode).toEqual('claim');
  expect(reclaimed.root).toBe(fresh.root);
  kernel.dispose();
});

test('compiled kernel claims a supplied existing closed root and reports claim mode', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-kernel-test');
  const message = signal('supplied');
  const closedRoot = element.attachShadow({ mode: 'closed' });
  // Pre-existing content, as a declarative closed root would carry it.
  createFreshDom(
    KERNEL_PROGRAM,
    { signals: { message }, handlers: {} },
    closedRoot as unknown as Node,
  ).dispose();
  const claimedDiv = closedRoot.childNodes[0];

  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, KERNEL_PROGRAM, {
    signals: { message },
    handlers: {},
    rootMode: 'closed',
    root: closedRoot as unknown as ShadowRoot,
  });
  const activation = kernel.connect() as unknown as { mode: string; root: unknown };
  expect(activation.mode).toEqual('claim');
  expect(activation.root).toBe(closedRoot);
  expect(closedRoot.childNodes[0], 'claim preserves node identity').toBe(claimedDiv);
  kernel.dispose();
});

test('compiled kernel keeps light-DOM styles outside the claimed template', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-kernel-test');
  const message = signal('light');
  const sheet = {
    replaceSync(_text: string): void {},
    cssRules: [{ cssText: 'oe-light-test { color: red; }' }],
  };
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, KERNEL_PROGRAM, {
    signals: { message },
    handlers: {},
    rootMode: 'light',
    styles: sheet,
  });

  kernel.connect();
  expect(document.head.childNodes.length).toEqual(1);
  expect((document.head.childNodes[0] as unknown as { textContent: string }).textContent).toEqual(
    '@scope (oe-kernel-test) {\noe-light-test { color: red; }\n}',
  );
  expect(element.childNodes.length).toEqual(1);
  kernel.disconnect();
  expect(document.head.childNodes.length).toEqual(0);
});

test('compiled kernel applies styles into open and closed shadow roots', () => {
  for (const mode of ['open', 'closed'] as const) {
    const document = new TestDocument();
    const element = document.createElement('oe-kernel-test');
    const message = signal(mode);
    const preExisting = {
      replaceSync(_text: string): void {},
      cssRules: [{ cssText: 'oe-pre-existing { color: blue; }' }],
    };
    const sheet = {
      replaceSync(_text: string): void {},
      cssRules: [{ cssText: `oe-${mode}-test { color: red; }` }],
    };
    const attached = element.attachShadow({ mode });
    (attached as { adoptedStyleSheets: unknown[] }).adoptedStyleSheets = [preExisting];
    const kernel = new CompiledElementKernel(element as unknown as HTMLElement, KERNEL_PROGRAM, {
      signals: { message },
      handlers: {},
      rootMode: mode,
      root: mode === 'closed' ? (attached as unknown as ShadowRoot) : undefined,
      styles: sheet,
    });

    kernel.connect();
    const root = kernel.root as unknown as TestShadowRoot;
    expect(root).toBe(attached);
    expect(
      root.adoptedStyleSheets,
      `${mode} root adopts scope sheets after pre-existing ones`,
    ).toEqual([preExisting, sheet]);
    expect(document.head.childNodes.length, `${mode} root leaves light DOM untouched`).toEqual(0);

    kernel.disconnect();
    expect(root.adoptedStyleSheets, `${mode} disconnect removes only scope-applied sheets`).toEqual(
      [preExisting],
    );

    kernel.connect();
    expect(root.adoptedStyleSheets, `${mode} reconnect re-applies`).toEqual([preExisting, sheet]);
    kernel.dispose();
    expect(root.adoptedStyleSheets, `${mode} dispose cleans up`).toEqual([preExisting]);
  }
});

test('compiled kernel claims fixed Parts after the serialized static style node', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-kernel-test');
  const root = element.attachShadow({ mode: 'open' });
  const message = signal('before');
  let clicks = 0;
  const program = testProgram({
    tag: 'oe-kernel-test',
    template: [
      {
        k: 'el',
        tag: 'div',
        attrs: [],
        children: [
          { k: 'el', tag: 'button', attrs: [], children: [{ k: 'text', value: '+' }] },
          { k: 'part', index: 0 },
        ],
      },
    ],
    parts: [
      { k: 'text', index: 0, signal: 'message' },
      {
        k: 'event',
        index: 1,
        event: 'click',
        handler: 'increment',
        action: { kind: 'method', name: 'increment' },
        path: [0, 0],
      },
    ],
  });
  createFreshDom(
    program,
    {
      signals: { message },
      handlers: { increment: () => clicks++ },
    },
    root as unknown as Node,
  ).dispose();
  const style = document.createElement('style');
  style.setAttribute('data-oe-static-styles', '');
  root.insertBefore(style, root.childNodes[0]);
  const sheet = {
    replaceSync(_text: string): void {},
    cssRules: [{ cssText: ':host { display: block; }' }],
  };
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, program, {
    signals: { message },
    handlers: { increment: () => clicks++ },
    rootMode: 'open',
    styles: sheet,
  });

  kernel.connect();
  const button = (root.childNodes[1] as TestElement).childNodes[0] as TestElement;
  button.dispatch('click');
  expect(clicks).toEqual(1);
  message.value = 'after';
  expect(toHtml(root.childNodes[1])).toEqual('<div><button>+</button><!--oe:p0-->after</div>');
  kernel.dispose();
});

test('compiled kernel retains a closed root without aliasing light DOM', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-kernel-test');
  const message = signal('closed');
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, KERNEL_PROGRAM, {
    signals: { message },
    handlers: {},
    rootMode: 'closed',
  });

  kernel.connect();
  const root = kernel.root;
  expect(root !== undefined && 'host' in root).toBeTruthy();
  expect(root.host).toBe(element);
  expect(element.shadowRoot).toBe(null);
  expect(root.childNodes.length).toEqual(1);
  kernel.disconnect();
  kernel.connect();
  expect(kernel.root).toBe(root);
  kernel.dispose();
});

test('kernel reconnect cycles never duplicate event listeners', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-kernel-test');
  const message = signal('x');
  const calls: string[] = [];
  const program = testProgram({
    tag: 'oe-kernel-test',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [
      { k: 'text', index: 0, signal: 'message' },
      {
        k: 'event',
        index: 1,
        event: 'click',
        handler: 'handleClick',
        action: { kind: 'method', name: 'handleClick' },
        path: [0],
      },
    ],
  });
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, program, {
    signals: { message },
    handlers: { handleClick: () => calls.push('clicked') },
    rootMode: 'light',
  });
  const div = () => element.childNodes[0] as TestElement;
  const listenerCount = () => div().listeners.get('click')?.size ?? 0;

  kernel.connect();
  expect(listenerCount()).toEqual(1);
  div().dispatch('click');
  expect(calls).toEqual(['clicked']);

  kernel.disconnect();
  expect(listenerCount(), 'disconnect removes the listener').toEqual(0);

  kernel.connect();
  expect(listenerCount(), 'reconnect into the claimed DOM adds exactly one listener').toEqual(1);
  div().dispatch('click');
  expect(calls, 'one dispatch fires the handler exactly once').toEqual(['clicked', 'clicked']);

  kernel.disconnect();
  kernel.connect();
  expect(listenerCount()).toEqual(1);
  kernel.dispose();
  expect(listenerCount(), 'dispose leaves no listener behind').toEqual(0);
});

test('compiled form and error controllers remain element-local', () => {
  const formCalls: unknown[][] = [];
  const internals = {
    setFormValue(value: unknown, state?: unknown): void {
      formCalls.push(['value', value, state]);
    },
    setValidity(flags: unknown, message?: string, anchor?: HTMLElement): void {
      formCalls.push(['validity', flags, message, anchor]);
    },
  } as unknown as ElementInternals;
  const form = new ElementFormController();
  const formHost = { attachInternals: () => internals };
  expect(form.attach(formHost, { formAssociated: true })).toBe(internals);
  expect(form.attach(formHost, { formAssociated: true })).toBe(internals);
  form.setFormValue('value', 'state');
  form.setValidity({ customError: true }, 'bad');
  let resets = 0;
  let restored = '';
  form.onReset(() => resets++);
  form.onRestore((state, mode) => (restored = `${state}:${mode}`));
  form.formResetCallback();
  form.formStateRestoreCallback('saved', 'restore');
  expect(formCalls[0]).toEqual(['value', 'value', 'state']);
  expect(formCalls[1][0]).toEqual('validity');
  expect(resets).toEqual(1);
  expect(restored).toEqual('saved:restore');

  let reported = '';
  let recovered = 0;
  const boundary = new CompiledErrorBoundary({
    maxRetries: 1,
    onError: (error) => (reported = error.message),
  });
  boundary.capture(new Error('compiled boom'));
  expect(boundary.hasError).toBeTruthy();
  expect(reported).toEqual('compiled boom');
  expect(boundary.retry(() => recovered++)).toBeTruthy();
  expect(recovered).toEqual(1);
  expect(boundary.hasError).toBeFalsy();
  boundary.capture(new Error('again'));
  expect(boundary.hasError).toBeTruthy();
  expect(boundary.retry()).toBeFalsy();
  boundary.reset();
  expect(boundary.hasError).toBeFalsy();
  form.dispose();
  boundary.dispose();
});

test('kernel boundary captures a failing signal update (#1375)', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-kernel-each-test');
  const items = signal<unknown>([{ id: 'a', text: 'alpha' }]);
  const reported: string[] = [];
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, KERNEL_EACH_PROGRAM, {
    signals: { items },
    handlers: {},
    rootMode: 'open',
    errorBoundary: { onError: (error) => reported.push(error.message) },
  });
  kernel.connect();
  const root = kernel.root;
  expect(root !== undefined).toBeTruthy();
  const list = elementChild(root);
  const alpha = list.childNodes[1] as TestElement;
  expect(toHtml(list)).toEqual('<ul><!--oe:p0--><li>alpha</li><!--oe:/p0--></ul>');

  // A non-array write throws inside the update phase. The kernel boundary
  // captures it — the write site never sees the throw — and the each Region's
  // pre-validation leaves the previous DOM untouched. #1413: the message names
  // the authored property and the compiled module, never the part index.
  items.value = 'not-an-array';
  expect(kernel.errors.hasError).toBeTruthy();
  expect(kernel.errors.error?.message ?? '').toContain('expects an array');
  expect(kernel.errors.error?.message ?? '').toContain('this.items');
  expect(kernel.errors.source).toBe(element);
  expect(reported.length).toEqual(1);
  expect(reported[0]).toContain('this.items');
  expect(reported[0]).toContain(KERNEL_EACH_PROGRAM.metadata.sourceFile);
  expect(toHtml(list)).toEqual('<ul><!--oe:p0--><li>alpha</li><!--oe:/p0--></ul>');
  expect(list.childNodes[1]).toBe(alpha);

  // Same capture for a duplicate-key write: rejected before any mutation; the
  // message names the authored key field and the colliding key value.
  items.value = [
    { id: 'a', text: 'one' },
    { id: 'a', text: 'two' },
  ];
  expect(reported.length).toEqual(2);
  expect(kernel.errors.error?.message ?? '').toContain('duplicate key');
  expect(kernel.errors.error?.message ?? '').toContain('"id"');
  expect(kernel.errors.error?.message ?? '').toContain('this.items');
  expect(list.childNodes[1]).toBe(alpha);

  // The subscription stays live: the next valid write applies normally.
  items.value = [{ id: 'b', text: 'beta' }];
  expect(toHtml(list)).toEqual('<ul><!--oe:p0--><li>beta</li><!--oe:/p0--></ul>');

  kernel.dispose();
  expect(kernel.errors.hasError).toBeFalsy();
});
