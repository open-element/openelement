/**
 * site theme-token gate: theme values in the site must come from the
 * @theme-derived token table (packages/ui/src/theme.css + the alias layer in
 * packages/ui/src/semantic-tokens.css, carried by @openelement/ui/theme-tokens)
 * or the site alias layer (www/site-css.ts), never from hardcoded literals.
 *
 * Rules for sources under www/app/ (routes, islands, components):
 *  1. No hex color literals. 6/8-digit forms always fail; 3/4-digit forms
 *     fail only on lines carrying a CSS property keyword, so issue
 *     references like `#390` in prose stay legal.
 *  2. No `font-family` declarations that bypass var(); `inherit` is allowed.
 *  3. No `font-size` literals in px/rem/em outside var(); clamp() fluid
 *     typography is allowed.
 *
 * Token definitions belong in packages/ui/src/theme.css (the single role
 * source) or www/site-css.ts (site aliases) as carried by the token module.
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
  for (const root of SCAN_ROOTS) {
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (entry.isDirectory() || (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx'))) {
        continue;
      }
      const entryPath = `${entry.parentPath}/${entry.name}`;
      if (!SOURCE.test(entryPath)) continue;
      if (entryPath.includes('/data/_generated-')) continue;
      const text = await readFile(entryPath, 'utf8');
      failures.push(...findThemeTokenFailures(entryPath, text.split('\n')));
      failures.push(...findBreakpointFailures(entryPath, text.split('\n')));
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
