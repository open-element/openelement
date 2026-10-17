/**
 * @openelement/ui customization-surface guard (alpha9 C3, #1506).
 *
 * The package's customization contract — ::part names and the CSS custom
 * properties the recipes consume — is a declared semver surface: it may grow,
 * never shrink. Two baselines are pinned here:
 *
 * - ALPHA8_PARTS: the ::part sets shipped in 1.0.0-alpha.8 (read from git
 *   history when this guard was written). The structural surface never
 *   regressed against it and never may.
 * - PINNED_* : the C3 role-direct baseline. The C1 alias layer was deleted
 *   wholesale (its own DELETION CONDITION, fired by C3), so the var surface
 *   is pinned as role names — any recipe edit that adds or drops a var()
 *   reference fails here until the pin and CUSTOMIZATION.md are updated
 *   deliberately.
 *
 * CUSTOMIZATION.md must document exactly the pinned surface: the doc-coverage
 * test fails on drift in either direction, so the published document cannot
 * silently lag the code.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

const { manifest } = await import('../src/index.ts');

/** ::part sets shipped in 1.0.0-alpha.8 (origin/main at the C3 cut). */
const ALPHA8_PARTS: Record<string, string[]> = {
  'open-card': ['container', 'body'],
  'open-callout': ['container', 'icon', 'content'],
  'open-button': ['control'],
  'open-input': ['wrapper', 'label', 'control', 'error'],
  'open-theme-toggle': ['toggle', 'icon-sun', 'icon-moon'],
  'open-code-block': ['copy'],
  'open-badge': ['badge'],
  'open-dialog': ['overlay', 'header', 'close', 'body', 'footer'],
  'open-dropdown': ['trigger', 'content'],
  'open-tabs': [],
};

/** The pinned part baseline (deliberate-edit to change): the alpha8 part
 * sets of the components the package still ships. The retired alpha8
 * components (open-card, open-callout, open-badge, open-tabs) left the pin
 * in the same change that removed them from the package and from
 * CUSTOMIZATION.md; ALPHA8_PARTS keeps the full historical set above. */
const PINNED_PARTS: Record<string, string[]> = Object.fromEntries(
  Object.entries(ALPHA8_PARTS).filter(([tag]) =>
    manifest.declarations.some((decl) => decl.tagName === tag),
  ),
);

const PINNED_VARS: Record<string, string[]> = {
  // alpha15 S lane: the base treatment (layout, typography, radius, cursor,
  // white-space), the focus ring and the disabled/aria-disabled states are
  // Tailwind utilities on the control, so this pin tracks what the authored
  // sheet still consumes — the host box, the size/variant surfaces
  // (host-attribute scoped), the derived base surface and the
  // form-associated disabled state.
  'open-button': [
    '--color-border',
    '--color-foreground',
    '--color-popover',
    '--color-primary',
    '--color-primary-foreground',
    '--color-violet-400',
    '--color-white',
    '--default-transition-duration',
    '--ease-out',
    '--shadow-sm',
    '--spacing',
    '--text-base',
    '--text-sm',
    '--text-xl',
  ],
  // alpha15 S lane: the wrapper layout, the label's typography, the control's
  // box and the error message's ink are utilities, so the sheet keeps only the
  // host box, the control's derived surfaces (the popover/border mixes, the
  // violet hover border, the focus ring's box-shadow) and the disabled/invalid
  // treatments scoped to the host's form state.
  'open-input': [
    '--color-border',
    '--color-destructive',
    '--color-muted',
    '--color-popover',
    '--color-primary',
    '--color-violet-400',
    '--spacing',
  ],
  // alpha15 S lane (owner decision, supersedes the no-utility-class ruling):
  // component presentation is authored as Tailwind utilities wherever a class
  // utility can express it — the shadow component stylesheet delivers them —
  // so this pin tracks what the authored sheet still consumes directly. Only
  // what a class utility cannot express stays in the sheet: host boxes,
  // :host()/:state()/attribute-scoped rules, and the derived two-colour
  // surfaces.
  'open-theme-toggle': [
    '--color-background',
    '--color-border',
    '--color-popover',
    '--color-primary',
    '--color-violet-400',
    '--spacing',
  ],
  // #1552 shrank open-code-block to the copy chip: the code surface and the
  // token inks moved to the host's build-time highlight pipeline + stylesheet.
  // The alpha15 S lane moved the chip's presentation to utilities, so the sheet
  // now consumes only the two status roles its :state() feedback paints.
  'open-code-block': ['--color-destructive', '--color-success'],
  // alpha15 S lane: the dialog box and the header/title/close/body/footer
  // presentation are utilities, so this pin tracks the sheet's retained rules —
  // the host box, the trigger slot, the native top-layer presentation and the
  // derived frame/scrim/close-hover surfaces.
  'open-dialog': [
    '--color-border',
    '--color-foreground',
    '--color-popover',
    '--color-primary',
    '--color-white',
    '--color-zinc-950',
    '--shadow-2xl',
    '--spacing',
  ],
  // The trigger's display and the content's min-width/padding/font moved to
  // utilities (alpha15 S lane); the sheet keeps the anchor-positioning block,
  // whose margin consumes --spacing.
  'open-dropdown': ['--spacing'],
  'component-recipes': [
    '--color-border',
    '--color-card',
    '--color-foreground',
    '--color-popover',
    '--color-primary',
    '--color-white',
    '--radius-lg',
    '--radius-xl',
    '--shadow-2xl',
    '--spacing',
  ],
};

/** ::part names a component source actually exposes (JSX part= + @csspart). */
const actualParts = (source: string): string[] => {
  const names = new Set<string>();
  for (const m of source.matchAll(/\bpart=['"]([^'"]+)['"]/g)) {
    for (const name of m[1]!.trim().split(/\s+/)) if (name) names.add(name);
  }
  return [...names].sort();
};

/** var() names a component source actually consumes. */
const actualVars = (source: string): string[] => {
  const names = new Set<string>();
  for (const m of source.matchAll(/var\(\s*--([a-zA-Z0-9-]+)/g)) names.add(`--${m[1]}`);
  return [...names].sort();
};

/** The component's authored surface: the TSX (markup/parts) plus its sheet
 * file — since #1558 the styles live in the component's own .css file. */
const sourceOf = async (tag: string): Promise<string> => {
  const tsx = await readFile(new URL(`../src/${tag}.tsx`, import.meta.url), 'utf8');
  try {
    const css = await readFile(new URL(`../src/${tag}.css`, import.meta.url), 'utf8');
    return `${tsx}\n${css}`;
  } catch {
    return tsx;
  }
};

// The shared recipe sheets still shipped: the control recipe retired with the
// alpha15 utility migration (its surface is utilities plus each component's own
// irreducible residue), so its vars moved into the components' own pins.
const recipesSource = (
  await Promise.all(
    ['surface-recipe.css', 'overlay-recipe.css'].map((file) =>
      readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'),
    ),
  )
).join('\n');

test('every declared ::part set matches the pin and never shrinks against alpha8', async () => {
  for (const decl of manifest.declarations) {
    const actual = actualParts(await sourceOf(decl.tagName));
    const declared = (decl.cssParts ?? []).map((p) => p.name).sort();
    expect(declared, `${decl.tagName} manifest parts`).toEqual(actual);
    expect(new Set(actual), `${decl.tagName} pinned parts`).toEqual(
      new Set(PINNED_PARTS[decl.tagName] ?? []),
    );
    for (const part of ALPHA8_PARTS[decl.tagName] ?? []) {
      expect(actual, `${decl.tagName} must keep alpha8 part '${part}'`).toContain(part);
    }
  }
});

test('every consumed var() set matches the C3 role-direct pin', async () => {
  for (const decl of manifest.declarations) {
    const actual = actualVars(await sourceOf(decl.tagName));
    expect(actual, `${decl.tagName} consumed vars`).toEqual(PINNED_VARS[decl.tagName]);
  }
  expect(actualVars(recipesSource), 'component-recipes consumed vars').toEqual(
    PINNED_VARS['component-recipes'],
  );
});

/**
 * A colour written as a literal instead of read from a role. Declaration
 * sites only, so an issue number in a prose comment (`#757`) never matches.
 */
const RAW_COLOUR =
  /(?:color|background(?:-color)?|border(?:-[a-z]+)?|fill|stroke|box-shadow|outline(?:-color)?)\s*:\s*[^;{}]*?(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\()/gi;

test('component styling reads the role table, never a raw colour literal', async () => {
  // Owner decision (alpha15 S lane, supersedes 'recipes carry no utility-class
  // vocabulary'): presentation may be authored as Tailwind utilities — the
  // shadow component stylesheet is what delivers them — but the COLOUR axis
  // still belongs to the role table. A utility built from a role
  // (`bg-primary/14` → color-mix on --color-primary) keeps the light / dark /
  // forced-colors seats that theme.css guarantees; a literal escapes all three,
  // so it fails here.
  for (const decl of [...manifest.declarations.map((d) => d.tagName), 'component-recipes']) {
    const source = decl === 'component-recipes' ? recipesSource : await sourceOf(decl);
    expect(source.match(RAW_COLOUR) ?? [], `${decl} must not carry raw colour literals`).toEqual(
      [],
    );
  }
});

test('CUSTOMIZATION.md documents exactly the pinned surface', async () => {
  const doc = await readFile(new URL('../CUSTOMIZATION.md', import.meta.url), 'utf8');
  for (const [tag, parts] of Object.entries(PINNED_PARTS)) {
    expect(doc.includes(`\`${tag}\``), `doc must cover ${tag}`).toEqual(true);
    for (const part of parts) {
      expect(
        doc.includes(`::part(${part})`) || doc.includes(`\`${part}\``),
        `doc must list ${tag} part ${part}`,
      ).toEqual(true);
    }
  }
  for (const [tag, vars] of Object.entries(PINNED_VARS)) {
    for (const name of vars) {
      expect(doc.includes(`\`${name}\``), `doc must list ${tag} var ${name}`).toEqual(true);
    }
  }
});

/* ─── the internal hook contract: the sheet and the markup spell alike ───────
   A component's sheet is adopted INSIDE its own shadow root, so a class
   selector it carries is only live if the component's own markup puts that
   class on an element. When only one side of the pair is renamed the rule dies
   silently — the build succeeds, the sheet still ships, and the element just
   loses its rule. That is the alpha15 S-lane defect this guard exists for:
   open-input.css selected `.control` while the markup said `input`, so the
   control's resting surface, hover border, focus ring and disabled treatment
   all became dead CSS (and with `outline-none` in the class list, the focus
   ring was the ONLY focus affordance left). */

/**
 * The class selectors a sheet selects: comments stripped, and only the text
 * before each `{` is read, so declaration values (`0.25rem`, `url(a.png)`)
 * can never be mistaken for selectors.
 */
const classSelectorsOf = (css: string): Set<string> => {
  const names = new Set<string>();
  const chunks = css.replace(/\/\*[\s\S]*?\*\//g, '').split('{');
  for (const chunk of chunks.slice(0, -1)) {
    const selector = chunk.slice(chunk.lastIndexOf('}') + 1);
    for (const match of selector.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) {
      names.add(match[1]!);
    }
  }
  return names;
};

/**
 * The static class tokens a component's markup carries. Fail closed on a
 * dynamic binding: `class={…}` puts tokens beyond static analysis, so this
 * guard would silently lose its meaning rather than report a defect.
 */
const classTokensOf = (tsx: string, tag: string): Set<string> => {
  const tokens = new Set<string>();
  let staticBindings = 0;
  for (const match of tsx.matchAll(/\bclass=(?:'([^']*)'|"([^"]*)")/g)) {
    staticBindings++;
    for (const token of (match[1] ?? match[2] ?? '').split(/\s+/)) {
      if (token !== '') tokens.add(token);
    }
  }
  const anyBinding = (tsx.match(/\bclass=/g) ?? []).length;
  expect(
    staticBindings,
    `${tag}.tsx carries ${anyBinding - staticBindings} non-literal class binding(s); the hook ` +
      'guard can only decide literal class attributes',
  ).toEqual(anyBinding);
  return tokens;
};

test('every class hook a component sheet selects is carried by its own markup', async () => {
  for (const decl of manifest.declarations) {
    const tag = decl.tagName;
    const tsx = await readFile(new URL(`../src/${tag}.tsx`, import.meta.url), 'utf8');
    const css = await readFile(new URL(`../src/${tag}.css`, import.meta.url), 'utf8');
    const tokens = classTokensOf(tsx, tag);
    for (const hook of classSelectorsOf(css)) {
      expect(
        tokens.has(hook),
        `${tag}.css selects .${hook}, but no literal class token in ${tag}.tsx carries it — ` +
          'the rule is dead inside the shadow root',
      ).toEqual(true);
    }
  }
});
