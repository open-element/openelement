/** Bare-palette gate semantics: role table precedence, allowlist, parse. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  BARE_PALETTE_ALLOWLIST,
  findBarePaletteFailures,
  loadRoleColorTokens,
} from './check-site-theme-tokens.ts';

const ROLES = new Set(['muted-foreground', 'primary', 'chart-1', 'border']);
const SHEET = '/repo/www/app/site-ui/prose-styles.ts';

function flagTexts(lines: string[], file: string = SHEET): string[] {
  return findBarePaletteFailures(file, lines, ROLES).map((failure) => failure.text);
}

test('bare palette refs are flagged with role guidance', () => {
  const failures = findBarePaletteFailures(SHEET, ['  color: var(--color-zinc-200);'], ROLES);
  expect(failures).toHaveLength(1);
  expect(failures[0].rule).toEqual('bare-palette-token');
  expect(failures[0].line).toEqual(1);
  expect(failures[0].text).toContain('var(--color-zinc-200)');
  expect(failures[0].text).toContain('packages/ui/src/theme.css');
  // Numeric shades of any default hue, and the shade-less pair, all trip.
  expect(flagTexts(['border: 1px solid var(--color-red-700);'])[0]).toBeDefined();
  expect(flagTexts(['background: var(--color-white);'])[0]).toBeDefined();
  expect(
    flagTexts(['color-mix(in srgb, var(--color-zinc-950) 44%, transparent);'])[0],
  ).toBeDefined();
});

test('role tokens pass; unknown names and per-line dupes do not double-report', () => {
  expect(
    findBarePaletteFailures(
      SHEET,
      ['color: var(--color-muted-foreground); border-color: var(--color-muted-foreground);'],
      ROLES,
    ),
  ).toHaveLength(0);
  // Unknown non-palette names are outside this rule (no false positives on
  // names the palette grammar cannot produce).
  expect(flagTexts(['color: var(--color-brand-fancy);'])).toHaveLength(0);
  // Same token twice on one line: one failure, not two.
  expect(
    findBarePaletteFailures(
      SHEET,
      ['color: var(--color-zinc-200); background: var(--color-zinc-200);'],
      ROLES,
    ),
  ).toHaveLength(1);
});

test('allowlist suppresses only the named sheet', () => {
  expect(flagTexts(['color: var(--color-zinc-200);'], '/x/site-ui/article-body.ts')).toHaveLength(
    0,
  );
  // The same ref in any other sheet stays red: the key is sheet-scoped.
  expect(flagTexts(['color: var(--color-zinc-200);'])[0]).toContain('BARE_PALETTE_ALLOWLIST');
});

test('role names come from theme.css, not a checker copy', async () => {
  const roles = await loadRoleColorTokens();
  expect(roles.has('muted-foreground')).toEqual(true);
  expect(roles.has('chart-1')).toEqual(true);
  // A palette scale value must never register as a role: the table cites
  // scales only through var() citations, which the line-start parse skips.
  expect([...roles].some((role) => /-(?:50|[1-9]00|950)$/.test(role))).toEqual(false);
});

test('allowlist entries stay live: token still referenced by its sheet', async () => {
  const siteUiRoot = fileURLToPath(new URL('../app/site-ui/', import.meta.url));
  for (const key of Object.keys(BARE_PALETTE_ALLOWLIST)) {
    const [sheet, token] = key.split(':');
    const text = await readFile(`${siteUiRoot}${sheet}`, 'utf8');
    expect(text.includes(`var(${token})`), key).toEqual(true);
  }
});
