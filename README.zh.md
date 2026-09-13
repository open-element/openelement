# OpenElement

[English](./README.md) | 简体中文

OpenElement 是一个 Web Platform 优先、只围绕两个核心产品构建的仓库：**Element** 与 **Router**。
Element 将 JSX 编写的 Custom Element 编译为 Part Program，并统一用于服务端序列化、创建新 DOM 与复用现有 DOM。Router 负责路由选择、HTTP 语义、导航、loader/action，以及 Native 与 Lit Framework Mode 共享的应用协议。

源码目前是 Element 与 Router 的全新公开基线 `1.0.0-alpha.1`。它不是从历史 0.x API 到 1.x 的兼容迁移。npm `latest` 在单独通过 Stable 准入前继续指向 0.43 稳定线。

## 仓库结构

- `packages/element`：Element 产品。
- `packages/router`：Router 的 Route Mode 与 Framework Mode 实现。
- `packages/element` 的 `/compiler` 与 `/vite` 子路径：Element 编译与 Vite 工具集成；
  `packages/router` 的 `/vite`、`/cli/*` 与 `/nitro-mount` 子路径：Router 的应用生命周期与服务器输出。
- `packages/create`：面向这两个产品的轻量脚手架。

UI 组件、Reader/Mastodon、参考 SaaS、示例及文档站点属于独立消费者，不再是核心仓库产品。历史快照继续由 Git 标签保存。

## 开发

源码仓库使用 Deno；发布到 npm 的产物在一次性外部 npm 项目中独立验证。

```sh
deno task fmt:check
deno task lint
deno task typecheck
deno task test
deno task build
```

## 文档

- [当前架构](./docs/architecture/README.md)
- [活跃决策](./docs/adr/README.md)
- [架构历史](./docs/history/architecture-evolution.md)
- [发布操作](./docs/maintainers/releasing.md)
- [安全策略](./SECURITY.md)
- [贡献指南](./CONTRIBUTING.md)

OpenElement 使用 MIT 许可证。
