import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { OpenElementThemeManager } from '../src/open-element-theme.ts';

test('OpenElement public module stays a pure re-export seam', async () => {
  const source = await readFile(new URL('../src/open-element.ts', import.meta.url), 'utf8');
  expect(source).toContain("export { OpenElement } from './open-element-implementation.ts';");
});

test('OpenElementThemeManager registers styles idempotently and resets', () => {
  const manager = new OpenElementThemeManager();
  const first = {};
  const second = {};

  manager.registerStyles([first, first, second]);
  expect(manager.getStyles()).toEqual([first, second]);

  manager.resetStyles();
  expect(manager.getStyles()).toEqual([]);
});

test('OpenElementThemeManager preserves and deduplicates adopted styles', () => {
  const manager = new OpenElementThemeManager();
  const sheet = () => ({ replaceSync: () => {}, cssRules: [] });
  const existing = sheet();
  const global = sheet();
  const component = sheet();
  const root = { adoptedStyleSheets: [existing, global] } as unknown as ShadowRoot;

  manager.registerStyles(global);
  manager.applyStyles(root, [component, existing]);

  expect(root.adoptedStyleSheets as unknown[]).toEqual([existing, global, component]);
});
