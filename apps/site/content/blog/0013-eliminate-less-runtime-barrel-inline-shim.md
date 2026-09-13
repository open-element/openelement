---
title: 'ADR 0013: 消除 less-runtime barrel、删除 virtual:less-runtime、移除 .less/ 残留'
date: '2026-05-10'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**IMPLEMENTED** — v0.9.x 架构清理

## Context

### 四项决策

1. **D4 修正**：`.less/` 在脚手架 `.gitignore` 模板和仓库 `.gitignore` 中的残留应**直接删除**，不做向后兼容。ADR 0010 已消除所有 `.less/` 写入，新项目不应该知道它曾经存在。

2. **彻底删除 `virtual:less-runtime`**：消费者已全部改为从源文件直接导入后，没有任何代码 import `@openelement/core/less-runtime`。`virtual:less-runtime` 的 Vite 别名、resolveId、load 钩子全部成为死代码。`registerAdapter()` 和 `renderDSD()` 在 SSR 构建中通过同一个 Vite bundle 天然共享模块作用域，不再需要虚拟模块来保证。

3. **删除 `runtime-shim.ts` 和生成器**：`virtual:less-runtime` 删除后，`runtime-shim.ts` 和 `generate-runtime-shim.ts` 也不再被任何代码引用，一并删除。

4. **less-runtime.ts barrel 删除，消费者直连源文件**：`less-runtime.ts` 是 19 行的 barrel re-export 文件，仅转发 `adapter-registry`、`render-dsd`、`ssr-handler`、`logger` 的导出。删除后所有消费者改为从源文件直接导入。

### 之前架构（已消除）

```
generate-runtime-shim.ts (229行脚本)
  → 输出 runtime-shim.ts (3行包装, 含 JS 字符串)
  → index.ts import { createRuntimeShimCode } from './runtime-shim.js'
  → virtual:less-runtime 的 load() 返回 createRuntimeShimCode()

less-runtime.ts (19行 barrel)
  → re-export from adapter-registry, render-dsd, ssr-handler, logger
  → 被消费者 import { xxx } from '@openelement/core/less-runtime'

virtual:less-runtime (Vite 虚拟模块)
  → config() 别名: '@openelement/core/less-runtime' → 'virtual:less-runtime'
  → resolveId() 解析虚拟 ID
  → load() SSR 分支: re-export from @openelement/core
  → load() 客户端分支: 返回 createRuntimeShimCode()

build-ssg.ts 中的 less:ssg-virtual-runtime 插件
  → 复制了 index.ts 中的 virtual:less-runtime 逻辑
```

### 当前架构（ADR 0013 后）

```
消费者直接 import from '@openelement/core/render-dsd' 等
  → Vite 自然解析，SSR 构建打包进同一个 bundle
  → 模块作用域共享通过 bundle 机制保证，无需虚拟模块
```

## Decision

### 1. 移除所有 `.less/` 引用

- `packages/create/cli.ts`：脚手架 `.gitignore` 模板删除 `.less/` 行
- `.gitignore`（仓库级）：删除 `.less/` 行
- `deno.json` clean task：删除 `docs/.less`

### 2. 彻底删除 `virtual:less-runtime`

**`packages/core/src/index.ts`**：

- 删除 `'@openelement/core/less-runtime': VIRTUAL_RUNTIME_ID` 别名
- 删除 `VIRTUAL_RUNTIME_ID` 和 `RESOLVED_RUNTIME_ID` 常量
- 删除 `resolveId()` 中对 `VIRTUAL_RUNTIME_ID` 的解析
- 删除 `load()` 中对 `RESOLVED_RUNTIME_ID` 的处理
- 删除 `readFileSync`、`dirname` 等不再需要的 import

**`packages/core/src/cli/build-ssg.ts`**：

- 删除整个 `less:ssg-virtual-runtime` 插件

### 3. 删除 `runtime-shim.ts` 和生成器

- 删除 `packages/core/src/runtime-shim.ts`
- 删除 `packages/core/scripts/generate-runtime-shim.ts`
- 删除 `deno.json` 中的 `generate:runtime-shim` task
- 不需要替代的 `generate:client-shim`（virtual module 删除后无消费者）

### 4. less-runtime.ts → 删除，消费者直连源文件

- 删除 `packages/core/src/less-runtime.ts`
- 删除 `packages/core/deno.json` 中的 `"./less-runtime"` 和 `"./less-runtime.js"` subpath
- 新增 `"./adapter-registry"` 和 `"./ssr-handler"` subpath exports
- 更新所有消费者：

| 消费者                              | 之前                                                              | 之后                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry-descriptor.ts`               | `from '@openelement/core/less-runtime'`                                | `from '@openelement/core/render-dsd'`                                                                                                                        |
| `entry-renderer.ts` (log+wrap)      | `import { log, wrapInDocument } from '@openelement/core/less-runtime'` | `import { wrapInDocument } from '@openelement/core/ssr-handler'` + `import { createLogger } from '@openelement/core/logger'` + `const log = createLogger('core')` |
| `entry-renderer.ts` (SSG re-export) | `from "@openelement/core/less-runtime"`                                | 拆为 `from "@openelement/core/ssr-handler"` + `from "@openelement/core/adapter-registry"`                                                                         |
| `adapter-lit/ssr.ts`                | `from '@openelement/core/less-runtime'`                                | `from '@openelement/core/adapter-registry'`                                                                                                                  |
| `create/cli.ts`                     | `"@openelement/core/less-runtime": "jsr:..."`                          | `"@openelement/core/adapter-registry": "jsr:..."`                                                                                                            |

### 5. types.ts 值导出清理（D2，与 ADR 合并执行）

- 删除 `types.ts` 的 `export { getAdapter, registerAdapter } from './adapter-registry.js'`
- 修改 `index.ts` 改为从 `adapter-registry.js` 直接导入

## Consequences

### Positive

- 消除 4 个文件（`less-runtime.ts`、`runtime-shim.ts`、`generate-runtime-shim.ts`、`generated/client-shim.js`）
- 消除 `virtual:less-runtime` 整套机制（Vite 别名 + resolveId + load + SSG 插件）
- 消除 `@openelement/core/less-runtime` 这个模糊的 import 路径
- `.less/` 完全从项目记忆中抹除
- types.ts 回归纯类型定义的职责
- `index.ts` 不再需要 `readFileSync`、`dirname` 等 Node API import
- 构建管道更简单：少一个 Vite 插件，少一个生成步骤

### Negative

- `adapter-registry` 和 `ssr-handler` 需新增为 public subpath export
- `entry-renderer.ts` 的 import 从 1 行变 3 行（拆分 log 和 wrapInDocument）
- 客户端构建不再有 lightweight shim——但由于客户端构建不使用 `renderDSD`/`registerAdapter`（仅 SSR 构建使用），无实际影响

### Neutral

- SSR 构建中 `registerAdapter()` 与 `renderDSD()` 的模块作用域共享通过 Vite bundle 机制自然保证，无需虚拟模块

## 参考

- [ADR 0008: 消除 createServer()、.less/ 临时文件与 globalThis 桥接](/blog/0008-eliminate-createserver-globalthis-bridges)
- [ADR 0010: 消除所有 .less/ 临时文件](/blog/0010-eliminate-all-dot-less-temp-files)

---

_决策日期: 2026-05-10 | 版本: v0.9.x | 实施日期: 2026-05-10_
