/**
 * site theme-token gate: theme values in the site must come from the
 * @theme role source (packages/ui/src/theme.css, delivered by the
 * @openelement/router Tailwind preset) or the site alias layer
 * (www/site-css.ts), never from hardcoded literals.
 *
 * Rules for sources under www/app/ (routes, islands, components):
 *  1. No hex color literals. 6/8-digit forms always fail; 3/4-digit forms
 *     fail only on lines carrying a CSS property keyword, so issue
 *     references like `#390` in prose stay legal.
 *  2. No `font-family` declarations that bypass var(); `inherit` is allowed.
 *  3. No `font-size` literals in px/rem/em outside var(); clamp() fluid
 *     typography is allowed.
 *
 * Rule 4 (site-ui sheets only): no bare Tailwind palette references —
 * `var(--color-zinc-200)`, `var(--color-red-700)`, `var(--color-white)`, ….
 * The role table's own scale citations (packages/ui/src/theme.css) are the
 * sanctioned second fact; component sheets must consume roles so a palette
 * re-tune lands without touching call sites. Role names are read from
 * theme.css itself (single source, P6), so a new role needs no checker edit.
 * Genuine exceptions go in BARE_PALETTE_ALLOWLIST with a reason.
 *
 * Token definitions belong in packages/ui/src/theme.css (the single role
 * source, consumed through the preset) or www/site-css.ts (site aliases).
 * The ui package itself emits no values — the retired theme-tokens twin is
 * not an acceptance source.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_BREAKPOINT_TIERS } from '../site-css.ts';
import { readdir, readFile } from 'node:fs/promises';
import process from 'node:process';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const SCAN_ROOTS = [join(repoRoot, 'www/app')];
const SOURCE = /\.(ts|tsx)$/;
const HEX_LONG = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const HEX_SHORT = /#(?:[0-9a-fA-F]{3,4})\b/;
const CSS_KEYWORD = /\b(?:color|background|border|shadow|fill|stroke|gradient|outline)\b/i;
const FONT_FAMILY = /font-family\s*:\s*([^;]+);/;
const FONT_SIZE_LITERAL = /font-size\s*:\s*[0-9.]+(?:px|rem|em)\b/;
// Bare-number @media viewport tiers, both axes (rem/ch/% layout measures
// and element-relative @container widths are not tiers and never match).
// Multi-query lines (@media (max-height:760px), (max-width:520px)) match
// every value: the @media presence is tested per line, values per match.
const MEDIA_LINE = /@media/;
const TIER_VALUE = /(?:max-width|max-height|min-width):\s*(\d+)(?![\d.])/g;
const TIERS = new Set<number>(SITE_BREAKPOINT_TIERS);
// Rule 4 scope: the site-ui sheets. Components under www/app/components/
// still carry bare palette refs (page-styles, page-home-styles, page-404-styles)
// and are a later migration, not this gate's round.
const SITE_UI_SEGMENT = '/site-ui/';
// `var(--color-<name>)` captures. Only the var() form is gated: a palette
// value consumed through var() is a live second fact; prose mentions are not.
const COLOR_REF = /var\(--color-([a-z0-9-]+)\)/g;
// Tailwind default palette hues (TW4). `white`/`black` ship shade-less and
// are caught by the same gate — they are palette values, not roles.
const TAILWIND_HUES = new Set([
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
]);
const SHADELESS_HUES = new Set(['white', 'black']);
// Role definitions only: a line-start `--color-<name>:` in theme.css.
// Mid-line `var(--color-…)` citations inside the table must not register.
const ROLE_DEFINITION = /^\s*--color-([a-z0-9-]+):/gm;

/**
 * Bare palette references that stay on purpose. Key: `<file>:<token>` with
 * the file relative to www/app/site-ui, value: the reason the reference
 * cannot move to a role token yet. Empty entries are deleted, not tolerated.
 */
export const BARE_PALETTE_ALLOWLIST: Readonly<Record<string, string>> = {
  // pre code ink sits on --surface-code, which is --color-zinc-950 in BOTH
  // themes (www/site-css.ts): the ink must be theme-invariant light. Every
  // light-ink role (--color-foreground, --color-card-foreground, …) flips
  // dark under data-theme="dark", so a role swap regresses. Leaves the
  // allowlist when a --surface-code-foreground alias exists in site-css.ts.
  'article-body.ts:--color-zinc-200':
    'theme-invariant light ink on the always-dark --surface-code; no role token is theme-invariant light',
  // Dialog scrim: must stay dark in both themes. The dark-in-light roles
  // (--color-foreground, --color-popover-foreground, …) flip light under
  // data-theme="dark", so a role swap regresses. Leaves the allowlist when a
  // --surface-scrim alias exists in site-css.ts (cf. --surface-code).
  'open-search-styles.ts:--color-zinc-950':
    'theme-invariant dark dialog scrim; no role token is theme-invariant dark',
};

/** Role color names from packages/ui/src/theme.css — the single role source. */
export async function loadRoleColorTokens(): Promise<Set<string>> {
  const text = await readFile(join(repoRoot, 'packages/ui/src/theme.css'), 'utf8');
  const roles = new Set<string>();
  for (const match of text.matchAll(ROLE_DEFINITION)) roles.add(match[1]);
  if (roles.size === 0) {
    throw new Error('no --color-* role definitions found in packages/ui/src/theme.css');
  }
  return roles;
}

export function findBarePaletteFailures(
  file: string,
  lines: string[],
  roleTokens: ReadonlySet<string>,
): ThemeTokenFailure[] {
  // Allowlist keys name the sheet relative to www/app/site-ui (flat dir).
  const sheet = file.slice(file.lastIndexOf('/') + 1);
  const failures: ThemeTokenFailure[] = [];
  for (let i = 0; i < lines.length; i++) {
    const seen = new Set<string>();
    for (const match of lines[i].matchAll(COLOR_REF)) {
      const token = match[1];
      if (roleTokens.has(token) || seen.has(token)) continue;
      if (`${sheet}:--color-${token}` in BARE_PALETTE_ALLOWLIST) continue;
      const shade = /-\d+$/.exec(token);
      if (
        !SHADELESS_HUES.has(token) &&
        !(shade && TAILWIND_HUES.has(token.slice(0, shade.index)))
      ) {
        continue;
      }
      seen.add(token);
      failures.push({
        file,
        line: i + 1,
        rule: 'bare-palette-token',
        text:
          `${match[0]} is a bare Tailwind palette value — use a role token from ` +
          'packages/ui/src/theme.css (e.g. --color-muted-foreground, --color-border), ' +
          'or add a BARE_PALETTE_ALLOWLIST entry with a reason',
      });
    }
  }
  return failures;
}

export interface ThemeTokenFailure {
  file: string;
  line: number;
  rule: string;
  text: string;
}

export function findThemeTokenFailures(file: string, lines: string[]): ThemeTokenFailure[] {
  const failures: ThemeTokenFailure[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (HEX_LONG.test(text) || (HEX_SHORT.test(text) && CSS_KEYWORD.test(text))) {
      failures.push({ file, line: i + 1, rule: 'hex-literal', text: text.trim() });
    }
    const family = FONT_FAMILY.exec(text);
    if (family && !family[1].includes('var(') && !family[1].includes('inherit')) {
      failures.push({ file, line: i + 1, rule: 'font-family-literal', text: text.trim() });
    }
    if (FONT_SIZE_LITERAL.test(text)) {
      failures.push({ file, line: i + 1, rule: 'font-size-literal', text: text.trim() });
    }
  }
  return failures;
}

export function findBreakpointFailures(file: string, lines: string[]): ThemeTokenFailure[] {
  const failures: ThemeTokenFailure[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!MEDIA_LINE.test(lines[i])) continue;
    for (const match of lines[i].matchAll(TIER_VALUE)) {
      const value = Number(match[1]);
      if (value >= 400 && !TIERS.has(value)) {
        failures.push({
          file,
          line: i + 1,
          rule: 'breakpoint-tier',
          text: `${value}px is outside SITE_BREAKPOINT_TIERS (www/site-css.ts)`,
        });
      }
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const failures: ThemeTokenFailure[] = [];
  const roleTokens = await loadRoleColorTokens();
  for (const root of SCAN_ROOTS) {
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (entry.isDirectory() || (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx'))) {
        continue;
      }
      const entryPath = `${entry.parentPath}/${entry.name}`;
      if (!SOURCE.test(entryPath)) continue;
      if (entryPath.includes('/data/_generated-')) continue;
      const text = await readFile(entryPath, 'utf8');
      const lines = text.split('\n');
      failures.push(...findThemeTokenFailures(entryPath, lines));
      failures.push(...findBreakpointFailures(entryPath, lines));
      if (entryPath.includes(SITE_UI_SEGMENT)) {
        failures.push(...findBarePaletteFailures(entryPath, lines, roleTokens));
      }
    }
  }
  if (failures.length > 0) {
    console.error('site theme token check failed:');
    for (const failure of failures) {
      console.error(`- ${failure.file}:${failure.line} [${failure.rule}] ${failure.text}`);
    }
    console.error(
      'Theme values must come from the theme token table (packages/ui/src/theme.css) or the www/site-css.ts alias layer.',
    );
    process.exit(1);
  }
  console.log('site theme token check passed.');
}

if (import.meta.main) {
  await main();
}
