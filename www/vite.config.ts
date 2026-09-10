import { openElement } from '@openelement/adapter-vite';
import { openPropsTokenSheet, registerOpenUi } from '@openelement/ui';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { articleCollections } from './content-collections.ts';

// www/ is an npm-first consumer; local workspace resolution during dev, npm
// tarballs in production. No resolve.alias needed.

// Make token variables available to document-level elements while shadow trees
// continue to inherit them from the document root.
const _rawCSS = [...openPropsTokenSheet.cssRules].map((r) => r.cssText).join('\n');
const rootCSS = _rawCSS
  .replace(/:host\s*\{/g, ':root, :host {')
  .replace(
    /:host\(\[data-theme=["']dark["']\]\),\s*:host-context\(\[data-theme=["']dark["']\]\)\s*\{/g,
    'html[data-theme="dark"], :root[data-theme="dark"], :host([data-theme="dark"]), :host-context([data-theme="dark"]) {',
  )
  .replace(
    /:host\(\[data-theme=["']dark["']\]\)\s*\{/g,
    'html[data-theme="dark"], :root[data-theme="dark"], :host([data-theme="dark"]) {',
  );

const siteCSS = `
:root,
html[data-theme="light"],
:host([data-theme="light"]),
:root[data-theme="light"] {
  --bg-canvas: var(--bg-base);
  --surface-1: var(--bg-elevated);
  --surface-2: var(--bg-surface);
  --surface-3: var(--bg-hover);
  --surface-code: var(--bg-code);
  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-muted: var(--text-muted);
  --color-brand: var(--brand);
  --color-brand-hover: var(--brand-hover);
  --color-brand-light: var(--brand-light);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-error: var(--error);
  --color-info: var(--info);
  --color-border: var(--border);
  --color-border-hover: var(--border-hover);
  --color-border-strong: color-mix(in srgb, var(--border) 68%, var(--text-primary));
  --edge-highlight: color-mix(in srgb, var(--text-primary) 10%, transparent);
  --color-edge-highlight: var(--edge-highlight);
  --color-overlay: var(--overlay);
  --shadow-elevated: var(--shadow-1);
  --border-strong: var(--color-border-strong);
  --nav-bg: var(--bg-base);
  --nav-height: var(--size-16);
  --nav-link-color: var(--text-primary);
  --nav-link-hover: var(--brand-deep);
  --font-size-button: var(--font-size-0);
  --font-size-body-sm: var(--font-size-0);
  --font-size-caption: var(--font-size-00);
  --font-size-micro: 0.625rem;
  --font-size-tiny: 0.85rem;
  --font-size-lede: 1.1rem;
  --font-size-overline: 0.6875rem;
  --font-size-article-title: 1.125rem;
  --font-size-display-sm: 1.75rem;
  --font-size-display-md: 2.125rem;
  --font-size-display-lg: 2.625rem;
  --font-weight-medium: var(--font-weight-5);
  --font-weight-semibold: var(--font-weight-7);
  /* Cinematic hero palette: the homepage hero is always dark, independent of
     the site theme. Defined once here (the alias layer) so components never
     carry raw hex literals (www theme-token gate). */
  --hero-ink: #000;
  --hero-paper: #f4f1ea;
  --hero-gold: #e3cf9f;
  --hero-gold-muted: #b9ad93;
  --hero-gold-line: #d8c49a;
  /* www override: real sans for prose. The shared token sheet maps
     --font-sans to JetBrains Mono (brand choice for the component layer);
     long-form reading on this site needs a true sans. Mono stays on
     --font-mono (code, labels, eyebrows, nav) — nothing else changes. */
  --font-sans: 'Inter Variable', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}
html[data-theme="dark"],
:host([data-theme="dark"]),
:root[data-theme="dark"] {
  --bg-canvas: var(--bg-base);
  --surface-1: var(--bg-elevated);
  --surface-2: var(--bg-surface);
  --surface-3: var(--bg-hover);
  --surface-code: var(--bg-code);
  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-muted: var(--text-muted);
  --color-brand: var(--brand);
  --color-brand-hover: var(--brand-hover);
  --color-brand-light: var(--brand-light);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-error: var(--error);
  --color-info: var(--info);
  --color-border: var(--border);
  --color-border-hover: var(--border-hover);
  --color-border-strong: color-mix(in srgb, var(--border) 72%, var(--text-primary));
  --edge-highlight: color-mix(in srgb, var(--text-primary) 14%, transparent);
  --color-edge-highlight: var(--edge-highlight);
  --color-overlay: var(--overlay);
  --border-strong: var(--color-border-strong);
  --nav-bg: var(--bg-base);
  --nav-height: var(--size-16);
}
body {
  margin: 0;
  background:
    radial-gradient(circle at 50% -12%, color-mix(in srgb, var(--violet-5) 24%, transparent), transparent 42%),
    linear-gradient(115deg, color-mix(in srgb, var(--violet-1) 38%, transparent), transparent 46%),
    linear-gradient(color-mix(in srgb, var(--border) 34%, transparent) var(--border-size-1), transparent var(--border-size-1)),
    linear-gradient(90deg, color-mix(in srgb, var(--border) 30%, transparent) var(--border-size-1), transparent var(--border-size-1)),
    var(--bg-canvas);
  background-size: auto, auto, 220px 128px, 220px 128px, auto;
  color: var(--text-primary);
  font-family: var(--font-sans);
  line-height: 1.7;
}
::view-transition-old(open-brand-mark),
::view-transition-new(open-brand-mark) { animation-duration: 320ms; animation-timing-function: var(--motion-standard); }
::selection {
  background: var(--brand-subtle);
  color: var(--text-primary);
}`;
const colorTokensStyle =
  `<style>@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:100 800;font-display:swap;src:url('/assets/fonts/jetbrains-mono-latin-variable.woff2') format('woff2')}@font-face{font-family:'Instrument Serif';font-style:normal;font-weight:400;font-display:swap;src:url('/assets/fonts/instrument-serif-latin-regular.woff2') format('woff2')}@font-face{font-family:'Instrument Serif';font-style:italic;font-weight:400;font-display:swap;src:url('/assets/fonts/instrument-serif-latin-italic.woff2') format('woff2')}@font-face{font-family:'Inter Variable';font-style:normal;font-weight:100 900;font-display:swap;src:url('/assets/fonts/inter-latin-variable.woff2') format('woff2')}${rootCSS}body{font-family:var(--font-sans);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}${siteCSS}</style>`;

// Critical-path hardening (#1088 site-level findings):
// - The two text fonts (prose Inter, code JetBrains Mono) are preloaded so the
//   swap resolves before first paint — measured CLS 0.195 → ~0. Serif accents
//   are intentionally not preloaded (not used above the fold on most pages).
// - theme-init.js stays an external sync script: the framework deliberately
//   rejects <script> in headFragments (H-04) and has no inline-script channel
//   — tracked as a framework gap in #1088.
// - The Prism theme CSS is inlined: it was a render-blocking stylesheet on a
//   third-party origin (cdnjs) — a slow-network FCP stall and a SPOF.
const fontPreloads = [
  '/assets/fonts/inter-latin-variable.woff2',
  '/assets/fonts/jetbrains-mono-latin-variable.woff2',
].map((href) =>
  // crossorigin needs an explicit value: the head-fragment sanitizer strips
  // the bare form, and a no-cors preload would fetch the font twice.
  `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin="anonymous" />`
).join('');
const prismThemeStyle = `<style>${
  readFileSync(new URL('./public/assets/vendor/prism/prism.min.css', import.meta.url), 'utf-8')
}</style>`;

const openElementPlugins = openElement({
  routesDir: 'app/routes',
  islandsDir: 'app/islands',
  componentsDir: 'app/components',
  html: {
    title: 'openElement',
  },
  appShell: {
    tagName: 'open-layout',
    import: new URL('./app/islands/open-layout.tsx', import.meta.url).pathname,
    props: {
      footerText: 'Built with OpenElement — Web Components-native application framework',
    },
  },
  packageIslands: ['@openelement/ui'],
  ssr: {
    noExternal: ['@openelement/ui'],
  },
  viewTransition: true,
  speculation: true,
  inject: {
    // No external stylesheets: the Prism theme is inlined (see prismThemeStyle
    // below) — nothing render-blocking may be served from a third-party origin.
    stylesheets: [],
    // All scripts are same-origin. Prism is vendored under
    // public/assets/vendor/prism/ (pinned 1.29.0, SRI-verified against the
    // former cdnjs hashes at vendor time — see #1088); theme-init is inlined
    // instead of requested; goatcounter was removed (unreachable from CN
    // networks, cost a console error + best-practices points on every page).
    scripts: [
      { src: '/theme-init.js' },
      { src: '/logo-home.js', defer: true },
      { src: '/assets/vendor/prism/prism.min.js', defer: true },
      { src: '/assets/vendor/prism/prism-javascript.min.js', defer: true },
      { src: '/assets/vendor/prism/prism-typescript.min.js', defer: true },
      { src: '/assets/vendor/prism/prism-json.min.js', defer: true },
      { src: '/assets/vendor/prism/prism-bash.min.js', defer: true },
      { src: '/assets/vendor/prism/prism-css.min.js', defer: true },
      { src: '/assets/vendor/prism/prism-markup.min.js', defer: true },
      { src: '/prism-init.js', defer: true },
    ],
    headFragments: [
      // Site-wide head only (Beta.2.2, #1327): per-page meaning — title,
      // description, og:title/og:description/og:url, canonical, hreflang —
      // is declared by each route module's descriptor head and serialized at
      // SSG time (www/app/site-ui/head.ts). Nothing rewrites <head> after the
      // build anymore, so no page-level boilerplate may live here: a
      // boilerplate og:title/description would duplicate the page's own.
      '<meta property="og:site_name" content="OpenElement">',
      '<meta property="og:type" content="website">',
      '<meta property="og:image" content="https://openelement.org/assets/og-image.svg">',
      '<meta name="twitter:card" content="summary_large_image">',
      '<style>html{visibility:visible!important;}body{background:var(--bg-base);color:var(--text-primary);}</style>',
      fontPreloads,
      '<link rel="icon" type="image/svg+xml" href="/assets/open-favicon.svg" />',
      '<link rel="apple-touch-icon" href="/assets/open-avatar.svg" />',
      colorTokensStyle,
      prismThemeStyle,
    ],
  },
  content: {
    collections: articleCollections,
    blog: {
      contentDir: 'content/blog',
      basePath: '/blog',
    },
    nav: {
      routesDir: 'app/routes',
      // Minimal headerNav; open-layout auto-filters sidebar.
      // v0.31 UI-shell debt: derive this from route meta scanning.
      headerNav: [
        { href: '/docs', label: 'Docs' },
        { href: '/apilist', label: 'API' },
        { href: '/roadmap', label: 'Roadmap' },
        { href: '/blog', label: 'Blog' },
        { href: 'https://github.com/open-element/openelement', label: 'GitHub' },
      ],
    },
    // sitemap.xml/robots.txt are generated by tools/generate-www-sitemap.ts
    // from the route catalog + explicit public eligibility (Beta.2.2, #1327) —
    // never by scanning built output — so no adapter `sitemap` options here.
  },
  i18n: {
    locales: ['en', 'zh'],
    defaultLocale: 'en',
  },
});

export default defineConfig({
  resolve: {
    alias: {
      '@openelement/site-ui': new URL('./app/site-ui', import.meta.url).pathname,
    },
  },
  base: '/',
  build: {
    chunkSizeWarningLimit: 600,
  },
  // Keep Vite's automatic JSX transform aligned with the workspace compiler.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: '@openelement/element',
  },
  plugins: openElementPlugins,
});
registerOpenUi();
