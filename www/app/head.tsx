/**
 * The official Site's structural document-head content (alpha.4).
 *
 * `app/head.tsx` is compiled into the Site's own module graph, so it may import
 * CSS by URL and the Site's own modules — the head module's output is a build
 * artifact with no host filesystem dependency at render time.
 *
 * Every entry is DATA, never markup: the framework validates attribute names
 * and URL protocols, escapes values, and serializes the tags. Entries are
 * emitted in the order written, so this array is the document's head order.
 *
 * Critical-path hardening (#1088 site-level findings):
 * - The two text fonts (prose Inter, code JetBrains Mono) are preloaded so the
 *   swap resolves before first paint — measured CLS 0.195 → ~0. Serif accents
 *   are intentionally not preloaded (not used above the fold on most pages).
 * - theme-init.js stays an external sync script: raw head fragments reject
 *   <script> outright (H-04) and the framework ships no raw inline-script
 *   channel. Structured data does not need one: it goes through the page
 *   descriptor's `structuredData`, which the framework serializes (with `<`
 *   escaped) into its own application/ld+json element.
 *
 * Font delivery (#1554): the site no longer vendors WOFF2 files. The faces
 * come from the fontsource CDN (jsDelivr) at exact package versions — chosen
 * over Google Fonts' service because fontsource ships the variable faces
 * (Inter wght 100-900, JetBrains Mono wght 100-800), pins immutable URLs with
 * one-year immutable cache headers, and allows SRI. SRI lives on the
 * stylesheet links; the woff2 fetches themselves are CSS-initiated and have
 * no integrity channel on the platform, so they are pinned by the immutable
 * versioned URLs and the preloads are a cache warm-up, not a guarantee.
 * The @font-face declarations now arrive from those stylesheets, which is
 * why the family names below must match fontsource's ('Inter Variable',
 * 'JetBrains Mono Variable', 'Instrument Serif' — see www/site-css.ts).
 * Selection rationale and license roll-up: THIRD_PARTY_NOTICES.md.
 *
 * Code fences carry their build-time token colors in the page HTML itself
 * (www/lib/markdown.ts), and the palette resolves through the document
 * stylesheet (www/site-css.ts), so the head ships no highlighting style or
 * script (issue #1552 retired the vendored Prism runtime).
 *
 * Site-wide head only (Beta.2.2, #1327): per-page meaning — title,
 * description, og:title/og:description/og:url, canonical, hreflang — is
 * declared by each route module's descriptor head and serialized at SSG time
 * (app/site-ui/head.ts). Nothing rewrites <head> after the build anymore, so no
 * page-level boilerplate may live here: a boilerplate og:title/description
 * would duplicate the page's own.
 */
import { documentStyle } from '../site-css.ts';

/**
 * Fontsource-on-jsDelivr delivery (#1554). `crossorigin` needs an explicit
 * value: the head serializer strips the bare form, and a no-cors preload
 * would fetch the font twice. Rotating a font version means rotating the
 * version in every URL here AND the stylesheet integrity hashes together —
 * the hashes have no second home. Exported for the drift guard
 * (www/__tests__/font-delivery.test.ts): the asset manifest's remote font
 * entries must pin the same versions.
 */
export const FONT_CDN_ORIGIN = 'https://cdn.jsdelivr.net';

export const FONT_FACES = [
  {
    css: '/npm/@fontsource-variable/inter@5.3.0/wght.css',
    integrity: 'sha384-ZTIcl2CmY0wyM9ANOhomBco7rEUIlWztf6lGcLKCocKUrIgGCsfisuZyE+hadW8K',
  },
  {
    css: '/npm/@fontsource-variable/jetbrains-mono@5.3.0/wght.css',
    integrity: 'sha384-bNykZ+bGB4FclZiYvLmgUfE8clWCvZlLOJ3v63czgIEgamTe0EhkaLXIbptJkvmW',
  },
  {
    css: '/npm/@fontsource/instrument-serif@5.3.0/latin.css',
    integrity: 'sha384-QxzOjJ0BfJl4xcH1dyDlc1L4BmSeA1Viw4hK2XOJPyOwj/ZH1fr32iEfrFlvn2z5',
  },
  {
    css: '/npm/@fontsource/instrument-serif@5.3.0/latin-italic.css',
    integrity: 'sha384-wPuiZqBDJVRGQmzwABa5N/ny86zIhFMnaqwVkvNkfXaxYcZlAfMdLSCQRYEnnJPA',
  },
] as const;

/**
 * The two text faces preloaded (#1088). The URLs must stay byte-identical to
 * what the wght.css stylesheets above resolve to (their ./files/ siblings),
 * or the preload is wasted and the swap lands after first paint. The latin
 * subset is the one the site's prose renders; other subsets load on demand
 * through unicode-range.
 */
export const FONT_PRELOADS = [
  '/npm/@fontsource-variable/inter@5.3.0/files/inter-latin-wght-normal.woff2',
  '/npm/@fontsource-variable/jetbrains-mono@5.3.0/files/jetbrains-mono-latin-wght-normal.woff2',
] as const;

export default [
  // The font CDN connection warms up first: every font link below (CORS
  // preloads, integrity-checked stylesheets) rides the same origin, so one
  // crossorigin preconnect covers them all.
  { link: { rel: 'preconnect', href: FONT_CDN_ORIGIN, crossorigin: 'anonymous' } },
  { meta: { property: 'og:site_name', content: 'OpenElement' } },
  { meta: { property: 'og:type', content: 'website' } },
  { meta: { property: 'og:image', content: 'https://openelement.org/assets/og-image.jpg' } },
  { meta: { property: 'og:image:width', content: '1200' } },
  { meta: { property: 'og:image:height', content: '630' } },
  { meta: { name: 'twitter:card', content: 'summary_large_image' } },
  {
    meta: { name: 'twitter:image', content: 'https://openelement.org/assets/og-image.jpg' },
  },
  // Anti-flash: the theme is applied before the document style below paints, so
  // the page is never rendered in the wrong palette.
  {
    style:
      'html{visibility:visible!important;}body{background:var(--color-background);color:var(--color-foreground);}',
  },
  ...FONT_PRELOADS.map((href) => ({
    link: {
      rel: 'preload',
      href: `${FONT_CDN_ORIGIN}${href}`,
      as: 'font',
      type: 'font/woff2',
      crossorigin: 'anonymous',
    },
  })),
  ...FONT_FACES.map((face) => ({
    link: {
      rel: 'stylesheet',
      href: `${FONT_CDN_ORIGIN}${face.css}`,
      integrity: face.integrity,
      crossorigin: 'anonymous',
    },
  })),
  { link: { rel: 'icon', type: 'image/svg+xml', href: '/assets/open-favicon.svg' } },
  { link: { rel: 'apple-touch-icon', href: '/assets/open-avatar.svg' } },
  // One feed for the whole site: dispatches are single-language originals (the
  // blog collection's `lang` field names the original), so /zh/blog lists the
  // same posts and a per-locale feed would be an empty duplicate. `title` must
  // match the feed's channel <title> (tools/lib/site-rss.ts SITE_FEED_TITLE);
  // the href is site-root-relative like every other asset here, and resolves
  // the same on locale-prefixed pages.
  {
    link: {
      rel: 'alternate',
      type: 'application/rss+xml',
      title: 'openElement Blog',
      href: '/blog/rss.xml',
    },
  },
  { style: documentStyle },
];
