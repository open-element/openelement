import { assertEquals, assertExists, assertFalse } from '@std/assert';

Deno.test('token layer exposes semantic component recipes', async () => {
  const { openPropsTokenSheet } = await import('../src/open-props-tokens.ts');
  const css = openPropsTokenSheet.cssRules.map((rule) => rule.cssText).join('\n');
  assertExists(openPropsTokenSheet);
  for (const token of ['--surface-glass', '--ui-control-bg', '--focus-ring', '--motion-standard']) {
    assertEquals(css.includes(token), true, `${token} must be part of the semantic contract`);
  }
});

Deno.test('one token sheet serves document and shadow adoption', async () => {
  const { openPropsTokenSheet } = await import('../src/open-props-tokens.ts');
  const css = openPropsTokenSheet.cssRules.map((rule) => rule.cssText).join('\n');
  // The token block is dual: :root for document adoption, :host for shadow
  // adoption. There is no separate transformed sheet and no transformer.
  assertEquals(/:root,\s+:host/.test(css), true, 'token block must select :root, :host');
  assertEquals(css.includes(':root[data-theme='), true, 'dark block must select :root');
  assertEquals(css.includes(":host([data-theme='dark'])"), true, 'dark block must select :host');
  const darkDecls = (css.split(':root[data-theme=')[1]?.match(/--[a-z0-9-]+\s*:/g) ?? []).length;
  assertEquals(darkDecls > 0, true, 'the dark block must carry declarations');
  // The structural fallback (containment) is :host-exclusive: it must never
  // be applied to the document root.
  const rootRule = css.match(/:root,\s*:host\s*\{([^}]*)\}/)?.[1] ?? '';
  assertEquals(rootRule.includes('display: block'), false);
  assertEquals(rootRule.includes('contain:'), false);
});

Deno.test('the retired root-sheet export and transformer stay gone', async () => {
  const mod = await import('../src/open-props-tokens.ts');
  assertFalse('openPropsRootSheet' in mod);
  assertFalse('toRootCss' in mod);
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
