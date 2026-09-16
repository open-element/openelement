/**
 * Forbidden sink names — the ONE canonical deny list for every Part Program
 * boundary: the compiler semantic core, the protocol validator
 * (internal/protocol/part-program.ts), and the compiled server/claim
 * validator (internal/compiled/server/shared.ts).
 *
 * This module is import-free and host-free by design (same base-of-graph
 * contract as void-tags.ts): all three consumers import it, so a new
 * forbidden sink cannot be enforced on one boundary and missed on another.
 * Charset and `on*` prefix checks are a separate concern and stay with the
 * consumers; this module owns only the named-sink deny lists.
 *
 * The lists are fail closed and case-insensitive (attribute and property
 * names are compared lowercase, matching the HTML parser's name folding):
 *
 * - `FORBIDDEN_ATTRIBUTE_NAMES`: attribute names that must never be a static
 *   attribute or an `attr`/`bool` sink. `srcdoc` smuggles a full HTML
 *   document past attribute escaping; `innerHTML` is admissible only through
 *   the dedicated trusted-HTML `html` Part (ADR-0150), never as a plain
 *   attribute name.
 * - `FORBIDDEN_PROPERTY_NAMES`: `prop` sink names that would re-prototype or
 *   re-construct the target element (prototype-pollution primitives).
 * - `RAW_TEXT_TAGS`: raw-text elements are outside the compiled grammar —
 *   their content cannot be escaped by the serializer.
 */
export const FORBIDDEN_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  'innerhtml',
  'srcdoc',
]);

export const FORBIDDEN_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

export const RAW_TEXT_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
]);

/** Sink categories the canonical deny list classifies. */
export type ForbiddenSinkKind = 'attr' | 'bool' | 'prop' | 'tag';

/**
 * Return a human-readable reason when `name` is a forbidden sink of `kind`,
 * or null when the name is admissible. Unknown kinds fail closed with a
 * reason instead of being waved through.
 */
export function forbiddenSinkReason(kind: ForbiddenSinkKind, name: string): string | null {
  switch (kind) {
    case 'attr':
    case 'bool':
      if (FORBIDDEN_ATTRIBUTE_NAMES.has(name.toLowerCase())) {
        return `attribute name ${JSON.stringify(name)} is a forbidden sink`;
      }
      return null;
    case 'prop':
      if (FORBIDDEN_PROPERTY_NAMES.has(name.toLowerCase())) {
        return `unsafe property sink name ${JSON.stringify(name)}`;
      }
      return null;
    case 'tag':
      if (RAW_TEXT_TAGS.has(name)) {
        return `raw-text element <${name}> is outside the compiled Part Program grammar`;
      }
      return null;
    default:
      return `unknown sink kind ${JSON.stringify(String(kind))}`;
  }
}
