<p align="center">
  <img src="./www/public/assets/open-avatar.svg" alt="OpenElement logo" width="132" height="132" />
</p>

# OpenElement

<p align="center">
  <a href="https://www.bestpractices.dev/projects/16052"><img src="https://www.bestpractices.dev/projects/16052/badge" alt="OpenSSF Best Practices: passing" /></a>
  <img src="https://img.shields.io/npm/v/%40openelement%2Frouter" alt="npm version" />
  <img src="https://badgen.net/npm/dm/%40openelement%2Felement" alt="npm monthly downloads" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license: MIT" />
  <img src="https://img.shields.io/badge/node-%3E%3D24.2-informational" alt="node: >=24.2" />
</p>

[English](./README.md) | 简体中文

OpenElement 是一个以 Web 平台为基础的框架，包含 **Element** 和 **Router** 两个核心产品。
Element 将 TSX 编译为服务端 HTML 和可交互的 Custom Elements。Router 负责路由选择、HTTP 语义、导航、loader 和 action。

npm 的 `latest` 是 **`1.0.0-alpha.15`**，使用基于类的 Custom Element 写法。
当前源码预览的是 `1.0.0-alpha.16`，使用服务端函数页面和编译器生成的 Custom Elements。预览使用从此次检出的源码构建的包。[发布状态](./docs/release/release-state.json) · [产品模型](./docs/architecture/product-model.md)

## 证据与收录

以下均为可复现、可第三方核验的参考。

- [Software Heritage](https://archive.softwareheritage.org/browse/origin/directory/?origin_url=https://github.com/open-element/openelement)
- [js-framework-benchmark](https://krausest.github.io/js-framework-benchmark/) — 外部基准结果（测量版本以具体条目为准）
- [deps.dev 包视图](https://deps.dev/npm/%40openelement%2Frouter) 与 [npm](https://www.npmjs.com/package/@openelement/router) 上的 npm provenance 证明
- Bundle 体积见 [Bundlephobia](https://bundlephobia.com/package/@openelement/element)

## 通过 npm 快速开始

需要 **Node.js 24.2+（建议 24.18.0）**。按下方方式启动脚手架，它会用 npm 安装依赖。打开 `npm run dev` 输出的 URL，构建前按 Ctrl+C 停止开发服务器。

```bash
npm create @openelement my-app
cd my-app
npm run dev
npm run build
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

在开发服务器中打开 `/hello`。`npm run build` 将预渲染页面和请求时运行的服务器产物写入 `dist/`。[Alpha 15 入门指南](https://github.com/open-element/openelement/blob/v1.0.0-alpha.15/www/content/docs/guide/getting-started.zh.md)

## 预览当前源码

在仓库根目录运行打包测试流程，将从当前源码构建的包安装到临时应用中。

```sh
pnpm install --frozen-lockfile
export STARTER_SMOKE_WORK_DIR="$(mktemp -d)"
pnpm exec vp run --no-cache --fail-if-no-match --filter @openelement/e2e-starter-smoke setup
cd "$STARTER_SMOKE_WORK_DIR/my-blog"
pnpm run dev
```

在预览应用中添加 `app/routes/hello.tsx`，然后打开 `/hello`。

```tsx
import { definePage } from '@openelement/router';

export function HelloPage() {
  return <h1>Hello from OpenElement</h1>;
}

export default definePage(HelloPage, {
  head: { title: 'Hello' },
});
```

停止开发服务器后，用 `pnpm test` 和 `pnpm run build` 验证预览应用。[脚手架使用指南](./packages/create/README.md)

## 特性

- Declarative Shadow DOM，外加 SSR、复用现有 DOM 的 claim，以及只在需要处水合的 island。
- 源码预览在构建期编译 TSX，支持服务端函数页面和编译器生成的 Custom Elements。
- 代码路由写显式路由记录，文件路由做文件路由、loader、action 与表单。
- 原生渲染器基于标准 Custom Elements 和 Web 平台。
- 服务端和浏览器使用独立的入口图，客户端 bundle 不包含纯服务端模块。

## 仓库结构

- `packages/element`：Element 核心产品（纯运行时）。
- `packages/protocol`：跨系统契约包（#1557）：Part Program IR、错误方言、准入描述符；零依赖，仅装契约。
- `packages/compiler`：Element 编译器（#1557）：TSX 分析、代码生成和 Vite 插件边界；在 Element 三包拆分内由它携带 TypeScript，Router tooling 也依赖 TypeScript。
- `packages/router`：Router 核心产品：代码路由与文件路由实现。
  `packages/router` 的 `/vite`、`/cli/*` 与 `/nitro-mount` 子路径：Router 的应用生命周期与服务器输出。
- `packages/create`：面向这两个核心产品的正式创建入口。
- `packages/ui`：实验性 UI 产品，由本仓库维护，不在 1.0 稳定承诺内。
- `www`：官方产品表面（文档站点）。
- `apps/saas`：独立的第一方消费者应用，由本仓库维护但单独治理；不属于 framework core，也不属于本次 Alpha 仓库候选。

Element 与 Router 是公共框架核心。UI 是 experimental 产品；Site 是官方产品表面；SaaS 是独立治理的第一方应用，不属于本次 Alpha 仓库候选。它们都不扩大 Element/Router 的稳定 API 承诺，但全部由本仓库拥有和维护。历史快照继续由 Git 标签保存。

## 开发

源码仓库是 Node 上的 pnpm workspace（`.node-version` 钉住开发线 24.18）；发布到 npm 的产物在一次性外部 npm 项目中独立验证。

```sh
pnpm install
pnpm run fmt:check
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

## 文档

- [当前架构（生效文档）](./docs/architecture/README.md)
- [活跃决策](./docs/adr/README.md)
- [归档与删除登记簿](./docs/legacy/README.md)
- [安全策略](./SECURITY.md)
- [贡献指南](./CONTRIBUTING.md)

OpenElement 使用 MIT 许可证。
