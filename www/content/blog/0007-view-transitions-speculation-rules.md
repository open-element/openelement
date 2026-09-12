---
title: 'ADR 0007: View Transitions + Speculation Rules'
date: '2026-05-09'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**ADOPTED** — v0.9.2 架构决策，两个 Web Platform API 纳入 SSG 后处理管线。

## Context

LessJS 的 SSG 产物是纯静态 HTML。用户在页面间导航时，浏览器完全卸载旧页面再加载新页面，体验上有两个痛点：

1. **页面切换闪烁**：全量 DOM 替换导致白屏闪烁，SPA 框架（React/Vue）用客户端路由解决了这个问题，但 MPA 天然不具备。
2. **导航延迟感知**：用户点击链接后，浏览器才开始网络请求、解析 HTML、执行 JS。用户感知到"等待"。

Web Platform 提供了两个原生 API 来解决这些问题：

- **View Transitions API**（Chrome 111+, Safari 18+, Firefox 129+）：为跨页面导航提供原生动画过渡。
- **Speculation Rules API**（Chrome 121+）：让浏览器在用户点击前就 prefetch/prerender 目标页面。

这两个 API 都是零 JS 运行时成本（View Transitions 仅需一个 `<meta>` 标签，Speculation Rules 仅需一个 `<script type="speculationrules">` JSON），与 LessJS 的"零框架运行时"理念完全一致。

## Decision

### 1. View Transitions — 默认开启

在 SSG 后处理管线中注入 `<meta name="view-transition" content="same-origin">`。

- **默认开启**：单 `<meta>` 标签零成本，不支持浏览器静默降级。
- **可关闭**：`viewTransition: false`。
- **实现位置**：`ssg-postprocess.ts` 中的 `injectViewTransitionMeta()`。

### 2. Speculation Rules — 默认关闭

在 SSG 后处理管线中注入 `<script type="speculationrules">` JSON。

- **默认关闭**：prefetch/prerender 消耗带宽和服务器资源，需用户显式启用 `speculation: true`。
- **配置选项**：
  - `eagerness`: `'conservative'`（默认）| `'moderate'` | `'eager'`
  - `prerender`: `boolean`（默认 `false`），启用后浏览器会预渲染目标页面
- **实现位置**：`ssg-postprocess.ts` 中的 `injectSpeculationRules()`。

### 3. SSG 后处理管线重构

从单一函数拆分为 5 步有序管线：

```
1. injectClientScript()       — Island 水合脚本
2. injectViewTransitionMeta() — 跨页面动画
3. injectSpeculationRules()   — 预取/预渲染
4. injectCspMeta()           — 内容安全策略
5. injectDsdPolyfill()        — Firefox DSD 兼容
```

每步独立、可测试、可配置。39 个测试覆盖全部管线步骤。

### 4. Phase 1→3 配置传递

`viewTransition` 和 `speculation` 配置项从 Phase 1 写入 `build-metadata.json`，Phase 3 读取并传递给 SSG 后处理管线。

## Why Not ISR

ISR（Incremental Static Regeneration）是 Next.js 在没有 Islands 架构下的补丁方案。LessJS 的 SSG + Islands + Serverless 部署模式已经覆盖了 ISR 解决的核心问题（按需生成、增量更新），不需要额外引入 ISR 概念。

## Consequences

**正面：**
- 跨页面导航体验接近 SPA，但保持 MPA 的简单性和可缓存性
- 零框架运行时成本，仅使用浏览器原生 API
- SSG 后处理管线可测试性大幅提升
- Speculation Rules 的 opt-in 设计尊重用户带宽

**负面：**
- View Transitions 的 CSS 动画定制需要用户学习 `::view-transition-*` 伪元素
- Speculation Rules 仅 Chrome 121+ 支持，Safari/Firefox 静默降级
- Speculation Rules 可能导致未访问页面的服务器请求增加

**缓解：**
- 文档提供 View Transitions CSS 定制示例
- Speculation Rules 默认关闭，用户明确选择后才启用
- `eagerness: 'conservative'` 默认值仅在用户 hover 时触发 prefetch

## 参考

- [View Transitions API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API)
- [Speculation Rules API — Chrome Developers](https://developer.chrome.com/docs/web-platform/speculation-rules)
- [ADR 0005: WithDsdHydration Mixin](/blog/0005-with-dsd-hydration-mixin)
- [ADR 0006: Version Strategy](/blog/0006-version-strategy)

---

_决策日期: 2026-05-09 | 版本: v0.9.2_
