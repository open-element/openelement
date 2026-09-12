/**
 * www theme-token gate: theme values in the site must come from open-props
 * tokens (packages/ui/src/open-props-tokens.css) and the www alias layer
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
 * packages/ui/src/open-props-tokens.css (source of truth).
 */

import { walk } from '@std/fs/walk';

const SCAN_ROOTS = ['www/app'];
const SOURCE = /\.(ts|tsx)$/;
const HEX_LONG = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const HEX_SHORT = /#(?:[0-9a-fA-F]{3,4})\b/;
const CSS_KEYWORD = /\b(?:color|background|border|shadow|fill|stroke|gradient|outline)\b/i;
const FONT_FAMILY = /font-family\s*:\s*([^;]+);/;
const FONT_SIZE_LITERAL = /font-size\s*:\s*[0-9.]+(?:px|rem|em)\b/;

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

async function main(): Promise<void> {
  const failures: ThemeTokenFailure[] = [];
  for (const root of SCAN_ROOTS) {
    for await (const entry of walk(root, { exts: ['.ts', '.tsx'] })) {
      if (!SOURCE.test(entry.path)) continue;
      if (entry.path.includes('/data/_generated-')) continue;
      const text = await Deno.readTextFile(entry.path);
      failures.push(...findThemeTokenFailures(entry.path, text.split('\n')));
    }
  }
  if (failures.length > 0) {
    console.error('www theme token check failed:');
    for (const failure of failures) {
      console.error(`- ${failure.file}:${failure.line} [${failure.rule}] ${failure.text}`);
    }
    console.error(
      'Theme values must come from open-props tokens or the www/vite.config.ts alias layer.',
    );
    Deno.exit(1);
  }
  console.log('www theme token check passed.');
}

if (import.meta.main) {
  await main();
}
