/**
 * The single write path for www page <head> meaning (Beta.2.2, #1327).
 *
 * Every route module declares its head through the page descriptor (static
 * object or resolver); this helper owns the site-wide derivation rules so the
 * per-route declaration stays a copy-only statement:
 *
 *   - titles carry the brand suffix (`brandedTitle`);
 *   - canonical/og:url/hreflang derive from the route + render locale through
 *     the same localizePath math the in-content links use (#1031);
 *   - every non-error page lists both site locales plus an x-default;
 *   - error documents (404) keep og fields but omit canonical/hreflang —
 *     they are not indexable and stay out of the sitemap.
 *
 * Resolved once per render by resolvePageDocument (@openelement/router/document)
 * before either serializer runs; there is no post-build head rewrite anymore.
 */
import type { PageHead } from '@openelement/router';
import { contentLocale } from './locale.ts';
import { localizePath, SITE_LOCALES } from './link.ts';

export const SITE_ORIGIN = 'https://openelement.org';

const BRAND = 'openElement';

/** Branded document title; the brand suffix keeps the site name in every title. */
export function brandedTitle(title: string): string {
  return title.includes(BRAND) ? title : `${title} — ${BRAND}`;
}

export interface SiteHeadInput {
  /** Canonical default-locale route of the page, e.g. '/guide/getting-started'. */
  route: string;
  /** Render locale from the page-head resolver context. */
  locale: string | undefined;
  /** Page-specific title (locale-appropriate), without the brand suffix. */
  title: string;
  /** Page-specific, locale-appropriate meta/og description. */
  description: string;
  /** Error documents carry og fields but no canonical/hreflang. */
  error?: boolean;
}

/** Compose one page's PageHead from its route, locale and copy. */
export function siteHead(input: SiteHeadInput): PageHead {
  const locale = contentLocale(input.locale ?? 'en');
  const title = brandedTitle(input.title);
  const canonical = `${SITE_ORIGIN}${localizePath(input.route, locale)}`;
  const head: PageHead = {
    title,
    description: input.description,
    meta: [
      { property: 'og:title', content: title },
      { property: 'og:description', content: input.description },
      { property: 'og:url', content: canonical },
    ],
  };
  if (!input.error) {
    head.canonical = canonical;
    head.alternates = [
      ...SITE_LOCALES.map((candidate) => ({
        href: `${SITE_ORIGIN}${localizePath(input.route, candidate)}`,
        hreflang: candidate,
      })),
      {
        href: `${SITE_ORIGIN}${localizePath(input.route, SITE_LOCALES[0])}`,
        hreflang: 'x-default',
      },
    ];
  }
  return head;
}
