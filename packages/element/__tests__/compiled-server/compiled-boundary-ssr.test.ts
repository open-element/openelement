/**
 * packages/element/__tests__/compiled-server/compiled-boundary-ssr.test.ts —
 * SSR boundary capture (alpha.13 artifact honesty).
 *
 * The audit finding: a subtree evaluation throw at SSR 500'd the whole route,
 * despite packages/element/README.md claiming the boundary renders its
 * fallback on SSR. renderDsdAtDepth now wraps each element's serialization:
 * a throw surfacing from this element's own derivations or from a nested
 * recursion re-serializes the CURRENT program with the `hasError` signal
 * forced true — the compiled boundary's fallback is a `when` Region over that
 * signal, so the re-run takes the fallback branch in place of the failed
 * subtree. Non-boundary elements rethrow (route-500 semantics unchanged), so
 * the failure surfaces at the NEAREST boundary; nested recursion composes.
 */

import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { renderDsd } from '../../src/public-runtime.ts';
import type { PartProgram } from '@openelement/protocol/part-program';
import { computed } from '../../src/internal/signal/index.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';
import { makeUniqueTag } from '../compiled-runtime/light-counter-harness.ts';

const uniqueTag = makeUniqueTag('ssr-boundary');

/**
 * A class shape carrying the compiled statics. `isErrorBoundary` marks the
 * boundary classes the SSR capture reads; `__computedFields` supplies the
 * derived-signal factories exactly as the compiler emits them.
 */
function compiledClass(
  program: PartProgram,
  extra: { isErrorBoundary?: boolean; computedFields?: Record<string, unknown> } = {},
): CustomElementConstructor {
  return Object.assign(class {}, {
    __partProgram: program,
    __compiledProperties: program.metadata.properties,
    isErrorBoundary: extra.isErrorBoundary ?? false,
    __computedFields: extra.computedFields,
  }) as unknown as CustomElementConstructor;
}

/** Mark a property record computed with its dependency list (validator contract). */
function markComputed(program: PartProgram, name: string, deps: string[]): void {
  const record = program.metadata.properties.find((property) => property.name === name);
  if (!record) throw new Error(`no property ${name}`);
  Object.assign(record as Record<string, unknown>, { computed: true, deps });
}

/** The README boundary shape: a `when` Region over hasError swapping a fallback. */
function boundaryProgram(tag: string, offChildren: ReturnType<typeof testProgram>['template']) {
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
            children: [{ k: 'text', value: 'ssr boundary fallback' }],
          },
        ],
        off: offChildren,
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

/** A child whose derived text throws whenever it is evaluated at serialization. */
function throwingChild(tag: string): CustomElementConstructor {
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
        default: { nested: null },
      },
      {
        name: 'derived',
        attribute: null,
        type: 'string',
        converter: 'string',
        reflect: false,
        default: 'never serialized',
      },
    ],
  });
  markComputed(program, 'derived', ['payload']);
  return compiledClass(program, {
    computedFields: {
      derived: (signals: Record<string, { value: { nested: { deep: string } | null } }>) =>
        computed(() => signals.payload.value.nested!.deep),
    },
  });
}

function withRegistry(
  entries: ReadonlyMap<string, CustomElementConstructor>,
  run: () => void,
): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  Object.defineProperty(globalThis, 'customElements', {
    configurable: true,
    value: { get: (tag: string) => entries.get(tag) },
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, 'customElements', original);
    else delete (globalThis as Record<string, unknown>).customElements;
  }
}

test('a nested throwing child renders the boundary fallback branch in the serialized HTML', () => {
  const boundaryTag = uniqueTag('nested');
  const childTag = uniqueTag('boom-child');
  const child = throwingChild(childTag);
  const program = boundaryProgram(boundaryTag, [
    { k: 'el', tag: childTag, attrs: [], children: [] },
  ]);
  const boundary = compiledClass(program, { isErrorBoundary: true });
  const registry = new Map<string, CustomElementConstructor>([
    [boundaryTag, boundary],
    [childTag, child],
  ]);

  withRegistry(registry, () => {
    const output = renderDsd(boundaryTag, {
      componentClass: boundary,
      ssrRenderableTags: [childTag],
    });
    expect(output.html).toContain('ssr boundary fallback');
    expect(
      output.html.includes(childTag),
      'the failed subtree is not serialized beside the fallback',
    ).toEqual(false);
    expect(output.metrics.hasError, 'the render output reports the capture').toEqual(true);
  });
});

test('a non-boundary parent keeps the route-500 semantics (the throw propagates)', () => {
  const plainTag = uniqueTag('plain');
  const childTag = uniqueTag('boom-plain-child');
  const child = throwingChild(childTag);
  const program = boundaryProgram(plainTag, [{ k: 'el', tag: childTag, attrs: [], children: [] }]);
  const plain = compiledClass(program);
  const registry = new Map<string, CustomElementConstructor>([
    [plainTag, plain],
    [childTag, child],
  ]);

  withRegistry(registry, () => {
    assertThrowsIncludes(
      () => renderDsd(plainTag, { componentClass: plain, ssrRenderableTags: [childTag] }),
      Error,
      'null',
    );
  });
});

test('a nested failure surfaces at the nearest boundary through a non-boundary middle element', () => {
  const boundaryTag = uniqueTag('surfacing');
  const middleTag = uniqueTag('middle');
  const childTag = uniqueTag('boom-surfacing-child');
  const child = throwingChild(childTag);
  // The middle element is NOT a boundary: the child throw must pass through
  // its serialization and surface at the enclosing boundary.
  const middleProgram = boundaryProgram(middleTag, [
    { k: 'el', tag: childTag, attrs: [], children: [] },
  ]);
  const middle = compiledClass(middleProgram);
  const program = boundaryProgram(boundaryTag, [
    { k: 'el', tag: middleTag, attrs: [], children: [] },
  ]);
  const boundary = compiledClass(program, { isErrorBoundary: true });
  const registry = new Map<string, CustomElementConstructor>([
    [boundaryTag, boundary],
    [middleTag, middle],
    [childTag, child],
  ]);

  withRegistry(registry, () => {
    const output = renderDsd(boundaryTag, {
      componentClass: boundary,
      ssrRenderableTags: [middleTag, childTag],
    });
    expect(output.html).toContain('ssr boundary fallback');
    expect(output.html.includes(childTag)).toEqual(false);
  });
});

test('a boundary-own failing derivation outside the fallback region still propagates (bounded retry)', () => {
  // The compiled grammar keeps region branches static, so a derived signal
  // read OUTSIDE the fallback region is evaluated in both serializations:
  // the capture retries once with the fallback branch and then fails loud —
  // it must never mask a failure the fallback cannot replace (React's
  // boundary re-render has the same shape: a fallback that throws propagates).
  const boundaryTag = uniqueTag('own');
  const program = testProgram({
    tag: boundaryTag,
    rootMode: 'shadow-open',
    template: [
      {
        k: 'el',
        tag: 'div',
        attrs: [],
        children: [
          { k: 'part', index: 0 },
          { k: 'part', index: 1 },
        ],
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
            children: [{ k: 'text', value: 'own-eval fallback' }],
          },
        ],
        off: [{ k: 'el', tag: 'slot', attrs: [], children: [] }],
      },
      { k: 'text', index: 1, signal: 'boom' },
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
      {
        name: 'boom',
        attribute: null,
        type: 'string',
        converter: 'string',
        reflect: false,
        default: 'never',
      },
    ],
  });
  markComputed(program, 'boom', ['hasError']);
  const boundary = compiledClass(program, {
    isErrorBoundary: true,
    computedFields: {
      boom: () =>
        computed(() => {
          throw new Error('boundary own evaluation boom');
        }),
    },
  });

  withRegistry(new Map([[boundaryTag, boundary]]), () => {
    assertThrowsIncludes(
      () => renderDsd(boundaryTag, { componentClass: boundary }),
      Error,
      'boundary own evaluation boom',
    );
  });
});

test('a clean boundary render is unchanged by the capture path (no capture, no override)', () => {
  const boundaryTag = uniqueTag('clean');
  const program = boundaryProgram(boundaryTag, [
    { k: 'el', tag: 'span', attrs: [], children: [{ k: 'text', value: 'happy path' }] },
  ]);
  const boundary = compiledClass(program, { isErrorBoundary: true });
  withRegistry(new Map([[boundaryTag, boundary]]), () => {
    const output = renderDsd(boundaryTag, { componentClass: boundary });
    expect(output.html).toContain('happy path');
    expect(output.html).not.toContain('fallback');
    expect(output.metrics.hasError).toEqual(false);
  });
});
