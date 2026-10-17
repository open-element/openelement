/** Bare-palette gate semantics: role table precedence, allowlist, parse, and
 * the linked authored sheet (A5: www/site-chrome.css is a scan target). */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { siteCSS } from '../site-css.ts';
import {
  BARE_PALETTE_ALLOWLIST,
  BARE_PALETTE_SEGMENTS,
  LINKED_STYLE_SHEETS,
  collectAppScanTargets,
  findAuthoredSheetFailures,
  findBarePaletteFailures,
  findBreakpointFailures,
  findSiteThemeTokenFailures,
  findThemeTokenFailures,
  loadRoleColorTokens,
} from './check-site-theme-tokens.ts';

const ROLES = new Set(['muted-foreground', 'primary', 'chart-1', 'border']);
const SHEET = '/repo/www/app/site-ui/prose-styles.ts';
const CHROME_SHEET = fileURLToPath(new URL('../site-chrome.css', import.meta.url));
const APP_ROOT = fileURLToPath(new URL('../app/', import.meta.url));

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

test('the allowlist is empty: every scanned sheet is role-token clean', () => {
  // The retired open-search scrim entry left with its sheet: the scrim rule
  // moved into the linked www/site-chrome.css layer, which the scan does not
  // read. An empty allowlist means every bare-palette flag the scan raises is
  // a real regression.
  expect(Object.keys(BARE_PALETTE_ALLOWLIST)).toEqual([]);
  expect(
    flagTexts(['background: var(--color-zinc-950);'], '/x/islands/any-sheet.tsx')[0],
  ).toContain('BARE_PALETTE_ALLOWLIST');
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
  // Sheet files live under one of the gate's own segments (the checker's
  // segment list is the single location fact; #1553 moved the open-search
  // sheet into its island module).
  const appRoot = fileURLToPath(new URL('../app/', import.meta.url));
  for (const key of Object.keys(BARE_PALETTE_ALLOWLIST)) {
    const [sheet, token] = key.split(':');
    const candidates = BARE_PALETTE_SEGMENTS.map((segment) => `${appRoot}${segment}${sheet}`);
    const texts = await Promise.all(
      candidates.map((path) => readFile(path, 'utf8').catch(() => null)),
    );
    const text = texts.find((candidate) => candidate !== null);
    expect(text, `${key} — no candidate sheet found under ${candidates.join(', ')}`).toBeDefined();
    expect(text!.includes(`var(${token})`), key).toEqual(true);
  }
});

// ─── A5: the linked authored sheet is inside the gate ─────────────────────
// #1569 moved the shell/pseudo-element rules out of the scanned CSS-in-TS set
// into www/site-chrome.css (a plain .css file, delivered through the
// `tailwind.theme` source list). A plain `.css` file is not CSS-in-TS, so the
// www/app walk never read it: the sheet carried 9 bare-palette refs while the
// gate reported green. These tests pin the two halves of the fix: the sheet is
// a scan target, and it is clean under every rule the gate applies to it.

test('the linked authored sheet is a scan target, not a silent gap', () => {
  expect(LINKED_STYLE_SHEETS).toContain(CHROME_SHEET);
  expect(LINKED_STYLE_SHEETS.every((sheet) => sheet.endsWith('.css'))).toEqual(true);
});

test('authored .css sheets under www/app are scan targets with the palette rule', async () => {
  // open-article-view.css is the page-owned sheet of the #1553 protocol: a
  // plain .css file under the scanned root that the .ts/.tsx source filter
  // alone would still skip. It must be a target, and gated for palette too.
  const targets = await collectAppScanTargets(APP_ROOT);
  const sheets = targets.filter((target) => target.path.endsWith('.css'));
  expect(sheets.map((sheet) => sheet.path)).toEqual([
    fileURLToPath(new URL('../app/site-ui/open-article-view.css', import.meta.url)),
  ]);
  expect(sheets.every((sheet) => sheet.palette)).toEqual(true);
  // The CSS-in-TS surface keeps its segment-scoped palette rule ...
  expect(targets.find((target) => target.path.endsWith('/site-ui/head.ts'))?.palette).toEqual(true);
  // ... and the generated data dir is not a source.
  expect(targets.some((target) => target.path.includes('_generated-'))).toEqual(false);
  expect(targets.length).toBeGreaterThan(sheets.length);
});

test('the linked sheet passes every rule the gate applies to it', async () => {
  const lines = (await readFile(CHROME_SHEET, 'utf8')).split('\n');
  const roles = await loadRoleColorTokens();
  expect({
    theme: findThemeTokenFailures(CHROME_SHEET, lines),
    breakpoint: findBreakpointFailures(CHROME_SHEET, lines),
    palette: findBarePaletteFailures(CHROME_SHEET, lines, roles),
  }).toEqual({ theme: [], breakpoint: [], palette: [] });
  expect(findAuthoredSheetFailures(CHROME_SHEET, lines, roles)).toEqual([]);
});

test('the whole gate surface (sources + authored sheets) is clean', async () => {
  expect(await findSiteThemeTokenFailures()).toEqual([]);
});

test('a prohibited declaration in the linked sheet is rejected deterministically', () => {
  // The rejected case, run through the same rules the scan applies to a sheet:
  // a bare palette value and a hex literal both fail, at their line.
  const badPalette = [
    'open-search .overlay {',
    '  background: color-mix(in srgb, var(--color-zinc-200) 44%, transparent);',
    '}',
  ];
  const roles = new Set(['primary']);
  expect(
    findAuthoredSheetFailures(CHROME_SHEET, badPalette, roles).map((failure) => failure.rule),
  ).toEqual(['bare-palette-token']);
  const paletteFailures = findBarePaletteFailures(CHROME_SHEET, badPalette, roles);
  expect(paletteFailures).toHaveLength(1);
  expect(paletteFailures[0].line).toEqual(2);
  expect(paletteFailures[0].file).toEqual(CHROME_SHEET);
  const hexFailures = findAuthoredSheetFailures(CHROME_SHEET, ['  color: #7c3aed;'], roles);
  expect(hexFailures).toHaveLength(1);
  expect(hexFailures[0].rule).toEqual('hex-literal');
  // There is no per-sheet exemption for the authored sheets: the allowlist is
  // keyed by sheet name and stays empty, so the only way to keep a
  // theme-invariant ink is the alias layer asserted below.
  expect(Object.keys(BARE_PALETTE_ALLOWLIST)).toEqual([]);
});

test('the linked sheet’s theme-invariant inks are aliases in site-css.ts', async () => {
  // www/site-css.ts is the site's sanctioned token-definition layer (the
  // gate's own doctrine names it): the palette citation lives there, the
  // consumer sheet names the alias. A rename on either side must fail here.
  for (const name of ['--scrim-ink', '--grid-ink']) {
    expect(siteCSS).toContain(`${name}:`);
  }
  const sheet = await readFile(CHROME_SHEET, 'utf8');
  expect(sheet).toContain('var(--scrim-ink)');
  expect(sheet).toContain('var(--grid-ink)');
  // No bare palette citation may re-enter the linked sheet.
  expect(sheet).not.toMatch(/var\(--color-(?:zinc|violet)-\d+\)/);
});
