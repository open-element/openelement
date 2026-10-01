import { assertEquals, assertThrows } from '@std/assert';
import { OpenElementBase } from '../src/open-element-base.ts';
import { OpenElementError } from '../src/internal/core/errors.ts';

Deno.test('SSR HTMLElement facade exposes inert reads and fails closed on DOM operations', () => {
  const element = new OpenElementBase();
  assertEquals(element.hasAttribute('mode'), false);
  assertEquals(element.getAttribute('mode'), null);
  element.setAttribute('mode', 'ready');
  element.removeAttribute('mode');
  assertEquals(element.tagName, '');
  assertEquals(element.isConnected, false);
  for (const operation of [
    () => element.querySelector('*'),
    () => element.attachShadow({ mode: 'open' }),
    () => element.dispatchEvent(new Event('test')),
  ]) {
    const error = assertThrows(operation, OpenElementError, 'unavailable during SSR');
    assertEquals(error.code, 'SSR_DOM_ACCESS_UNSUPPORTED');
    assertEquals(error.phase, 'ssr');
  }
});
