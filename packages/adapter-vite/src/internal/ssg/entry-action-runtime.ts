import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';
import type { RouteHandlerEmitContext } from './entry-codegen.ts';

/** Emit the shared ADR-0120/ADR-0121 action protocol exactly once per entry. */
export function renderActionRuntime(): string {
  return `async function __runActionProtocol(c, routeModule, loadContext, renderHtmlError, state) {
  const url = new URL(c.req.url);
  const actionName = (() => {
    for (const key of url.searchParams.keys()) if (key.startsWith('/')) return key.slice(1);
    return undefined;
  })();
  const namedActions = typeof routeModule.actions === 'object' && routeModule.actions !== null
    ? routeModule.actions
    : {};
  const actionFn = actionName !== undefined
    ? (Object.prototype.hasOwnProperty.call(namedActions, actionName) ? namedActions[actionName] : undefined)
    : (typeof routeModule.action === 'function' ? routeModule.action : undefined);
  state.isFetch = c.req.header(__actionFetchHeader) === 'true';

  const csrfOff = loadContext.env && loadContext.env.OPEN_ELEMENT_DISABLE_CSRF === '1';
  if (!csrfOff) {
    const origin = c.req.header('origin');
    const fetchSite = (c.req.header('sec-fetch-site') || '').toLowerCase();
    let crossSite = fetchSite === 'cross-site';
    if (!crossSite && origin && origin !== 'null') {
      try {
        const source = new URL(origin);
        const target = new URL(c.req.url);
        const loopback = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
        crossSite = source.origin !== target.origin && !(
          source.protocol === 'http:' && target.protocol === 'http:' &&
          loopback(source.hostname) && loopback(target.hostname)
        );
      } catch {
        crossSite = true;
      }
    } else if (!crossSite && fetchSite === 'same-site') {
      crossSite = true;
    }
    if (crossSite) {
      const response = state.isFetch
        ? c.json({ type: 'about:blank', title: 'Forbidden', status: 403, detail: 'Cross-site form submission rejected' }, 403, { 'Content-Type': __problemJsonMediaType })
        : c.text('Forbidden', 403);
      return { response };
    }
  }

  if (typeof actionFn !== 'function') {
    const message = actionName !== undefined
      ? 'No action named "' + actionName + '" on this route.'
      : 'This route does not accept submissions.';
    const response = state.isFetch
      ? c.json({ type: 'about:blank', title: 'Not Found', status: 404, detail: message }, 404, { 'Content-Type': __problemJsonMediaType })
      : renderHtmlError('404 Not Found', message, 404);
    return { response };
  }

  let formData;
  try {
    formData = await c.req.raw.formData();
  } catch {
    const message = 'Could not parse the form body.';
    const response = state.isFetch
      ? c.json({ type: 'about:blank', title: 'Bad Request', status: 400, detail: message }, 400, { 'Content-Type': __problemJsonMediaType })
      : renderHtmlError('400 Bad Request', message, 400);
    return { response };
  }

  const actionOutcome = __classifyActionResult(await actionFn({ ...loadContext, formData }));
  const prgParams = new URLSearchParams(url.search);
  for (const key of [...prgParams.keys()]) if (key.startsWith('/')) prgParams.delete(key);
  const search = prgParams.toString();
  const prgTarget = url.pathname + (search ? '?' + search : '');

  if (state.isFetch) {
    if (actionOutcome.kind === 'failure') {
      let data = actionOutcome.data;
      try {
        if (JSON.stringify(data) === undefined) data = null;
      } catch {
        data = null;
      }
      return { response: c.json({ type: 'failure', status: actionOutcome.status, data }, actionOutcome.status) };
    }
    return { response: c.json({ type: 'redirect', status: 303, location: prgTarget }) };
  }
  if (actionOutcome.kind === 'success') {
    return { response: c.redirect(prgTarget, 303) };
  }
  return { actionResult: actionOutcome };
}`;
}

/**
 * Emit only the route-specific wiring of the action POST protocol block
 * (ADR-0120/ADR-0121); the protocol implementation above is shared. Covers the
 * status-page callback, the named-action dispatch result, and the 422
 * re-render data refresh.
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
