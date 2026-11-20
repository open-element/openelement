/**
 * The canonical marked-stylesheet-link writer (M09-2e / #1803).
 *
 * ONE spelling of `<link rel="stylesheet" data-oe-static-styles>` for the class
 * serializer, the public runtime and the generated-element DSD producer; the
 * href rule and the marker stay shared. Browser-safe: no server module, no
 * Node built-in. A malformed href fails closed instead of reaching markup.
 */

import { STATIC_STYLES_MARKER } from '@openelement/protocol/part-program';
import { escapeAttr, isComponentStyleHref } from '../core/html-escape.ts';
import { CompiledProgramValidationError } from './runtime/values.ts';

/** The marked `<link>` tags for a set of component stylesheet URLs. */
export function serializeStyleLinks(links: readonly string[] | undefined): string {
  if (!links || links.length === 0) return '';
  let markup = '';
  for (const href of links) {
    if (!isComponentStyleHref(href)) {
      throw new CompiledProgramValidationError(
        'styleLinks',
        `component stylesheet href must be a site-absolute path or an absolute http(s) URL, got ${JSON.stringify(href)}`,
      );
    }
    markup += `<link rel="stylesheet" href="${escapeAttr(href)}" ${STATIC_STYLES_MARKER} />`;
  }
  return markup;
}
