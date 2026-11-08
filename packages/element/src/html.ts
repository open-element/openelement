/**
 * @openelement/element/html — pure HTML document utilities (Beta.2.2, #1339).
 *
 * Single implementation source for HTML escaping and the document wrapper:
 * used by the generated native server entry through the package root barrel,
 * and imported directly by kernel-free build/config consumers. The leaf
 * exists so a consumer that is not the compiled runtime never has to import
 * the package root barrel — which carries the compiled runtime kernel — just
 * to escape HTML or wrap a document. The module graph reachable from here
 * contains no compiler, no Part Program kernel, and no renderer runtime.
 */
export {
  createDocumentStyleResources,
  escapeAttr,
  escapeAttrValue,
  escapeHtml,
  isComponentStyleHref,
  wrapInDocument,
} from './internal/core/html-escape.ts';
export type { DocumentStyleResources } from './internal/core/html-escape.ts';
export { trustedHtml } from './internal/core/security.ts';
export type { TrustedHtml } from './internal/core/security.ts';
export type { SafeHtml, UnsafeHtml } from '@openelement/protocol/framework';
