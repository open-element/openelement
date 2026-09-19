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

/** Relative luminance / contrast ratio (WCAG 2.x) over #rrggbb values. */
const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

Deno.test('focus ring clears the WCAG 1.4.11 3:1 floor in both themes', async () => {
  const source = await Deno.readTextFile(new URL('../src/open-props-tokens.ts', import.meta.url));
  const declaration = (name: string, from = 0): string | undefined =>
    new RegExp(`${name}:\\s*([^;]+);`).exec(source.slice(from))?.[1]?.trim();
  // Follow var() aliases to a literal colour.
  const resolve = (name: string, from = 0): string => {
    let value = declaration(name, from) ?? '';
    for (let hop = 0; hop < 8; hop += 1) {
      const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value);
      if (!alias) break;
      value = declaration(alias[1], from) ?? value;
    }
    return value;
  };
  const darkStart = source.indexOf("data-theme='dark'");
  assertEquals(darkStart > 0, true, 'the generated sheet must carry a dark block');

  const lightRing = resolve('--focus-ring');
  assertEquals(
    /^#[0-9a-f]{6}$/i.test(lightRing),
    true,
    `light --focus-ring resolves to ${lightRing}`,
  );
  for (const surface of ['#ffffff', '#f8f9fa', '#f6f4fb']) {
    const ratio = contrast(lightRing, surface);
    assertEquals(ratio >= 3, true, `light ring ${lightRing} vs ${surface} = ${ratio.toFixed(2)}:1`);
  }

  // --focus-ring is declared once (light block) and aliases --brand, which
  // the dark block redeclares; follow the alias chain into the dark block.
  const darkRingValue = resolve('--focus-ring');
  const darkAlias = /^var\((--[a-z0-9-]+)\)$/.exec(darkRingValue);
  const darkRing = darkAlias ? resolve(darkAlias[1], darkStart) : darkRingValue;
  assertEquals(/^#[0-9a-f]{6}$/i.test(darkRing), true, `dark --focus-ring resolves to ${darkRing}`);
  const darkBase = resolve('--bg-base', darkStart);
  assertEquals(
    contrast(darkRing, darkBase) >= 3,
    true,
    `dark ring ${darkRing} vs ${darkBase} = ${contrast(darkRing, darkBase).toFixed(2)}:1`,
  );
});
