import { expect, test } from 'vitest';

async function themeSheetCss(): Promise<string> {
  const { themeTokenSheet } = await import('../src/theme-tokens.ts');
  return themeTokenSheet.cssRules.map((rule) => rule.cssText).join('\n');
}

test('@theme role sheet keeps the @layer theme { :root, :host } shape', async () => {
  const { themeTokenSheet } = await import('../src/theme-tokens.ts');
  expect(typeof themeTokenSheet.replaceSync).toEqual('function');
  expect(themeTokenSheet.cssRules.length > 0).toEqual(true);
  const css = await themeSheetCss();
  // The Tailwind-compiled token tier lands in the same shape the token-sheet
  // convention always pinned: a layered block selecting :root and :host, so
  // one sheet serves document adoption and shadow adoption (alpha9 C1).
  expect(
    /@layer theme\s*\{[\s\S]*?:root,\s*:host\s*\{/.test(css),
    'the role block must be @layer theme { :root, :host }',
  ).toEqual(true);
  for (const role of ['--color-background', '--color-primary', '--color-ring', '--radius']) {
    expect(css.includes(role), `${role} must be part of the @theme contract`).toEqual(true);
  }
});

test('@theme dark union covers html[data-theme], .dark and the :host broadcast', async () => {
  const css = await themeSheetCss();
  // One unlayered rule carries all three dark signals (C0 breakage 2): the
  // www document attribute, the shadcn class convention, and the shadow-host
  // form the open-element-theme.ts broadcast lands on.
  const darkRule = css.match(/html\[data-theme="dark"\][^{}]*\{[^}]*\}/)?.[0] ?? '';
  expect(darkRule, 'a dark rule opening on html[data-theme="dark"]').not.toEqual('');
  expect(darkRule.includes('.dark'), 'dark union must carry the .dark class').toEqual(true);
  expect(
    darkRule.includes(':host([data-theme="dark"])'),
    'dark union must carry the :host broadcast form',
  ).toEqual(true);
  expect(
    (darkRule.match(/--[a-z0-9-]+\s*:/g) ?? []).length,
    'the dark union must carry declarations',
  ).toBeGreaterThan(0);
});

test('@theme tier ships roles only — no unauthored Tailwind scales leak in', async () => {
  const css = await themeSheetCss();
  // The tier compiles with no content scanning, so the default-theme import
  // emits nothing unused. The only scale variables present are the explicit
  // primitives block (component-tier runtime operands at Tailwind default
  // values) — this is the mechanism behind the #1502 roles-only gate.
  // Namespaces not authored here AT ALL (container/breakpoint/ease/animate)
  // are blanket-blocked; the color namespace is allowlisted to exactly the
  // authored roles, so a Tailwind default like a red ramp can never ride in.
  const scaleLeak = css.match(
    /--(?:color-(?!(?:background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring|success|warning|info)\b)|spacing-|leading-|tracking-|text-(?!xs\b|sm\b|base\b|xl\b|[2345]xl\b)|font-(?:weight-(?!normal\b|medium\b|semibold\b|bold\b|extrabold\b|black\b)|size)|radius-(?:sm\b|[345]xl\b)|container-|breakpoint-|ease-|animate-)/i,
  );
  expect(scaleLeak, 'no unauthored Tailwind default-scale variable may appear').toEqual(null);
});

test('the @theme role block stays custom-properties-only (no structural fallback)', async () => {
  const css = await themeSheetCss();
  // The pre-C1 sheet carried a :host structural fallback (display/contain);
  // it died with that sheet and every component owns its :host display rule.
  // The compiled role block must stay custom-properties-only: a display or
  // containment declaration here would land on <html> at document adoption
  // or hijack host layout at shadow adoption.
  const layerBlock = css.slice(css.indexOf('@layer theme'), css.indexOf('html[data-theme="dark"]'));
  expect(layerBlock.length > 0, 'the layer block must be extractable').toEqual(true);
  expect(layerBlock.includes('display:'), 'no display declaration in the role block').toEqual(
    false,
  );
  expect(layerBlock.includes('contain:'), 'no containment declaration in the role block').toEqual(
    false,
  );
});

test('@theme carries the runtime primitives the component tier resolves', async () => {
  const css = await themeSheetCss();
  // Component CSS consumes these through var()/calc() — a bare page without
  // an app-tier sheet must still render OE components (alpha9 C1 step 2).
  for (const primitive of [
    '--spacing: 0.25rem',
    '--radius-md: 0.375rem',
    '--radius-lg: 0.5rem',
    '--radius-xl: 0.75rem',
    '--text-xs: 0.75rem',
    '--text-sm: 0.875rem',
    '--text-base: 1rem',
    '--font-weight-medium: 500',
    '--font-weight-semibold: 600',
    '--font-weight-bold: 700',
    '--font-sans:',
    '--font-mono:',
    '--font-serif:',
  ]) {
    expect(css.includes(primitive), `${primitive} must ship for the component tier`).toEqual(true);
  }
});

test('@theme forced-colors tier mirrors the dark union so system colors win in dark', async () => {
  const css = await themeSheetCss();
  expect(css.includes('@media (forced-colors: active)')).toEqual(true);
  const tier = css.slice(css.indexOf('@media (forced-colors: active)'));
  // The selector list must carry the dark union alongside :root/:host: with
  // only :root/:host, html[data-theme="dark"] (0,1,1) outranks the tier
  // (0,1,0) and would keep the author palette alive under forced colors.
  for (const selector of ['html[data-theme="dark"]', '.dark', ':host([data-theme="dark"])']) {
    expect(tier.includes(selector), `forced-colors tier must mirror ${selector}`).toEqual(true);
  }
  for (const systemColor of ['Canvas', 'CanvasText', 'ButtonText', 'GrayText', 'Highlight']) {
    expect(tier.includes(systemColor), `system color ${systemColor} must be present`).toEqual(true);
  }
});

test('the @theme module surface stays minimal', async () => {
  // One export only: the compiled sheet. (File-level absence of the retired
  // token module is enforced repo-wide by the retired-token-surface gate.)
  const mod = await import('../src/theme-tokens.ts');
  expect(Object.keys(mod).sort()).toEqual(['themeTokenSheet']);
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

/** hsl(H S% L%) → #rrggbb (the sheet's role values are hsl triplets). */
function hslToHex(hsl: string): string {
  const match = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/.exec(hsl);
  expect(match !== null, `expected an hsl() triplet, got ${hsl}`).toEqual(true);
  const hue = Number(match![1]) / 360;
  const sat = Number(match![2]) / 100;
  const light = Number(match![3]) / 100;
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const tint = (t: number): number => {
    let shifted = t;
    if (shifted < 0) shifted += 1;
    if (shifted > 1) shifted -= 1;
    if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
    if (shifted < 1 / 2) return q;
    if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
    return p;
  };
  const rgb = [tint(hue + 1 / 3), tint(hue), tint(hue - 1 / 3)].map((v) => Math.round(v * 255));
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

test('focus ring clears the WCAG 1.4.11 3:1 floor in both themes', async () => {
  const { themeTokenSheet } = await import('../src/theme-tokens.ts');
  const css = themeTokenSheet.cssRules.map((rule) => rule.cssText).join('\n');
  const declaration = (name: string, from = 0): string | undefined =>
    new RegExp(`${name}:\\s*([^;]+);`).exec(css.slice(from))?.[1]?.trim();
  const darkStart = css.indexOf(':host([data-theme="dark"])');
  expect(darkStart > 0, 'the generated sheet must carry a dark block').toEqual(true);

  const lightRing = hslToHex(declaration('--color-ring') ?? '');
  for (const surface of ['#ffffff', '#f8f9fa', '#f6f4fb']) {
    const ratio = contrast(lightRing, surface);
    expect(ratio >= 3, `light ring ${lightRing} vs ${surface} = ${ratio.toFixed(2)}:1`).toEqual(
      true,
    );
  }

  const darkRing = hslToHex(declaration('--color-ring', darkStart) ?? '');
  const darkBase = hslToHex(declaration('--color-background', darkStart) ?? '');
  expect(
    contrast(darkRing, darkBase) >= 3,
    `dark ring ${darkRing} vs ${darkBase} = ${contrast(darkRing, darkBase).toFixed(2)}:1`,
  ).toEqual(true);
});

test('state inks clear the 4.5:1 AA floor on --color-background and their wash', async () => {
  const { themeTokenSheet } = await import('../src/theme-tokens.ts');
  const css = themeTokenSheet.cssRules.map((rule) => rule.cssText).join('\n');
  const declaration = (name: string, from = 0): string | undefined =>
    new RegExp(`${name}:\\s*([^;]+);`).exec(css.slice(from))?.[1]?.trim();
  const darkStart = css.indexOf(':host([data-theme="dark"])');

  const composite = (rgba: string, over: string): string => {
    const match = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/.exec(rgba);
    expect(match !== null, `expected an rgba() subtle wash, got ${rgba}`).toEqual(true);
    const [, r, g, b, a] = match!;
    const alpha = Number(a);
    const base = [1, 3, 5].map((i) => Number.parseInt(over.slice(i, i + 2), 16));
    const ink = [r, g, b].map(Number);
    const mixed = base.map((channelValue, i) =>
      Math.round(ink[i] * alpha + channelValue * (1 - alpha)),
    );
    return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  };

  for (const from of [0, darkStart]) {
    const base = hslToHex(declaration('--color-background', from) ?? '');
    for (const tone of ['success', 'warning', 'error', 'info']) {
      const varName = tone === 'error' ? '--color-destructive' : `--color-${tone}`;
      const washName = tone === 'error' ? '--color-destructive-subtle' : `--color-${tone}-subtle`;
      const ink = declaration(varName, from) ?? '';
      const subtle = declaration(washName, from) ?? '';
      expect(/^#[0-9a-f]{6}$/i.test(ink), `${tone} ink resolves to ${ink}`).toEqual(true);
      const onBase = contrast(ink, base);
      expect(onBase >= 4.5, `${tone} on base = ${onBase.toFixed(2)}:1`).toEqual(true);
      const wash = composite(subtle, base);
      const onWash = contrast(ink, wash);
      expect(onWash >= 4.5, `${tone} on its wash ${wash} = ${onWash.toFixed(2)}:1`).toEqual(true);
    }
  }
});
