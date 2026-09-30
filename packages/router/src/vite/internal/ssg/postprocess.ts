/**
 * Router tooling internal SSG post-processing.
 *
 * Pure Node.js fs operations for SSG output post-processing.
 * No Vite dependency - these functions only read/write files.
 *
 * URLPattern is used for route matching per WHATWG section7.2.
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

import { createLogger } from '@openelement/element';
import { visitHtmlFiles } from '../html-files.ts';
export { buildSpeculationRulesJson } from './speculation-rules.ts';

const log = createLogger('postprocess');

// Shared directory walker: visitHtmlFiles from ../html-files.ts (#710) —
// walks the tree and applies a visitor to each HTML file. If the visitor
// returns a string, the file is overwritten with that content; if it returns
// null, the file is left unchanged.

// ─── HTML Insertion Helpers ────────────────────────────────────────────

/** Insert content immediately after <head> opening tag (handles attributes) */
function insertAfterHead(html: string, content: string): string {
  // M-11 fix: Use [^>]* instead of [\s\S]*? to prevent backtracking
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
