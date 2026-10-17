/**
 * app/layout.tsx — the site shell as the compiled layout convention (#1569).
 *
 * The convention path is the whole registration: the build finds this module,
 * registers its compiled class under the `app-layout` tag, and renders EVERY
 * page inside it, projecting the page's render into the default <slot> — the
 * same wrap channel #1568 proved for template pages, at SSG and request time
 * (packages/router document-runtime.ts `renderLayout`). The former
 * `open-layout` app-shell island retires with its openelement.config.ts
 * `layout:` block; a compiled component with no island declaration ships zero
 * client JS.
 *
 * The default (light) root is load-bearing: the shell's styling channel is
 * the linked document stylesheet — Tailwind utilities plus the authored rules
 * in www/site-chrome.css — which matches only in light DOM. The former
 * shadow-root sheet channel has no successor here: its rules moved into
 * site-chrome.css with the template-shell migration.
 *
 * Nav data is imported directly (the convention hands the layout no props of
 * its own): the generated nav modules stay the one policy home, and the
 * chrome builders in site-ui/open-layout-navigation.ts keep deriving the
 * decorated rows exactly as they did for the compiled island. The two chrome
 * micro-islands (open-search, open-theme-toggle) keep their server render
 * through the compiled serializer; their authored rules live in the linked
 * document stylesheet.
 */
import { computed, element, OpenElement, property } from '@openelement/element';
import '@openelement/ui/open-theme-toggle';
import { SITE_DEFAULT_LOCALE } from '../site-config.ts';
import { headerNav, navSections } from './data/_generated-nav-data.ts';
import {
  buildSidebarRows,
  type DecoratedHeaderNavLink,
  decorateHeaderNav,
  footerColumn,
  type FooterLink,
  layoutChromeStrings,
  localeSwitchLabel,
  localeSwitchPath,
  localeSwitchScopeNote,
  type SidebarRow,
} from './site-ui/open-layout-navigation.ts';
import { searchChromeStrings } from './site-ui/chrome-strings.ts';
import './islands/open-search.tsx';

type CompiledComputed<T> = ReturnType<typeof computed<T>> & T;

@element('app-layout')
export default class Layout extends OpenElement {
  @property({ reflect: false })
  currentPath = '';

  @property({ reflect: false })
  siteName = 'openElement';

  // Carried from the retired config's layout.props: the English chrome
  // tagline stays empty, so the field default is the footer fallback.
  @property({ reflect: false })
  footerText = 'Built with OpenElement — Web Components-native application framework';

  @property({ reflect: true })
  homeHref = '/';

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
  // The list-Block grammar (OEC9013) requires `.map()` to run over a
  // `this.<property>`, so the derived rows/links live in computed() signal
  // properties over the plain shell props. The property-contract layer
  // guarantees attribute promotion happens before claim-time reads and that
  // generated field initializers (which only restate the compiled default)
  // never clobber the promoted attribute values — see facade-host.ts
  // restatesDefault.

  @property({ reflect: false, attribute: false })
  headerNavItems = computed(() =>
    decorateHeaderNav(headerNav, this.currentPath, this.locale, this.locales),
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
  // property defaults; the link is pinned to the navigation module's
  // REPOSITORY_URL by www/__tests__/site-ui.test.ts so the header and the
  // footer link cannot drift apart.
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
    buildSidebarRows(navSections, this.currentPath, this.locale, this.locales),
  ) as CompiledComputed<SidebarRow[]>;

  @property({ reflect: false, attribute: false })
  sidebarHidden = computed(
    () =>
      this.home ||
      buildSidebarRows(navSections, this.currentPath, this.locale, this.locales).length === 0,
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
      <div class='flex min-h-screen flex-col bg-background font-sans text-foreground antialiased oe-shell'>
        <a
          class='sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:start-4 focus-visible:z-[200] focus-visible:rounded-lg focus-visible:border focus-visible:border-border focus-visible:bg-popover focus-visible:px-4 focus-visible:py-2 focus-visible:font-mono focus-visible:text-(length:--text-xs) focus-visible:text-foreground focus-visible:no-underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px]'
          href='#main-content'
          data-pagefind-ignore
        >
          {this.skipToMain}
        </a>
        <header
          class='sticky top-0 z-[100] border-b border-border bg-(--nav-bg) backdrop-blur-[18px] backdrop-saturate-150 transition-[background,border-color,box-shadow,padding] duration-[320ms] ease-out print:hidden!'
          data-pagefind-ignore
        >
          <div class='mx-auto flex min-h-(--nav-height) items-center gap-1 px-3 min-[481px]:gap-2 min-[481px]:px-4 min-[901px]:gap-3 min-[1121px]:gap-6 min-[1121px]:px-[clamp(1.25rem,3.5vw,2.25rem)]'>
            <a
              class='group inline-flex min-h-10 w-13 min-w-[52px] max-w-[52px] shrink-0 items-center gap-3 bg-transparent text-(length:--text-2xl) font-extrabold tracking-normal text-foreground no-underline whitespace-nowrap focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px]'
              href={this.homeHref}
              aria-label={this.siteName}
            >
              <span
                class='inline-flex h-12 w-12 max-w-full items-center justify-center self-center font-mono text-(length:--text-xs) leading-none font-extrabold tracking-[-0.09em] text-foreground whitespace-nowrap transition-[transform] [view-transition-name:open-brand-mark] group-hover:-translate-y-px'
                aria-hidden='true'
              >
                {'<open'}
                <span class='text-primary'>/</span>
                {'>'}
              </span>
            </a>
            <nav
              class='mx-auto hidden w-fit max-w-fit min-w-0 flex-1 justify-center gap-3 rounded-full border border-[color-mix(in_srgb,var(--color-border)_78%,var(--color-primary))] bg-popover/68 p-1 shadow-[inset_0_1px_0_var(--edge-highlight)] min-[1041px]:flex min-[1121px]:gap-1'
              aria-label={this.primaryNavLabel}
            >
              {this.headerNavItems.map((link) => (
                <a
                  key={link.key}
                  class='rounded-full px-4 py-2 font-mono text-(length:--text-xs) tracking-[0.02em] font-medium text-(--nav-link-color) no-underline transition-[color,background,transform] duration-200 ease-out hover:-translate-y-px hover:bg-primary/10 hover:text-(--nav-link-hover) aria-[current=page]:bg-[color-mix(in_srgb,var(--color-primary)_18%,var(--color-popover))] aria-[current=page]:font-extrabold aria-[current=page]:text-foreground aria-[current=page]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-primary)_44%,transparent)]'
                  href={link.href}
                  aria-current={link.current}
                  rel='noopener noreferrer'
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div class='ml-auto flex items-center gap-1'>
              <a
                class='inline-flex h-9 items-center justify-center rounded-full border-0 bg-transparent px-2 font-mono text-(length:--text-xs) tracking-[0.02em] text-foreground no-underline whitespace-nowrap transition-all duration-150 ease-[ease] hover:bg-primary/[5.44%] hover:text-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px]'
                href={this.switchLocaleHref}
                data-locale-switch
              >
                {this.switchLocaleLabel}
                <span class='sr-only'>{this.switchLocaleNote}</span>
              </a>
              <open-search
                class='print:hidden!'
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
                class='inline-flex h-9 w-9 items-center justify-center rounded-full border-0 p-0 text-foreground transition-all hover:bg-primary/[5.44%] hover:text-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px]'
                href={this.repositoryHref}
                target='_blank'
                rel='noopener noreferrer'
                aria-label={this.repositoryLabel}
              >
                <svg
                  class='h-5 w-5 fill-current'
                  viewBox='0 0 16 16'
                  aria-hidden='true'
                  focusable='false'
                >
                  <path d='M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z' />
                </svg>
              </a>
              <details class='relative'>
                <summary class='flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-border bg-popover/74 p-0 text-muted-foreground transition-all duration-150 ease-[ease] hover:border-[color-mix(in_srgb,var(--color-foreground)_25%,var(--color-border))] hover:bg-accent hover:text-foreground min-[1041px]:hidden'>
                  <span class='sr-only'>{this.menuOpen}</span>
                  <span class='text-(length:--text-xl) leading-none' aria-hidden='true'>
                    {'☰'}
                  </span>
                </summary>
                <nav
                  class='absolute end-0 top-[calc(100%+0.5rem)] z-[110] grid min-w-48 rounded-lg border border-border bg-popover p-2 shadow-2xl print:hidden!'
                  aria-label={this.mobileNavLabel}
                >
                  {this.headerNavItems.map((link) => (
                    <a
                      key={link.key}
                      class='rounded-md px-3 py-2 font-mono text-(length:--text-xs) text-muted-foreground no-underline hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground'
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
        <div class='mx-auto flex w-full max-w-none flex-1 bg-background bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-border)_18%,transparent)_1px,transparent_1px)] [background-size:220px_100%]'>
          <nav
            class='sticky top-(--nav-height) h-[calc(100vh-var(--nav-height))] w-[clamp(200px,20vw,260px)] shrink-0 overflow-y-auto border-r border-border py-8 [scrollbar-width:thin] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-border)_26%,var(--color-background)),color-mix(in_srgb,var(--color-popover)_72%,transparent))] shadow-[inset_-1px_0_0_color-mix(in_srgb,var(--color-primary)_10%,transparent)] backdrop-blur-[20px] backdrop-saturate-[1.4] hidden min-[901px]:block print:hidden!'
            aria-label={this.sidebarLabel}
            hidden={this.sidebarHidden}
            data-pagefind-ignore
          >
            {this.sidebarRows.map((row) => (
              <div key={row.key} class='[&:first-child>span]:mt-0'>
                <span
                  class='mt-6 mb-2 flex items-center px-6 text-(length:--font-size-micro) font-extrabold tracking-[0.22em] text-muted-foreground uppercase select-none'
                  hidden={row.headingHidden}
                >
                  {row.heading}
                </span>
                <a
                  class='mx-[0.7rem] my-[0.12rem] block rounded-lg border-l-2 border-l-transparent px-[0.8rem] py-2 text-(length:--font-size-tiny) text-muted-foreground no-underline transition-[color,border-color,background] duration-150 ease-[ease] hover:bg-accent aria-[current=page]:border-l-primary aria-[current=page]:bg-primary/14 aria-[current=page]:font-[600] aria-[current=page]:text-primary'
                  href={row.href}
                  aria-current={row.current}
                  rel={row.rel}
                  hidden={row.linkHidden}
                >
                  {row.label}
                </a>
              </div>
            ))}
          </nav>
          <main class='isolate w-full min-w-0 flex-1' id='main-content' tabindex='-1'>
            <slot></slot>
            <details
              class='mx-4 mt-4 block min-[901px]:mx-0 min-[901px]:mt-0 min-[901px]:hidden'
              hidden={this.sidebarHidden}
              data-pagefind-ignore
            >
              <summary class='cursor-pointer rounded-lg border border-border bg-(--surface-1) px-4 py-3 font-mono text-(length:--text-xs) font-extrabold tracking-[0.12em] text-foreground uppercase'>
                {this.sidebarToggle}
              </summary>
              <nav class='pt-3 print:hidden!' aria-label={this.sidebarLabel}>
                {this.sidebarRows.map((row) => (
                  <div key={row.key}>
                    <span
                      class='mt-2 flex items-center px-4 py-2 text-(length:--font-size-micro) font-extrabold tracking-[0.22em] text-muted-foreground uppercase select-none'
                      hidden={row.headingHidden}
                    >
                      {row.heading}
                    </span>
                    <a
                      class='mx-[0.7rem] my-[0.12rem] block rounded-lg border-l-2 border-l-transparent py-2 pr-4 pl-8 text-(length:--font-size-tiny) text-muted-foreground no-underline transition-[color,border-color,background] duration-150 ease-[ease] hover:bg-accent aria-[current=page]:border-l-primary aria-[current=page]:bg-primary/14 aria-[current=page]:font-[600] aria-[current=page]:text-primary'
                      href={row.href}
                      aria-current={row.current}
                      rel={row.rel}
                      hidden={row.linkHidden}
                    >
                      {row.label}
                    </a>
                  </div>
                ))}
              </nav>
            </details>
          </main>
        </div>
        <footer class='border-t border-border bg-popover/58 print:hidden!' data-pagefind-ignore>
          <div class='mx-auto grid max-w-(--site-container-wide) grid-cols-2 gap-8 px-4 py-12 min-[901px]:grid-cols-4 min-[901px]:px-8 min-[901px]:py-16'>
            <nav aria-label={this.footerProductLabel}>
              <span class='mb-4 block text-(length:--font-size-button) font-semibold text-foreground'>
                {this.footerProductLabel}
              </span>
              {this.footerProductLinks.map((link) => (
                <a
                  key={link.key}
                  class='block py-1 text-(length:--font-size-body-sm) text-muted-foreground no-underline transition-[color] duration-150 ease-[ease] hover:text-foreground'
                  href={link.href}
                  rel={link.rel}
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <nav aria-label={this.footerResourcesLabel}>
              <span class='mb-4 block text-(length:--font-size-button) font-semibold text-foreground'>
                {this.footerResourcesLabel}
              </span>
              {this.footerResourcesLinks.map((link) => (
                <a
                  key={link.key}
                  class='block py-1 text-(length:--font-size-body-sm) text-muted-foreground no-underline transition-[color] duration-150 ease-[ease] hover:text-foreground'
                  href={link.href}
                  rel={link.rel}
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <nav aria-label={this.footerCompanyLabel}>
              <span class='mb-4 block text-(length:--font-size-button) font-semibold text-foreground'>
                {this.footerCompanyLabel}
              </span>
              {this.footerCompanyLinks.map((link) => (
                <a
                  key={link.key}
                  class='block py-1 text-(length:--font-size-body-sm) text-muted-foreground no-underline transition-[color] duration-150 ease-[ease] hover:text-foreground'
                  href={link.href}
                  rel={link.rel}
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <nav aria-label={this.footerLegalLabel}>
              <span class='mb-4 block text-(length:--font-size-button) font-semibold text-foreground'>
                {this.footerLegalLabel}
              </span>
              {this.footerLegalLinks.map((link) => (
                <a
                  key={link.key}
                  class='block py-1 text-(length:--font-size-body-sm) text-muted-foreground no-underline transition-[color] duration-150 ease-[ease] hover:text-foreground'
                  href={link.href}
                  rel={link.rel}
                >
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
          <div class='mx-auto flex max-w-(--site-container-wide) flex-col items-center justify-between gap-2 border-t border-border px-4 py-4 text-center text-(length:--font-size-body-sm) text-muted-foreground min-[901px]:flex-row min-[901px]:gap-4 min-[901px]:px-8 min-[901px]:py-4 min-[901px]:text-start'>
            <span>{this.footerTagline}</span>
            <span>{this.footerCopyright}</span>
          </div>
        </footer>
      </div>
    );
  }
}
