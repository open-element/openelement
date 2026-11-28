/** Shared route-entry expressions and document option emission. */
import type { ImportDecl, RendererDecl } from '@openelement/protocol/ssg';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';

export function renderImport(imp: ImportDecl): string {
  const names = imp.alias ? `${imp.names[0]} as ${imp.alias}` : imp.names.join(', ');
  return `import { ${names} } from '${imp.from}'`;
}

/**
 * Page-route tag expression (#1276, B1.3-F1; C08 closed 2026-11-24): the
 * route→tag binding is a BUILD fact for every page kind this lane emits. A
 * generated element page's tag is the island scan's tag (also the tag the
 * compiler emitted the class and host producer under); a server function
 * page has no element at all, so the path-derived tag IS the binding. The
 * retired class lane's runtime `__resolvePageTag` program read went with the
 * class compiler — the entry evaluates a literal, never a module static.
 */
export function pageRouteTagExpr(_varName: string, fallbackTagName: string): string {
  return quoteGeneratedJavaScriptValue(fallbackTagName);
}

/* ------------------------------------------------------------------------- *
 * Build-only route → document stylesheet facts (task12; structure twin of the
 * router's route-style-links helper). Entry files never import that helper:
 * the value is handed in through the build-only descriptor side channel and
 * emitted as ONE literal data channel below.
 * ------------------------------------------------------------------------- */

/** key = `PageRouteDecl.path`; value = base-joined document stylesheet URLs. */
export type RouteDocumentStyleLinks = Readonly<Record<string, readonly string[]>>;

/** The build-only descriptor side channel carrying the route → urls facts. */
export interface RouteDocumentStyleLinksCarrier {
  readonly routeDocumentStyleLinks?: RouteDocumentStyleLinks;
}

/** Read + normalize the build-only side channel; absent/undefined = no links. */
export function readRouteDocumentStyleLinks(value: unknown): RouteDocumentStyleLinks {
  const carried = (value as RouteDocumentStyleLinksCarrier | undefined)?.routeDocumentStyleLinks;
  if (carried === undefined || carried === null || typeof carried !== 'object') return {};
  const normalized: Record<string, readonly string[]> = {};
  for (const route of Object.keys(carried).sort()) {
    const urls = carried[route];
    if (!Array.isArray(urls)) continue;
    normalized[route] = Object.freeze(urls.filter((url): url is string => typeof url === 'string'));
  }
  return Object.keys(normalized).length === 0 ? {} : Object.freeze(normalized);
}

/** The emitted literal data channel; empty links emit NO line (byte identity). */
export function routeDocumentStyleLinksLiteralLines(links: RouteDocumentStyleLinks): string[] {
  const routes = Object.keys(links).sort();
  if (routes.length === 0) return [];
  const fields = routes
    .map(
      (route) =>
        `${quoteGeneratedJavaScriptValue(route)}: [${links[route]!.map((url) =>
          quoteGeneratedJavaScriptValue(url),
        ).join(', ')}]`,
    )
    .join(', ');
  return [
    '// build-only route→document stylesheet URLs (task12; omitted when empty)',
    `const __routeDocumentStyleLinks = { ${fields} };`,
    '',
  ];
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
        `  if (routePath === ${quoteGeneratedJavaScriptValue(
          renderer.scope,
        )} || routePath.startsWith(${quoteGeneratedJavaScriptValue(
          renderer.scope + '/',
        )})) renderers.push(${renderer.varName}.default);`,
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
 * serializes the page. The script decision waits until the body and layout
 * have rendered, while the head resolver keeps its request-time order.
 *
 * `__documentStyles` is emitted beside it (alpha15 S lane, S-C1.2) because the
 * two are the same lifespan: both are per-render products of the resolved
 * document, and every call site that wraps a document with
 * `documentWrapOptionsLines` already has `__doc` in scope. The page render
 * reports its light-root components' external sheets into the collection; the
 * wrap declares them in the head.
 */
export function documentResolutionSetupLines(
  pageExpr: string,
  contextExpr: string,
  indent: string,
  routePathExpr?: string,
): string[] {
  const lines = [
    `${indent}const __doc = __resolvePageDocument(${pageExpr}.head, ${contextExpr});`,
    `${indent}const __documentStyles = createDocumentStyleResources();`,
  ];
  if (routePathExpr !== undefined) {
    // task12: the build's route → document stylesheet facts seed the SAME
    // per-render collection the class lane's light-root components report
    // into; `wrapInDocument` is the one writer of the head links (no HTML
    // postprocess, no second channel). The literal only exists when the build
    // produced at least one route fact.
    lines.push(
      `${indent}const __routeStyles = __routeDocumentStyleLinks[${routePathExpr}];`,
      `${indent}if (__routeStyles !== undefined) __documentStyles.add(__routeStyles);`,
    );
  }
  return lines;
}

/**
 * Emit the request-time (server handler) page context + resolved-Document
 * setup: ONE context object per render feeds both the props projector and the
 * head resolver, so the Document never sees a divergent view of the render.
 * Shared by the page/action handlers and the styled-404 handler.
 *
 * The locale is derived ONLY for a project that declared i18n: `__locales`
 * is `openElement({ i18n })`'s declaration, and on a single-locale site
 * there is no resolved locale to derive. The old unconditional form fell
 * back to `getDefaultLocale()` ('en' even with no i18n) and fed that into
 * the resolved Document's `lang`, which then beat the configured
 * `head.lang` in every generated wrap expression
 * (`lang: __doc.lang || <configured>`), making `head.lang` a dead fallback
 * on request-time pages. Leaving the context locale undefined keeps
 * `ResolvedDocument.lang` undefined unless a locale is actually derived, so
 * the configured document language wins on single-locale sites and an i18n
 * locale still overrides it (the document-language decision record).
 */
export function requestTimePageContextLines(
  lines: string[],
  options: {
    dataExpr: string;
    actionDataExpr: string;
    indent: string;
    /** Route-path expression selecting this render's build-only document style facts. */
    routePathExpr?: string;
  },
): void {
  lines.push(
    `${options.indent}const __pageContext = { data: ${options.dataExpr}, actionData: ${options.actionDataExpr}, params: __params, request: c.req.raw, locale: __locales.length > 0 ? __localeFromPath(__locales, c.req.path, __getDefaultLocale()) : undefined, route: __routeContext, meta: __routeMetaValue };`,
  );
  lines.push(
    ...documentResolutionSetupLines(
      '__page',
      '__pageContext',
      options.indent,
      options.routePathExpr,
    ),
  );
}

/** wrapInDocument() options object shared by page handlers and the SSG renderRoute. */
export function documentWrapOptionsLines(options: {
  /** The rendered body after renderer and layout wrapping. */
  contentExpr: string;
  /** Expression yielding the title, reading the resolved document, e.g. `title || __doc.title || "Default"`. */
  titleExpr: string;
  /**
   * Expression yielding the document language, reading the resolved document.
   * Every call site spells the same three-tier precedence: an explicit render
   * option (`lang`, used by the SSG dynamic/i18n expansion) → the resolved
   * locale (`__doc.lang`) → the configured document `head.lang` fallback.
   * `__doc.lang` is only present when a locale was actually derived (a
   * declared i18n project), so the configured fallback is real on
   * single-locale sites (the document-language decision record).
   */
  langExpr: string;
  headExtrasExpr: string;
  allowHeadExtrasScripts: boolean;
  /** Emit the per-request CSP nonce line (request-time handlers only). */
  cspNonce?: boolean;
}): string[] {
  const lines = [
    `title: ${options.titleExpr},`,
    `lang: ${options.langExpr},`,
    `meta: { description: __doc.description, tags: __doc.meta },`,
    `links: __doc.links,`,
    `structuredData: __doc.structuredData || [],`,
    `headExtras: ${options.headExtrasExpr},`,
    `dangerouslyHeadFragments: __doc.dangerouslyHeadFragments || [],`,
    `allowHeadExtrasScripts: ${JSON.stringify(options.allowHeadExtrasScripts)},`,
    `...__clientDocumentResources(${options.contentExpr}${options.allowHeadExtrasScripts ? `, ${options.headExtrasExpr}` : ''}),`,
    // alpha15 S lane (S-C1.2): the light-root component stylesheets this
    // render discovered, declared in the document head beside the site's own
    // document stylesheet.
    `styleLinks: __documentStyles.links,`,
  ];
  if (options.cspNonce) lines.push(`cspNonce: c.get('cspNonce'),`);
  return lines;
}
