---
title: 'openElement 对比主流框架'
lede: '一份保守的产品方向对比。本页描述每个框架的优化目标，不编造 benchmark 数据。用它判断适配度，而不是给速度排名。'
navLabel: '框架对比'
order: 20
---

## 框架决策面

**openElement — WC 原生应用框架**

| 方面     | 描述                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 架构     | Custom Elements + Declarative Shadow DOM 是一等公民；标准 Custom Elements 即应用契约；Router 掌管路由与渲染；Vite 和 Nitro 是官方构建路径。                                               |
| 渲染     | 默认 SSG；DSD/shadow 为显式选择的一等模式（当前编译默认 light DOM），按需升级元素；无需交互时输出不含任何框架 JavaScript 的纯静态内容。                                                   |
| DX       | JSX + 编译型 Custom Element 类，`@element` / `definePage` / `buildApp`。                                                                                                                  |
| 适用     | 以 Web Components 为原生组件契约、static-first 的应用框架，用于以标准 Custom Element 契约交付 DSD-first 应用；当前范围是 static-first，而非与 Next.js、Nuxt 或 SvelteKit 的泛全栈对齐。   |
| 全栈路径 | OpenElement × Supabase × Cloudflare：OpenElement 负责应用 UX，Supabase 负责数据/Auth/RLS/Storage/Realtime，Cloudflare 负责边缘/安全/缓存/异步执行。它们是服务提供方，绝不是框架内建功能。 |

| 框架                                            | 架构                                                                     | 渲染                                                                 | DX                                                 | 锁定 / 适用                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Next.js** — React 元框架                      | 文件路由、React Server Components、app router、server action。           | SSR / SSG / ISR、RSC 流式渲染，client component 在客户端 hydration。 | React/JSX，生态庞大，在 Vercel 上是一等公民。      | React 运行时加 Next.js 抽象；与 Vercel 平台亲和。                                                        |
| **Nuxt** — Vue 元框架                           | 文件路由、Vue 单文件组件、Nitro 服务端引擎。                             | SSR / SSG / ISR、混合渲染、客户端 hydration。                        | Vue SFC、自动导入、约定驱动。                      | Vue 运行时加 Nuxt 与 Nitro 约定。                                                                        |
| **SvelteKit** — Svelte 元框架                   | 文件路由、Svelte 组件、Vite、基于 adapter 的部署。                       | SSR / SSG / CSR、渐进 hydration、无虚拟 DOM。                        | Svelte 编译器、语法简洁、运行时小。                | Svelte 编译器/运行时；部署 adapter 可替换（锁定程度低于 Next.js）。                                      |
| **Astro** — Islands / 内容引擎                  | 文件路由、多框架 island、内容集合。                                      | Static-first、island hydration、server island、View Transitions。    | `.astro` 组件、框架无关的 island、Markdown/MDX。   | 低——island 可以用任何框架；有少量 Astro 特有的组件语法。                                                 |
| **Fresh** — Deno + Preact                       | 文件路由、Preact island、Deno 原生、零构建步骤。                         | SSR 加 Preact island；默认客户端 JavaScript 极少。                   | Preact/TypeScript、Deno 运行时、无需配置 bundler。 | Deno 运行时加 Preact；island 即 Preact 组件。                                                            |
| **Lit** — Web Components 基座                   | 带响应式属性的 Custom Elements 基类；应用路由被刻意留在组件模型之外。    | Lit 提供 SSR 工具链，但有服务端特有的编写约束。                      | TypeScript、decorator、tagged-template 渲染。      | 低——纯标准 Web Components；自身不带框架。                                                                |
| **Enhance** — HTML-first 的 Web Components 全栈 | Custom Elements、文件路由与服务端 Custom Elements。                      | SSR 输出 Web Components、默认零 JS、渐进增强。                       | HTML-first、单文件组件、抽象极少。                 | 低——标准 Web Components；Enhance 只加 helper，不加运行时。                                               |
| **Stencil** — Web Components 编译器             | 输出标准 Web Components 的编译器；产物框架无关。                         | 客户端 Web Components，带预渲染、懒加载和内部虚拟 DOM。              | TSX、decorator、面向设计系统的工具链。             | 产物是无锁定的 Web Components；编写时使用 Stencil 工具链。                                               |
| **FAST / Web Awesome** — 组件体系               | FAST 提供 Web Component 编写基础设施；Web Awesome 分发组件库与设计资产。 | —                                                                    | —                                                  | 当你的首要需求是组件体系时任选其一。openElement 并不替代成熟的设计系统，应作为围绕组件的应用框架来评估。 |

## 如何阅读本页

- **架构**——路由、组件与服务端如何组合。
- **渲染**——SSR/SSG/CSR 默认值、hydration 与 island 策略。
- **DX**——语言、工具链与学习曲线。
- **锁定**——你与专有运行时或平台的绑定程度，对照开放标准。

## 三组框架，三个不同的问题

- **Lit / FAST / Stencil** 是组件层，而不是同一个应用契约。它们编写或编译 Custom Elements，并刻意把路由、数据与应用闭环留在自身模型之外；openElement 在同一个标准之上构建应用契约，因此它们与之组合，而非竞争。
- **Astro / Fresh / Enhance** 是 static-first 或 HTML-first 的基线，但持久组件模型不同——框架专有的组件格式或绑定框架的 island。在 openElement 中，持久模型就是标准 Custom Element 本身，DSD 是默认服务端表示。
- **Next / Remix / Nuxt / SvelteKit** 是更宽泛的、框架专有的全栈生态。openElement 不宣称与它们的泛全栈对等；它的全栈故事是与外部服务提供方显式、有证据支撑的组合。

## 决策标准

- 选择 **openElement** 当 Web Components 是对外集成面，且 SSR 输出需要保留浏览器原生的组件边界时。
- 选择 **Astro / Enhance / Lit / Stencil** 当标准优先的 Web Components 方案很重要，且想避开沉重的应用运行时时。
- 选择 **Next.js / Nuxt / SvelteKit** 当你的产品明确围绕 React、Vue 或 Svelte 应用模型构建时。
- 选择 **Fresh** 当你想要 Deno 原生、近乎零构建的 Preact island 体验时。
- 不要选择 **openElement** 当主要诉求是成熟生态、框架专属 UI 运行时或现成的企业级设计系统时。评估 openElement 的团队仍应在自己的生产环境中验证 SaaS 消费方与部署路径。

## 官方组合路径

OpenElement × Supabase × Cloudflare 是经过验证的全栈交付路径，所有权边界明确：OpenElement 负责应用 UX；Supabase 负责数据、Auth、RLS、Storage 与 Realtime；Cloudflare 负责边缘交付、安全、缓存与异步执行。Supabase 与 Cloudflare 是被组合的服务提供方——绝不是框架内建功能——包图谱边界门禁保证服务提供方代码不进入框架包。

最初随 0.43 线与 Universal WC SSR 一同交付，并由当前编译型版本线继承。框架自有的生产运行时恢复与缓存语义仍在当前契约之外，尚未分配发布版本。

- [已验证的 SaaS 消费方](https://github.com/open-element/openelement/tree/main/apps/saas)

## 定位背后的证据

- Custom Elements 作为持久的应用契约——静态面与请求时应用闭环由当前架构文档描述。[当前架构](https://github.com/open-element/openelement/tree/main/docs/architecture)
- DSD-first SSR 与选择性升级，以及显式的外来 WC 准入——语料库把每个第三方库形态的观测 SSR 输出与准入钉为机器可读证据。[第三方 WC 互操作语料库](https://github.com/open-element/openelement/blob/main/tests/fixtures/web-component-interop/corpus.json)
- 浏览器与打包产物验证——候选版本需要 Chromium、Firefox 与 WebKit 证明，消费方从打包的公开产物构建。[发布流程](https://github.com/open-element/openelement/blob/main/docs/maintainers/releasing.md)
- 可组合的服务提供方栈，而不是框架自有的 Auth 或数据库包——由第一方 SaaS 消费方端到端验证。[Supabase × Cloudflare SaaS](https://github.com/open-element/openelement/tree/main/apps/saas)

## 来源与评审范围

2026-08-16 依据各项目一手文档评审。这是一份决策指南，不是基准测试，也不是兼容性认证。

- [Lit 文档](https://lit.dev/docs/)
- [Stencil 文档](https://stenciljs.com/docs/introduction)
- [FAST 文档](https://www.fast.design/docs/fast-element/getting-started)
- [Enhance 文档](https://enhance.dev/docs/)
- [Astro islands 文档](https://docs.astro.build/en/concepts/islands/)
- [Fresh 文档](https://docs.deno.com/runtime/frameworks/fresh/)
- [Web Awesome 文档](https://webawesome.com/docs/)

## 实测输出

我们测量什么，以及复现每一行的命令。

### 产物体积

以下数字于 2026-09-21 量自 docs 站点自身的构建（`www/dist`，由 `deno task site:build` 生成）。下列命令可复现每一行；页面数与 URL 数随路由集合变化，内容变更后请重跑。这些数字最近一次变动是因为生成的 `/errors` 路由落地（#1413）：每个语言各多一页，加上随共享 compiled-runtime chunk 一起发布的运行时错误文案。

| 指标                 | 数值                                             |
| -------------------- | ------------------------------------------------ |
| 预渲染文档           | 64 个 HTML 文件                                  |
| `sitemap.xml` URL 数 | 62                                               |
| 静态产物总量         | 7.8 MB                                           |
| island manifest      | 64 份——每页一份                                  |
| 搜索索引             | 每个语言 31 页（en、zh），62 个 fragment，1.2 MB |

```bash
deno task site:build                        # 先重新生成以下全部内容
find www/dist -name '*.html' | wc -l        # 64
grep -c '<loc>' www/dist/sitemap.xml        # 62
du -sh www/dist                             # 7.8M
ls www/dist/island-manifests | wc -l        # 64
cat www/dist/pagefind/pagefind-entry.json   # 每种语言 page_count 31
```

### Island bundle

docs 站点就是一个普通的 openElement 应用（同样有 island），所以它的客户端产物是有代表性的样本。以下是全部产出的 chunk 的原始体积与 gzip 体积：

| Chunk                          | 原始字节 | gzip -9 |
| ------------------------------ | -------- | ------- |
| `island-open-layout`           | 102,042  | 17,702  |
| `island-open-cinematic-scroll` | 80,347   | 25,215  |
| `open-button`                  | 16,320   | 3,132   |
| `island-open-dragon-live-gaze` | 14,161   | 5,170   |
| `island-open-page-rail`        | 9,684    | 2,747   |
| `open-code-block`              | 8,471    | 2,813   |
| `island-open-hero-polish`      | 4,436    | 1,851   |
| `open-badge`                   | 4,010    | 1,140   |

```bash
ls -l www/dist/client/islands/*.js
gzip -9 -c www/dist/client/islands/client.js | wc -c
```

共享入口（`client.js`，约 7 KB）有意不定死：它在错误串里内嵌了 checkout 绝对路径，字节随 checkout 深度变化。下面的路由载荷同理容忍 ±1%；逐 chunk 行保持精确。

页面实际下载什么，由它自己的 island manifest 决定，而不是由总量决定：

| 路由                     | 客户端载荷（原始） | 不同 chunk 数 |
| ------------------------ | ------------------ | ------------- |
| `/guide/mdx`             | 126,948 B          | 4             |
| `/guide/getting-started` | 126,948 B          | 4             |
| `/`                      | 217,362 B          | 6             |

64 份页面 manifest 合计声明了 10 个 island 标签、304 条记录：外壳 island（`open-layout`、`open-search`、`open-theme-toggle`）出现在每一页，`open-page-rail` 出现在 54 页，`open-code-block` 出现在 42 页，其余标签只在少数页面上。

```bash
cat www/dist/island-manifests/page-<hash>.json   # 单页的 island 集合：标签、chunk、策略、层级
python3 -c "import json,glob,collections; print(collections.Counter(t for f in glob.glob('www/dist/island-manifests/*.json') for t in (i['tagName'] for i in json.load(open(f))['islands'])))"
```

没有 island、也没有增强表单的项目完全不产出客户端入口：DSD 组件不需要框架的虚拟 DOM 运行时，因此纯静态页面保持无脚本。

### 渲染

| 指标        | 行为                                                                                |
| ----------- | ----------------------------------------------------------------------------------- |
| DSD SSR     | 组件序列化为 Declarative Shadow DOM；浏览器原生解析 shadow root，没有脚本解析成本。 |
| Island 水合 | 按组件粒度，由其声明的策略门控（`load` / `idle` / `visible` / `only`）。            |
| 导航        | 浏览器原生导航；View Transitions 与 Speculation Rules 均为可选。                    |
| 强制运行时  | 没有。客户端 JavaScript 只存在于模块声明了 island、或表单选择增强的地方。           |

## 另见

- [当前架构](/zh/architecture)——这份对比所引用的包依赖图，以及它准入的 package 兼容契约。
- [核心概念](/zh/guide/core-concepts)——这一立场背后的创作模型。
- [Island Hydration](/zh/architecture/islands)——四层组件模型及其策略。
- [Design System](/zh/architecture/design-system)——本站样式与 token 的构成。
