/**
 * The document-level stylesheet of the www site.
 *
 * Every rule here targets html/body or defines document-root aliases — subjects
 * that live outside every component @scope, which is why they cannot live in
 * component sheets. Component-local concerns (including language variants via
 * subject-side `:lang(zh)`) belong in the component sheets instead.
 *
 * `documentStyle` is the same layer one step further out: the site's
 * @font-face faces plus the body baseline, composed with `siteCSS` into the
 * single inline <style> the document head carries. It lives here rather than
 * in app/head.tsx because check-site-theme-tokens.ts scans www/app for
 * hardcoded theme values; font faces are definitions, and this module is the
 * site's designated home for them (the site style layer the gate's own
 * doctrine names).
 *
 * Token delivery (alpha9 C4, #1507; twin retired alpha9 C5): the site build
 * enables the router's Tailwind preset (see vite.config.ts), so the @theme
 * role table (packages/ui/src/theme.css) ships through the preset's linked,
 * layer-ordered bundle — NOT as an inline copy here. The ui package carries
 * no scale values of its own (the compiled theme-tokens twin is deleted), so
 * there is no fallback sheet to inline: if the preset ever turns off, the
 * site must supply its own role table first (the OFF contract,
 * packages/ui/CUSTOMIZATION.md "Value delivery") — carrying a duplicated
 * table inline would also trip the preset's full-inline prohibition
 * (assertNoGlobalSheetInline).
 */

/**
 * Central viewport tier scale (px). Every bare-number @media width/height
 * breakpoint in www/app and www/site-css.ts must be one of these —
 * check-site-theme-tokens.ts enforces it, so a new tier is a deliberate
 * edit here, not a scattered literal. rem/ch/% layout measures and
 * element-relative @container widths are not viewport tiers and stay out
 * of this list. 901 is the 900 desktop complement (min-width side).
 */
export const SITE_BREAKPOINT_TIERS = [
  480, 520, 640, 700, 720, 760, 768, 860, 900, 901, 940, 1040, 1100, 1120, 1200,
] as const;
export const siteCSS = `
:root,
html[data-theme="light"],
:host([data-theme="light"]),
:root[data-theme="light"] {
  --surface-1: var(--color-popover);
  --surface-code: var(--color-zinc-950);
  --edge-highlight: color-mix(in srgb, var(--color-foreground) 10%, transparent);
  --border-strong: color-mix(in srgb, var(--color-border) 68%, var(--color-foreground));
  --nav-bg: var(--color-background);
  --nav-height: calc(var(--spacing) * 16);
  --nav-link-color: var(--color-foreground);
  --nav-link-hover: color-mix(in srgb, var(--color-primary) 50%, var(--color-foreground));
  --font-size-button: var(--text-sm);
  --font-size-body-sm: var(--text-sm);
  --font-size-caption: var(--text-xs);
  --font-size-micro: 0.625rem;
  --font-size-tiny: 0.85rem;
  --font-size-lede: 1.1rem;
  --font-size-overline: 0.6875rem;
  --font-size-article-title: 1.125rem;
  --font-size-display-sm: 1.75rem;
  --font-size-display-md: 2.125rem;
  --font-size-display-lg: 2.625rem;
  /* --font-weight-medium is NOT re-aliased here: it is a real scale variable
     (--font-weight-medium: 500), and aliasing it to itself through the scale
     would create a cycle that invalidates both. --font-weight-semibold stays
     an override: the scale ships 600, the site's semibold voice is 700, and
     --font-weight-bold carries exactly that. */
  --font-weight-semibold: var(--font-weight-bold);
  /* Site identity faces, re-homed from the retired ui sheet (#1504): the
     token table ships TW4 defaults only, so the brand stacks live here where
     their @font-face declarations live too. Mono covers code, labels,
     eyebrows and nav; serif covers the zh italic accents. */
  --font-mono: 'JetBrains Mono', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace;
  --font-serif: 'Instrument Serif', 'Songti SC', 'Noto Serif CJK SC', serif;
  /* Site layout constants, re-homed from the retired ui sheet: page-level
     measures, not component tokens. rem-exact values of the retired px. */
  --site-container: 70rem; /* 1120px */
  --site-container-wide: 77.5rem; /* 1240px */
  --site-container-reading: 47.5rem; /* 760px */
  /* Cinematic hero palette: the homepage hero is always dark, independent of
     the site theme. Defined once here (this layer) so components never
     carry raw hex literals (site theme-token gate). */
  --hero-ink: #000;
  --hero-paper: #f4f1ea;
  --hero-gold: #e3cf9f;
  --hero-gold-muted: #b9ad93;
  --hero-gold-line: #d8c49a;
  /* Site override: real sans for prose. The shared token sheet maps
     --font-sans to JetBrains Mono (brand choice for the component layer);
     long-form reading on this site needs a true sans. Mono stays on
     --font-mono (code, labels, eyebrows, nav) — nothing else changes. */
  --font-sans: 'Inter Variable', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}
html[data-theme="dark"],
:host([data-theme="dark"]),
:root[data-theme="dark"] {
  --surface-1: var(--color-popover);
  --surface-code: var(--color-zinc-950);
  --edge-highlight: color-mix(in srgb, var(--color-foreground) 14%, transparent);
  --border-strong: color-mix(in srgb, var(--color-border) 72%, var(--color-foreground));
  --nav-bg: var(--color-background);
  --nav-height: calc(var(--spacing) * 16);
}
body {
  margin: 0;
  background:
    radial-gradient(circle at 50% -12%, color-mix(in srgb, var(--color-ring) 24%, transparent), transparent 42%),
    linear-gradient(115deg, color-mix(in srgb, var(--color-secondary) 38%, transparent), transparent 46%),
    linear-gradient(color-mix(in srgb, var(--color-border) 34%, transparent) calc(var(--spacing) * 0.25), transparent calc(var(--spacing) * 0.25)),
    linear-gradient(90deg, color-mix(in srgb, var(--color-border) 30%, transparent) calc(var(--spacing) * 0.25), transparent calc(var(--spacing) * 0.25)),
    var(--color-background);
  background-size: auto, auto, 220px 128px, 220px 128px, auto;
  color: var(--color-foreground);
  font-family: var(--font-sans);
  line-height: 1.7;
}
::view-transition-old(open-brand-mark),
::view-transition-new(open-brand-mark) { animation-duration: 320ms; animation-timing-function: var(--ease-out); }
::selection {
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  color: var(--color-foreground);
}
/* Site-wide keyboard-focus baseline (light DOM). Every island that renders
   light roots — the layout shell, the search island — and every bare document
   link gets one ring shape; shadow components carry their own (page-styles
   already seats the same pair on each page tag). The ring role keeps the
   indicator on the token table in both themes; forced-colors remaps below. */
:focus-visible {
  outline: 2px solid var(--color-ring);
  outline-offset: 2px;
}
/* User-preference adaptations (document-level: custom properties inherit
   into every shadow tree, so one rule covers components too). */
@media (forced-colors: active) {
  /* Links distinguished by color alone collapse into surrounding text when
     the palette flattens: underline every link. !important outranks the
     scoped prose rules that otherwise remove underlines. Borders keep their
     width and map to system colors on their own; the outline focus ring
     remaps. */
  a { text-decoration: underline !important; }
  :focus-visible { outline: 2px solid Highlight; }
}
/* Reading-page print: chrome goes away, ink goes black on white, and content
   links carry their target so the paper copy stays navigable. Token
   remapping (not selector enumeration) carries the whole prose surface —
   h2/h3, code, strong, tables — including dark mode, where near-white ink
   would otherwise vanish on paper. */
@media print {
  :root, :root[data-theme='dark'] {
    --color-foreground: #000; --color-muted-foreground: #000;
    --color-background: #fff; --color-muted: #fff; --color-card: #fff;
    --color-popover: #fff;
  }
  .app-header,
  .docs-sidebar,
  .sidebar-mobile-panel,
  .mobile-menu-panel,
  aside.rail,
  nav.breadcrumb,
  nav.pager,
  .app-footer,
  open-search {
    display: none !important;
  }
  body {
    background: #fff !important;
    color: #000 !important;
  }
  .main,
  .article-content,
  .article-content p,
  .article-content li,
  .title,
  .lede {
    color: #000 !important;
  }
  /* Keep code blocks, figures and tables whole across page breaks. */
  pre,
  figure,
  table,
  open-code-block {
    break-inside: avoid;
  }
  /* attr(href) prints relative paths, useless on paper: expand only
     absolute URLs and say so. */
  .article-content a[href^="http"]::after,
  .article-content a[href^="https://"]::after {
    content: " (" attr(href) ")";
    font-size: 0.85em;
    word-break: break-all;
  }
}`;

// Token note (see the module doc): the theme layer comes from the preset's
// linked bundle asset, so nothing here re-declares it. Shadow trees keep
// inheriting the variables from the document root the same as before — the
// delivery changed, the inheritance contract did not.

/**
 * The site's font faces. Three faces, deliberately: the two text faces (prose
 * Inter, code JetBrains Mono) plus the Instrument Serif accent; the two text
 * faces are also preloaded in app/head.tsx (critical-path hardening, #1088).
 */
const fontFaces = `@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:100 800;font-display:swap;src:url('/assets/fonts/jetbrains-mono-latin-variable.woff2') format('woff2')}@font-face{font-family:'Instrument Serif';font-style:normal;font-weight:400;font-display:swap;src:url('/assets/fonts/instrument-serif-latin-regular.woff2') format('woff2')}@font-face{font-family:'Instrument Serif';font-style:italic;font-weight:400;font-display:swap;src:url('/assets/fonts/instrument-serif-latin-italic.woff2') format('woff2')}@font-face{font-family:'Inter Variable';font-style:normal;font-weight:100 900;font-display:swap;src:url('/assets/fonts/inter-latin-variable.woff2') format('woff2')}`;

/**
 * The complete document-level style body: faces first (so the preloaded files
 * are usable at first paint), then the body baseline and the site rules. The
 * theme token table is not part of this body — the preset's linked bundle
 * carries it (see the module doc). app/head.tsx wraps this in one <style>
 * entry.
 */
export const documentStyle = `${fontFaces}body{font-family:var(--font-sans);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}${siteCSS}`;
