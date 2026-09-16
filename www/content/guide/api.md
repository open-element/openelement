---
title: 'API Routes'
lede: 'API routes use platform request and response primitives. Keep route handlers explicit, typed, and close to the app boundary.'
order: 60
---

## Request boundary

Files under an `api/` directory of the routes dir are API routes; they are served by the same generated entry as pages and are never prerendered. Requests and responses are the Web `Request` and `Response` objects.

## Handler shape

An API route default-exports either a function `(ctx) => Response` receiving `{ request, params, env, platform }` (mounted with `app.all()` — every method reaches the function), or method-keyed WinterCG handlers `{ GET: (request, context) => Response, ... }` — the `HttpRouteRecord` shape from `@openelement/router/http`, dispatched with 405/`Allow` semantics and a `context` of `{ params, searchParams, url }`. Keep input parsing, validation, and response serialization visible in the route.

### app/routes/api/hello.ts

```ts
// Files under an api/ directory are API routes. Default-export a
// function (ctx) => Response (mounted with app.all()) or method-keyed
// WinterCG handlers (dispatched with 405/Allow semantics).
export default function hello(ctx: {
  request: Request;
  params: Record<string, string>;
  env: Record<string, string | undefined>;
  platform?: unknown;
}) {
  const url = new URL(ctx.request.url);
  return Response.json({ hello: url.searchParams.get('name') ?? 'world' });
}
```

### app/routes/api/items/[id].ts

```ts
// Method-keyed handlers: one entry per method; unsupported methods
// answer 405 with an Allow header. Handlers may also be arrays
// (onion chain, like HttpRouteRecord in @openelement/router/http).
export default {
  GET: (_request: Request, context: { params: Record<string, string> }) =>
    Response.json({ id: context.params.id }),
  POST: async (request: Request, context: { params: Record<string, string> }) =>
    Response.json({ id: context.params.id, saved: await request.json() }, { status: 201 }),
};
```

The same default-export contract applies at every depth: `app/routes/api/items/[id].ts` serves `/api/items/:id` with `params` populated from the path.

## Runtime fit

Use Deno-first tasks and avoid Node-only assumptions in docs examples.
