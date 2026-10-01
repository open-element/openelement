import { assertEquals } from '@std/assert';
import { deepGetElementById } from '../src/internal/core/deep-fragment.ts';

Deno.test('deepGetElementById finds direct and nested shadow targets (#1090)', () => {
  const target = { id: 'build' } as HTMLElement;
  const nestedRoot = {
    getElementById: (id: string) => (id === 'build' ? target : null),
    querySelectorAll: () => [],
  } as unknown as ShadowRoot;
  const root = {
    getElementById: (id: string) => (id === 'light' ? target : null),
    querySelectorAll: () => [{ shadowRoot: nestedRoot }],
  } as unknown as Document;
  assertEquals(deepGetElementById('light', root), target);
  assertEquals(deepGetElementById('#build', root), target);
  assertEquals(deepGetElementById('missing', root), null);
  assertEquals(deepGetElementById('#%ZZ', root), null);
});
