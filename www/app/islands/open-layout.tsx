/** @jsxImportSource @openelement/element */
/** Compiler-owned WWW app shell (v0.44, ADR-0143). */
import { defineIslandConfig } from '@openelement/router';
import { computed, element, OpenElement, property } from '@openelement/element';
import '@openelement/ui/open-theme-toggle';
import { SITE_DEFAULT_LOCALE } from '../../site-config.ts';
import { compiledStyle } from '../site-ui/compiled-style.ts';
import {
  buildSidebarRows,
  type DecoratedHeaderNavLink,
  decorateHeaderNav,
  footerColumn,
  type FooterLink,
  type HeaderNavLink,
  layoutChromeStrings,
  localeSwitchLabel,
  localeSwitchPath,
  localeSwitchScopeNote,
  type NavSection,
  type SidebarRow,
} from '../site-ui/open-layout-navigation.ts';
import { searchChromeStrings } from '../site-ui/chrome-strings.ts';
import './open-search.tsx';

type CompiledComputed<T> = ReturnType<typeof computed<T>> & T;

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

@element('open-layout')
export default class OpenLayout extends OpenElement {
  static override styles = [
    compiledStyle(`
  :host {
    display: block;
  }

  * { font-family: var(--font-sans); }

  .app-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background: var(--color-background);
    color: var(--color-foreground);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .layout-body {
    display: flex;
    flex: 1;
    max-width: none;
    margin: 0 auto;
    width: 100%;
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--color-border) 18%, transparent) 1px, transparent 1px),
      var(--color-background);
    background-size: 220px 100%;
  }

  .layout-main {
    flex: 1;
    min-width: 0;
    width: 100%;
    isolation: isolate;
  }

  /* Skip link: visually hidden until keyboard focus (#D-8). */
  .skip-link {
    position: absolute;
    inset-block-start: calc(var(--spacing) * 2);
    inset-inline-start: calc(var(--spacing) * 4);
    z-index: 200;
    padding: calc(var(--spacing) * 2) calc(var(--spacing) * 4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-popover);
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-decoration: none;
  }
  .skip-link:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 3px;
  }
  .skip-link:not(:focus-visible),
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .locale-switch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: calc(var(--spacing) * 9);
    padding: 0 calc(var(--spacing) * 2);
    border: 0;
    border-radius: calc(infinity * 1px);
    background: transparent;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: .02em;
    text-decoration: none;
    white-space: nowrap;
    transition: all 0.15s ease;
  }
  .locale-switch:hover {
    color: var(--color-primary);
    background: color-mix(in srgb, color-mix(in srgb, var(--color-primary) 18%, transparent) 34%, transparent);
  }
  .locale-switch:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 3px;
  }

  /* Repository link: same 36px round target as the search trigger beside it. */
  .repository-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: calc(var(--spacing) * 9);
    height: calc(var(--spacing) * 9);
    padding: 0;
    border: 0;
    border-radius: calc(infinity * 1px);
    background: transparent;
    color: var(--color-foreground);
    transition: all cubic-bezier(0.45, 0, 0.25, 1) 200ms;
  }
  .repository-link:hover {
    color: var(--color-primary);
    background: color-mix(in srgb, color-mix(in srgb, var(--color-primary) 18%, transparent) 34%, transparent);
  }
  .repository-link:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 3px;
  }
  .repository-link svg {
    width: calc(var(--spacing) * 5);
    height: calc(var(--spacing) * 5);
    fill: currentColor;
  }

  /* Header */
  .app-header {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--nav-bg);
    border-bottom: 1px solid var(--color-border);
    backdrop-filter: blur(18px) saturate(150%);
    -webkit-backdrop-filter: blur(18px) saturate(150%);
    transition: background .32s cubic-bezier(0.2, 0.8, 0.2, 1), border-color .32s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow .32s cubic-bezier(0.2, 0.8, 0.2, 1), padding .32s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .header-inner {
    max-width: none;
    margin: 0 auto;
    padding: 0 clamp(calc(var(--spacing) * 5), 3.5vw, calc(var(--spacing) * 9));
    display: flex;
    align-items: center;
    min-height: var(--nav-height);
    gap: calc(var(--spacing) * 6);
  }

  .mobile-menu-btn {
    display: none;
    align-items: center;
    justify-content: center;
    width: calc(var(--spacing) * 10);
    height: calc(var(--spacing) * 10);
    border: 1px solid var(--color-border);
    border-radius: calc(infinity * 1px);
    background: color-mix(in srgb, var(--color-popover) 74%, transparent);
    color: var(--color-muted-foreground);
    cursor: pointer;
    padding: 0;
    transition: all 0.15s ease;
  }
  .mobile-menu-btn:hover {
    color: var(--color-foreground);
    border-color: var(--color-input);
    background: var(--color-accent);
  }
  .mobile-menu {
    position: relative;
  }
  .mobile-menu-btn {
    list-style: none;
  }
  .mobile-menu-btn::-webkit-details-marker {
    display: none;
  }
  .mobile-menu-btn::marker {
    content: "";
  }
  .mobile-menu-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .mobile-menu-icon {
    font-size: var(--text-xl);
    line-height: 1;
  }
  .mobile-menu-panel {
    position: absolute;
    inset-block-start: calc(100% + calc(var(--spacing) * 2));
    inset-inline-end: 0;
    z-index: 110;
    display: grid;
    min-width: 12rem;
    padding: calc(var(--spacing) * 2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-popover);
    box-shadow: 0 20px 60px color-mix(in srgb, var(--color-foreground) 20%, transparent);
  }
  .mobile-menu-panel a {
    padding: calc(var(--spacing) * 2) calc(var(--spacing) * 3);
    border-radius: var(--radius-md);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-decoration: none;
  }
  .mobile-menu-panel a:hover,
  .mobile-menu-panel a:focus-visible {
    color: var(--color-foreground);
    background: var(--color-accent);
  }

  .logo {
    display: inline-flex;
    align-items: center;
    gap: calc(var(--spacing) * 3);
    flex: 0 0 auto;
    min-height: calc(var(--spacing) * 10);
    width: 52px;
    min-width: 52px;
    max-width: 52px;
    background: transparent;
    font-size: var(--text-2xl);
    font-weight: var(--font-weight-extrabold);
    color: var(--color-foreground);
    text-decoration: none;
    letter-spacing: 0;
    white-space: nowrap;
  }

  .logo:hover .logo-glyph {
    transform: translateY(calc(1px * -1));
  }

  .logo-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    width: 48px;
    height: 48px;
    max-width: 100%;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 800;
    letter-spacing: -.09em;
    line-height: 1;
    white-space: nowrap;
    transition: transform 200ms cubic-bezier(0.45, 0, 0.25, 1);
    view-transition-name: open-brand-mark;
  }

  .logo-slash {
    color: var(--color-primary);
  }

  .logo:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 3px;
    border-radius: var(--radius-lg);
  }

  .header-nav {
    display: flex;
    gap: calc(var(--spacing) * 1);
    flex: 1;
    min-width: 0;
    justify-content: center;
    width: fit-content;
    max-width: fit-content;
    margin-inline: auto;
    padding: calc(var(--spacing) * 1);
    border: 1px solid color-mix(in srgb, var(--color-border) 78%, var(--color-primary));
    border-radius: calc(infinity * 1px);
    background: color-mix(in srgb, var(--color-popover) 68%, transparent);
    box-shadow: inset 0 1px 0 var(--edge-highlight);
  }
  .header-nav a {
    color: var(--nav-link-color);
    text-decoration: none;
    font-weight: var(--font-weight-medium);
    padding: calc(var(--spacing) * 2) calc(var(--spacing) * 4);
    border-radius: calc(infinity * 1px);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: .02em;
    transition: color .2s cubic-bezier(0.2, 0.8, 0.2, 1), background .2s cubic-bezier(0.2, 0.8, 0.2, 1), transform .2s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .header-nav a:hover {
    color: var(--nav-link-hover);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    transform: translateY(-1px);
  }
  .header-nav a[aria-current="page"] {
    color: var(--color-foreground);
    font-weight: var(--font-weight-extrabold);
    background: color-mix(in srgb, var(--color-primary) 18%, var(--color-popover));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 44%, transparent);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: calc(var(--spacing) * 1);
    margin-left: auto;
  }

  /* Sidebar */
  .docs-sidebar {
    width: clamp(200px, 20vw, 260px);
    flex-shrink: 0;
    border-right: 1px solid var(--color-border);
    padding: 2rem 0;
    overflow-y: auto;
    height: calc(100vh - var(--nav-height));
    position: sticky;
    top: var(--nav-height);
    scrollbar-width: thin;
    background: linear-gradient(180deg,color-mix(in srgb,color-mix(in srgb, var(--color-primary) 16%, var(--color-background)) 26%,var(--color-background)),color-mix(in srgb,var(--color-popover) 72%,transparent));
    backdrop-filter: blur(20px) saturate(140%);
    box-shadow: inset -1px 0 0 color-mix(in srgb,var(--color-primary) 10%,transparent);
  }
  .docs-sidebar[hidden] {
    display: none;
  }

  .nav-row[data-kind="section"] {
    margin: 1.5rem 0 0.5rem;
  }
  .nav-row[data-kind="section"]:first-child {
    margin-top: 0;
  }
  .nav-heading {
    display: flex;
    align-items: center;
    font-size: var(--font-size-micro);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--color-muted-foreground);
    padding: 0 1.5rem;
    user-select: none;
  }

  .docs-sidebar a,
  .sidebar-mobile-panel a {
    display: block;
    color: var(--color-muted-foreground);
    text-decoration: none;
    font-size: var(--font-size-tiny);
    margin: .12rem .7rem;
    padding: .5rem .8rem;
    border-left: 2px solid transparent;
    border-radius: var(--radius-lg);
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  }
  .docs-sidebar a:hover,
  .sidebar-mobile-panel a:hover {
    color: var(--color-muted-foreground);
    background: var(--color-accent);
  }
  .docs-sidebar a[aria-current="page"],
  .sidebar-mobile-panel a[aria-current="page"] {
    color: var(--color-primary);
    border-left-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 14%, transparent);
    font-weight: 600;
  }
  .nav-row[data-kind="section"] a,
  .nav-row[data-kind="link"] .nav-heading {
    display: none;
  }

  /* Mobile section navigation: native details disclosure (#995 idiom, shared
     with open-page-rail — the compiled shell ships no imperative drawer). */
  .sidebar-mobile {
    display: none;
  }

  /* Footer */
  .app-footer {
    border-top: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-popover) 58%, transparent);
  }
  .footer-inner {
    max-width: var(--site-container-wide);
    margin: 0 auto;
    padding: calc(var(--spacing) * 16) calc(var(--spacing) * 8);
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: calc(var(--spacing) * 8);
  }
  .footer-heading {
    display: block;
    font-size: var(--font-size-button);
    font-weight: var(--font-weight-semibold);
    color: var(--color-foreground);
    margin: 0 0 calc(var(--spacing) * 4);
  }
  .footer-column a {
    display: block;
    color: var(--color-muted-foreground);
    text-decoration: none;
    font-size: var(--font-size-body-sm);
    padding: 4px 0;
    transition: color 0.15s ease;
  }
  .footer-column a:hover {
    color: var(--color-foreground);
  }
  .footer-bottom {
    border-top: 1px solid var(--color-border);
    padding: calc(var(--spacing) * 4) calc(var(--spacing) * 8);
    max-width: var(--site-container-wide);
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: calc(var(--spacing) * 4);
    color: var(--color-muted-foreground);
    font-size: var(--font-size-body-sm);
  }

  /* Responsive */
  @media (max-width: 1120px) {
    .header-inner {
      gap: calc(var(--spacing) * 3);
      padding-inline: calc(var(--spacing) * 4);
    }

    .header-nav {
      gap: calc(var(--spacing) * 3);
    }
  }

  @media (max-width: 1040px) {
    .header-nav { display: none; }
  }

  @media (max-width: 900px) {
    .mobile-menu-btn { display: flex; }
    .header-inner { padding: 0 calc(var(--spacing) * 4); gap: calc(var(--spacing) * 2); }
    .header-nav { display: none; }
    .header-right { gap: 4px; }

    .docs-sidebar { display: none; }
    .sidebar-mobile {
      display: block;
      margin: calc(var(--spacing) * 4) calc(var(--spacing) * 4) 0;
    }
    .sidebar-mobile[hidden] { display: none; }
    .sidebar-mobile-toggle {
      cursor: pointer;
      color: var(--color-foreground);
      font-family: var(--font-mono);
      font-size: var(--text-xs);
      font-weight: var(--font-weight-extrabold);
      letter-spacing: .12em;
      text-transform: uppercase;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: calc(var(--spacing) * 3) calc(var(--spacing) * 4);
      background: var(--surface-1);
    }
    .sidebar-mobile-panel { padding-block-start: calc(var(--spacing) * 3); }
    .sidebar-mobile .nav-row[data-kind="section"] { margin: 0.5rem 0 0; }
    .sidebar-mobile .nav-heading { padding: calc(var(--spacing) * 2) calc(var(--spacing) * 4); }
    .sidebar-mobile-panel a { padding: 0.5rem 1rem 0.5rem 2rem; }

    .layout-main { width: 100%; }
    .footer-inner {
      grid-template-columns: repeat(2, 1fr);
      padding: calc(var(--spacing) * 12) calc(var(--spacing) * 4);
    }
    .footer-bottom {
      flex-direction: column;
      gap: calc(var(--spacing) * 2);
      padding: calc(var(--spacing) * 4);
      text-align: center;
    }
  }

  @media (max-width: 768px) {
    .header-right { gap: 4px; }
  }
  @media (max-width: 480px) {
    .header-inner { padding: 0 calc(var(--spacing) * 3); gap: calc(var(--spacing) * 1); }
  }
`),
  ];

  @property({ reflect: false })
  headerNav: HeaderNavLink[] = [];

  @property({ reflect: false })
  footerText = 'Built with OpenElement';

  @property({ reflect: false })
  siteName = 'openElement';

  @property({ reflect: false })
  homeHref = '/';

  @property({ reflect: false })
  navItems: NavSection[] = [];

  @property({ reflect: false })
  currentPath = '';

  // Re-declares the optional base field (OpenElementConfiguration.locale) as a
  // compiled @property. The `override` modifier that tsc would demand here is
  // rejected by the compiled-element grammar (OEC9005 — property fields must be
  // ordinary initialized fields), so the TS diagnostic is expected.
  @property({ reflect: false })
  // @ts-expect-error compiled @property shadows the optional base field
  locale = 'en';

  @property({ reflect: false })
  locales: string[] = ['en'];

  @property({ reflect: true })
  home = false;

  // ─── Derived chrome state ────────────────────────────────────────────
  // The list-Region grammar (OEC9013) requires `.map()` to run over a
  // `this.<property>`, so the derived rows/links live in computed() signal
  // properties over the plain shell props. The property-contract layer
  // guarantees attribute promotion happens before claim-time reads and that
  // generated field initializers (which only restate the compiled default)
  // never clobber the promoted attribute values — see facade-host.ts
  // restatesDefault.

  @property({ reflect: false, attribute: false })
  headerNavItems = computed(() =>
    decorateHeaderNav(this.headerNav, this.currentPath, this.locale, this.locales),
  ) as CompiledComputed<DecoratedHeaderNavLink[]>;

  @property({ reflect: false, attribute: false })
  sidebarLabel = computed(() => layoutChromeStrings(this.locale).sidebarLabel);

  @property({ reflect: false, attribute: false })
  sidebarToggle = computed(() => layoutChromeStrings(this.locale).sidebarToggle);

  @property({ reflect: false, attribute: false })
  skipToMain = computed(() => layoutChromeStrings(this.locale).skipToMain);

  @property({ reflect: false, attribute: false })
  menuOpen = computed(() => layoutChromeStrings(this.locale).menuOpen);

  @property({ reflect: false, attribute: false })
  primaryNavLabel = computed(() => layoutChromeStrings(this.locale).primaryNavLabel);

  @property({ reflect: false, attribute: false })
  mobileNavLabel = computed(() => layoutChromeStrings(this.locale).mobileNavLabel);

  // Repository link in the header cluster: constant target, bilingual label.
  // Plain literal default — the compiler rejects module-scope identifiers in
  // property defaults; www/__tests__/site-ui.test.ts pins it to REPOSITORY_URL
  // so the header and the footer link cannot drift apart.
  @property({ reflect: false, attribute: false })
  repositoryHref = 'https://github.com/open-element/openelement';

  @property({ reflect: false, attribute: false })
  repositoryLabel = computed(() => layoutChromeStrings(this.locale).repositoryLabel);

  // Locale switcher: localeSwitchPath degrades route patterns (/:slug) to
  // their static ancestor, so dynamic routes never emit a literal param href.
  @property({ reflect: false, attribute: false })
  switchLocaleHref = computed(() =>
    localeSwitchPath(this.currentPath || '/', this.locale, this.locales, SITE_DEFAULT_LOCALE),
  );

  @property({ reflect: false, attribute: false })
  switchLocaleLabel = computed(() => localeSwitchLabel(this.locale));

  @property({ reflect: false, attribute: false })
  switchLocaleNote = computed(() => localeSwitchScopeNote(this.locale));

  @property({ reflect: false, attribute: false })
  sidebarRows = computed(() =>
    buildSidebarRows(this.navItems, this.currentPath, this.locale, this.locales),
  ) as CompiledComputed<SidebarRow[]>;

  @property({ reflect: false, attribute: false })
  sidebarHidden = computed(
    () =>
      this.home ||
      buildSidebarRows(this.navItems, this.currentPath, this.locale, this.locales).length === 0,
  );

  @property({ reflect: false, attribute: false })
  footerTagline = computed(() => layoutChromeStrings(this.locale).footerTagline || this.footerText);

  @property({ reflect: false, attribute: false })
  footerCopyright = computed(() => layoutChromeStrings(this.locale).footerCopyright);

  // Search chrome copy, finalized at SSR and passed to the island as
  // attributes so nothing rewrites it after hydration.
  @property({ reflect: false, attribute: false })
  searchTriggerLabel = computed(() => searchChromeStrings(this.locale).triggerLabel);
  @property({ reflect: false, attribute: false })
  searchDialogLabel = computed(() => searchChromeStrings(this.locale).dialogLabel);
  @property({ reflect: false, attribute: false })
  searchInputLabel = computed(() => searchChromeStrings(this.locale).inputLabel);
  @property({ reflect: false, attribute: false })
  searchPlaceholder = computed(() => searchChromeStrings(this.locale).placeholder);
  @property({ reflect: false, attribute: false })
  searchResultsLabel = computed(() => searchChromeStrings(this.locale).resultsLabel);
  @property({ reflect: false, attribute: false })
  searchEmptyMessage = computed(() => searchChromeStrings(this.locale).emptyMessage);

  @property({ reflect: false, attribute: false })
  footerProductLabel = computed(() => footerColumn(this.locale, this.locales, 'product').label);
  @property({ reflect: false, attribute: false })
  footerProductLinks = computed(
    () => footerColumn(this.locale, this.locales, 'product').links,
  ) as CompiledComputed<FooterLink[]>;
  @property({ reflect: false, attribute: false })
  footerResourcesLabel = computed(() => footerColumn(this.locale, this.locales, 'resources').label);
  @property({ reflect: false, attribute: false })
  footerResourcesLinks = computed(
    () => footerColumn(this.locale, this.locales, 'resources').links,
  ) as CompiledComputed<FooterLink[]>;
  @property({ reflect: false, attribute: false })
  footerCompanyLabel = computed(() => footerColumn(this.locale, this.locales, 'company').label);
  @property({ reflect: false, attribute: false })
  footerCompanyLinks = computed(
    () => footerColumn(this.locale, this.locales, 'company').links,
  ) as CompiledComputed<FooterLink[]>;
  @property({ reflect: false, attribute: false })
  footerLegalLabel = computed(() => footerColumn(this.locale, this.locales, 'legal').label);
  @property({ reflect: false, attribute: false })
  footerLegalLinks = computed(
    () => footerColumn(this.locale, this.locales, 'legal').links,
  ) as CompiledComputed<FooterLink[]>;

  render() {
    return (
      <div class='app-layout' part='container'>
        <a class='skip-link' href='#main-content' data-pagefind-ignore>
          {this.skipToMain}
        </a>
        <header class='app-header' part='header' data-pagefind-ignore>
          <div class='header-inner'>
            <a class='logo' href={this.homeHref} aria-label={this.siteName}>
              <span class='logo-glyph' aria-hidden='true'>
                {'<open'}
                <span class='logo-slash'>/</span>
                {'>'}
              </span>
            </a>
            <nav class='header-nav' part='nav' aria-label={this.primaryNavLabel}>
              {this.headerNavItems.map((link) => (
                <a
                  key={link.key}
                  href={link.href}
                  aria-current={link.current}
                  rel='noopener noreferrer'
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div class='header-right'>
              <a class='locale-switch' href={this.switchLocaleHref}>
                {this.switchLocaleLabel}
                <span class='visually-hidden'>{this.switchLocaleNote}</span>
              </a>
              <open-search
                locale={this.locale}
                trigger={this.searchTriggerLabel}
                dialog={this.searchDialogLabel}
                input={this.searchInputLabel}
                placeholder={this.searchPlaceholder}
                results={this.searchResultsLabel}
                empty={this.searchEmptyMessage}
                message={this.searchEmptyMessage}
              ></open-search>
              <open-theme-toggle></open-theme-toggle>
              <a
                class='repository-link'
                href={this.repositoryHref}
                target='_blank'
                rel='noopener noreferrer'
                aria-label={this.repositoryLabel}
              >
                <svg viewBox='0 0 16 16' aria-hidden='true' focusable='false'>
                  <path d='M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z' />
                </svg>
              </a>
              <details class='mobile-menu'>
                <summary class='mobile-menu-btn'>
                  <span class='mobile-menu-label'>{this.menuOpen}</span>
                  <span class='mobile-menu-icon' aria-hidden='true'>
                    {'☰'}
                  </span>
                </summary>
                <nav class='mobile-menu-panel' aria-label={this.mobileNavLabel}>
                  {this.headerNavItems.map((link) => (
                    <a
                      key={link.key}
                      href={link.href}
                      aria-current={link.current}
                      rel='noopener noreferrer'
                    >
                      {link.label}
                    </a>
                  ))}
                </nav>
              </details>
            </div>
          </div>
        </header>
        <div class='layout-body'>
          <nav
            class='docs-sidebar'
            part='sidebar'
            aria-label={this.sidebarLabel}
            hidden={this.sidebarHidden}
            data-pagefind-ignore
          >
            {this.sidebarRows.map((row) => (
              <div key={row.key} class='nav-row' data-kind={row.kind}>
                <span class='nav-heading'>{row.heading}</span>
                <a class='nav-link' href={row.href} aria-current={row.current} rel={row.rel}>
                  {row.label}
                </a>
              </div>
            ))}
          </nav>
          <main class='layout-main' part='main' id='main-content' tabindex='-1'>
            <slot></slot>
            <details class='sidebar-mobile' hidden={this.sidebarHidden} data-pagefind-ignore>
              <summary class='sidebar-mobile-toggle'>{this.sidebarToggle}</summary>
              <nav class='sidebar-mobile-panel' aria-label={this.sidebarLabel}>
                {this.sidebarRows.map((row) => (
                  <div key={row.key} class='nav-row' data-kind={row.kind}>
                    <span class='nav-heading'>{row.heading}</span>
                    <a class='nav-link' href={row.href} aria-current={row.current} rel={row.rel}>
                      {row.label}
                    </a>
                  </div>
                ))}
              </nav>
            </details>
          </main>
        </div>
        <footer class='app-footer' part='footer' data-pagefind-ignore>
          <div class='footer-inner'>
            <nav class='footer-column' aria-label={this.footerProductLabel}>
              <span class='footer-heading'>{this.footerProductLabel}</span>
              {this.footerProductLinks.map((link) => (
                <a key={link.key} href={link.href} rel={link.rel}>
                  {link.label}
                </a>
              ))}
            </nav>
            <nav class='footer-column' aria-label={this.footerResourcesLabel}>
              <span class='footer-heading'>{this.footerResourcesLabel}</span>
              {this.footerResourcesLinks.map((link) => (
                <a key={link.key} href={link.href} rel={link.rel}>
                  {link.label}
                </a>
              ))}
            </nav>
            <nav class='footer-column' aria-label={this.footerCompanyLabel}>
              <span class='footer-heading'>{this.footerCompanyLabel}</span>
              {this.footerCompanyLinks.map((link) => (
                <a key={link.key} href={link.href} rel={link.rel}>
                  {link.label}
                </a>
              ))}
            </nav>
            <nav class='footer-column' aria-label={this.footerLegalLabel}>
              <span class='footer-heading'>{this.footerLegalLabel}</span>
              {this.footerLegalLinks.map((link) => (
                <a key={link.key} href={link.href} rel={link.rel}>
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
          <div class='footer-bottom'>
            <span>{this.footerTagline}</span>
            <span class='footer-copyright'>{this.footerCopyright}</span>
          </div>
        </footer>
      </div>
    );
  }
}
