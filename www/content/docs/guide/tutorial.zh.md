---
title: '教程：第一个应用'
navLabel: '教程'
lede: '从空目录开始做一个完整的小应用：创建项目、加一个页面、加一个 island、加一个表单 action，最后构建并起服务——每一步都给出命令和预期结果。'
order: 2
---

> {{SOURCE_LINE_NOTE}} 下文讲的是基线创作接口，也就是本指南通篇记录的那一套。

## 开始之前

需要 **Deno 2.9 或更高版本**，以及一个终端。没有别的前置条件——不需要装 Node.js，也没有 `package.json`。

本教程用五步做出一个小应用，每一步都以「看得见的结果」收尾：

1. **创建项目**——把 starter 落到磁盘，并在 dev 下跑起来。
2. **加一个页面**——一个新 URL，返回 HTML。
3. **加一个 island**——一个会在浏览器里「醒来」的组件。
4. **加一个表单 action**——一个 POST：要么校验失败，要么保存并重定向。
5. **构建并起服务**——产出可以部署的 `dist/`。

本页的 TypeScript 与 TSX 代码块不是示意片段：CI 会在每次提交时用框架源码对它们做类型检查。

## 第 1 步：创建项目

```bash
{{INSTALL_COMMAND}}
cd my-app
deno task dev
```

`--minimum-dependency-age 0` 只在一种情况下需要：Deno 默认（约 24 小时）会拒绝发布未满一天的包。

create CLI 每个文件打印一行 `created <path>`，随后打印后续命令：

```text
openElement project created at ./my-app/

  cd my-app
  deno task dev
  See README.md for all tasks (check/build/start/preview)
```

`deno task dev` 启动 Vite dev server，并打印要打开的地址：

```text
  VITE v8.0.16  ready in 412 ms

  ➜  Local:   http://localhost:5173/
```

这个页面就是 starter 的首页路由。它的目录结构就是整个架构：

```text
my-app/
  deno.json         import map 与任务：dev、check、test、build、start、preview
  vite.config.ts    设计 token 与 openElement Vite 插件
  app/routes/       一个文件对应一个 URL
  app/components/   页面元素及其样式表
  app/islands/      选择进入客户端投递的模块
  public/           静态资源，原样拷进 dist/
```

`deno task check` 会类型检查 starter 的 `app/` 目录与 `vite.config.ts`；新增的路由会被自动纳入。

## 第 2 步：加第一个页面

URL 就是文件：`app/routes/hello.tsx` 对应 `/hello`。标记本身属于 `app/components/` 下的编译元素，所以两个文件都要建。

`app/components/page-hello.tsx`：

```tsx
// Compiled by the open:compiled-element transform at build time.
import { element, OpenElement } from '@openelement/element';

@element('hello-page', { root: 'light' })
export default class HelloPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>Hello from a page</h1>
        <p>This markup is server-rendered HTML, with no client JavaScript.</p>
      </main>
    );
  }
}
```

`app/routes/hello.tsx`：

```ts
import { definePage } from '@openelement/router';
import HelloPage from '../components/page-hello.tsx';

export default definePage(HelloPage, {
  head: {
    title: 'Hello — my-app',
    description: 'The tutorial page.',
  },
});
```

关于这个路由模块，现在就要知道两件事：

- 它是一层**绑定**。标记归类所有；路由模块把类交给 `definePage`，并附上页面的 head 元数据。
- `definePage` 只接受 `route`、`head`、`renderIntent`、`props` 和 `error`。没有 `render()` 字段，也没有 `route.path`——URL 由文件名决定。

预期结果：dev server 不需要重启就会接管新文件。打开 http://localhost:5173/hello，或者直接看响应：

```bash
curl -s http://localhost:5173/hello | grep -o 'Hello from a page'
```

```text
Hello from a page
```

标题本来就在服务端发出的 HTML 里，不是脚本注入的。这个页面加载的客户端模块只有 starter 自带的 `app-shell`；这条路由本身没有引入任何 island。

## 第 3 步：加第一个 island

island 就是 `app/islands/` 下的一个模块。这个目录**本身**就是注册面：没有任何地方 import 它，构建会扫描该目录，并从文件名推导标签名（`hello-counter.tsx` → `<hello-counter>`）。

`app/islands/hello-counter.tsx`：

```tsx
import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement, property } from '@openelement/element';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });

@element('hello-counter', { root: 'shadow-open' })
export default class HelloCounter extends OpenElement {
  @property({ reflect: false, attribute: false })
  count = 0;

  decrement(): void {
    this.count--;
  }

  increment(): void {
    this.count++;
  }

  render() {
    return (
      <div class='counter-row'>
        <button type='button' onClick={this.decrement}>-</button>
        <span id='count'>{this.count}</span>
        <button type='button' onClick={this.increment}>+</button>
      </div>
    );
  }
}
```

接着让刚才那个页面承载它。`app/components/page-hello.tsx` 变成：

```tsx
import { element, OpenElement } from '@openelement/element';

@element('hello-page', { root: 'light' })
export default class HelloPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>Hello from a page</h1>
        <p>This markup is server-rendered HTML, with no client JavaScript.</p>
        <section class='demo'>
          <p>The server sent this counter's markup; the browser upgrades it on idle.</p>
          <hello-counter></hello-counter>
        </section>
      </main>
    );
  }
}
```

预期结果——刷新 http://localhost:5173/hello：

- 在任何 JavaScript 执行之前，响应里就已经有计数器标记，里面的数字是 `0`：island 通过同一个编译类在服务端完成了渲染。
- 点 `+` 和 `-`，数字会变。`hydrate: 'idle'` 让浏览器在页面稳定后去取该 island 的 chunk、升级元素，并绑定编译模板声明的那些事件处理。
- 没有任何路由引用的 island 永远不会被投递——构建从你的路由源码推导可达标签，所以只往 `app/islands/` 里放一个模块，不会给任何页面增加 JavaScript。

## 第 4 步：加一个表单 action

路由模块还可以导出 `action`。先建页面，再建承载表单的路由。

`app/components/page-notes.tsx`：

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('notes-page', { root: 'light' })
export default class NotesPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  note = '';

  @property({ reflect: false, attribute: false })
  error = '';

  @property({ reflect: false, attribute: false })
  saved = '';

  render() {
    return (
      <main>
        <h1>Notes</h1>
        <form method='post' data-open-enhance>
          <input name='note' type='text' value={this.note} placeholder='Write a note' />
          <button type='submit'>Save</button>
        </form>
        <p id='error'>{this.error}</p>
        <p id='saved'>{this.saved}</p>
      </main>
    );
  }
}
```

`app/routes/notes.tsx`：

```ts
import { definePage, fail, type OpenElementActionFailure, redirect } from '@openelement/router';
import NotesPage from '../components/page-notes.tsx';

interface NotesActionData {
  error?: string;
  note?: string;
}

export function action(ctx: { formData: FormData }): OpenElementActionFailure<NotesActionData> {
  const note = String(ctx.formData.get('note') ?? '').trim();
  if (!note) {
    return fail(422, { error: 'a note is required', note });
  }
  throw redirect(`/notes?saved=${encodeURIComponent(note)}`);
}

export default definePage(NotesPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Notes — my-app' },
  props({ request, actionData }) {
    const saved = request ? new URL(request.url).searchParams.get('saved') : undefined;
    const result = actionData as NotesActionData | undefined;
    return {
      note: result?.note ?? '',
      error: result?.error ?? '',
      saved: saved ?? '',
    };
  },
});
```

各部分的作用：

- 表单是纯 HTML，没有 JavaScript 也能用。那种提交会在服务端执行 `action`；`fail(422, …)` 用报错文案和用户刚输入的值重新渲染同一个页面。
- `redirect()` 用一个 `303` 指向一个 GET 地址——即 post/redirect/get，因此刷新结果页不会重复提交。
- 这里的 `renderIntent: { mode: 'dynamic' }` 是有意的：GET 要从请求里读 `?saved=`，必须按请求渲染。GET 不需要请求的页面可以保持 `'static'` 并同样导出 action，此时只有 POST 走请求时路径。
- `props` 是请求作用域与编译标记之间**唯一**的接缝。它返回一个对象，每个键设置页面元素上同名的 `@property`。

预期结果：`data-open-enhance` 用 `fetch` 提交表单，并把返回的文档 morph 到位，页面不整页刷新。想看协议本身，可以直接向 action 发请求：

```bash
curl -i -X POST -H 'x-openelement-action: true' --data 'note=' http://localhost:5173/notes
```

```text
HTTP/1.1 422 Unprocessable Entity
content-type: application/problem+json; charset=utf-8
```

```bash
curl -i -X POST -H 'x-openelement-action: true' --data 'note=hello' http://localhost:5173/notes
```

```text
HTTP/1.1 303 See Other
location: /notes?saved=hello
```

不带 `x-openelement-action` 头时，同一个 POST 就是普通的浏览器表单提交，返回 HTML 而不是 JSON。当一个表单需要多个提交按钮时，路由还可以导出 `actions`，用 `formaction='?/name'` 分发。

## 第 5 步：构建并起服务

```bash
deno task build
```

构建会预渲染所有静态路由、为每个可达 island 打一个 chunk，并且——因为 `/notes` 是请求时的——同时写出服务端入口。预期输出（已截取：starter 自带的 island 也在同一张表里，逐页清单省略）：

```text
== openElement Build Manifest - Phase 3 @ 12:04:31 ==

  Client Islands:
  File                         Size
  --------------------------   --------
  ...
  hello-counter.js             …
  --------------------------   --------
  TOTAL JS                     …

  ...
  All artifacts within budget limits
```

```bash
ls dist
```

本教程的作品对应的产物：

```text
index.html          预渲染的 /
hello/index.html    预渲染的 /hello
404.html            未找到路由
client/islands/     每个可达 island 一个 chunk
island-manifests/   page-<hash>.json——记录每个页面加载哪些 island
server/index.js     回答 POST /notes 的请求时处理器
```

起服务：

```bash
deno task start
```

```text
[openElement start] request-time server entry loaded (dynamic routes enabled)
[openElement start] http://localhost:4173
```

端口取自 `OPEN_ELEMENT_PORT`，其次是 `PORT`，默认 4173。要验证的是产物，而不是日志：

```bash
curl -i http://localhost:4173/hello | head -1
```

```text
HTTP/1.1 200 OK
```

`/hello` 是磁盘上的文件；`/notes` 走到了服务端入口。`deno task preview` 是纯静态模式，只要 `dist/server` 存在就拒绝运行——所以带请求时路由的项目要用 `deno task start` 起。

到这里你有了一个项目、一个页面、一个 island、一个表单 action，以及一份可以部署的构建产物。

## 下一步

- [路由与数据](/zh/guide/routing-and-data)——loader、具名 action，以及两条 loader/action 链路。
- [Islands 与 SSR](/zh/guide/islands-and-ssr)——投递策略，以及真正发到浏览器的东西。
- [部署](/zh/guide/deployment)——完整的产物契约与 Nitro preset。

## 另见

- [核心概念](/zh/guide/core-concepts)——`@element` 与 `@property` 背后的元素模型。
- [样式](/zh/guide/styling)——页面样式放在哪里，以及什么能穿过 shadow 边界。
- [测试](/zh/guide/testing)——面对构建产物值得跑的检查。
