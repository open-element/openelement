/**
 * The site's self-hosted font set (the H lane superseding #1554's CDN pins).
 *
 * #1554 delivered the faces from the fontsource CDN (jsDelivr) as four
 * render-blocking stylesheet links. On networks where that CDN is unreachable
 * — the everyday reality for the site's Chinese audience — those links stalled
 * first paint until the browser gave up. The faces now come from the same
 * fontsource packages as ordinary npm dependencies: `SITE_FONT_SOURCES` is the
 * one writer of the package stylesheet specifiers, `openelement.config.ts`
 * compiles them into the site's Tailwind preset bundle, and Vite emits each
 * referenced woff2 as a content-hashed asset next to the bundle. No font
 * request leaves the site's origin.
 *
 * The pinned versions are the ones #1554 pinned: the npm files are
 * byte-identical to what the CDN served (the woff2 digests recorded for the
 * CDN references — www/public/assets/manifest.json history — match the package
 * files), so the channel changed and the glyphs did not.
 *
 * The family names are fontsource's own; the site's token stacks
 * (www/site-css.ts) must spell them exactly or the faces never apply.
 * www/__tests__/font-delivery.test.ts pins the three facts together — the
 * declared specifiers, the www/package.json dependency versions, and the
 * families in site-css.ts.
 */

/** One fontsource package behind a site family. */
export interface SiteFontPackage {
  /** The fontsource package name (a www/package.json dependency). */
  readonly package: string;
  /** The pinned release. www/package.json must depend on exactly this version. */
  readonly version: string;
  /** The package stylesheets compiled into the site's style bundle. */
  readonly css: readonly string[];
  /** The family the stylesheets declare — the name site-css.ts must use. */
  readonly family: string;
}

export const SITE_FONT_PACKAGES: readonly SiteFontPackage[] = [
  {
    package: '@fontsource-variable/inter',
    version: '5.3.0',
    css: ['@fontsource-variable/inter/wght.css'],
    family: 'Inter Variable',
  },
  {
    package: '@fontsource-variable/jetbrains-mono',
    version: '5.3.0',
    css: ['@fontsource-variable/jetbrains-mono/wght.css'],
    family: 'JetBrains Mono Variable',
  },
  {
    package: '@fontsource/instrument-serif',
    version: '5.3.0',
    css: [
      '@fontsource/instrument-serif/latin.css',
      '@fontsource/instrument-serif/latin-italic.css',
    ],
    family: 'Instrument Serif',
  },
];

/** Every declared stylesheet specifier, in declaration order. */
export const SITE_FONT_SOURCES: readonly string[] = SITE_FONT_PACKAGES.flatMap((font) => font.css);
