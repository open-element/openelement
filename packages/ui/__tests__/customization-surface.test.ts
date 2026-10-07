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

/** The C3 role-direct baseline (pinned; deliberate-edit to change). */
const PINNED_PARTS: Record<string, string[]> = ALPHA8_PARTS;

const PINNED_VARS: Record<string, string[]> = {
  'open-card': [
    '--color-border',
    '--color-card',
    '--color-foreground',
    '--color-muted',
    '--color-muted-foreground',
    '--color-primary',
    '--color-secondary',
    '--color-zinc-200',
    '--color-zinc-700',
    '--color-zinc-950',
    '--default-transition-duration',
    '--ease-out',
    '--font-weight-semibold',
    '--radius-md',
    '--spacing',
    '--text-sm',
    '--text-xl',
  ],
  'open-callout': [
    '--color-destructive',
    '--color-foreground',
    '--color-muted-foreground',
    '--color-primary',
    '--color-success',
    '--color-warning',
    '--font-weight-semibold',
    '--leading-relaxed',
    '--radius-lg',
    '--spacing',
    '--text-base',
    '--text-sm',
  ],
  'open-button': [
    '--color-border',
    '--color-foreground',
    '--color-popover',
    '--color-primary',
    '--color-primary-foreground',
    '--color-ring',
    '--color-violet-400',
    '--color-white',
    '--default-transition-duration',
    '--ease-out',
    '--font-sans',
    '--font-weight-extrabold',
    '--radius-md',
    '--shadow-sm',
    '--spacing',
    '--text-base',
    '--text-sm',
    '--text-xl',
  ],
  'open-input': [
    '--color-border',
    '--color-destructive',
    '--color-foreground',
    '--color-muted',
    '--color-muted-foreground',
    '--color-popover',
    '--color-primary',
    '--color-violet-400',
    '--font-sans',
    '--font-weight-medium',
    '--radius-md',
    '--spacing',
    '--text-base',
    '--text-sm',
    '--text-xs',
    '--tracking-normal',
  ],
  'open-theme-toggle': [
    '--color-background',
    '--color-border',
    '--color-foreground',
    '--color-muted-foreground',
    '--color-popover',
    '--color-primary',
    '--color-ring',
    '--color-violet-400',
    '--default-transition-duration',
    '--ease-in-out',
    '--spacing',
  ],
  // #1552 shrank open-code-block to the copy chip: the code surface and the
  // token inks moved to the host's build-time highlight pipeline + stylesheet,
  // so the component's var surface contracted deliberately (pin + doc updated
  // together) and gained --color-foreground for the theme-aware chip ink.
  'open-code-block': [
    '--color-destructive',
    '--color-foreground',
    '--color-primary',
    '--default-transition-duration',
    '--ease-in-out',
    '--font-sans',
    '--font-weight-semibold',
    '--radius-md',
    '--spacing',
    '--text-xs',
    '--tracking-wider',
  ],
  'open-badge': [
    '--color-border',
    '--color-info',
    '--color-muted',
    '--color-muted-foreground',
    '--color-primary',
    '--color-success',
    '--color-warning',
    '--font-mono',
    '--font-weight-extrabold',
    '--leading-normal',
    '--radius-md',
    '--spacing',
    '--text-xs',
  ],
  'open-dialog': [
    '--color-border',
    '--color-foreground',
    '--color-muted-foreground',
    '--color-popover',
    '--color-primary',
    '--color-white',
    '--color-zinc-950',
    '--font-sans',
    '--font-weight-semibold',
    '--leading-normal',
    '--leading-tight',
    '--radius-md',
    '--radius-xl',
    '--shadow-2xl',
    '--spacing',
    '--text-base',
    '--text-xl',
  ],
  'open-dropdown': ['--font-sans', '--spacing'],
  'open-tabs': [
    '--color-border',
    '--color-foreground',
    '--color-muted-foreground',
    '--color-primary',
    '--spacing',
  ],
  'component-recipes': [
    '--color-border',
    '--color-card',
    '--color-foreground',
    '--color-popover',
    '--color-primary',
    '--color-ring',
    '--color-violet-400',
    '--color-white',
    '--default-transition-duration',
    '--ease-out',
    '--radius-lg',
    '--radius-md',
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

const sourceOf = (tag: string): Promise<string> =>
  readFile(new URL(`../src/${tag}.tsx`, import.meta.url), 'utf8');

const recipesSource = await readFile(
  new URL('../src/component-recipes.ts', import.meta.url),
  'utf8',
);

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

test('recipes carry no utility-class vocabulary', async () => {
  // Owner ruling: component internals never carry utility-class markers —
  // the role variables ARE the styling contract. A Tailwind utility token
  // (bg-…, text-…, rounded-… as literal values) inside a recipe fails here.
  for (const decl of manifest.declarations) {
    const source = await sourceOf(decl.tagName);
    expect(
      /class=['"][^'"]*\b(bg|text|border|rounded|p|m|gap|flex|grid)-[a-z0-9[\]./-]+/.test(source),
      `${decl.tagName} recipes must not embed utility classes`,
    ).toEqual(false);
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
