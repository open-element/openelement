import { normalizeSiteHref } from '../app/site-ui/site-url.ts';
import type { Connect } from 'vite';

import type { RedirectMapping } from '../tools/lib/site-retired.ts';

export type SiteRedirect = RedirectMapping;

function encodeFragment(fragment: string): string {
  // encodeURIComponent keeps HTTP Location header values ASCII-safe. Preserve
  // existing escapes so an already-encoded fragment is not encoded twice.
  return encodeURIComponent(fragment).replace(/%25([0-9a-f]{2})/gi, '%$1');
}

/** Canonical outward target shared by dev responses and deployment rules. */
export function siteRedirectTarget(mapping: SiteRedirect, locale: 'en' | 'zh'): string {
  const raw = locale === 'zh' ? (mapping.toZh ?? mapping.to) : mapping.to;
  const [path, fragment] = raw.split('#', 2);
  const prefixed = locale === 'zh' ? `/zh${path}` : path;
  return normalizeSiteHref(`${prefixed}${fragment ? `#${encodeFragment(fragment)}` : ''}`);
}

/** Cloudflare matches path forms literally, so publish both slash variants. */
export function siteRedirectSources(mapping: SiteRedirect, prefix = ''): string[] {
  return [`${prefix}${mapping.from}`, `${prefix}${mapping.from}/`];
}

/** Resolve the site's retired-route manifest for an incoming request URL. */
export function resolveSiteRedirect(
  requestTarget: string,
  redirects: readonly SiteRedirect[],
): { status: number; location: string } | null {
  const url = new URL(requestTarget, 'http://site.invalid');
  const localized = url.pathname.match(/^\/(zh)(?=\/|$)/);
  const locale = localized ? 'zh' : 'en';
  const unprefixed = localized ? url.pathname.slice(3) || '/' : url.pathname;
  const identity = unprefixed.replace(/\/$/, '') || '/';
  const mapping = redirects.find((entry) => entry.from === identity);
  if (!mapping) return null;

  const location = siteRedirectTarget(mapping, locale);
  const hash = location.indexOf('#');
  const withQuery =
    hash < 0
      ? `${location}${url.search}`
      : `${location.slice(0, hash)}${url.search}${location.slice(hash)}`;
  return { status: mapping.status, location: withQuery };
}

/** Connect consumer used by Vite dev; deployment uses siteRedirectTarget above. */
export function createSiteRedirectMiddleware(
  redirects: readonly SiteRedirect[],
): Connect.NextHandleFunction {
  return (request, response, next) => {
    if (!request.url) return next();
    let redirect: ReturnType<typeof resolveSiteRedirect>;
    try {
      redirect = resolveSiteRedirect(request.url, redirects);
    } catch {
      return next();
    }
    if (!redirect) return next();
    response.statusCode = redirect.status;
    response.setHeader('Location', redirect.location);
    response.end();
  };
}
