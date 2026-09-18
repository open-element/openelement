/**
 * Built-output internal link/fragment gate (#1159, B2.4).
 *
 * Runs against www/dist after the build: every internal href/src must resolve
 * to a built file, every #fragment must anchor in the target document, and
 * every sitemap.xml URL must resolve. Fails closed — the acceptance bar is
 * zero broken internal links or fragments. External URLs are deliberately not
 * fetched (scheduled external checks are deferred to Beta.3 under #1156).
 *
 * Pagefind skip (#1307 adjudication): the walk skips pagefind/ because those
 * files are generated search-index artifacts (hashed fragment/index chunks),
 * not served documents — no page links into them and they carry no authored
 * anchors. The reference search-record anchors that Pagefind surfaces are
 * covered directly instead: every generated searchRecord anchor must exist as
 * an id in the built /reference documents (both locales) below.
 */
import { walk } from '@std/fs/walk';
import { join } from '@std/path';
import { normalize as posixNormalize } from '@std/path/posix';
import {
  anchorsFragment,
  extractBuiltLinks,
  findCrossPageSeoFailures,
  findSeoFailures,
  type LinkFailure,
  pageSeo,
  resolveBuiltPath,
} from '../lib/site-links.ts';
import { apiReference } from '../../www/app/data/_generated-api-reference.ts';
import { retiredContentTitles } from './check-retired-urls.ts';

export const SITE_DIST = 'www/dist';
const SITE_LOCALES = ['en', 'zh'] as const;

export async function checkBuiltLinks(dist = SITE_DIST): Promise<LinkFailure[]> {
  const failures: LinkFailure[] = [];
  const files = new Set<string>();
  const htmlFiles: string[] = [];
  for await (
    const entry of walk(dist, { includeDirs: false, skip: [/(^|\/)pagefind(\/|$)/] })
  ) {
    files.add(entry.path.slice(dist.length + 1));
    if (entry.path.endsWith('.html')) htmlFiles.push(entry.path);
  }
  const exists = (file: string) => files.has(file);
  const htmlCache = new Map<string, string>();
  const readHtml = async (file: string): Promise<string> => {
    const cached = htmlCache.get(file);
    if (cached !== undefined) return cached;
    const text = await Deno.readTextFile(join(dist, file));
    htmlCache.set(file, text);
    return text;
  };

  const pages: ReturnType<typeof pageSeo>[] = [];
  for (const htmlFile of htmlFiles.sort()) {
    const relative = htmlFile.slice(dist.length + 1);
    const html = await readHtml(relative);
    failures.push(...findSeoFailures(html, relative));
    pages.push(pageSeo(html, relative, SITE_LOCALES));
    for (const link of extractBuiltLinks(relative, html)) {
      let target: string | null;
      if (link.path === '') {
        target = relative;
      } else if (link.path.startsWith('/')) {
        target = resolveBuiltPath(link.path, exists);
      } else {
        // Relative link: resolve against the page's directory, normalizing
        // '.'/'..' segments so self-references resolve to the page itself.
        const baseDir = relative.slice(0, relative.lastIndexOf('/'));
        target = resolveBuiltPath(posixNormalize(`${baseDir}/${link.path}`), exists);
      }
      if (target === null) {
        failures.push({
          file: `${link.from}:${link.line}`,
          message: `broken internal link '${link.raw}'`,
        });
        continue;
      }
      if (link.fragment !== '' && !anchorsFragment(await readHtml(target), link.fragment)) {
        failures.push({
          file: `${link.from}:${link.line}`,
          message: `broken fragment '#${link.fragment}' in '${link.path || relative}'`,
        });
      }
    }
  }

  // Sitemap URLs must resolve to built pages.
  if (exists('sitemap.xml')) {
    const sitemap = await Deno.readTextFile(join(dist, 'sitemap.xml'));
    for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const url = match[1];
      const path = new URL(url).pathname;
      if (resolveBuiltPath(path, exists) === null) {
        failures.push({ file: 'sitemap.xml', message: `sitemap URL does not resolve: ${url}` });
      }
    }
  }

  // Cross-page SEO invariants (#1307): per-locale title uniqueness. The
  // single write path (#1327) removed the site-wide boilerplate description,
  // so there is nothing left to reconcile page output against.
  failures.push(...findCrossPageSeoFailures(pages));

  // Redirect targets (#1358 fixes): every same-origin target of the
  // deployment-boundary redirect table must resolve to a built document,
  // and any #fragment must anchor there — a redirect to a 404 is a second
  // broken link wearing a 301.
  if (exists('_redirects')) {
    const redirects = await Deno.readTextFile(join(dist, '_redirects'));
    for (const [index, line] of redirects.split('\n').entries()) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [, to] = trimmed.split(/\s+/);
      if (!to || !to.startsWith('/')) continue;
      const hash = to.indexOf('#');
      const path = hash < 0 ? to : to.slice(0, hash);
      const fragment = hash < 0 ? '' : to.slice(hash + 1);
      const target = resolveBuiltPath(path, exists);
      if (target === null) {
        failures.push({
          file: `_redirects:${index + 1}`,
          message: `redirect target does not resolve: '${to}'`,
        });
        continue;
      }
      if (fragment !== '' && !anchorsFragment(await readHtml(target), fragment)) {
        failures.push({
          file: `_redirects:${index + 1}`,
          message: `redirect fragment '#${fragment}' missing in '${to}'`,
        });
      }
    }
  }

  // See-also hygiene: within one See-also section no href may repeat (a
  // repeated href with a stale label is the merge-leftover shape), and no
  // label may equal a retired page's title. The section ends at the next
  // h2 or at the first chrome landmark after it (pager/footer/rail live
  // past the article tail and must never count), so site chrome can never
  // false-positive.
  const retiredTitles = await retiredContentTitles();
  const seeAlsoHeading = /<h2[^>]*id="(see-also|另见)"[^>]*>/;
  const sectionEnd = /<h2[\s>]|<footer[\s>]|<nav[\s>]|<aside[\s>]/;
  for (const htmlFile of htmlFiles.sort()) {
    const relative = htmlFile.slice(dist.length + 1);
    const html = await readHtml(relative);
    const heading = seeAlsoHeading.exec(html);
    if (!heading) continue;
    const afterHeading = html.slice(heading.index + heading[0].length);
    const boundary = afterHeading.search(sectionEnd);
    const section = boundary < 0 ? afterHeading : afterHeading.slice(0, boundary);
    const seenHrefs = new Set<string>();
    for (const anchor of section.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const href = anchor[1];
      const label = anchor[2].replace(/<[^>]+>/g, '').trim();
      if (seenHrefs.has(href)) {
        failures.push({ file: relative, message: `see-also links '${href}' twice` });
      }
      seenHrefs.add(href);
      if (retiredTitles.has(label)) {
        failures.push({
          file: relative,
          message: `see-also label '${label}' names a retired page`,
        });
      }
    }
  }

  // Generated reference anchors (#1307): every generated searchRecord anchor
  // must exist in the built reference documents, in every built locale — the
  // search/surface promise is that /reference#<anchor> resolves.
  for (const page of ['reference/index.html', 'zh/reference/index.html']) {
    if (!exists(page)) {
      failures.push({ file: page, message: 'built reference page is missing' });
      continue;
    }
    const html = await readHtml(page);
    for (const record of apiReference.searchRecords) {
      if (!anchorsFragment(html, record.anchor)) {
        failures.push({
          file: page,
          message:
            `generated searchRecord anchor '#${record.anchor}' (${record.title}) is not rendered`,
        });
      }
    }
  }
  return failures;
}

if (import.meta.main) {
  const failures = await checkBuiltLinks();
  if (failures.length > 0) {
    console.error('Built-output link check failed:');
    for (const failure of failures) {
      console.error(`- ${failure.file}: ${failure.message}`);
    }
    Deno.exit(1);
  }
  console.log(`Built-output link check passed (${SITE_DIST}).`);
}
