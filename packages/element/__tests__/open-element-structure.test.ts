import { assertEquals, assertStringIncludes } from '@std/assert';
import { OpenElementThemeManager } from '../src/open-element-theme.ts';

Deno.test('OpenElement public module stays a pure re-export seam', async () => {
  const source = await Deno.readTextFile(new URL('../src/open-element.ts', import.meta.url));
  assertStringIncludes(source, "export { OpenElement } from './open-element-implementation.ts';");
});

Deno.test('OpenElementThemeManager registers styles idempotently and resets', () => {
  const manager = new OpenElementThemeManager();
  const first = {};
  const second = {};

  manager.registerStyles([first, first, second]);
  assertEquals(manager.getStyles(), [first, second]);

  manager.resetStyles();
  assertEquals(manager.getStyles(), []);
});

Deno.test('OpenElementThemeManager preserves and deduplicates adopted styles', () => {
  const manager = new OpenElementThemeManager();
  const sheet = () => ({ replaceSync: () => {}, cssRules: [] });
  const existing = sheet();
  const global = sheet();
  const component = sheet();
  const root = { adoptedStyleSheets: [existing, global] } as unknown as ShadowRoot;

  manager.registerStyles(global);
  manager.applyStyles(root, [component, existing]);

  assertEquals(root.adoptedStyleSheets as unknown[], [existing, global, component]);
});
