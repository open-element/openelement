/**
 * The official Site's structural document-head content (alpha.4).
 *
 * `app/head.tsx` is compiled into the Site's own module graph, so it may import
 * CSS by URL and the Site's own modules — which is exactly why the Prism theme
 * is an import here instead of a build-time file read (`Deno.readTextFileSync`
 * in the config would have made the document depend on a host API the module is
 * not allowed to use).
 *
 * The import suffix is `?raw`, deliberately: `?inline` runs the stylesheet
 * through Vite's CSS pipeline, which rewrites the vendored Prism theme (drops
 * `background:0 0`, de-quotes the font stack, flattens `@media print`) — the
 * theme is a pinned third-party artifact (#1088) and must reach the document
 * byte-for-byte, so nothing between the file and `<style>` may transform it.
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
 * - The Prism theme CSS is inlined: it was a render-blocking stylesheet on a
 *   third-party origin (cdnjs) — a slow-network FCP stall and a SPOF.
 *
 * Site-wide head only (Beta.2.2, #1327): per-page meaning — title,
 * description, og:title/og:description/og:url, canonical, hreflang — is
 * declared by each route module's descriptor head and serialized at SSG time
 * (app/site-ui/head.ts). Nothing rewrites <head> after the build anymore, so no
 * page-level boilerplate may live here: a boilerplate og:title/description
 * would duplicate the page's own.
 */
import { documentStyle } from '../site-css.ts';
import prismThemeCss from '../public/assets/vendor/prism/prism.min.css?raw';

/**
 * `crossorigin` needs an explicit value: the head serializer strips the bare
 * form, and a no-cors preload would fetch the font twice.
 */
const FONT_PRELOADS = [
  '/assets/fonts/inter-latin-variable.woff2',
  '/assets/fonts/jetbrains-mono-latin-variable.woff2',
] as const;

export default [
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
      'html{visibility:visible!important;}body{background:var(--bg-base);color:var(--text-primary);}',
  },
  ...FONT_PRELOADS.map((href) => ({
    link: {
      rel: 'preload',
      href,
      as: 'font',
      type: 'font/woff2',
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
  { style: prismThemeCss },
];
