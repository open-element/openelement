---
title: 'WithDsdHydration Mixin + 自建 SSR 决策'
date: '2026-05-07'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status: ✅ **ADOPTED** — v0.6.2 架构决策

## 上下文

LessJS 使用 Lit 作为 UI 层框架，但 SSR 渲染器（`renderDSD()`）是自建的，不使用 `@lit-labs/ssr`。这导致 DSD 预渲染的组件存在水合缺口：框架的模板系统没有参与 SSR，所以 `@click` 事件绑定和响应式更新都不生效。

我们需要回答两个问题：

1. 为什么不用 Lit/FAST 的原生 SSR？
2. 如何弥补自建 SSR 造成的水合缺口？

## 决策

### 1. 自建 SSR，不用框架原生 SSR

| 原因             | Lit SSR (`@lit-labs/ssr`)                         | FAST SSR     | LessJS `renderDSD()`                              |
| ---------------- | ------------------------------------------------- | ------------ | ------------------------------------------------- |
| Deno/Edge 可运行 | ❌ 依赖 `node:stream`、`node:buffer`              | ❌ 同上      | ✅ 纯字符串拼接                                   |
| 输出标准 DSD     | ❌ 私有序列化格式，需 `@lit-labs/ssr-client` 解析 | ❌ 同上      | ✅ WHATWG 标准 `<template shadowrootmode="open">` |
| 框架无关         | ❌ 绑定 Lit                                       | ❌ 绑定 FAST | ✅ Core 零框架依赖                                |

**权重分析：**

- **Deno/Edge 可运行** — 硬性约束。LessJS 目标运行时是 Deno + Edge Functions，`@lit-labs/ssr` 的 Node.js 依赖使其完全无法使用。单这一条就足够。
- **标准 DSD** — 用户体验约束。WHATWG 标准 DSD 在 HTML 解析时即挂载 shadow root，零 JS、零闪烁。Lit SSR 的私有序列化格式需要等 JS 加载完才能恢复。
- **框架无关** — 架构约束。LessJS Core 的核心承诺是 framework-agnostic，绑死某个框架的 SSR 会让这个承诺名存实亡。

### 2. 用 `WithDsdHydration` Mixin 弥补水合缺口

将 `LitDsdElement` 中 **80% 框架无关的逻辑** 提取到 `@openelement/core` 的通用 Mixin：

```
@openelement/core
  └── WithDsdHydration<T extends HTMLElement>(Base: T): T
        // DSD 检测（shadow root 已有内容？）
        // _hydrateEvents() — HydrateEventDescriptor → addEventListener
        // updateDsdElement() — querySelectorAll + 回调
        // AbortController 自动清理

@openelement/adapter-lit
  └── LitDsdElement = WithDsdHydration(LitElement)
        // render() → nothing（Lit 模板绕过）
        // createRenderRoot() 检测已有 shadow root

@openelement/adapter-fast (未来)
  └── FastDsdElement = WithDsdHydration(FASTElement)
        // FAST 模板绕过策略
```

**为什么是 Mixin 而不是基类：**

- Mixin 接受任意基类（`LitElement`、`FASTElement`、`HTMLElement`），返回增强后的类
- 不需要组件继承特定基类，不与框架继承链冲突
- `@openelement/ui` 不需要依赖 `@openelement/adapter-lit`，消除了循环依赖风险
- 符合 LessJS "framework-agnostic core + pluggable adapters" 的架构理念

**Mixin 中框架无关 vs 框架特定的边界：**

| 能力                          | 通用？ | 依赖                                                           |
| ----------------------------- | ------ | -------------------------------------------------------------- |
| DSD 检测                      | ✅     | 标准 DOM API                                                   |
| 事件绑定 (`_hydrateEvents`)   | ✅     | 标准 DOM API                                                   |
| DOM 更新 (`updateDsdElement`) | ✅     | 标准 DOM API                                                   |
| 清理 (`AbortController`)      | ✅     | 标准 DOM API                                                   |
| 渲染绕过                      | ❌     | 每个框架不同（Lit→`nothing`, FAST→自己的方式, vanilla→不需要） |
| 响应式集成                    | ❌     | 每个框架不同（Lit `requestUpdate`, FAST `Observable`）         |

### 3. Stencil 不纳入 Mixin 体系

Stencil 是编译器而非运行时库，它把 TSX 编译成标准 Custom Element。适配 Stencil 需要**编译器插件**或**后处理 transform**，跟运行时 Mixin 不是同一路径。当前不纳入规划。

## 三层组件模型

Mixin 只服务于 Layer 2（DSD Interactive）。三层各有不同的水合策略：

| 层级    | 名称            | DSD | 水合                     | 适用场景       |
| ------- | --------------- | --- | ------------------------ | -------------- |
| Layer 1 | DSD Static      | ✅  | 无需                     | 纯展示         |
| Layer 2 | DSD Interactive | ✅  | `WithDsdHydration` Mixin | 需要首屏+交互  |
| Layer 3 | Pure Island     | ❌  | 框架原生                 | 需要完整响应式 |

三体困境（自有 SSR + 框架响应式 + DSD 无闪烁）在**组件级别**消解——不是所有组件都需要 DSD。

## 后果

**正面：**

- Core 保持 framework-agnostic，UI 组件不再依赖特定 adapter
- 适配新框架只需写一个薄壳（`WithDsdHydration(NewFrameworkElement)`）
- 手动水合的代价被控制在 `static hydrateEvents` 声明级别
- 标准 DSD 确保首屏零闪烁、零 JS

**负面：**

- Layer 2 组件仍需手动声明 `hydrateEvents`（编译时无类型检查）
- Layer 2 组件的 DOM 更新仍需手动 `updateDsdElement()`（无框架响应式）
- 这些局限需要等待 Lit 原生 hydration 或 `.less` 编译器才能根治

**演进路径：**

1. **v0.6.2**：`WithDsdHydration` Mixin 提取到 Core，组件使用 `extends WithDsdHydration(LitElement)`
2. **中期**：`@lit-labs/ssr` hydration 模块成熟后，Lit 原生 diff 已有 DOM，Mixin 的水合逻辑自然废弃
3. **远期**：`.less` 编译器输出 SSR HTML + 客户端水合代码，人类不再写水合代码

## 参考

- [ADR 0002: .less Compiler](/blog/0002-less-compiler-eliminate-lit) — 远期方向
- [WHATWG HTML §13.4: Declarative Shadow DOM](https://html.spec.whatwg.org/multipage/scripting.html)
- [@lit-labs/ssr](https://github.com/nicolo-ribaudo/lit/tree/main/packages/labs/ssr) — Lit 官方 SSR（Node.js 绑定）

---

_决策日期: 2026-05-07 | 版本: v0.6.2_
