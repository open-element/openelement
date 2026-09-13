---
title: 'ADR 0016: 双模式子路径解析 — resolve.alias 本地 + resolveId/load 虚拟模块远程'
date: '2026-05-11'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**ACCEPTED** — v0.10.3 Bug #9 修复

## Context

### 问题描述

LessJS 的虚拟入口模块 `virtual:less-hono-entry` 会从 `@openelement/core` 的子路径导入模块（如 `@openelement/core/ssr-handler`、`@openelement/core/logger`）。当用户通过 JSR 使用 LessJS 时（即 `import.meta.url` 为 `https://jsr.io/...`），Vite 的 SSR runner 无法解析这些裸标识符（bare specifier），原因如下：

1. **JSR 包不在 `node_modules/` 中**：Deno 使用内容寻址缓存（content-addressable cache），文件名是不透明的哈希值，无法从 `https://` URL 反推本地文件路径
2. **Deno 的 import map（`deno.json`）不被 Vite SSR runner 使用**：Vite 的 SSR runner 底层是 Node.js ESM loader
3. **Node.js ESM loader 仅支持 `file://` 和 `data:` URL scheme**：不支持 `https://` scheme

### Bug 历史

此问题已反复出现 4 次：

| 提交      | 时间    | 尝试方案                                             | 失败原因                                                                    |
| --------- | ------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `b6a6b41` | v0.9.x  | 手动添加 Vite alias（硬编码路径）                    | 新增子路径时遗漏，DX 差                                                     |
| `f223bef` | v0.9.x  | 扩展 alias 覆盖面                                    | 仍有遗漏 + 路径不对                                                         |
| `6c5a992` | v0.9.x  | 补充缺失的 alias                                     | 同上，仍然不完整                                                            |
| `70d3704` | v0.10.2 | `resolve.alias` 使用 `https://` URL 作为 replacement | `ERR_UNSUPPORTED_ESM_URL_SCHEME`：Node.js ESM loader 拒绝 `https://` scheme |
| `caaca34` | v0.10.3 | **本 ADR**：双模式 resolve.alias + resolveId/load    | ✅                                                                          |

### ADR 0015 的贡献

ADR 0015（`c576c74`）引入了 `buildCoreSubpathAliases()` 自动生成所有子路径的 alias，消除了手动遗漏的问题。但 ADR 0015 仅解决了**本地模式**（`file://` import.meta.url）的问题。对于 JSR 远程模式，仍需要一个不同的策略。

### 早期尝试的失败

v0.10.2（`70d3704`）尝试让 `buildCoreSubpathAliases()` 在远程模式下返回 `https://` URL 作为 alias replacement：

```ts
// 失败的方案
aliases.push({
  find: '@openelement/core/ssr-handler',
  replacement: 'https://jsr.io/@openelement/core@0.10.2/src/ssr-handler.ts', // ❌
});
```

失败原因：Vite 的 `resolve.alias` 最终会通过 Node.js ESM loader 解析模块。当 replacement 值是 `https://` URL 时，Node.js ESM loader 抛出 `ERR_UNSUPPORTED_ESM_URL_SCHEME` 错误——它只接受 `file://` 和 `data:` scheme。

## Decision

### 双模式解析策略

根据 `import.meta.url` 的 scheme 自动选择解析策略：

| 执行上下文 | `import.meta.url` scheme | 解析策略                      | 原因                           |
| ---------- | ------------------------ | ----------------------------- | ------------------------------ |
| 本地开发   | `file://`                | `resolve.alias`               | 快速、HMR 兼容、无虚拟模块开销 |
| JSR 远程   | `https://`               | `resolveId` + `load` 虚拟模块 | 绕过 Node.js ESM loader        |

### 模式 A：本地模式（`resolve.alias`）

```ts
// 本地模式：直接映射到文件系统路径
aliases.push({
  find: '@openelement/core/ssr-handler',
  replacement: '/path/to/packages/core/src/ssr-handler.ts',
});
```

- 速度快：Vite 内部路径替换，不经过网络
- HMR 兼容：文件变更直接触发热更新
- 零开销：无虚拟模块的 load 钩子开销

### 模式 B：远程模式（`resolveId` + `load` 虚拟模块）

使用 Rollup/Vite 的虚拟模块模式（`resolveId` + `load` hooks），通过 `\0` 前缀的虚拟 ID 完全绕过 Node.js ESM loader：

```
用户代码 import '@openelement/core/ssr-handler'
    ↓ resolveId hook
虚拟 ID '\0lessjs:core/src/ssr-handler.ts'
    ↓ load hook
从 JSR fetch 源码 → 返回字符串代码
    ↓
Vite/Rollup 内部处理（不经过 Node.js ESM loader）
```

#### 为什么 `\0` 前缀有效

Rollup/Vite 约定：以 `\0` 开头的模块 ID 是虚拟模块，不会被写入文件系统，也不会通过 Node.js ESM loader 解析。它们的生命周期完全在 Rollup/Vite 的 plugin pipeline 内：

- `resolveId` 返回 `\0xxx` → Vite 知道这是虚拟模块
- `load` 返回源码字符串 → Vite 直接编译，不涉及文件系统 I/O
- 后续 `transform` 等钩子正常执行

#### 三种 resolveId 拦截场景

```ts
resolveId(source, importer) {
  // Case 1: 裸标识符 @openelement/core/* → 虚拟 ID
  //   '@openelement/core/ssr-handler' → '\0lessjs:core/src/ssr-handler.ts'
  if (source.startsWith('@openelement/core/')) { ... }

  // Case 2: 虚拟模块内部的相对导入 → 也拦截
  //   './errors.js' from '\0lessjs:core/src/ssr-handler.ts' → '\0lessjs:core/src/errors.js'
  if (importer?.startsWith(VIRTUAL_CORE_PREFIX) && source.startsWith('./')) { ... }

  // Case 3: 已解析的虚拟 ID → 直接通过（防重入）
  if (source.startsWith(VIRTUAL_CORE_PREFIX)) { ... }
}
```

Case 2 是关键的细节：`ssr-handler.ts` 内部 `import { LessError } from './errors.js'`，这个相对导入也需要被拦截——否则 Vite 会尝试通过 Node.js ESM loader 解析它，而此时 importer 是虚拟 ID（不在文件系统上），解析会失败。

#### `.js` → `.ts` 扩展名规范化

Deno 约定：导入语句使用 `.js` 扩展名，但实际文件是 `.ts`。虚拟模块的 load 钩子在构建 JSR URL 时需要将 `.js` 转换为 `.ts`：

```ts
// Deno 源码中的导入
import { LessError } from './errors.js'; // .js 扩展名

// JSR 上实际存储的文件
// https://jsr.io/@openelement/core@0.10.3/src/errors.ts  // .ts 扩展名
```

#### 源码缓存

`jsrSourceCache` Map 缓存已 fetch 的源码，避免重复网络请求。在 dev 模式下，同一模块可能被多次 load（HMR、依赖图重建等），缓存确保只 fetch 一次。

### 代码实现

#### `CORE_SUBPATHS` 映射表

所有支持的子路径集中定义在一个 Record 中，本地模式和远程模式共用：

```ts
const CORE_SUBPATHS: Record<string, string> = {
  'html-escape': 'html-escape.ts',
  'render-dsd': 'render-dsd.ts',
  'render-nested': 'render-nested.ts',
  'island-manifest': 'island-manifest.ts',
  'adapter-registry': 'adapter-registry.ts',
  'ssr-handler': 'ssr-handler.ts',
  'logger': 'logger.ts',
  'build-context': 'build-context.ts',
  'navigation': 'navigation.ts',
};
```

#### `createCoreResolvePlugin(metaUrl: string): Plugin`

工厂函数，根据 `import.meta.url` 创建虚拟模块插件。在本地模式下，所有钩子提前返回（`if (!isRemote) return`），开销接近零。

#### `buildCoreSubpathAliases()` — 仅本地模式

ADR 0015 引入的自动 alias 生成函数保持不变，但现在只在本地模式下使用。远程模式返回空数组。

#### `less()` 插件数组

从 5 个插件增加到 6 个，新增 `less:core-resolve` 插件：

```ts
return [
  corePlugin,                          // less:core
  createCoreResolvePlugin(metaUrl),     // less:core-resolve (NEW)
  virtualEntryPlugin,                  // less:virtual-entry
  devServerPlugin,                     // @hono/vite-dev-server
  islandTransformPlugin(...),          // less:island-transform
  buildPlugin(...),                     // less:build
];
```

### 与 Fresh 2.0 的对比

Deno 的 Fresh 2.0 框架面临类似问题，使用 `@deno/loader` 包来处理远程模块加载。我们的方案差异：

| 维度       | Fresh 2.0                  | LessJS（本 ADR）                    |
| ---------- | -------------------------- | ----------------------------------- |
| 远程加载器 | `@deno/loader`（外部依赖） | 内置 `resolveId` + `load`（零依赖） |
| 范围       | 通用 Deno 模块加载         | 仅 `@openelement/core/*` 子路径          |
| 缓存       | 依赖 Deno 的模块缓存       | 内置 `jsrSourceCache` Map           |
| 复杂度     | 高（通用方案）             | 低（最小化，仅处理核心子路径）      |

选择零依赖内置方案的原因：

- `@openelement/core` 的子路径数量有限（~10 个），不需要通用方案
- 避免引入外部依赖带来的版本兼容和维护风险
- 内置方案可以精确控制缓存策略和错误处理

## Consequences

### Positive

- **彻底解决 JSR 远程 SSR 崩溃**：虚拟模块通过 `\0` 前缀完全绕过 Node.js ESM loader
- **本地模式零影响**：`resolve.alias` 仍然是本地模式的首选方案，快速且 HMR 兼容
- **远程模式零依赖**：不需要引入 `@deno/loader` 等外部包
- **Bug 不再复发**：集中定义 `CORE_SUBPATHS`，新增子路径只需在一处更新
- **相对导入链完整支持**：`resolveId` 同时拦截虚拟模块内部的相对导入（Case 2）
- **源码缓存**：`jsrSourceCache` 避免重复网络请求

### Negative

- **运行时网络依赖**：远程模式下首次 load 需要 fetch JSR 源码，增加冷启动延迟
  - **缓解**：`jsrSourceCache` 确保每个模块只 fetch 一次；JSR CDN 速度快（< 100ms）
- **源码需可 fetch**：假设 JSR 上的源码 URL 可公开访问；私有包可能需要认证
  - **缓解**：LessJS 是开源框架，所有包都是公开的
- **`.js` → `.ts` 规范化假设**：依赖 Deno 的约定（导入用 `.js`，文件是 `.ts`）
  - **缓解**：这是 Deno 生态的标准做法，不太可能改变
- **插件数量增加**：从 5 个增加到 6 个
  - **缓解**：在本地模式下，`less:core-resolve` 的所有钩子提前返回，开销接近零

### Neutral

- `CORE_SUBPATHS` 映射表是两个模式的共享真相源（single source of truth）
- 虚拟模块 ID 格式 `\0lessjs:core/src/` 是内部约定，不对外暴露
- `createCoreResolvePlugin` 是工厂函数而非单例，因为需要捕获 `import.meta.url` 的值

## 参考

- [ADR 0015: 自动注入 @openelement/core 子路径 alias](.) — 自动 alias 生成本地模式的基础
- [Rollup Virtual Modules 约定](https://rollupjs.org/plugin-development/#conventions-for-plugin-hooks) — `\0` 前缀约定
- [Node.js ESM Loader](https://nodejs.org/api/esm.html) — 仅支持 `file://` 和 `data:` scheme
- [JSR Registry](https://jsr.io/) — Deno 的包注册中心
- [Fresh 2.0 `@deno/loader`](https://github.com/denoland/fresh) — 通用 Deno 模块加载器（参考方案）

---

_决策日期: 2026-05-11 | 版本: v0.10.3 | Bug #9 修复_
