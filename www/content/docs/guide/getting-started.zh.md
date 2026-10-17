---
title: '快速开始'
lede: 'OpenElement 是以 Web Components 为原生契约、static-first 的应用框架。从标准 Custom Elements、pages、routes 与按需升级开始，产出可部署的 Vite/Nitro 输出。'
order: 1
---

> {{SOURCE_LINE_NOTE}} registry 真值以 [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json) 为准，不提供从 0.x 的受支持迁移路径。

## 安装

四条命令跑起应用：

```bash
{{INSTALL_COMMAND}}
cd my-app
npm install
npm run dev
```

安装命令解析到的版本登记在 [`docs/release/release-state.json`](https://github.com/open-element/openelement/blob/main/docs/release/release-state.json)（仓库的 registry 核验真值）中：脚手架把 `@openelement/*` 的 caret 范围（以该版本为下限）写进生成的 `package.json`，不需要任何额外旗标，后续 `1.0.0` 预发布版本靠 `npm update` 到手。

脚手架只有一种形态：Tailwind-ON——接好 preset 的 `vite.config.ts`、`app/styles/theme.css` 这张 `@theme` 角色表（语义角色落在 Tailwind 默认尺度上），以及精确的 `tailwindcss` / `@tailwindcss/vite` 开发依赖。没有旗标，也没有第二种模板：样式面不是脚手架变体。关掉 Tailwind 是项目内改动而不是一个旗标，而它由两种不同的改动组成。把 `tailwind` 指向你自己的样式表，仍然是选择 Tailwind：这个键就是选择引擎的地方，流水线照旧运行、照旧编译你声明的来源，组件用到的工具类依旧来自引擎——换的是 token 来源，不是编译器。删掉该键则整条流水线关闭（对 plan 来说 `false` 与缺省相同，除非某个被准入的包自己声明了 `openElement.tailwind` 需求）：不加载 peer，也不产出工具样式表。token 文件提供的是 CSS 自定义属性，不提供 starter 标记里已经写好的那些工具类，所以删掉该键的项目要么自己撰写这些样式，要么别在标记里用它们。那种模式下 `app/styles/tokens.css` 这条约定为文档提供 token——它不是编译器的替代品。

> 生成的项目是纯 Node 应用（ADR-0161）：脚本由 Node.js 24.2+ 驱动，任何包管理器（npm、pnpm、yarn、bun）都能跑——Node 24.2 是打包产物 engines 声明、CI 实际运行过的验证下限（Router CLI 依赖 Node 24.2.0 引入的 `import.meta.main`；`.node-version` 钉住 24.18 开发线）。bootstrap 命令本身就是一次普通的 Node 调用，整条流程只需要 Node 与一个包管理器；早先的 Deno bootstrap 已随 2026-10-03 的 ADR-0161 修订被退役。

## 只要 element 当库用

脚手架是可选的。只想要组件运行时的项目需要装两个包——编译产物加载的运行时，以及构建期把 TSX 编译成 Part Program 的编译器：

```bash
npm install @openelement/element
npm install -D @openelement/compiler
```

两行都需要。`@openelement/element` 只依赖 `@openelement/protocol` 与 signals 内核，**不会**带上编译器：只执行第一行的话，拿到的是运行时，编译不出组件。编译器是构建期那一半，属于 `devDependencies`，下面那句 Vite 接缝就是从这里导入的。

- **Vite 项目**通过包的 Vite 接缝挂载编译器：`import { element } from '@openelement/compiler/vite'`，把 `element()` 加进 `plugins`。该插件在构建期把每个组件的 TSX `render()` 编译成 Part Program。任何运行该插件的宿主都可以——Router 的 Vite 构建，或一个纯 Vite 项目；编译器不属于运行时。
- **其他打包器**通过 `@openelement/compiler` 以编程方式驱动同一套编译器——即 Vite 插件自己调用的 TSX-to-Part-Program 内核——再把产物接进自己的流水线。
- **产物是标准 Custom Elements。** 编译后的组件就是一个用 `customElements.define` 注册的普通类，产出的 bundle 可以直接进任何页面或框架，无需内嵌运行时，也不需要再跑编译器：消费已编译的 bundle 就是在纯 HTML 里写一个 `<script type="module">`，两个包都不需要。这条消费路径每轮发布都会验证：打包产物验收用 `@openelement/element` 与 `@openelement/compiler` 两个 tarball 在无 Router、无脚手架的项目里构建一个组件，再从独立的纯 HTML 页面在三个浏览器里加载该 bundle（`tools/release/consumer-packaged-element.ts`）。

## 探索

阅读 [文档](/zh/docs)、[API 参考](/zh/reference) 与 [路线图](/zh/roadmap)，了解当前产品全貌。

## 构建

`npm run build` 把可部署的站点产出到 `dist/`——每条静态路由的预渲染 HTML、`public/` 下按原样复制的内容，以及应用含 island 或请求时路由时一并生成的客户端 chunk 与服务端入口。那个目录就是产物：可以上传到任意静态托管，或让 Node/Workers 部署指向 `dist/server/index.js`。

两个脚本覆盖构建与运行循环：

```bash
npm run build  # 预渲染到 dist/（需要时另有 dist/client、dist/server）
npm start      # 起真实构建产物，包含请求时路由
```

校验改动应该用 `npm start`：它起的是与生产一致的输出，并把动态路由与表单 POST 分派给生成的服务端入口。若构建产物没有请求时路由，router 命令还带一个纯静态模式——`openelement start --mode=preview`——它拒绝带服务端的构建，而不是悄悄把它藏起来。端口取自 `OPEN_ELEMENT_PORT`（回退到 `PORT`，默认 4173），host 取自 `OPEN_ELEMENT_HOST`。

上线前，`npm run typecheck` 对应用做类型检查，`npm test` 跑测试；两者都已在 starter 的脚本里接好，无需额外配置。完整的输出契约——构建写了哪些文件、每个文件回答什么——见[部署](/zh/guide/deployment)。

## 另见

- [核心概念](/zh/guide/core-concepts)——starter 文件背后的组件模型。
- [路由与数据](/zh/guide/routing-and-data)——页面、loader 与 action。
- [部署](/zh/guide/deployment)——`npm run build` 产出什么，以及如何验证。
