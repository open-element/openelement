---
title: '错误处理'
lede: '错误处理保留平台语义，并让路由失败保持可见。'
order: 80
---

## fail()：返回通道

预期内的 action 失败走返回而不是抛出：`fail(status, data)` 要求 4xx 状态码，产出 `OpenElementActionFailure`。服务器以 `fail()` 的状态码（惯例为 422）应答并重渲染页面、回显已提交的值；页面描述符的 `props` 投影器从上下文的 `actionData` 读取失败，并映射到页面声明的属性上。`isActionFailure()` 是鸭子类型守卫。增强表单只 morph 200/422 响应：非 422 的 4xx 会退化为整页导航——该路径上失败回显丢失,因此校验失败请保持在 422。

## redirect() 与 notFound()

控制流走抛出：`redirect(location, status)` 抛出 `OpenElementRedirect`——状态码限定 301/302/303/307/308，且在 POST action 上下文中一律收敛为 303（PRG）；`notFound(message)` 抛出 `OpenElementNotFound`（404）。`isOpenElementRedirect()` 与 `isOpenElementNotFound()` 按形状匹配，守卫可以跨越序列化边界存活。

## error 投影器

通过 `definePage(PageComponent, { error })`，可以在 loader、action 或页面渲染意外失败后渲染自定义错误 HTML。投影器接收错误与渲染上下文，返回重新渲染所需的页面 props，HTTP 状态码为 500。未声明投影器或错误页面渲染失败时，服务端返回通用状态页。路由会在调用投影器之前处理 `redirect()` 和 `notFound()`。程序化 action（`x-openelement-action: true`）的意外错误使用 RFC 9457 Problem Details，响应类型为 `application/problem+json`，包含 `type`、`title`、`status` 和 `detail` 字段。

### app/components/page-post.tsx

```tsx
// A page-assembled component: the route owns the data, this module owns the markup.
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'post-page',
  // A page root is a shadow root: the compiler's DSD host producer renders it,
  // so even the error variant is part of the very first response.
  root: 'shadow',
  properties: {
    // One row per projector key, every one attribute-free: the props projector
    // writes them, and nothing of theirs should reach a host attribute.
    title: { attribute: false, default: '' },
    error: { attribute: false, default: '' },
    status: { attribute: false, default: 0 },
  },
});

export default function PostPage(props: { title: string; error: string; status: number }) {
  return (
    <main>
      {props.status
        ? <h1 data-status={props.status}>Request failed</h1>
        : (
          <form method='post' data-open-enhance>
            <input name='title' value={props.title} />
            <button type='submit'>Save</button>
          </form>
        )}
      {props.error ? <p role='alert' data-message={props.error}>{props.error}</p> : null}
    </main>
  );
}
```

条件分支只准入一个 JSX 元素或 `null`，因此上面每个分支都是元素，「没有错误」的情况是 `null` 而不是裸字符串（取值为文本的分支会以 `OEC9042` 失败关闭）。错误变体是同一份编译标记的普通组成部分——没有第二个错误页，也没有运行时 JSX 路径。

### app/routes/posts/[id].tsx

```ts
import {
  definePage,
  fail,
  notFound,
  type OpenElementActionFailure,
  redirect,
} from '@openelement/router';
import PostPage from '../../components/page-post.tsx';

interface PostActionData {
  error?: string;
  title?: string;
}

export async function loader({ params }: { params: Record<string, string> }) {
  const post = await findPost(params.id); // app data layer
  if (!post) notFound('no such post'); // throws OpenElementNotFound (404)
  return { post };
}

export function action(ctx: { formData: FormData }): OpenElementActionFailure<PostActionData> {
  const title = String(ctx.formData.get('title') ?? '').trim();
  if (title.length < 3) {
    // Expected failure: RETURN fail(4xx, data) — 422 re-render with the echo.
    return fail(422, { error: 'title is too short', title });
  }
  // Success: throw redirect() — coerced to 303 (PRG) in the POST context.
  throw redirect('/posts?saved=1');
}

export default definePage(PostPage, {
  renderIntent: { mode: 'dynamic' },
  props({ data, actionData }) {
    const post = data as { title?: string } | undefined;
    const action = actionData as PostActionData | undefined;
    // The projector is the only seam: one object, one key per declared row.
    return {
      title: action?.title ?? post?.title ?? '',
      error: action?.error ?? '',
    };
  },
  error() {
    return { status: 500 };
  },
});
```

`redirect()` 也可显式指定状态码（301/302/303/307/308）；其他状态码在调用时即被拒绝。同样的守卫在 SPA 链上可用，但 SPA 的 loader/action 拿到的是 `{ params, searchParams, signal }`（action 另有 `formData`）。

## 在浏览器里：onError intrinsic

上面那些**路由**通道决定服务端如何应答。**组件**通道是分开的，而且窄得多：`onError(cb)`——从 `@openelement/element` import、在组件正文顶层调用的、会被编译器擦除的 intrinsic——是**单个生成元素**的错误边界。

```tsx
import { onError, useHost } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'my-widget',
  root: 'shadow',
  hydrate: 'idle',
  ssr: true,
});

export default function MyWidget() {
  const host = useHost();

  onError((env) => {
    // `env.error` is the thrown value exactly as thrown, never wrapped. This
    // callback bounds THIS element: a failure inside a child element is not
    // reported here, because no ancestor boundary intercepts a descendant.
    host.setAttribute('data-failed', '1');
    void env.error;
  });

  return <p>widget</p>;
}
```

`onError` 捕获当前元素执行过程中的同步错误，包括 setup、mount、claim、`onConnect` 回调、受追踪的 slot 刷新，以及编译组件中的 DOM 事件处理器。各个 Custom Element 分别处理自身的错误。

connect 或 claim 失败时，元素会先回滚，再调用 `onError`。断开后重新连接会按正常流程重试。更新或事件处理失败时，先前写入的 DOM 会保留，订阅或监听器可以在下一次继续执行。未注册处理器时，原始错误会向上传播。处理器自身抛错时，传播的是处理器抛出的错误。

浏览器运行 `onError`。使用 Element 的 `renderToString` 展开嵌套 Custom Elements 时，可以传入 `onNestedFailure`，以便在嵌套组件的服务端渲染器抛错时收到原始错误。输出的 HTML 保留该组件原先声明的宿主元素，服务端继续渲染同级组件。未传入该回调时，嵌套组件的错误会向上传播。Router 渲染页面时，未捕获的错误遵循上文所述的页面错误处理流程。

## 构建期诊断

以上都是运行时通道。编译器另有回答：超出创作语法的模块在构建期失败，并给出带源码位置、携带稳定 `OEC####` 码的诊断——即编译组件边界强制执行的 attribute、Block、intrinsic 与 provenance 规则。[错误码](/zh/errors) 逐条列出每个码触发的消息与确切的源码调用点，且由诊断本身生成，因此这张表既不会描述构建已经不再产生的码，也不会漏掉仍在产生的码。

### 机器可读的诊断信封

每一类构建失败——编译器诊断、样式方案拒绝、admission 警告、SSG 失败——都可以在同一个机器可读通道上作答：一个 JSON 信封，携带 `code`、`severity`、`phase`、`message`，在生产者有源码位置时再携带 `file`、`line`（1 起）、`column`；在生产者能给出修复办法时携带 `hint`。信封类型由 `@openelement/protocol` 拥有；各生产者保留自己的码表（`OEC####`、`OE_PRESET_*`、`OE_SSG_*`），因此码永远是生产者自己的，未知的码也能原样往返。

`openelement build` 按需输出聚合结果，人读输出与退出码不变：

```sh
openelement build --diagnostics=json          # one JSON report line on stderr
openelement build --diagnostics-file=diagnostics.json   # the same document to a file
```

构建未产生任何诊断时什么都不写。报告是一个文档：

```json
{
  "format": "openelement.diagnostics/1",
  "ok": false,
  "diagnostics": [
    {
      "code": "OE_COMPILER_DIAGNOSTICS",
      "severity": "error",
      "phase": "build",
      "message": "Build failed with 1 error",
      "file": "app/components/broken-page.tsx"
    },
    {
      "code": "OEC9042",
      "severity": "error",
      "phase": "build",
      "message": "spread attributes are outside the admitted grammar",
      "file": "app/components/broken-page.tsx",
      "line": 8,
      "column": 11
    }
  ]
}
```

`format` 是契约标签：消费方依据它分支，而不是靠猜；未来的形状变更会铸新标签，而不是重新解释旧字节。任何一个诊断携带 `error` 级别，`ok` 即为 false。一次失败的构建输出且仅输出一份聚合，包含该失败产生的每一个码——编译器的家族分类与每条带作者位置的 `OEC####` 记录——由消费方 harness 以 JSON 读取，而不是从日志里 grep。构建过程中记录的警告（admission 扫描的报告类）进入同一份聚合；只有警告的构建回答 `ok: true`。

## 另见

- [路由与数据](/zh/guide/routing-and-data)——`fail()`、`redirect()` 与 action 的出处。
- [错误码](/zh/errors)——编译器诊断，逐码列出。
- [安全](/zh/guide/security)——生成的 handler 会发出的状态码与响应头。
- [API 路由](/zh/guide/api)——非页面路由使用的同一组响应原语。
