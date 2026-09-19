---
title: '术语表'
lede: '文档用到的词，一处定义。每个术语都对应框架中的真实构造——不是营销同义词。'
navLabel: '术语表'
order: 65
section: 'Core'
---

## 组件

### Custom Element

浏览器的组件契约：为带连字符的标签名注册的类。在 openElement 中它同时是应用组件契约——页面、island 与原语都是 Custom Elements，只写一次，在服务端渲染。

### `@element`

注册 Custom Element 并声明其 root 模式的类装饰器（今日默认为 shadow-open，声明处可用 light DOM）。

### `@property`

声明响应式状态的字段装饰器：attribute 反射、类型转换与变更重渲染。upgrade 时宿主 attribute 恢复到 `@property` 字段。

### Shadow root

Custom Element 拥有的封装 DOM 子树。服务端输出把它装进 DSD 模板；浏览器在任何脚本加载之前原生解析它。

## 渲染

### Declarative Shadow DOM（DSD）

经 `<template shadowrootmode>` 携带 shadow root 的 HTML。默认的服务端表示：首屏不需要 JavaScript。

### SSG

静态站点生成：构建期把路由渲染成 HTML。openElement 静默优先；请求期渲染是例外，不是默认。

### Upgrade

浏览器把已解析的宿主元素变为存活组件实例的机制。claim 把编译模板的处理器绑定到已存在的 DOM 上，而不是重渲染它。

### Part Program

服务端序列化与客户端 claim 共享的编译期单组件程序：同一份 DOM、绑定与处理器的描述，写一次，执行两次。

## Island

### Island

需要运行时状态或框架互操作的客户端组件。其余一切以静态 DSD 发货，不带客户端模块。island 是唯一的客户端 JavaScript 单元。

### `defineIslandConfig`

在所导出组件旁声明的选择进入（`{ hydrate, ssr, dsd }`）。构建把结果逐页记录进 island manifest。

### Hydration 策略

island 的 chunk 何时拉取：`load`（立即，用于首屏控件）、`idle`（浏览器空闲）、`visible`（接近视口）、`only`（跳过 SSR——纯浏览器组件）。

### 组件分层

服务端写什么、客户端之后接管什么：`dsd-static`（永不加载模块）、`dsd-interactive`（DSD 加编译 claim）、`light-dom`（无 shadow 边界，文档样式直接生效）、`pure-island`（服务端只写宿主标签与 props，渲染归客户端）。

### Island manifest

每个页面一份 JSON 产物，随 HTML 一同产出，包含路由以及每个 island 的标签、chunk URL、层级与策略。不打开客户端 bundle 就能回答页面加载哪些 JavaScript、什么时候加载。

## 内容

### `trustedHtml`

向编译模板注入已消毒、非交互 HTML 的显式边界。除此之外，动态 island 内容来自 signal 驱动的 `@property` 状态。

## 另见

- [核心概念](/zh/guide/core-concepts)——这些术语所属的创作模型。
- [Island Hydration](/zh/architecture/islands)——分层、策略与 manifest。
- [DSD 渲染](/zh/architecture/dsd)——服务端的平台契约。
