/**
 * alpha16 nested-expansion — the runtime half.
 *
 * `nestedHost` is the ONE call a generated element's SSR producer makes for each
 * custom-element tag. Its contract has two halves and both matter:
 *
 * - with an expander that admits the tag, the expanded markup replaces the
 *   caller's literal bytes (that is what gives a nested island its DSD);
 * - with no expander, a declining expander, or a non-object host, the CALLER'S
 *   OWN literal bytes are returned verbatim.
 *
 * The second half is the safety property: an admission regression can only ever
 * show up as "no DSD", never as wrong markup.
 */
import { expect, test } from 'vitest';
import {
  NESTED_HOST_PROPERTY,
  NESTED_HOST_REPORTER_PROPERTY,
  nestedHost,
  type NestedHostRequest,
} from '../../src/internal/compiled/runtime/nested-host.ts';

const REQUEST = {
  tag: 'x-child',
  attributes: [['class', 'a'] as const],
  open: '<x-child class="a">',
  children: 'kids',
  fallback: '<x-child class="a">kids</x-child>',
};

test('an admitted tag is replaced by the expander output', () => {
  const host = {
    [NESTED_HOST_PROPERTY]: (request: { tag: string }) =>
      request.tag === 'x-child'
        ? '<x-child><template shadowrootmode="open"></template>kids</x-child>'
        : undefined,
  };
  expect(nestedHost(host, REQUEST)).toBe(
    '<x-child><template shadowrootmode="open"></template>kids</x-child>',
  );
});

test('a declining expander keeps the caller bytes', () => {
  const host = { [NESTED_HOST_PROPERTY]: () => undefined };
  expect(nestedHost(host, REQUEST)).toBe(REQUEST.fallback);
});

test('no host, a non-object host, or no expander keeps the caller bytes', () => {
  expect(nestedHost(undefined, REQUEST)).toBe(REQUEST.fallback);
  expect(nestedHost(null, REQUEST)).toBe(REQUEST.fallback);
  expect(nestedHost('host', REQUEST)).toBe(REQUEST.fallback);
  expect(nestedHost({}, REQUEST)).toBe(REQUEST.fallback);
  // A non-function field is not an expander; it is not called either.
  expect(nestedHost({ [NESTED_HOST_PROPERTY]: 'nope' }, REQUEST)).toBe(REQUEST.fallback);
});

test('a non-string expander answer is the caller bytes, never a coerced value', () => {
  expect(nestedHost({ [NESTED_HOST_PROPERTY]: () => 42 }, REQUEST)).toBe(REQUEST.fallback);
  expect(nestedHost({ [NESTED_HOST_PROPERTY]: () => null }, REQUEST)).toBe(REQUEST.fallback);
});

test('the expander receives the caller attributes and children verbatim', () => {
  let seen: unknown;
  const host = {
    [NESTED_HOST_PROPERTY]: (request: unknown) => {
      seen = request;
      return undefined;
    },
  };
  nestedHost(host, REQUEST);
  expect(seen).toEqual(REQUEST);
});

/* ------------------------------------------------------------------------- *
 * `16b-EB` SSR fallback (execution plan §19.2) — a descendant producer throw
 * belongs to the enclosing error boundary, not to the whole render.
 *
 * The four rows below are §19.2's conditions 1 and 3 in consumer form: the
 * fallback BYTES for a failing producer, the failure staying OBSERVABLE, and the
 * no-silent-swallow guarantee. They call `nestedHost` the way an emitted producer
 * does, so they exercise the shipped helper rather than a double.
 * ------------------------------------------------------------------------- */

test('16b-EB: a boundary-owned descendant failure renders the fallback bytes', () => {
  // A reporter is what makes the failure observable instead of propagated; the
  // no-reporter row below pins the propagation.
  const host = {
    [NESTED_HOST_PROPERTY]: () => ({ kind: 'fallback', html: 'FALLBACK', error: new Error('x') }),
    [NESTED_HOST_REPORTER_PROPERTY]: () => {},
  };
  const request = {
    tag: 'x-child',
    attributes: [],
    open: '<x-child>',
    children: '',
    fallback: 'RAW',
  };
  expect(nestedHost(host, request as NestedHostRequest)).toBe('FALLBACK');
});

test('16b-EB: with no reporter the failure PROPAGATES (no silent swallow)', () => {
  const error = new Error('producer exploded');
  const host = { [NESTED_HOST_PROPERTY]: () => ({ kind: 'fallback', html: 'F', error }) };
  const request = {
    tag: 'x-child',
    attributes: [],
    open: '<x-child>',
    children: '',
    fallback: 'RAW',
  };
  expect(() => nestedHost(host, request as NestedHostRequest)).toThrow(error);
});

test('16b-EB: a reporter receives the error, and the render still continues', () => {
  const error = new Error('producer exploded');
  const seen: unknown[] = [];
  const host = {
    [NESTED_HOST_PROPERTY]: () => ({ kind: 'fallback', html: 'FALLBACK', error }),
    [NESTED_HOST_REPORTER_PROPERTY]: (value: unknown) => seen.push(value),
  };
  const request = {
    tag: 'x-child',
    attributes: [],
    open: '<x-child>',
    children: '',
    fallback: 'RAW',
  };
  expect(nestedHost(host, request as NestedHostRequest)).toBe('FALLBACK');
  expect(seen).toEqual([error]);
});

test('16b-EB: a normal expansion and the literal fallback are unchanged', () => {
  const request = {
    tag: 'x-child',
    attributes: [],
    open: '<x-child>',
    children: '',
    fallback: 'RAW',
  };
  expect(
    nestedHost({ [NESTED_HOST_PROPERTY]: () => 'EXPANDED' }, request as NestedHostRequest),
  ).toBe('EXPANDED');
  expect(
    nestedHost({ [NESTED_HOST_PROPERTY]: () => undefined }, request as NestedHostRequest),
  ).toBe('RAW');
  expect(nestedHost(undefined, request as NestedHostRequest)).toBe('RAW');
});
