/**
 * K-Final-2 — Resume failure atomicity.
 *
 * The staged hydration contract validates the complete owned structure before
 * any subscription, listener, or ref attaches, so a failed claim leaves zero
 * live resources behind. The resume reconciles the runtime's own value nodes,
 * and those mutations must obey the same discipline: a resume that fails later
 * in the scan must not leave the root in a partially reconciled state.
 *
 * Each case damages a required program node after the value Part, changes the
 * signal while the element is detached, and requires that the structural error
 * surfaces while the DOM keeps the disconnect-time render — then proves the
 * damage is recoverable by repairing the structure and resuming again.
 */
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import '../../src/internal/compiled/runtime/hydrate-install.ts';
import { CompiledElementKernel } from '../../src/internal/compiled/runtime/kernel.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { TestDocument, type TestElement, type TestText, toHtml } from './test-dom.ts';
import { testProgram } from './test-program.ts';

const ATOMIC_PROGRAM = testProgram({
  tag: 'oe-resume-atomic',
  template: [
    {
      k: 'el',
      tag: 'div',
      attrs: [],
      children: [
        { k: 'part', index: 0 },
        { k: 'el', tag: 'p', attrs: [], children: [{ k: 'text', value: 'tail' }] },
      ],
    },
  ],
  parts: [{ k: 'text', index: 0, signal: 'message' }],
});

const SHEET = {
  replaceSync(_text: string): void {},
  cssRules: [{ cssText: 'oe-resume-atomic { color: red; }' }],
};

function mount(document: TestDocument, message: { value: unknown }) {
  const element = document.createElement('oe-resume-atomic');
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, ATOMIC_PROGRAM, {
    signals: { message },
    handlers: {},
    rootMode: 'light',
    styles: SHEET,
  });
  return { element, kernel };
}

test('K-Final-2: a failed resume leaves no partially reconciled text node', () => {
  const document = new TestDocument();
  const message = signal('one');
  const { element, kernel } = mount(document, message);

  kernel.connect();
  const div = element.childNodes[0] as TestElement;
  expect(toHtml(div)).toEqual('<div><!--oe:p0-->one<p>tail</p></div>');
  expect(document.head.childNodes.length, 'the light scope creates no style node').toBe(0);
  expect(document.adoptedStyleSheets, 'the light root adopts its sheet on the document').toEqual([
    SHEET,
  ]);
  const valueNode = div.childNodes[1] as TestText;
  const tail = div.childNodes[2];

  kernel.disconnect();
  message.value = 'two';
  div.removeChild(tail); // structural damage after the Part
  // The scope the failed attempt runs under: connect() disposes it and installs
  // a fresh one, so its disposal is observable only through this reference.
  const attemptScope = kernel.lifecycle;

  assertThrowsIncludes(
    () => kernel.connect(),
    Error,
    'missing child',
    'the damaged structure must surface its own error, not a text failure',
  );

  // The failed resume must leave the disconnect-time render: no reconciled
  // value, no detached node, no half-written plan.
  expect(valueNode.data, 'a failed resume must not commit its text plan').toBe('one');
  expect(toHtml(div)).toEqual('<div><!--oe:p0-->one</div>');
  expect(kernel.active, 'the failed resume leaves the kernel inactive').toBe(false);
  expect(attemptScope.disposed, 'the failed resume disposes its scope').toBe(true);
  expect(document.head.childNodes.length, 'no runtime style node exists to remove').toBe(0);
  expect(
    document.adoptedStyleSheets,
    'the document keeps the adopted sheet — shared, document-lifetime state',
  ).toEqual([SHEET]);

  // No subscription may survive the failure: a later write reaches nothing.
  message.value = 'three';
  expect(toHtml(div), 'no subscription survives a failed resume').toEqual(
    '<div><!--oe:p0-->one</div>',
  );

  // The failure is recoverable: repairing the structure resumes cleanly, and
  // the current value lands then.
  div.appendChild(tail);
  expect(() => kernel.connect()).not.toThrow();
  expect(toHtml(div)).toEqual('<div><!--oe:p0-->three<p>tail</p></div>');
  kernel.dispose();
});

test('K-Final-2: a failed resume commits neither an inserted value node', () => {
  const document = new TestDocument();
  const message = signal('');
  const { element, kernel } = mount(document, message);

  kernel.connect();
  const div = element.childNodes[0] as TestElement;
  expect(toHtml(div)).toEqual('<div><!--oe:p0--><p>tail</p></div>');

  kernel.disconnect();
  message.value = 'arrived';
  const tail = div.childNodes[1] as TestElement;
  const damaged = document.createElement('span');
  div.insertBefore(damaged, tail);
  div.removeChild(tail);

  assertThrowsIncludes(() => kernel.connect(), Error, 'expected <p>', 'the foreign node is drift');
  expect(toHtml(div), 'no value node may be inserted by a failed resume').toEqual(
    '<div><!--oe:p0--><span></span></div>',
  );
  expect(kernel.active).toBe(false);
  kernel.dispose();
});

test('K-Final-2: a failed resume commits neither a removal of the value node', () => {
  const document = new TestDocument();
  const message = signal('one');
  const { element, kernel } = mount(document, message);

  kernel.connect();
  const div = element.childNodes[0] as TestElement;
  const valueNode = div.childNodes[1] as TestText;

  kernel.disconnect();
  message.value = '';
  const tail = div.childNodes[2] as TestElement;
  const damaged = document.createElement('span');
  div.insertBefore(damaged, tail);
  div.removeChild(tail);

  assertThrowsIncludes(() => kernel.connect(), Error, 'expected <p>', 'the foreign node is drift');
  expect(valueNode.parentNode, 'the value node may not be detached by a failed resume').toBe(div);
  expect(toHtml(div), 'the disconnect-time render stands').toEqual(
    '<div><!--oe:p0-->one<span></span></div>',
  );
  expect(kernel.active).toBe(false);
  kernel.dispose();
});
