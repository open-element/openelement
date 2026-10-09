/**
 * Font-delivery seam drift guard (H lane, superseding #1554's CDN pins).
 *
 * www/site-fonts.ts is the one writer of the site's font facts: the
 * fontsource package specifiers, the pinned versions, and the family names
 * the CSS declares. Four consumers must agree with it, and this test is the
 * form in which they agree today:
 *
 *   - www/package.json must depend on exactly the pinned versions — the
 *     stylesheets compile from the installed packages, so an unpinned or
 *     range dependency would silently rotate the faces;
 *   - the installed package must ship the declared stylesheets (a specifier
 *     typo otherwise surfaces only at build time);
 *   - the installed stylesheets must declare the declared family with
 *     `font-display: swap` — the swap policy the site's first paint relies
 *     on, and the family name www/site-css.ts spells in its stacks;
 *   - www/site-css.ts must spell that same family in its token stacks (the
 *     `--font-sans` / `--font-mono` / `--font-serif` values), because a stack
 *     name that does not match the @font-face family silently drops to the
 *     fallback list.
 *
 * The delivered artifact side (the bundle carries the faces and the woff2
 * siblings actually ship beside it) lives in build-output.test.ts, which runs
 * against www/dist and owns the built-artifact assertions.
 */
import { expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_FONT_PACKAGES, SITE_FONT_SOURCES } from '../site-fonts.ts';

const siteRoot = join(import.meta.dirname, '..');

const pkg = JSON.parse(readFileSync(join(siteRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};

/** Resolve one declared stylesheet specifier to the installed package file. */
function resolveSpecifier(specifier: string): string {
  const [packageName, ...rest] = specifier.split('/');
  const name = packageName!.startsWith('@') ? `${packageName}/${rest.shift()}` : packageName!;
  return join(siteRoot, 'node_modules', name, rest.join('/'));
}

test('font delivery: every declared package is an exact dependency pin', () => {
  expect(SITE_FONT_PACKAGES.length, 'site-fonts.ts declares at least one font').toBeGreaterThan(0);
  for (const font of SITE_FONT_PACKAGES) {
    expect(
      pkg.dependencies?.[font.package],
      `${font.package} must be an exact www dependency (the stylesheets compile ` +
        'from the installed package; a range would rotate the delivered faces silently)',
    ).toBe(font.version);
  }
});

test('font delivery: the declared stylesheets exist in the installed packages', () => {
  expect(SITE_FONT_SOURCES.length).toBeGreaterThan(0);
  for (const specifier of SITE_FONT_SOURCES) {
    const path = resolveSpecifier(specifier);
    expect(
      existsSync(path),
      `declared stylesheet is not in the installed package: ${specifier}`,
    ).toBe(true);
  }
});

test('font delivery: the installed stylesheets declare the family with font-display swap', () => {
  for (const font of SITE_FONT_PACKAGES) {
    for (const specifier of font.css) {
      const css = readFileSync(resolveSpecifier(specifier), 'utf8');
      expect(
        css.includes(`font-family: '${font.family}'`),
        `${specifier} does not declare font-family '${font.family}'`,
      ).toBe(true);
      // Every @font-face block in the package stylesheet must carry swap: a
      // face that blocks or falls back differently would break first paint.
      const displays = [...css.matchAll(/font-display:\s*([a-z]+)/g)].map((match) => match[1]);
      expect(displays.length, `${specifier} declares no font-display`).toBeGreaterThan(0);
      expect(
        new Set(displays),
        `${specifier} must declare font-display: swap on every face`,
      ).toEqual(new Set(['swap']));
    }
  }
});

test('font delivery: the site stacks spell the declared families', () => {
  // The STACK declarations, not the file's comments: a family named only in
  // prose would still leave the browser on the fallback list.
  const siteCSS = readFileSync(join(siteRoot, 'site-css.ts'), 'utf8');
  const stacks = [...siteCSS.matchAll(/--font-(?:sans|mono|serif)\s*:\s*([^;]+);/g)].map(
    (match) => match[1]!,
  );
  expect(stacks.length, 'site-css.ts declares no --font-* stack').toBeGreaterThan(0);
  for (const font of SITE_FONT_PACKAGES) {
    expect(
      stacks.some((stack) => stack.includes(`'${font.family}'`)),
      `no --font-sans/--font-mono/--font-serif stack in www/site-css.ts spells ` +
        `'${font.family}' — the @font-face would never apply and the stack would ` +
        'drop to its fallbacks',
    ).toBe(true);
  }
});
