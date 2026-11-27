import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderThemeInit } from '../tools/generate-theme-init.ts';

/**
 * The theme consumers share the same acceptance rule and document
 * attribute writer, including the classic pre-paint artifact.
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
const SITE_MENU_SOURCE = readFile(
  new URL('../app/site-ui/open-site-menu-controller.ts', import.meta.url),
  'utf8',
);
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

test('the toggle delegates the resolution rule and the document write to the contract', async () => {
  const toggle = await THEME_TOGGLE_SOURCE;

  // A generated component receives its host, so the document write goes
  // through `host.ownerDocument`; the contract remains the only writer.
  expect(toggle).toMatch(/applyDocumentTheme\(\s*[\w.]*documentElement\s*,/);
  expect(toggle, 'the toggle must not write html[data-theme] itself').not.toMatch(
    /documentElement\.setAttribute\(\s*'data-theme'/,
  );
  expect(toggle).toContain('THEME_STORAGE_KEY');
  // The acceptance rule is not copied into the consumer: the toggle resolves
  // through the contract's rule and only reads its inputs locally.
  expect(toggle).toContain('resolveSiteTheme(');
  expect(toggle).toContain('isSiteTheme(');
  expect(toggle, 'no second copy of the saved-value acceptance rule').not.toMatch(
    /saved\s*===\s*'light'/,
  );
});

test('the site appearance actions delegate the document write and preference rule', async () => {
  const menu = await SITE_MENU_SOURCE;
  expect(menu).toMatch(/applyDocumentTheme\(doc\.documentElement, theme\)/);
  expect(menu).toContain('resolveSiteTheme(');
  expect(menu).toContain('isSiteTheme(saved)');
  expect(menu).toContain('THEME_STORAGE_KEY');
  expect(menu).not.toMatch(
    /documentElement\.(?:setAttribute\(\s*['"]data-theme|dataset\.theme\s*=(?!=)|style\.colorScheme\s*=(?!=))/,
  );
  expect(menu).not.toMatch(/(?:const|let) THEME_STORAGE_KEY\s*=/);
});
