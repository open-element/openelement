/**
 * @openelement/router/server-runtime — route dispatch.
 *
 * The generated entry's dispatch-table assembly: the per-path page handler
 * table, and the 405 responder the WinterCG route middleware invokes for
 * non-GET/POST page requests. The dispatch seam lives in this real module
 * rather than inside a codegen template string, so it is directly
 * unit-testable (#1470 block e). The startup stream-route assertion retired
 * with the class lane's compiled stream channel (C09, 2026-11-24): no
 * emitted page kind carries a stream manifest, and the Part-Program read
 * the guard depended on is gone with the class compiler.
 */

import { ACTION_FETCH_HEADER } from './action-runtime.ts';
import { boundRequestScope } from './wintercg.ts';

/**
 * Creates the per-path page handler table the generated GET/POST wiring
 * populates: one mutable method record per page path, keyed by the route
 * path literal the wiring emits.
 */
export function createPageHandlerTable(
  paths: readonly string[],
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(paths.map((path) => [path, {}]));
}

/**
 * The 405 responder handed to `createRouteMiddleware` as `methodNotAllowed`:
 * no-store (request-time responses are never cacheable), the action
 * negotiation `Vary`, and the `Allow` header listing the route's methods
 * (#572). Reads the per-request scope bound by the WinterCG composition
 * layer so the WinterCG-side middleware can answer through the scope's text
 * channel with the channel headers merged in.
 */
export function createMethodNotAllowedResponder(): (request: Request, allow: string[]) => Response {
  return (request, allow) => {
    const c = boundRequestScope(request)!;
    c.header('Cache-Control', 'no-store');
    c.header('Vary', ACTION_FETCH_HEADER);
    return c.text('Method Not Allowed', 405, { Allow: allow.join(', ') });
  };
}
