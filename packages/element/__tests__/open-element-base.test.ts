import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { OpenElementBase } from '../src/open-element-base.ts';
import { OpenElementError } from '../src/internal/core/errors.ts';

test('SSR HTMLElement facade exposes inert reads and fails closed on DOM operations', () => {
  const element = new OpenElementBase();
  expect(element.hasAttribute('mode')).toEqual(false);
  expect(element.getAttribute('mode')).toEqual(null);
  element.setAttribute('mode', 'ready');
  element.removeAttribute('mode');
  expect(element.tagName).toEqual('');
  expect(element.isConnected).toEqual(false);
  for (const operation of [
    () => element.querySelector('*'),
    () => element.attachShadow({ mode: 'open' }),
    () => element.dispatchEvent(new Event('test')),
  ]) {
    const error = assertThrowsIncludes(operation, OpenElementError, 'unavailable during SSR');
    expect(error.code).toEqual('SSR_DOM_ACCESS_UNSUPPORTED');
    expect(error.phase).toEqual('ssr');
  }
});
