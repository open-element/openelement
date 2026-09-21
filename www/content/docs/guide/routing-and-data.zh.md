---
title: '路由与数据'
lede: 'Routes 是基于文件的页面表面，带有显式 metadata 与数据边界。'
order: 40
---

## 文件路由

Routes 应当能从仓库目录树中被发现。`definePage` 路由默认导出由 `definePage(PageClass, { ... })` 包装的编译页面元素类；页面类位于非路由模块（例如 `app/components/`），其标记即编译后的 render 程序。路由仍可导出 `tagName` 为内容元素命名，但在 `definePage` 路由上该导出只为内容元素命名，不参与页面注册：页面本身注册在其编译类的 `@element(tag)` 下——SSR 从编译 Part Program 解析该标签——路由路径派生的标签（`app/routes/index.tsx` → `index-page`）仅作 fallback。生成的构建入口会注册所有被准入的路由与 island 类——路由模块从不自行注册。

## 元数据

导航与生成的文档依赖 route metadata，而路由按自身类型只在**一个**地方声明它。

**内容页**在 Markdown frontmatter 中声明：`title`（必填）、`lede`、`order`（必填，决定组内排序）、`section`（侧边栏分组，按集合取默认值），以及可选的 `navLabel`（当侧边栏标签需要不同于标题时）。`zh` 同源文件用同一组字段提供自己的译文值。站点的导航生成器通过页面正文所用的同一个 loader 与 schema 读取 frontmatter，因此侧边栏不可能以不同于页面本身的方式描述页面。

**代码路由**在路由模块里声明 `export const meta = { section, label, order }`——`section` 在侧边栏中分组，`label` 是短导航标签，`order` 决定组内排序。若某个 section 名称未被对应 basePath 在站点 section map 中列出，导航生成会直接失败，而不是悄悄把该分组从该页侧边栏里去掉。既无 `meta` 也无 frontmatter 的路由不会出现在侧边栏中，但依然正常参与路由。

文档元数据——页面 head——与导航元数据是两件事。`definePage(PageClass, { head })` 声明文档标题、描述、canonical 路径与结构化数据，既可以是静态对象，也可以是接收 props projector 同一份请求级上下文的 resolver。该 resolver 必须是这份上下文的纯函数：Document 接缝会按渲染解析它，自身绝不发起请求、缓存或调度 loader。对内容页而言，标题与 lede 取自渲染 locale 的 frontmatter，并以英文原文作为兜底，因此某个译文缺字段时页面仍能给出完整的 head。

两类元数据都不是标记：这里没有任何东西会渲染进页面正文。

## 数据边界

数据加载与展示标记保持分离。这条边界明确而狭窄：loader 返回数据，`definePage` 的 `props` projector 把数据映射到页面的编译属性上，页面 `render()` 只读 `this.<property>`。

`'dynamic'` 页面的 loader 在服务端运行（`'static'` 页面则在构建期按 `getStaticPaths()` 的每个条目各运行一次）并返回普通值；它拿不到元素实例，也从不接触 DOM。props projector 是请求作用域与编译页面之间唯一的确定性接缝——它接收 `{ data, actionData, params, request, route, meta }`（配置 i18n 时还有 `locale`）并返回页面声明的那些属性，因此静态产物、请求时服务端与 SPA 引导跑的是同一套投影。省略 `props` 时使用默认投影：先路由 params，再 loader 数据记录自身的条目，并过滤危险键，使恶意载荷无法重新原型化投影结果。多余条目会被忽略，因为编译序列化器只消费页面声明过的属性。

正是这层分离让两条链路可以互换、让标记可测试：页面的编译 render 程序只依赖自己的属性，因此它可以在构建期序列化、按请求重新渲染，或在浏览器里用同一份数据创建。它也是失败通道的挂载点——预期的校验失败以 `actionData` 到达而非异常，`fail()` 的回显经同一个 projector 重新进入页面。

两条值得写下来的推论：绝不要让 loader 返回 DOM 节点、类实例或任何序列化器需要猜测的东西（props 是投影，不是序列化）；也绝不要在 `render()` 里直接读请求（编译页面没有请求作用域——它可能渲染的一切都必须经过 projector）。

## 渲染模式

`renderIntent.mode` 决定页面在哪里渲染:`'static'`(默认)在构建时预渲染;`'dynamic'` 跳过预渲染,通过生成的 `dist/server` 入口按请求渲染,每次请求都会运行路由 loader。导出 action 的页面可以保持 `'static'`——即混合页:其 GET 被预渲染并由静态产物伺服,而其 action POST 在请求时分派给生成的服务器入口。当 GET 本身必须按请求执行时(按请求的 loader、响应头、不可重复的内容)才选择 `'dynamic'`。该行为已冻结。

## 表单 action

路由可导出 `action({ formData })`——纯 HTML 表单无需 JavaScript 即可工作:校验失败返回 `fail(4xx, data)`,以 `fail()` 的状态码(惯例为 422)重渲染并回显;成功则以 303 应答(PRG)。命名 action 通过 `formaction='?/name'` 分派。标记 `data-open-enhance` 的表单经 fetch 提交并把返回的文档 morph 就位:light DOM 未变化的已水合 island 状态保留,`data-open-preserve` 豁免子树,URL 跟随 PRG 目标。action 在校验失败后必须可安全重跑；这些应用闭环语义已冻结。

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
} from '@openelement/router';
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

基于 fetch 的 action 提交通过 `x-openelement-action` 头识别（从 `@openelement/router` 导出为 `ACTION_FETCH_HEADER`）：内置 morph 增强发送 `enhance`，收到与无 JS 路径相同的完整 HTML 响应；编程调用方发送 `true`，收到序列化的 `ActionResult` 联合类型——`success` / `failure` / `redirect`，带 `status` 与 `data`；错误结果则以 RFC 9457 `problem+json` 应答（`type`/`title`/`status`/`detail`）。没有该头即视为普通浏览器表单提交。

## 两条 loader/action 链

request-time(`'dynamic'`)loader/action 运行在服务端,上下文是 Web 标准的 `{ request, params, env, platform, route, responseHeaders }`,并使用 `fail()`/`redirect()` 协议。`responseHeaders` 是可变的 `Headers` 通道,会被合并进该请求的所有响应——渲染、重定向、422 重渲染与 fetch 通道 JSON——配方借此写入会话 cookie;冲突时框架协议头永远优先。SPA 模式的 loader/action 运行在客户端,上下文为 `{ params, searchParams, signal }`（一个 `URLSearchParams` 与一个 `AbortSignal`,action 另有 `formData`）,通过抛出异常来表达失败——throw 会被规整为 action 数据。两者命名刻意保持一致,但上下文不同:针对其中一条链编写的代码不能假设另一条链的上下文。

### 集成配方

[Validation（zod / valibot）](https://github.com/open-element/openelement/blob/main/docs/integrations/validation.md)——在 action 内做 schema 解析，失败 `fail(422)` 回显；由 request-time fixture 的 e2e 门禁验证。

[Rate limit（限流中间件）](https://github.com/open-element/openelement/tree/main/apps/saas#status-working-product)——固定窗口每 IP 限流（`apps/saas/lib/rate-limit.ts`），作用于 action POST，超限返回 429 `problem+json`；由 SaaS 测试套件覆盖。

[Supabase（第一方 SaaS）](https://github.com/open-element/openelement/tree/main/apps/saas)——`@supabase/ssr` 服务端客户端经响应头通道写会话 cookie，loader/action 内复检授权，RLS 优先的 notes / Storage / Realtime；在 `apps/saas` 中实现，由其测试套件覆盖。

## 另见

- [核心概念](/zh/guide/core-concepts)——这些路由所组合的元素与 island。
- [错误处理](/zh/guide/error-handling)——action 返回值所进入的失败通道。
- [API 路由](/zh/guide/api)——不经过页面的请求路由。
