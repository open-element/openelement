/**
 * security.ts - SSR Security Guards.
 *
 * Properties that MUST NOT be injected from untrusted props.
 * These are Object.prototype internals and dangerous overrides that
 * could be exploited via arbitrary property assignment.
 *
 * The one canonical dangerous-key rule (constitution 4.2, #903, #1214).
 * Consumers: props-utils.ts (host prop collection / SSR serialization via
 * collectPublicProps and normalizePublicProps), the guarded assigner
 * injectPropsSafe below (employed by the SPA bootstrap page-projection write
 * boundary in @openelement/router), and the page projectors in @openelement/router
 * (authoring.ts projectPageProps) and the adapter-vite generated server
 * runtime (which serializes DANGEROUS_KEYS into generated code at build
 * time — generated modules cannot import this internal module, so the
 * canonical list is the single source they copy from).
 *
 * @module ./security.ts
 */

import { createLogger, warnOnce } from './logger.ts';
import { formatError, OpenElementError } from './errors.ts';

/** Object prototype keys that must never be injected from untrusted props. */
export const DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toString',
  'toLocaleString',
  'valueOf',
]);

/**
 * Shared dangerous-key predicate (#903, #1214). Prototype-internal keys must
 * never be injected from untrusted props on ANY path: host prop collection
 * (collectPublicProps / normalizePublicProps in props-utils.ts), guarded
 * assignment (injectPropsSafe below — the SPA bootstrap page-projection
 * write boundary in @openelement/router), and page projection (authoring.ts
 * projectPageProps; the adapter-vite generated server runtime via the
 * serialized DANGEROUS_KEYS list) all filter through this single source so a
 * new dangerous pattern cannot be missed on one path.
 */
export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key);
}

/**
 * Shared safe-attribute-name predicate (#1033). Attribute *names* are not
 * escaped on any render path, so a name must be a valid HTML attribute name
 * (blocks quote/space injection, #602) and must not be an event handler
 * (`on*`, case-insensitive). render-ir.ts (silent skip) and adapter-vite
 * head-injection.ts (throw) enforce the same rule with different failure
 * strategies; both delegate here so the boundary cannot diverge.
 */
export function isSafeAttributeName(name: string): boolean {
  return /^[a-zA-Z_:][\w:.-]*$/.test(name) && !/^on/i.test(name);
}

/**
 * Mark caller-supplied HTML as trusted before injection into a DOM/string render path.
 *
 * `trustedHtml` is an explicit trust boundary, not a sanitizer. Core escapes
 * untrusted text by default; callers that cross this boundary must sanitize or
 * otherwise trust the HTML before passing it to openElement.
 */
const _securityLog = createLogger('security');

const trustedHtmlValues = new WeakSet<object>();

/** Opaque capability marking HTML the application has explicitly vetted as trusted. */
export interface TrustedHtml {
  readonly html: string;
}

/** Mark an HTML string as trusted for explicit `innerHTML` sinks (the trust does not serialize). */
export function trustedHtml(html: string): TrustedHtml {
  const value = Object.freeze({ html });
  trustedHtmlValues.add(value);
  return value;
}

/** Internal sink guard. Serialization deliberately loses this capability. */
export function trustedHtmlValue(value: unknown): string {
  if (typeof value !== 'object' || value === null || !trustedHtmlValues.has(value)) {
    throw new OpenElementError(
      '[openElement] html Part requires a value created by trustedHtml(); ordinary strings are rejected.',
      { code: 'UNTRUSTED_HTML_SINK', phase: 'render' },
    );
  }
  return (value as TrustedHtml).html;
}

/** @deprecated Use trustedHtml(). */
export function trustRenderHtml(html: string): TrustedHtml {
  warnOnce(
    'trustedHtml',
    _securityLog,
    'trustRenderHtml is a trust boundary, not a sanitizer. ' +
      'Caller must ensure HTML content is safe before passing to openElement.',
  );
  return trustedHtml(html);
}

/**
 * Safely assign caller-supplied props onto a target object, skipping keys that
 * could enable prototype pollution and tolerating read-only properties.
 *
 * The canonical guarded assigner for the canonical dangerous-key rule (#903,
 * #1214): the @openelement/router SPA bootstrap employs it at the page-property
 * projection write boundary so descriptor projector output, default
 * projection, and error projection can never re-prototype the live page host.
 * Callers pass their own logger so existing log channels are preserved; a
 * security logger is used when none is supplied.
 *
 * @param target - Object that receives the props (element instance or record).
 * @param props - Caller-supplied prop map.
 * @param tagName - Tag name used in log messages (e.g. `my-el`).
 * @param log - Logger exposing `warn`/`debug`; defaults to the security logger.
 */
export function injectPropsSafe(
  target: Record<string, unknown>,
  props: Record<string, unknown>,
  tagName: string,
  log: { warn(message: string): void; debug(message: string): void } = _securityLog,
): void {
  for (const key of Object.keys(props)) {
    if (isDangerousKey(key)) {
      log.warn(
        `Skipping dangerous prop key "${key}" on <${tagName}> - potential prototype pollution`,
      );
      continue;
    }
    let value: unknown;
    try {
      value = Reflect.get(props, key);
    } catch (e) {
      log.debug(`Skipping throwing getter prop "${key}" on <${tagName}>: ${formatError(e)}`);
      continue;
    }
    try {
      target[key] = value;
    } catch (e) {
      log.debug(
        `Cannot set read-only property "${key}" on <${tagName}>: ${formatError(e)}`,
      );
    }
  }
}
