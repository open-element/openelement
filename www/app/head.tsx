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
 * - theme-init.js stays an external sync script: raw head fragments reject
 *   <script> outright (H-04) and the framework ships no raw inline-script
 *   channel. Structured data does not need one: it goes through the page
 *   descriptor's `structuredData`, which the framework serializes (with `<`
 *   escaped) into its own application/ld+json element.
 *
 * Font delivery (H lane, superseding #1554): the faces are self-hosted. The
 * fontsource packages are www dependencies (www/site-fonts.ts pins the
 * versions and declares the stylesheets), their CSS compiles into the site's
 * one linked style bundle (/assets/open-tailwind.css) through the Tailwind
 * preset's declared sources (www/openelement.config.ts `tailwind.theme`), and
 * Vite emits each woff2 as a content-hashed same-origin asset beside it. This
 * head therefore carries no font links: no jsDelivr stylesheet, no SRI, no
 * crossorigin preload. The #1554 CDN links were render-blocking requests to a
 * third-party origin — on networks where that origin is unreachable (the
 * site's Chinese audience) they stalled first paint until the browser timed
 * out. The families below must match fontsource's ('Inter Variable',
 * 'JetBrains Mono Variable', 'Instrument Serif' — see www/site-css.ts), and
 * `www/__tests__/font-delivery.test.ts` pins the declaration, the dependency
 * versions and the stacks together.
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
      'html{visibility:visible!important;}body{background:var(--color-background);color:var(--color-foreground);}',
  },
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
