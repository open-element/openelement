---
title: 'Island Hydration'
lede: 'openElement 默认让文档与 Web Components 保持服务端渲染。island 只为需要运行时状态或框架互操作的客户端组件保留。'
order: 40
---

## 静态表面

服务端发出的是一份完整文档：页面标记、按宿主限定作用域的样式表，以及每个组件的内容——装在 Declarative Shadow DOM 模板（`<template shadowrootmode="open">`）里，或在组件声明 light root 时直接落在 DOM 中。浏览器原生解析这一切，因此在任何框架模块被拉取之前，页面已经可读、已样式化、可被抓取。

每个组件会被归入四个层级之一，层级决定服务端写入什么、客户端模块之后接管什么：

- `dsd-static`——序列化为 DSD；永远不会有客户端模块加载它。
- `dsd-interactive`——序列化为 DSD；upgrade 时由编译后的 claim 绑定行为。
- `light-dom`——编译为 light root；没有 shadow 边界，文档样式直接生效。
- `pure-island`——浏览器专用；服务端只写宿主标签与序列化 props，渲染归客户端所有。

同一套分类也在构建期准入第三方元素（标准 Custom Elements、Lit、FAST、Stencil），并给出可操作的诊断，而不是放行一个渲染不出来的组件。

## Hydration 边界

边界是声明的，不是被发现的。island 模块在所导出的组件旁用 `defineIslandConfig({ hydrate, ssr, dsd })` 选择进入，构建会把结果逐页记录进 island manifest：每个页面一份 JSON 产物，包含路由以及每个 island 的标签、chunk URL、层级与策略。生成的客户端入口只 import 该页面声明的模块，因此页面的客户端图谱是其自身 metadata 的直接结果。

因为 manifest 与 HTML 一同产出，构建产物无需打开客户端 bundle 就能回答「这个页面加载哪些 JavaScript，什么时候加载」。

## 渐进式行为

claim 对已经存在的 DOM 重放编译后的 Part Program：模板声明过的处理器被绑定，`@property` 字段由宿主 attribute 填充，`pure-island` 首次渲染。未被触及的节点从不重渲染，没有按字符串查找的绑定发现，也不会从 `data-*` attribute 合成事件。

策略决定 chunk 何时被拉取——`load`、`idle`、`visible` 或 `only`。在它到达之前，元素保留服务端标记与样式：页面从不依赖任何 island 已经加载，而永远到不了的 island 除了自己的 chunk 之外不付出任何代价。

## 另见

- [Island 深入解析](/zh/architecture/islands-deep)——层级与策略的细节。
- [DSD 渲染](/zh/architecture/dsd)——静态表面所依赖的平台契约。
- [Islands 与 SSR](/zh/guide/islands-and-ssr)——在应用中声明 island。
