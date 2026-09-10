# openElement

[English](./README.md) | 简体中文

**OpenElement 是以 Web Components 为原生组件契约、static-first 的应用框架，
用于以标准 Custom Element 契约交付 DSD-first 应用。** Custom Elements 是可
长期保存的应用组件模型；JSX 与 Basic Element 是作者层；Declarative Shadow
DOM 是默认服务端表示；交互区域按需升级。

源码包行为 `0.44.0-beta.2.1`（`v0.44.0-beta.2.1`）——当前公开 v0.44 预发布线
（Beta.2.1：Router 地基与独立 Element，ADR-0152）。
npm registry 行为 `v0.44.0-beta.2.1`——预发布版本(dist-tag `beta`)；npm `latest` 仍为
已发布的稳定 0.43 线。

已确认的核心产品是 **Element / Router**，UI 用作 dogfood 和参考实现，不是第三条核心产品线。Route Mode 接受显式路由记录，
Framework Mode 默认由文件路由生成记录，两者共用内核。自维护 URLPatternList
是核心技术资产；每次替换同步清理旧实现。下一步为 Beta.2.1–Beta.2.3，验收后
进入公开 `1.0.0-alpha.1`。详见[产品边界](docs/architecture/product-model.md)和
[路线图](docs/roadmap/ROADMAP.md)；以下包图描述当前已发布能力。

## 当前产品

```text
OpenElement = Web Components-native fullstack application framework
current proven scope = static-first applications with fullstack output paths
official build path = Vite + Nitro
```

当前消费者包图为五包：

| 包                          | 角色                                                           |
| --------------------------- | -------------------------------------------------------------- |
| `@openelement/element`      | JSX、Custom Elements、DSD、hydration、signals 与组件运行时契约 |
| `@openelement/app`          | 页面、路由、loaders、actions、islands 与规范化 request 语义    |
| `@openelement/adapter-vite` | Vite、content、SSG、生成数据、Hono 与 Nitro 构建/部署实现      |
| `@openelement/create`       | 版本一致的 starter 生成与消费者生命周期                        |
| `@openelement/ui`           | 可选、可复用、经 dogfood 验证的 Web Component primitives       |

（角色措辞以 `docs/current/STACK_CONTRACT.md` 为唯一权威。）

旧的 `core`、`signal`、`router`、`protocol`、`content` 与 `ssg` 是实现历史，
不再是受支持的消费者导入。

## 为什么使用 openElement

当一个标准 Custom Element 应同时服务于独立组件库和完整应用时，OpenElement
提供统一契约。它把原生元素作者体验、路由、静态生成、DSD、选择性升级和可部署
输出组合在一起，而不把某个框架专有 virtual DOM 变成长期 UI 模型。

“WC 全栈第一”是明确的战略目标，必须通过
[WC SSR 兼容性证据](./docs/evidence/third-party-wc-ssr-corpus.json)、
第三方元素互操作、可移植部署与外部采用来证明；当前不将其表述为已取得的市场结论。

## 全栈组合路径

官方全栈交付路径是 OpenElement × Supabase × Cloudflare，所有权边界明确：
OpenElement 负责应用 UX；Supabase 负责数据、Auth、RLS、Storage 与
Realtime；Cloudflare 负责边缘交付、安全、缓存与异步执行。Supabase 与
Cloudflare 是被组合的服务提供方，不是框架内建功能。

证据：[Supabase 配方](./docs/integrations/supabase.md)、已验证的
[参考应用](./examples/supabase-cloudflare-starter/)、
[tier-1 边界门禁](./tools/check-fullstack-boundary.ts)、
[真实项目验证工作流](./.github/workflows/supabase-project-smoke.yml)与
[真实 Workers 部署冒烟](./.github/workflows/fullstack-deploy-smoke.yml)
（绿色运行
[31925944647](https://github.com/open-element/openelement/actions/runs/31925944647)），
构建于 [ADR-0129](./docs/adr/ADR-0129-response-header-channel.md)
响应头通道之上。已稳定交付范围是 0.43 线与 Universal WC SSR。ADR-0143
已开启 0.44 编译型 Element 架构列车；框架自有生产运行时恢复与缓存语义仍不属于该列车。

## 当前发布状态

五包收敛已作为 stable `0.43.3` 发布：它在 ADR-0135 Universal WC SSR 与
`0.43.2`/`0.43.1` 累计维护基线之上，让渲染方所有的 light DOM 在 SSR 升级时
原地水合（ADR-0142），并以可复现的逐案证据闭环鲁棒性对抗审计，继续处于 ADR-0140 规定的
0.43.x patch-only 维护模式。npm beta.1
至 beta.3 仍是已撤回的不完整历史产物，不构成兼容基线。第三轮审计清扫于 alpha.19 完成（ADR-0118），
#390 试点在零招募后由 maintainer 决策退役（ADR-0119）。

当前开发目标是内部 Alpha.10「真相闭合」(Truth Closure) 检查点：不发布、不打
tag、不晋级 `main`，由伞形 issue #1155 及工作 issue #1209–#1220 跟踪，是
Beta.1 准入的硬阻塞项。Alpha 编号是内部工作标识，不是 npm 版本；首个计划公开
的 v0.44 预发布版本是 Beta.1（`v0.44.0-beta.1`）。0.44 架构列车仍由 ADR-0143
开启：一个强制编译器将 TSX 降为由服务端序列化、浏览器新建 DOM 与已有 DOM
claim 共同消费的 Part Program。
在 0.44 预发布版本真正发布前，这不会改变已安装的稳定线。

`0.42 = WC 轻量全栈（WC light fullstack）`。`0.42.0` 稳定线交付 request-time
Application Loop：动态 loader/action 路由、no-JS + 增强表单、`build → start`、
fail-closed 静态预渲染，以及生成 action POST 上的默认同源 CSRF 检查。登录应用通过
better-auth recipe（基于 Web 标准 `Request` 头）获得支持。

明确**不在** 0.42 宣称范围内（ADR-0122 §5）：框架自有 session/flash、cache/ISR、
流式 SSR、性能 SLO、第三方 WC SSR 语料（随后由 0.43 交付）、生产运行时恢复与 auth 包。
框架自有恢复与缓存语义仍不属于 0.44 编译型 Element 列车。当前承诺是具有
fullstack 输出路径的 static-first 应用，不是泛全栈能力对等宣称。

`1.0.0` 路径仍未排期；只有 0.44 架构稳定、真实产品兼容性证据与外部采用证明完成后，
五包产品面才可能获得长期兼容承诺。

## 开始使用

```sh
deno run -A --minimum-dependency-age 0 npm:@openelement/create my-app
cd my-app
deno task dev
```

默认 dist-tag 即 0.43 稳定线；`--minimum-dependency-age 0` 是必须的，因为 Deno 默认的
minimumDependencyAge（约 24h）会拒绝发布未满一天的包。

生成项目提供 `dev`、`check`、`test`、`build`、`start` 和 `preview`。

## 文档

| 主题     | 链接                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------- |
| 指南     | [openelement.org/guide/getting-started](https://openelement.org/guide/getting-started)         |
| API 参考 | [openelement.org/apilist](https://openelement.org/apilist)                                     |
| 架构     | [openelement.org/architecture/architecture](https://openelement.org/architecture/architecture) |
| 路线图   | [docs/roadmap/ROADMAP.md](./docs/roadmap/ROADMAP.md)                                           |
| 当前状态 | [docs/status/STATUS.md](./docs/status/STATUS.md)                                               |

强制项目流程见
[`docs/governance/PROJECT_WORKFLOW.md`](./docs/governance/PROJECT_WORKFLOW.md)。

## 贡献

参见 [CONTRIBUTING.md](./CONTRIBUTING.md)。架构决策在 [docs/adr/](./docs/adr/)；
历史 release 与 audit 记录保留为证据，不再作为当前产品文档。

## 品牌

规范的紧凑标志是 [`www/public/favicon.svg`](./www/public/favicon.svg) 中的深色
`<open/>` SVG（`open-favicon-inverted.svg` 是浅色背景的维护变体）。品牌 SVG
以仓库 MIT 许可证分发；fork 可以署名使用，但不应暗示获得上游背书。

## 许可

MIT
