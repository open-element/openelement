/** WinterCG fetch middleware for Route Mode; the pure matching entry is ./router. */
import { type RouteRecord, RouteTable, type RouteTableOptions } from './router.ts';

/** Route-scoped request context handed to every {@link HttpHandler}. */
export interface HttpRouteContext {
  params: Record<string, string>;
  searchParams: URLSearchParams;
  url: URL;
}

/**
 * Dialect-free WinterCG route handler: return a Response to short-circuit, or
 * `next()` to pass control down the method's handler chain; the last handler's
 * `next` is the host middleware chain's own next.
 */
export type HttpHandler = (
  request: Request,
  context: HttpRouteContext,
  next: () => Promise<Response>,
) => Response | Promise<Response>;

export interface HttpRouteRecord extends Omit<RouteRecord, 'methods'> {
  handlers: Readonly<Record<string, HttpHandler | readonly HttpHandler[]>>;
}

function runHandlers(
  handlers: readonly HttpHandler[],
  request: Request,
  context: HttpRouteContext,
  next: () => Promise<Response>,
  index = 0,
): Promise<Response> {
  return index < handlers.length
    ? Promise.resolve(
      handlers[index](request, context, () =>
        runHandlers(handlers, request, context, next, index + 1)),
    )
    : next();
}

/** Mount after host middleware/routes; unmatched URLs continue to the host. */
export function createRouteMiddleware(
  records: readonly HttpRouteRecord[],
  options: RouteTableOptions & {
    methodNotAllowed?: (request: Request, allow: readonly string[]) => Response | Promise<Response>;
  } = {},
): (request: Request, next: () => Promise<Response>) => Promise<Response> {
  const routes = records.map(({ handlers, ...record }) => {
    const methods: string[] = [];
    const dispatch = new Map<string, HttpHandler[]>();
    for (const [name, handler] of Object.entries(handlers)) {
      const method = name.toUpperCase();
      if (dispatch.has(method)) {
        throw new TypeError(`Duplicate ${method} handler for ${record.id ?? record.path}`);
      }
      if (!/^[!#$%&'*+.^_`|~0-9A-Z-]+$/.test(method)) {
        throw new TypeError(`Invalid HTTP method: ${name}`);
      }
      methods.push(method);
      dispatch.set(method, typeof handler === 'function' ? [handler] : [...handler]);
      if (!dispatch.get(method)?.length) {
        throw new TypeError(`Empty ${method} handler for ${record.path}`);
      }
    }
    if (!methods.length) throw new TypeError(`No handlers for ${record.path}`);
    return { ...record, methods, dispatch };
  });
  const table = new RouteTable(routes, undefined, options);
  return async (request, next) => {
    const url = new URL(request.url);
    const resolution = table.resolve(url, '', request.method);
    if (resolution.kind === 'not-found') return next();
    if (resolution.kind === 'method-not-allowed') {
      if (options.methodNotAllowed) return options.methodNotAllowed(request, resolution.allow);
      return new Response('Method Not Allowed', {
        status: 405,
        headers: {
          'Content-Type': 'text/plain; charset=UTF-8',
          Allow: resolution.allow.join(', '),
        },
      });
    }
    const context: HttpRouteContext = {
      params: resolution.params,
      searchParams: resolution.searchParams,
      url,
    };
    const handlers = resolution.route.dispatch.get(resolution.method)!;
    let response = await runHandlers(handlers, request, context, next);
    if (request.method === 'HEAD') {
      response = new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return response;
  };
}
