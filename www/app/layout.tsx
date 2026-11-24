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
import { computed } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';
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
  REPOSITORY_URL,
  type SidebarRow,
} from './site-ui/open-layout-navigation.ts';
import { searchChromeStrings } from './site-ui/chrome-strings.ts';
import { normalizeSiteHref } from './site-ui/site-url.ts';
import './islands/open-search.tsx';

/**
 * THE SITE LAYOUT — generated-element lane (2026-11-20 migration).
 *
 * The convention layout keeps its tag from the router constant
 * (`CONVENTION_LAYOUT_TAG`, D-M1), and the entry registers it through the
 * generated host PAIR channel (the layout-pair slice). The `computed` fields
 * are the lane's `computed` intrinsic — derived nodes the compiler creates in the
 * retained setup factory (ADR-0183 D-4).
 *
 * The two chrome micro-islands inside this markup (`open-search`,
 * `open-theme-toggle`) are DASH tags, so the SSR producer routes each through the
 * render's nested-host expander (the nested-expansion slice): they come out as
 * DSD exactly as they did under the class lane, and an un-admitted tag would keep
 * its literal bytes.
 */

export const openElement = defineIslandConfig({
  tag: 'app-layout',
  properties: {
    currentPath: { default: '' },
    siteName: { default: 'openElement' },
    footerText: {
      default: 'Built with OpenElement — Web Components-native application framework',
    },
    homeHref: { reflect: true, default: '/' },
    locale: { default: 'en' },
    locales: { attribute: false, default: ['en'] },
    home: { reflect: true, default: false },
  },
});

function Layout(props: {
  currentPath: string;
  siteName: string;
  footerText: string;
  homeHref: string;
  locale: string;
  locales: string[];
  home: boolean;
}) {
  // Chrome copy depends only on the `locale` row: resolved once in setup scope and
  // captured by the derived nodes below.
  const chrome = layoutChromeStrings(props.locale);
  const searchChrome = searchChromeStrings(props.locale);
  const product = footerColumn(props.locale, props.locales, 'product');
  const resources = footerColumn(props.locale, props.locales, 'resources');
  const company = footerColumn(props.locale, props.locales, 'company');
  const legal = footerColumn(props.locale, props.locales, 'legal');
  const sidebar = buildSidebarRows(navSections, props.currentPath, props.locale, props.locales);

  const repositoryHref = computed(() => REPOSITORY_URL);

  // The header canonical href: the router hands the localized form ("/zh"), the
  // outward canonical form is "/zh/" (owner decision D-02).
  const homeHrefCanonical = computed(() => normalizeSiteHref(props.homeHref));

  const headerNavItems = computed((): DecoratedHeaderNavLink[] =>
    decorateHeaderNav(headerNav, props.currentPath, props.locale, props.locales),
  );
  const sidebarLabel = computed(() => chrome.sidebarLabel);
  const sidebarToggle = computed(() => chrome.sidebarToggle);
  const skipToMain = computed(() => chrome.skipToMain);
  const menuOpen = computed(() => chrome.menuOpen);
  const primaryNavLabel = computed(() => chrome.primaryNavLabel);
  const mobileNavLabel = computed(() => chrome.mobileNavLabel);
  const repositoryLabel = computed(() => chrome.repositoryLabel);
  const switchLocaleHref = computed(() =>
    localeSwitchPath(props.currentPath || '/', props.locale, props.locales, SITE_DEFAULT_LOCALE),
  );
  const switchLocaleLabel = computed(() => localeSwitchLabel(props.locale));
  const switchLocaleNote = computed(() => localeSwitchScopeNote(props.locale));
  const sidebarRows = computed((): SidebarRow[] => sidebar);
  const sidebarHidden = computed(() => props.home || sidebar.length === 0);
  const footerTagline = computed(() => chrome.footerTagline || props.footerText);
  const footerCopyright = computed(() => chrome.footerCopyright);
  const searchTriggerLabel = computed(() => searchChrome.triggerLabel);
  const searchDialogLabel = computed(() => searchChrome.dialogLabel);
  const searchInputLabel = computed(() => searchChrome.inputLabel);
  const searchPlaceholder = computed(() => searchChrome.placeholder);
  const searchResultsLabel = computed(() => searchChrome.resultsLabel);
  const searchEmptyMessage = computed(() => searchChrome.emptyMessage);
  const footerProductLabel = computed(() => product.label);
  const footerProductLinks = computed((): FooterLink[] => product.links);
  const footerResourcesLabel = computed(() => resources.label);
  const footerResourcesLinks = computed((): FooterLink[] => resources.links);
  const footerCompanyLabel = computed(() => company.label);
  const footerCompanyLinks = computed((): FooterLink[] => company.links);
  const footerLegalLabel = computed(() => legal.label);
  const footerLegalLinks = computed((): FooterLink[] => legal.links);

  return (
    <div class='flex min-h-screen flex-col bg-background font-sans text-foreground antialiased oe-shell'>
      <a
        class='sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:start-4 focus-visible:z-[200] focus-visible:rounded-lg focus-visible:border focus-visible:border-border focus-visible:bg-popover focus-visible:px-4 focus-visible:py-2 focus-visible:font-mono focus-visible:text-(length:--text-xs) focus-visible:text-foreground focus-visible:no-underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px]'
        href='#main-content'
        data-pagefind-ignore
      >
        {skipToMain.value}
      </a>
      <header
        class='sticky top-0 z-[100] border-b border-border bg-(--nav-bg) backdrop-blur-[18px] backdrop-saturate-150 transition-[background,border-color,box-shadow,padding] duration-[320ms] ease-out print:hidden!'
        data-pagefind-ignore
      >
        <div class='mx-auto flex min-h-(--nav-height) items-center gap-1 px-3 min-[481px]:gap-2 min-[481px]:px-4 min-[901px]:gap-3 min-[1121px]:gap-6 min-[1121px]:px-[clamp(1.25rem,3.5vw,2.25rem)]'>
          <a
            class='group inline-flex min-h-10 w-13 min-w-[52px] max-w-[52px] shrink-0 items-center gap-3 bg-transparent text-(length:--text-2xl) font-extrabold tracking-normal text-foreground no-underline whitespace-nowrap focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px]'
            href={homeHrefCanonical.value}
            aria-label={props.siteName}
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
            aria-label={primaryNavLabel.value}
          >
            {headerNavItems.value.map((link) => (
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
              href={switchLocaleHref.value}
              data-locale-switch
            >
              {switchLocaleLabel.value}
              <span class='sr-only'>{switchLocaleNote.value}</span>
            </a>
            <open-search
              class='print:hidden!'
              locale={props.locale}
              trigger={searchTriggerLabel.value}
              dialog={searchDialogLabel.value}
              input={searchInputLabel.value}
              placeholder={searchPlaceholder.value}
              results={searchResultsLabel.value}
              empty={searchEmptyMessage.value}
              message={searchEmptyMessage.value}
            ></open-search>
            <open-theme-toggle></open-theme-toggle>
            <a
              class='inline-flex h-9 w-9 items-center justify-center rounded-full border-0 p-0 text-foreground transition-all hover:bg-primary/[5.44%] hover:text-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px]'
              href={repositoryHref.value}
              target='_blank'
              rel='noopener noreferrer'
              aria-label={repositoryLabel.value}
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
                <span class='sr-only'>{menuOpen.value}</span>
                <span class='text-(length:--text-xl) leading-none' aria-hidden='true'>
                  {'☰'}
                </span>
              </summary>
              <nav
                class='absolute end-0 top-[calc(100%+0.5rem)] z-[110] grid min-w-48 rounded-lg border border-border bg-popover p-2 shadow-2xl print:hidden!'
                aria-label={mobileNavLabel.value}
              >
                {headerNavItems.value.map((link) => (
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
          aria-label={sidebarLabel.value}
          hidden={sidebarHidden.value}
          data-pagefind-ignore
        >
          {sidebarRows.value.map((row) => (
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
          {/* The docs navigation disclosure sits BEFORE the page content:
              below 901px the desktop sidebar is out of the accessibility
              tree, so this is the only section navigation a small-viewport
              reader gets. It used to render after <slot>, which put the whole
              article between the page title and its own navigation — a
              keyboard or screen-reader reader had to walk the document to
              reach it. The desktop sidebar (min-[901px]) is unaffected, and
              the disclosure keeps [hidden] for island pages without one. */}
          <details
            class='mx-4 mt-4 mb-4 block min-[901px]:mx-0 min-[901px]:mt-0 min-[901px]:mb-0 min-[901px]:hidden'
            hidden={sidebarHidden.value}
            data-pagefind-ignore
          >
            <summary class='cursor-pointer rounded-lg border border-border bg-(--surface-1) px-4 py-3 font-mono text-(length:--text-xs) font-extrabold tracking-[0.12em] text-foreground uppercase'>
              {sidebarToggle.value}
            </summary>
            <nav class='pt-3 print:hidden!' aria-label={sidebarLabel.value}>
              {sidebarRows.value.map((row) => (
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
          <slot></slot>
        </main>
      </div>
      <footer class='border-t border-border bg-popover/58 print:hidden!' data-pagefind-ignore>
        <div class='mx-auto grid max-w-(--site-container-wide) grid-cols-2 gap-8 px-4 py-12 min-[901px]:grid-cols-4 min-[901px]:px-8 min-[901px]:py-16'>
          <nav aria-label={footerProductLabel.value}>
            <span class='mb-4 block text-(length:--font-size-button) font-semibold text-foreground'>
              {footerProductLabel.value}
            </span>
            {footerProductLinks.value.map((link) => (
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
          <nav aria-label={footerResourcesLabel.value}>
            <span class='mb-4 block text-(length:--font-size-button) font-semibold text-foreground'>
              {footerResourcesLabel.value}
            </span>
            {footerResourcesLinks.value.map((link) => (
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
          <nav aria-label={footerCompanyLabel.value}>
            <span class='mb-4 block text-(length:--font-size-button) font-semibold text-foreground'>
              {footerCompanyLabel.value}
            </span>
            {footerCompanyLinks.value.map((link) => (
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
          <nav aria-label={footerLegalLabel.value}>
            <span class='mb-4 block text-(length:--font-size-button) font-semibold text-foreground'>
              {footerLegalLabel.value}
            </span>
            {footerLegalLinks.value.map((link) => (
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
          <span>{footerTagline.value}</span>
          <span>{footerCopyright.value}</span>
        </div>
      </footer>
    </div>
  );
}

export default Layout;
