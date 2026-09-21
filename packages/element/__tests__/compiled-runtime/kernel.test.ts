import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from '@std/assert';
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
  template: [{
    k: 'el',
    tag: 'div',
    attrs: [['data-static', 'yes']],
    children: [{ k: 'part', index: 0 }],
  }],
  parts: [{ k: 'text', index: 0, signal: 'message' }],
});

const KERNEL_EACH_PROGRAM = testProgram({
  tag: 'oe-kernel-each-test',
  template: [{ k: 'el', tag: 'ul', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [{
    k: 'each',
    index: 0,
    signal: 'items',
    key: 'id',
    field: 'text',
    item: [{ k: 'el', tag: 'li', attrs: [], children: [{ k: 'ival', field: 'text' }] }],
  }],
});

function elementChild(root: { childNodes: ArrayLike<unknown> }): TestElement {
  return root.childNodes[0] as TestElement;
}

Deno.test('compiled kernel owns root, claim reconnect, and lifecycle disposal', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-kernel-test');
  const message = signal('first');
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, KERNEL_PROGRAM, {
    signals: { message },
    handlers: {},
    rootMode: 'open',
  });

  kernel.connect();
  assert(kernel.active);
  assert(kernel.lifecycle.active);
  const root = kernel.root;
  assert(root !== undefined);
  const first = elementChild(root);
  const connectedSignal = kernel.lifecycle.signal;
  assertEquals(toHtml(first), '<div data-static="yes"><!--oe:p0-->first</div>');
  message.value = 'second';
  assertEquals(toHtml(first), '<div data-static="yes"><!--oe:p0-->second</div>');

  kernel.disconnect();
  assertFalse(kernel.active);
  assert(connectedSignal.aborted);
  assert(!kernel.lifecycle.signal.aborted);
  message.value = 'after-disconnect';
  assertEquals(toHtml(first), '<div data-static="yes"><!--oe:p0-->second</div>');
  message.value = 'second';

  kernel.connect();
  assertStrictEquals(kernel.root, root);
  assertStrictEquals(elementChild(root), first);
  assert(kernel.active);
  message.value = 'reconnected';
  assertEquals(toHtml(first), '<div data-static="yes"><!--oe:p0-->reconnected</div>');
  kernel.dispose();
  assertFalse(kernel.active);
  assertThrows(() => kernel.connect(), Error, 'kernel is disposed');
});

Deno.test('compiled kernel connect returns the activation mode truth', () => {
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
  assertEquals(fresh.mode, 'fresh');
  assertStrictEquals(fresh.root, kernel.root);

  // A redundant connect while active reports the same activation.
  const again = kernel.connect() as unknown as { mode: string; root: unknown };
  assertEquals(again.mode, 'fresh');
  assertStrictEquals(again.root, fresh.root);

  kernel.disconnect();

  // Reconnect into the retained content is a claim.
  const reclaimed = kernel.connect() as unknown as { mode: string; root: unknown };
  assertEquals(reclaimed.mode, 'claim');
  assertStrictEquals(reclaimed.root, fresh.root);
  kernel.dispose();
});

Deno.test('compiled kernel claims a supplied existing closed root and reports claim mode', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-kernel-test');
  const message = signal('supplied');
  const closedRoot = element.attachShadow({ mode: 'closed' });
  // Pre-existing content, as a declarative closed root would carry it.
  createFreshDom(
    KERNEL_PROGRAM,
    { signals: { message }, handlers: {} },
    closedRoot as unknown as Node,
  )
    .dispose();
  const claimedDiv = closedRoot.childNodes[0];

  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, KERNEL_PROGRAM, {
    signals: { message },
    handlers: {},
    rootMode: 'closed',
    root: closedRoot as unknown as ShadowRoot,
  });
  const activation = kernel.connect() as unknown as { mode: string; root: unknown };
  assertEquals(activation.mode, 'claim');
  assertStrictEquals(activation.root, closedRoot);
  assertStrictEquals(closedRoot.childNodes[0], claimedDiv, 'claim preserves node identity');
  kernel.dispose();
});

Deno.test('compiled kernel keeps light-DOM styles outside the claimed template', () => {
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
  assertEquals(document.head.childNodes.length, 1);
  assertEquals(
    (document.head.childNodes[0] as unknown as { textContent: string }).textContent,
    '@scope (oe-kernel-test) {\noe-light-test { color: red; }\n}',
  );
  assertEquals(element.childNodes.length, 1);
  kernel.disconnect();
  assertEquals(document.head.childNodes.length, 0);
});

Deno.test('compiled kernel applies styles into open and closed shadow roots', () => {
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
      root: mode === 'closed' ? attached as unknown as ShadowRoot : undefined,
      styles: sheet,
    });

    kernel.connect();
    const root = kernel.root as unknown as TestShadowRoot;
    assertStrictEquals(root, attached);
    assertEquals(
      root.adoptedStyleSheets,
      [preExisting, sheet],
      `${mode} root adopts scope sheets after pre-existing ones`,
    );
    assertEquals(document.head.childNodes.length, 0, `${mode} root leaves light DOM untouched`);

    kernel.disconnect();
    assertEquals(
      root.adoptedStyleSheets,
      [preExisting],
      `${mode} disconnect removes only scope-applied sheets`,
    );

    kernel.connect();
    assertEquals(root.adoptedStyleSheets, [preExisting, sheet], `${mode} reconnect re-applies`);
    kernel.dispose();
    assertEquals(root.adoptedStyleSheets, [preExisting], `${mode} dispose cleans up`);
  }
});

Deno.test('compiled kernel claims fixed Parts after the serialized static style node', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-kernel-test');
  const root = element.attachShadow({ mode: 'open' });
  const message = signal('before');
  let clicks = 0;
  const program = testProgram({
    tag: 'oe-kernel-test',
    template: [{
      k: 'el',
      tag: 'div',
      attrs: [],
      children: [
        { k: 'el', tag: 'button', attrs: [], children: [{ k: 'text', value: '+' }] },
        { k: 'part', index: 0 },
      ],
    }],
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
  createFreshDom(program, {
    signals: { message },
    handlers: { increment: () => clicks++ },
  }, root as unknown as Node).dispose();
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
  assertEquals(clicks, 1);
  message.value = 'after';
  assertEquals(toHtml(root.childNodes[1]), '<div><button>+</button><!--oe:p0-->after</div>');
  kernel.dispose();
});

Deno.test('compiled kernel retains a closed root without aliasing light DOM', () => {
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
  assert(root !== undefined && 'host' in root);
  assertStrictEquals(root.host, element);
  assertStrictEquals(element.shadowRoot, null);
  assertEquals(root.childNodes.length, 1);
  kernel.disconnect();
  kernel.connect();
  assertStrictEquals(kernel.root, root);
  kernel.dispose();
});

Deno.test('kernel reconnect cycles never duplicate event listeners', () => {
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
  assertEquals(listenerCount(), 1);
  div().dispatch('click');
  assertEquals(calls, ['clicked']);

  kernel.disconnect();
  assertEquals(listenerCount(), 0, 'disconnect removes the listener');

  kernel.connect();
  assertEquals(listenerCount(), 1, 'reconnect into the claimed DOM adds exactly one listener');
  div().dispatch('click');
  assertEquals(calls, ['clicked', 'clicked'], 'one dispatch fires the handler exactly once');

  kernel.disconnect();
  kernel.connect();
  assertEquals(listenerCount(), 1);
  kernel.dispose();
  assertEquals(listenerCount(), 0, 'dispose leaves no listener behind');
});

Deno.test('compiled form and error controllers remain element-local', () => {
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
  assertStrictEquals(form.attach(formHost, { formAssociated: true }), internals);
  assertStrictEquals(form.attach(formHost, { formAssociated: true }), internals);
  form.setFormValue('value', 'state');
  form.setValidity({ customError: true }, 'bad');
  let resets = 0;
  let restored = '';
  form.onReset(() => resets++);
  form.onRestore((state, mode) => restored = `${state}:${mode}`);
  form.formResetCallback();
  form.formStateRestoreCallback('saved', 'restore');
  assertEquals(formCalls[0], ['value', 'value', 'state']);
  assertEquals(formCalls[1][0], 'validity');
  assertEquals(resets, 1);
  assertEquals(restored, 'saved:restore');

  let reported = '';
  let recovered = 0;
  const boundary = new CompiledErrorBoundary({
    maxRetries: 1,
    onError: (error) => reported = error.message,
  });
  boundary.capture(new Error('compiled boom'));
  assert(boundary.hasError);
  assertEquals(reported, 'compiled boom');
  assert(boundary.retry(() => recovered++));
  assertEquals(recovered, 1);
  assertFalse(boundary.hasError);
  boundary.capture(new Error('again'));
  assert(boundary.hasError);
  assertFalse(boundary.retry());
  boundary.reset();
  assertFalse(boundary.hasError);
  form.dispose();
  boundary.dispose();
});

Deno.test('kernel boundary captures a failing signal update (#1375)', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-kernel-each-test');
  const items = signal<unknown>([{ id: 'a', text: 'alpha' }]);
  const reported: string[] = [];
  const kernel = new CompiledElementKernel(
    element as unknown as HTMLElement,
    KERNEL_EACH_PROGRAM,
    {
      signals: { items },
      handlers: {},
      rootMode: 'open',
      errorBoundary: { onError: (error) => reported.push(error.message) },
    },
  );
  kernel.connect();
  const root = kernel.root;
  assert(root !== undefined);
  const list = elementChild(root);
  const alpha = list.childNodes[1] as TestElement;
  assertEquals(toHtml(list), '<ul><!--oe:p0--><li>alpha</li><!--oe:/p0--></ul>');

  // A non-array write throws inside the update phase. The kernel boundary
  // captures it — the write site never sees the throw — and the each Region's
  // pre-validation leaves the previous DOM untouched.
  items.value = 'not-an-array';
  assert(kernel.errors.hasError);
  assertStringIncludes(kernel.errors.error?.message ?? '', 'expects an array signal');
  assertStrictEquals(kernel.errors.source, element);
  assertEquals(reported, ['[compiled-runtime] each part 0 expects an array signal']);
  assertEquals(toHtml(list), '<ul><!--oe:p0--><li>alpha</li><!--oe:/p0--></ul>');
  assertStrictEquals(list.childNodes[1], alpha);

  // Same capture for a duplicate-key write: rejected before any mutation.
  items.value = [{ id: 'a', text: 'one' }, { id: 'a', text: 'two' }];
  assertEquals(reported.length, 2);
  assertStringIncludes(kernel.errors.error?.message ?? '', 'duplicate key');
  assertStrictEquals(list.childNodes[1], alpha);

  // The subscription stays live: the next valid write applies normally.
  items.value = [{ id: 'b', text: 'beta' }];
  assertEquals(toHtml(list), '<ul><!--oe:p0--><li>beta</li><!--oe:/p0--></ul>');

  kernel.dispose();
  assertFalse(kernel.errors.hasError);
});
