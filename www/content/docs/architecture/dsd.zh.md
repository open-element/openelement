---
title: 'Declarative Shadow DOM 渲染'
lede: 'openElement 把 Declarative Shadow DOM 作为 Web Components 的服务端渲染边界，然后只升级那些必须在浏览器中运行的行为。'
navLabel: 'DSD 渲染'
order: 30
---

## 平台契约

Declarative Shadow DOM 通过带 `shadowrootmode` 的 template，让 HTML 在客户端 JavaScript 加载之前就能携带 shadow-root 内容。

```html
<my-card>
  <template shadowrootmode="open">
    <style>
    :host {
      display: block;
    }
    </style>
    <p>Visible before client JavaScript.</p>
  </template>
</my-card>
```

## 传统 hydration

客户端运行时往往要在页面完全可交互之前重建整棵组件树。

## DSD-first 渲染

浏览器直接从 HTML 解析出 shadow root。随后 Custom Elements 升级已有的宿主元素，只挂载需要的行为。

## openElement 分层

- 静态 DSD 组件，用于内容、布局与文档。
- 交互元素，承担浏览器内的局部行为。
- islands，用于需要框架运行时的客户端组件。

## 平台标准

OpenElement 依赖 Web 平台契约，而非自研的注册表产品。Custom Elements、DSD、CEM、Request/Response 与 FormData 定义了公开应用模型的方向。

### Elements + DSD

标准 Custom Elements 与 Declarative Shadow DOM 定义了持久的组件边界。

### Request 语义

`Request`、`Response` 与 `FormData` 是当前 loader/action 面的基础——应用交互无需私有传输层。

### 四包归属

`Element`、`Router`、`Create` 与实验性的 `UI` 包是当前的对外消费界面；内部契约保持内部。

## 另见

- [Island Hydration](/zh/architecture/islands)——组件何时进入客户端投递。
- [Island 深入解析](/zh/architecture/islands)——分层与 hydration 策略。
- [核心概念](/zh/guide/core-concepts)——声明组件的 root 模式。
- [当前架构](/zh/architecture)——每个包在图中的位置。
