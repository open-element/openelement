/**
 * @openelement/ui — theme contract tests.
 *
 * Pins the single acceptance rule and the idempotent single-writer contract
 * that the pre-paint script and the toggle both rely on (seams.md:
 * html[data-theme] broadcast). A regression here re-opens the dual-writer
 * seam: either the boot script and the toggle disagree about the saved-value
 * acceptance rule, or hydration writes a second time.
 */
import { expect, test } from 'vitest';
import {
  applyDocumentTheme,
  isSiteTheme,
  resolveSiteTheme,
  THEME_STORAGE_KEY,
} from '../src/theme-contract.ts';

test('accepts only the exact light/dark spellings', () => {
  expect(isSiteTheme('light')).toBe(true);
  expect(isSiteTheme('dark')).toBe(true);
  expect(isSiteTheme('Light')).toBe(false);
  expect(isSiteTheme('garbage')).toBe(false);
  expect(isSiteTheme('')).toBe(false);
  expect(isSiteTheme(null)).toBe(false);
  expect(isSiteTheme(undefined)).toBe(false);
});

test('one acceptance rule: exact saved value wins, otherwise system preference', () => {
  expect(resolveSiteTheme('light', false)).toBe('light');
  expect(resolveSiteTheme('dark', true)).toBe('dark');
  expect(resolveSiteTheme(null, true)).toBe('light');
  expect(resolveSiteTheme(null, false)).toBe('dark');
  // Legacy truthy garbage under the key must not reach data-theme.
  expect(resolveSiteTheme('garbage', true)).toBe('light');
  expect(resolveSiteTheme('garbage', false)).toBe('dark');
  expect(resolveSiteTheme('', false)).toBe('dark');
  expect(resolveSiteTheme(undefined, true)).toBe('light');
});

test('applyDocumentTheme is the one writer and is idempotent', () => {
  const attributes = new Map<string, string>();
  const style: { colorScheme?: string } = {};
  let writes = 0;
  const root = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      writes++;
      attributes.set(name, value);
    },
    style,
  };

  expect(applyDocumentTheme(root, 'dark')).toBe(true);
  expect(attributes.get('data-theme')).toBe('dark');
  expect(style.colorScheme).toBe('dark');
  expect(writes).toBe(1);

  // Hydration after pre-paint: the value is already in place, so this is a
  // no-op — no second DOM mutation on the document element.
  expect(applyDocumentTheme(root, 'dark')).toBe(false);
  expect(writes).toBe(1);

  expect(applyDocumentTheme(root, 'light')).toBe(true);
  expect(attributes.get('data-theme')).toBe('light');
  expect(style.colorScheme).toBe('light');
  expect(writes).toBe(2);
});

test('the storage key is the one both consumers read', () => {
  expect(THEME_STORAGE_KEY).toBe('open-theme');
});
