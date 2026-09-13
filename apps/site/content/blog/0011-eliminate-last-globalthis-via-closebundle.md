---
title: 'ADR 0011: 消除最后一个 globalThis 桥接 — closeBundle 内联 Phase 2/3'
date: '2026-05-10'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**IMPLEMENTED** — v0.9.x 架构简化（globalThis 桥接已彻底删除，见 ADR 0012）

## Context

ADR 0008 将 `globalThis[Symbol.for()]` 桥接从 4 个减到 1 个。ADR 0010 消除了所有 `.less/` 临时文件。当前仅剩一个 globalThis 桥接：

```ts
// index.ts — less() 插件创建 ctx 后写入 globalThis
const CTX_KEY = Symbol.for('lessjs:build-context');
(globalThis as Record<symbol, unknown>)[CTX_KEY] = ctx;

// cli/build.ts — orchestrator 从 globalThis 读回
const CTX_KEY = Symbol.for('lessjs:build-context');
const existingCtx = (globalThis as Record<symbol, unknown>)[CTX_KEY];
```

### 为什么需要这个桥接

`cli/build.ts`（orchestrator）调用 `viteBuild()` 触发 Phase 1。Vite 内部加载 `vite.config.ts` → 调用 `less()` → 创建 `LessBuildContext`。但 `viteBuild()` 是黑盒，不返回任何用户数据，orchestrator 无法直接拿到 ctx 引用。

因此用 `globalThis` 做桥梁：`less()` 写入，orchestrator 读回，传递给 Phase 2/3。

### 现状数据流

```
cli/build.ts (orchestrator)
  │
  ├─ viteBuild()                           ← 黑盒
  │     └─ less() 创建 ctx
  │        └─ globalThis[CTX_KEY] = ctx    ← 写入
  │        └─ buildPlugin(opts, ctx)       ← closeBundle 写 metadata
  │
  ├─ globalThis[CTX_KEY] 读取 ctx          ← 问题所在
  ├─ buildClient(ctx)
  ├─ buildSSG({}, ctx)
  └─ delete globalThis[CTX_KEY]
```

### 关键观察

`closeBundle()` **已经有 ctx 的直接引用**——它是 `buildPlugin(opts, ctx)` 的参数，在 `less()` 的闭包作用域内。而 Phase 2 和 3 都是 `configFile: false` 的独立 Vite 构建，不依赖 `vite.config.ts`，不会触发 `less:build` 的 `closeBundle()` 递归。

这意味着 Phase 2/3 可以直接在 `closeBundle()` 内执行，ctx 全程在闭包内传递，不需要任何跨作用域桥接。

## Decision

将 Phase 2（buildClient）和 Phase 3（buildSSG）从 `cli/build.ts` orchestrator 搬入 `build.ts` 的 `closeBundle()` 钩子。

### 新数据流

```
viteBuild()                                ← 用户或 CLI 调用
  └─ less() 创建 ctx（闭包内）
     └─ buildPlugin(opts, ctx)
        └─ closeBundle()
           ├─ 写 metadata 到 ctx
           ├─ buildClient(ctx)              ← Phase 2
           └─ buildSSG({}, ctx)            ← Phase 3
```

ctx 从创建到消费，全程在 `less()` 的闭包作用域内，零跨作用域传递。

### 代码变更

#### 1. `build.ts` — closeBundle 内联 Phase 2/3

```ts
async closeBundle() {
  if (config.command !== 'build') return;

  // 现有逻辑：写 metadata 到 ctx
  ctx.root = root;
  // ...

  // 新增：直接触发 Phase 2 和 3
  const { buildClient } = await import('./cli/build-client.js');
  await buildClient(ctx);

  const { buildSSG } = await import('./cli/build-ssg.js');
  await buildSSG({}, ctx);

  log.info('Build complete.');
}
```

#### 2. `index.ts` — 删除 globalThis 写入

移除：

```ts
const CTX_KEY = Symbol.for('lessjs:build-context');
if (!(globalThis as Record<symbol, unknown>)[CTX_KEY]) {
  (globalThis as Record<symbol, unknown>)[CTX_KEY] = ctx;
}
```

#### 3. `cli/build.ts` — 简化为单行 viteBuild()

```ts
import { build as viteBuild } from 'vite';
import process from 'node:process';

if (import.meta.main) {
  viteBuild().catch((error) => {
    console.error('Build failed:', error);
    process.exit(1);
  });
}
```

不再需要 `runPhase()`、`LessBuildContext` 导入、globalThis 读写、Phase 2/3 调度。

#### 4. `build-client.ts` / `build-ssg.ts` — ctx 参数为 required

已有的变更，无额外工作。

### 为什么不会递归

Phase 2 和 3 的 Vite 配置都是 `configFile: false`，不会加载 `vite.config.ts`，不会触发 `less()` 插件，不会再次进入 `closeBundle()`。

Fresh 的 `writeBundle` 钩子中触发后续构建也是同样模式——在 Vite 钩子内调用 `viteBuild()` 是已验证的实践。

## Consequences

### Positive

- **globalThis 彻底清零**：从 4→1→**0**，ADR 0008 的 globalThis 消除目标完成
- **零共享可变状态**：ctx 全程在闭包内，无跨作用域传递
- **代码更简单**：`cli/build.ts` 从 ~80 行降至 ~10 行，`index.ts` 删除 globalThis 相关代码
- **架构更清晰**：`viteBuild()` 一个入口完成全部 3 个 phase，与 Fresh 模式对齐
- **消除 Symbol.for() 碰撞风险**：不再有全局 Symbol 注册
- **ADR 0012 进一步删除**：`getActiveContext()`/`setActiveContext()`/`clearActiveContext()` 函数本身也从 `build-context.ts` 中删除，ctx 只通过显式参数传递

### Negative

- **closeBundle 变重**：在钩子内调两次 `viteBuild()`，但 Phase 2/3 本就是独立 Vite 实例，实际影响为零
- **失去独立的 Phase 2/3 命令**：`deno task build:client` / `build:ssg` 不再可用
  - **缓解**：ADR 0010 已确定统一入口是唯一路径，standalone CLI 不支持

### Neutral

- `cli/build.ts` 不再是"orchestrator"——它只是一个 `viteBuild()` 的 CLI 入口。真正的编排逻辑在 `closeBundle()` 中
- 用户构建命令不变：仍然是 `deno task build`

## 参考

- [ADR 0008: 消除 createServer()、.less/ 临时文件与 globalThis 桥接](/blog/0008-eliminate-createserver-globalthis-bridges)
- [ADR 0010: 消除所有 .less/ 临时文件](/blog/0010-eliminate-all-dot-less-temp-files)
- Fresh `plugin-vite/server_entry.ts` — `writeBundle` 钩子内触发后续构建的先例

---

_决策日期: 2026-05-10 | 版本: v0.9.0_
