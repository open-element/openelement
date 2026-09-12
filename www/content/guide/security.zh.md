---
title: '安全'
lede: 'action 内置的 CSRF 同源地板，以及面向 API 路由与隐式凭据应用的 middleware 配方。'
order: 95
---

## 基本假设

生成的 action POST 处理器内置 fail-closed 同源地板（ADR-0121 §12 修订文）：当 `Sec-Fetch-Site` 为 `cross-site`、`Origin` 存在且与请求 URL 的源不一致，或 `Sec-Fetch-Site` 为 `same-site` 但 `Origin` 缺失或为 `null` 时拒绝请求——最后一种是伪造头，因为浏览器 POST 总会带 `Origin`（#921）；loopback 主机别名（`localhost` / `127.0.0.1` / `[::1]`）视同同源（#937）。两个头都省略的客户端（典型的非浏览器工具）放行。在请求 env 绑定（`c.env` / Nitro runtime env）上设置 `OPEN_ELEMENT_DISABLE_CSRF=1` 可选择退出。框架自有 session API 不在当前契约内；服务提供方配方负责 cookie/session 传输，并必须应用相同的同源地板与显式 cookie 属性。

## 隐式身份验证

使用隐式凭据（HTTP Basic、mTLS，或 `SameSite=None` 的 cookie）的应用无法依赖 Lax 默认值：浏览器会在跨站请求中附带这些凭据。内置同源地板已覆盖生成的 action POST，但这类应用还应在每个会改变状态的 API 路由上校验请求来源。

## 重定向目标

`redirect()` 只校验状态码（3xx 白名单），从不校验 location——目标被视为作者自控代码（与 SvelteKit 相同）。action 若把用户可控输入（`?next=` 参数、存储的 URL）直接作为重定向目标，就构成开放重定向：在 action 里先校验或白名单化目标，再调用 `redirect()`。

## Middleware 配方

内置地板只守卫生成的 action 处理器。对于自定义 API 路由——以及作为隐式凭据应用的纵深防御——把下面的 middleware 放入 `app/routes/_middleware.ts`。根级 `_middleware.ts` 默认导出一个作用于 `/*` 的 Hono middleware，位于每个页面 action 与 API 路由之前。它放行安全方法与 same-site Fetch Metadata，并为旧浏览器回退到 `Origin` 白名单。

### app/routes/_middleware.ts

```ts
import type { Context, Next } from 'hono';

// CSRF guard for custom API routes and defense in depth (ADR-0121 §12):
// generated action POST handlers already enforce a fail-closed same-origin
// floor (opt out with OPEN_ELEMENT_DISABLE_CSRF=1 on the request env). Apps
// using ambient authentication (Basic, mTLS, SameSite=None cookies) should
// also reject cross-site state-changing requests on their API routes.
const ALLOWED_ORIGINS = new Set(['https://app.example.com']);

export default async function csrfGuard(c: Context, next: Next) {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  // Fetch Metadata: same-origin/same-site submissions and user-typed
  // navigations are always fine.
  const site = c.req.header('sec-fetch-site');
  if (site === 'same-origin' || site === 'same-site' || site === 'none') {
    return next();
  }
  // Older browsers without Fetch Metadata: fall back to the Origin header.
  const origin = c.req.header('origin');
  if (origin && ALLOWED_ORIGINS.has(new URL(origin).origin)) {
    return next();
  }
  return c.text('Forbidden', 403);
}
```

`middleware.corsOrigin`（`openElement()` 选项）只管跨域资源共享，不是 CSRF 校验。两者组合使用：CORS 管读取，这个守卫管写入。不需要 Hono context 的守卫也可以挂在 `middleware.use` 上——在 handler 边界组合的无方言 fetch 中间件链，dev/start/Nitro 语义一致（见「[配置 → middleware.use](/zh/guide/configuration#middleware-use)」）。

## 默认安全 HTML

渲染不可信 HTML 片段（markdown 输出、CMS 内容、第三方 HTML）时，先经过 `@openelement/element/sanitize` 的 `sanitizeHtml`——基于 allow-list 的消毒器，带「先解码再校验」的 URL scheme 策略（ADR-0126）。只有上游已消毒时才使用 `trustedHtml`：它是信任边界，不是消毒器。
