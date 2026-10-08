/**
 * HTML void elements — the ONE canonical tag set for every serializer,
 * validator, and compiler in the workspace (issue #1220, M4).
 *
 * This module is import-free and host-free by design: it sits at the base of
 * the module graph so the DOM runtime (internal/core/html-escape.ts), the
 * Part Program exchange artifact (internal/protocol/part-program.ts), and the
 * compiler semantic core can all consume the same definition without an
 * import cycle or a second source of truth. Content is the full HTML Standard
 * void-element list, `param` included.
 *
 * Do not redefine this set anywhere else; internal/core/html-escape.ts and
 * internal/protocol/part-program.ts re-export it, and
 * __tests__/void-tags-convergence.test.ts enforces the single owner.
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
