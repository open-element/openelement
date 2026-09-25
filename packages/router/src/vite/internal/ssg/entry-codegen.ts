/**
 * entry-codegen.ts - Entry code string generation
 *
 * The codegen axis of the entry-* family (#901): shared code-generation
 * helpers used by entry-orchestrator.ts and entry-render-ssg.ts. Each
 * function generates a fragment of the virtual Hono entry. Client entry
 * emission lives in entry-client-codegen.ts. Runtime helper
 * emission lives in entry-render-runtime.ts; the descriptor data model
 * lives in protocol/ssg.ts and is constructed by entry-descriptor.ts.
 */

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
import { renderActionProtocol } from './entry-action-runtime.ts';

/**
 * #863: the action error channel speaks RFC 9457
 * Problem Details — application/problem+json with type/title/status/detail —
 * in place of the bespoke { type: 'error', error: { message } } JSON.
 * 'about:blank' carries the HTTP reason phrase as the title (RFC 9457 §4.2).
 * `detailExpr` is emitted verbatim (a quoted literal or a runtime expression).
 */
function problemJsonLine(status: number, title: string, detailExpr: string): string {
  return `c.json({ type: 'about:blank', title: ${
    quoteGeneratedJavaScriptValue(title)
  }, status: ${status}, detail: ${detailExpr} }, ${status}, { 'Content-Type': __problemJsonMediaType })`;
}

interface RouteHandlerDocConfig {
  title: string;
  lang: string;
  headExtras: string;
  allowHeadExtrasScripts: boolean;
}

interface RenderRouteHandlerOptions {
  method: 'get' | 'post';
  route: PageRouteDecl;
  renderers: RendererDecl[];
  docConfig: RouteHandlerDocConfig;
  isSSG: boolean;
  /** Page renderer fork (#1339); absent/'native' keeps compiled renderDsd emission. */
  renderer?: 'native' | 'lit';
}

/** Shared codegen state threaded through the route-handler emit helpers (#847). */
export interface RouteHandlerEmitContext {
  isAction: boolean;
  route: PageRouteDecl;
  matchingRenderers: RendererDecl[];
  docConfig: RouteHandlerDocConfig;
  pathLiteral: string;
  tagNameExpr: string;
  pageDefExpr: string;
  routeMeta: string;
  routeContext: string;
  headExtrasExpr: string;
  renderer: 'native' | 'lit';
}

/**
 * Emit the handler opener: route registration, per-request declarations,
 * cache headers, load context, and (GET only) the loader call.
 */
function renderRouteHandlerPreamble(lines: string[], ctx: RouteHandlerEmitContext): void {
  const { isAction, route, pathLiteral, tagNameExpr, pageDefExpr, routeMeta, routeContext } = ctx;

  lines.push(`// ${isAction ? 'Action POST' : 'Page'}: ${route.path} (${route.filePath})`);
  if (!isAction) {
    lines.push('// GET handler - renders the page with loader data');
  }
  if (isAction) {
    // Conservative default body limit on action POSTs;
    // larger uploads belong on API routes with explicit limits.
    lines.push(
      `__pageHandlers[${pathLiteral}].POST = [__asFetchMiddleware(__bodyLimit({ maxSize: 10 * 1024 * 1024, onError: (c) => { c.header('Cache-Control', 'no-store'); c.header('Vary', __actionFetchHeader); if (c.req.header(__actionFetchHeader) === 'true') return ${
        problemJsonLine(
          413,
          'Payload Too Large',
          `'The request body exceeded the 10 MiB action limit.'`,
        )
      }; return c.text('Payload Too Large', 413); } })), __asFetchHandler(async (c, __route) => {`,
    );
  } else {
    lines.push(`__pageHandlers[${pathLiteral}].GET = [__asFetchHandler(async (c, __route) => {`);
  }
  // One mutable response-header channel per request, shared by the
  // loader and the action (the spread into the action context carries the
  // reference). The handler body is wrapped in an IIFE so EVERY exit —
  // success, re-render, redirect, rejection, error fallback — merges the
  // channel via __mergeChannelHeaders.
  if (!isAction && route.streamManifest) {
    lines.push(`  const __headerChannel = __streamHeaderChannel(${pathLiteral});`);
    lines.push(`  const __responseHeaders = __headerChannel.channel;`);
  } else {
    lines.push(`  const __responseHeaders = new Headers();`);
  }
  lines.push(`  return __mergeChannelHeaders(await (async () => {`);
  lines.push(`  let __tag = ${tagNameExpr}`);
  lines.push(`  let __page = ${pageDefExpr}`);
  lines.push(`  let __params = {}`);
  lines.push(`  let __routeMetaValue = ${routeMeta}`);
  lines.push(`  const __routeContext = ${routeContext}`);
  if (!isAction && route.streamManifest) lines.push(`  let __streamScope;`);
  // Request-time responses are never cacheable;
  // the POST endpoint is negotiated by the framework action header.
  lines.push(`  c.header('Cache-Control', 'no-store');`);
  if (isAction) {
    lines.push(`  c.header('Vary', __actionFetchHeader);`);
  }
  if (isAction) {
    // Declared outside try so the catch can branch on the fetch path without
    // hitting a TDZ error when the action block never ran.
    lines.push(`  const __actionState = { isFetch: false };`);
  }
  lines.push(`  try {`);
  // The WinterCG route middleware resolved the winner; the bridged Hono
  // context still owns request/response mechanics inside the handler body.
  lines.push(`    __params = __route.params`);
  if (!isAction && route.streamManifest) {
    lines.push(`    __streamScope = __streamRequestScope(c.req.raw);`);
  }
  lines.push(`    const __loadContext = {`);
  lines.push(`      params: __params,`);
  lines.push(
    `      request: ${!isAction && route.streamManifest ? '__streamScope.request' : 'c.req.raw'},`,
  );
  lines.push(`      responseHeaders: __responseHeaders,`);
  lines.push(`      env: c.env || {},`);
  lines.push(
    `      platform: (() => { try { return c.executionCtx } catch { return undefined } })(),`,
  );
  lines.push(`      route: __routeContext,`);
  lines.push(`    }`);
  if (!isAction) {
    lines.push(
      `    const __data = typeof ${route.varName}.loader === "function" ? await ${route.varName}.loader(__loadContext) : undefined`,
    );
  }
}

/** Emissions shared by the success path and the error-boundary channel. */
function renderRouteContentLines(
  lines: string[],
  ctx: RouteHandlerEmitContext,
  propsExpr: string,
  indent: string,
): void {
  const { matchingRenderers, pathLiteral } = ctx;
  // The page renders as its own compiled host element via __ssr; the page
  // descriptor's props projector maps request-scoped data onto the compiled
  // properties. Renderer modules (_renderer.ts) wrap the rendered HTML string.
  // (Beta.2.2 review: the lit page-data side channel — embedded JSON no
  // client consumed — was removed; page-state restoration needs a real
  // consumer contract first.)
  lines.push(`${indent}let __content = __ssr(__tag, ${propsExpr}, { route: ${pathLiteral} })`);
  if (matchingRenderers.length > 0) {
    lines.push(`${indent}// Renderer tree wrapping (outer -> inner)`);
    for (const renderer of matchingRenderers) {
      lines.push(`${indent}__content = await ${renderer.varName}.default.wrap(__content, c)`);
    }
  }
  lines.push(
    `${indent}const content = __renderAppShell(__content, c.req.path || ${pathLiteral}, { routeMeta: __routeMetaValue })`,
  );
}

/**
 * Emit the success path (compiled __ssr render, renderer tree, document wrap)
 * and the catch block (redirect, not-found, nearest error boundary, 500).
 */
function renderRouteResponseAndCatch(lines: string[], ctx: RouteHandlerEmitContext): void {
  const { isAction, matchingRenderers, docConfig, pathLiteral, headExtrasExpr } = ctx;

  if (!isAction && ctx.route.streamManifest) {
    const manifest = `__streamManifests[${pathLiteral}]`;
    lines.push(`    const __records = __streamFields(__data, ${manifest});`);
    lines.push(`    const __frontData = { ...__data };`);
    lines.push(`    for (const __record of __records) delete __frontData[__record.entry.field];`);
    lines.push(`    await Promise.resolve();`);
    lines.push(`    for (const __record of __records) if (__record.failed) throw __record.error;`);
    requestTimePageContextLines(lines, {
      dataExpr: '__frontData',
      actionDataExpr: 'undefined',
      indent: '    ',
    });
    lines.push(`    const __token = crypto.randomUUID();`);
    lines.push(`    const __instance = crypto.randomUUID();`);
    lines.push(
      `    const __executor = await __createDeferredPageShell(${pathLiteral}, ${ctx.route.varName}, __pageProps(${ctx.route.varName}, __pageContext), __instance, __token);`,
    );
    lines.push(
      `    if (__resolveAppShell(__routeMetaValue)) throw new Error('stream route requires no compiled app shell');`,
    );
    lines.push(`    const __document = documentStreamParts({`);
    lines.push(`      streamBootstrap: __streamBrowserBootstrap(),`);
    for (
      const optionLine of documentWrapOptionsLines({
        titleExpr: `__doc.title || ${quoteGeneratedJavaScriptValue(docConfig.title)}`,
        langExpr: `__doc.lang || ${quoteGeneratedJavaScriptValue(docConfig.lang)}`,
        headExtrasExpr,
        allowHeadExtrasScripts: docConfig.allowHeadExtrasScripts,
        cspNonce: true,
        clientScripts: true,
      })
    ) lines.push(`      ${optionLine}`);
    lines.push(`    });`);
    lines.push(`    for (const __record of __records) if (__record.failed) throw __record.error;`);
    lines.push(`    c.header('Cache-Control', 'private, no-cache');`);
    lines.push(
      `    const __body = __streamBody({ scope: __streamScope, route: ${pathLiteral}, manifest: ${manifest}, executor: __executor, records: __records, document: __document, token: __token });`,
    );
    lines.push(`    __headerChannel.commit();`);
    lines.push(`    return c.body(__body, 200, { 'Content-Type': 'text/html; charset=UTF-8' });`);
  } else {
    // #1326: one request-scoped context object feeds both the props projector
    // and the resolved-Document seam.
    requestTimePageContextLines(lines, {
      dataExpr: '__data',
      actionDataExpr: isAction ? '__actionData' : 'undefined',
      indent: '    ',
    });

    renderRouteContentLines(
      lines,
      ctx,
      `__pageProps(${ctx.route.varName}, __pageContext)`,
      '    ',
    );
    lines.push('');
    if (!isAction) {
      // #943: successful GET pages relax no-store to private,no-cache so the UA
      // can bfcache/scroll-restore them. The
      // override is emitted only AFTER the shell render succeeded: a
      // redirect/notFound()/throw out of render lands in the catch below, and
      // every error/redirect response (and every POST response) keeps the
      // no-store baseline.
      lines.push(`    c.header('Cache-Control', 'private, no-cache');`);
    }
    // #951: the island client script rides wrapInDocument's script descriptors
    // (the dev URL, or the request-time src handed in by dist/server/index.js),
    // so a CSP nonce reaches it; static pages keep the post-build injector.
    lines.push(`    return c.html(wrapInDocument(content, {`);
    for (
      const optionLine of documentWrapOptionsLines({
        titleExpr: `__doc.title || ${quoteGeneratedJavaScriptValue(docConfig.title)}`,
        langExpr: `__doc.lang || ${quoteGeneratedJavaScriptValue(docConfig.lang)}`,
        headExtrasExpr,
        allowHeadExtrasScripts: docConfig.allowHeadExtrasScripts,
        cspNonce: true,
        clientScripts: true,
      })
    ) {
      lines.push(`      ${optionLine}`);
    }
    lines.push(`    })${isAction ? ', __actionStatus' : ''})`);
  }

  lines.push(`  } catch (err) {`);
  if (!isAction && ctx.route.streamManifest) lines.push(`    __streamScope?.cancel();`);
  lines.push(`    if (__isOpenElementRedirect(err)) {`);
  if (isAction) {
    // In the POST action context every 3xx is
    // coerced to 303 (PRG must be method-safe and non-cacheable); GET
    // handlers keep the author's status.
    lines.push(
      `      const __redirectStatus = 303;`,
    );
    lines.push(
      `      if (__actionState.isFetch) return c.json({ type: 'redirect', status: __redirectStatus, location: err.location });`,
    );
    lines.push(`      return c.redirect(err.location, __redirectStatus)`);
  } else {
    lines.push(`      return c.redirect(err.location, err.status)`);
  }
  lines.push(`    }`);
  lines.push(`    if (__isOpenElementNotFound(err)) {`);
  lines.push(
    `      return c.html(wrapInDocument(__statusHtml("404 Not Found", err.message || "Not Found"), {`,
  );
  lines.push(`        title: "404 Not Found",`);
  lines.push(`        lang: ${quoteGeneratedJavaScriptValue(docConfig.lang)},`);
  lines.push(`        headExtras: ${headExtrasExpr},`);
  lines.push(
    `        allowHeadExtrasScripts: ${JSON.stringify(docConfig.allowHeadExtrasScripts)},`,
  );
  lines.push(`        cspNonce: c.get('cspNonce'),`);
  lines.push(`        scripts: __clientScriptDescriptors(),`);
  lines.push(`      }), 404)`);
  lines.push(`    }`);

  // The JSON error channel scrubs internals in production,
  // matching the HTML channel. Fetch callers get RFC 9457 problem+json
  // (#863), never the boundary page.
  if (isAction) {
    lines.push(`    if (__actionState.isFetch) {`);
    lines.push(
      `      console.error('[openElement] Action POST failed for ' + ${pathLiteral} + ':', err)`,
    );
    lines.push(
      `      return ${
        problemJsonLine(
          500,
          'Internal Server Error',
          `import.meta.env.PROD ? 'Internal Server Error' : String(err && err.message ? err.message : err)`,
        )
      };`,
    );
    lines.push(`    }`);
  }
  // POST takes the same nearest-error-boundary
  // channel as GET — the page's error variant renders with status 500.
  {
    lines.push(`    if (typeof __page.error === "function") {`);
    lines.push(`      try {`);
    requestTimePageContextLines(lines, {
      dataExpr: 'undefined',
      actionDataExpr: 'undefined',
      indent: '        ',
    });
    lines.push(
      `        let __errorHtml = __ssr(__tag, __pageErrorProps(${ctx.route.varName}, err, __pageContext), { route: ${pathLiteral} })`,
    );
    if (matchingRenderers.length > 0) {
      for (const renderer of matchingRenderers) {
        lines.push(`        __errorHtml = await ${renderer.varName}.default.wrap(__errorHtml, c)`);
      }
    }
    lines.push(
      `        const errorContent = __renderAppShell(__errorHtml, c.req.path || ${pathLiteral}, { routeMeta: __routeMetaValue })`,
    );
    lines.push(`        return c.html(wrapInDocument(errorContent, {`);
    for (
      const optionLine of documentWrapOptionsLines({
        titleExpr: `__doc.title || ${quoteGeneratedJavaScriptValue(docConfig.title)}`,
        langExpr: `__doc.lang || ${quoteGeneratedJavaScriptValue(docConfig.lang)}`,
        headExtrasExpr,
        allowHeadExtrasScripts: docConfig.allowHeadExtrasScripts,
        cspNonce: true,
        clientScripts: true,
      })
    ) {
      lines.push(`          ${optionLine}`);
    }
    lines.push(`        }), 500)`);
    lines.push(`      } catch (errorRenderFailure) {`);
    lines.push(
      `        console.error('[openElement] Route error renderer failed for ' + ${pathLiteral} + ':', errorRenderFailure)`,
    );
    lines.push(`      }`);
    lines.push(`    }`);
  }

  const failureLabel = isAction ? 'Action POST failed' : 'Route render failed';
  lines.push(
    `    console.error('[openElement] ${failureLabel} for ' + ${pathLiteral} + ':', err)`,
  );
  lines.push(`    if (import.meta.env.PROD) {`);
  lines.push(`      return c.html('<h1>500 Internal Server Error</h1>', 500)`);
  lines.push(`    } else {`);
  lines.push(`      const safeErr = escapeHtml(String(err.stack || err))`);
  lines.push(`      return c.html('<h1>500</h1><pre>' + safeErr + '</pre>', 500)`);
  lines.push(`    }`);
  lines.push(`  }`);
  // close the handler-body IIFE and merge the response-header
  // channel into whatever response the body produced.
  lines.push(`  })(), __responseHeaders);`);
  lines.push(`})];`);
  lines.push('');
}

/** Generate a Hono route handler for a page route (GET) or its action (POST). */
export function renderRouteHandler(
  lines: string[],
  { method, route, renderers, docConfig, isSSG, renderer }: RenderRouteHandlerOptions,
): void {
  const ctx: RouteHandlerEmitContext = {
    isAction: method === 'post',
    route,
    matchingRenderers: renderers.filter((r) => rendererScopeMatches(route.path, r.scope)),
    docConfig,
    pathLiteral: quoteGeneratedJavaScriptValue(route.path),
    tagNameExpr: pageRouteTagExpr(route.varName, route.tagName),
    pageDefExpr: pageDefinitionExpr(route.varName),
    routeMeta: routeMetaExpr(route.varName),
    routeContext: `{ path: ${quoteGeneratedJavaScriptValue(route.path)}, filePath: ${
      quoteGeneratedJavaScriptValue(route.filePath)
    } }`,
    headExtrasExpr: isSSG ? '__headExtras' : quoteGeneratedJavaScriptValue(docConfig.headExtras),
    renderer: renderer ?? 'native',
  };

  renderRouteHandlerPreamble(lines, ctx);
  if (ctx.isAction) {
    renderActionProtocol(lines, ctx);
  }
  renderRouteResponseAndCatch(lines, ctx);
}

/** Compatibility-facing focused entry points used by the entry orchestrator. */
export function renderPageRoute(
  lines: string[],
  route: PageRouteDecl,
  renderers: RendererDecl[],
  docConfig: RouteHandlerDocConfig,
  isSSG: boolean,
  renderer?: 'native' | 'lit',
): void {
  renderRouteHandler(lines, { method: 'get', route, renderers, docConfig, isSSG, renderer });
}

export function renderActionRoute(
  lines: string[],
  route: PageRouteDecl,
  renderers: RendererDecl[],
  docConfig: RouteHandlerDocConfig,
  isSSG: boolean,
  renderer?: 'native' | 'lit',
): void {
  renderRouteHandler(lines, { method: 'post', route, renderers, docConfig, isSSG, renderer });
}

/**
 * Generate the Hono notFound fallback (#923): unmatched paths render the
 * /404 page with a 404 status. Any failure inside the fallback degrades to
 * the plain status page — the fallback itself never 500s.
 */
