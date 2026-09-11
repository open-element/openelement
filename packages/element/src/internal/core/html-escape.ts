/**
 * html-escape.ts - Safe/Unsafe HTML Contract
 *
 * Branded types for HTML escaping semantics:
 * - SafeHtml:  A string that has been HTML-escaped (safe for text content)
 * - UnsafeHtml: A string that is intentionally raw HTML (do not double-escape)
 *
 * @module ./html-escape.ts
 */

// ─── L1: Safe/Unsafe HTML Contract ──────────────────────────────

import { createLogger, createWarnScope, warnOnce } from './logger.ts';
import type { WarnScope } from './logger.ts';

const log = createLogger('html-escape');

import type { SafeHtml, UnsafeHtml } from '../protocol/framework.ts';
export type { SafeHtml, UnsafeHtml };

/**
 * Escape a string for safe HTML text content insertion.
 * Uses single-pass replacement for performance (P-01 fix).
 * Branded types are compile-time only - removed dead runtime branches (M-01 fix).
 */
const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
/** Escape the five HTML-significant characters in text content. */
export function escapeHtml(str: string): string {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] || ch);
}

/**
 * Escape an HTML attribute value.
 *
 * Delegates to `escapeHtml` so both share the single `ESCAPE_MAP` and the
 * same single-pass replacement (consolidated in v0.42.0-alpha.9, #633).
 *
 * Twin: sanitize.ts has its own escapeAttr with a deliberately different
 * entity-preservation contract — do not consolidate (see the note at
 * sanitize.ts:161).
 *
 * Empty-value conventions remain intentionally distinct by design:
 * - `escapeHtml` returns '' for non-string input.
 * - `escapeAttrValue` (below) coerces via `String()` and is the boundary
 *   meant for unknown/variable attribute values.
 */
export function escapeAttr(value: string): string {
  return escapeHtml(value);
}

/** Escape a string for use as an attribute value (double-quoted) */
export function escapeAttrValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return escapeAttr(String(value));
}

/**
 * HTML void elements — the ONE canonical tag set for every serializer,
 * sanitizer, validator, and compiler in the workspace (issue #1220, M4).
 * Content is the full HTML Standard void-element list, `param` included.
 *
 * The mirrored Part Program exchange artifacts (`internal/compiled/program.ts`
 * and its semantic-core copy) intentionally have no import edge, so each
 * carries a mechanical mirror of this list that must stay byte-identical to
 * the tags here; the convergence guard test (adapter-vite
 * __tests__/void-tags-convergence.test.ts) enforces that. Every other
 * consumer imports this definition.
 */
export const VOID_TAGS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Wrap rendered HTML in a full HTML document.
 * Adds DOCTYPE, head (title, meta, preload), and body.
 * Supports CSP nonce and dev scripts (e.g. Vite client, route module registration).
 */
export function wrapInDocument(
  html: string,
  options: {
    title?: string;
    lang?: string;
    /** Client-side module script injected after rendered HTML. */
    clientScript?: string;
    meta?: {
      description?: string;
      tags?: Array<Record<string, string | number | boolean>>;
    };
    /** Raw HTML script tags to inject after rendered HTML (e.g. Vite client, route module registration). */
    devScripts?: string;
    headExtras?: string;
    /**
     * Raw route-local head fragments from explicit dangerous page metadata.
     * Trust boundary: injected verbatim into <head>; never concatenate
     * unsanitized user-controlled content into these fragments.
     */
    dangerouslyHeadFragments?: string[];
    /** Trust script tags that were produced by structured framework injection APIs. */
    allowHeadExtrasScripts?: boolean;
    /**
     * <link> tags emitted into <head> (Beta.2.2, #1326): the canonical link
     * and hreflang alternates of the page. Attributes are escaped at this
     * boundary; entries missing rel or href are skipped. Meaning-level
     * resolution lives in @openelement/router/document.
     */
    links?: Array<{ rel: string; href: string; hreflang?: string }>;
    /** CSP nonce, if provided, added to all generated <script> tags. */
    cspNonce?: string;
  } = {},
): string {
  // Per-render warning scope: the same headExtras key can warn again on the
  // next SSG page/request instead of being suppressed for the whole process
  // (v0.42.0-alpha.9, #643).
  const warnScope = createWarnScope();
  const {
    title = 'openElement',
    lang = 'en',
    clientScript = '',
    meta,
    devScripts = '',
    headExtras = '',
    dangerouslyHeadFragments = [],
    allowHeadExtrasScripts = false,
    links = [],
    cspNonce,
  } = options;
  // v0.14.5: CSP nonce format validation per CSP spec (base64 value)
  const NONCE_RE = /^[A-Za-z0-9+/=_-]+$/;
  const validNonce = cspNonce && NONCE_RE.test(cspNonce) ? cspNonce : undefined;
  if (cspNonce && !validNonce) {
    log.warn(`Invalid CSP nonce format: "${cspNonce}". Nonce should be a base64-encoded value.`);
  }
  const safeHeadExtras = sanitizeHeadExtras(headExtras, allowHeadExtrasScripts, warnScope);
  validateHeadExtrasBalance(headExtras);
  const metaTags = buildMetaTags(meta);
  const metaBlock = metaTags.length > 0 ? '\n' + metaTags.join('\n') + '\n' : '';
  const linkTags = buildLinkTags(links);
  const linkBlock = linkTags.length > 0 ? '\n' + linkTags.join('\n') : '';
  const dangerousHeadBlock = dangerouslyHeadFragments.length > 0
    ? '\n  ' + dangerouslyHeadFragments.join('\n  ')
    : '';

  const safeTitle = escapeHtml(title);
  const safeLang = escapeAttr(lang);

  return `<!DOCTYPE html>
<html lang="${safeLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>${metaBlock}${linkBlock}
  ${safeHeadExtras}${dangerousHeadBlock}
</head>
<body>
  ${html}
  ${clientScript}${devScripts}
</body>
</html>`;
}

/**
 * v0.14.8: C-02 fix - Runtime enforcement for headExtras.
 * If headExtras contains <script> tags and allowHeadExtrasScripts is false,
 * strip them to prevent XSS. Developer should use inject.scripts for safe injection.
 */
function sanitizeHeadExtras(
  headExtras: string,
  allowHeadExtrasScripts: boolean,
  warnScope: WarnScope,
): string {
  if (allowHeadExtrasScripts || !headExtras) return headExtras;
  // Strip <script> tags and their content. The delimiter class includes `/`
  // (`<script/src=...>` is still a script tag to the browser). The end-tag
  // pattern accepts attributes/whitespace because browsers ignore them on end
  // tags (`</script\t\n bar>` still ends the script raw-text element). Both
  // properties hold only when the strip runs to a fixed point: removing an
  // inner pair can re-form a live outer `<script>...</script>`, so the block
  // pass repeats until stable before the final backstop strips an unclosed
  // `<script ...>` to end-of-input (browsers treat the rest of the document
  // as script raw text). Fixed-point first keeps that backstop from eating
  // legitimate trailing markup (CodeQL #1281).
  const SCRIPT_BLOCK_RE = /<script[\s>/][\s\S]*?<\/script(?=[\s/>])[^>]*>/gi;
  const SCRIPT_OPEN_TO_EOF_RE = /<script[\s>/][\s\S]*$/gi;
  let safeHeadExtras = headExtras;
  for (;;) {
    const stripped = safeHeadExtras.replace(SCRIPT_BLOCK_RE, '');
    if (stripped === safeHeadExtras) break;
    safeHeadExtras = stripped;
  }
  safeHeadExtras = safeHeadExtras.replace(SCRIPT_OPEN_TO_EOF_RE, '');
  if (safeHeadExtras !== headExtras) {
    warnOnce(
      'headExtrasScripts',
      log,
      'headExtras contained <script> tags which were stripped for security. ' +
        'Use inject.scripts for safe script injection, or set allowHeadExtrasScripts: true.',
      warnScope,
    );
  }
  // Strip on* event handler attributes (strong XSS indicator). Also to a
  // fixed point: a match ending at a quoted value can leave a concatenated
  // `on...=` sequence that only becomes strippable once the earlier match is
  // removed (CodeQL #1281).
  if (/\s+on\w+\s*=/i.test(safeHeadExtras)) {
    const EVENT_HANDLER_ATTR_RE = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
    for (;;) {
      const stripped = safeHeadExtras.replace(EVENT_HANDLER_ATTR_RE, '');
      if (stripped === safeHeadExtras) break;
      safeHeadExtras = stripped;
    }
    log.warn(
      'headExtras contained on* event handler attributes which were stripped for security.',
    );
  }
  return safeHeadExtras;
}

/**
 * v0.14.3: Basic HTML tag balance validation for headExtras.
 * Checks that opening and closing tag counts match for major HTML elements.
 * This catches obviously malformed HTML (e.g., unclosed <!-- comments).
 */
function validateHeadExtrasBalance(headExtras: string): void {
  if (!headExtras) return;
  // Check for unclosed HTML comments: <!-- without a matching close. The
  // HTML standard also accepts `--!>` as an (abrupt) comment close, so both
  // forms count (CodeQL #1281).
  const commentOpens = (headExtras.match(/<!--/g) || []).length;
  const commentCloses = (headExtras.match(/--!?>/g) || []).length;
  if (commentOpens !== commentCloses) {
    log.warn(
      'headExtras has unbalanced HTML comments (<!-- vs -->). ' +
        'This may cause HTML parsing issues.',
    );
  }
}

/** Serialize the meta description and arbitrary meta tags. */
function buildMetaTags(
  meta?: { description?: string; tags?: Array<Record<string, string | number | boolean>> },
): string[] {
  const metaTags: string[] = [];
  if (meta?.description) {
    const safeDesc = escapeAttrValue(meta.description);
    metaTags.push(`  <meta name="description" content="${safeDesc}">`);
  }
  if (Array.isArray(meta?.tags)) {
    for (const tag of meta.tags) {
      const attrs = Object.entries(tag)
        .map(([key, value]) => `${escapeAttr(key)}="${escapeAttrValue(value)}"`)
        .join(' ');
      if (attrs) metaTags.push(`  <meta ${attrs}>`);
    }
  }
  return metaTags;
}

/**
 * Serialize <link> tags (Beta.2.2, #1326). Attributes are escaped here; an
 * entry without both rel and href is meaningless and skipped — meaning-level
 * validation (which links a page declares) is resolvePageDocument's job.
 */
function buildLinkTags(
  links: Array<{ rel: string; href: string; hreflang?: string }>,
): string[] {
  const linkTags: string[] = [];
  for (const link of links) {
    if (!link || !link.rel || !link.href) continue;
    const attrs = [`rel="${escapeAttrValue(link.rel)}"`, `href="${escapeAttrValue(link.href)}"`];
    if (link.hreflang) attrs.push(`hreflang="${escapeAttrValue(link.hreflang)}"`);
    linkTags.push(`  <link ${attrs.join(' ')}>`);
  }
  return linkTags;
}
