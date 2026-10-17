/**
 * Router tooling internal SSG post-processing.
 *
 * Pure Node.js fs operations for SSG output post-processing.
 * No Vite dependency - these functions only read/write files.
 *
 * Post-processing pipeline (called after SSG rendering):
 * 1. injectViewTransitionOptIn() - enable cross-page View Transitions
 * 2. injectSpeculationRules() - prefetch/prerender for navigation performance
 * 3. injectCspMeta() - Content-Security-Policy meta tag
 * 4. injectElementRuntimePreload() - the shared element-runtime chunk's
 *    modulepreload, only on pages whose island manifest is non-empty (B2)
 *
 * The island client script is NOT post-processed here: since #1471 the
 * document renderer embeds the final script tags at render time from the
 * client asset manifest (#1471 — identity-driven injection, no
 * chunk-name surgery, no HTML rewriting for scripts). The #1544 modulepreload
 * is a chunk-layout artifact the manifest pass owns, so this module writes it
 * from the same per-page manifests the build just recorded.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createLogger } from '@openelement/element';
import { escapeAttr } from '@openelement/element/html';
import { buildError, SsgRenderErrorCode } from '../../../internal/error-codes.ts';
import { visitHtmlFiles, walkHtmlFileEntries } from '../html-files.ts';
import {
  type PageIslandManifest,
  pageHasClientIslands,
  readTagName,
  routeFromRelativePath,
  skipThroughClosingTag,
} from './island-manifest.ts';
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
 * Directives a `<meta>`-delivered policy cannot carry.
 *
 * The CSP grammar has no meta form for these: a policy that arrives through
 * `<meta http-equiv>` has `frame-ancestors`, `report-uri` and `sandbox` ignored
 * outright, and `report-to` is useless there because the endpoint group comes
 * from a `Reporting-Endpoints` response header a meta cannot set. Shipping them
 * anyway would be a policy that reads as enforced and is not — the exact "false
 * sense of security" the HTML specification warns about for security headers in
 * `<meta>`. The request-time path delivers a real header and carries all four.
 */
const META_IGNORED_DIRECTIVES = ['frame-ancestors', 'report-uri', 'report-to', 'sandbox'] as const;

/**
 * Inject CSP <meta> tag into all HTML files (SSG-only).
 *
 * For static sites, CSP is enforced via <meta http-equiv="Content-Security-Policy">
 * rather than HTTP headers. Two shapes have no meta delivery and are refused
 * with a code rather than shipped ineffective:
 *
 * - a REPORT-ONLY policy: `http-equiv` has no report-only pragma, so the only
 *   ways to deliver one are a real HTTP header (the request-time route does
 *   this) or the host's own header configuration;
 * - a policy carrying a directive from {@linkcode META_IGNORED_DIRECTIVES},
 *   which a meta-delivered policy ignores.
 *
 * Nonce-based CSP is NOT supported for SSG (nonces must be per-request and
 * unpredictable - impossible in static files).
 */
export function injectCspMeta(
  dir: string,
  cspPolicy: string,
  reportOnly = false,
  nonce = false,
): void {
  if (reportOnly) {
    throw buildError(
      SsgRenderErrorCode.CSP_META_UNSUPPORTED,
      '[openElement] a report-only CSP has no static delivery: `<meta http-equiv>` carries ' +
        '`Content-Security-Policy` and nothing else, so there is no report-only pragma for the ' +
        'prerendered bytes to use. Deliver it as a real header instead — a request-time route ' +
        'with `middleware.csp.reportOnly` does, and a host that configures response headers ' +
        '(Cloudflare Pages `_headers`, Netlify, nginx) can for a purely static deployment. ' +
        'Set `middleware.csp.reportOnly` to false to enforce the policy from the static meta.',
    );
  }

  const offending = META_IGNORED_DIRECTIVES.filter((directive) =>
    new RegExp(`(?:^|;)\\s*${directive}\\b`, 'i').test(cspPolicy),
  );
  if (offending.length > 0) {
    throw buildError(
      SsgRenderErrorCode.CSP_META_UNSUPPORTED,
      `[openElement] the CSP policy carries ${offending.join(', ')}, which a ` +
        '`<meta http-equiv="Content-Security-Policy">` cannot enforce — the meta delivery ' +
        'ignores them, so the prerendered bytes would carry a policy that reads as enforced ' +
        'and is not. Deliver the policy as a real HTTP header (a request-time route, or the ' +
        'host’s own header configuration) to use these directives, or remove them for the ' +
        'static meta.',
    );
  }

  if (nonce) {
    log.warn(
      'CSP nonce is not supported for SSG static output. ' +
        'Falling back to policy-only Content-Security-Policy meta tag. ' +
        'For per-request nonces, use a server-side middleware instead.',
    );
  }

  const headerName = 'Content-Security-Policy';
  const escapedPolicy = cspPolicy.replace(/"/g, '&quot;');
  const metaTag = `  <meta http-equiv="${headerName}" content="${escapedPolicy}">`;

  visitHtmlFiles(dir, (content) => {
    if (content.includes(`http-equiv="${headerName}"`)) return null;
    return insertAfterHead(content, metaTag);
  });
}

// ─── View Transitions API ─────────────────────────────────────────────

/**
 * Inject the cross-document View Transition opt-in into all HTML files.
 *
 * The opt-in is the `@view-transition` at-rule (CSS View Transitions Level 2):
 * a document stylesheet declaring `navigation: auto` opts the current and
 * destination documents into a transition for a same-origin navigation. The
 * `<meta name="view-transition">` this used to write was the API's early
 * experimental spelling; the at-rule is what the specification defines, and it
 * is what engines now implement.
 *
 * Two facts the at-rule form lets this delivery state and the meta could not:
 *
 * - `prefers-reduced-motion: reduce` opts back out. A cross-document fade is
 *   motion the user asked not to be given, and honouring the preference is the
 *   default here.
 * - An engine without the at-rule ignores an unknown at-rule inside a
 *   stylesheet, exactly as it ignored the meta tag — no script, no feature
 *   detection, no runtime cost.
 *
 * The block is a plain `<style>` in the head, so the capability does not depend
 * on a style engine being selected: it is CSS the platform reads.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@view-transition
 */
export function injectViewTransitionOptIn(dir: string): void {
  /**
   * The opt-in declaration is the injection's own marker: prose mentioning
   * `@view-transition` (a changelog entry, say) must not read as "already
   * injected", which is why the guard tests the declaration and not the name.
   */
  const optIn = '@view-transition { navigation: auto; }';
  const styleBlock = [
    '  <style>',
    `    ${optIn}`,
    '    @media (prefers-reduced-motion: reduce) { @view-transition { navigation: none; } }',
    '  </style>',
  ].join('\n');
  visitHtmlFiles(dir, (content) => {
    if (content.includes(optIn)) return null;
    return insertAfterHead(content, styleBlock);
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

// ─── Element-runtime modulepreload projection (#1544, B2) ─────────────

/** Marker attribute carried by the one runtime-preload link per page. */
export const ELEMENT_RUNTIME_PRELOAD_ATTRIBUTE = 'data-open-element-runtime-preload';

/**
 * The one modulepreload tag for the shared element-runtime chunk (#1544).
 * `modulepreload` is the resource hint that fetches + parses a module graph
 * entry before it is requested, so an island-bearing page keeps the runtime's
 * warm start now that the client entry no longer statically imports it (B2).
 */
export function buildElementRuntimePreloadLink(runtimeUrl: string): string {
  return `<link rel="modulepreload" href="${escapeAttr(
    runtimeUrl,
  )}" ${ELEMENT_RUNTIME_PRELOAD_ATTRIBUTE}>`;
}

/**
 * Inject the shared element-runtime chunk's `<link rel="modulepreload">` into
 * exactly the pages whose island manifest records a client-activatable
 * island (B2, #1544).
 *
 * This is a PROJECTION of the per-page island manifests — the build's one
 * source of page→island facts (`generateIslandManifests`/`postProcessClientIslandBuild`),
 * never a re-derived scan and never a registry:
 *
 *  - a page with a client-activatable island gets the one preload, so the
 *    runtime its hydration will need is already in flight when the entry
 *    executes;
 *  - a page whose manifest is empty (or names only `hydrate: 'none'` islands,
 *    which never enter the client bundle) gets nothing, and because island
 *    activation is host-gated (island-scheduler.ts) no island chunk or
 *    runtime fetch can start there — the runtime stays out of the page's
 *    JS graph;
 *  - the marker attribute makes re-runs idempotent, like the #1561 lane's
 *    `data-open-island-prefetch`.
 *
 * `runtimeUrl` is the emitted chunk's own address (from the client asset
 * manifest). The caller fails closed when an island-bearing native build
 * cannot name it; this writer never guesses one.
 */
export function injectElementRuntimePreload(
  dir: string,
  pageManifests: readonly PageIslandManifest[],
  runtimeUrl: string,
): void {
  const bearing = new Set(
    pageManifests
      .filter((manifest) => pageHasClientIslands(manifest))
      .map((manifest) => manifest.route),
  );
  if (bearing.size === 0) return;
  const link = buildElementRuntimePreloadLink(runtimeUrl);
  for (const entry of walkHtmlFileEntries(dir)) {
    if (!bearing.has(routeFromRelativePath(entry.relativePath))) continue;
    const content = readFileSync(entry.absolutePath, 'utf8');
    if (content.includes(ELEMENT_RUNTIME_PRELOAD_ATTRIBUTE)) continue;
    writeFileSync(entry.absolutePath, insertAfterHead(content, link), 'utf8');
  }
}
