---
title: 'ADR 0019: Post-Review Comprehensive Improvement Plan'
date: '2026-05-12'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**PARTIALLY IMPLEMENTED** (v0.12.0–v0.14.0) — See implementation notes below.

> 2026-05-13 更新：ADR 0022 (ESM-Native SSG pipeline) + ADR 0023 (Phase reordering) 在 v0.14.0 中落地。Phase 3 从 Vite closeBundle 中抽出为独立模块，URLPattern 替换手写路由解析。
>
> 2026-05-12 更新：ADR 0021 (API surface convergence) 在 v0.13.0 中落地，解决了 `ssr-handler.ts` 删除、导出收敛等问题。`@openelement/app` 测试从 0 增加到 16 个。

## Context

### 触发条件

2026-05-12，主理人齐活林（Qi）启动团队分工审查，对 LessJS 进行了四个维度的全面评估：

| 维度           | 负责人              | 报告                                        |
| -------------- | ------------------- | ------------------------------------------- |
| 产品定位与市场 | 许清楚（产品经理）  | `deliverables/review-positioning-market.md` |
| 系统架构       | 高见远（架构师）    | `deliverables/review-architecture.md`       |
| 源代码质量     | 寇豆码（工程师）    | `deliverables/review-code-quality.md`       |
| 测试质量       | 严过关（QA 工程师） | `deliverables/review-test-quality.md`       |

四份报告共发现 **4 个 Critical 问题、16 个 Major 问题、30+ Minor/Info 问题**，覆盖了从产品战略到底层实现的完整质量视图。

### 问题聚合与优先级映射

将四份报告的问题按**紧急度 × 影响力**聚合后，呈现三个层级：

```
     高
      │
影    │  P0 (需立即行动)
响    │    ├── @openelement/app 零测试              [测试]
力    │    ├── DSD 差异化不突出                 [产品]
      │    └── 社区生态真空                     [产品]
      │
中    │  P1 (本轮迭代必须解决)
      │    ├── LessBuildContext 巨型对象重构      [架构]
      │    ├── closeBundle 职责超载              [架构]
      │    ├── @openelement/rpc 测试严重不足          [测试]
      │    ├── @openelement/ui 组件测试不足           [测试]
      │    └── 4 项代码质量 Major 问题           [代码]
      │
低    │  P2 (下轮迭代)
      │    ├── parse5 分离                       [架构]
      │    ├── Lit 内部 API 依赖治理             [架构]
      │    ├── 12 项代码 Minor 问题               [代码]
      │    └── E2E 浏览器矩阵扩展                [测试]
      │
          低 ─────────── 紧急度 ──────────→ 高
```

### 根本问题识别

透过四份报告的具体问题，根因集中在三个核心矛盾：

1. **v0.x 快速迭代 vs 质量沉淀** — 从 v0.1 到 v0.11 仅用 6 周，核心引擎推进极快，但外围（测试、文档、生态）未能同步
2. **理念领先 vs 体验粗糙** — DSD-first 理念独特，但开发者在实际使用中的"第一印象"尚不流畅
3. **工程执行力强 vs 产品叙事弱** — 代码和架构质量高（8.5/10），但市场讲述"为什么选 LessJS"的能力薄弱

## Decision

### 决策原则

**"先固本，后拓疆"** — v0.12.0 阶段的核心任务是巩固工程质量基础，而非追求功能数量的增长。

具体而言：

1. 当前不追求 .less Compiler（远景目标），不做大规模功能扩展
2. 优先弥补现有的质量缺口，让核心功能"经得起审查"
3. 在产品叙事上确立 "DSD-first" 的明确标签，而非定位为"又一个 Deno 框架"

### Phase 0: 工程质量加固（v0.12.0，立即执行）

解决审查中发现的最迫切质量缺口：

| #      | 行动                                                                     | 参考来源       | 工作量估计 |
| ------ | ------------------------------------------------------------------------ | -------------- | ---------- |
| FIX-01 | 补齐 `@openelement/app` 整合测试（lessjs() 组合 core+content+i18n）           | 测试审查-C1    | 1-2 天     |
| FIX-02 | 修复 `less-layout.ts` innerHTML 使用，改用 `DOMParser.parseFromString()` | 代码审查-C1    | 0.5 天     |
| FIX-03 | 补充 `@openelement/rpc` 基本测试（请求/响应/错误处理）                        | 测试审查-C2    | 1 天       |
| FIX-04 | 治理 signals 模块 `no-explicit-any`（50+ 处，按模块分治）                | 代码审查-M1    | 2 天       |
| FIX-05 | 删除 `ssr-handler.ts` 冗余重导出层                                       | 架构审查-T1    | 0.5 天     |
| FIX-06 | 修复空 catch block 和未使用变量                                          | 代码审查-M2~M4 | 1 天       |
| FIX-07 | 补充 `@openelement/create` CLI 测试                                           | 测试审查-M1    | 1 天       |

**总计工作量：约 7-9 天**（单人全职）

### Phase 1: 架构债务清理（v0.13.0）

解决审查中发现的三项高风险架构问题：

| #       | 行动                                                               | 参考来源    | 工作量估计 |
| ------- | ------------------------------------------------------------------ | ----------- | ---------- |
| ARCH-01 | LessBuildContext 字段按 Phase 分组为类型安全的子对象               | 架构审查-R1 | 3 天       |
| ARCH-02 | closeBundle Phase 2/3 引入显式 BuildStep 编排 + try-catch 隔离     | 架构审查-R2 | 2 天       |
| ARCH-03 | `signals/src/index.ts` 单文件拆分为 engine/polyfill/framework 三层 | 架构审查-T4 | 1 天       |
| ARCH-04 | 修复 `build-manifest.ts` 包标注不一致                              | 架构审查-T2 | 0.5 天     |

**总计工作量：约 6-7 天**

### Phase 2: 护城河建设（v0.14.0+）

基于审查结论确立的长期竞争优势方向。详见 [ADR 0020: DSD 渲染引擎与 Islands 策略增强](/blog/0020-dsd-engine-islands-enhancement)。

## Consequences

### Positive

- **质量地基夯实**：P0/P1 问题全部消除后，LessJS 的工程质量将处于同类框架的头部水平
- **降低贡献门槛**：测试覆盖充分 + 架构债务清理后，社区贡献者更容易理解代码、安全修改
- **产品叙事聚焦**：不再分散精力在多个方向，集中资源打"DSD-first"一张牌

### Negative

- **功能增长暂停**：v0.12.0-v0.13.0 两个版本以清理为主，新功能推进速度放缓
- **Breaking changes**：架构债务清理（如信号包拆分、ssr-handler 删除）可能造成用户迁移成本
- **无法满足所有审查建议**：共 50+ 项建议，当前规划仅覆盖约 60%，剩余项需后续版本持续消化

### Neutral

- Phase 0 和 Phase 1 的改动大部分是内部重构，对用户可见的 API 变更有限
- 审查中发现的一些"亮点"（如 ADR 0018 虚拟模块模式、Branded Type 安全体系）应作为最佳实践推广到更多代码位置

## 参考

- 四份审查报告：`deliverables/review-positioning-market.md`、`deliverables/review-architecture.md`、`deliverables/review-code-quality.md`、`deliverables/review-test-quality.md`
- [ADR 0020: DSD 渲染引擎与 Islands 策略增强](/blog/0020-dsd-engine-islands-enhancement) — 护城河建设的具体技术方案
- [ADR 0011: 消除最后一个 globalThis 桥接](/blog/0011-eliminate-last-globalthis-via-closebundle) — 类似的架构清理模式
- [ADR 0018: 消除插件模块状态](/blog/0018-dev-build-data-consistency-plugin-data-bridge) — 虚拟模块模式最佳实践

---

_提出日期：2026-05-12 | 状态：PARTIALLY IMPLEMENTED (v0.14.0) | 目标版本：v0.12.0+ | 提出人：齐活林（Qi）_
