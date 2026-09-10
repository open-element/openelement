/** Styled 404 route emission. */
import type { PageRouteDecl, RendererDecl } from '../protocol/ssg.ts';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';
import {
  documentWrapOptionsLines,
  pageDefinitionExpr,
  pageRouteTagExpr,
  rendererScopeMatches,
  requestTimePageContextLines,
  routeMetaExpr,
} from './entry-route-helpers.ts';

interface RouteHandlerDocConfig {
  title: string;
  lang: string;
  headExtras: string;
  allowHeadExtrasScripts: boolean;
}

export function renderNotFoundRoute(
  lines: string[],
  route: PageRouteDecl,
  renderers: RendererDecl[],
  docConfig: RouteHandlerDocConfig,
  isSSG: boolean,
): void {
  const headExtrasExpr = isSSG
    ? '__headExtras'
    : quoteGeneratedJavaScriptValue(docConfig.headExtras);
  lines.push('// Styled 404 (#923): unmatched paths render the /404 page with a 404 status');
  lines.push('app.notFound(async (c) => {');
  lines.push(`  const __responseHeaders = new Headers();`);
  lines.push(`  return __mergeChannelHeaders(await (async () => {`);
  lines.push(`  let __tag = ${pageRouteTagExpr(route.varName, route.tagName)};`);
  lines.push(`  let __page = ${pageDefinitionExpr(route.varName)};`);
  lines.push(`  let __params = {};`);
  lines.push(`  let __routeMetaValue = ${routeMetaExpr(route.varName)};`);
  lines.push(
    `  const __routeContext = { path: ${quoteGeneratedJavaScriptValue(route.path)}, filePath: ${
      quoteGeneratedJavaScriptValue(route.filePath)
    } };`,
  );
  lines.push(`  c.header('Cache-Control', 'no-store');`);
  lines.push(`  try {`);
  lines.push(`    const __loadContext = {`);
  lines.push(`      params: __params,`);
  lines.push(`      request: c.req.raw,`);
  lines.push(`      responseHeaders: __responseHeaders,`);
  lines.push(`      env: c.env || {},`);
  lines.push(
    `      platform: (() => { try { return c.executionCtx } catch { return undefined } })(),`,
  );
  lines.push(`      route: __routeContext,`);
  lines.push(`    }`);
  lines.push(
    `    const __data = typeof ${route.varName}.loader === "function" ? await ${route.varName}.loader(__loadContext) : undefined`,
  );
  // #1326: the styled-404 page's head resolves through the same Document seam
  // as any other page (its loader data included).
  requestTimePageContextLines(lines, {
    dataExpr: '__data',
    actionDataExpr: 'undefined',
    indent: '    ',
  });
  lines.push(
    `    let __content = __ssr(__tag, __pageProps(${route.varName}, __pageContext), { route: ${
      quoteGeneratedJavaScriptValue(route.path)
    } })`,
  );
  lines.push('');
  for (const renderer of renderers.filter((r) => rendererScopeMatches(route.path, r.scope))) {
    lines.push(`    __content = await ${renderer.varName}.default.wrap(__content, c)`);
  }
  lines.push(
    `    const content = __renderAppShell(__content, ${
      quoteGeneratedJavaScriptValue(route.path)
    }, { routeMeta: __routeMetaValue })`,
  );
  lines.push(`    return c.html(__withDevClientScript(wrapInDocument(content, {`);
  for (
    const optionLine of documentWrapOptionsLines({
      titleExpr: `__doc.title || ${quoteGeneratedJavaScriptValue(docConfig.title)}`,
      langExpr: `__doc.lang || ${quoteGeneratedJavaScriptValue(docConfig.lang)}`,
      headExtrasExpr,
      allowHeadExtrasScripts: docConfig.allowHeadExtrasScripts,
      cspNonce: true,
    })
  ) {
    lines.push(`      ${optionLine}`);
  }
  lines.push(`    })), 404)`);
  lines.push(`  } catch (err) {`);
  lines.push(`    if (__isOpenElementRedirect(err)) return c.redirect(err.location, err.status);`);
  lines.push(`    console.error('[openElement] 404 page render failed:', err);`);
  lines.push(
    `    return c.html(__withDevClientScript(wrapInDocument(__statusHtml("404 Not Found", "Not Found"), { title: "404 Not Found", lang: ${
      quoteGeneratedJavaScriptValue(docConfig.lang)
    }, headExtras: ${headExtrasExpr}, allowHeadExtrasScripts: ${
      JSON.stringify(docConfig.allowHeadExtrasScripts)
    }, cspNonce: c.get('cspNonce') })), 404);`,
  );
  lines.push(`  }`);
  // ADR-0129: close the IIFE and merge the 404-page loader's channel too.
  lines.push(`})(), __responseHeaders);`);
  lines.push(`});`);
  lines.push('');
}
