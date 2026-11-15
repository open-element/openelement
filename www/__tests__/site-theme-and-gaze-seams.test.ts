import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderThemeInit } from '../tools/generate-theme-init.ts';

/**
 * P8 consumer-form guards for the two www-side seams registered in
 * docs/architecture/seams.md:
 *
 * 1. html[data-theme] broadcast — ONE owner since PR #1804:
 *    `packages/ui/src/theme-contract.ts`. The pre-paint boot script
 *    `www/public/theme-init.js` is generated from it (P6 derived artifact) and
 *    `open-theme-toggle.tsx` delegates its document write to it. Both
 *    consumers share the contract's one acceptance rule, and the contract is
 *    import-free so the classic script can carry it.
 *
 *    What used to be asserted here — "both writers contain the raw
 *    setAttribute call" — was itself the defect: it pinned two writers in
 *    place and would red any convergence. The guard now asserts the opposite:
 *    exactly one write path, no raw write in either consumer.
 *
 * 2. --gaze stage gradient input — the live-gaze controller's written and
 *    removed custom property names and the site-chrome CSS reader's consumed
 *    name must keep co-occurring; a single-side rename would break the
 *    gradient feed silently.
 *
 * These are static source contracts (the established www test style); the
 * generated-artifact test additionally compares the tracked bytes with the
 * generator's in-memory output, so the registry row cannot describe a file
 * that no longer derives from the owner.
 */

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const THEME_CONTRACT_SOURCE = readFile(
  new URL('../../packages/ui/src/theme-contract.ts', import.meta.url),
  'utf8',
);
const THEME_INIT_SOURCE = readFile(new URL('../public/theme-init.js', import.meta.url), 'utf8');
const THEME_TOGGLE_SOURCE = readFile(
  new URL('../../packages/ui/src/open-theme-toggle.tsx', import.meta.url),
  'utf8',
);
const GAZE_CONTROLLER_SOURCE = readFile(
  new URL('../app/site-ui/open-dragon-live-gaze-controller.ts', import.meta.url),
  'utf8',
);
const SITE_CHROME_CSS_SOURCE = readFile(new URL('../site-chrome.css', import.meta.url), 'utf8');

/** The `'<call>('--name'` spellings in a source, string-literal names only. */
function literalPropertyNames(source: string, call: 'setProperty' | 'removeProperty'): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(new RegExp(`${call}\\(\\s*'(--[a-z0-9-]+)'`, 'g'))) {
    if (match[1] !== undefined) names.push(match[1]);
  }
  return names;
}

/** The `var(--name …` spellings a stylesheet consumes. */
function consumedPropertyNames(css: string): string[] {
  const names: string[] = [];
  for (const match of css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
    if (match[1] !== undefined) names.push(match[1]);
  }
  return names;
}

test('the theme contract is import-free and owns the one acceptance rule', async () => {
  const contract = await THEME_CONTRACT_SOURCE;

  // The pre-paint artifact is transpiled standalone: an import here cannot be
  // carried by the classic script and would break first paint.
  expect(contract).not.toMatch(/^\s*import\s/m);
  expect(contract).not.toMatch(/\brequire\s*\(/);
  // The strict saved-value acceptance rule lives once, here.
  expect(contract).toContain("value === 'light'");
  expect(contract).toContain("value === 'dark'");
  expect(contract).toMatch(/prefersLight\s*\?\s*'light'\s*:\s*'dark'/);
  // The one storage key both consumers read.
  expect(contract).toContain("'open-theme'");
});

test('the pre-paint artifact is the generator output, byte for byte', async () => {
  const onDisk = await THEME_INIT_SOURCE;
  const regenerated = await renderThemeInit(repoRoot);

  expect(onDisk, 'www/public/theme-init.js must be regenerated from theme-contract.ts').toBe(
    regenerated,
  );
  expect(onDisk.split('\n')[0]).toContain('GENERATED FILE');
  // Exactly one write site for the attribute survives in the derived artifact.
  expect((onDisk.match(/setAttribute\('data-theme'/g) ?? []).length).toBe(1);
  // The no-preference default stays 'dark' — the toggle's documented default.
  expect(onDisk).toMatch(/prefersLight\s*\?\s*'light'\s*:\s*'dark'/);
});

test('the toggle delegates the document write to the contract (no raw write)', async () => {
  const toggle = await THEME_TOGGLE_SOURCE;

  expect(toggle).toContain('applyDocumentTheme(document.documentElement, theme)');
  expect(toggle, 'the toggle must not write html[data-theme] itself').not.toMatch(
    /documentElement\.setAttribute\(\s*'data-theme'/,
  );
  expect(toggle).toContain('THEME_STORAGE_KEY');
});

test('the live-gaze controller and site-chrome CSS agree on the --gaze custom property name', async () => {
  const controller = await GAZE_CONTROLLER_SOURCE;
  const css = await SITE_CHROME_CSS_SOURCE;

  const written = literalPropertyNames(controller, 'setProperty');
  const removed = literalPropertyNames(controller, 'removeProperty');
  const consumed = consumedPropertyNames(css);

  // The writer paints and the reader consumes the SAME property: renaming
  // either side alone reds here instead of silently unfeeding the gradient.
  expect(written, 'the controller must write --gaze').toContain('--gaze');
  expect(removed, 'the controller must remove --gaze on teardown').toContain('--gaze');
  expect(consumed, 'site-chrome CSS must consume --gaze').toContain('--gaze');
  // Every literal-named write has a matching teardown removal of the same
  // name (no half-rename, no leaked stage property).
  expect(new Set(removed)).toEqual(new Set(written));
  // The reader carries a numeric fallback so an absent write degrades to the
  // static poster lighting instead of an invalid calc().
  expect(css).toMatch(/var\(--gaze,\s*0\.5\s*\)/);
});
