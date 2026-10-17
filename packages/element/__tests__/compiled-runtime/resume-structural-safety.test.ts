/**
 * P1-C — Resume root trailing structural safety.
 *
 * A resumed root may legitimately carry extra nodes: the runtime's own Block
 * ranges and app-appended children live beside the program's nodes, so the
 * resume does not require the root's child count to match the program (the
 * initial claim does). That waiver must stay scoped and must not weaken the
 * identity requirements the resume still enforces:
 *
 *   - the program's owned nodes must resolve at their exact positions, from the
 *     root's first child onward;
 *   - a truncated or re-ordered root fails closed — never silently rebuilt,
 *     never bound against shifted nodes;
 *   - the waiver is root-level only: an element inside the program keeps its
 *     exact children, and the initial claim keeps its strict trailing check.
 *
 * The cases pin the boundary on both sides: the tolerant one (root trailing)
 * and the strict ones around it.
 */
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
// The hydration executor is installed by the package entry, not by the kernel
// (#1416); this file reaches the kernel directly, so it installs it exactly as
// the default '@openelement/element' entry does.
import '../../src/internal/compiled/runtime/hydrate-install.ts';
import { CompiledElementKernel } from '../../src/internal/compiled/runtime/kernel.ts';
import { createFreshDom } from '../../src/internal/compiled/runtime.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { TestDocument, type TestElement, toHtml } from './test-dom.ts';
import { testProgram } from './test-program.ts';

/** Two root-level nodes; the Part lives in the first one. */
const ROOT_PROGRAM = testProgram({
  tag: 'oe-resume-root',
  template: [
    { k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] },
    { k: 'el', tag: 'p', attrs: [], children: [{ k: 'text', value: 'tail' }] },
  ],
  parts: [{ k: 'text', index: 0, signal: 'message' }],
});

/** One root element whose children are fully program-owned. */
const ELEMENT_PROGRAM = testProgram({
  tag: 'oe-resume-element',
  template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
  parts: [{ k: 'text', index: 0, signal: 'message' }],
});

const WHEN_PROGRAM = testProgram({
  tag: 'oe-resume-when-boundary',
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

/** Serialize a light root's children (the host tag itself is not the program). */
function childrenHtml(root: TestElement): string {
  return root.childNodes.map((node) => toHtml(node)).join('');
}

function mount(
  document: TestDocument,
  tag: string,
  program: ReturnType<typeof testProgram>,
  signals: Record<string, { value: unknown }>,
): { element: TestElement; kernel: CompiledElementKernel } {
  const element = document.createElement(tag);
  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, program, {
    signals,
    handlers: {},
    rootMode: 'light',
  });
  return { element, kernel };
}

test('a resumed root keeps a legitimately appended child', () => {
  const document = new TestDocument();
  const message = signal('one');
  const { element, kernel } = mount(document, 'oe-resume-root', ROOT_PROGRAM, { message });

  kernel.connect();
  expect(childrenHtml(element)).toEqual('<div><!--oe:p0-->one</div><p>tail</p>');

  kernel.disconnect();
  const footer = document.createElement('footer');
  element.appendChild(footer);
  expect(
    () => kernel.connect(),
    'app children beside the program nodes are legitimate',
  ).not.toThrow();
  expect(element.childNodes[2], 'the appended child survives the resume').toBe(footer);
  expect(childrenHtml(element)).toEqual('<div><!--oe:p0-->one</div><p>tail</p><footer></footer>');

  message.value = 'two';
  expect(childrenHtml(element), 'the resumed root still drives its program nodes').toEqual(
    '<div><!--oe:p0-->two</div><p>tail</p><footer></footer>',
  );
  kernel.dispose();
});

test('a resumed root with its owned tail node removed fails closed', () => {
  const document = new TestDocument();
  const message = signal('one');
  const { element, kernel } = mount(document, 'oe-resume-root', ROOT_PROGRAM, { message });

  kernel.connect();
  const div = element.childNodes[0];
  kernel.disconnect();
  element.removeChild(element.childNodes[1]);
  const before = childrenHtml(element);

  assertThrowsIncludes(
    () => kernel.connect(),
    Error,
    'missing child',
    'the resume must not rebuild a truncated root',
  );
  expect(kernel.active, 'a failed resume leaves no active kernel').toBe(false);
  expect(element.childNodes[0], 'the surviving node keeps its identity').toBe(div);
  expect(childrenHtml(element), 'a failed resume does not rebuild the root').toEqual(before);
  kernel.dispose();
});

test('a resumed root with a node inserted between owned nodes fails closed', () => {
  const document = new TestDocument();
  const message = signal('one');
  const { element, kernel } = mount(document, 'oe-resume-root', ROOT_PROGRAM, { message });

  kernel.connect();
  kernel.disconnect();
  const inserted = document.createElement('span');
  element.insertBefore(inserted, element.childNodes[1]);
  const before = childrenHtml(element);

  assertThrowsIncludes(
    () => kernel.connect(),
    Error,
    'expected <p>',
    'owned nodes must resolve at their exact positions',
  );
  expect(inserted.getAttributeNames(), 'the foreign node is never adopted').toEqual([]);
  expect(childrenHtml(element), 'a failed resume leaves the root untouched').toEqual(before);
  kernel.dispose();
});

test('the trailing waiver does not reach an element inside the program', () => {
  const document = new TestDocument();
  const message = signal('one');
  const { element, kernel } = mount(document, 'oe-resume-element', ELEMENT_PROGRAM, {
    message,
  });

  kernel.connect();
  const div = element.childNodes[0] as TestElement;
  kernel.disconnect();
  div.appendChild(document.createElement('span'));

  assertThrowsIncludes(
    () => kernel.connect(),
    Error,
    'unexpected trailing nodes',
    'the root-level waiver must not loosen element-level structure',
  );
  expect(childrenHtml(element), 'a failed resume leaves the element untouched').toEqual(
    '<div><!--oe:p0-->one<span></span></div>',
  );
  kernel.dispose();
});

test('the first claim keeps the strict trailing check the resume waives', () => {
  const document = new TestDocument();
  const element = document.createElement('oe-resume-root');
  const message = signal('one');
  const host = { signals: { message }, handlers: {} };
  createFreshDom(ROOT_PROGRAM, host, element as unknown as Node).dispose();
  element.appendChild(document.createElement('footer'));

  const kernel = new CompiledElementKernel(element as unknown as HTMLElement, ROOT_PROGRAM, {
    ...host,
    rootMode: 'light',
  });
  assertThrowsIncludes(
    () => kernel.connect(),
    Error,
    'unexpected trailing nodes',
    'the resume-only waiver must not weaken the initial claim',
  );
  kernel.dispose();
});

test('a resume never repairs structural damage inside a block range', () => {
  const document = new TestDocument();
  const open = signal(false);
  const { element, kernel } = mount(document, 'oe-resume-when-boundary', WHEN_PROGRAM, { open });

  kernel.connect();
  const div = element.childNodes[0] as TestElement;
  expect(toHtml(div)).toEqual('<div><!--oe:p0--><span>off</span><!--oe:/p0--></div>');

  kernel.disconnect();
  // The block's end anchor is gone: the range cannot be identified, so no
  // bounded rebuild is possible and the resume must fail closed.
  div.removeChild(div.childNodes[2]);
  const before = toHtml(div);

  // The repair path is what must not run: the resume fails closed and leaves
  // the range untouched. The diagnostic names the expected end anchor exactly
  // (the reconnect verifies the retained ownership graph, so it can say which
  // node is missing instead of only that a child is).
  assertThrowsIncludes(
    () => kernel.connect(),
    Error,
    'expected <!--oe:/p0--> anchor',
    'an unidentifiable block range fails closed instead of being rebuilt',
  );
  expect(toHtml(div), 'a failed resume leaves the range untouched').toEqual(before);
  kernel.dispose();
});

/**
 * The alpha15 S lane serves a component's external sheet as a marked
 * `<link rel="stylesheet">` before the program's content (the serializer's
 * root shape). The resume must skip it exactly as it skipped the old inline
 * `<style>` fallback, because it is the delivery — not program drift. The
 * predicate is shared with the claim (`isStaticStyleNode`), so this pins the
 * single-owner rule rather than a revive-local copy: a style-only assumption
 * here failed every reconnect of a served link root closed with
 * `expected <div>, found <link>`.
 */
test('a resumed root skips the leading declarative stylesheet link it was served with', () => {
  const document = new TestDocument();
  const message = signal('one');
  const { element, kernel } = mount(document, 'oe-resume-element', ELEMENT_PROGRAM, { message });

  kernel.connect();
  const div = element.childNodes[0] as TestElement;
  const before = childrenHtml(element);
  kernel.disconnect();

  const link = document.createElement('link');
  link.setAttribute('rel', 'stylesheet');
  link.setAttribute('href', '/client/assets/abc123.css');
  link.setAttribute('data-oe-static-styles', '');
  element.insertBefore(link, element.childNodes[0] ?? null);

  expect(() => kernel.connect(), 'the served delivery link is not program drift').not.toThrow();
  expect(element.childNodes[0], 'the link stays as the delivery').toBe(link);
  expect(element.childNodes[1], 'the program node keeps its identity').toBe(div);
  expect(childrenHtml(element), 'the program resumes behind the leading link').toEqual(
    `<link rel="stylesheet" href="/client/assets/abc123.css" data-oe-static-styles="">${before}`,
  );

  message.value = 'two';
  expect(childrenHtml(element), 'the resumed root still drives its program nodes').toEqual(
    `<link rel="stylesheet" href="/client/assets/abc123.css" data-oe-static-styles=""><div><!--oe:p0-->two</div>`,
  );
  kernel.dispose();
});
