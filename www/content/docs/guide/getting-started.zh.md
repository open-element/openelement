---
title: '快速开始'
lede: 'OpenElement 是以 Web Components 为原生契约、static-first 的应用框架：标准 Custom Elements、pages、routes、按需升级，以及 Vite/Nitro 输出。'
order: 1
---

> {{SOURCE_LINE_NOTE}}

本页演示如何创建并验证项目、添加页面和元素，以及构建生产产物。

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

脚手架使用 npm `latest` 标签对应的版本。可在[发布状态](/zh/changelog)查看当前 npm 版本和源码预览版本。生成项目的生命周期脚本支持 npm、pnpm、yarn 或 bun。

## 验证

成功的样子是：

- 脚手架为每个生成文件打印一行 `created <path>`，随后打印一个交接框，用当前包管理器的写法给出接下来的命令。
- `npm run dev` 打印 ready 行与本机 URL——默认是 `http://localhost:5173/`。
- 打开该 URL 并试用计数器。计时器会在浏览器里启动。编辑 `app/routes/index.tsx` 的标题并保存，即可看到首页更新。

如果在那之前出了问题：

| 现象 | 发生了什么 | 怎么办 |
| --- | --- | --- |
| `This CLI requires Node.js 24.2.0 or newer` | 宿主机的 `node` 低于支持下限 | 在 Node 24.2+ 上重跑同一条命令（项目的 `.node-version` 钉住 24.18 线）；先看 `node --version` |
| `npm run dev` 报端口被占用 | Vite 默认 5173，未要求严格模式时会自动改用下一个空闲端口 | 打开它打印的 `Local:` URL，或者显式钉住端口——npm：`npm run dev -- --port 5180 --strictPort`；pnpm/yarn：`pnpm run dev --port 5180 --strictPort`（换用第二个包管理器首次运行会重装依赖） |
| 安装步骤失败，或出现 `No package manager found` | 脚手架在安装之前就写完了全部项目文件；失败的是安装，不是脚手架 | 修好网络、registry 或 `PATH`，然后在项目里安装：`cd my-app && npm install`（或你的包管理器对应的同一条命令） |
| 离线或使用私有 registry 时安装失败 | 依赖安装是唯一访问 registry 的步骤 | 用生成器的 `--no-install` 旗标只做脚手架（经你的包管理器透传），等 registry 可达后再安装 |
| 你用 pnpm、yarn 或 bun | 脚手架用被调用时的管理器安装，否则按 pnpm/npm/yarn/bun 的顺序取 `PATH` 上第一个 | 继续用你的管理器——脚本与包管理器无关：`pnpm run dev`、`yarn dev`、`bun run dev` 都会到达同一个开发服务器 |

[预览当前源码](https://github.com/open-element/openelement/blob/main/README.zh.md#预览当前源码)中的步骤会生成可运行下文示例的项目。

## 认识项目结构

脚手架写出一个小目录，每条路径只有一个职责：

```text
my-app/
  app/
    routes/          一个文件对应一个 URL——index.tsx（/）、about.tsx（/about）、
                     404.tsx、api/ping.ts（/api/ping）
    (components/     添加页面作用域组件的地方)
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

一个 URL 就是一个文件：`app/routes/hello.tsx` 回答 `/hello`。以静态文本为主的页面，由路由模块自己声明组件并包进 `definePage`；标记属于 `app/components/` 下自己那份组件模块的页面，则改为导入那个组件。共享外框只在 `app/layout.tsx` 里定义一次，只有 `app/islands/` 会把自己的代码选择进客户端投递。这些文件背后的模型见[核心概念](/zh/guide/core-concepts)；路由契约见[路由与数据](/zh/guide/routing-and-data)。

## 写一个页面

新增一个 URL 就是一个文件。渲染静态文本、不带任何客户端行为的页面是一个**服务端函数页**：路由模块自己导出组件，并用 `definePage` 把它包起来。

`app/routes/hello.tsx`：

```tsx
import { definePage } from '@openelement/router';

export const loader = async () => ({ title: 'Hello from a page' });

export function HelloPage(props: { title: string }) {
  return (
    <main>
      <h1>{props.title}</h1>
      <p>This markup is server-rendered HTML, with no client JavaScript.</p>
    </main>
  );
}

export default definePage(HelloPage, {
  head: {
    title: 'Hello — my-app',
    description: 'The first page of the tutorial app.',
  },
});
```

组件就是模块自己导出的那个函数，按标识符传给 `definePage`，而 URL 由文件名拥有。编译器把它降级为一个生成式 HTML 构造器，所以这个页面在构造上就是纯服务端的：该页面函数本身不产生客户端 JavaScript。开发服务器不用重启就会拾取该文件。

预期结果：打开 `http://localhost:5173/hello` 能看到该标题。查看页面源代码（或 `curl -s http://localhost:5173/hello | grep -o 'Hello from a page'`），标题就在服务器发出的 HTML 里——它不是由脚本注入的。这条路由本身没有引入 island，所以这个页面不携带自己的客户端模块。

## 添加一个自定义元素

第二个模块就是一个普通 Custom Element：一个函数组件，旁边配一份 `defineIslandConfig` sidecar，钉住它的标签、root 与属性。

`app/components/my-badge.tsx`：

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'my-badge',
  // light root 渲染进文档，因此页面自己的样式能抵达 badge 的子节点，
  // 中间没有 shadow 边界。
  root: 'light',
  // 页作用域：服务端渲染这个组件，浏览器从不 upgrade 它，
  // 所以它没有对应的 chunk。
  hydrate: 'none',
  ssr: true,
  properties: { label: { default: 'new' } },
});

export default function MyBadge(props: { label: string }) {
  return <span class='badge'>{props.label}</span>;
}
```

把它宿主化进已有的页面——`app/routes/hello.tsx` 变成：

```tsx
import { definePage } from '@openelement/router';
// 副作用导入让标签在路由导入链上完成注册——构建正是通过这条链
// 得知这个页面能到达该组件。
import '../components/my-badge.tsx';

export const loader = async () => ({ title: 'Hello from a page' });

export function HelloPage(props: { title: string }) {
  return (
    <main>
      <h1>{props.title}</h1>
      <p>This markup is server-rendered HTML, with no client JavaScript.</p>
      <my-badge label='hello'></my-badge>
    </main>
  );
}

export default definePage(HelloPage, { head: { title: 'Hello — my-app' } });
```

两条规则让这件事成立：页面模块导入了 badge 模块（`import '../components/my-badge.tsx'`），于是路由导入链能到达它、构建会注册它的标签；宿主上的字面量 `label='hello'` 在服务端渲染期间给那个声明过的属性填入种子值。

预期结果：`/hello` 现在包含 badge 的服务端渲染标记——`<my-badge>` 里是 `<span class="badge">hello</span>`。因为 badge 声明了 `hydrate: 'none'`，它不携带客户端模块：浏览器永远不会 upgrade 它，标记本身就是产物。任何必须在浏览器中响应的东西都改用 island 投递策略——见 [Islands 与 SSR](/zh/guide/islands-and-ssr)。

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

部署时：构建没有产出 `dist/server/` 就把 `dist/` 上传到任意静态托管；产出了，就把静态文件连同指向 `dist/server/index.js` 的 Node/Workers 运行时一起部署。完整的输出契约——构建写了哪些文件、每个文件回答什么——见[部署](/zh/guide/deployment)。上线前，`npm run typecheck` 对应用做类型检查，`npm test` 运行 starter 的 `node --test` 测试——源码预览包含用于检查 `/api/ping` 响应的测试。可在 `tests/` 下添加更多 `*.test.ts` 文件。两条命令都已在 starter 的脚本中配置好。

## 继续深入

- [教程：你的第一个应用](/zh/guide/tutorial)——同一套流程的完整版：页面、island、表单 action、构建与伺服。
- [配置](/zh/guide/configuration)——塑造构建产物的选项文件、路由与中间件。
- [编译模块文法](/zh/guide/compiled-grammar)——编译器承认什么，以及什么会在构建期失败而不是在运行时回退。
- [路由与数据](/zh/guide/routing-and-data)——loader、action 与 props 投影器。
- [Islands 与 SSR](/zh/guide/islands-and-ssr)——投递方式如何声明，以及真正发往浏览器的是什么。
- [部署](/zh/guide/deployment)——输出契约与 Nitro 预设。
- [测试](/zh/guide/testing)——值得对构建产物运行的检查。

下面两节是供稍后查阅的参考材料：starter 自带的样式方案，以及只想用元素运行时的项目路径。本指南之外的产品全貌见[文档](/zh/docs)、[API 参考](/zh/reference)与[路线图](/zh/roadmap)。

## 样式与 Tailwind 预设

脚手架只有一种形态：Tailwind-ON——接好 preset 的 `vite.config.ts`、`app/styles/theme.css` 这张 `@theme` 角色表（语义角色落在 Tailwind 默认尺度上），以及精确的 `tailwindcss` / `@tailwindcss/vite` 开发依赖。没有旗标，也没有第二种模板：样式面不是脚手架变体。关掉 Tailwind 是项目内改动而不是一个旗标，而它由两种不同的改动组成。把 `tailwind` 指向你自己的样式表，仍然是选择 Tailwind：这个键就是选择引擎的地方，流水线照旧运行、照旧编译你声明的来源，组件用到的工具类依旧来自引擎——换的是 token 来源，不是编译器。删掉该键则整条流水线关闭（对 plan 来说 `false` 与缺省相同，除非某个被准入的包自己声明了 `openElement.tailwind` 需求）：不加载 peer，也不产出工具样式表。token 文件提供的是 CSS 自定义属性，不提供 starter 标记里已经写好的那些工具类，所以删掉该键的项目要么自己撰写这些样式，要么别在标记里用它们。那种模式下 `app/styles/tokens.css` 这条约定为文档提供 token——它不是编译器的替代品。

[样式](/zh/guide/styling)讲页面样式放在哪里、什么会跨越 shadow 边界；[配置](/zh/guide/configuration)记录 `tailwind` 这个键本身。

## 只把 element 当库用

脚手架是可选的。只想要组件运行时的项目需要装两个包——编译后的组件所加载的运行时，以及构建期把 TSX 变成生成式自定义元素的编译器：

```bash
npm install @openelement/element
npm install -D @openelement/compiler
```

两行都需要。`@openelement/element` 只依赖 `@openelement/protocol` 与 signals 内核，别的都不依赖，所以它**不会**带上编译器：只执行第一行的话，拿到的是运行时，编译不出组件。编译器是构建期那一半，属于 `devDependencies`，下面那句 Vite 接缝就是从这里导入的。

- **Vite 项目**通过包的 Vite 接缝挂载编译器：`import { element } from '@openelement/compiler/vite'`，把 `element()` 加进 `plugins`。该插件在构建期把每个组件模块——函数组件与它的 sidecar——编译成一个 Native Custom Element。任何运行该插件的宿主都可以——Router 的 Vite 构建，或一个纯 Vite 项目；编译器不属于运行时。
- **其他打包器**通过 `@openelement/compiler` 以编程方式驱动同一套编译器——即 Vite 插件自己调用的那个 TSX 到元素的编译内核——再把产物接进自己的流水线。
- **产物是标准 Custom Elements。** 编译后的组件就是一个普通构造器，模块把它作为默认导出注册，所以产出的 bundle 可以直接进任何页面或框架，无需内嵌运行时，也不需要再跑编译器：消费已编译的 bundle 就是在纯 HTML 里写一个 `<script type="module">`，两个包都不需要。这条消费路径每轮发布都会验证：打包产物验收用 `@openelement/element` 与 `@openelement/compiler` 两个 tarball 在无 Router、无脚手架的项目里构建一个组件，再从独立的纯 HTML 页面在三个浏览器里加载该 bundle（`tools/release/consumer-packaged-element.ts`）。
