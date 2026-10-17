/**
 * @openelement/router/server-runtime — document-level composition.
 *
 * The status-page HTML channel, layout-href localization, and the layout
 * runtime (the `__resolveLayout` plan lookup plus the `__renderLayout`
 * composition that projects the rendered route content into the layout's
 * default slot). The logic lives in this real module rather than inside a
 * codegen template string, so it is directly unit-testable.
 *
 * Element functions are injected, never imported, so the module stays free of
 * any @openelement/element edge (the LIT entry's import graph must never
 * reach the Native runtime kernel — #1339); the layout plan, locales, and nav
 * data are generated data bound at wiring time.
 */

import { localeFromPath } from './page-render.ts';
import type { DocumentStyleSink, PageSsrRenderer, TrustedHtmlValue } from './renderer-runtime.ts';
import type { LayoutPlan, ResolvedLayout } from '@openelement/protocol/ssg';

/**
 * Layout href localization: root-relative hrefs gain the active locale prefix
 * unless they already carry it; locale-neutral, external, and protocol-relative
 * hrefs pass through untouched. Nav data is not part of the 1.0 surface, so
 * the generated `__headerNav` is empty today — the contract keeps its guard.
 */
export function localizeLayoutHref(href: string, locale: string, defaultLocale: string): string {
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

/** The layout runtime bound into the generated entry. */
export interface LayoutRuntime {
  /**
   * Resolve the layout for one route's metadata: `layout: false` disables the
   * layout, a named layout looks up `layoutPlan.layouts`, anything else (and
   * an unset layout) takes the plan default.
   */
  resolveLayout(routeMeta?: Record<string, unknown>): ResolvedLayout;
  /**
   * Render route content inside the resolved layout: the page HTML
   * is projected into the layout's default slot through the page renderer, so
   * nested admitted islands expand deterministically and route content stays
   * inside the declared layout-main boundary. An unresolved layout returns the
   * content unchanged.
   */
  renderLayout(
    pageHtml: unknown,
    routePath: string,
    options?: {
      locale?: string;
      routeMeta?: Record<string, unknown>;
      /**
       * The render's document stylesheet collection, forwarded to the layout's
       * own render. The layout is a light-root component like any other page
       * component (alpha15 S lane, S-C1.2): its external sheets belong to the
       * DOCUMENT, so a render that drops the sink never declares them and the
       * layout ships unstyled.
       */
      documentStyles?: DocumentStyleSink;
    },
  ): string;
}

/** What {@linkcode createLayoutRuntime} binds: the entry's Element imports plus its serialized plan data. */
export interface LayoutRuntimeDeps {
  /** The entry's bound page renderer (`__ssr`) — the layout renders through the same seam. */
  ssr: PageSsrRenderer;
  /** The entry's `trustedHtml` import — the slot projection is an explicit trust boundary. */
  trustedHtml: (html: string) => TrustedHtmlValue;
  /** The build's layout plan (serialized generated data). */
  layoutPlan: LayoutPlan;
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
 * Binds the layout runtime to the entry's renderer, trust boundary, and
 * serialized layout/nav/locale data. The entry destructures
 * `{ resolveLayout: __resolveLayout, renderLayout: __renderLayout }`.
 */
export function createLayoutRuntime(deps: LayoutRuntimeDeps): LayoutRuntime {
  const { ssr, trustedHtml, layoutPlan, locales, navSections, headerNav, defaultLocale } = deps;

  function resolveLayout(routeMeta: Record<string, unknown> = {}): ResolvedLayout {
    const layout = Object.prototype.hasOwnProperty.call(routeMeta, 'layout')
      ? routeMeta.layout
      : undefined;
    if (layout === false) return false;
    if (typeof layout === 'string') {
      return layoutPlan.layouts[layout] ?? layoutPlan.default;
    }
    return layoutPlan.default;
  }

  // The layout composition renders nested custom-element hosts per the
  // layout contract: the page renders as its own host element and is projected
  // into the layout's default slot through Element's canonical serializer:
  // route content remains inside the declared layout-main boundary, while the
  // slot is the explicit external-content claim boundary. Both sides render
  // through __ssr, so nested admitted islands expand deterministically.
  function renderLayout(
    pageHtml: unknown,
    routePath: string,
    options: {
      locale?: string;
      routeMeta?: Record<string, unknown>;
      documentStyles?: DocumentStyleSink;
    } = {},
  ): string {
    const locale = options.locale || localeFromPath(locales, routePath, defaultLocale);
    const routeMeta = options.routeMeta || {};
    const layout = resolveLayout(routeMeta);
    const isHome = routePath === '/';
    const content = String(pageHtml);
    if (!layout) return content;
    const layoutProps: Record<string, unknown> = {
      currentPath: routePath,
      locale,
      locales,
      navItems: navSections,
      headerNav: headerNav.map((link) => ({
        ...link,
        href: localizeLayoutHref(link.href as string, locale, defaultLocale),
      })),
      homeHref: localizeLayoutHref('/', locale, defaultLocale),
      home: isHome || undefined,
      routeMeta,
      ...(layout.props || {}),
    };
    return ssr(
      layout.tagName,
      layoutProps,
      // The layout's own light-root sheets join the SAME render collection the
      // page render reports into (S-C1.2): one document, one declaration owner.
      { route: routePath, documentStyles: options.documentStyles },
      0,
      new Map([['', trustedHtml(content)]]),
    );
  }

  return { resolveLayout, renderLayout };
}
