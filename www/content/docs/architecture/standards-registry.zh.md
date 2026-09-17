---
title: 'WC 标准契约'
lede: 'OpenElement 依赖 Web 平台契约，而非自研的注册表产品。Custom Elements、DSD、CEM、Request/Response 与 FormData 定义了公开应用模型的方向。'
order: 80
section: 'Reference'
---

## Elements + DSD

标准 Custom Elements 与 Declarative Shadow DOM 定义了持久的组件边界。

## Request 语义

`Request`、`Response` 与 `FormData` 是当前 loader/action 面的基础——应用交互无需私有传输层。

## 四包归属

`Element`、`Router`、`Create` 与实验性的 `UI` 包是当前的对外消费界面；内部契约保持内部。

## 另见

- [Package 兼容性](/zh/architecture/package-compatibility)——第三方元素如何被准入。
- [DSD 渲染](/zh/architecture/dsd)——这些标准所产出的渲染契约。
- [当前架构](/zh/architecture/architecture)——每个包在图中的位置。
