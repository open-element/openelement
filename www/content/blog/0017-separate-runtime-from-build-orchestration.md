---
title: 'ADR 0017: 框架运行时与构建编排解耦 — 拆分 @openelement/adapter-vite'
date: '2026-05-11'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**ACCEPTED** — v0.11.0 架构重构

## Context

### 问题本质

Bug #11（`npm:` specifier 无法解析）暴露了一个更深层的架构问题：`@openelement/core` 同时承担了两个职责——

1. **框架运行时**：`renderDSD()`、`island()`、`escapeHtml()`、`adapterRegistry` 等纯逻辑
2. **构建编排**：Vite 插件集合、路由扫描、HMR、SSG 三阶段流水线

当 Vite 的 SSR runner 需要加载 `@openelement/core` 的源码时，它实际上只需要运行时部分。但因为是同一个包，Vite 不得不加载整个包——包括 Vite 插件 API 本身。这导致了一系列连锁问题：

```
@openelement/core 是一个 Vite Plugin
    ↓
JSR 发布后源码含 npm: specifier (Deno 生态语义)
    ↓
Vite SSR runner 不认识 npm: 协议
    ↓
需要 5 个补丁翻译 specifier + 路由解析
```

### 补丁清单（截至 v0.10.7）

| # | 补丁                          | 存在原因                                | 如果 core 不含 Vite 插件 |
| - | ----------------------------- | --------------------------------------- | ------------------------ |
| 1 | `less:core-resolve` resolveId | Vite 不认识 JSR 包的 `@openelement/core`     | 不需要                   |
| 2 | `load()` 从 JSR fetch 源码    | Vite SSR runner 不认识 `https://` URL   | 不需要                   |
| 3 | esbuild 编译 TS→JS            | 虚拟模块绕过了 Vite 的 transform 管线   | 不需要                   |
| 4 | npm: → bare 正则替换          | Vite 不认识 Deno 的 `npm:` specifier    | 不需要                   |
| 5 | resolveId Case 3 委托解析     | 虚拟模块无真实路径，找不到 node_modules | 不需要                   |

**如果 `@openelement/core` 只包含纯 Web Standard 运行时代码，这 5 个补丁全部不需要。** 因为运行时代码不会被 Vite 的 SSR runner 当作"源码"加载——它就是一段普通 ESM，Deno / Node / Bun / Edge 都能直接 `import`。

### 与已有架构模式的一致性

LessJS 已经有 `adapter-lit` 的先例：core 定义 `RenderAdapter` 接口，`adapter-lit` 实现 `LitRenderer`。构建编排层做同样的事情是自然的延伸——core 定义 `BuildAdapter` 接口，`adapter-vite` 实现 Vite 构建编排。

### 与 Fresh 的对比

| 维度       | Fresh       | LessJS（现状）      | LessJS（解耦后）         |
| ---------- | ----------- | ------------------- | ------------------------ |
| 运行时     | 纯 Deno     | 混在 Vite 插件里    | 纯 Web Std ESM           |
| 构建编排   | Deno native | Vite（绑定）        | 可插拔 adapter           |
| npm: 问题  | 不存在      | 需要 5 个补丁       | 不存在                   |
| 运行时兼容 | Deno only   | Deno + Node（勉强） | Deno / Node / Bun / Edge |

## Decision

### 方案：将 core 拆为运行时 + 构建适配器

```
@openelement/core          纯运行时，零 node:*，零 npm:，零 Vite 依赖
                      renderDSD / island / escape / adapter-registry / ...
                      标准 Web API：URL, fetch, import.meta.url, crypto
                      任何 ESM 运行时都能直接 import

@openelement/adapter-vite  Vite 构建编排适配器
                      less() → Plugin[]，路由扫描，HMR，SSG 三阶段
                      coreResolvePlugin（npm: 翻译，虚拟模块解析）
                      所有 node:* 和 Vite API 依赖都在这里
```

### 依赖图变化

```
Before:
  用户项目 → @openelement/app → @openelement/core (运行时 + Vite 编排混在一起)
                                       → @openelement/content
                                       → @openelement/i18n

After:
  用户项目 → @openelement/app → @openelement/core (纯运行时)
                          → @openelement/adapter-vite (构建编排)
                          → @openelement/content
                          → @openelement/i18n
```

### 代码拆分边界

#### @openelement/core（保留，纯化）

```
packages/core/src/
  ├── render-dsd.ts          ← 纯字符串拼接
  ├── render-nested.ts       ← 纯字符串 + parse5
  ├── html-escape.ts         ← 纯字符串处理
  ├── island.ts              ← 纯逻辑
  ├── adapter-registry.ts    ← 纯 Map
  ├── navigation.ts          ← 纯 URL + popstate
  ├── logger.ts              ← 纯 console
  ├── errors.ts              ← 纯 Error 类
  ├── context.ts             ← 纯逻辑
  ├── types.ts               ← 纯类型定义
  └── index.ts               ← 导出汇总，零 Vite 依赖
```

- **零** `node:*` import（`node:path`, `node:process`, `node:url` 全移走）
- **零** `import type { Plugin } from 'vite'`
- **零** `npm:` / `deno:` 依赖
- `parse5` 是唯一的外部依赖（纯 JS HTML parser，所有运行时都支持）

#### @openelement/adapter-vite（新包）

```
packages/adapter-vite/src/
  ├── index.ts               ← less() 入口，返回 Plugin[]
  ├── build.ts               ← SSG 三阶段流水线
  ├── build-context.ts       ← LessBuildContext（构建元数据）
  ├── build-manifest.ts      ← 构建产物扫描
  ├── hono-entry.ts          ← 虚拟入口代码生成
  ├── island-transform.ts    ← island 标记转换
  ├── island-manifest.ts     ← island 清单生成
  ├── route-scanner.ts       ← 文件系统路由扫描
  ├── ssg-postprocess.ts     ← SSG 后处理
  └── core-resolve.ts        ← npm: 翻译 + 虚拟模块解析（原 5 个补丁）
```

- 所有 `node:*` import 在这里
- Vite Plugin API 在这里
- `coreResolvePlugin` 在这里（只处理用户项目代码的 specifier，不再需要处理框架自身的）

### BuildAdapter 接口（可选）

如果未来要支持非 Vite 构建工具（Deno native build、esbuild），core 可以定义一个最小接口：

```ts
// @openelement/core — 可选，按需引入
export interface BuildAdapter {
  name: string;
  build(options: BuildOptions): Promise<BuildResult>;
  dev(options: DevOptions): Promise<DevServer>;
}
```

但这是**远期目标**，不是这次拆分必须做的。第一次拆分只需要把 Vite 代码搬出 core，不改变用户 API。

### 用户迁移

```ts
// Before
import { less } from '@openelement/core';
import { lessjs } from '@openelement/app';

// After（方案 A：最小变化）
import { less } from '@openelement/adapter-vite'; // 构建编排
import { island, renderDSD } from '@openelement/core'; // 运行时（不变）
import { lessjs } from '@openelement/app'; // 不变

// After（方案 B：app 内部重导出，用户零改动）
import { lessjs } from '@openelement/app'; // app 内部改为 import adapter-vite
```

**推荐方案 B**：`@openelement/app` 内部重导出 `less()`，用户代码零改动。只有直接 `import { less } from '@openelement/core'` 的用户需要改路径。

### 包数量变化

9 个包 → 10 个包。新增 `@openelement/adapter-vite`。

发布顺序更新：

```
rpc → ui → adapter-lit → signal → content → i18n → core → adapter-vite → app → create
```

## 替代方案

### A. 不拆，继续打补丁

现状维持。每次遇到新的 Deno/Vite 语义冲突就加补丁。

- 优点：零改动，零迁移成本
- 缺点：补丁会持续增长（Bug #11 是第 6 次复发），core 越来越难维护，运行时被锁在 Vite 生态

### B. 拆分（本 ADR 提案）

- 优点：5 个补丁不再需要碰到框架本身，core 纯净可移植，未来可支持非 Vite 构建工具
- 缺点：多一个包，用户 import 路径可能变化，需要一次性的拆分工作

### C. 彻底脱离 Vite，Deno native 全栈（Fresh 模式）

- 优点：架构最干净，零补丁，与 Deno 生态零摩擦
- 缺点：放弃 Vite HMR + 插件生态，目标用户缩小到 Deno 开发者，工作量巨大

## Consequences

### Positive

- **5 个补丁自然失效**：core 不含 Vite 插件，不需要被 SSR runner 当源码加载，specifier 翻译问题消失
- **core 可移植**：纯 Web Std ESM，Deno / Node 18+ / Bun / Cloudflare Workers / Vercel Edge 都能直接 import
- **架构与 adapter-lit 一致**：渲染有 `RenderAdapter`，构建有 `BuildAdapter`，模式统一
- **未来可扩展**：`@openelement/adapter-deno`、`@openelement/adapter-esbuild` 可按需实现
- **职责清晰**：core 只关心"怎么渲染"，adapter 只关心"怎么构建"

### Negative

- **多一个包**：9 → 10，发布流程多一步
- **迁移成本**：直接 `import { less } from '@openelement/core'` 的用户需改为 `@openelement/adapter-vite`
- **core-resolve 补丁仍在 adapter-vite 中**：但管辖范围缩小——只处理用户项目代码的 specifier，不处理框架自身
- **parse5 仍是外部依赖**：core 的 render-nested.ts 依赖 parse5，这是纯 JS 库但仍是 npm 包。如果追求零 npm 依赖，需要自行实现一个最小 HTML parser 或将 render-nested 也拆出

### Neutral

- `@openelement/app` 可以重导出 `less()`，让大多数用户无感迁移
- `BuildAdapter` 接口是可选的远期目标，不影响本次拆分
- 包名 `adapter-vite` 遵循已有的 `adapter-lit` 命名惯例

## 参考

- [ADR 0016: 双模式子路径解析](/blog/0016-dual-mode-subpath-resolution) — 当前补丁方案的完整描述
- [ADR 0012: 拆分 @openelement/app](/blog/0012-extract-lessjs-umbrella-to-app-package) — 类似的"拆分以消除依赖倒挂"决策
- [Fresh 2.0](https://github.com/denoland/fresh) — Deno native 构建框架的参考实现

---

_提出日期: 2026-05-11 | 状态: ACCEPTED | 实施版本: v0.11.0_
