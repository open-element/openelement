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
 * 'JetBrains Mono Variable', 'Instrument Serif' — see www/site-css.css), and
 * `www/__tests__/font-delivery.test.ts` pins the declaration, the dependency
 * versions and the stacks together.
 *
 * Code fences carry their build-time token colors in the page HTML itself
 * (www/lib/markdown.ts), and the palette resolves through the document
 * stylesheet (www/site-css.css), so the head ships no highlighting style or
 * script (issue #1552 retired the vendored Prism runtime).
 *
 * Site-wide head only (Beta.2.2, #1327): per-page meaning — title,
 * description, og:title/og:description/og:url, canonical, hreflang — is
 * declared by each route module's descriptor head and serialized at SSG time
 * (app/site-ui/head.ts). Nothing rewrites <head> after the build anymore, so no
 * page-level boilerplate may live here: a boilerplate og:title/description
 * would duplicate the page's own.
 */
import { SITE_ORIGIN } from './site-ui/site-url.ts';

const socialImage = `${SITE_ORIGIN}/brand/og-default.png`;

export default [
  { meta: { property: 'og:site_name', content: 'openElement' } },
  { meta: { property: 'og:type', content: 'website' } },
  { meta: { property: 'og:image', content: socialImage } },
  { meta: { property: 'og:image:type', content: 'image/png' } },
  { meta: { property: 'og:image:width', content: '1200' } },
  { meta: { property: 'og:image:height', content: '630' } },
  { meta: { name: 'twitter:card', content: 'summary_large_image' } },
  { meta: { name: 'twitter:image', content: socialImage } },
  { link: { rel: 'icon', type: 'image/svg+xml', sizes: 'any', href: '/favicon.svg' } },
  { link: { rel: 'apple-touch-icon', sizes: '180x180', href: '/brand/apple-touch-icon.png' } },
];
