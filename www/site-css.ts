/**
 * The document-level stylesheet of the www site.
 *
 * Every rule here targets html/body or defines document-root aliases — subjects
 * that live outside every component @scope, which is why they cannot live in
 * component sheets. Component-local concerns (including language variants via
 * subject-side `:lang(zh)`) belong in the component sheets instead.
 *
 * One subject is document-level for an engine reason rather than a layering
 * one: content SLOTTED into a shadow host's `<slot>` (open-code-block's
 * projected `<pre>`). A component sheet compiles to `@scope (<host-tag>)`,
 * and WebKit does not apply scoped rules to slotted light DOM — measured
 * 2026-10-09 on the built home page: a plain descendant rule inside the scope
 * applied, while `open-code-block pre` and `open-code-block` itself kept their
 * unscoped values (Chromium applied both). The document layer reaches the
 * slotted element in every engine, so the code-block surface is stated here.
 *
 * `documentStyle` is the same layer one step further out: the body baseline,
 * composed with `siteCSS` into the single inline <style> the document head
 * carries. It lives here rather than in app/head.tsx because
 * check-site-theme-tokens.ts scans www/app for hardcoded theme values; this
 * module is the site's designated style layer (the gate's own doctrine
 * names it). The @font-face faces moved out of this body in #1554: they are
 * delivered by the version-pinned fontsource stylesheets that app/head.tsx
 * links (with SRI), so the family names in the stacks below must match
 * fontsource's families ('Inter Variable', 'JetBrains Mono Variable',
 * 'Instrument Serif').
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
  --surface-code: var(--color-muted);
  --surface-code-foreground: var(--color-zinc-800);
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
     token table ships TW4 defaults only, so the brand stacks live here; the
     faces themselves are delivered by the fontsource stylesheets in
     app/head.tsx (#1554), and the family names must match fontsource's.
     Mono covers code, labels, eyebrows and nav; serif covers the zh italic
     accents. */
  --font-mono: 'JetBrains Mono Variable', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace;
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
  --surface-code-foreground: var(--color-zinc-200);
  --edge-highlight: color-mix(in srgb, var(--color-foreground) 14%, transparent);
  --border-strong: color-mix(in srgb, var(--color-border) 72%, var(--color-foreground));
  --nav-bg: var(--color-background);
  --nav-height: calc(var(--spacing) * 16);
}
body {
  margin: 0;
  background:    radial-gradient(circle at 50% -12%, color-mix(in srgb, var(--color-ring) 24%, transparent), transparent 42%),
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
/* The code-block surface (open-code-block's slotted <pre>), owned here for the
   engine reason in the module doc. Two surface levels only: this block surface
   (--surface-code with its paired ink) and the page paper; the block owns its
   own horizontal scroll so a long line never widens the page, and the
   padding/border/radius repeat the article fences' declaration (see
   open-article-view.css, the .article-content pre rule), so a code block reads
   the same wherever it appears. Shiki paints the pre's background/color inline
   from --shiki-background/--shiki-foreground, which alias the same two tokens,
   so the inline style and this rule agree by construction. */
open-code-block pre {
  max-width: 100%;
  margin: 0;
  padding: calc(var(--spacing) * 4);
  border: 0.5px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--surface-code);
  color: var(--surface-code-foreground);
  overflow-x: auto;
  font-size: var(--text-sm);
  line-height: 1.6;
}
/* Build-time syntax highlighting palette (www/lib/markdown.ts, issue #1552).
   Shiki's css-variables theme emits token colors as var() references, so this
   table is the single resolver: the values flip with data-theme and inherit
   into every shadow tree — page prose renders inside page-component shadow
   roots, where [data-theme] selectors cannot reach. Light values are the
   bundled github-light palette; dark values are the bundled github-dark
   palette except the comment gray, where the retired Prism chip styles'
   measured #7d8590 (5.2:1 on the dark surface; #6a737d was 4.0:1) carries
   over. The code surface stays site-owned: the theme's background and
   foreground alias --surface-code / --surface-code-foreground. */
:root {
  --shiki-background: var(--surface-code);
  --shiki-foreground: var(--surface-code-foreground);
  --shiki-token-comment: #57606a;
  --shiki-token-punctuation: #24292e;
  --shiki-token-constant: #005cc5;
  --shiki-token-string: #032f62;
  --shiki-token-string-expression: #032f62;
  --shiki-token-keyword: #cb2431;
  --shiki-token-function: #6f42c1;
  --shiki-token-parameter: #9a4d00;
  --shiki-token-link: #032f62;
  --shiki-token-inserted: #1a7f37;
  --shiki-token-deleted: #b31d28;
  --shiki-token-changed: #9a4d00;
}
:root[data-theme='dark'] {
  --shiki-background: var(--surface-code);
  --shiki-foreground: var(--surface-code-foreground);
  --shiki-token-comment: #7d8590;
  --shiki-token-punctuation: #e1e4e8;
  --shiki-token-constant: #79b8ff;
  --shiki-token-string: #9ecbff;
  --shiki-token-string-expression: #9ecbff;
  --shiki-token-keyword: #f97583;
  --shiki-token-function: #b392f0;
  --shiki-token-parameter: #ffab70;
  --shiki-token-link: #9ecbff;
  --shiki-token-inserted: #aff5b1;
  --shiki-token-deleted: #ffb1b1;
  --shiki-token-changed: #ffab70;
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
 * The complete document-level style body: the body baseline and the site
 * rules. The @font-face faces are not part of this body — they arrive through
 * the fontsource stylesheets app/head.tsx links (#1554), whose download
 * starts before this inline style paints, so the preloaded font files
 * (#1088) are usable at first paint. The theme token table is not part of
 * this body either — the preset's linked bundle carries it (see the module
 * doc). app/head.tsx wraps this in one <style> entry.
 */
export const documentStyle = `body{font-family:var(--font-sans);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}${siteCSS}`;
