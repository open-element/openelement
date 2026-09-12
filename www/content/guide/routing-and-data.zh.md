---
title: '路由与数据'
lede: 'Routes 是基于文件的页面表面，带有显式 metadata 与数据边界。'
order: 40
---

## 文件路由

Routes 应当能从仓库目录树中被发现。`definePage` 路由默认导出由 `definePage(PageClass, { ... })` 包装的编译页面元素类；页面类位于非路由模块（例如 `app/components/`），其标记即编译后的 render 程序。路由仍可导出 `tagName` 为内容元素命名（#960），但在 `definePage` 路由上该导出只为内容元素命名，不参与页面注册：页面本身始终注册在路由路径派生的标签下（`app/routes/index.tsx` 对应 `index-page`）。生成的构建入口会注册所有被准入的路由与 island 类——路由模块从不自行注册。

## 元数据

导航与生成的文档依赖 route metadata。

## 数据边界

数据加载与展示标记保持分离。

## 渲染模式

`renderIntent.mode` 决定页面在哪里渲染:`'static'`(默认)在构建时预渲染;`'dynamic'` 跳过预渲染,通过生成的 `dist/server` 入口按请求渲染,每次请求都会运行路由 loader。导出 action 的页面必须声明 `'dynamic'`——构建会拒绝预渲染的 action 页面。该行为已按 ADR-0122 冻结。

## 表单 action

dynamic 路由可导出 `action({ formData })`——纯 HTML 表单无需 JavaScript 即可工作:校验失败返回 `fail(4xx, data)`,以 `fail()` 的状态码(惯例为 422)重渲染并回显;成功则以 303 应答(PRG)。命名 action 通过 `formaction='?/name'` 分派。标记 `data-open-enhance` 的表单经 fetch 提交并把返回的文档 morph 就位:light DOM 未变化的已水合 island 状态保留,`data-open-preserve` 豁免子树,URL 跟随 PRG 目标。action 在校验失败后必须可安全重跑；这些应用闭环语义已按 ADR-0122 冻结。

### app/components/page-guestbook.tsx

```tsx
// 由 open:compiled-element transform 编译。
import { element, OpenElement, property } from '@openelement/element';

@element('guestbook-page', { root: 'shadow-open' })
export default class GuestbookPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  entries: string[] = [];

  @property({ reflect: false, attribute: false })
  message = '';

  @property({ reflect: false, attribute: false })
  error = '';

  @property({ reflect: false, attribute: false })
  echoed = '';

  render() {
    return (
      <main>
        <h1>guestbook</h1>
        <form method='post' data-open-enhance>
          <input name='message' type='text' value={this.message} />
          <button type='submit'>Send</button>
          <button type='submit' formaction='?/shout'>Shout</button>
        </form>
        {this.error ? <p role='alert'>{this.error}</p> : <span></span>}
        {this.echoed ? <p>echo={this.echoed}</p> : <span></span>}
        <ul>{this.entries.map((entry) => <li>{entry}</li>)}</ul>
      </main>
    );
  }
}
```

### app/routes/guestbook.tsx

```ts
import {
  definePage,
  fail,
  type OpenElementActionFailure,
  redirect,
} from '@openelement/app';
import GuestbookPage from '../components/page-guestbook.tsx';

interface GuestbookData {
  entries: string[];
}

interface GuestbookActionData {
  error?: string;
  message?: string;
}

export async function loader(): Promise<GuestbookData> {
  return { entries: await listEntries() }; // app data layer
}

export function action(
  ctx: { formData: FormData },
): OpenElementActionFailure<GuestbookActionData> {
  const message = String(ctx.formData.get('message') ?? '').trim();
  if (!message) {
    return fail(422, { error: 'message is required', message });
  }
  throw redirect('/guestbook?echoed=' + encodeURIComponent(message)); // 303 PRG
}

// Named actions dispatch via formaction='?/name'.
export const actions = {
  shout(ctx: { formData: FormData }): never {
    const message = String(ctx.formData.get('message') ?? '').trim() || 'silence';
    throw redirect('/guestbook?echoed=' + encodeURIComponent(message.toUpperCase()));
  },
};

// props 投影器是把请求作用域映射到编译页面属性的唯一确定性接缝。
export default definePage(GuestbookPage, {
  renderIntent: { mode: 'dynamic' },
  props({ data, actionData, request }) {
    const action = actionData as GuestbookActionData | undefined;
    const echoed = request ? new URL(request.url).searchParams.get('echoed') : undefined;
    return {
      entries: data?.entries ?? [],
      message: action?.message ?? '',
      error: action?.error ?? '',
      echoed: echoed ?? '',
    };
  },
});
```

## Action fetch 协商

基于 fetch 的 action 提交通过 `x-openelement-action` 头识别（从 `@openelement/app` 导出为 `ACTION_FETCH_HEADER`）：内置 morph 增强发送 `enhance`，收到与无 JS 路径相同的完整 HTML 响应；编程调用方发送 `true`，收到序列化的 `ActionResult` 联合类型——`success` / `failure` / `redirect`，带 `status` 与 `data`；错误结果则以 RFC 9457 `problem+json` 应答（`type`/`title`/`status`/`detail`，#863）。没有该头即视为普通浏览器表单提交。

## 两条 loader/action 链

request-time(`'dynamic'`)loader/action 运行在服务端,上下文是 Web 标准的 `{ request, params, env, platform, route, responseHeaders }`,并使用 `fail()`/`redirect()` 协议。`responseHeaders`(ADR-0129)是可变的 `Headers` 通道,会被合并进该请求的所有响应——渲染、重定向、422 重渲染与 fetch 通道 JSON——配方借此写入会话 cookie;冲突时框架协议头永远优先。SPA 模式的 loader/action 运行在客户端,上下文只有 `{ params }`(action 另有 `formData`),通过抛出异常来表达失败——throw 会被规整为 action 数据。两者命名刻意保持一致,但上下文不同:针对其中一条链编写的代码不能假设另一条链的上下文(#570,ADR-0119 已冻结的 SPA 语义)。

### 集成配方

[better-auth](https://github.com/open-element/openelement/blob/main/docs/integrations/better-auth.md)——在 loader 中读会话、把 auth 端点挂为 API 路由、在 action 中授权（文档级配方）。

[Drizzle](https://github.com/open-element/openelement/blob/main/docs/integrations/drizzle.md)——查询放在 loader、变更放在 action，连接密钥只走 `ctx.env`（文档级配方）。

[Validation（zod / valibot）](https://github.com/open-element/openelement/blob/main/docs/integrations/validation.md)——在 action 内做 schema 解析，失败 `fail(422)` 回显；由 request-time fixture 的 e2e 门禁验证。

[Rate limit（限流中间件）](https://github.com/open-element/openelement/blob/main/docs/integrations/rate-limit.md)——`middleware.use` 上的固定窗口每 IP 限流，作用于 action POST，超限返回 429 `problem+json`；已对仓库源码构建的 scratch 应用验证。

[FileDataAdapter（文件数据适配器）](https://github.com/open-element/openelement/blob/main/docs/integrations/file-data-adapter.md)——ADR-0095 的 recipe 落地：unstorage 读面（`getItem`/`keys`）的只读 JSON 文件适配器，在 loader 中使用；已对仓库源码构建的 scratch 应用验证。

[Auth guard（better-auth 守卫中间件）](https://github.com/open-element/openelement/blob/main/docs/integrations/better-auth-guard.md)——把匿名用户 303 重定向出受保护路由组，并把会话身份透传给 loader；守卫机制已验证，better-auth 调用以 stub 代替。

[Supabase（参考应用配方）](https://github.com/open-element/openelement/blob/main/docs/integrations/supabase.md)——`@supabase/ssr` 服务端客户端经 ADR-0129 响应头通道写会话 cookie，loader/action 内复检授权，RLS 优先的 notes / Storage / Realtime；所有代码块取自 `examples/supabase-cloudflare-starter`，已对真实 Supabase 项目完成资格验证。
