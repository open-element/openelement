---
title: '错误处理'
lede: '错误处理保留平台语义，并让 route 失败保持可见。'
order: 80
---

## fail()：返回通道

预期内的 action 失败走返回而不是抛出：`fail(status, data)` 要求 4xx 状态码，产出 `OpenElementActionFailure`。服务器以 `fail()` 的状态码（惯例为 422）应答并重渲染页面、回显已提交的值；页面描述符的 `props` 投影器从上下文的 `actionData` 读取失败，并映射到编译页面属性。`isActionFailure()` 是鸭子类型守卫。增强表单只 morph 200/422 响应：非 422 的 4xx 会退化为整页导航——该路径上失败回显丢失,因此校验失败请保持在 422。

## redirect() 与 notFound()

控制流走抛出：`redirect(location, status)` 抛出 `OpenElementRedirect`——状态码限定 301/302/303/307/308，且在 POST action 上下文中一律收敛为 303（PRG）；`notFound(message)` 抛出 `OpenElementNotFound`（404）。`isOpenElementRedirect()` 与 `isOpenElementNotFound()` 按形状匹配，守卫可以跨越序列化边界存活。

## error 投影器

`definePage(PageClass, { error })` 声明页面级 error 投影器：它接收被捕获的 `error` 与渲染上下文，返回页面编译属性的错误变体（生成的入口用这些 props 以 500 状态码重渲染页面）；未声明时由通用状态页应答。`notFound()` 与意外的 loader/action 抛出都会落到这里；SPA 链上 throw 会被规整进同一通道，而不是悄悄替换 loader 数据。在程序化 action 通道（`x-openelement-action: true`）上，错误结果以 RFC 9457 Problem Details 应答（`application/problem+json`，字段 `type`/`title`/`status`/`detail`），取代此前的自定义 JSON 封装；该线格式已冻结。

### app/components/page-post.tsx

```tsx
// 由 open:compiled-element transform 编译。
import { element, OpenElement, property } from '@openelement/element';

@element('post-page', { root: 'shadow-open' })
export default class PostPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  title = '';

  @property({ reflect: false, attribute: false })
  error = '';

  @property({ reflect: false, attribute: false })
  status = 0;

  render() {
    return (
      <main>
        {this.status
          ? <h1>{this.status}</h1>
          : (
            <form method='post' data-open-enhance>
              <input name='title' value={this.title} />
              <button type='submit'>Save</button>
              {this.error ? <p role='alert'>{this.error}</p> : <span></span>}
            </form>
          )}
      </main>
    );
  }
}
```

### app/routes/posts/[id].tsx

```ts
import {
  definePage,
  fail,
  isOpenElementNotFound,
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
  props({ actionData }) {
    const action = actionData as PostActionData | undefined;
    return { title: action?.title ?? '', error: action?.error ?? '' };
  },
  error(error) {
    // notFound() and unexpected throws land on the error projector.
    return { status: isOpenElementNotFound(error) ? 404 : 500 };
  },
});
```

`redirect()` 也可显式指定状态码（301/302/303/307/308）；其他状态码在调用时即被拒绝。同样的守卫在 SPA 链上可用，但 SPA 的 loader/action 拿到的是 `{ params, searchParams, signal }`（action 另有 `formData`）。

## 构建期诊断

以上都是运行时通道。编译器另有回答：超出创作语法的模块在构建期失败，并给出带源码位置、携带稳定 `OEC####` 码的诊断——即编译元素边界强制执行的 attribute、Block、装饰器与 provenance 规则。[错误码](/zh/errors) 逐条列出每个码触发的消息与确切的源码调用点，且由诊断本身生成，因此这张表既不会描述构建已经不再产生的码，也不会漏掉仍在产生的码。

### 机器可读的诊断信封

每一类构建失败——编译器诊断、样式方案拒绝、admission 警告、SSG 失败——都可以在同一个机器可读通道上作答：一个 JSON 信封，携带 `code`、`severity`、`phase`、`message`，在生产者有源码位置时再携带 `file`、`line`（1 起）、`column`；在生产者能给出修复办法时携带 `hint`。信封类型由 `@openelement/protocol` 拥有；各生产者保留自己的码表（`OEC####`、`OE_PRESET_*`、`OE_SSG_*`），因此码永远是生产者自己的，未知的码也能原样往返。

`openelement build` 按需输出聚合结果，人读输出与退出码不变：

```sh
openelement build --diagnostics=json          # stderr 上一行 JSON 报告
openelement build --diagnostics-file=diagnostics.json   # 同一文档写入文件
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
      "code": "OEC9020",
      "severity": "error",
      "phase": "build",
      "message": "property defaults must be serializable literals",
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
