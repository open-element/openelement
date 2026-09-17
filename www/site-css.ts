/**
 * The document-level stylesheet of the www site.
 *
 * Every rule here targets html/body or defines document-root aliases — subjects
 * that live outside every component @scope, which is why they cannot live in
 * component sheets. Component-local concerns (including language variants via
 * subject-side `:lang(zh)`) belong in the component sheets instead.
 */
export const siteCSS = `
:root,
html[data-theme="light"],
:host([data-theme="light"]),
:root[data-theme="light"] {
  --surface-1: var(--bg-elevated);
  --surface-code: var(--bg-code);
  --edge-highlight: color-mix(in srgb, var(--text-primary) 10%, transparent);
  --border-strong: color-mix(in srgb, var(--border) 68%, var(--text-primary));
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
  --surface-1: var(--bg-elevated);
  --surface-code: var(--bg-code);
  --edge-highlight: color-mix(in srgb, var(--text-primary) 14%, transparent);
  --border-strong: color-mix(in srgb, var(--border) 72%, var(--text-primary));
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
    var(--bg-base);
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
@media (prefers-contrast: more) {
  /* Collapse the muted step onto secondary ink (theme-aware both ways). */
  :root { --text-muted: var(--text-secondary); }
}
/* Reading-page print: chrome goes away, ink goes black on white, and content
   links carry their target so the paper copy stays navigable. */
@media print {
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
  .article-content a[href]::after {
    content: " (" attr(href) ")";
    font-size: 0.85em;
    word-break: break-all;
  }
  .article-content a[href^="#"]::after {
    content: none;
  }
}`;
