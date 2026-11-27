/**
 * page-url-forms.ts - the page URL set the build emits, as route-layer facts.
 *
 * The SSG build and the static dispatch define which URLs a site serves: the
 * static pass writes one document per page route at its canonical path, the
 * i18n expansion (`expandI18nLocales`, ssg-dynamic.ts) writes one prefixed
 * copy per non-default locale, and `staticFileCandidates` resolves every
 * document from both its clean-URL spelling and its trailing-slash spelling.
 *
 * The generated request-time route layer (the dev server and the
 * `dist/server` entry) is the other half of that contract. It used to
 * register only the canonical, exactly-spelled page paths, so dev answered
 * 404 for URLs the built site serves — `/docs/` (the slash spelling) and
 * `/zh/docs` (the locale-prefixed spelling). This module derives the missing
 * URL forms from the same descriptor the build's i18n expansion reads, so the
 * route layer answers what the build emits instead of a second, narrower URL
 * set.
 *
 * @module ./page-url-forms.ts
 */

import type { EntryDescriptor } from '@openelement/protocol/ssg';

/** The not-found page's path convention (`renderNotFoundRoute` keys on it). */
export const NOT_FOUND_ROUTE_PATH = '/404';

/** The page route's first path segment: '' for the root, 'docs' for '/docs'. */
function firstSegment(path: string): string {
  return path.split('/')[1] ?? '';
}

/** One locale-prefixed form of a canonical page route. */
export interface LocaleRouteAlias {
  /**
   * Stable route identity. The canonical route's file path plus the locale:
   * both are unique per alias, and neither can collide with the canonical
   * record's own identity (the file path alone).
   */
  readonly id: string;
  /** The prefixed URLPattern path, e.g. `/zh/docs` (or `/zh` for `/`). */
  readonly path: string;
  /** The canonical route path whose handler table answers the alias. */
  readonly canonicalPath: string;
  readonly locale: string;
}

/**
 * The locale-prefixed page URLs the build emits, as route records.
 *
 * Each alias points at the canonical route's handler table: the handler
 * derives the locale from the REQUEST path (`localeFromPath`), so the alias
 * needs no handler body of its own — the same `/docs` render answers
 * `/zh/docs` with locale `zh`, exactly as the prerendered copy does.
 *
 * No alias is emitted for:
 * - the default locale: the build serves it unprefixed only (a `/en/...` URL
 *   is a 404 in the built output);
 * - the not-found page: `/<locale>/404` is the error document, served with a
 *   404 status. The route layer's notFound terminal already answers it with
 *   that status and the requested locale;
 * - a route the author already declared under a declared locale prefix: the
 *   build's expansion skips those paths (`locales.includes(pathSegment)`), so
 *   prefixing them again would invent URLs the built site does not serve.
 *
 * Empty for a single-locale project, keeping its route layer unchanged.
 */
export function localeRouteAliases(desc: EntryDescriptor): LocaleRouteAlias[] {
  const i18n = desc.i18n;
  if (!i18n) return [];
  const locales = [...new Set(i18n.locales)];
  if (locales.length <= 1) return [];
  const aliases: LocaleRouteAlias[] = [];
  for (const locale of locales) {
    if (locale === i18n.defaultLocale) continue;
    for (const route of desc.pageRoutes) {
      if (route.path === NOT_FOUND_ROUTE_PATH) continue;
      if (locales.includes(firstSegment(route.path))) continue;
      aliases.push({
        id: `${route.filePath}::locale:${locale}`,
        path: route.path === '/' ? `/${locale}` : `/${locale}${route.path}`,
        canonicalPath: route.path,
        locale,
      });
    }
  }
  return aliases;
}

/**
 * Page URL forms a project serves, matching the build's output set: every
 * canonical document plus one prefixed copy per non-default locale for every
 * route the author did not already declare under a locale prefix.
 *
 * The two passes that write documents (the static pass and
 * `expandI18nLocales`) apply exactly these rules, so this is the count the
 * dev startup line reports instead of the canonical route-module count — the
 * dev route layer now answers the same URL set.
 */
export function pageUrlCount(
  pageRoutes: readonly { readonly path: string }[],
  i18n: { readonly locales: readonly string[] } | null | undefined,
): number {
  const locales = [...new Set(i18n?.locales ?? [])];
  if (!i18n || locales.length <= 1) return pageRoutes.length;
  const expandable = pageRoutes.filter(
    (route) => !locales.includes(firstSegment(route.path)),
  ).length;
  return pageRoutes.length + expandable * (locales.length - 1);
}
