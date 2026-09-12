---
title: 'ADR 0021: A+ 架构冲刺 — API 表面收敛 + 管道化 + 参数校验'
date: '2026-05-12'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## 状态

**IMPLEMENTED** (v0.13.0)

> 注意：`build-context.ts` 和 `build.ts` 实际于 v0.11 迁移至 `@openelement/adapter-vite`，ADR 撰写时 core 尚未拆分完毕。最终实现中 virtual-ids 也位于 `@openelement/adapter-vite/virtual-ids` 而非 `@openelement/core/constants`。

## 日期

2026-05-12

## 修改文件

- `packages/core/deno.json` — exports 裁剪
- `packages/core/src/constants.ts` — 迁出 Vite 相关 ID
- `packages/core/src/build-context.ts` — Phase branded types
- `packages/core/src/build.ts` — closeBundle 替代为 chain
- `packages/adapter-vite/deno.json`
- `packages/adapter-vite/src/index.ts`
- `packages/adapter-vite/src/cli/build-ssg.ts`
- `.github/workflows/test.yml` — 加 coverage flag
- `deno.json` — 加 coverage task
- 各 barrel 文件 inline（5 处）

## 背景

2026-05-12 全面架构审查得出评级 A-。核心问题：

1. **core 公共 API 表面过大**：10 个 subpath exports 中 4 个是内部实现细节，因生成代码需要而被迫公开
2. **无测试覆盖率度量**：CI 有 452 测试但无 `--coverage`
3. **3 个 barrel 文件仅聚合导出**：`content/src/nav/index.ts`、`content/src/sitemap/index.ts`、`content/src/pages/index.ts`
4. **`@openelement/core/constants` 包含 Vite 虚拟模块 ID**：core 不应知道 Vite 的内部机制
5. **Phase 顺序无编译期保证**：`build()` 能在 Phase1 就绪前被调用

## 决策

### 1. core 导出收敛到 6 个公共 API

保留：

- `.`（主入口）
- `./errors` — 用户需要 `LessError`
- `./context` — 用户需要 `SsrContext`
- `./logger` — 用户需要 `createLogger`
- `./navigation` — 用户需要 `navigate`/`onNavigate`
- `./constants` — 公共常量（仅跨包共享的配置常量）

移除（移到 adapter-vite 的 `CORE_SUBPATHS` 映射中）：

- `./render-dsd` — 生成代码导入，非用户 API
- `./html-escape` — 内部 HTML 转义，非用户 API
- `./adapter-registry` — 内部适配器注册，非用户 API
- `./ssr-handler` — 已删除文件，残留导出

**影响**：生成代码通过 `CORE_SUBPATHS` + `JSR remote resolution` 解析，不受影响。

### 2. CI 添加覆盖率收集

`deno test --coverage` 生成覆盖率报告，在 test.yml 中每个 job 末尾运行。

### 3. 零 barrel

`content/src/nav/index.ts`、`content/src/sitemap/index.ts` 两个文件的导出直接 inline 到 `content/src/index.ts`，删除 barrel 文件。

### 4. core-Vite 分离

`@openelement/core/constants` 只保留纯配置常量。Vite 虚拟模块 ID（`VIRTUAL_BLOG_DATA_ID`、`RESOLVED_NAV_ID` 等）迁到 `@openelement/adapter-vite` 的 `virtual-ids.ts`。

### 5. 编译期 Phase 顺序校验 (Branded Type 状态机)

```typescript
type Phase1Ready = { __phase: 'phase1' };
type Phase2Ready = { __phase: 'phase2' };
type Phase3Ready = { __phase: 'phase3' };

function buildPhase1(ctx: LessBuildContext): Phase1Ready & { ... }
function buildPhase2(state: Phase1Ready): Phase2Ready & { ... }
function buildPhase3(state: Phase2Ready): void
```

`buildPhase2` 只接受 `Phase1Ready` 的返回值，`buildPhase3` 只接受 `Phase2Ready`。编译器阻止乱序调用。

## 后果

- core 公共 API 从 10 个降到 6 个
- CI 每次运行产生覆盖率报告
- barrel 文件清零
- Vite 知识不在 core 中存在
- Phase 顺序错误被编译器捕获而不是运行时 500
- 项目从 A- 前进到 A

## 未完成（A+ 剩余项）

- LessBuildContext → 纯函数管线：当前已是中间态（ctx 显式传递），完全纯函数化需 3-5 天专门工作
- 正式插件生命周期：`registerAdapter()` 是唯一入口，完整的 pre/post hooks 需 2 天
