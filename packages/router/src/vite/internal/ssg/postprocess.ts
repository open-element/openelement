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

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, normalize, relative } from 'pathe';
import { createLogger } from '@openelement/element';
import { escapeAttr } from '@openelement/element/html';
import { buildError, SsgRenderErrorCode } from '../../../internal/error-codes.ts';
import { stylesheetLinkTag } from '../../head-injection.ts';
import { visitHtmlFiles, walkHtmlFileEntries } from '../html-files.ts';
import { SSG_VIEW_TRANSITION_STYLE_PREFIX } from '../paths.ts';
import { publicFileDigest } from '../publish-manifest.ts';
import { type PageIslandManifest, routeFromRelativePath } from './island-manifest.ts';
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
 * One linked stylesheet opts in the pages prerendered by this run, regardless
 * of whether they have islands or a configured style engine. Keeping the link
 * at the start of the head lets later author styles retain cascade precedence.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@view-transition
 */
export function injectViewTransitionOptIn(
  dir: string,
  pages: readonly string[],
  base: string,
): string | undefined {
  const htmlPages = pages.filter((page) => page.endsWith('.html'));
  if (htmlPages.length === 0) return;

  const css = [
    '@view-transition { navigation: auto; }',
    '@media (prefers-reduced-motion: reduce) { @view-transition { navigation: none; } }',
    '',
  ].join('\n');
  const hash = publicFileDigest(Buffer.from(css)).slice(0, 12);
  const assetPath = `${SSG_VIEW_TRANSITION_STYLE_PREFIX}${hash}.css`;
  const asset = join(realpathSync(dir), assetPath);
  const assetDir = dirname(asset);
  mkdirSync(assetDir, { recursive: true });
  if (normalize(realpathSync(assetDir)) !== assetDir) {
    throw new Error(`Expected a canonical SSG stylesheet directory at ${assetDir}`);
  }
  if (existsSync(asset)) {
    if (!lstatSync(asset).isFile() || readFileSync(asset, 'utf8') !== css) {
      throw new Error(`SSG view-transition stylesheet conflicts with ${asset}`);
    }
  } else {
    writeFileSync(asset, css, { flag: 'wx' });
  }

  // Vite's absolute base may include a CDN origin. Files from the public SSG
  // snapshot use the same origin as the document, under that base's path.
  const basePath = new URL(base, 'http://localhost/').pathname
    .replace(/^\/+/, '/')
    .replace(/\/?$/, '/');
  for (const page of htmlPages) {
    const href =
      base === './' ? relative(dirname(page), join(dir, assetPath)) : `${basePath}${assetPath}`;
    const link = stylesheetLinkTag(href);
    const content = readFileSync(page, 'utf8');
    if (!content.includes(link)) writeFileSync(page, insertAfterHead(content, link), 'utf8');
  }
  return assetPath;
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

// ─── Element-runtime modulepreload projection (#1544, B2) ─────────────

/** Identifies runtime preload links so repeated projection is idempotent. */
export const ELEMENT_RUNTIME_PRELOAD_ATTRIBUTE = 'data-open-element-runtime-preload';

export function buildElementRuntimePreloadLink(runtimeUrl: string): string {
  return `<link rel="modulepreload" href="${escapeAttr(
    runtimeUrl,
  )}" ${ELEMENT_RUNTIME_PRELOAD_ATTRIBUTE}>`;
}

/** Preload runtime dependencies of islands due at page load or the first idle turn. */
export function injectElementRuntimePreload(
  dir: string,
  pageManifests: readonly PageIslandManifest[],
  runtimePreloads: ReadonlyMap<string, readonly string[]>,
): void {
  const linksByRoute = new Map<string, string>();
  for (const manifest of pageManifests) {
    const urls = new Set<string>();
    for (const island of manifest.islands) {
      // The scheduler owns media and viewport activation. A preload would
      // download their runtime before those predicates have matched.
      if (
        island.strategy === 'none' ||
        island.strategy === 'visible' ||
        island.strategy === 'media'
      )
        continue;
      for (const url of runtimePreloads.get(island.chunkUrl) ?? []) urls.add(url);
    }
    if (urls.size > 0) {
      linksByRoute.set(manifest.route, [...urls].map(buildElementRuntimePreloadLink).join('\n'));
    }
  }
  if (linksByRoute.size === 0) return;
  for (const entry of walkHtmlFileEntries(dir)) {
    const links = linksByRoute.get(routeFromRelativePath(entry.relativePath));
    if (!links) continue;
    const content = readFileSync(entry.absolutePath, 'utf8');
    if (content.includes(ELEMENT_RUNTIME_PRELOAD_ATTRIBUTE)) continue;
    writeFileSync(entry.absolutePath, insertAfterHead(content, links), 'utf8');
  }
}
