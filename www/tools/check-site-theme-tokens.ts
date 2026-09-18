/**
 * site theme-token gate: theme values in the site must come from open-props
 * tokens (packages/ui/src/semantic-tokens.css + its generated module) and the site alias layer
 * (www/vite.config.ts), never from hardcoded literals.
 *
 * Rules for sources under www/app/ and www/islands/:
 *  1. No hex color literals. 6/8-digit forms always fail; 3/4-digit forms
 *     fail only on lines carrying a CSS property keyword, so issue
 *     references like `#390` in prose stay legal.
 *  2. No `font-family` declarations that bypass var(); `inherit` is allowed.
 *  3. No `font-size` literals in px/rem/em outside var(); clamp() fluid
 *     typography is allowed.
 *
 * Token definitions belong in www/vite.config.ts (site aliases) or
 * packages/ui/src/semantic-tokens.css (source of truth) as carried by the generated module.
 */

import { walk } from '@std/fs/walk';
import { fromFileUrl, join } from '@std/path';
import { SITE_BREAKPOINT_TIERS } from '../site-css.ts';

const repoRoot = fromFileUrl(new URL('../../', import.meta.url));
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

export function findThemeTokenFailures(
  file: string,
  lines: string[],
): ThemeTokenFailure[] {
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

export function findBreakpointFailures(
  file: string,
  lines: string[],
): ThemeTokenFailure[] {
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
    for await (const entry of walk(root, { exts: ['.ts', '.tsx'] })) {
      if (!SOURCE.test(entry.path)) continue;
      if (entry.path.includes('/data/_generated-')) continue;
      const text = await Deno.readTextFile(entry.path);
      failures.push(...findThemeTokenFailures(entry.path, text.split('\n')));
      failures.push(...findBreakpointFailures(entry.path, text.split('\n')));
    }
  }
  if (failures.length > 0) {
    console.error('site theme token check failed:');
    for (const failure of failures) {
      console.error(`- ${failure.file}:${failure.line} [${failure.rule}] ${failure.text}`);
    }
    console.error(
      'Theme values must come from open-props tokens or the www/vite.config.ts alias layer.',
    );
    Deno.exit(1);
  }
  console.log('site theme token check passed.');
}

if (import.meta.main) {
  await main();
}
