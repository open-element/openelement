import { assertEquals, assertExists, assertFalse } from '@std/assert';

Deno.test('token layer exposes semantic component recipes', async () => {
  const { openPropsRootSheet, openPropsTokenSheet } = await import('../src/open-props-tokens.ts');
  const css = openPropsTokenSheet.cssRules.map((rule) => rule.cssText).join('\n');
  assertExists(openPropsRootSheet);
  assertExists(openPropsTokenSheet);
  for (const token of ['--surface-glass', '--ui-control-bg', '--focus-ring', '--motion-standard']) {
    assertEquals(css.includes(token), true, `${token} must be part of the semantic contract`);
  }
});

Deno.test('component recipes are valid constructable sheets', async () => {
  const recipes = await import('../src/component-recipes.ts');
  for (const sheet of [recipes.controlRecipe, recipes.surfaceRecipe, recipes.overlayRecipe]) {
    assertEquals(typeof sheet.replaceSync, 'function');
    assertEquals(sheet.cssRules.length > 0, true);
  }
});

Deno.test('retired daisy, modal and step-card surfaces stay absent', async () => {
  const index = await import('../src/index.ts');
  assertFalse('daisyClassSheet' in index);
  assertFalse('OpenModal' in index);
  assertFalse('OpenStepCard' in index);
});

Deno.test('retained interactive components are exported', async () => {
  const index = await import('../src/index.ts');
  assertExists(index.OpenDialog);
  assertExists(index.OpenDropdown);
  assertExists(index.OpenTabs);
});
