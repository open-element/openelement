---
title: '安全'
lede: 'action 内置的 CSRF 同源地板，以及面向 API 路由与隐式凭据应用的 middleware 配方。'
order: 95
---

## 基本假设

生成的 action POST 处理器内置 fail-closed 同源地板（ADR-0121 §12（已退役，可从 Git 历史恢复）修订文）：当 `Sec-Fetch-Site` 为 `cross-site`、`Origin` 存在且与请求 URL 的源不一致，或 `Sec-Fetch-Site` 为 `same-site` 但 `Origin` 缺失或为 `null` 时拒绝请求——最后一种是伪造头，因为浏览器 POST 总会带 `Origin`（#921）；loopback 主机别名（`localhost` / `127.0.0.1` / `[::1]`）视同同源（#937）。两个头都省略的客户端（典型的非浏览器工具）放行。在请求 env 绑定（`c.env` / Nitro runtime env）上设置 `OPEN_ELEMENT_DISABLE_CSRF=1` 可选择退出。框架自有 session API 不在当前契约内；服务提供方配方负责 cookie/session 传输，并必须应用相同的同源地板与显式 cookie 属性。

## 隐式身份验证

使用隐式凭据（HTTP Basic、mTLS，或 `SameSite=None` 的 cookie）的应用无法依赖 Lax 默认值：浏览器会在跨站请求中附带这些凭据。内置同源地板已覆盖生成的 action POST，但这类应用还应在每个会改变状态的 API 路由上校验请求来源。

## 重定向目标

`redirect()` 只校验状态码（3xx 白名单），从不校验 location——目标被视为作者自控代码（与 SvelteKit 相同）。action 若把用户可控输入（`?next=` 参数、存储的 URL）直接作为重定向目标，就构成开放重定向：在 action 里先校验或白名单化目标，再调用 `redirect()`。

## Middleware 配方

内置地板只守卫生成的 action 处理器。对于自定义 API 路由——以及作为隐式凭据应用的纵深防御——把下面的 middleware 放入 `app/routes/_middleware.ts`。根级 `_middleware.ts` 默认导出一个作用于 `/*` 的 WinterCG fetch middleware `(request, next) => Promise<Response>`，位于每个页面 action 与 API 路由之前。它放行安全方法与 same-site Fetch Metadata，并为旧浏览器回退到 `Origin` 白名单。

### app/routes/_middleware.ts

```ts
// CSRF guard for custom API routes and defense in depth (ADR-0121 §12, retired; recoverable from Git history):
// generated action POST handlers already enforce a fail-closed same-origin
// floor (opt out with OPEN_ELEMENT_DISABLE_CSRF=1 on the request env). Apps
// using ambient authentication (Basic, mTLS, SameSite=None cookies) should
// also reject cross-site state-changing requests on their API routes.
const ALLOWED_ORIGINS = new Set(['https://app.example.com']);

export default async function csrfGuard(request: Request, next: () => Promise<Response>) {
  const method = request.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  // Fetch Metadata: same-origin/same-site submissions and user-typed
  // navigations are always fine.
  const site = request.headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'same-site' || site === 'none') {
    return next();
  }
  // Older browsers without Fetch Metadata: fall back to the Origin header.
  const origin = request.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.has(new URL(origin).origin)) {
    return next();
  }
  return new Response('Forbidden', { status: 403 });
}
```

`middleware.corsOrigin`（`openElement()` 选项）只管跨域资源共享，不是 CSRF 校验。两者组合使用：CORS 管读取，这个守卫管写入。面向整个应用（而非单个路由子树）的守卫也可以挂在 `middleware.use` 上——在 handler 边界组合的无方言 fetch 中间件链，dev/start/Nitro 语义一致（见「[配置 → middleware.use](/zh/guide/configuration#middleware-use)」）。

## 内容安全策略（CSP）

`middleware.csp`（`{ policy, nonce, reportOnly }`）为请求时响应输出 Content-Security-Policy。与所有内置中间件一样，它只守卫请求时派发路径：预渲染的静态页面不经过中间件链，因此 SSG 产物改由构建期 `<meta http-equiv="Content-Security-Policy">` 标签承载策略，而不是 HTTP 头。

开启 `nonce: true` 后，生成的服务器为每个请求铸造一枚 nonce（随机 32 位十六进制值，逐请求更新），以请求级 `cspNonce` 暴露给渲染管线，并把 `'nonce-<值>'` 前置到 `script-src`（策略没有 `script-src` 指令时自动补上）。框架生成的每一个 `<script>`——island 客户端入口、dev 客户端、styled 404/500 页面——都经 `wrapInDocument` 的脚本描述符这一单点挂接，因此都携带本响应的 nonce。nonce 建议搭配 `script-src 'strict-dynamic'`：带 nonce 的 island 客户端入口即可 import 自己的 chunk，无需主机白名单。原始 head 片段永远无法注入 `<script>`（见下文「默认安全 HTML」），描述符管线因此始终是唯一的脚本来源。

nonce 按构造就是逐请求的，静态文件里不可能存在：纯静态（SSG）构建开启 `nonce: true` 会记录一条警告并回退为仅含策略的 `<meta>` 标签。该回退是 fail-closed 的——在 `script-src 'strict-dynamic'` 下，仅有策略的页面既没有 nonce 来源也没有白名单，浏览器会屏蔽**全部**脚本，island 永不 hydrate。纯静态站点要么写一份不依赖 nonce 的策略（例如 `script-src 'self'`，足以覆盖外部 island 客户端），要么只在伺服请求时路由的项目里保留 `nonce: true`。

设置 `reportOnly: true` 会把响应头（以及 SSG meta 标签）换成 `Content-Security-Policy-Report-Only`：浏览器只上报违规而不执行拦截，这是新策略上线前的灰度姿态。

### vite.config.ts —— 逐请求 nonce 的 CSP

```ts
import { defineConfig } from 'vite';
import { openElement } from '@openelement/router/vite';

export default defineConfig({
  plugins: [
    openElement({
      middleware: {
        csp: {
          nonce: true,
          policy:
            "default-src 'self'; script-src 'strict-dynamic'; style-src 'self' 'unsafe-inline'",
        },
      },
    }),
  ],
});
```

## 默认安全 HTML

`trustedHtml` 是框架显式的 HTML 信任边界：只有经 `trustedHtml()` 创建的值才能进入 `html` Part 与 `innerHTML` 接收点——普通字符串会在渲染时被拒绝。框架不提供 HTML 消毒器：不可信片段（用户输入、CMS 输出、第三方 HTML）请在进入框架之前，在你自己的系统边界完成消毒。原始 head 片段（`headExtras`、`inject.headFragments`）同样是开发者可信输入；框架只强制「无 `<script>`、无可执行 `<style>`」两条失败关闭的不变式。
