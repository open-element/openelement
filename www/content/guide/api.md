---
title: 'API Routes'
lede: 'API routes use platform request and response primitives. Keep route handlers explicit, typed, and close to the app boundary.'
order: 60
---

## Request boundary

Files under an `api/` directory of the routes dir are API routes; they are served by the same generated entry as pages and are never prerendered. Requests and responses are the Web `Request` and `Response` objects.

## Handler shape

An API route default-exports either a Hono app (mounted with `app.route()`) or a function `(ctx) => Response` receiving `{ request, params, env, platform }` (mounted with `app.all()`). Keep input parsing, validation, and response serialization visible in the route.

### app/routes/api/hello.ts

```ts
// Files under an api/ directory are API routes. Default-export a Hono
// app (mounted with app.route()) or a function (ctx) => Response
// (mounted with app.all()).
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

The same default-export contract applies at every depth: `app/routes/api/items/[id].ts` serves `/api/items/:id` with `params` populated from the path.

## Runtime fit

Use Deno-first tasks and avoid Node-only assumptions in docs examples.
