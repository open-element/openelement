/**
 * packages/element/__tests__/compiled-runtime/error-boundary-capture.test.ts —
 * the automatic-capture routing every client failure path rides (alpha.13
 * artifact honesty).
 *
 * `OpenElement._captureError` is the ONE routing path (P6): it climbs the
 * composed ancestor chain (light DOM, shadow boundaries through hosts) to the
 * nearest class carrying `static isErrorBoundary === true` and captures
 * through that boundary's service so publication behaves exactly like an
 * application `catchError()` call. Three capture points feed it:
 *
 *   - the compiler-emitted lifecycle wrapper (this suite pins the runtime
 *     half with the wrapper's exact shape; the compiler suite pins the
 *     emission);
 *   - the facade property setter (signal-graph evaluation is synchronous at
 *     the write);
 *   - the kernel's update-error sink (Region update failures after
 *     activation).
 *
 * The composed ancestor semantics the audit demanded: a descendant's failure
 * flips the NEAREST boundary only, nested boundaries stay service-local, and
 * a failure with no boundary in the chain keeps the uncaught behavior.
 */

import { expect, test } from 'vitest';
import { installFacadeDom } from './facade-dom.ts';
import { testProgram } from './test-program.ts';
import { makeUniqueTag } from './light-counter-harness.ts';

const dom = installFacadeDom();

const { ErrorBoundary, OpenElement } = await import('@openelement/element');
const { computed } = await import('@openelement/element');

// oxlint-disable-next-line no-explicit-any
type AnyElement = any;

const uniqueTag = makeUniqueTag('capture');

/**
 * The README's boundary shape: a `when` Region over the declared `hasError`
 * property swapping a fallback branch in place of the slot.
 */
function boundaryProgram(tag: string) {
  return testProgram({
    tag,
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
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
            children: [{ k: 'text', value: 'boundary fallback' }],
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
 * Flip the `derived` record to computed exactly like the compiler's metadata
 * (testProgram has no computed flag): the facade then skips signal creation
 * for it and reads the `__computedFields` factory's signal instead. The
 * validator requires a computed record to carry its dependency list.
 */
function markDerivedComputed(program: ReturnType<typeof testProgram>): void {
  Object.assign(program.metadata.properties[1] as Record<string, unknown>, {
    computed: true,
    deps: ['payload'],
  });
}

function defineBoundary(tag: string) {
  const program = boundaryProgram(tag);
  const ctor = class extends ErrorBoundary {
    static __partProgram = program;
    static __compiledProperties = program.metadata.properties;
    static __elementMetadata = program.metadata;
    static observedAttributes = program.metadata.observedAttributes;
  } as unknown as CustomElementConstructor & Record<string, unknown>;
  dom.registry.define(tag, ctor);
  return { ctor, program };
}

/** A plain compiled element with one object property and a text part on it. */
function defineChild(tag: string): CustomElementConstructor & Record<string, unknown> {
  const program = testProgram({
    tag,
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{ k: 'text', index: 0, signal: 'derived' }],
    properties: [
      {
        name: 'payload',
        attribute: null,
        type: 'object',
        converter: 'object',
        reflect: false,
        default: { nested: { deep: 'initial safe value' } },
      },
      {
        name: 'derived',
        attribute: null,
        type: 'string',
        converter: 'string',
        reflect: false,
        default: 'initial safe value',
      },
    ],
  });
  markDerivedComputed(program);
  const ctor = class extends OpenElement {
    static __partProgram = program;
    static __compiledProperties = program.metadata.properties;
    static __elementMetadata = program.metadata;
    static observedAttributes = program.metadata.observedAttributes;
    static __computedFields = {
      derived: (signals: Record<string, { value: { nested: { deep: string } } }>) =>
        computed(() => signals.payload.value.nested.deep),
    };
  } as unknown as CustomElementConstructor & Record<string, unknown>;
  dom.registry.define(tag, ctor);
  return ctor;
}

test('the climb captures at the nearest light-DOM ancestor boundary', () => {
  const boundaryTag = uniqueTag('light-outer');
  const childTag = uniqueTag('light-child');
  defineBoundary(boundaryTag);
  defineChild(childTag);
  const boundary = dom.document.createElement(boundaryTag) as AnyElement;
  dom.document.body.appendChild(boundary);
  const child = dom.document.createElement(childTag) as AnyElement;
  boundary.appendChild(child);

  const error = new Error('light dom climb boom');
  const captured = (child as { _captureError(error: unknown): boolean })._captureError(error);
  expect(captured, 'a light-DOM ancestor boundary captures').toEqual(true);
  expect(boundary.hasError).toEqual(true);
  expect(boundary.error?.message).toEqual('light dom climb boom');
  expect(boundary._errors.source).toEqual(child, 'the failing element is the retry source');
});

test('the climb crosses shadow boundaries through the host', () => {
  const outerTag = uniqueTag('shadow-outer');
  const childTag = uniqueTag('shadow-child');
  defineBoundary(outerTag);
  defineChild(childTag);
  const outer = dom.document.createElement(outerTag) as AnyElement;
  dom.document.body.appendChild(outer);
  // The child lives in the OUTER boundary's shadow tree: its parentElement is
  // null and its parentNode is the ShadowRoot — the climb must continue at
  // shadowRoot.host, not stop at the fragment.
  const child = dom.document.createElement(childTag) as AnyElement;
  (outer.shadowRoot ?? outer.attachShadow({ mode: 'open' })).appendChild(child);

  const error = new Error('shadow crossing boom');
  const captured = (child as { _captureError(error: unknown): boolean })._captureError(error);
  expect(captured, 'the climb reaches the boundary through the shadow host').toEqual(true);
  expect(outer.hasError).toEqual(true);
});

test('a boundary captures its own author-code errors (self-capture)', () => {
  const tag = uniqueTag('self');
  defineBoundary(tag);
  const boundary = dom.document.createElement(tag) as AnyElement;
  dom.document.body.appendChild(boundary);

  const error = new Error('self boom');
  const captured = (boundary as { _captureError(error: unknown): boolean })._captureError(error);
  expect(captured).toEqual(true);
  expect(boundary.hasError).toEqual(true);
  expect(boundary.error?.message).toEqual('self boom');
});

test('no boundary in the chain returns false and captures nothing', () => {
  const childTag = uniqueTag('orphan');
  defineChild(childTag);
  const child = dom.document.createElement(childTag) as AnyElement;
  dom.document.body.appendChild(child);

  const error = new Error('orphan boom');
  const captured = (child as { _captureError(error: unknown): boolean })._captureError(error);
  expect(captured).toEqual(false);
  expect((child as AnyElement).error ?? null).toEqual(null);
});

test('a nested failure flips the nearest boundary only (service-local state)', () => {
  const innerTag = uniqueTag('inner');
  const outerTag = uniqueTag('outer');
  const childTag = uniqueTag('deep-child');
  defineBoundary(innerTag);
  defineBoundary(outerTag);
  defineChild(childTag);
  const outer = dom.document.createElement(outerTag) as AnyElement;
  dom.document.body.appendChild(outer);
  const inner = dom.document.createElement(innerTag) as AnyElement;
  outer.appendChild(inner);
  const child = dom.document.createElement(childTag) as AnyElement;
  inner.appendChild(child);

  const captured = (child as { _captureError(error: unknown): boolean })._captureError(
    new Error('nearest only'),
  );
  expect(captured).toEqual(true);
  expect(inner.hasError, 'the nearest boundary captures').toEqual(true);
  expect(outer.hasError, 'no state leaks past the nearest boundary').toEqual(false);
});

test('re-routing the identical error to the same boundary does not re-publish', () => {
  const boundaryTag = uniqueTag('dedupe');
  const childTag = uniqueTag('dedupe-child');
  defineBoundary(boundaryTag);
  defineChild(childTag);
  const boundary = dom.document.createElement(boundaryTag) as AnyElement;
  dom.document.body.appendChild(boundary);
  const child = dom.document.createElement(childTag) as AnyElement;
  boundary.appendChild(child);
  boundary.catchError(new Error('first'), child);
  const publishes: unknown[] = [];
  const original = boundary._publishErrorState;
  boundary._publishErrorState = () => publishes.push('publish');
  try {
    const again = (child as { _captureError(error: unknown): boolean })._captureError(
      boundary.error,
    );
    expect(again).toEqual(true);
    expect(publishes).toEqual([], 'the deduped re-route publishes nothing');
  } finally {
    boundary._publishErrorState = original;
  }
});

test('the emitted lifecycle wrapper composition: kernel self-capture then route does not double-publish', () => {
  // The exact composition the ABI-v2 wrapper creates on a BOUNDARY element:
  // the kernel captures its own connect failure into the boundary's service
  // (publishing), rethrows, and the wrapper routes the rethrown error — the
  // dedupe in _captureError must keep that from publishing twice.
  const tag = uniqueTag('wrapper-compose');
  defineBoundary(tag);
  const boundary = dom.document.createElement(tag) as AnyElement;
  const publishes: unknown[] = [];
  const original = boundary._publishErrorState;
  boundary._publishErrorState = () => publishes.push('publish');
  try {
    // Kernel-side capture (connect failure path shape).
    boundary._errors.capture(new Error('connect boom'), boundary);
    // Emitted-wrapper-side route of the rethrown identical error.
    const captured = (boundary as { _captureError(error: unknown): boolean })._captureError(
      boundary._errors.error,
    );
    expect(captured).toEqual(true);
    expect(publishes.length).toEqual(1);
  } finally {
    boundary._publishErrorState = original;
  }
});

test('a property write whose signal subscriber throws routes to the boundary instead of escaping', () => {
  const boundaryTag = uniqueTag('setter-outer');
  const childTag = uniqueTag('setter-child');
  defineBoundary(boundaryTag);
  // The child's computed factory hands the test the signals record: a raw
  // throwing subscriber on the plain property signal pins the SETTER capture
  // point (the write invokes subscribers synchronously; nothing else in the
  // runtime sees this throw).
  let payloadSignal: { subscribe(fn: (value: unknown) => void): () => void } | null = null;
  const program = testProgram({
    tag: childTag,
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{ k: 'text', index: 0, signal: 'derived' }],
    properties: [
      {
        name: 'payload',
        attribute: null,
        type: 'object',
        converter: 'object',
        reflect: false,
        default: { nested: { deep: 'safe' } },
      },
      {
        name: 'derived',
        attribute: null,
        type: 'string',
        converter: 'string',
        reflect: false,
        default: 'safe',
      },
    ],
  });
  markDerivedComputed(program);
  const childCtor = class extends OpenElement {
    static __partProgram = program;
    static __compiledProperties = program.metadata.properties;
    static __elementMetadata = program.metadata;
    static observedAttributes = program.metadata.observedAttributes;
    static __computedFields = {
      derived: (signals: Record<string, never>) => {
        payloadSignal = signals.payload as unknown as typeof payloadSignal;
        return computed(() => 'derived');
      },
    };
  } as unknown as CustomElementConstructor & Record<string, unknown>;
  dom.registry.define(childTag, childCtor);

  const boundary = dom.document.createElement(boundaryTag) as AnyElement;
  dom.document.body.appendChild(boundary);
  const child = dom.document.createElement(childTag) as AnyElement;
  boundary.appendChild(child);
  // Preact delivers a synchronous initial echo at subscribe time (the same
  // behavior subscribeWrites guards against); only later calls are the write.
  let subscribeReturned = false;
  payloadSignal!.subscribe(() => {
    if (!subscribeReturned) return;
    throw new Error('subscriber boom');
  });
  subscribeReturned = true;

  // The write itself must not throw: the setter routed the subscriber failure.
  child.payload = { nested: { deep: 'changed' } };
  expect(boundary.hasError, 'the setter routed the evaluation failure').toEqual(true);
  expect(boundary.error?.message).toEqual('subscriber boom');
});

test('a kernel update failure in a non-boundary descendant routes to the enclosing boundary', () => {
  const boundaryTag = uniqueTag('update-outer');
  const childTag = uniqueTag('update-child');
  defineBoundary(boundaryTag);
  // The child carries an `each` Region over an array property: a poisoned
  // array (an item getter that throws during the update preflight) drives the
  // kernel's onUpdateError — the seam that must route past the element-local
  // service to the ancestor boundary.
  const program = testProgram({
    tag: childTag,
    rootMode: 'shadow-open',
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
    properties: [
      {
        name: 'items',
        attribute: null,
        type: 'array',
        converter: 'array',
        reflect: false,
        default: [],
      },
    ],
  });
  const childCtor = class extends OpenElement {
    static __partProgram = program;
    static __compiledProperties = program.metadata.properties;
    static __elementMetadata = program.metadata;
    static observedAttributes = program.metadata.observedAttributes;
  } as unknown as CustomElementConstructor & Record<string, unknown>;
  dom.registry.define(childTag, childCtor);

  const boundary = dom.document.createElement(boundaryTag) as AnyElement;
  dom.document.body.appendChild(boundary);
  const child = dom.document.createElement(childTag) as AnyElement;
  boundary.appendChild(child);
  expect(boundary.hasError).toEqual(false);

  child.items = [
    { id: 'a', text: 'ok' },
    {
      id: 'b',
      get text() {
        throw new Error('poisoned item');
      },
    },
  ];
  expect(boundary.hasError, 'the update failure reached the ancestor boundary').toEqual(true);
  expect(boundary.error?.message).toEqual('poisoned item');
  expect(boundary._errors.source).toEqual(child, 'retry() re-activates the failing child');
});

test('the derived-signal detonation shape from the audit flips the boundary after hydration', () => {
  // update-boom-island's shape, unit-level: payload + derived computed + text
  // part; detonating writes { nested: null } through the property accessor.
  const boundaryTag = uniqueTag('detonate-outer');
  const childTag = uniqueTag('detonate-child');
  defineBoundary(boundaryTag);
  const program = testProgram({
    tag: childTag,
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{ k: 'text', index: 0, signal: 'derived' }],
    properties: [
      {
        name: 'payload',
        attribute: null,
        type: 'object',
        converter: 'object',
        reflect: false,
        default: { nested: { deep: 'initial safe value' } },
      },
      {
        name: 'derived',
        attribute: null,
        type: 'string',
        converter: 'string',
        reflect: false,
        default: 'initial safe value',
      },
    ],
  });
  markDerivedComputed(program);
  const childCtor = class extends OpenElement {
    static __partProgram = program;
    static __compiledProperties = program.metadata.properties;
    static __elementMetadata = program.metadata;
    static observedAttributes = program.metadata.observedAttributes;
    static __computedFields = {
      derived: (signals: Record<string, { value: { nested: { deep: string } } }>) =>
        computed(() => signals.payload.value.nested.deep),
    };
  } as unknown as CustomElementConstructor & Record<string, unknown>;
  dom.registry.define(childTag, childCtor);

  const boundary = dom.document.createElement(boundaryTag) as AnyElement;
  dom.document.body.appendChild(boundary);
  const child = dom.document.createElement(childTag) as AnyElement;
  boundary.appendChild(child);
  expect(boundary.hasError).toEqual(false);

  child.payload = { nested: null } as never;
  expect(
    boundary.hasError,
    'the detonated derived evaluation reached the boundary (whichever internal capture path fired)',
  ).toEqual(true);
});
