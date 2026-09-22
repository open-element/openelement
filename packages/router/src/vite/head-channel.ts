/**
 * @openelement/router — the document-head channels (alpha.4 config schema).
 *
 * Two structured inputs feed one serialized head artifact:
 *
 *   1. `openelement.config.ts` `head.stylesheets` / `head.scripts` — links and
 *      external scripts, translated into the framework's `inject` channel and
 *      serialized by head-injection.ts (the one script/link serializer);
 *   2. the `app/head.tsx` convention — structural head content that a URL list
 *      cannot express (meta tags, font preloads, icons, feed links, inline
 *      CSS), which this module validates and serializes.
 *
 * Both are DATA. There is no raw-HTML channel here: every attribute name is
 * checked against the framework's safe-name rule, every URL against the
 * protocol blocklist (javascript:/data:/vbscript:/file:), every attribute value
 * is escaped at this boundary, and inline CSS goes through the same
 * fail-closed style checks as every other head fragment. A string that is not a
 * valid entry fails the build; nothing is skipped silently.
 *
 * This module imports no host APIs beyond the pure host-path helpers, so the
 * dev server, `cli/build` and the SSG phases all serialize the head the same
 * way.
 */

import { isSafeAttributeName, OpenElementError } from '@openelement/element/authoring';
import { escapeAttr } from '@openelement/element/html';
import { assertNoScriptTags, assertTrustedHeadHtml } from '../internal/head-safety.ts';
import { validateSafeUrl } from './head-injection.ts';
import { OPEN_ELEMENT_HEAD_SCRIPT_KEYS, type OpenElementHeadScript } from '../config.ts';

/**
 * One structural head entry from `app/head.tsx`.
 *
 * `meta` and `link` entries are ordered attribute records: the record's own key
 * order is the emitted attribute order, so an author keeps control of the
 * document bytes while every name/value still passes validation. A record's
 * keys are HTML attribute names, never markup — a value containing `<` is
 * escaped, not interpreted.
 */
export type HeadEntry =
  | {
    /** `<meta …>`; `content`/`name`/`property`/`charset` are the usual keys. */
    meta: Record<string, string>;
  }
  | {
    /** `<link …>`; `rel` and `href` are required. */
    link: Record<string, string>;
  }
  | {
    /** One inline `<style>` block; the CSS text is validated, never parsed as markup. */
    style: string;
  };

/** The default export shape of `app/head.tsx`. */
export type HeadConvention = readonly HeadEntry[];

const ENTRY_KEYS: readonly string[] = ['meta', 'link', 'style'];

function headError(message: string, code: string): OpenElementError {
  return new OpenElementError(`[openElement] ${message}`, {
    code,
    severity: 'error',
    phase: 'build',
    recoverable: false,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value;
}

/**
 * Serialize one ordered attribute record into `name="value"` tokens. `true`
 * renders as a bare (boolean) attribute; every other value is escaped. An
 * unsafe attribute name fails the build rather than being dropped: a silently
 * missing `integrity` is a security regression the author cannot see.
 */
function serializeAttrs(
  attrs: Record<string, string>,
  context: string,
): string {
  const tokens: string[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (!isSafeAttributeName(name)) {
      throw headError(
        `${context} has an unsafe attribute name: "${name}". ` +
          `Allowed: letters, digits, and the punctuation HTML attribute names use.`,
        'CONFIG_INVALID',
      );
    }
    if (typeof value !== 'string') {
      throw headError(
        `${context} attribute "${name}" must be a string; got ${describe(value)}.`,
        'CONFIG_INVALID',
      );
    }
    tokens.push(`${escapeAttr(name)}="${escapeAttr(value)}"`);
  }
  return tokens.join(' ');
}

function serializeMeta(attrs: Record<string, string>, context: string): string {
  return `<meta ${serializeAttrs(attrs, context)}>`;
}

function serializeLink(attrs: Record<string, string>, context: string): string {
  for (const required of ['rel', 'href']) {
    if (typeof attrs[required] !== 'string' || attrs[required].length === 0) {
      throw headError(
        `${context} must declare a non-empty "${required}". A <link> without it ` +
          `is meaningless to the browser.`,
        'CONFIG_INVALID',
      );
    }
  }
  // The href keeps its authored position in the record; its VALUE is the
  // protocol-checked, normalized URL the framework's stylesheet channel emits,
  // so a crafted `java\tscript:` cannot ride through unnormalized.
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    normalized[name] = name === 'href' ? validateSafeUrl(value, `${context}.href`) : value;
  }
  return `<link ${serializeAttrs(normalized, context)} />`;
}

function serializeStyle(css: unknown, context: string): string {
  if (typeof css !== 'string' || css.length === 0) {
    throw headError(
      `${context} must be a non-empty CSS string; got ${describe(css)}.`,
      'CONFIG_INVALID',
    );
  }
  const fragment = `<style>${css}</style>`;
  // The same fail-closed style invariants every other head fragment meets:
  // no @import, no javascript:/data: URLs, no event-handler attributes.
  assertNoScriptTags(fragment, context);
  assertTrustedHeadHtml(fragment, context);
  return fragment;
}

/**
 * Validate the `app/head.tsx` default export. Throws {@linkcode OpenElementError}
 * with `CONFIG_INVALID`; every unknown shape is named, never skipped.
 */
export function assertValidHeadConvention(
  value: unknown,
): asserts value is HeadConvention {
  const context = 'app/head.tsx';
  if (!Array.isArray(value)) {
    throw headError(
      `${context} must default-export an array of head entries ` +
        `({ meta: {…} } | { link: {…} } | { style: 'css' }); got ${describe(value)}. ` +
        `Export a value or a function returning one.`,
      'CONFIG_INVALID',
    );
  }
  for (const [index, entry] of value.entries()) {
    const entryContext = `${context}[${index}]`;
    if (!isPlainObject(entry)) {
      throw headError(
        `${entryContext} must be an object; got ${describe(entry)}.`,
        'CONFIG_INVALID',
      );
    }
    const keys = Object.keys(entry);
    if (keys.length !== 1 || !ENTRY_KEYS.includes(keys[0])) {
      throw headError(
        `${entryContext} must carry exactly one of: ${ENTRY_KEYS.join(', ')}; ` +
          `got ${keys.length === 0 ? 'no keys' : keys.join(', ')}.`,
        'CONFIG_INVALID',
      );
    }
    const kind = keys[0];
    if (kind === 'style') {
      serializeStyle(entry[kind], entryContext);
      continue;
    }
    if (!isPlainObject(entry[kind])) {
      throw headError(
        `${entryContext}.${kind} must be an object; got ${describe(entry[kind])}.`,
        'CONFIG_INVALID',
      );
    }
    const values = entry[kind] as Record<string, unknown>;
    for (const [name, attribute] of Object.entries(values)) {
      if (typeof attribute !== 'string') {
        throw headError(
          `${entryContext}.${kind} attribute "${name}" must be a string; got ${
            describe(attribute)
          }.`,
          'CONFIG_INVALID',
        );
      }
    }
  }
}

/** Serialize a validated `app/head.tsx` export into ordered head fragments. */
export function serializeHeadConvention(value: HeadConvention): string[] {
  return value.map((entry, index) => {
    const context = `app/head.tsx[${index}]`;
    if ('style' in entry) return serializeStyle(entry.style, context);
    if ('link' in entry) {
      return serializeLink(entry.link as Record<string, string>, `${context}.link`);
    }
    return serializeMeta(entry.meta as Record<string, string>, `${context}.meta`);
  });
}

/**
 * Resolve an `app/head.tsx` module value: an exported array, or a function
 * returning one (the resolver idiom `page.head` already uses, so a head module
 * that needs to compute from a constant can do it in one place).
 */
export function resolveHeadConventionExport(value: unknown, context: string): HeadConvention {
  let resolved = value;
  if (typeof resolved === 'function') {
    resolved = (resolved as () => unknown)();
  }
  try {
    assertValidHeadConvention(resolved);
  } catch (error) {
    throw headError(
      `${context}: ${error instanceof Error ? error.message : error}`,
      'CONFIG_INVALID',
    );
  }
  return resolved;
}

/**
 * Translate `head.scripts` into the framework's structured script channel.
 * The channel's serializer (head-injection.ts) is the ONE place a `<script>`
 * tag is built, so a config-file script and an inline `inject.scripts` entry
 * produce the same bytes.
 */
export function headScriptsToInject(
  scripts: readonly OpenElementHeadScript[] | undefined,
): FrameworkScriptEntry[] | undefined {
  if (!scripts || scripts.length === 0) return undefined;
  return scripts.map((script, index) => {
    const context = `head.scripts[${index}]`;
    if (typeof script !== 'object' || script === null || Array.isArray(script)) {
      throw headError(
        `${context} must be an object ({ src, defer?, crossOrigin?, integrity? }); got ${
          describe(script)
        }.`,
        'CONFIG_INVALID',
      );
    }
    for (const key of Object.keys(script)) {
      if (!OPEN_ELEMENT_HEAD_SCRIPT_KEYS.includes(key)) {
        throw headError(
          `Unknown ${context} key "${key}". Accepted keys: ${
            OPEN_ELEMENT_HEAD_SCRIPT_KEYS.join(', ')
          }.`,
          'CONFIG_UNKNOWN_KEY',
        );
      }
    }
    if (typeof script.src !== 'string' || script.src.length === 0) {
      throw headError(
        `${context}.src must be a non-empty string; got ${describe(script.src)}.`,
        'CONFIG_INVALID',
      );
    }
    if (script.defer !== undefined && typeof script.defer !== 'boolean') {
      throw headError(
        `${context}.defer must be a boolean; got ${describe(script.defer)}.`,
        'CONFIG_INVALID',
      );
    }
    const crossOrigin = script.crossOrigin;
    if (
      crossOrigin !== undefined && crossOrigin !== 'anonymous' &&
      crossOrigin !== 'use-credentials'
    ) {
      throw headError(
        `${context}.crossOrigin must be "anonymous" or "use-credentials"; got ${
          describe(crossOrigin)
        }.`,
        'CONFIG_INVALID',
      );
    }
    if (script.integrity !== undefined && typeof script.integrity !== 'string') {
      throw headError(
        `${context}.integrity must be a string; got ${describe(script.integrity)}.`,
        'CONFIG_INVALID',
      );
    }
    return {
      src: script.src,
      ...(script.defer === undefined ? {} : { defer: script.defer }),
      ...(crossOrigin === undefined ? {} : { crossorigin: crossOrigin }),
      ...(script.integrity === undefined ? {} : { integrity: script.integrity }),
    };
  });
}

/** The framework `inject.scripts` entry shape (single serializer downstream). */
export interface FrameworkScriptEntry {
  src: string;
  defer?: boolean;
  crossorigin?: 'anonymous' | 'use-credentials';
  integrity?: string;
}

/**
 * Translate `head.stylesheets` into the framework's structured stylesheet
 * channel (each entry a URL string, so there is no attribute escape hatch).
 */
export function headStylesheetsToInject(
  stylesheets: readonly string[] | undefined,
): string[] | undefined {
  if (!stylesheets || stylesheets.length === 0) return undefined;
  return [...stylesheets];
}
