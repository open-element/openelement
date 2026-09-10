/**
 * @openelement/element/html — pure HTML document utilities (Beta.2.2, #1339).
 *
 * Single implementation source for HTML escaping and the document wrapper,
 * shared by the Native and Lit generated server entries. This leaf exists so
 * a renderer that is NOT the Native compiled runtime (e.g. the Lit SSR path)
 * never has to import the package root barrel — which carries the compiled
 * runtime kernel — just to escape HTML or wrap a document. The module graph
 * reachable from here contains no compiler, no Part Program kernel, and no
 * renderer runtime (pinned by __tests__/html-leaf-graph.test.ts).
 */
export {
  escapeAttr,
  escapeAttrValue,
  escapeHtml,
  wrapInDocument,
} from './internal/core/html-escape.ts';
export { trustedHtml } from './internal/core/security.ts';
export type { TrustedHtml } from './internal/core/security.ts';
export type { SafeHtml, UnsafeHtml } from './internal/protocol/framework.ts';
