import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

const themeCss = await readFile(new URL('../src/theme.css', import.meta.url), 'utf8');
const { themeTokenCss, themeTokenSheet } = await import('../src/theme-tokens.ts');

// The installed Tailwind theme.css is the scale authority since the C2
// handoff (#1505): the @theme source and the compiled twin reference the
// default ramps by name, and the installed 4.3.x line owns their values.
const tailwindScaleCss = await readFile(
  new URL('../node_modules/tailwindcss/theme.css', import.meta.url),
  'utf8',
);

// Token lookups run over comment-stripped code: doc comments legitimately
// spell selectors like :root[data-theme='dark'], and the dark-block search
// must land on the rule, not the prose.
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const themeCode = stripComments(themeCss);
const twinCode = stripComments(themeTokenCss);
const scaleCode = stripComments(tailwindScaleCss);

const DARK_SELECTOR = ":root[data-theme='dark']";
const themeDark = themeCode.indexOf(DARK_SELECTOR);
const twinDark = twinCode.indexOf(DARK_SELECTOR);

/** Collect every `--name: value` declaration in a comment-stripped span. */
const declarationsOf = (css: string, from = 0, to = css.length): Map<string, string> => {
  const found = new Map<string, string>();
  for (const match of css.slice(from, to).matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (!found.has(match[1]!)) found.set(match[1]!, match[2]!.trim());
  }
  return found;
};

/** The @theme block's role declarations (the migration contract's source). */
const themeRoleSpan = (): [number, number] => {
  const start = themeCode.indexOf('@theme');
  const open = themeCode.indexOf('{', start);
  const close = themeCode.indexOf('}', open);
  return [open + 1, close];
};

test('the @theme source and the compiled twin agree on the role contract', () => {
  // C2 handoff: role names (and their values) are the migration contract
  // between the real @theme source and the compiled plain-CSS twin — not the
  // byte-identity that pre-C2 drift gate pinned, because the two forms now
  // legitimately differ in selector shape (@theme vs :root,:host) and in the
  // scale layer (the twin freezes the v4.1.16 evaluation for the OFF
  // baseline; the @theme source rides the installed Tailwind defaults).
  const sourceRoles = declarationsOf(themeCode, ...themeRoleSpan());
  expect(sourceRoles.size).toBeGreaterThan(0);
  const twinFirstRoot = twinCode.match(/:root,\s*:host\s*\{([^}]*)\}/)?.[1] ?? '';
  const twinRoles = declarationsOf(twinFirstRoot);
  for (const [name, value] of sourceRoles) {
    expect(
      twinRoles.get(name),
      `@theme role ${name} must be declared identically in the compiled twin`,
    ).toEqual(value);
  }
  // Dark pairs: both forms re-declare the same roles with the same values.
  const sourceDark = declarationsOf(themeCode, themeDark);
  const twinDarkRoles = declarationsOf(twinCode, twinDark);
  expect(sourceDark.size).toBeGreaterThan(0);
  for (const [name, value] of sourceDark) {
    expect(
      twinDarkRoles.get(name),
      `dark pair ${name} must be declared identically in the compiled twin`,
    ).toEqual(value);
  }
});

test('token layer exposes the shadcn role table (the C3 single sheet)', () => {
  expect(themeTokenSheet).toEqual(expect.anything());
  const css = themeTokenCss;
  for (const token of [
    '--color-background',
    '--color-primary',
    '--color-destructive',
    '--color-success',
    '--color-warning',
    '--color-info',
    '--radius-md',
    '--spacing',
  ]) {
    expect(css.includes(token), `${token} must be part of the role contract`).toEqual(true);
  }
});

test('the C1 alias layer stays deleted — no retired name anywhere in the package', async () => {
  // C1's DELETION CONDITION (semantic-tokens.css header) fired in C3 #1506:
  // the file, its exports-map entry and every retired var() reference are
  // gone. A re-introduction fails here before any consumer can regress.
  await expect(readFile(new URL('../src/semantic-tokens.css', import.meta.url))).rejects.toThrow();
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  expect(pkg.exports['./semantic-tokens.css']).toBeUndefined();
  const retired = [
    '--bg-base',
    '--bg-surface',
    '--bg-card',
    '--bg-elevated',
    '--bg-muted',
    '--bg-hover',
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    '--brand',
    '--on-brand',
    '--focus-ring',
    '--bg-code',
    '--code-text',
    '--code-border',
    '--surface-glass',
    '--surface-overlay',
    '--ui-control-bg',
    '--size-4',
    '--radius-2',
    '--font-size-1',
    '--font-weight-7',
    '--motion-fast',
    '--violet-5',
    '--gray-11',
  ];
  expect(themeTokenCss.includes('--brand:'), 'the carrier must not define alias names').toEqual(
    false,
  );
  for (const file of [
    '../src/component-recipes.ts',
    '../src/open-badge.tsx',
    '../src/open-button.tsx',
    '../src/open-callout.tsx',
    '../src/open-card.tsx',
    '../src/open-code-block.tsx',
    '../src/open-dialog.tsx',
    '../src/open-dropdown.tsx',
    '../src/open-input.tsx',
    '../src/open-tabs.tsx',
    '../src/open-theme-toggle.tsx',
  ]) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    for (const name of retired) {
      expect(source.includes(`var(${name}`), `${file} must not reference ${name}`).toEqual(false);
    }
  }
});

test('one token sheet serves document and shadow adoption', () => {
  const css = themeTokenCss;
  // The token blocks are dual: :root for document adoption, :host for shadow
  // adoption. There is no separate transformed sheet and no transformer.
  expect(/:root,\s+:host/.test(css), 'token blocks must select :root, :host').toEqual(true);
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

test('retired token exports stay gone', async () => {
  const mod = await import('../src/theme-tokens.ts');
  expect('openPropsRootSheet' in mod).toBeFalsy();
  expect('toRootCss' in mod).toBeFalsy();
  expect('openPropsTokenSheet' in mod).toBeFalsy();
  expect('ALIAS_CSS' in mod).toBeFalsy();
  const index = await import('../src/index.ts');
  expect('openPropsTokenSheet' in index).toBeFalsy();
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

/* ─── forced-colors: every role re-seats on a system color ────────────────
   The Windows-high-contrast contract (#1506 C3): the @media (forced-colors:
   active) tier must re-seat EVERY role the light/dark blocks declare, in
   both selector blocks, and no author color literal may survive there. The
   component recipes consume only role names, so a total role re-seat is a
   total component re-seat — asserted compositionally below (per-browser
   visual capture lives with the e2e suites). */

const FORCED_SYSTEM_COLORS = new Set([
  'Canvas',
  'CanvasText',
  'ButtonFace',
  'ButtonText',
  'GrayText',
  'Highlight',
  'LinkText',
  'Mark',
]);

const forcedSpan = (css: string): string => {
  const marker = '@media (forced-colors: active)';
  const at = css.indexOf(marker);
  expect(at >= 0, 'a forced-colors tier must exist').toEqual(true);
  const open = css.indexOf('{', at);
  // The media body runs to the matching close of its single wrapper brace.
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  return css.slice(open + 1, end);
};

/** Split a forced tier into its light (:root) and dark (re-pointed) halves. */
const forcedHalves = (css: string): { light: Map<string, string>; dark: Map<string, string> } => {
  const span = forcedSpan(css);
  const darkAt = span.indexOf(DARK_SELECTOR);
  expect(darkAt > 0, 'the forced tier must carry a dark block').toEqual(true);
  return {
    light: declarationsOf(span, 0, darkAt),
    dark: declarationsOf(span, darkAt),
  };
};

test('every role has a light, dark and forced-colors seat (forced tier is total)', () => {
  const roles = [...declarationsOf(themeCode, ...themeRoleSpan()).keys()];
  expect(roles.length).toBeGreaterThan(20);
  const darkRoles = declarationsOf(themeCode, themeDark);
  const themeForced = forcedHalves(themeCode);
  const twinForced = forcedHalves(twinCode);
  for (const role of roles) {
    expect(darkRoles.has(role), `dark block must re-declare ${role}`).toEqual(true);
    expect(themeForced.light.has(role), `forced-colors must re-seat ${role} (light block)`).toEqual(
      true,
    );
    expect(themeForced.dark.has(role), `forced-colors must re-seat ${role} (dark block)`).toEqual(
      true,
    );
    for (const [half, value] of [
      ['light', themeForced.light.get(role)!],
      ['dark', themeForced.dark.get(role)!],
    ] as const) {
      expect(
        FORCED_SYSTEM_COLORS.has(value),
        `${role} forced ${half} value must be a system color, got ${value}`,
      ).toEqual(true);
    }
    // The compiled twin mirrors the tier (preset-OFF consumers get the same
    // forced-colors behavior).
    expect(twinForced.light.get(role), `twin forced light must carry ${role}`).toEqual(
      themeForced.light.get(role),
    );
    expect(twinForced.dark.get(role), `twin forced dark must carry ${role}`).toEqual(
      themeForced.dark.get(role),
    );
  }
});

test('component recipes consume only declared roles', async () => {
  const roles = new Set([
    ...declarationsOf(themeCode, ...themeRoleSpan()).keys(),
    ...declarationsOf(scaleCode).keys(),
  ]);
  const files = [
    'component-recipes.ts',
    'open-badge.tsx',
    'open-button.tsx',
    'open-callout.tsx',
    'open-card.tsx',
    'open-code-block.tsx',
    'open-dialog.tsx',
    'open-dropdown.tsx',
    'open-input.tsx',
    'open-tabs.tsx',
    'open-theme-toggle.tsx',
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
    const code = stripComments(source);
    for (const match of code.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
      expect(
        roles.has(match[1]!),
        `${file} references ${match[1]}, which no theme block declares`,
      ).toEqual(true);
    }
  }
});

/* ─── color resolution + WCAG math over the role sources ───────────────── */

/** oklch(L% C H) → gamma-encoded sRGB [0..1] (OKLab → LMS → linear sRGB). */
function oklchToRgb(LPercent: number, C: number, H: number): Rgb {
  const L = LPercent / 100;
  const h = (H * Math.PI) / 180;
  const l_ = L + 0.3963377774 * C * Math.cos(h) + 0.2158037573 * C * Math.sin(h);
  const m_ = L - 0.1055613458 * C * Math.cos(h) - 0.0638541728 * C * Math.sin(h);
  const s_ = L - 0.0894841775 * C * Math.cos(h) - 1.291485548 * C * Math.sin(h);
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const gam = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.min(1, Math.max(0, gam(c)))) as Rgb;
}

type Rgb = [number, number, number];

const parseColor = (value: string): Rgb | undefined => {
  // The installed 4.3.x line spells achromatic hues as `none` (zinc-50 …):
  // chroma 0 makes the hue component moot, so treat `none` as 0.
  const oklch = /^oklch\((\d+(?:\.\d+)?)%\s+([\d.]+)\s+(-?[\d.]+|none)\)$/.exec(value);
  if (oklch)
    return oklchToRgb(
      Number(oklch[1]),
      Number(oklch[2]),
      oklch[3] === 'none' ? 0 : Number(oklch[3]),
    );
  const hex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (hex) {
    const [r, g, b] = [1, 2, 3].map((i) => Number.parseInt(hex[i]! + hex[i]!, 16) / 255);
    return [r, g, b];
  }
  return undefined;
};

/** Relative luminance / contrast ratio (WCAG 2.x) over linearized sRGB. */
const channel = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (rgb: Rgb): number =>
  0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const compositeWash = (ink: Rgb, alpha: number, over: Rgb): Rgb =>
  ink.map((c, i) => c * alpha + over[i] * (1 - alpha)) as Rgb;

const declaration = (css: string, name: string, from = 0): string | undefined =>
  new RegExp(`${name}:\\s*([^;]+);`).exec(css.slice(from))?.[1]?.trim();

/**
 * Follow a var() chain to a literal. Role lookups hit the dark block first,
 * then the @theme source, then the installed Tailwind scale — the ramps'
 * value authority since the C2 handoff (the @theme source references them
 * by name only).
 */
const lookupToken = (name: string, dark: boolean): string | undefined =>
  (dark && themeDark > 0 ? declaration(themeCode, name, themeDark) : undefined) ??
  declaration(themeCode, name, 0) ??
  declaration(scaleCode, name, 0);

const resolveToken = (name: string, dark: boolean): string => {
  let value = lookupToken(name, dark) ?? '';
  for (let hop = 0; hop < 8; hop += 1) {
    const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (!alias) break;
    const next = lookupToken(alias[1]!, dark);
    if (next === undefined) break;
    value = next;
  }
  return value;
};

const resolveColor = (name: string, dark: boolean): Rgb => {
  const value = resolveToken(name, dark);
  const color = parseColor(value);
  expect(
    color !== undefined,
    `${name} (dark=${dark}) must resolve to a color, got ${value}`,
  ).toEqual(true);
  return color!;
};

const surface = (dark: boolean): { name: string; rgb: Rgb }[] =>
  ['--color-background', '--color-card', '--color-muted'].map((name) => ({
    name,
    rgb: resolveColor(name, dark),
  }));

test('focus ring clears the WCAG 1.4.11 3:1 floor in both themes', () => {
  for (const dark of [false, true]) {
    const ring = resolveColor('--color-ring', dark);
    for (const { name, rgb } of surface(dark)) {
      const ratio = contrast(ring, rgb);
      expect(
        ratio >= 3,
        `${dark ? 'dark' : 'light'} ring vs ${name} = ${ratio.toFixed(2)}:1`,
      ).toEqual(true);
    }
  }
});

test('status role inks clear the 4.5:1 AA floor on the background and their recipe wash', async () => {
  // The 10% wash now lives where it is painted: open-badge washes the three
  // positive/negative tones, open-callout washes destructive (its danger
  // type). Parse the percentages from those recipes so the math can never
  // drift from what ships.
  const badge = stripComments(
    await readFile(new URL('../src/open-badge.tsx', import.meta.url), 'utf8'),
  );
  const callout = stripComments(
    await readFile(new URL('../src/open-callout.tsx', import.meta.url), 'utf8'),
  );
  const washOf = (role: string): { source: string; percent: number } => {
    const re = new RegExp(
      `color-mix\\(in srgb,\\s*var\\(${role}\\)\\s*([\\d.]+)%,\\s*transparent\\)`,
    );
    const hit = re.exec(role === '--color-destructive' ? callout : badge);
    expect(hit, `${role} must have a recipe wash`).toBeTruthy();
    return { source: role, percent: Number(hit![1]) };
  };
  for (const dark of [false, true]) {
    for (const role of [
      '--color-destructive',
      '--color-success',
      '--color-warning',
      '--color-info',
    ]) {
      const ink = resolveColor(role, dark);
      const bg = resolveColor('--color-background', dark);
      const onBase = contrast(ink, bg);
      expect(
        onBase >= 4.5,
        `${dark ? 'dark' : 'light'} ${role} on base = ${onBase.toFixed(2)}:1`,
      ).toEqual(true);
      const { percent } = washOf(role);
      const onWash = contrast(ink, compositeWash(ink, percent / 100, bg));
      expect(
        onWash >= 4.5,
        `${dark ? 'dark' : 'light'} ${role} on its ${percent}% wash = ${onWash.toFixed(2)}:1`,
      ).toEqual(true);
    }
  }
});

test('open-dialog opens and exits through discrete transitions, not keyframes', async () => {
  // The #536/#591 recipe: the closed state is the base rule, entry starts
  // from @starting-style, and the display/overlay legs carry allow-discrete
  // so the dialog stays rendered and in the top layer until the exit
  // transition finishes. Textual assertions — the fake-DOM harness cannot
  // run transitions.
  const source = await readFile(new URL('../src/open-dialog.tsx', import.meta.url), 'utf8');
  const code = stripComments(source);
  expect(code.includes('allow-discrete'), 'the display/overlay legs must defer discretely');
  expect(code.match(/allow-discrete/gu)?.length).toBeGreaterThanOrEqual(4);
  expect(code.includes('@starting-style'), 'entry must start from the starting-style block');
  expect(code.includes('transition-behavior: allow-discrete') || /allow-discrete/.test(code)).toBe(
    true,
  );
  // The scrim fades both ways: closed backdrop is transparent, [open] carries
  // the zinc-950 scrim.
  expect(code.includes('backdrop-filter: blur(8px)')).toBe(true);
  // The keyframe entry is retired wholesale — no dead channel may remain.
  expect(code.includes('@keyframes'), 'the old keyframe entry must be gone').toBe(false);
  expect(code.includes('animation:')).toBe(false);
  // Graceful degradation: forced colors and reduced motion collapse the
  // transitions so the dialog never fights the system-owned rendering.
  expect(code.includes('@media (forced-colors: active)')).toBe(true);
  expect(code.includes('@media (prefers-reduced-motion: reduce)')).toBe(true);
  const forced = code.indexOf('@media (forced-colors: active)');
  expect(code.slice(forced, code.indexOf('}', code.indexOf('transition: none', forced)))).toContain(
    'transition: none',
  );
});
