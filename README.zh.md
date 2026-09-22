# OpenElement

[English](./README.md) | 简体中文

OpenElement 是一个 Web Platform 优先、只围绕两个核心产品构建的仓库：**Element** 与 **Router**。
Element 将 JSX 编写的 Custom Element 编译为 Part Program，并统一用于服务端序列化、创建新 DOM 与复用现有 DOM。Router 负责路由选择、HTTP 语义、导航、loader/action，以及 Native 与 Lit Framework Mode 共享的应用协议。

源码目前是 Element 与 Router 的全新公开基线 `1.0.0-alpha.3`。它不是从历史 0.x API 到 1.x 的兼容迁移。npm `latest` 是按包独立的：element、create、ui 继续指向 0.43 稳定线，而 Router 的 `latest` 是 0.41.0-alpha.6 预发布。在单独准入发布之前，没有任何单一版本同时覆盖全部四个包。

## 快速开始

需要 **Deno 2.9+**。创建、运行、构建：

```bash
deno run -A npm:@openelement/create@alpha my-app
cd my-app
deno task dev
deno task build
```

加一个页面——一个编译后的 element，加一条路由记录：

```tsx
// app/components/page-hello.tsx
import { element, OpenElement } from '@openelement/element';

@element('hello-page', { root: 'shadow-open' })
export default class HelloPage extends OpenElement {
  render() {
    return (
      <main>
        <h1>Hello from OpenElement</h1>
      </main>
    );
  }
}
```

```tsx
// app/routes/hello.tsx
import { definePage } from '@openelement/router';
import HelloPage from '../components/page-hello.tsx';

export default definePage(HelloPage, {
  head: { title: 'Hello' },
});
```

重新跑 `deno task dev`，打开 Vite 打印的 URL 并加上 `/hello`，`deno task build` 会产出 static-first 的 `dist/`。完整教程：<https://openelement.org/zh/guide/getting-started>。

**构建期宿主说明：** `@openelement/router` 的工具子路径（`./vite`、`./cli/*`）直接调用 Deno API，因此在**构建期**需要 Deno 宿主——在纯 Node 的 `vite.config.ts` 中调用会以 `Deno is not defined` 报错。请求期产物保持 WinterCG 纯净，可部署到任意目标。这是一条临时性约束：移除它的 portable-host 工具迁移是 deferred 路线图项（[#1387](https://github.com/open-element/openelement/issues/1387)）。

## 特性

- Declarative Shadow DOM，外加 SSR、复用现有 DOM 的 claim，以及只在需要处水合的 island。
- 手写 JSX 在构建期编译为 Part Program；运行时没有 virtual-DOM 协议。
- Route Mode 写显式路由记录，Framework Mode 做文件路由、loader、action 与表单。
- Native 与 Lit 双渲染器共用一套应用协议；渲染器集成保持显式。
- 编译产物可 tree-shake，纯服务端模块不会漏进客户端 bundle。

## 对比

| 框架    | 与 OpenElement 的差异                                                                                                                                                                                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Astro   | 面向内容站点的 island 架构，组件与框架无关；OpenElement 自己编译 Custom Element，路由与 SSR/SSG 在同一仓库内。                                                                                                                                                                                                              |
| Fresh   | Deno 原生的 Preact island 框架，开发已停滞：最后一次代码提交为 2026-05-27，最后一次发布为 2.3.3（2026-04-28），157 个 open issue 无人处理（verified as of 2026-09-20）。Deno 原生 island 这个生态位正在空出，OpenElement 有条件接住它——编译式 Custom Element（Native/Lit 渲染器）、static-first 输出、路由与 SSR 同仓一体。 |
| Lit     | Web Component 渲染库，不是应用框架；OpenElement 可以把 Lit 当作一种渲染器选项，而不是替代它。                                                                                                                                                                                                                               |
| Next.js | 以 React 为中心的全栈框架；OpenElement 只做 static-first 的 Element/Router 核心，不追全栈对等。                                                                                                                                                                                                                             |

## 仓库结构

- `packages/element`：Element 核心产品。
- `packages/router`：Router 核心产品：Route Mode 与 Framework Mode 实现。
- `packages/element` 的 `/compiler` 与 `/vite` 子路径：Element 编译与 Vite 工具集成；
  `packages/router` 的 `/vite`、`/cli/*` 与 `/nitro-mount` 子路径：Router 的应用生命周期与服务器输出。
- `packages/create`：面向这两个核心产品的正式创建入口。
- `packages/ui`：实验性 UI 产品，由本仓库维护，不在 1.0 稳定承诺内。
- `www`：官方产品表面（文档站点）。
- `apps/saas`：独立的第一方消费者应用，由本仓库维护但单独治理；不属于 framework core，也不属于本次 Alpha 仓库候选。

Element 与 Router 是公共框架核心。UI 是 experimental 产品；Site 是官方产品表面；SaaS 是独立治理的第一方应用，不属于本次 Alpha 仓库候选。它们都不扩大 Element/Router 的稳定 API 承诺，但全部由本仓库拥有和维护。历史快照继续由 Git 标签保存。

## 开发

源码仓库使用 Deno；发布到 npm 的产物在一次性外部 npm 项目中独立验证。

```sh
deno install
deno task fmt:check
deno task lint
deno task typecheck
deno task test
deno task build
```

## 文档

- [当前架构](./docs/architecture/README.md)
- [活跃决策](./docs/adr/README.md)
- [发布操作](./docs/maintainers/releasing.md)
- [安全策略](./SECURITY.md)
- [贡献指南](./CONTRIBUTING.md)

OpenElement 使用 MIT 许可证。
