/**
 * Shared helper for the fixture fetch middleware chain (ADR-0123 item 2,
 * #858, Alpha.1 module contract). Imported BY the middleware modules — proof
 * that a middleware may import a local helper (its module graph travels with
 * it), which was impossible when middleware sources were inlined via
 * Function.toString().
 */
import type { Middleware } from '@openelement/element';

export const MIDDLEWARE_HEADER = 'x-fixture-middleware';

export function appendLayer(headers: Headers, layer: string): void {
  headers.append(MIDDLEWARE_HEADER, layer);
}

/**
 * Factory proof: `middleware.use` modules may default-export the RESULT of
 * calling a factory. The returned middleware closes over `layer`, exercising
 * module-level closure capture through the generated entry's plain import.
 */
export function createLayerMiddleware(layer: string): Middleware {
  return async (_request, next) => {
    const response = await next();
    appendLayer(response.headers, layer);
    return response;
  };
}
