---
title: 'WC 标准契约'
lede: 'OpenElement 依赖 Web 平台契约，而非自研的注册表产品。Custom Elements、DSD、CEM、Request/Response 与 FormData 定义了公开应用模型的方向。'
order: 80
---

## Elements + DSD

标准 Custom Elements 与 Declarative Shadow DOM 定义了持久的组件边界。

## Request 语义

`Request`、`Response` 与 `FormData` 是 0.42 loader/action 面的基础——应用交互无需私有传输层。

## 五包归属

`Element`、`App`、`Adapter Vite`、`Create` 与可选的 `UI` 是当前的对外消费界面；内部契约保持内部。
