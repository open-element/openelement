/**
 * @openelement/router — Head injection validation & serialization.
 *
 * Extracted from index.ts in v0.22 (SOP-004: build tooling decomposition).
 *
 * Provides:
 * - assertNoScriptTags() — script tag safety check for head fragments
 * - validateSafeUrl()    — URL protocol validation against XSS vectors
 * - buildHeadExtras()    — serialize headFragments, stylesheets, and scripts
 *                          into a single headExtras string
 */

import type { FrameworkOptions } from './internal/protocol/framework.ts';

import { OpenElementError } from '@openelement/element';
import { escapeAttr as escapeHtmlAttr } from '@openelement/element';
import { createLogger, isSafeAttributeName } from '@openelement/element';

const log = createLogger('router-vite:head-injection');

/**
 * Trust boundary for raw head markup (`headExtras`, `inject.headFragments`).
 *
 * These fragments are developer-authored trusted input at the same trust level
 * as `trustedHtml`: the framework passes them through verbatim and does NOT
 * sanitize them. Never concatenate untrusted content (user input, CMS output,
 * third-party HTML) into these fragments; sanitize such data at your own
 * system boundary before it reaches the framework.
 *
 * Two fail-closed invariants are still enforced on every fragment:
 * - no `<script>` tags (use the structured `inject.scripts` API instead);
 * - `<style>` blocks must not carry executable CSS (`@import`, `javascript:`
 *   URLs, …) or event-handler attributes.
 */
/**
 * Quote-aware CSS comment stripper shared by the style safety check below and
 * the critical-assets serializer. Comment sequences inside quoted strings are
 * content, not comments, so they are preserved (a payload quoted inside a
 * string must still reach the blacklist); a comment that never closes is
 * rejected instead of silently kept. `commentReplacement` is a single space
 * for minification (comments separate tokens there) and the empty string for
 * the safety fold (CSS consumes comments entirely, so `@im/**\/port` is a
 * real `@import`). `code` is the caller's failure strategy for unterminated
 * comments: each call site keeps its own error code.
 */
export function stripCssComments(
  css: string,
  context: string,
  code: string,
  commentReplacement: string,
): string {
  let out = '';
  let quote = '';
  let escaped = false;
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    const next = css[index + 1];
    if (quote) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index + 1 < css.length && !(css[index] === '*' && css[index + 1] === '/')) {
        index += 1;
      }
      if (index + 1 >= css.length) {
        throw new OpenElementError(`Invalid CSS in ${context}: unterminated CSS comment`, {
          code,
          statusCode: 400,
          recoverable: false,
        });
      }
      index += 1;
      out += commentReplacement;
      continue;
    }
    out += char;
  }
  return out;
}

/** Fold CSS escapes and strip comments so the blacklist below cannot be
 *  bypassed by `@\69mport`, `@im/**\/port`, `u\72l(...)`, or payloads quoted
 *  inside strings. `code` is the caller's error code for unterminated
 *  comments; the blacklist throw itself stays at the call site. */
export function foldCssForCheck(css: string, context: string, code: string): string {
  return stripCssComments(css, context, code, '')
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => {
      const parsed = Number.parseInt(hex, 16);
      return parsed === 0 || parsed > 0x10FFFF ? '\uFFFD' : String.fromCodePoint(parsed);
    })
    .replace(/\\(.)/g, '$1');
}

function assertStyleTag(attributes: string, css: string, context: string): string {
  if (
    /(?:@import|expression\s*\(|url\s*\(\s*["']?\s*(?:javascript|data|vbscript|file)\s*:)/i.test(
      foldCssForCheck(css, context, 'UNSAFE_HEAD_INJECTION'),
    )
  ) {
    throw new OpenElementError(`Unsafe CSS in ${context}`, {
      code: 'UNSAFE_HEAD_INJECTION',
      statusCode: 400,
      recoverable: false,
    });
  }
  const rendered: string[] = [];
  const attributePattern = /\s+([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/gy;
  let offset = 0;
  while (offset < attributes.length) {
    attributePattern.lastIndex = offset;
    const match = attributePattern.exec(attributes);
    if (!match || match.index !== offset) {
      throw new OpenElementError(`Malformed style attribute in ${context}`, {
        code: 'UNSAFE_HEAD_INJECTION',
        statusCode: 400,
        recoverable: false,
      });
    }
    const name = match[1].toLowerCase();
    if (!['media', 'nonce', 'title'].includes(name) || /^on/i.test(name)) {
      throw new OpenElementError(`Unsafe style attribute in ${context}: "${name}"`, {
        code: 'UNSAFE_HEAD_INJECTION',
        statusCode: 400,
        recoverable: false,
      });
    }
    const value = match[2] ?? match[3];
    rendered.push(value === undefined ? name : `${name}="${escapeHtmlAttr(value)}"`);
    offset = attributePattern.lastIndex;
  }
  return `<style${rendered.length ? ` ${rendered.join(' ')}` : ''}>${css}</style>`;
}

function assertTrustedHeadHtml(html: string, context: string): string {
  const checked = html.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,
    (_, attrs, css) => assertStyleTag(attrs, css, context),
  );
  void checked;
  return html;
}

function assertSafeAttributeName(name: string, context: string): void {
  // The predicate itself lives in @openelement/element (#1033); this path
  // keeps its own failure strategy (throw instead of silent skip).
  if (!isSafeAttributeName(name)) {
    throw new OpenElementError(`Unsafe attribute in ${context}: "${name}"`, {
      code: 'UNSAFE_HEAD_INJECTION',
      statusCode: 400,
      recoverable: false,
    });
  }
}

/**
 * Serialize an attribute record into escaped `name="value"` tokens.
 * `undefined`/`false` values are dropped; `true` renders as a bare
 * (boolean) attribute. Names are validated against `context`.
 */
function serializeAttrList(
  attrs: Record<string, string | number | boolean | undefined>,
  context: string,
): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    assertSafeAttributeName(name, context);
    out.push(
      value === true
        ? escapeHtmlAttr(name)
        : `${escapeHtmlAttr(name)}="${escapeHtmlAttr(String(value))}"`,
    );
  }
  return out;
}

/**
 * Assert that HTML content does NOT contain <script> tags.
 * Scripts must go through inject.scripts for URL validation.
 */
export function assertNoScriptTags(html: string, context: string): void {
  if (/<script[\s>/]/i.test(html)) {
    throw new OpenElementError(
      `${context} must not contain <script> tags. Use inject.scripts for scripts so ` +
        'openElement can validate script URLs and mark the generated head injection as trusted.',
      {
        code: 'UNSAFE_HEAD_INJECTION',
        statusCode: 400,
        recoverable: false,
      },
    );
  }
}

/**
 * Validate a URL string for known XSS vectors (javascript:, data:, etc.).
 * Also validates percent-encoding is not malformed.
 * Returns the normalized URL string.
 */
export function validateSafeUrl(url: string, context: string): string {
  // Normalise: strip tab/LF/CR anywhere (WHATWG URL parsing removes them,
  // so "da\tta:…" would otherwise bypass the protocol blocklist), strip
  // surrounding whitespace; protocol checks run on the decoded value.
  const normalised = url.replace(/[\t\n\r]/g, '').trim();
  try {
    const decoded = decodeURIComponent(normalised); // catch malformed %XX
    const lower = decoded.toLowerCase().replace(/[\t\n\r]/g, '').trim();
    const blockedProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
    for (const proto of blockedProtocols) {
      if (lower.startsWith(proto)) {
        throw new OpenElementError(
          `Unsafe URL in ${context}: "${url}" - ${proto} protocol is not allowed`,
          {
            code: 'UNSAFE_URL',
            statusCode: 400,
            recoverable: false,
          },
        );
      }
    }
  } catch (e) {
    // H-01 fix: Re-throw OpenElementError so security warnings are not swallowed
    if (e instanceof OpenElementError) throw e;
    // v0.14.3: decodeURIComponent can throw for two reasons:
    //   1. Malicious URLs with invalid percent-encoding (e.g., "%ZZ")
    //   2. Legitimate URLs with lone surrogates (rare, but valid URI-encoded)
    // We treat actual URIError as unsafe, but log the distinction for debugging.
    if (e instanceof URIError) {
      log.debug(
        `decodeURIComponent failed for URL in ${context}: "${url}" - ${e.message}. ` +
          'This may be a legitimate encoding issue or a malicious URL.',
      );
    }
    throw new OpenElementError(
      `Invalid URL in ${context}: "${url}" - malformed percent-encoding`,
      {
        code: 'UNSAFE_URL',
        statusCode: 400,
        recoverable: false,
      },
    );
  }
  return normalised;
}

/** Result of building head extras from FrameworkOptions. */
export interface HeadExtrasResult {
  headExtras: string | undefined;
  allowHeadExtrasScripts: boolean;
}

/**
 * Build the headExtras string from FrameworkOptions.inject.
 *
 * Serializes headFragments, stylesheets, and scripts into a single
 * HTML string to inject into <head>. Validates all URLs and ensures
 * no raw <script> tags bypass the structured injection APIs.
 */
export function buildHeadExtras(options: FrameworkOptions): HeadExtrasResult {
  // If direct headExtras provided, validate and return
  if (options.headExtras) {
    assertNoScriptTags(options.headExtras, 'headExtras');
    return {
      headExtras: assertTrustedHeadHtml(options.headExtras, 'headExtras'),
      allowHeadExtrasScripts: false,
    };
  }

  // No inject config - no head extras
  if (!options.inject) {
    return { headExtras: undefined, allowHeadExtrasScripts: false };
  }

  const fragments: string[] = [];

  // headFragments FIRST (meta, styles, anti-flash) - must exist in DOM
  // before scripts that reference them (e.g. theme-init.js removes anti-flash).
  for (const frag of options.inject.headFragments || []) {
    assertNoScriptTags(frag, 'inject.headFragments');
    fragments.push(assertTrustedHeadHtml(frag, 'inject.headFragments'));
  }

  // Stylesheets second
  for (const entry of options.inject.stylesheets || []) {
    const isObj = typeof entry === 'object';
    const href = isObj ? entry.href : entry;
    const safeHref = escapeHtmlAttr(validateSafeUrl(href, 'inject.stylesheets'));
    const linkAttrs: string[] = [`rel="stylesheet"`, `href="${safeHref}"`];
    if (isObj) {
      if (entry.integrity) linkAttrs.push(`integrity="${escapeHtmlAttr(entry.integrity)}"`);
      if (entry.crossorigin) linkAttrs.push(`crossorigin="${escapeHtmlAttr(entry.crossorigin)}"`);
      if (entry.integrity && !entry.crossorigin) linkAttrs.push('crossorigin="anonymous"');
      if (entry.attrs) {
        linkAttrs.push(...serializeAttrList(entry.attrs, 'inject.stylesheets.attrs'));
      }
    }
    fragments.push(`<link ${linkAttrs.join(' ')} />`);
  }

  // Scripts last - depend on headFragments being in DOM
  for (const script of options.inject.scripts || []) {
    const isObjectScript = typeof script === 'object';
    const src = validateSafeUrl(isObjectScript ? script.src : script, 'inject.scripts');
    const attrs: Record<string, string | number | boolean> = {
      ...(!isObjectScript || script.type ? { type: isObjectScript ? script.type! : 'module' } : {}),
      ...(isObjectScript && script.defer ? { defer: true } : {}),
      ...(isObjectScript && script.async ? { async: true } : {}),
      src,
    };
    if (isObjectScript && script.attrs) {
      for (const [k, v] of Object.entries(script.attrs)) {
        assertSafeAttributeName(k, 'inject.scripts.attrs');
        attrs[k] = v;
      }
    }
    // H-04/05 fix: Add SRI attributes for CDN security
    if (isObjectScript) {
      if (script.integrity) attrs.integrity = script.integrity;
      if (script.crossorigin) attrs.crossorigin = script.crossorigin;
      else if (script.integrity) attrs.crossorigin = 'anonymous';
    }
    const attrText = serializeAttrList(attrs, 'inject.scripts').join(' ');
    fragments.push(`<script ${attrText}></script>`);
  }

  return {
    headExtras: fragments.join('\n  '),
    allowHeadExtrasScripts: true,
  };
}
