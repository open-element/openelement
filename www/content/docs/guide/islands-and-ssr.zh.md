---
title: 'Islands 与 SSR'
lede: 'SSR 与 DSD 提供文档基线。Islands 在声明的边界上添加客户端行为。'
order: 90
---

## 服务端优先

默认情况下每个路由都在构建时渲染为 HTML。输出是普通的声明式标记：内容组件被序列化为浏览器无需脚本即可解析的 shadow root，样式表被内联（light root 用 `@scope(<tag>)` 限定作用域），文档在任何客户端模块被拉取之前就已样式化且可读。因此只要标记是静态的，即使网络很慢、模块加载失败或 JavaScript 被禁用，页面依然是静态的。

确实无法预渲染的页面声明 `renderIntent: { mode: 'dynamic' }`，通过生成的 `dist/server` 入口按请求渲染。它仍是同一个编译程序——只是由 loader 而不是构建来提供数据——所以把页面在 static 与 dynamic 之间移动，改变的是渲染位置，而不是标记的产生方式。保留静态 GET 但导出 action 的页面照旧保持预渲染，只有它的 POST 会分派到服务器。

## 声明的 islands

客户端行为按模块显式选择，并且写在 metadata 里，从不靠推断。island 在所导出的组件旁声明投递方式：

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'visible', ssr: true, dsd: true });
```

`hydrate` 决定模块何时被 import——`'load'` 用于首屏控件，`'idle'` 用于可以等待的工作，`'visible'` 用于接近视口才重要的组件，`'only'` 用于跳过 SSR 的浏览器专用组件。`ssr` 与 `dsd` 说明服务端是否序列化该组件。构建会逐页记录结果，因此页面永远到不了的 island 永远不会被拉取。

upgrade 本身是浏览器的 Custom Element 机制。服务端把编译后的 Part Program 序列化为 Declarative Shadow DOM；类被定义后，生成的 claim 产物对已经存在的 DOM 重放同一份程序，绑定模板声明过的处理器，并用宿主 attribute 还原 `@property` 字段。不会重建树，不会用字符串查找绑定，也不会从 attribute 合成事件。

## 小运行时

发出的内容是页面声明的那组 island chunk 加上生成的 claim 代码——不存在每个页面都必须加载的框架运行时。没有任何交互模块的页面完全不加载框架 JavaScript；island 全是 `'visible'` 的页面，在读者滚动到之前不付出任何代价。

这个预算正是静态表面重要的原因。凡是能用标记表达的——内容、布局、文档，甚至样式完整、看起来可交互的组件——都应保持静态 DSD；island 只留给状态与浏览器 API。两种情况下的组件代码完全相同，所以这个决定是一次声明而不是一次重写，也可以在组件真实需求明确后再回来调整。

## 另见

- [Island 深入解析](/zh/architecture/islands-deep)——四层组件模型与 claim 的工作原理。
- [DSD 渲染](/zh/architecture/dsd)——服务端输出背后的平台契约。
- [Island Hydration](/zh/architecture/islands)——同一套边界在组件模型上的描述。
