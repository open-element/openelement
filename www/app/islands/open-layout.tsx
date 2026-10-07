/** @jsxImportSource @openelement/element */
/** Compiler-owned WWW app shell (v0.44, ADR-0143). */
import { defineIslandConfig } from '@openelement/router';
import { computed, element, OpenElement, property } from '@openelement/element';
import '@openelement/ui/open-theme-toggle';
import { SITE_DEFAULT_LOCALE } from '../../site-config.ts';
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
import openLayoutStyles from './open-layout.css';

type CompiledComputed<T> = ReturnType<typeof computed<T>> & T;

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

@element('open-layout')
export default class OpenLayout extends OpenElement {
  static override styles = [openLayoutStyles];

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
