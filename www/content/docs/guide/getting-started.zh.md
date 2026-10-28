---
title: '快速开始'
lede: 'OpenElement 是以 Web Components 为原生契约、static-first 的应用框架。从标准 Custom Elements、pages、routes 与按需升级开始，产出可部署的 Vite/Nitro 输出。'
order: 1
---

> {{SOURCE_LINE_NOTE}} registry 真值以 [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json) 为准，不提供从 0.x 的受支持迁移路径。

本页先把新项目跑起来，再依次走一遍页面、额外元素与构建。每一步都以看得见的结果收尾；内部原理放在流程之后，而不是之前。

## 安装

**开始前：** 需要 Node.js 24.2 或更新版本，以及一个包管理器（`npm`、`pnpm`、`yarn` 或 `bun`）。先确认运行时：

```text
node --version   # 应输出 v24.2.0 或更新版本
```

三条命令跑起应用——依赖由生成器自己安装（用调用它的包管理器，或它在 `PATH` 上找到的第一个），没有单独的 install 步骤：

```bash
{{INSTALL_COMMAND}}
cd my-app
npm run dev
```

每一步在做什么：

- `{{INSTALL_COMMAND}}`——拉取已发布的 create CLI（不带版本的安装解析到 `latest`，即当前 1.0 线），把 showcase starter 脚手架写进 `my-app/`，并安装依赖。
- `cd my-app`——进入生成的项目。
- `npm run dev`——启动项目的 Vite 开发服务器。

安装命令解析到的版本登记在 [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json)（仓库的 registry 核验真值）中：脚手架把 `@openelement/*` 的 caret 范围（以该版本为下限）写进生成的 `package.json`，不需要任何额外旗标，后续 `1.0.0` 预发布版本靠 `npm update` 到手。

> 生成的项目是纯 Node 应用（ADR-0161）：脚本由 Node.js 24.2+ 驱动，任何包管理器（npm、pnpm、yarn、bun）都能跑——Node 24.2 是打包产物 engines 声明、CI 实际运行过的验证下限（Router CLI 依赖 Node 24.2.0 引入的 `import.meta.main`；`.node-version` 钉住 24.18 开发线）。bootstrap 命令本身就是一次普通的 Node 调用，整条流程只需要 Node 与一个包管理器；早先的 Deno bootstrap 已随 2026-10-03 的 ADR-0161 修订被退役。

## 验证

成功的样子是：

- 脚手架为每个生成文件打印一行 `created <path>`，随后打印一个交接框，用当前包管理器的写法给出接下来的命令。
- `npm run dev` 打印 ready 行与本机 URL——默认是 `http://localhost:5173/`。
- 打开该 URL 能看到 starter 的首页：标题 “Rendered before JavaScript arrives”、静态徽标、一个可交互的计数器 island 以及一个纯客户端 live timer。页面此时已经带样式、可阅读；islands 在页面加载后自行唤醒。

如果在那之前出了问题：

| 现象 | 发生了什么 | 怎么办 |
| --- | --- | --- |
| `This CLI requires Node.js 24.2.0 or newer` | 宿主机的 `node` 低于支持下限 | 在 Node 24.2+ 上重跑同一条命令（项目的 `.node-version` 钉住 24.18 线）；先看 `node --version` |
| `npm run dev` 报端口被占用 | Vite 默认 5173，未要求严格模式时会自动改用下一个空闲端口 | 打开它打印的 `Local:` URL，或者显式钉住端口——npm：`npm run dev -- --port 5180 --strictPort`；pnpm/yarn：`pnpm run dev --port 5180 --strictPort`（换用第二个包管理器首次运行会重装依赖） |
| 安装步骤失败，或出现 `No package manager found` | 脚手架在安装之前就写完了全部项目文件；失败的是安装，不是脚手架 | 修好网络、registry 或 `PATH`，然后在项目里安装：`cd my-app && npm install`（或你的包管理器对应的同一条命令） |
| 离线或使用私有 registry 时安装失败 | 依赖安装是唯一访问 registry 的步骤 | 用生成器的 `--no-install` 旗标只做脚手架（经你的包管理器透传），等 registry 可达后再安装 |
| 你用 pnpm、yarn 或 bun | 脚手架用被调用时的管理器安装，否则按 pnpm/npm/yarn/bun 的顺序取 `PATH` 上第一个 | 继续用你的管理器——脚本与包管理器无关：`pnpm run dev`、`yarn dev`、`bun run dev` 都会到达同一个开发服务器 |

## 认识项目结构

脚手架写出一个小目录，每条路径只有一个职责：

```text
my-app/
  app/
    routes/          一个文件对应一个 URL——index.tsx（/）、about.tsx（/about）、
                     404.tsx、api/ping.ts（/api/ping）
    components/      编译后的页面元素，以及它们数组引用的 .css 表
    islands/         选择进入客户端投递的模块（my-counter、live-timer）
    layout.tsx       自动注册、包在每个页面外的站点外框
    head.tsx         结构性 <head> 条目——这里是 color-scheme meta
    styles/theme.css 每个 utility 都会读取的 @theme token 表
  public/            按原样复制进 dist/ 的静态资源
  openelement.config.ts  框架选项：Tailwind 入口、head、文件约定
  vite.config.ts     Vite 配置；插件调用保持裸调用
  tsconfig.json     应用的类型检查面
  package.json      依赖 + dev/build/start/test/fmt/lint/typecheck 脚本
  .node-version     项目钉住的 Node 线
```

站点还会写出 `README.md`、一份 `AGENTS.md` 代理入口与 `.gitignore`，并在目标不在既有仓库内时初始化 git 仓库。

一个 URL 就是一个文件：`app/routes/hello.tsx` 回答 `/hello`。标记不在路由文件里——它属于 `app/components/` 下的编译元素（很短的 server function 页面也可以直接写在路由里），共享外框只在 `app/layout.tsx` 里定义一次，只有 `app/islands/` 会把自己的代码选择进客户端投递这些文件背后的模型见[核心概念](/zh/guide/core-concepts)；路由契约见[路由与数据](/zh/guide/routing-and-data)。

## 写一个页面

新增一个 URL 需要两个文件：路由模块，以及拥有其标记的编译元素。

`app/components/page-hello.tsx`：

```tsx
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
    description: 'The first page of the tutorial app.',
  },
});
```

路由是一层绑定：类拥有标记，路由模块把它连同页面的 head 元数据交给 `definePage`，URL 由文件名拥有。开发服务器不用重启就会拾取这两个文件。

预期结果：打开 `http://localhost:5173/hello` 能看到该标题。查看页面源代码（或 `curl -s http://localhost:5173/hello | grep -o 'Hello from a page'`），标题就在服务器发出的 HTML 里——它不是由脚本注入的。这条路由本身没有引入 island，所以这个页面不携带自己的客户端模块。

## 添加一个自定义元素

第二个编译模块就是一个普通 Custom Element：用 `@element` 声明，给它一个 `@property`，再按标签宿主化。

`app/components/my-badge.tsx`：

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('my-badge', { root: 'light' })
export default class MyBadge extends OpenElement {
  @property({ reflect: false })
  label = 'new';

  render() {
    return <span class="badge">{this.label}</span>;
  }
}
```

把它宿主化进已有的页面——`app/components/page-hello.tsx` 变成：

```tsx
import { element, OpenElement } from '@openelement/element';
import './my-badge.tsx';

@element('hello-page', { root: 'light' })
export default class HelloPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>Hello from a page</h1>
        <p>This markup is server-rendered HTML, with no client JavaScript.</p>
        <my-badge label="hello"></my-badge>
      </main>
    );
  }
}
```

两条规则让这件事成立：页面模块导入了 badge 模块（`import './my-badge.tsx'`），于是路由导入链能到达它、构建会注册它的标签；宿主上的字面量 `label="hello"` 在服务端渲染时给 badge 的 `@property` 填入初值。

预期结果：`/hello` 现在包含 badge 的服务端渲染标记——`<my-badge>` 里是 `<span class="badge">hello</span>`。因为 badge 是页作用域组件而不是 island，它不携带客户端模块：浏览器永远不会升级它，标记本身就是产物。任何必须在浏览器中响应的东西都改用 island 形态——见 [Islands 与 SSR](/zh/guide/islands-and-ssr)。

## 构建与部署

```bash
npm run build  # 预渲染到 dist/（需要时另有 dist/client、dist/server）
npm start      # 起真实构建产物，包含请求时路由
```

`npm run build` 把可部署的站点产出到 `dist/`。对 starter 来说就是：

- `dist/index.html` 与 `dist/about/index.html`——静态路由的预渲染 HTML；
- `public/` 下的一切按原样复制（starter 的 `openelement-mark.svg`）；
- `dist/client/`——共享客户端入口，以及每个可达 island 一个 chunk，因为 starter 带 islands；
- `dist/island-manifests/`——每页一份 JSON，记录该页加载哪些 island、何时加载；
- `dist/server/`——请求时入口，因为 starter 的样式化 404 路由声明了 `renderIntent: { mode: 'dynamic' }`。

校验改动应该用 `npm start`：它起的是与生产一致的输出，并把动态路由与表单 POST 分派给生成的服务端入口。端口取自 `OPEN_ELEMENT_PORT`（回退到 `PORT`，默认 4173），host 取自 `OPEN_ELEMENT_HOST`。若构建产物没有请求时路由，router 命令还带一个纯静态模式——`openelement start --mode=preview`——它拒绝带服务端的构建，而不是悄悄把它藏起来。

部署时：构建没有产出 `dist/server/` 就把 `dist/` 上传到任意静态托管；产出了，就把静态文件连同指向 `dist/server/index.js` 的 Node/Workers 运行时一起部署。完整的输出契约——构建写了哪些文件、每个文件回答什么——见[部署](/zh/guide/deployment)。上线前，`npm run typecheck` 对应用做类型检查，`npm test` 运行 starter 的 `node --test` 测试——模板暂未附带测试文件，把 `*.test.ts` 放到要覆盖的代码旁即可；两者都已在 starter 的脚本里接好，无需额外配置。

## 继续深入

- [教程：你的第一个应用](/zh/guide/tutorial)——同一套流程的完整版：页面、island、表单 action、构建与伺服。
- [配置](/zh/guide/configuration)——塑造构建产物的选项文件、路由与中间件。
- [编译模块文法](/zh/guide/compiled-grammar)——编译器接受什么，什么会在构建期失败而不是在运行时回退。
- [路由与数据](/zh/guide/routing-and-data)——loader、action 与 props 投影器。
- [Islands 与 SSR](/zh/guide/islands-and-ssr)——投递方式如何声明，以及真正发往浏览器的是什么。
- [部署](/zh/guide/deployment)——输出契约与 Nitro 预设。
- [测试](/zh/guide/testing)——值得对构建产物运行的检查。

下面两节是供稍后查阅的参考材料：starter 自带的样式方案，以及只想用元素运行时的项目路径。本指南之外的产品全貌见[文档](/zh/docs)、[API 参考](/zh/reference)与[路线图](/zh/roadmap)。

## 样式与 Tailwind 预设

脚手架只有一种形态：Tailwind-ON——接好 preset 的 `vite.config.ts`、`app/styles/theme.css` 这张 `@theme` 角色表（语义角色落在 Tailwind 默认尺度上），以及精确的 `tailwindcss` / `@tailwindcss/vite` 开发依赖。没有旗标，也没有第二种模板：样式面不是脚手架变体。关掉 Tailwind 是项目内改动而不是一个旗标，而它由两种不同的改动组成。把 `tailwind` 指向你自己的样式表，仍然是选择 Tailwind：这个键就是选择引擎的地方，流水线照旧运行、照旧编译你声明的来源，组件用到的工具类依旧来自引擎——换的是 token 来源，不是编译器。删掉该键则整条流水线关闭（对 plan 来说 `false` 与缺省相同，除非某个被准入的包自己声明了 `openElement.tailwind` 需求）：不加载 peer，也不产出工具样式表。token 文件提供的是 CSS 自定义属性，不提供 starter 标记里已经写好的那些工具类，所以删掉该键的项目要么自己撰写这些样式，要么别在标记里用它们。那种模式下 `app/styles/tokens.css` 这条约定为文档提供 token——它不是编译器的替代品。

[样式](/zh/guide/styling)讲页面样式放在哪里、什么会跨越 shadow 边界；[配置](/zh/guide/configuration)记录 `tailwind` 这个键本身。

## 只把 element 当库用

脚手架是可选的。只想要组件运行时的项目需要装两个包——编译产物加载的运行时，以及构建期把 TSX 编译成 Part Program 的编译器：

```bash
npm install @openelement/element
npm install -D @openelement/compiler
```

两行都需要。`@openelement/element` 只依赖 `@openelement/protocol` 与 signals 内核，**不会**带上编译器：只执行第一行的话，拿到的是运行时，编译不出组件。编译器是构建期那一半，属于 `devDependencies`，下面那句 Vite 接缝就是从这里导入的。

- **Vite 项目**通过包的 Vite 接缝挂载编译器：`import { element } from '@openelement/compiler/vite'`，把 `element()` 加进 `plugins`。该插件在构建期把每个组件的 TSX `render()` 编译成 Part Program。任何运行该插件的宿主都可以——Router 的 Vite 构建，或一个纯 Vite 项目；编译器不属于运行时。
- **其他打包器**通过 `@openelement/compiler` 以编程方式驱动同一套编译器——即 Vite 插件自己调用的 TSX-to-Part-Program 内核——再把产物接进自己的流水线。
- **产物是标准 Custom Elements。** 编译后的组件就是一个用 `customElements.define` 注册的普通类，产出的 bundle 可以直接进任何页面或框架，无需内嵌运行时，也不需要再跑编译器：消费已编译的 bundle 就是在纯 HTML 里写一个 `<script type="module">`，两个包都不需要。这条消费路径每轮发布都会验证：打包产物验收用 `@openelement/element` 与 `@openelement/compiler` 两个 tarball 在无 Router、无脚手架的项目里构建一个组件，再从独立的纯 HTML 页面在三个浏览器里加载该 bundle（`tools/release/consumer-packaged-element.ts`）。
