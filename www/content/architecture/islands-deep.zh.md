---
title: 'Island 深入解析'
lede: 'island 是 openElement 中唯一的客户端 JavaScript 单元。公开模型是编译后的元素类：服务端序列化、新建 DOM 与已有 DOM 的 claim 共享同一份 Part Program。'
order: 50
---

## 升级模型

openElement 使用浏览器的 Custom Element upgrade 机制。SSG 先写出 HTML，然后生成的客户端入口只导入当前页面用到的 island 模块并注册其编译类。

## 三个层次

### 第 1 层 — `dsd-static` — 无客户端 JavaScript

静态 Web Components 在 SSG 期间渲染为 DSD。即使没有任何客户端模块运行，它们也保持可见且样式完整。

### 第 2 层 — `dsd-interactive` — DSD 加编译 claim

服务端把 island 的编译 Part Program 序列化为 DSD。upgrade 时，生成的 claim 构件按同一份程序对照既有 DOM，并绑定模板声明的事件处理器——没有 binding 发现遍历，没有字符串方法查找，也没有 `data-on-*` 事件属性。

### 第 3 层 — `pure-island` — 客户端拥有的 shadow root

纯浏览器组件可以用 `only` 策略退出 SSR。服务端只输出宿主标签和序列化 props；渲染由客户端全权负责。

## 策略

- `load` — 为首屏控件（如导航与主题）立即导入。
- `idle` — 在浏览器空闲时间为非关键交互组件导入。
- `visible` — 当 island 接近视口时导入。
- `only` — 对无法产出可靠 DSD 的纯浏览器组件跳过 SSR。

## Props 不是事件

宿主属性与序列化 props 在 upgrade 时恢复到 island 的编译 `@property` 字段；claim 不会从中发明事件。事件只存在于编译模板显式声明处理器的位置。

## 动态内容

动态 island 内容来自编译模板内由 signal 驱动的 `@property` 状态。HTML 注入只保留在显式的 `trustedHtml` 边界之内，且仅用于已消毒、非交互的内容。
