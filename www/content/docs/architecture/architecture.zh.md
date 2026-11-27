---
title: '当前架构'
lede: 'Web Components 原生、static-first 的框架：Custom Elements 是持久的契约，编译型 JSX 是创作模型，Vite 与 Nitro 是构建路径。'
order: 10
---

> 适用于 {{OPENELEMENT_VERSION}}。

## 包依赖图

依赖方向——使用方指向其依赖。

<figure class="diagram" aria-hidden="true"><svg viewBox="0 0 144 88" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="22" cy="20" r="9"/><circle cx="122" cy="20" r="9"/><circle cx="72" cy="74" r="9"/><path d="M31 26l29 9"/><path d="M113 26l-29 9"/><path d="M72 52v13"/><g style="color:var(--color-primary)"><circle cx="72" cy="40" r="12"/><circle cx="72" cy="40" r="3.5" fill="currentColor" stroke="none"/></g></svg></figure>

| 包                       | 角色                | 依赖                                                    |
| ------------------------ | ------------------- | ------------------------------------------------------- |
| `@openelement/protocol`  | 契约 · 零依赖       | —                                                       |
| `@openelement/element`   | 运行时              | 使用 `@openelement/protocol`                           |
| `@openelement/compiler`  | 构建期编译器        | 使用 `@openelement/protocol`；TypeScript 是唯一宿主依赖 |
| `@openelement/router`    | 页面 · 路由 · 构建  | 使用 `@openelement/element`、`@openelement/compiler`   |
| `@openelement/ui`        | 可选原语            | 可选 `@openelement/element`                             |
| `@openelement/create`    | starter · 构建期    | —                                                       |

## 深模块隐藏实现复杂度。

作者使用产品接口。renderer、router、signal、content
与构建期细节保持内部化，直到真实的变体需求证明需要公开接缝。

| 层          | 包                                            | 职责                                                                 |
| ----------- | --------------------------------------------- | -------------------------------------------------------------------- |
| contracts   | `@openelement/protocol`                       | 渲染、路由与诊断的共享契约。     |
| element     | `@openelement/element`                        | Custom Elements、JSX、DSD、hydration 与 signals 的统一创作界面。     |
| build       | `@openelement/compiler`                       | 将 TSX 编译为服务端渲染器和 Custom Element 生命周期函数。 |
| application | `@openelement/router`                         | 面向完整应用的页面、路由、islands、渲染语义与构建编排。               |
| output      | `@openelement/router`                         | Vite 集成、静态生成与可部署的 Nitro 输出，收敛在一个构建边界之内。   |
| adoption    | `@openelement/create`，可选 `@openelement/ui` | 脚手架和可选的基础组件。    |

## Web Components 就是应用架构。

路线图以兼容性证据、完整的应用闭环与可移植的运维能力扩展 WC
全栈范围——而不是靠不断增长的包数量。

### WC SSR

构建将已准入的组件分类为 DSD、light DOM 或仅客户端渲染。浏览器测试验证标准、Lit、FAST 与 Stencil 元素的升级行为。

### 应用闭环

路由、数据、渐进式表单、action、重定向与重新校验构成一个深的 App
接口，而不是一堆浅包。

### 可移植输出

Node 与 Workers
输出从打包后的公开产物验证。服务提供方自有的恢复路径由参考栈证明；框架自有
cache/recovery API 尚未分配版本，必须经过未来的决策记录。

## 当前真相由机器校验。

发布验证覆盖包导出、文档、可部署产物和浏览器中的应用行为。

| 门禁         | 要求                                                                                    |
| ------------ | --------------------------------------------------------------------------------------- |
| {{PACKAGE_COUNT}} 个包 | 当前消费面（protocol/element/compiler/router/create/ui）、starter 与文档保持一致。       |
| 输出切分     | 静态 HTML 与浏览器资源公开交付，请求时模块留在服务器。                      |
| 3 个浏览器   | 候选版本发布需要 Chromium、Firefox 与 WebKit 的验证。                                   |
| 打包产物验证 | 消费方从公开产物构建，而不是 workspace 别名。                                           |

## Package 兼容性

openElement 把第三方 Custom Elements 视为基于标准的依赖。当前构建通过显式的 package island 配置与可用的 Custom Elements Manifest metadata 完成 SSR 准入。

### 当前契约

Compiler 生成渲染器和生命周期函数，Element 提供 Custom Element 运行时，Router 负责应用行为与构建。

### 显式准入

已知包可配置为 package island，并利用可用的 CEM metadata。

### 当前诊断

构建报告 DSD、light DOM、仅客户端渲染的分类和 hydration 不匹配诊断。组件准入取决于 package-island 配置及该包可用的 metadata。

## 另见

- [openElement 对比主流框架](/zh/architecture#framework-comparison-and-measured-output)——这套架构的定位。
- [DSD 渲染](/zh/architecture/dsd)——这张图所依赖的平台标准契约。
- [核心概念](/zh/guide/core-concepts)——同一套模型在作者视角下的表述。

## Framework comparison and measured output

## 框架决策面

**openElement — WC 原生应用框架**

| 方面     | 描述                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 架构     | Custom Elements + Declarative Shadow DOM 是一等公民；标准 Custom Elements 即应用契约；Router 掌管路由与渲染；Vite 和 Nitro 是官方构建路径。                                               |
| 渲染     | 默认 SSG；DSD/shadow 为显式选择的一等模式（当前编译默认 light DOM），按需升级元素；无需交互时输出不含任何框架 JavaScript 的纯静态内容。                                                   |
| DX       | TSX 页面函数和编译器生成的 Custom Element，使用 `definePage`、`defineIslandConfig` 和 `buildApp`。                                                                                                                  |
| 适用     | 以 Web Components 为原生组件契约、static-first 的应用框架，用于以标准 Custom Element 契约交付 DSD-first 应用；当前范围是 static-first，而非与 Next.js、Nuxt 或 SvelteKit 的泛全栈对齐。   |
| 全栈路径 | openElement × Supabase × Cloudflare：openElement 负责应用 UX，Supabase 负责数据/Auth/RLS/Storage/Realtime，Cloudflare 负责边缘/安全/缓存/异步执行。它们是服务提供方，绝不是框架内建功能。 |

| 框架                                            | 架构                                                                     | 渲染                                                                 | DX                                                 | 锁定 / 适用                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Next.js** — React 元框架                      | 文件路由、React Server Components、app router、server action。           | SSR / SSG / ISR、RSC 流式渲染，client component 在客户端 hydration。 | React/JSX，生态庞大，在 Vercel 上是一等公民。      | React 运行时加 Next.js 抽象；与 Vercel 平台亲和。                                                        |
| **Nuxt** — Vue 元框架                           | 文件路由、Vue 单文件组件、Nitro 服务端引擎。                             | SSR / SSG / ISR、混合渲染、客户端 hydration。                        | Vue SFC、自动导入、约定驱动。                      | Vue 运行时加 Nuxt 与 Nitro 约定。                                                                        |
| **SvelteKit** — Svelte 元框架                   | 文件路由、Svelte 组件、Vite、基于 adapter 的部署。                       | SSR / SSG / CSR 与 hydration；编译式组件（Svelte 编译器）。                        | Svelte 编译器、语法简洁、运行时小。                | Svelte 编译器/运行时；部署 adapter 可替换（锁定程度低于 Next.js）。                                      |
| **Astro** — Islands / 内容引擎                  | 文件路由、多框架 island、内容集合。                                      | Static-first、island hydration、server island、View Transitions。    | `.astro` 组件、框架无关的 island、Markdown/MDX。   | 低——island 可以用任何框架；有少量 Astro 特有的组件语法。                                                 |
| **Fresh** — Deno + Preact                       | 文件路由、Preact island、Deno 原生框架。                         | SSR 加 Preact island；默认客户端 JavaScript 极少。                   | Preact/TypeScript 运行在 Deno 运行时；路由、渲染与客户端 bundling 由 Fresh 负责。 | Deno 运行时加 Preact；island 即 Preact 组件。                                                            |
| **Lit** — Web Components 基座                   | 带响应式属性的 Custom Elements 基类；应用路由被刻意留在组件模型之外。    | SSR 工具链（@lit-labs/ssr）；编写方式仍是 Lit 专有。                      | TypeScript、decorator、tagged-template 渲染。      | 低——纯标准 Web Components；自身不带框架。                                                                |
| **Enhance** — HTML-first 的 Web Components 全栈 | Custom Elements、文件路由与服务端 Custom Elements。                      | SSR 输出 Web Components、默认零 JS、渐进增强。                       | HTML-first、单文件组件、抽象极少。                 | 低——标准 Web Components；Enhance 只加 helper，不加运行时。                                               |
| **Stencil** — Web Components 编译器             | 输出标准 Web Components 的编译器；产物框架无关。                         | 客户端 Web Components，带预渲染；依赖 Stencil 编译器/运行时。              | TSX、decorator、面向设计系统的工具链。             | 产物是无锁定的 Web Components；编写时使用 Stencil 工具链。                                               |
| **FAST / Web Awesome** — 组件体系               | FAST 提供 Web Component 编写基础设施；Web Awesome 分发组件库与设计资产。 | —                                                                    | —                                                  | 当你的首要需求是组件体系时任选其一。openElement 并不替代成熟的设计系统，应作为围绕组件的应用框架来评估。 |

## 如何阅读本页

- **架构**——路由、组件与服务端如何组合。
- **渲染**——SSR/SSG/CSR 默认值、hydration 与 island 策略。
- **DX**——语言、工具链与学习曲线。
- **锁定**——你与专有运行时或平台的绑定程度，对照开放标准。

## 三组框架，三个不同的问题

- **Lit / FAST / Stencil** 是组件层，而不是同一个应用契约。它们编写或编译 Custom Elements，并把路由、数据与应用闭环留在其组件模型之外；openElement 在同一个标准之上构建应用契约，因此它们与之组合，而非竞争。
- **Astro / Fresh / Enhance** 是 static-first 或 HTML-first 的基线，但持久组件模型不同——框架专有的组件格式或绑定框架的 island。在 openElement 中，持久模型就是标准 Custom Element 本身，DSD 是显式声明的 shadow 模式的服务端表达（当前编译默认是 light DOM）。
- **Next / Remix / Nuxt / SvelteKit** 是更宽泛的、框架专有的全栈生态。openElement 不宣称与它们的泛全栈对等；它的全栈故事是与外部服务提供方显式、有证据支撑的组合。

## 决策标准

- 选择 **openElement** 当 Web Components 是对外集成面，且 SSR 输出需要保留浏览器原生的组件边界时。
- 选择 **Astro / Enhance / Lit / Stencil** 当标准优先的 Web Components 方案很重要，且想避开沉重的应用运行时时。
- 选择 **Next.js / Nuxt / SvelteKit** 当你的产品明确围绕 React、Vue 或 Svelte 应用模型构建时。
- 选择 **Fresh** 当你想要 Deno 原生的 Preact island 体验时。
- 不要选择 **openElement** 当主要诉求是成熟生态、框架专属 UI 运行时或现成的企业级设计系统时。评估 openElement 的团队仍应在自己的生产环境中验证 SaaS 消费方与部署路径。

## 官方组合路径

openElement × Supabase × Cloudflare 是第一方全栈交付路径，所有权边界明确：openElement 负责应用 UX；Supabase 负责数据、Auth、RLS、Storage 与 Realtime；Cloudflare 负责边缘交付、安全、缓存与异步执行。Supabase 与 Cloudflare 是被组合的服务提供方——绝不是框架内建功能——包图谱边界门禁保证服务提供方代码不进入框架包。

请在部署平台配置恢复与缓存。

- [第一方 SaaS 消费方](https://github.com/open-element/openelement/tree/main/apps/saas)

## 定位背后的证据

- Custom Elements 作为持久的应用契约——静态面与请求时应用闭环由当前架构文档描述。[当前架构](https://github.com/open-element/openelement/tree/main/docs/architecture)
- DSD-first SSR 与选择性升级，以及显式的外来 WC 准入——语料库把每个第三方库形态的观测 SSR 输出与准入钉为机器可读证据。[第三方 WC 互操作语料库](https://github.com/open-element/openelement/blob/main/tests/fixtures/web-component-interop/corpus.json)
- 浏览器与打包产物验证——候选版本需要 Chromium、Firefox 与 WebKit 证明，消费方从打包的公开产物构建。[发布工作流](https://github.com/open-element/openelement/blob/main/.github/workflows/autoflow-release.yml)
- 可组合的服务提供方栈，而不是框架自有的 Auth 或数据库包——由第一方 SaaS 消费方实现并通过单元测试；托管与部署的 qualification 仍待外部完成，消费方 README 记录着该 qualification 状态。[Supabase × Cloudflare SaaS](https://github.com/open-element/openelement/tree/main/apps/saas)

## 来源与评审范围

2026-10-29 依据各项目一手文档评审（逐条对照各项目当前文档复核；无法证实的措辞已收窄或删除）。这是一份决策指南，不是基准测试，也不是兼容性认证。

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

以下数字于 2026-11-27 量自文档站点自身的构建（`vp run site:build`）。静态产物总量是 `www/dist` 下所有常规文件的字节总和，含隐藏的构建元数据。本页及其搜索索引也在测量范围内，更新数字后重新构建可能相差几个字节。`check:doc-figures` 允许总量有 ±1% 的偏差，并精确验证页面、URL 和 manifest 的数量。

| 指标                  | 数值                                     |
| ------------------- | -------------------------------------- |
| 预渲染文档               | 66 个 HTML 文件                           |
| `sitemap.xml` URL 数 | 64                                     |
| 静态产物总量              | 13.6 MiB（14,221,788 B）                 |
| island manifest     | 66 份——每页一份                             |
| 搜索索引                | 每个语言 32 页（en、zh），64 个 fragment，1.6 MiB |

```bash
# 先重新生成以下全部内容。
vp run site:build
find www/dist -name '*.html' | wc -l  # 66
grep -o '<loc>' www/dist/sitemap.xml | wc -l  # 64
find www/dist -type f -exec wc -c {} + | awk '$NF != "total" { sum += $1 } END { print sum }'  # 14,221,788 B
find www/dist/island-manifests -name '*.json' | wc -l  # 66
cat www/dist/pagefind/pagefind-entry.json  # 每种语言 page_count 32
find www/dist/pagefind/fragment -type f | wc -l  # 64
find www/dist/pagefind -type f -exec wc -c {} + | awk '$NF != "total" { sum += $1 } END { print sum }'  # 1,708,345 B
```

### Island bundle

文档站点使用 openElement 构建。下表列出其 island chunk、搜索 combobox 运行时、共享入口和元素运行时的原始体积及 gzip 体积。

| Chunk                         | 原始字节    | gzip -9 |
| ----------------------------- | ------- | ------- |
| `element-runtime`             | 72,240  | 22,997  |
| `island-open-button`          | 14,114  | 3,262   |
| `island-open-code-block`      | 7,734   | 2,527   |
| `island-open-copy-button`     | 11,426  | 2,758   |
| `island-open-counter`         | 8,328   | 2,222   |
| `island-open-layer-strip`     | 3,770   | 1,618   |
| `island-open-page-rail`       | 35,951  | 7,504   |
| `island-open-registry-lookup` | 27,462  | 7,206   |
| `island-open-search`          | 84,238  | 16,636  |
| `island-open-site-menu`       | 6,149   | 2,283   |
| `island-open-source-toggle`   | 6,430   | 2,188   |
| `island-open-theme-toggle`    | 18,254  | 3,790   |
| `open-search-combobox`        | 108,612 | 35,531  |
| `client.js`                   | 10,306  | 2,990   |

```bash
for file in www/dist/client/islands/*.js; do
  printf '%s %s %s\n' "$file" "$(wc -c < "$file")" "$(gzip -9 -c "$file" | wc -c)"
done
```

编译元素的共享运行时单独成块。搜索首次打开时才加载 combobox 运行时。组件样式表单独输出到 `client/assets/`（ADR-0164）。数字校验允许原始体积有 ±1% 的偏差，gzip 体积有 ±3% 的偏差。

每条路由的载荷包括其 island manifest 列出的所有 chunk、共享客户端入口，以及这些文件的传递静态导入。每个 island 何时加载由其水合策略决定。

| 路由                       | 客户端载荷（原始） | 不同 chunk 数 |
| ------------------------ | --------- | ---------- |
| `/guide/mdx`             | 236,233 B | 9          |
| `/guide/getting-started` | 236,233 B | 9          |
| `/`                      | 266,187 B | 13         |

66 份页面 manifest 合计声明了 11 个 island 标签、318 条记录。`open-search`、`open-site-menu` 和 `open-theme-toggle` 出现在每一页，`open-page-rail` 出现在 52 页，`open-code-block` 出现在 46 页，`open-button` 出现在 8 页。`open-copy-button` 出现在两种语言的首页和贡献指南，`open-registry-lookup` 出现在两种语言的错误参考和 API 参考。`open-counter`、`open-layer-strip` 和 `open-source-toggle` 出现在两种语言的首页。

```bash
node --input-type=module <<'JS'
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { clientImportGraph, payloadClosure } from './tools/release/payload-closure.ts';

const dist = 'www/dist';
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const manifestDir = `${dist}/island-manifests`;
const manifests = readdirSync(manifestDir).map((file) => readJson(`${manifestDir}/${file}`));
const graph = clientImportGraph(readJson(`${dist}/client/.vite/manifest.json`));

for (const route of ['/guide/mdx', '/guide/getting-started', '/']) {
  const { islands } = manifests.find((manifest) => manifest.route === route);
  const chunks = payloadClosure(graph, ['/client/islands/client.js', ...islands.map((island) => island.chunkUrl)]);
  const bytes = [...chunks].reduce((sum, url) => sum + statSync(dist + url).size, 0);
  console.log(route, bytes, chunks.size);
}
JS
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
