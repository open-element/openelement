/** Hono integration for Route Mode; the pure matching entry is ./router. */
import type { Context, Handler, MiddlewareHandler } from 'hono';
import { every } from 'hono/combine';
import { type RouteRecord, RouteTable, type RouteTableOptions } from './router.ts';

export interface HttpRouteRecord extends Omit<RouteRecord, 'methods'> {
  handlers: Readonly<Record<string, Handler | readonly Handler[]>>;
}

/** Mount after host middleware/routes; unmatched URLs continue to the host. */
export function createRouteMiddleware(
  records: readonly HttpRouteRecord[],
  options: RouteTableOptions & {
    methodNotAllowed?: (context: Context, allow: readonly string[]) => Response | Promise<Response>;
  } = {},
): MiddlewareHandler {
  const routes = records.map(({ handlers, ...record }) => {
    const methods: string[] = [];
    const dispatch = new Map<string, Handler[]>();
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
  return async (c, next) => {
    const resolution = table.resolve(new URL(c.req.url), '', c.req.method);
    if (resolution.kind === 'not-found') return next();
    if (resolution.kind === 'method-not-allowed') {
      if (options.methodNotAllowed) return options.methodNotAllowed(c, resolution.allow);
      return c.text('Method Not Allowed', 405, { Allow: resolution.allow.join(', ') });
    }
    c.set('routeResolution', resolution);
    const handlers = resolution.route.dispatch.get(resolution.method)!;
    // Hono executes middleware and Response semantics; it never rematches a path.
    await every(...handlers)(c, next);
    if (c.req.method === 'HEAD') {
      c.res = new Response(null, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers: c.res.headers,
      });
    }
    return c.res;
  };
}
