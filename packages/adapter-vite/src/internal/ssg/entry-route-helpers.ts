/** Shared route-entry expressions and document option emission. */
import type { ImportDecl, RendererDecl } from '../protocol/ssg.ts';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';

export function renderImport(imp: ImportDecl): string {
  const names = imp.alias ? `${imp.names[0]} as ${imp.alias}` : imp.names.join(', ');
  return `import { ${names} } from '${imp.from}'`;
}

/**
 * Page-route tag expression (#1276, B1.3-F1): resolves the route→program tag
 * binding from the route module's compiled Part Program at generated-entry
 * evaluation time (`__resolvePageTag`, emitted by entry-render-runtime.ts).
 * The path-derived tag is passed only as the fallback for classes without a
 * compiled program. Used for SSR registration, the page/404 handlers, and the
 * SSG routeInfo — one canonical binding for every page-route tag consumer.
 */
export function pageRouteTagExpr(varName: string, fallbackTagName: string): string {
  return `__resolvePageTag(${varName}, ${quoteGeneratedJavaScriptValue(fallbackTagName)})`;
}

export function pageDefinitionExpr(varName: string): string {
  return `__pageDefinition(${varName})`;
}

export function routeMetaExpr(varName: string): string {
  return `__routeMeta(${varName})`;
}

/**
 * Renderer scope matching, case-sensitive (URL paths are case-sensitive and
 * Hono routes match case-sensitively). Used at codegen time by
 * renderRouteHandler; the runtime __matchingRenderers function emitted by
 * renderMatchingRenderersFn() must mirror these semantics exactly.
 */
export function rendererScopeMatches(routePath: string, scope: string): boolean {
  if (scope === '/') return true;
  return routePath === scope || routePath.startsWith(scope + '/');
}

/**
 * Emit the runtime __matchingRenderers(routePath) function for the SSG
 * renderRoute. Semantics mirror rendererScopeMatches() — keep them in sync.
 */
export function renderMatchingRenderersFn(lines: string[], renderers: RendererDecl[]): void {
  lines.push('function __matchingRenderers(routePath) {');
  lines.push('  const renderers = [];');
  for (const renderer of renderers) {
    if (renderer.scope === '/') {
      lines.push(`  renderers.push(${renderer.varName}.default);`);
    } else {
      lines.push(
        `  if (routePath === ${
          quoteGeneratedJavaScriptValue(renderer.scope)
        } || routePath.startsWith(${
          quoteGeneratedJavaScriptValue(renderer.scope + '/')
        })) renderers.push(${renderer.varName}.default);`,
      );
    }
  }
  lines.push('  return renderers;');
  lines.push('}');
}

/**
 * Emit the per-render resolved-Document setup (#1326): the descriptor head
 * (static object or resolver function) is resolved exactly once against the
 * same context object the props projector consumes, before wrapInDocument
 * serializes the page. `documentWrapOptionsLines` then reads only `__doc`.
 */
export function documentResolutionSetupLine(pageExpr: string, contextExpr: string): string {
  return `const __doc = __resolvePageDocument(${pageExpr}.head, ${contextExpr});`;
}

/**
 * Emit the request-time (Hono handler) page context + resolved-Document
 * setup: ONE context object per render feeds both the props projector and the
 * head resolver, so the Document never sees a divergent view of the render.
 * Shared by the page/action handlers and the styled-404 handler.
 */
export function requestTimePageContextLines(
  lines: string[],
  options: { dataExpr: string; actionDataExpr: string; indent: string },
): void {
  lines.push(
    `${options.indent}const __pageContext = { data: ${options.dataExpr}, actionData: ${options.actionDataExpr}, params: __params, request: c.req.raw, locale: __localeFromPath(c.req.path, __getDefaultLocale()), route: __routeContext, meta: __routeMetaValue };`,
  );
  lines.push(`${options.indent}${documentResolutionSetupLine('__page', '__pageContext')}`);
}

/** wrapInDocument() options object shared by page handlers and the SSG renderRoute. */
export function documentWrapOptionsLines(options: {
  /** Expression yielding the title, reading the resolved document, e.g. `title || __doc.title || "Default"`. */
  titleExpr: string;
  /** Expression yielding the document language, reading the resolved document. */
  langExpr: string;
  headExtrasExpr: string;
  allowHeadExtrasScripts: boolean;
  /** Emit the per-request CSP nonce line (Hono handlers only). */
  cspNonce?: boolean;
}): string[] {
  const lines = [
    `title: ${options.titleExpr},`,
    `lang: ${options.langExpr},`,
    `meta: { description: __doc.description, tags: __doc.meta },`,
    `links: __doc.links,`,
    `headExtras: ${options.headExtrasExpr},`,
    `dangerouslyHeadFragments: __doc.dangerouslyHeadFragments || [],`,
    `allowHeadExtrasScripts: ${JSON.stringify(options.allowHeadExtrasScripts)},`,
  ];
  if (options.cspNonce) lines.push(`cspNonce: c.get('cspNonce'),`);
  return lines;
}
