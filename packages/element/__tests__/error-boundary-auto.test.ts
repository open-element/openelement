/**
 * ErrorBoundary automatic capture tests (ADR-0053 Layer 2, #919), restated
 * over the compiled kernel (0.44).
 *
 * The legacy SSR shapes (renderDsdTree subtree capture, bare-tag degradation)
 * were deleted with the legacy renderer. In the compiled model:
 *   - the kernel captures connect/claim failures into the element-local
 *     CompiledErrorBoundary service;
 *   - the public ErrorBoundary class exposes that service (hasError, error,
 *     catchError, retry, reset);
 *   - retry() re-activates the captured source element; a still-failing
 *     source recaptures through its own activation path;
 *   - fallback presentation is program-defined (a Region over error state),
 *     not a VNode swap.
 *
 * The DOM harness (compiled-runtime/facade-dom.ts) installs browser globals
 * before the package is imported.
 */

import { expect, test } from 'vitest';
import { installFacadeDom, parseHtml } from './compiled-runtime/facade-dom.ts';
import { testProgram, type TestProgramSpec } from './compiled-runtime/test-program.ts';
import { makeUniqueTag } from './compiled-runtime/light-counter-harness.ts';

const dom = installFacadeDom();

const { ErrorBoundary } = await import('@openelement/element');
const { renderDsd } = await import('@openelement/element');

// oxlint-disable-next-line no-explicit-any
type AnyElement = any;
type BoundaryInstance = InstanceType<typeof ErrorBoundary>;

const uniqueTag = makeUniqueTag('boundary');

const COUNTER_SPEC: Omit<TestProgramSpec, 'tag'> = {
  template: [
    {
      k: 'el',
      tag: 'button',
      attrs: [['type', 'button']],
      children: [
        { k: 'text', value: 'count: ' },
        { k: 'part', index: 0 },
      ],
    },
  ],
  parts: [{ k: 'text', index: 0, signal: 'count' }],
  properties: [
    {
      name: 'count',
      attribute: 'count',
      type: 'number',
      converter: 'number',
      reflect: false,
      default: 0,
    },
  ],
};

function defineBoundary(tag: string, spec: Omit<TestProgramSpec, 'tag'> = COUNTER_SPEC) {
  const program = testProgram({ ...spec, tag });
  const ctor = class extends ErrorBoundary {} as unknown as CustomElementConstructor &
    Record<string, unknown>;
  ctor.__partProgram = program;
  ctor.__compiledProperties = program.metadata.properties;
  ctor.__elementMetadata = program.metadata;
  ctor.observedAttributes = program.metadata.observedAttributes;
  dom.registry.define(tag, ctor);
  return { ctor, program };
}

/** Connect a boundary whose light DOM drifts from the program. */
function connectDrifted(tag: string): BoundaryInstance {
  const el = dom.document.createElement(tag) as AnyElement;
  el.setAttribute('count', '2');
  const parsed = parseHtml(dom.document, '<button type="button">count: <!--bad-->2</button>');
  for (const child of [...parsed.childNodes]) el.appendChild(child);
  try {
    dom.document.body.appendChild(el);
  } catch {
    // The kernel captures the claim mismatch and rethrows through connect.
  }
  return el as BoundaryInstance;
}

test('compiled boundary captures connect-time claim failures automatically', () => {
  const tag = uniqueTag('auto');
  defineBoundary(tag);
  const el = connectDrifted(tag);
  expect(el.hasError).toEqual(true);
  expect(el.error).toBeInstanceOf(Error);
  expect(el.error?.message ?? '').toContain('compiled-claim');
});

test('boundary without failure stays clean and renders normally', () => {
  const tag = uniqueTag('clean');
  const { ctor } = defineBoundary(tag);
  const html = renderDsd(tag, { componentClass: ctor, props: { count: 4 } }).html;
  const parsed = parseHtml(dom.document, html);
  const parsedHost = parsed.childNodes[0] as AnyElement;
  const el = dom.document.createElement(tag) as AnyElement;
  for (const [name, value] of parsedHost.attributes) el.setAttribute(name, value);
  for (const child of [...parsedHost.childNodes]) el.appendChild(child);
  dom.document.body.appendChild(el);
  expect(el.hasError).toEqual(false);
  expect(el.count).toEqual(4);
});

test('retry re-activates the captured source after the drift is fixed', () => {
  const tag = uniqueTag('retry');
  const { ctor } = defineBoundary(tag);
  const el = connectDrifted(tag) as AnyElement;
  expect(el.hasError).toEqual(true);

  // Repair the DOM to match the program's expectation for count=2.
  const html = renderDsd(tag, { componentClass: ctor, props: { count: 2 } }).html;
  const parsed = parseHtml(dom.document, html);
  const parsedHost = parsed.childNodes[0] as AnyElement;
  for (const child of [...el.childNodes]) el.removeChild(child);
  for (const child of [...parsedHost.childNodes]) el.appendChild(child);

  el.retry();
  expect(el.hasError, 'retry cleared the error after a successful re-activation').toEqual(false);
  expect(el.count).toEqual(2);
});

test('retry with a still-broken source recaptures the error', () => {
  const tag = uniqueTag('retry-broken');
  defineBoundary(tag);
  const el = connectDrifted(tag);
  expect(el.hasError).toEqual(true);
  el.retry();
  expect(el.hasError, 'the still-failing source recaptures').toEqual(true);
});

test('retry budget exhausts at maxRetries', () => {
  const tag = uniqueTag('exhausted');
  const { ctor } = defineBoundary(tag);
  void ctor;
  const el = connectDrifted(tag);
  (el as AnyElement).maxRetries = 1;
  expect(el.hasError).toEqual(true);
  el.retry(); // recaptures (still broken)
  expect(el.hasError).toEqual(true);
  el.retry(); // exhausted: no further recovery attempt
  expect(el.retryCount).toEqual(1);
  expect(el.hasError).toEqual(true);
});

test('nested boundaries keep error state service-local (inner captures only)', () => {
  const innerTag = uniqueTag('inner');
  const outerTag = uniqueTag('outer');
  defineBoundary(innerTag);
  defineBoundary(outerTag, {
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [],
  });
  const outer = dom.document.createElement(outerTag) as AnyElement;
  dom.document.body.appendChild(outer);
  const inner = connectDrifted(innerTag);
  outer.appendChild(inner);

  expect(inner.hasError, 'the inner boundary captured its own failure').toEqual(true);
  expect(outer.hasError, 'no state leaks to the outer boundary').toEqual(false);
});

test('application-driven catchError and reset keep the public contract', () => {
  const tag = uniqueTag('manual');
  defineBoundary(tag);
  const el = dom.document.createElement(tag) as unknown as BoundaryInstance;
  dom.document.body.appendChild(el as never);

  el.catchError(new Error('manual boom'), { origin: 'test' });
  expect(el.hasError).toEqual(true);
  expect(el.error?.message).toEqual('manual boom');

  el.reset();
  expect(el.hasError).toEqual(false);
  expect(el.retryCount).toEqual(0);
});
