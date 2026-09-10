/**
 * Built-output internal link + fragment truth (#1159, B2.4).
 *
 * Walks www/dist HTML, resolves every internal href/src against the built
 * output tree and requires fragment targets (#id) to exist in the target
 * document. External links are out of scope here — the scheduled external
 * checker is deferred to Beta.3 (#1156, workflow-cap ruling).
 */

export interface LinkFailure {
  file: string;
  message: string;
}

/** Effective description length: CJK glyphs carry roughly twice the information density. */
function effectiveLength(text: string): number {
  const cjk = text.match(/[　-鿿豈-﫿]/g)?.length ?? 0;
  return text.length + cjk;
}

/** Per-page SEO invariants checked over built HTML (#1159, strengthened #1307). */
export function findSeoFailures(html: string, file: string): LinkFailure[] {
  const failures: LinkFailure[] = [];
  const titles = html.match(/<title>/g) ?? [];
  if (titles.length !== 1) {
    failures.push({ file, message: `expected exactly one <title>, found ${titles.length}` });
  }
  // The boilerplate era shipped the bare site name as every page's title;
  // a real page title always says more than the brand.
  const titleText = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  if (titleText === 'openElement' || titleText === '') {
    failures.push({ file, message: `boilerplate or empty <title> '${titleText}'` });
  }
  const description = html.match(/<meta name="description" content="([^"]*)"\s*\/?>/)?.[1];
  if (description === undefined || effectiveLength(description) < 20) {
    failures.push({ file, message: 'missing or trivial meta description' });
  }
  if (!/<meta property="og:title" content="[^"]+"/.test(html)) {
    failures.push({ file, message: 'missing og:title' });
  }
  // Error documents (404) deliberately carry no canonical/hreflang.
  const is404 = /(?:^|\/)404(?:\.html|\/index\.html)$/.test(file);
  if (!is404) {
    if (!/<link rel="canonical" href="https:\/\/openelement\.org[^"]*">/.test(html)) {
      failures.push({ file, message: 'missing canonical link' });
    }
    // Attribute order is the serializer's own (rel/href/hreflang since #1326);
    // the invariant is that the page declares an alternate carrying an href
    // for each locale, not the byte order of its attributes.
    for (const locale of ['en', 'zh']) {
      const alternate = html.match(
        new RegExp(`<link rel="alternate"[^>]*hreflang="${locale}"[^>]*>`),
      );
      if (alternate === null || !/\bhref="/.test(alternate[0])) {
        failures.push({ file, message: `missing hreflang alternate for '${locale}'` });
      }
    }
  }
  return failures;
}

export interface BuiltPageSeo {
  file: string;
  title: string;
  description: string;
  locale: string;
}

/** Extract the comparable SEO fields from one built page. */
export function pageSeo(html: string, file: string, locales: readonly string[]): BuiltPageSeo {
  const first = file.split('/').filter(Boolean)[0];
  const locale = locales.includes(first) && first !== locales[0] ? first : locales[0];
  return {
    file,
    title: html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '',
    description: html.match(/<meta name="description" content="([^"]*)"\s*\/?>/)?.[1] ?? '',
    locale,
  };
}

/**
 * Cross-page SEO invariants (#1307): within one locale, two distinct routes
 * must not share a <title> (the boilerplate era made every title identical).
 *
 * #1327: the zh-vs-boilerplate-description reconciliation was removed with
 * the boilerplate itself — page metadata is written exactly once now (the
 * route descriptor head, serialized at SSG time), so there is no site-wide
 * default description left in the output to reconcile against. Per-page
 * description presence/length stays asserted by findSeoFailures; locale
 * honesty of the copy is guarded by the route-locale gates in
 * check-www-truth.ts and the i18n e2e suites.
 */
export function findCrossPageSeoFailures(
  pages: readonly BuiltPageSeo[],
): LinkFailure[] {
  const failures: LinkFailure[] = [];
  const titleByLocale = new Map<string, Map<string, string>>();
  for (const page of pages) {
    if (page.title === '') continue;
    const titles = titleByLocale.get(page.locale) ?? new Map<string, string>();
    const existing = titles.get(page.title);
    if (existing !== undefined) {
      failures.push({
        file: page.file,
        message:
          `duplicate <title> '${page.title}' within locale '${page.locale}' (also ${existing})`,
      });
    } else {
      titles.set(page.title, page.file);
    }
    titleByLocale.set(page.locale, titles);
  }
  return failures;
}

export interface BuiltLink {
  from: string;
  raw: string;
  path: string;
  fragment: string;
  line: number;
}

const ATTR_PATTERN = /(?:href|src)="([^"]+)"/g;

/** Extract internal link targets from one built HTML document. */
export function extractBuiltLinks(file: string, html: string): BuiltLink[] {
  const links: BuiltLink[] = [];
  for (const match of html.matchAll(ATTR_PATTERN)) {
    const raw = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) continue;
    const line = html.slice(0, match.index).split('\n').length;
    const [path, ...fragmentParts] = raw.split('#');
    links.push({ from: file, raw, path, fragment: fragmentParts.join('#'), line });
  }
  return links;
}

/** Map a URL path to the built-output file that serves it, or null. */
export function resolveBuiltPath(path: string, exists: (file: string) => boolean): string | null {
  const clean = path.replace(/^\//, '').replace(/\/+$/, '');
  if (clean === '') return exists('index.html') ? 'index.html' : null;
  // Static assets carry an extension; routes are clean URLs with index.html.
  const lastSegment = clean.slice(clean.lastIndexOf('/') + 1);
  if (/\.[a-z0-9]+$/i.test(lastSegment)) {
    return exists(clean) ? clean : null;
  }
  const asRoute = `${clean}/index.html`;
  if (exists(asRoute)) return asRoute;
  const asFile = `${clean}.html`;
  return exists(asFile) ? asFile : null;
}

/** True when the target document anchors the fragment. */
export function anchorsFragment(html: string, fragment: string): boolean {
  return html.includes(`id="${fragment}"`) || html.includes(`name="${fragment}"`);
}
