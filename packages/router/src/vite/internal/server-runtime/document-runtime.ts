/**
 * @openelement/router/server-runtime — document-level composition.
 *
 * The status-page HTML channel, shell-href localization, and the app-shell
 * runtime (the `__resolveAppShell` plan lookup plus the `__renderAppShell`
 * composition that projects the rendered route content into the shell's
 * default slot). The logic lives in this real module rather than inside a
 * codegen template string, so it is directly unit-testable.
 *
 * Element functions are injected, never imported, so the module stays free of
 * any @openelement/element edge (the LIT entry's import graph must never
 * reach the Native runtime kernel — #1339); the shell plan, locales, and nav
 * data are generated data bound at wiring time.
 */

import { localeFromPath } from './page-render.ts';
import type { PageSsrRenderer, TrustedHtmlValue } from './renderer-runtime.ts';
import type { AppShellPlan, ResolvedAppShell } from '@openelement/protocol/ssg';

/**
 * Shell href localization: root-relative hrefs gain the active locale prefix
 * unless they already carry it; locale-neutral, external, and protocol-relative
 * hrefs pass through untouched. Nav data is not part of the 1.0 surface, so
 * the generated `__headerNav` is empty today — the contract keeps its guard.
 */
export function localizeShellHref(href: string, locale: string, defaultLocale: string): string {
  if (
    typeof href !== 'string' ||
    locale === defaultLocale ||
    !href.startsWith('/') ||
    href.startsWith('//')
  ) {
    return href;
  }
  if (href === '/' + locale || href.startsWith('/' + locale + '/')) return href;
  return '/' + locale + (href === '/' ? '' : href);
}

/** The generated entry's `__statusHtml` binding: title/message rendered into a minimal status page. */
export type StatusHtmlRenderer = (title: unknown, message: unknown) => string;

/**
 * Binds the status-page renderer to the entry's `escapeHtml` import. Both the
 * native and the lit entry import the same canonical escaper
 * (@openelement/element[/html]), so the one implementation serves every
 * status channel (404 fallbacks, render failures, SSG redirect pages).
 */
export function createStatusHtml(escapeHtml: (value: string) => string): StatusHtmlRenderer {
  return (title, message) =>
    '<main><h1>' +
    escapeHtml(String(title)) +
    '</h1><p>' +
    escapeHtml(String(message)) +
    '</p></main>';
}

/** The app-shell runtime bound into the generated entry. */
export interface AppShellRuntime {
  /**
   * Resolve the shell for one route's metadata: `layout: false` disables the
   * shell, a named layout looks up `appShellPlan.layouts`, anything else (and
   * an unset layout) takes the plan default.
   */
  resolveAppShell(routeMeta?: Record<string, unknown>): ResolvedAppShell;
  /**
   * Render route content inside the resolved app shell layout: the page HTML
   * is projected into the shell's default slot through the page renderer, so
   * nested admitted islands expand deterministically and route content stays
   * inside the declared layout-main boundary. An unresolved shell returns the
   * content unchanged.
   */
  renderAppShell(
    pageHtml: unknown,
    routePath: string,
    options?: { locale?: string; routeMeta?: Record<string, unknown> },
  ): string;
}

/** What {@linkcode createAppShellRuntime} binds: the entry's Element imports plus its serialized plan data. */
export interface AppShellRuntimeDeps {
  /** The entry's bound page renderer (`__ssr`) — the shell renders through the same seam. */
  ssr: PageSsrRenderer;
  /** The entry's `trustedHtml` import — the slot projection is an explicit trust boundary. */
  trustedHtml: (html: string) => TrustedHtmlValue;
  /** The build's shell plan (serialized generated data). */
  appShellPlan: AppShellPlan;
  /** Declared project locales (serialized generated data). */
  locales: readonly string[];
  /** Nav sections (serialized generated data; empty on the 1.0 surface). */
  navSections: readonly unknown[];
  /** Header nav links (serialized generated data; empty on the 1.0 surface). */
  headerNav: readonly Record<string, unknown>[];
  /** The project's default locale (generated data). */
  defaultLocale: string;
}

/**
 * Binds the app-shell runtime to the entry's renderer, trust boundary, and
 * serialized shell/nav/locale data. The entry destructures
 * `{ resolveAppShell: __resolveAppShell, renderAppShell: __renderAppShell }`.
 */
export function createAppShellRuntime(deps: AppShellRuntimeDeps): AppShellRuntime {
  const { ssr, trustedHtml, appShellPlan, locales, navSections, headerNav, defaultLocale } = deps;

  function resolveAppShell(routeMeta: Record<string, unknown> = {}): ResolvedAppShell {
    const layout = Object.prototype.hasOwnProperty.call(routeMeta, 'layout')
      ? routeMeta.layout
      : undefined;
    if (layout === false) return false;
    if (typeof layout === 'string') {
      return appShellPlan.layouts[layout] ?? appShellPlan.default;
    }
    return appShellPlan.default;
  }

  // The app-shell composition renders nested custom-element hosts per the
  // layout contract: the page renders as its own host element and is projected
  // into the shell's default slot through Element's canonical serializer:
  // route content remains inside the declared layout-main boundary, while the
  // slot is the explicit external-content claim boundary. Both sides render
  // through __ssr, so nested admitted islands expand deterministically.
  function renderAppShell(
    pageHtml: unknown,
    routePath: string,
    options: { locale?: string; routeMeta?: Record<string, unknown> } = {},
  ): string {
    const locale = options.locale || localeFromPath(locales, routePath, defaultLocale);
    const routeMeta = options.routeMeta || {};
    const shell = resolveAppShell(routeMeta);
    const isHome = routePath === '/';
    const content = String(pageHtml);
    if (!shell) return content;
    const layoutProps: Record<string, unknown> = {
      currentPath: routePath,
      locale,
      locales,
      navItems: navSections,
      headerNav: headerNav.map((link) => ({
        ...link,
        href: localizeShellHref(link.href as string, locale, defaultLocale),
      })),
      homeHref: localizeShellHref('/', locale, defaultLocale),
      home: isHome || undefined,
      routeMeta,
      ...(shell.props || {}),
    };
    return ssr(
      shell.tagName,
      layoutProps,
      { route: routePath },
      0,
      new Map([['', trustedHtml(content)]]),
    );
  }

  return { resolveAppShell, renderAppShell };
}
