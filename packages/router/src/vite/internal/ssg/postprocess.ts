/**
 * Router tooling internal SSG post-processing.
 *
 * Pure Node.js fs operations for SSG output post-processing.
 * No Vite dependency - these functions only read/write files.
 *
 * Post-processing pipeline (called after SSG rendering):
 * 1. injectViewTransitionMeta() - enable cross-page View Transitions
 * 2. injectSpeculationRules() - prefetch/prerender for navigation performance
 * 3. injectCspMeta() - Content-Security-Policy meta tag
 *
 * The island client script is NOT post-processed here: since #1471 the
 * document renderer embeds the final script tags at render time from the
 * client asset manifest (#1471 — identity-driven injection, no
 * chunk-name surgery, no HTML rewriting for scripts).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createLogger } from '@openelement/element';
import { visitHtmlFiles, walkHtmlFileEntries } from '../html-files.ts';
import { readTagName, routeFromRelativePath, skipThroughClosingTag } from './island-manifest.ts';
import { buildIslandPrefetchLinks } from './speculation-rules.ts';
export { buildSpeculationRulesJson } from './speculation-rules.ts';

const log = createLogger('postprocess');

// Shared directory walker: visitHtmlFiles from ../html-files.ts (#710) —
// walks the tree and applies a visitor to each HTML file. If the visitor
// returns a string, the file is overwritten with that content; if it returns
// null, the file is left unchanged.

// ─── HTML Insertion Helpers ────────────────────────────────────────────

/** Insert content immediately after <head> opening tag (handles attributes) */
function insertAfterHead(html: string, content: string): string {
  // [^>]* instead of [\s\S]*?: the bounded match prevents backtracking
  const headMatch = html.match(/<head(\s[^>]*)?>/i);
  if (!headMatch) {
    return html.startsWith('<!') || html.startsWith('<html')
      ? html.replace(/(<(?:!DOCTYPE|html)[^>]*>)/i, `$1\n<head>\n  ${content}\n</head>`)
      : `<head>\n  ${content}\n</head>\n${html}`;
  }
  if (headMatch.index === undefined) {
    throw new Error('insertAfterHead: matched <head> but index is undefined');
  }
  const headEnd = headMatch.index + headMatch[0].length;
  return html.slice(0, headEnd) + `\n  ${content}` + html.slice(headEnd);
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Inject CSP <meta> tag into all HTML files (SSG-only).
 *
 * For static sites, CSP is enforced via <meta http-equiv="Content-Security-Policy">
 * rather than HTTP headers. Nonce-based CSP is NOT supported for SSG
 * (nonces must be per-request and unpredictable - impossible in static files).
 */
export function injectCspMeta(
  dir: string,
  cspPolicy: string,
  reportOnly = false,
  nonce = false,
): void {
  if (nonce) {
    log.warn(
      'CSP nonce is not supported for SSG static output. ' +
        'Falling back to policy-only Content-Security-Policy meta tag. ' +
        'For per-request nonces, use a server-side middleware instead.',
    );
  }

  const headerName = reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  const escapedPolicy = cspPolicy.replace(/"/g, '&quot;');
  const metaTag = `  <meta http-equiv="${headerName}" content="${escapedPolicy}">`;

  visitHtmlFiles(dir, (content) => {
    if (content.includes(`http-equiv="${headerName}"`)) return null;
    return insertAfterHead(content, metaTag);
  });
}

// ─── View Transitions API ─────────────────────────────────────────────

/**
 * Inject View Transitions meta tag into all HTML files.
 *
 * The View Transitions API (Chrome 111+, Safari 18+, Firefox 129+) enables
 * smooth cross-page animations for MPA (Multi-Page App) navigation.
 * For SSG sites, this is a single meta tag - zero JavaScript required.
 *
 * When a user clicks a link, the browser automatically creates a cross-fade
 * transition between the old and new page. No SPA routing needed.
 *
 * Supported browsers: Chrome 111+, Edge 111+, Safari 18+, Firefox 129+.
 * Unsupported browsers silently ignore the meta tag (graceful degradation).
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API
 * @see https://chromestatus.com/feature/5190686707568640
 */
export function injectViewTransitionMeta(dir: string): void {
  const metaTag = '  <meta name="view-transition" content="same-origin">';

  visitHtmlFiles(dir, (content) => {
    if (content.includes('<meta name="view-transition"')) return null;
    return insertAfterHead(content, metaTag);
  });
}

// ─── Speculation Rules API ────────────────────────────────────────────

/**
 * Inject Speculation Rules into all HTML files.
 *
 * The Speculation Rules API (Chrome 121+) enables the browser to
 * prefetch or prerender pages before the user navigates to them.
 * This makes navigation feel instant for SSG sites.
 *
 * Speculation Rules are declarative JSON in a <script type="speculationrules"> tag.
 * They have zero JavaScript runtime cost - the browser handles everything natively.
 *
 * Only Chromium-based browsers (Chrome, Edge) support this as of 2026.
 * Safari and Firefox silently ignore the script tag (graceful degradation).
 *
 * @param dir - Output directory containing HTML files
 * @param rulesJson - Pre-built speculation rules JSON string
 */
export function injectSpeculationRules(dir: string, rulesJson: string): void {
  if (!rulesJson.trim()) return;

  const scriptTag = `  <script type="speculationrules">\n  ${rulesJson}\n  </script>`;

  visitHtmlFiles(dir, (content) => {
    if (content.includes('<script type="speculationrules"')) return null;
    return insertAfterHead(content, scriptTag);
  });
}

// ─── Per-page island-chunk prefetch (#1561) ───────────────────────────

/**
 * Extract href targets of <a> links from HTML content. Comments, script and
 * style blocks are skipped (same token walk as extractCustomElementTags);
 * links without an href contribute nothing.
 */
export function extractLinkHrefs(html: string): string[] {
  const hrefs: string[] = [];
  let index = 0;

  while (index < html.length) {
    const tagStart = html.indexOf('<', index);
    if (tagStart === -1) break;

    const next = html[tagStart + 1];
    if (next === undefined) break;

    if (next === '!') {
      if (html.startsWith('<!--', tagStart)) {
        const commentEnd = html.indexOf('-->', tagStart + 4);
        index = commentEnd === -1 ? html.length : commentEnd + 3;
      } else {
        const declarationEnd = html.indexOf('>', tagStart + 2);
        index = declarationEnd === -1 ? html.length : declarationEnd + 1;
      }
      continue;
    }

    if (next === '/' || next === '?' || /\s/.test(next)) {
      index = tagStart + 2;
      continue;
    }

    const tag = readTagName(html, tagStart + 1);
    if (!tag) {
      index = tagStart + 1;
      continue;
    }

    if (tag.name === 'script' || tag.name === 'style') {
      index = skipThroughClosingTag(html, tag.end, tag.name);
      continue;
    }

    if (tag.name === 'a') {
      const tagEnd = html.indexOf('>', tag.end);
      if (tagEnd === -1) break;
      const openTag = html.slice(tagStart, tagEnd);
      const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(openTag);
      const value = href?.[1] ?? href?.[2] ?? href?.[3];
      if (value) hrefs.push(value);
      index = tagEnd + 1;
      continue;
    }

    const tagEnd = html.indexOf('>', tag.end);
    index = tagEnd === -1 ? html.length : tagEnd + 1;
  }

  return hrefs;
}

/**
 * Resolve a page's outbound links to same-origin routes (pathname only —
 * search does not change which page file a static route renders). Anchors
 * and self-links resolve to the page's own route; the consumer excludes its
 * own chunks, so they contribute nothing. Absolute URLs are matched against
 * the route's synthetic origin: cross-origin links never prefetch, and
 * same-origin links written origin-full are conservative recall loss, not a
 * correctness issue (fewer chunks prefetched, never a wrong one).
 */
function sameOriginLinkRoutes(html: string, pageRoute: string): string[] {
  const base = new URL(pageRoute, 'https://openelement.invalid');
  const routes: string[] = [];
  for (const href of extractLinkHrefs(html)) {
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.origin !== base.origin) continue;
    let pathname = url.pathname;
    if (pathname !== '/' && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    routes.push(pathname);
  }
  return routes;
}

/**
 * Inject per-page island-chunk prefetch links (#1561): a group of
 * `<link rel="prefetch" as="fetch" href="...">` tags listing the island
 * chunks of the pages each page links to. `pageChunks` maps a site route to
 * the island chunk URLs that route's page loads — derived from the per-page
 * island manifests, the single owner of the page→chunk facts. A page's own
 * chunks are never listed (the page fetches them itself); the remaining
 * linked-page chunks ship as sorted link tags after <head>, each carrying
 * `data-open-island-prefetch` — the marker is what makes re-runs idempotent,
 * and the global speculation lane's `<script type="speculationrules">` tag
 * on the same page is unaffected.
 */
export function injectIslandPrefetchRules(
  dir: string,
  pageChunks: ReadonlyMap<string, readonly string[]>,
): void {
  for (const entry of walkHtmlFileEntries(dir)) {
    const content = readFileSync(entry.absolutePath, 'utf8');
    if (content.includes('data-open-island-prefetch')) continue;
    const route = routeFromRelativePath(entry.relativePath);
    const ownChunks = new Set(pageChunks.get(route) ?? []);
    const chunks = new Set<string>();
    for (const linkRoute of sameOriginLinkRoutes(content, route)) {
      for (const chunk of pageChunks.get(linkRoute) ?? []) {
        if (!ownChunks.has(chunk)) chunks.add(chunk);
      }
    }
    const links = buildIslandPrefetchLinks([...chunks].sort());
    if (!links) continue;
    writeFileSync(entry.absolutePath, insertAfterHead(content, links), 'utf8');
  }
}
