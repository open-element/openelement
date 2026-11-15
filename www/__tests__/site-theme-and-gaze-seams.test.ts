import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

/**
 * P8 consumer-form guards for the two www-side seams registered in
 * docs/architecture/seams.md:
 *
 * 1. html[data-theme] broadcast — `www/public/theme-init.js` (the pre-paint
 *    boot writer) and `packages/ui/src/open-theme-toggle.tsx` `applyTheme`
 *    (the runtime propagation writer) must keep ONE saved-value acceptance
 *    rule: the localStorage `open-theme` value is honored only when it is
 *    exactly 'light' or 'dark'; anything else falls back to
 *    prefers-color-scheme with 'dark' as the no-preference default. The
 *    former divergence (theme-init honoring ANY non-empty saved value while
 *    the toggle only accepted the two exact spellings) is the defect this
 *    guard pins shut — a single-side rule change reds here.
 *
 * 2. --gaze stage gradient input — the live-gaze controller's written and
 *    removed custom property names and the site-chrome CSS reader's consumed
 *    name must keep co-occurring; a single-side rename would break the
 *    gradient feed silently.
 *
 * Both are static source contracts (the established www test style): the
 * sources are parsed and asserted against the same literals, no DOM needed.
 */

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

test('theme boot and toggle writers share the exact saved-value acceptance rule', async () => {
  const init = await THEME_INIT_SOURCE;
  const toggle = await THEME_TOGGLE_SOURCE;

  // The saved value is honored only when it is exactly 'light' | 'dark' — in
  // BOTH writers. The pre-paint boot script previously accepted any non-empty
  // saved value (`saved || …`), a rule the toggle never had.
  expect(init).toContain("saved === 'light'");
  expect(init).toContain("saved === 'dark'");
  expect(toggle).toContain("saved === 'light'");
  expect(toggle).toContain("saved === 'dark'");
  // The divergent truthy acceptance shape stays gone, and no inverted
  // spelling (a `!==` short-circuit) may replace it on either side.
  expect(init).not.toMatch(/saved\s*\|\|/);
  expect(init).not.toMatch(/saved\s*!==\s*'(?:light|dark)'/);
  expect(toggle).not.toMatch(/saved\s*\|\|/);
  expect(toggle).not.toMatch(/saved\s*!==\s*'(?:light|dark)'/);
});

test('theme boot and toggle writers share the same prefers-color-scheme fallback and default', async () => {
  const init = await THEME_INIT_SOURCE;
  const toggle = await THEME_TOGGLE_SOURCE;

  // Both writers query the LIGHT preference and default to 'dark' when it
  // does not match (the toggle's no-preference default). Neither queries
  // 'dark' directly — that spelling is how the old light-defaulting boot
  // script diverged.
  expect(init).toContain("'(prefers-color-scheme: light)'");
  expect(toggle).toContain("'(prefers-color-scheme: light)'");
  expect(init).not.toContain('(prefers-color-scheme: dark)');
  expect(toggle).not.toContain('(prefers-color-scheme: dark)');
  // The no-preference default is 'dark' in both writers.
  expect(init).toMatch(/prefersLight\s*\?\s*'light'\s*:\s*'dark'/);
  expect(toggle).toMatch(/\?\s*'light'\s*:\s*'dark'/);
  // One localStorage key, read by both writers.
  expect(init).toContain("localStorage.getItem('open-theme')");
  expect(toggle).toContain("localStorage.getItem('open-theme')");
});

test('both html[data-theme] writers broadcast through the same attribute write', async () => {
  const init = await THEME_INIT_SOURCE;
  const toggle = await THEME_TOGGLE_SOURCE;
  expect(init).toContain("document.documentElement.setAttribute('data-theme'");
  expect(toggle).toContain("document.documentElement.setAttribute('data-theme'");
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
