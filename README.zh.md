# OpenElement

[English](./README.md) | 简体中文

OpenElement 是一个 Web Platform 优先、只围绕两个核心产品构建的仓库：**Element** 与 **Router**。
Element 将 JSX 编写的 Custom Element 编译为 Part Program，并统一用于服务端序列化、创建新 DOM 与复用现有 DOM。Router 负责路由选择、HTTP 语义、导航、loader/action，以及 Native 与 Lit Framework Mode 共享的应用协议。

源码目前是 Element 与 Router 的全新公开基线 `1.0.0-alpha.1`。它不是从历史 0.x API 到 1.x 的兼容迁移。npm `latest` 是按包独立的：element、create、ui 继续指向 0.43 稳定线，而 Router 的 `latest` 是 0.41.0-alpha.6 预发布。在单独准入发布之前，没有任何单一版本同时覆盖全部四个包。

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
