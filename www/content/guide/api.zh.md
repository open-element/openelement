---
title: 'API 路由'
lede: 'API routes 使用平台 request 与 response 原语。Route handlers 保持显式、有类型，并贴近应用边界。'
order: 60
---

## Request 边界

routes 目录下 `api/` 子目录中的文件是 API 路由；它们与页面由同一个生成入口伺服，且永不预渲染。请求与响应都是 Web `Request` 与 `Response` 对象。

## Handler 形态

API 路由默认导出两种形态之一：一个接收 `{ request, params, env, platform }` 的函数 `(ctx) => Response`（以 `app.all()` 挂载——所有方法都进入该函数），或 method-keyed 的 WinterCG handlers `{ GET: (request, context) => Response, ... }`——即 `@openelement/router/http` 的 `HttpRouteRecord` 形态，以 405/`Allow` 语义派发，`context` 为 `{ params, searchParams, url }`。输入解析、校验与响应序列化在 route 中保持可见。

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

同一默认导出契约适用于任意深度：`app/routes/api/items/[id].ts` 伺服 `/api/items/:id`，`params` 从路径中解析填充。

## 运行时适配

使用 Deno-first 的 tasks，文档示例避免仅 Node 的假设。
