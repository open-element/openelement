/**
 * packages/element/__tests__/compiled-runtime/error-boundary-branch.test.ts —
 * the README's error-boundary authoring form behaves as documented (alpha.13
 * I2, KR-11).
 *
 * packages/element/README.md documents the boundary this way: it "captures
 * subtree render failures", "A subclass `render()` branches on `hasError` to
 * swap in the `onError()` fallback UI", and `retry()` re-renders the boundary
 * and the captured source. The compiler now admits the heritage
 * (error-boundary-base-admission.test.ts pins the compile; this suite pins the
 * RUNTIME the compiler's output rides):
 *
 *   - `hasError` is a base-class field the boundary machinery writes
 *     (catchError / retry / reset, plus the kernel's automatic captures);
 *   - a compiled subclass that declares `hasError` as its state property
 *     reads those writes through its signal-backed accessor, so a `when`
 *     Region over `this.hasError` swaps the fallback live;
 *   - the state survives a claim failure and clears on a successful retry.
 *
 * Harness: the real ErrorBoundary base class from the package, the compiled
 * kernel, and the program shape the compiler emits for the documented branch
 * (a `when` Region keyed on the hasError signal — asserted structurally by
 * the compiler suite).
 */

import { expect, test } from 'vitest';
import { installFacadeDom } from './facade-dom.ts';
import { testProgram } from './test-program.ts';
import { makeUniqueTag } from './light-counter-harness.ts';

const dom = installFacadeDom();

const { ErrorBoundary } = await import('@openelement/element');

// oxlint-disable-next-line no-explicit-any
type AnyElement = any;

const uniqueTag = makeUniqueTag('boundary-branch');

/**
 * The Part Program the compiler emits for the documented render branch:
 * `{this.hasError ? <p>failed</p> : <slot/>}` lowers to one `when` Region
 * over the hasError signal (compiler suite pins that lowering).
 */
function boundaryBranchProgram(tag: string) {
  return testProgram({
    tag,
    template: [
      {
        k: 'el',
        tag: 'div',
        attrs: [],
        children: [{ k: 'part', index: 0 }],
      },
    ],
    parts: [
      {
        k: 'when',
        index: 0,
        signal: 'hasError',
        test: { signal: 'hasError', op: 'truthy', value: true },
        on: [
          {
            k: 'el',
            tag: 'p',
            attrs: [['class', 'fallback']],
            children: [{ k: 'text', value: 'failed' }],
          },
        ],
        off: [{ k: 'el', tag: 'slot', attrs: [], children: [] }],
      },
    ],
    properties: [
      {
        name: 'hasError',
        attribute: null,
        type: 'boolean',
        converter: 'boolean',
        reflect: false,
        default: false,
      },
    ],
  });
}

/**
 * The compiled subclass the admission makes legal: the base class carries the
 * `hasError` field, the generated class declares it as a compiled property
 * (its statics assign the compiled accessor's backing metadata), and the
 * program carries the branch Region.
 */
function defineBoundary(tag: string) {
  const program = boundaryBranchProgram(tag);
  // The generated class declares `static styles`-free overrides only; the
  // property metadata is what installs the signal-backed accessor.
  const ctor = class extends ErrorBoundary {
    static __partProgram = program;
    static __compiledProperties = program.metadata.properties;
    static __elementMetadata = program.metadata;
    static observedAttributes = program.metadata.observedAttributes;
  } as unknown as CustomElementConstructor & Record<string, unknown>;
  dom.registry.define(tag, ctor);
  return { ctor, program };
}

/**
 * Collect the rendered text through the facade DOM's own node shapes (the
 * facade harness wraps its own DOM implementation, so the test-dom
 * serializers do not instance-match here): element tags and text data, in
 * tree order.
 */
function textOf(element: AnyElement): string {
  const root = element.shadowRoot ?? element;
  const walk = (node: AnyElement): string => {
    if (typeof node.data === 'string') return node.data;
    if (typeof node.tagName === 'string') {
      let text = '';
      for (const child of [...(node.childNodes ?? [])]) text += walk(child);
      return `<${node.tagName.toLowerCase()}>${text}`;
    }
    let text = '';
    for (const child of [...(node.childNodes ?? [])]) text += walk(child);
    return text;
  };
  return walk(root);
}

test('the hasError branch swaps to the fallback on a captured failure', () => {
  const tag = uniqueTag('branch');
  defineBoundary(tag);
  const element = dom.document.createElement(tag) as AnyElement;
  dom.document.body.appendChild(element);

  // Clean state: the off branch (the slot) renders, not the fallback.
  expect(element.hasError).toEqual(false);
  expect(textOf(element)).toContain('<slot>');
  expect(textOf(element)).not.toContain('failed');

  // The documented capture path: the boundary's own catchError.
  element.catchError(new Error('boom'));
  expect(element.hasError).toEqual(true);
  expect(textOf(element)).toContain('<p>failed');
  expect(textOf(element)).not.toContain('<slot>');
});

test('retry clears the branch again, reset clears it unconditionally', () => {
  const tag = uniqueTag('branch-retry');
  defineBoundary(tag);
  const element = dom.document.createElement(tag) as AnyElement;
  dom.document.body.appendChild(element);

  element.catchError(new Error('first'));
  expect(textOf(element)).toContain('failed');

  // No captured source (application-provided error): retry clears state.
  element.retry();
  expect(element.hasError).toEqual(false);
  expect(textOf(element)).not.toContain('failed');

  element.catchError(new Error('second'));
  expect(element.hasError).toEqual(true);
  element.reset();
  expect(element.hasError).toEqual(false);
  expect(element.retryCount).toEqual(0);
});

test('the kernel automatic capture publishes into a compiled hasError branch', () => {
  // The base class's automatic connect/claim capture must reach a compiled
  // subclass's hasError signal — otherwise a render() branch would only ever
  // see application catchError() calls, not the failures the README says the
  // boundary captures automatically. The drift path is the one
  // error-boundary-auto.test.ts drives: pre-seed the light root with DOM that
  // disagrees with the program, then connect.
  const tag = uniqueTag('branch-auto');
  defineBoundary(tag);
  const element = dom.document.createElement(tag) as AnyElement;
  element.appendChild(dom.document.createTextNode('drifted'));
  let threw = false;
  try {
    dom.document.body.appendChild(element);
  } catch {
    // The kernel captures the claim mismatch and rethrows through connect.
    threw = true;
  }
  expect(threw).toEqual(true);
  // The automatic capture published through the boundary's own state, so the
  // compiled branch reads the SAME state application code reads. (The DOM
  // deliberately stays as authored: a failed claim leaves the tree for the
  // recovery path — the fallback branch is the boundary's own render output,
  // which the successful-connect legs above cover.)
  expect(element.hasError).toEqual(true);
  expect(element.error).not.toEqual(null);
});
