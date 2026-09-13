---
title: 'ADR 0010: 消除所有 .less/ 临时文件，统一单进程构建'
date: '2026-05-11'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**IMPLEMENTED** — v0.9.x 架构简化（所有 5 个 Step 已完成）

## Context

ADR 0008 将 `.less/` 临时文件从 10 个减少到 3 个，建立了 `LessBuildContext` 内存传递机制和 `virtual:less-runtime`/`virtual:less-nav` 虚拟模块模式。但仍有 3 个文件残留：

| 文件                    | 写入位置               | 读取位置                          | 残留原因                |
| ----------------------- | ---------------------- | --------------------------------- | ----------------------- |
| `build-metadata.json`   | `build.ts` closeBundle | `build-client.ts`、`build-ssg.ts` | 跨进程 IPC fallback     |
| `.less-client-entry.ts` | `build-client.ts`      | Vite `rollupOptions.input`        | Vite 入口需文件路径     |
| `.less-ssg-entry.ts`    | `build-ssg.ts`         | Vite `build.ssr`                  | Vite SSR 入口需文件路径 |

此外，`build-ssg.ts` 仍有多处 `.less/` 文件的 fallback 读取：

- `nav-data.json` / `header-nav.json`（virtual:less-nav 插件内）
- `blog-options.json`（动态路由博客初始化）
- `i18n-options.json`（i18n locale 扩展）
- `sitemap-options.json`（sitemap 生成）

### 为什么分步独立运行没有意义

当前 standalone CLI 的设计假设 Phase 1/2/3 分别由不同进程运行，需要文件做跨进程 IPC。但实际上：

- Phase 2 依赖 Phase 1 的 island 元数据（串行）
- Phase 3 依赖 Phase 2 的 island chunk 路径（串行）
- 最终输出是同一个 `dist/` 目录

分步运行不存在任何可并行、可增量、可独立部署的优势。`cli/build.ts` 已经是单进程全流程编排——standalone CLI 只是它的退化版本。

### 技术可行性

`virtual:less-hono-entry` 在 dev 模式已证明 Vite/Rollup 的 `input` 和 `build.ssr` 都走 `resolveId → load` 流程，虚拟模块 ID 可以作为入口。具体证据：

- `index.ts` L203: `rollupOptions: { input: [VIRTUAL_ENTRY_ID] }` — 虚拟 ID 作为 client build 入口
- `index.ts` L275-288: `resolveId()` + `load()` 提供 `VIRTUAL_ENTRY_ID` 的内容
- `build-ssg.ts` L316-327: `virtual:less-runtime` 已在 SSR build 中工作

## Decision

### 1. 消除 `build-metadata.json`

**方案**：从 `build.ts` 的 `closeBundle()` 中移除文件写入。所有数据通过 `LessBuildContext` 传递。`build-client.ts` 和 `build-ssg.ts` 不再有"无 ctx 时从文件读取"的 fallback 路径。

**前提**：standalone `deno run -A jsr:@openelement/core/cli/build-client` 不再支持独立运行——用户应使用 `deno run -A jsr:@openelement/core/cli/build` 统一入口。

### 2. `.less-client-entry.ts` → `virtual:less-client-entry`

**方案**：在 `build-client.ts` 的 Vite 配置中添加 `resolveId`/`load` 插件，将生成的客户端入口代码作为虚拟模块提供。`rollupOptions.input` 使用 `virtual:less-client-entry`。

**代码变更**：

- 移除 `mkdirSync` + `writeFileSync` 写入
- 添加内联 Vite plugin（同 `virtual:less-runtime` 模式）
- `input: { client: 'virtual:less-client-entry' }` 替代文件路径

### 3. `.less-ssg-entry.ts` → `virtual:less-ssg-entry`

**方案**：在 `build-ssg.ts` 的 SSR Vite 配置中添加 `resolveId`/`load` 插件。`build.ssr` 使用 `virtual:less-ssg-entry`。

**代码变更**：

- 移除 `mkdirSync` + `writeFileSync` 写入
- 添加内联 Vite plugin
- `build: { ssr: 'virtual:less-ssg-entry' }` 替代文件路径

### 4. 移除所有 `.less/` fallback 读取

**方案**：`build-ssg.ts` 中所有 `if (!ctx || !ctx.root) { readFileSync(...) }` 分支全部移除。当 ctx 不可用时，直接报错退出，而不是静默降级到文件读取。

**影响的 fallback**：

- `build-metadata.json`（island 元数据、alias、middleware 等）
- `nav-data.json` / `header-nav.json`（virtual:less-nav 插件内）
- `blog-options.json`（动态路由博客初始化）
- `i18n-options.json`（i18n locale 扩展）
- `sitemap-options.json`（sitemap 生成）

### 5. `build.ts` 清理

**方案**：

- 移除 `serializeAlias()` 函数（仅用于 JSON 序列化写入文件）
- 移除 `mkdirSync` + `writeFileSync` 写入 `build-metadata.json`
- 移除 `import { mkdirSync, writeFileSync } from 'node:fs'`
- `closeBundle()` 只写 ctx

## Consequences

### Positive

- **`.less/` 目录完全消失**：10→3→0，构建管线零文件 IPC
- **代码大幅简化**：移除 6+ 处 `if (ctx) { } else { readFileSync }` 双路径分支、`serializeAlias()` 函数、`BuildMetadata` 接口、`getBuildMetadata()` 函数
- **调试体验改善**：`DEBUG=lessjs*` 日志覆盖虚拟模块内容查看，无需 `cat .less/` 文件
- **消除 stale data 风险**：不再存在 Phase 1 写文件、Phase 2/3 读旧文件的不一致问题
- **构建更健壮**：不存在文件缺失、编码错误、JSON 格式错误等文件系统异常

### Negative

- **Standalone CLI 不再支持分步运行**：`deno run -A jsr:@openelement/core/cli/build-client` 独立运行会报错。用户必须使用 `deno run -A jsr:@openelement/core/cli/build` 或 `lessjs()` 编排器。
  - **缓解**：`cli/build.ts` 已提供统一入口，分步运行无实际用例。
- **无法直接查看生成的入口代码**：之前可以 `cat .less/.less-ssg-entry.ts` 查看生成的 Hono 入口。
  - **缓解**：`DEBUG=lessjs*` 日志会输出虚拟模块内容；也可在 Vite config 中添加 `debug: true` 查看。

### Neutral

- `build-client.ts` 和 `build-ssg.ts` 的 `ctx` 参数从 optional 变为 required。这是正确的约束——强制所有构建走统一编排。
- `LessBuildContext` 已有 `ssgEntryCode` 和 `clientEntryCode` 字段（ADR 0008 Phase A 预留），本 ADR 正式启用它们。

## Implementation Plan

按依赖顺序，每个步骤独立可提交：

### Step 1: `.less-client-entry.ts` → `virtual:less-client-entry`

- `build-client.ts`：添加虚拟模块插件，移除文件写入
- `build-client.ts`：`ctx` 参数变为 required，移除 `BuildMetadata` 接口和 `getBuildMetadata()`

### Step 2: `.less-ssg-entry.ts` → `virtual:less-ssg-entry`

- `build-ssg.ts`：添加虚拟模块插件，移除文件写入
- `build-ssg.ts`：移除 `build-metadata.json` fallback 读取块

### Step 3: 移除 `build-metadata.json` 文件写入

- `build.ts`：移除 `serializeAlias()`、移除文件写入、只写 ctx

### Step 4: 移除 `build-ssg.ts` 中所有 `.less/` fallback 读取

- `virtual:less-nav`：移除 `.less/nav-data.json` / `.less/header-nav.json` fallback
- 博客初始化：移除 `.less/blog-options.json` fallback
- i18n：移除 `.less/i18n-options.json` fallback
- sitemap：移除 `.less/sitemap-options.json` fallback

### Step 5: 清理和验证

- 移除 `build-client.ts` 和 `build-ssg.ts` 中未使用的 `import { ... from 'node:fs' }`
- 运行 `deno task build` 端到端验证
- 确认 `.less/` 目录不再被创建

## Expected Impact

- **文件写入点**：3→0
- **文件读取点**：6→0
- **代码行数**：净减 ~120 行（双路径分支、序列化逻辑、fallback 读取）
- **功能变更**：零——所有构建产物不变
