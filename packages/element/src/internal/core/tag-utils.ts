/**
 * ./tag-utils.ts — Tag name validation utility.
 *
 * Validates custom element tag names per the HTML Custom Elements specification:
 * - Must contain at least one hyphen
 * - Must start with a lowercase ASCII letter
 * - Must contain only lowercase ASCII letters, digits, hyphens, dots, and underscores
 * - Must not start with the reserved "xml" prefix
 * - Must not be one of the reserved names
 *
 * @module ./tag-utils.ts
 */

import { AuthoringErrorCode, ERROR_PREFIX, OpenElementError } from './errors.ts';

// The single casing rule for custom-element attribute names is owned by the
// import-free protocol base (`../protocol/forbidden-sinks.ts`) so the compiler
// semantic core shares it without crossing its bundler-neutral import
// boundary; re-exported here for the core/authoring consumers.
export { camelToKebab } from '../protocol/forbidden-sinks.ts';

/** Reserved custom element names per the HTML specification. */
const RESERVED_CUSTOM_ELEMENT_NAMES = new Set([
  'annotation-xml',
  'color-profile',
  'font-face',
  'font-face-src',
  'font-face-uri',
  'font-face-format',
  'font-face-name',
  'missing-glyph',
]);

/** Potential Custom Element Name regular expression (simplified ASCII subset). */
const CUSTOM_ELEMENT_NAME_RE = /^[a-z][a-z0-9._]*(-[a-z0-9._]+)+$/;

/** Check if a tag name is a valid custom element name per HTML spec. */
export function isValidTagName(tagName: string): boolean {
  if (!tagName || typeof tagName !== 'string') return false;
  if (tagName.startsWith('xml')) return false;
  if (RESERVED_CUSTOM_ELEMENT_NAMES.has(tagName)) return false;
  return CUSTOM_ELEMENT_NAME_RE.test(tagName);
}

/**
 * Assert that a tag name is a valid custom element name.
 *
 * @throws {Error} when the tag name is invalid.
 */
export function assertValidTagName(tagName: string): void {
  if (!isValidTagName(tagName)) {
    throw new OpenElementError(
      `${ERROR_PREFIX} "${tagName}" is not a valid custom element name. ` +
        'Use lowercase ASCII letters, digits, dots, underscores, and at least one hyphen.',
      { code: AuthoringErrorCode.INVALID_TAG_NAME, phase: 'validation' },
    );
  }
}
