---
title: '术语表'
lede: '文档用到的词，一处定义。每个术语都对应框架中的真实构造——不是营销同义词。'
navLabel: '术语表'
order: 65
section: 'Core'
---

## 组件

### Custom Element

浏览器通过带连字符的标签名注册组件。openElement 从函数组件及其 `defineIslandConfig` 声明生成 Custom Element。服务端函数页面可以组合这些元素。

### Signal

用于组件状态的响应式值。编译器追踪读取它的模板位置，值变化时只更新相应的 DOM slot。

### Shadow root

Custom Element 拥有的封装 DOM 子树。服务端输出把它装进 DSD 模板；浏览器在任何脚本加载之前原生解析它。

## 渲染

### Declarative Shadow DOM（DSD）

经 `<template shadowrootmode>` 携带 shadow root 的 HTML。声明了显式 shadow 模式的组件的服务端表示（当前编译默认是 light DOM）：DSD 内容先于任何脚本完成绘制与可读；handler 与 signal 在 upgrade 后绑定。

### SSG

静态站点生成：构建期把路由渲染成 HTML。openElement 静态优先；请求期渲染是例外，不是默认。

### Upgrade

浏览器把已解析的宿主元素变为存活组件实例的机制。claim 把编译模板的处理器绑定到已存在的 DOM 上，而不是重渲染它。

### 生成的渲染器

编译器根据同一个组件生成服务端渲染函数和浏览器端的挂载、claim 和更新逻辑。

## Island

### Island

可以在浏览器中激活的组件，可独立安排加载时机。应用也可能加载共享的引导脚本。

### `defineIslandConfig`

在所导出组件旁声明的选择进入（`{ hydrate, ssr, dsd }`）。构建把结果逐页记录进 island manifest。

### Hydration 策略

island 的 chunk 何时拉取：`load`（立即，用于首屏控件）、`idle`（浏览器空闲）、`visible`（接近视口）、`media`（island `media` 字段声明的查询匹配期间）、`only`（跳过 SSR——纯浏览器组件）。

### 组件分层

服务端写什么、客户端之后接管什么：`dsd-static`（永不加载模块）、`dsd-interactive`（DSD 加编译 claim）、`light-dom`（无 shadow 边界，文档样式直接生效）、`pure-island`（服务端只写宿主标签与 props，渲染归客户端）。

### Island manifest

每个页面一份 JSON 产物，随 HTML 一同产出，包含路由以及每个 island 的标签、chunk URL、层级与策略。不打开客户端 bundle 就能回答页面加载哪些 JavaScript、什么时候加载。

## 内容

### `trustedHtml`

将已清理的 HTML 交给服务端渲染的显式信任边界。

## 另见

- [核心概念](/zh/guide/core-concepts)——这些术语所属的创作模型。
- [Island Hydration](/zh/guide/islands-and-ssr)——分层、策略与 manifest。
- [DSD 渲染](/zh/architecture/dsd)——服务端的平台契约。
