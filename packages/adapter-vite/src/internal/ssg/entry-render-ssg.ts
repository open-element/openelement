/**
 * entry-render-ssg.ts - SSG entry code generation
 *
 * Generates the SSG-specific sections of the virtual Hono entry module,
 * including routeInfo, renderRoute, getStaticPaths, and supporting helper
 * functions.
 */

import type { EntryDescriptor } from '../protocol/ssg.ts';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';
import {
  documentResolutionSetupLine,
  documentWrapOptionsLines,
  pageRouteTagExpr,
  renderMatchingRenderersFn,
} from './entry-route-helpers.ts';

/**
 * Render the SSG-specific section of the entry code.
 *
 * This includes route metadata, renderRoute, getStaticPaths, and supporting
 * helper functions.
 *
 * Returns an empty string when SSG mode is disabled.
 */
export function renderSsgSection(desc: EntryDescriptor): string {
  if (!desc.isSSG) return '';

  const lines: string[] = [];

  lines.push('');
  lines.push(
    '// - ADR 0014: DSD-first rendering API -',
  );
  lines.push(
    '// build-ssg.ts calls these - never touches customElements directly.',
  );
  lines.push('');

  // --- routeInfo: structured route metadata ---
  lines.push('export const routeInfo = [');
  for (const r of desc.pageRoutes) {
    const tagNameExpr = pageRouteTagExpr(r.varName, r.tagName);
    lines.push(
      `  { path: ${quoteGeneratedJavaScriptValue(r.path)}, filePath: ${
        quoteGeneratedJavaScriptValue(r.filePath)
      }, tagName: ${tagNameExpr}, module: ${r.varName}, isDynamic: ${!!r
        .isDynamic}, paramNames: [${
        (r.paramNames || []).map(quoteGeneratedJavaScriptValue).join(', ')
      }], rendering: (__pageDefinition(${r.varName}).renderIntent?.mode || "static"), hasAction: (typeof ${r.varName}.action === "function" || (typeof ${r.varName}.actions === "object" && ${r.varName}.actions !== null)) },`,
    );
  }
  lines.push('];');
  lines.push('');

  lines.push('function __rendererContext(routePath, params) {');
  lines.push('  return {');
  lines.push('    req: {');
  lines.push('      path: routePath,');
  lines.push('      param: (name) => name ? params[name] : params,');
  lines.push('    },');
  lines.push('    get: () => undefined,');
  lines.push('    set: () => undefined,');
  lines.push('  };');
  lines.push('}');
  lines.push('');

  renderMatchingRenderersFn(lines, desc.renderers);
  lines.push('');

  // --- renderRoute ---
  lines.push('/**');
  lines.push(' * Render a route to structured output with diagnostics (ADR 0014, v0.15.3).');
  lines.push(
    ' * Returns { html, errors, componentCount, renderTimeMs } on success.',
  );
  lines.push(
    ' * Loader/render failures produce a defined result instead of throwing:',
  );
  lines.push(' * redirect (3xx), not-found (404) or a 500 page with the caught error');
  lines.push(' * collected into errors as a RenderError.');
  lines.push(' */');
  lines.push('export async function renderRoute(routePath, options = {}) {');
  lines.push('  const info = routeInfo.find(r => r.path === routePath);');
  lines.push(
    "  if (!info) throw new Error('[openElement] renderRoute: route not found: ' + routePath);",
  );
  lines.push(
    '  const { params = {}, locale, title, lang, headExtras } = options;',
  );
  lines.push('  const page = __pageDefinition(info.module);');
  lines.push('  const routeMeta = __routeMeta(info.module);');
  lines.push('  const loadContext = {');
  lines.push('    params,');
  lines.push('    request: options.request,');
  // ADR-0129: at build time there is no per-request response to merge into;
  // the channel exists so loader code can write to it without crashing.
  lines.push('    responseHeaders: new Headers(),');
  lines.push('    env: options.env || {},');
  lines.push('    platform: options.platform,');
  lines.push('    route: { path: routePath, filePath: info.filePath },');
  lines.push('  };');
  lines.push('  const startTime = typeof performance !== "undefined" ? performance.now() : 0;');
  lines.push(
    '  const headExtrasValue = headExtras !== undefined ? headExtras : (typeof __headExtras !== "undefined" ? __headExtras : "");',
  );
  lines.push('  try {');
  lines.push(
    '    const data = typeof info.module.loader === "function" ? await info.module.loader(loadContext) : undefined;',
  );
  // #1326: one render-scoped context object feeds both the props projector
  // and the resolved-Document seam — the head resolver never sees a second,
  // divergent view of the render.
  lines.push(
    '    const __pageContext = { data, actionData: undefined, params, request: options.request, locale, route: loadContext.route, meta: routeMeta };',
  );
  lines.push('    const props = __pageProps(info.module, __pageContext);');
  lines.push(`    ${documentResolutionSetupLine('page', '__pageContext')}`);
  lines.push('    if (locale) props.locale = locale;');
  lines.push('    let content = __ssr(info.tagName, props, { route: routePath });');
  if (desc.renderer === 'lit') {
    // #1339: emit the page-data channel on build-time renders too, so static
    // lit pages carry the same hydration data as request-time ones.
    lines.push('    content += __litPageDataScript(props);');
  }
  lines.push('    for (const renderer of __matchingRenderers(routePath)) {');
  lines.push(
    '      content = await renderer.wrap(content, __rendererContext(routePath, params));',
  );
  lines.push('    }');
  lines.push(
    '    content = __renderAppShell(content, routePath, { locale, routeMeta });',
  );
  lines.push(
    '    const renderTimeMs = typeof performance !== "undefined" ? performance.now() - startTime : 0;',
  );
  lines.push(
    '    const componentCount = (content.match(/<template shadowrootmode="open"/g) || []).length;',
  );
  lines.push('    const fullHtml = wrapInDocument(content, {');
  for (
    const optionLine of documentWrapOptionsLines({
      titleExpr: `title || __doc.title || ${quoteGeneratedJavaScriptValue(desc.document.title)}`,
      langExpr: `lang || __doc.lang || ${quoteGeneratedJavaScriptValue(desc.document.lang)}`,
      headExtrasExpr: 'headExtrasValue',
      allowHeadExtrasScripts: desc.document.allowHeadExtrasScripts,
    })
  ) {
    lines.push(`      ${optionLine}`);
  }
  lines.push('    });');
  lines.push('    return {');
  lines.push('      html: fullHtml,');
  lines.push('      errors: [],');
  lines.push('      componentCount,');
  lines.push('      renderTimeMs,');
  lines.push('    };');
  lines.push('  } catch (error) {');
  lines.push('    if (__isOpenElementRedirect(error)) {');
  lines.push(
    '      const html = wrapInDocument(__statusHtml("Redirect", "Redirecting to " + error.location), {',
  );
  lines.push('        title: "Redirect",');
  lines.push(
    `        lang: lang || locale || ${quoteGeneratedJavaScriptValue(desc.document.lang)},`,
  );
  lines.push('        headExtras: headExtrasValue,');
  lines.push(
    `        allowHeadExtrasScripts: ${JSON.stringify(desc.document.allowHeadExtrasScripts)},`,
  );
  lines.push('      });');
  lines.push(
    '      return { html, status: error.status, redirect: { location: error.location, status: error.status }, errors: [], componentCount: 0, renderTimeMs: 0 };',
  );
  lines.push('    }');
  lines.push('    if (__isOpenElementNotFound(error)) {');
  lines.push(
    '      const html = wrapInDocument(__statusHtml("404 Not Found", error.message || "Not Found"), {',
  );
  lines.push('        title: "404 Not Found",');
  lines.push(
    `        lang: lang || locale || ${quoteGeneratedJavaScriptValue(desc.document.lang)},`,
  );
  lines.push('        headExtras: headExtrasValue,');
  lines.push(
    `        allowHeadExtrasScripts: ${JSON.stringify(desc.document.allowHeadExtrasScripts)},`,
  );
  lines.push('      });');
  lines.push(
    '      return { html, status: 404, notFound: true, errors: [], componentCount: 0, renderTimeMs: 0 };',
  );
  lines.push('    }');
  lines.push('    const renderError = {');
  lines.push('      code: "OPEN_ELEMENT_RENDER_RENDER_FAILED",');
  lines.push('      severity: "error",');
  lines.push('      phase: "render",');
  lines.push('      tagName: info.tagName,');
  lines.push(
    '      message: String(error && error.message ? error.message : error),',
  );
  lines.push('      recoverable: false,');
  lines.push('    };');
  lines.push(
    '    const renderTimeMs = typeof performance !== "undefined" ? performance.now() - startTime : 0;',
  );
  // Error-boundary parity with the dev/server route handler
  // (renderRouteHandler): a page declaring an error projector renders its
  // compiled error variant through the descriptor seam; the failure still
  // surfaces as a 500 result carrying the caught RenderError.
  lines.push('    if (typeof page.error === "function") {');
  lines.push('      try {');
  lines.push(
    '        const __errorPageContext = { data: undefined, actionData: undefined, params, request: options.request, locale, route: loadContext.route, meta: routeMeta };',
  );
  lines.push(
    '        const errorContent = __renderAppShell(__ssr(info.tagName, __pageErrorProps(info.module, error, __errorPageContext), { route: routePath }), routePath, { locale, routeMeta });',
  );
  lines.push(`        ${documentResolutionSetupLine('page', '__errorPageContext')}`);
  lines.push(
    '        const errorComponentCount = (errorContent.match(/<template shadowrootmode="open"/g) || []).length;',
  );
  lines.push('        const errorHtml = wrapInDocument(errorContent, {');
  for (
    const optionLine of documentWrapOptionsLines({
      titleExpr: `title || __doc.title || ${quoteGeneratedJavaScriptValue(desc.document.title)}`,
      langExpr: `lang || __doc.lang || ${quoteGeneratedJavaScriptValue(desc.document.lang)}`,
      headExtrasExpr: 'headExtrasValue',
      allowHeadExtrasScripts: desc.document.allowHeadExtrasScripts,
    })
  ) {
    lines.push(`          ${optionLine}`);
  }
  lines.push('        });');
  lines.push(
    '        return { html: errorHtml, status: 500, errors: [renderError], componentCount: errorComponentCount, renderTimeMs };',
  );
  lines.push('      } catch (errorRenderFailure) {');
  lines.push(
    "        console.error('[openElement] Route error renderer failed for ' + routePath + ':', errorRenderFailure);",
  );
  lines.push('      }');
  lines.push('    }');
  lines.push(
    "    console.error('[openElement] renderRoute failed for ' + routePath + ':', error);",
  );
  lines.push(
    '    const detail = import.meta.env.PROD ? "Internal Server Error" : String(error && error.stack ? error.stack : error);',
  );
  lines.push(
    '    const html = wrapInDocument(__statusHtml("500 Internal Server Error", detail), {',
  );
  lines.push('      title: "500 Internal Server Error",');
  lines.push(`      lang: lang || locale || ${quoteGeneratedJavaScriptValue(desc.document.lang)},`);
  lines.push('      headExtras: headExtrasValue,');
  lines.push(
    `      allowHeadExtrasScripts: ${JSON.stringify(desc.document.allowHeadExtrasScripts)},`,
  );
  lines.push('    });');
  lines.push(
    '    return { html, status: 500, errors: [renderError], componentCount: 0, renderTimeMs };',
  );
  lines.push('  }');
  lines.push('}');
  lines.push('');

  // --- getStaticPaths ---
  lines.push('/**');
  lines.push(' * Get static paths for a dynamic route (ADR 0014).');
  lines.push(' * Returns [] for non-dynamic routes.');
  lines.push(' */');
  lines.push('export async function getStaticPaths(routePath) {');
  lines.push('  const info = routeInfo.find(r => r.path === routePath);');
  lines.push('  if (!info || !info.isDynamic) return [];');
  const dynamicRoutes = desc.pageRoutes.filter((r) => r.isDynamic);
  if (dynamicRoutes.length > 0) {
    lines.push("  // Dispatch to the route module's getStaticPaths()");
    for (const r of dynamicRoutes) {
      lines.push(`  if (routePath === ${quoteGeneratedJavaScriptValue(r.path)}) {`);
      lines.push(
        `    if (typeof ${r.varName}.getStaticPaths === 'function') {`,
      );
      lines.push(`      return await ${r.varName}.getStaticPaths();`);
      lines.push(`    }`);
      lines.push(`    return [];`);
      lines.push(`  }`);
    }
  }
  lines.push('  return [];');
  lines.push('}');

  return lines.join('\n');
}
