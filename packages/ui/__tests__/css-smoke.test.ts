import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('token layer exposes semantic component recipes', async () => {
  const { openPropsTokenSheet } = await import('../src/open-props-tokens.ts');
  const css = openPropsTokenSheet.cssRules.map((rule) => rule.cssText).join('\n');
  expect(openPropsTokenSheet).toEqual(expect.anything());
  for (const token of ['--surface-glass', '--ui-control-bg', '--focus-ring', '--motion-standard']) {
    expect(css.includes(token), `${token} must be part of the semantic contract`).toEqual(true);
  }
});

test('one token sheet serves document and shadow adoption', async () => {
  const { openPropsTokenSheet } = await import('../src/open-props-tokens.ts');
  const css = openPropsTokenSheet.cssRules.map((rule) => rule.cssText).join('\n');
  // The token block is dual: :root for document adoption, :host for shadow
  // adoption. There is no separate transformed sheet and no transformer.
  expect(/:root,\s+:host/.test(css), 'token block must select :root, :host').toEqual(true);
  expect(css.includes(':root[data-theme='), 'dark block must select :root').toEqual(true);
  expect(css.includes(":host([data-theme='dark'])"), 'dark block must select :host').toEqual(true);
  const darkDecls = (css.split(':root[data-theme=')[1]?.match(/--[a-z0-9-]+\s*:/g) ?? []).length;
  expect(darkDecls > 0, 'the dark block must carry declarations').toEqual(true);
  // The structural fallback (containment) is :host-exclusive: it must never
  // be applied to the document root.
  const rootRule = css.match(/:root,\s*:host\s*\{([^}]*)\}/)?.[1] ?? '';
  expect(rootRule.includes('display: block')).toEqual(false);
  expect(rootRule.includes('contain:')).toEqual(false);
});

test('the retired root-sheet export and transformer stay gone', async () => {
  const mod = await import('../src/open-props-tokens.ts');
  expect('openPropsRootSheet' in mod).toBeFalsy();
  expect('toRootCss' in mod).toBeFalsy();
});

test('component recipes are valid constructable sheets', async () => {
  const recipes = await import('../src/component-recipes.ts');
  for (const sheet of [recipes.controlRecipe, recipes.surfaceRecipe, recipes.overlayRecipe]) {
    expect(typeof sheet.replaceSync).toEqual('function');
    expect(sheet.cssRules.length > 0).toEqual(true);
  }
});

test('retired daisy, modal and step-card surfaces stay absent', async () => {
  const index = await import('../src/index.ts');
  expect('daisyClassSheet' in index).toBeFalsy();
  expect('OpenModal' in index).toBeFalsy();
  expect('OpenStepCard' in index).toBeFalsy();
});

test('retained interactive components are exported', async () => {
  const index = await import('../src/index.ts');
  expect(index.OpenDialog).toEqual(expect.anything());
  expect(index.OpenDropdown).toEqual(expect.anything());
  expect(index.OpenTabs).toEqual(expect.anything());
});

/** Relative luminance / contrast ratio (WCAG 2.x) over #rrggbb values. */
const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('focus ring clears the WCAG 1.4.11 3:1 floor in both themes', async () => {
  const source = await readFile(new URL('../src/open-props-tokens.ts', import.meta.url), 'utf8');
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
  expect(darkStart > 0, 'the generated sheet must carry a dark block').toEqual(true);

  const lightRing = resolve('--focus-ring');
  expect(/^#[0-9a-f]{6}$/i.test(lightRing), `light --focus-ring resolves to ${lightRing}`).toEqual(
    true,
  );
  for (const surface of ['#ffffff', '#f8f9fa', '#f6f4fb']) {
    const ratio = contrast(lightRing, surface);
    expect(ratio >= 3, `light ring ${lightRing} vs ${surface} = ${ratio.toFixed(2)}:1`).toEqual(
      true,
    );
  }

  // --focus-ring is declared once (light block) and aliases --brand, which
  // the dark block redeclares; follow the alias chain into the dark block.
  const darkRingValue = resolve('--focus-ring');
  const darkAlias = /^var\((--[a-z0-9-]+)\)$/.exec(darkRingValue);
  const darkRing = darkAlias ? resolve(darkAlias[1], darkStart) : darkRingValue;
  expect(/^#[0-9a-f]{6}$/i.test(darkRing), `dark --focus-ring resolves to ${darkRing}`).toEqual(
    true,
  );
  const darkBase = resolve('--bg-base', darkStart);
  expect(
    contrast(darkRing, darkBase) >= 3,
    `dark ring ${darkRing} vs ${darkBase} = ${contrast(darkRing, darkBase).toFixed(2)}:1`,
  ).toEqual(true);
});

test('state inks clear the 4.5:1 AA floor on --bg-base and their badge wash', async () => {
  const source = await readFile(new URL('../src/open-props-tokens.ts', import.meta.url), 'utf8');
  const declaration = (name: string): string | undefined =>
    new RegExp(`${name}:\\s*([^;]+);`).exec(source)?.[1]?.trim();
  // The light block's base is color-mix(violet-0 42%, gray-0) = #f9f8fc; the
  // value is pinned in the semantic-tokens comment this test recomputes.
  const BASE = '#f9f8fc';
  const composite = (rgba: string, over: string): string => {
    const match = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/.exec(rgba);
    expect(match !== null, `expected an rgba() subtle wash, got ${rgba}`).toEqual(true);
    const [, r, g, b, a] = match!;
    const alpha = Number(a);
    const base = [1, 3, 5].map((i) => Number.parseInt(over.slice(i, i + 2), 16));
    const ink = [r, g, b].map(Number);
    const mixed = base.map((channel, i) => Math.round(ink[i] * alpha + channel * (1 - alpha)));
    return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  };
  for (const tone of ['success', 'warning', 'error', 'info']) {
    const ink = declaration(`--${tone}`) ?? '';
    const subtle = declaration(`--${tone}-subtle`) ?? '';
    expect(/^#[0-9a-f]{6}$/i.test(ink), `${tone} ink resolves to ${ink}`).toEqual(true);
    const onBase = contrast(ink, BASE);
    expect(onBase >= 4.5, `${tone} on base = ${onBase.toFixed(2)}:1`).toEqual(true);
    const wash = composite(subtle, BASE);
    const onWash = contrast(ink, wash);
    expect(onWash >= 4.5, `${tone} on its wash ${wash} = ${onWash.toFixed(2)}:1`).toEqual(true);
  }
});
