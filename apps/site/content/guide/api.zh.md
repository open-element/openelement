---
title: 'API 路由'
lede: 'API routes 使用平台 request 与 response 原语。Route handlers 保持显式、有类型，并贴近应用边界。'
order: 60
---

## Request 边界

routes 目录下 `api/` 子目录中的文件是 API 路由；它们与页面由同一个生成入口伺服，且永不预渲染。请求与响应都是 Web `Request` 与 `Response` 对象。

## Handler 形态

API 路由默认导出两种形态之一：一个 Hono app（以 `app.route()` 挂载），或一个接收 `{ request, params, env, platform }` 的函数 `(ctx) => Response`（以 `app.all()` 挂载）。输入解析、校验与响应序列化在 route 中保持可见。

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

同一默认导出契约适用于任意深度：`app/routes/api/items/[id].ts` 伺服 `/api/items/:id`，`params` 从路径中解析填充。

## 运行时适配

使用 Deno-first 的 tasks，文档示例避免仅 Node 的假设。
