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

import { assertEquals, assertInstanceOf, assertStringIncludes } from '@std/assert';
import { installFacadeDom, parseHtml } from './compiled-runtime/facade-dom.ts';
import { testProgram, type TestProgramSpec } from './compiled-runtime/test-program.ts';

const dom = installFacadeDom();

const { ErrorBoundary } = await import('@openelement/element');
const { renderDsd } = await import('@openelement/element');

// oxlint-disable-next-line no-explicit-any
type AnyElement = any;
type BoundaryInstance = InstanceType<typeof ErrorBoundary>;

let tagCounter = 0;
function uniqueTag(prefix: string): string {
  return `oe-boundary-${prefix}-${++tagCounter}`;
}

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

Deno.test('compiled boundary captures connect-time claim failures automatically', () => {
  const tag = uniqueTag('auto');
  defineBoundary(tag);
  const el = connectDrifted(tag);
  assertEquals(el.hasError, true);
  assertInstanceOf(el.error, Error);
  assertStringIncludes(el.error?.message ?? '', 'compiled-claim');
});

Deno.test('boundary without failure stays clean and renders normally', () => {
  const tag = uniqueTag('clean');
  const { ctor } = defineBoundary(tag);
  const html = renderDsd(tag, { componentClass: ctor, props: { count: 4 } }).html;
  const parsed = parseHtml(dom.document, html);
  const parsedHost = parsed.childNodes[0] as AnyElement;
  const el = dom.document.createElement(tag) as AnyElement;
  for (const [name, value] of parsedHost.attributes) el.setAttribute(name, value);
  for (const child of [...parsedHost.childNodes]) el.appendChild(child);
  dom.document.body.appendChild(el);
  assertEquals(el.hasError, false);
  assertEquals(el.count, 4);
});

Deno.test('retry re-activates the captured source after the drift is fixed', () => {
  const tag = uniqueTag('retry');
  const { ctor } = defineBoundary(tag);
  const el = connectDrifted(tag) as AnyElement;
  assertEquals(el.hasError, true);

  // Repair the DOM to match the program's expectation for count=2.
  const html = renderDsd(tag, { componentClass: ctor, props: { count: 2 } }).html;
  const parsed = parseHtml(dom.document, html);
  const parsedHost = parsed.childNodes[0] as AnyElement;
  for (const child of [...el.childNodes]) el.removeChild(child);
  for (const child of [...parsedHost.childNodes]) el.appendChild(child);

  el.retry();
  assertEquals(el.hasError, false, 'retry cleared the error after a successful re-activation');
  assertEquals(el.count, 2);
});

Deno.test('retry with a still-broken source recaptures the error', () => {
  const tag = uniqueTag('retry-broken');
  defineBoundary(tag);
  const el = connectDrifted(tag);
  assertEquals(el.hasError, true);
  el.retry();
  assertEquals(el.hasError, true, 'the still-failing source recaptures');
});

Deno.test('retry budget exhausts at maxRetries', () => {
  const tag = uniqueTag('exhausted');
  const { ctor } = defineBoundary(tag);
  void ctor;
  const el = connectDrifted(tag);
  (el as AnyElement).maxRetries = 1;
  assertEquals(el.hasError, true);
  el.retry(); // recaptures (still broken)
  assertEquals(el.hasError, true);
  el.retry(); // exhausted: no further recovery attempt
  assertEquals(el.retryCount, 1);
  assertEquals(el.hasError, true);
});

Deno.test('nested boundaries keep error state service-local (inner captures only)', () => {
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

  assertEquals(inner.hasError, true, 'the inner boundary captured its own failure');
  assertEquals(outer.hasError, false, 'no state leaks to the outer boundary');
});

Deno.test('application-driven catchError and reset keep the public contract', () => {
  const tag = uniqueTag('manual');
  defineBoundary(tag);
  const el = dom.document.createElement(tag) as unknown as BoundaryInstance;
  dom.document.body.appendChild(el as never);

  el.catchError(new Error('manual boom'), { origin: 'test' });
  assertEquals(el.hasError, true);
  assertEquals(el.error?.message, 'manual boom');

  el.reset();
  assertEquals(el.hasError, false);
  assertEquals(el.retryCount, 0);
});
