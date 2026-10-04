import { expect, test } from 'vitest';
import { deepGetElementById } from '../src/internal/core/deep-fragment.ts';

test('deepGetElementById finds direct and nested shadow targets (#1090)', () => {
  const target = { id: 'build' } as HTMLElement;
  const nestedRoot = {
    getElementById: (id: string) => (id === 'build' ? target : null),
    querySelectorAll: () => [],
  } as unknown as ShadowRoot;
  const root = {
    getElementById: (id: string) => (id === 'light' ? target : null),
    querySelectorAll: () => [{ shadowRoot: nestedRoot }],
  } as unknown as Document;
  expect(deepGetElementById('light', root)).toEqual(target);
  expect(deepGetElementById('#build', root)).toEqual(target);
  expect(deepGetElementById('missing', root)).toEqual(null);
  expect(deepGetElementById('#%ZZ', root)).toEqual(null);
});
