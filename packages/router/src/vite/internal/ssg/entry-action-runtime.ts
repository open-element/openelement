/**
 * Per-route wiring emission of the action POST protocol (#901). The
 * protocol itself — CSRF floor, named-action dispatch, classification,
 * problem+json errors, PRG, the fetch/native channel fork — is the typed
 * `runActionProtocol` in @openelement/router/server-runtime; the generated
 * entry imports it and this file only wires each route's call site: the
 * status-page callback, the named-action dispatch result, and the 422
 * re-render data refresh.
 */

import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';
import type { RouteHandlerEmitContext } from './entry-codegen.ts';

/**
 * Emit only the route-specific wiring of the action POST protocol block.
 */
export function renderActionProtocol(lines: string[], ctx: RouteHandlerEmitContext): void {
  const { route, docConfig, headExtrasExpr } = ctx;
  lines.push(`    const __actionExecution = await __runActionProtocol(`);
  lines.push(`      c, ${route.varName}, __loadContext,`);
  lines.push(
    `      (title, message, status) => c.html(wrapInDocument(__statusHtml(title, message), {`,
  );
  lines.push(`        title, lang: ${quoteGeneratedJavaScriptValue(docConfig.lang)},`);
  lines.push(`        headExtras: ${headExtrasExpr},`);
  lines.push(
    `        allowHeadExtrasScripts: ${JSON.stringify(docConfig.allowHeadExtrasScripts)},`,
  );
  lines.push(`        cspNonce: c.get('cspNonce')`);
  lines.push(`      }), status), __actionState`);
  lines.push(`    );`);
  lines.push(`    if (__actionExecution.response) return __actionExecution.response;`);
  lines.push(`    const __actionResult = __actionExecution.actionResult;`);
  lines.push(
    `    const __data = typeof ${route.varName}.loader === "function" ? await ${route.varName}.loader(__loadContext) : undefined;`,
  );
  lines.push(`    const __actionData = __actionResult.data;`);
  lines.push(`    const __actionStatus = __actionResult.status;`);
}
