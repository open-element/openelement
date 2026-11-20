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
  nestedHost,
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
