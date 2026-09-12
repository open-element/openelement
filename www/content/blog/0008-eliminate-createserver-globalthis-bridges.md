---
title: 'ADR 0008: 消除 createServer()、.less/ 临时文件与 globalThis 桥接'
date: '2026-05-10'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**IMPLEMENTED** — v0.9.x 架构重构（通过 ADR 0010/0011/0012 分步实施完成）

## Context

LessJS 当前的 SSG 构建管线存在三类耦合机制，它们互相依赖，形成了一个"临时文件 + 全局状态桥接 + Vite Dev Server 中转"的三角耦合：

### 1. 构建管线：3 次 Vite 调用

```
Phase 1: viteBuild(client)      → 产出客户端 JS/CSS
Phase 2: viteBuild(ssr:true)    → 产出 SSR bundle（但未实际消费）
Phase 3: createServer(ssr)      → 用 Vite Dev Server 的 ssrLoadModule() 消费 SSR 代码
```

`createServer()` 的存在是为了解决 **Vite 模块多实例问题**：当 `viteBuild(ssr:true)` 产出 SSR bundle 后，如果用 Deno 的 `import()` 加载，会产生与 Phase 1 不同的模块实例，导致 `registerAdapter()` 注册的 adapter 对 `renderDSD()` 不可见。`createServer()` 通过 Vite 自身的 `ssrLoadModule()` 共享模块图，绕过了这个问题。

**代价**：`createServer()` 启动一个完整的 Vite Dev Server，仅用于调用 `ssrLoadModule()`，资源浪费严重；且引入了 `globalThis.module` / `globalThis.exports` 的 CJS 兼容 shim（Phase 3 L221-223）。

### 2. .less/ 临时文件：8+ 文件的 IPC 管道

Vite 插件的各个 Phase 运行在不同的 Vite 实例中，无法直接共享 JS 对象。当前用 `.less/` 目录作为文件系统的 IPC 管道：

| 文件                          | 写入方                         | 读取方                          | 用途                 |
| ----------------------------- | ------------------------------ | ------------------------------- | -------------------- |
| `.less/blog-options.json`     | `@openelement/content` buildStart() | `build-ssg.ts` Phase 3          | 传递博客配置         |
| `.less/nav-data.json`         | `@openelement/content` buildStart() | `build-ssg.ts` Phase 3 虚拟模块 | 传递导航数据         |
| `.less/header-nav.json`       | `@openelement/content` buildStart() | `build-ssg.ts` Phase 3 虚拟模块 | 传递顶部导航         |
| `.less/sitemap-options.json`  | `@openelement/content` buildStart() | `build-ssg.ts` Phase 3          | 传递站点地图配置     |
| `.less/i18n-options.json`     | `@openelement/i18n` buildStart()    | `build-ssg.ts` Phase 3          | 传递国际化配置       |
| `.less/head-extras.html`      | `build-ssg.ts` Phase 前置      | 生成的 entry 代码运行时         | 传递 headExtras HTML |
| `.less/.less-runtime.ts`      | `less()` configResolved()      | Vite resolve alias              | 运行时 shim          |
| `.less/.less-ssg-entry.ts`    | `build-ssg.ts` Phase 前置      | Vite 入口                       | SSG 入口代码         |
| `.less/.less-client-entry.ts` | `build-ssg.ts`                 | Vite 入口                       | 客户端入口代码       |
| `.less/build-metadata.json`   | `less()` closeBundle()         | `build-ssg.ts` Phase 前置       | 岛屿清单             |

**问题**：文件系统 IPC 脆弱（文件可能缺失、格式错误、编码问题），且这些数据本可以在构建时内联到 SSR bundle 中。

### 3. globalThis[Symbol.for()] 桥接：3 个跨实例桥

| Symbol Key                                   | 所在文件                   | 用途                           |
| -------------------------------------------- | -------------------------- | ------------------------------ |
| `Symbol.for('lessjs:adapter')`               | `core/types.ts` L306       | 跨实例共享注册的 RenderAdapter |
| `Symbol.for('lessjs:content:posts')`         | `content/blog-data.ts` L22 | 跨实例共享博客文章数据         |
| `Symbol.for('lessjs:content:options')`       | `content/blog-data.ts` L23 | 跨实例共享博客配置             |
| `Symbol.for('lessjs:lit-adapter-installed')` | `adapter-lit/ssr.ts` L465  | 跨实例幂等性守卫               |

**为什么需要**：Vite SSR 可能将同一个包解析为不同的模块实例（通过 resolveAlias、symlinks、或 `ssr.noExternal` 不完整），导致模块作用域变量不共享。`Symbol.for()` 保证同一 realm 内返回相同的 Symbol，使 `globalThis[KEY]` 成为可靠的跨实例桥。

**对比**：`@openelement/i18n` 的 `i18n-data.ts` 使用纯模块变量 `_options`，**没有 globalThis 耦合**——这是更干净的模式。

### 4. 额外发现的耦合模式

审计中发现的超出原始范围的耦合：

#### 4a. runtime-shim.ts 机制 — 字符串化的代码重复

`packages/core/scripts/generate-runtime-shim.ts`（223 行）使用 TypeScript AST 从源文件中提取函数，编译为 JS，拼成一个巨型字符串 `createRuntimeShimCode()`。这个字符串被写入 `.less/.less-runtime.ts`，通过 Vite resolve alias 指向。

**问题**：这是源代码的手工同步副本。当 `render-dsd.ts`、`html-escape.ts`、`render-nested.ts` 的签名或行为变化时，必须运行 generator 脚本重新生成，否则运行时行为与源码不一致。ADR 0006 将此列为 P2 技术债。

#### 4b. entry-renderer.ts 的 headExtras 文件读取

`packages/core/src/entry-renderer.ts` L348-362：SSG 模式下，生成的 entry 代码在运行时 `readFileSync('.less/head-extras.html')`，而不是在构建时内联。原因注释说是为了避免大字符串破坏 Vite SSR 的 `AsyncFunction` 求值器。

**问题**：这个限制仅在 `createServer()` + `ssrLoadModule()` 路径下存在。如果改为 `viteBuild(ssr:true)` + `import()` 路径，headExtras 可以作为构建时常量内联到 bundle 中。

#### 4c. Symbol.for('lit-nothing') — 跨实例 Lit 值检测

在 `adapter-lit/ssr.ts` 中，检测 Lit 的 `nothing` 值时使用 `Symbol.for('lit-nothing')`，同样是跨实例桥。bundle 化后只有一个 Lit 实例，此桥不再必要。

## Decision

### 核心洞察

当 `viteBuild(ssr:true)` 配合 `noExternal` 产出 **自包含 ESM bundle** 时，上述所有耦合机制变得不必要：

- **所有虚拟模块在编译时解析** → 不再需要 `createServer()` 运行时解析
- **bundle 内只有一个模块实例** → `globalThis[Symbol.for()]` 桥接退化为普通模块变量
- **所有数据在编译时内联** → `.less/` 临时文件 IPC 消除
- **bundle 直接 `import()` 消费** → runtime-shim 字符串化机制不再需要

### 新构建管线

```
Phase 1: viteBuild(ssr:true, noExternal) → 产出自包含 SSR bundle (dist/server/entry.js)
Phase 2: import('./dist/server/entry.js')  → 直接消费 SSR bundle 渲染页面
Phase 3: viteBuild(client)                → 产出客户端 JS/CSS
```

**关键变化**：

- 3 次 Vite 调用 → 2 次（SSR bundle 真正被消费）
- `createServer()` → 消除
- `.less/` 临时文件 → 0（数据内联到 bundle）
- `globalThis[Symbol.for()]` → 0（模块作用域变量）
- `runtime-shim` 字符串 → 直接导入 `less-runtime`

### 耦合消除映射表

| 耦合机制                                                 | 当前用途                     | 重构后为何不必要                            |
| -------------------------------------------------------- | ---------------------------- | ------------------------------------------- |
| `createServer()`                                         | 运行时虚拟模块解析           | 虚拟模块在 `viteBuild` 编译时解析           |
| `globalThis.module` / `globalThis.exports` shim          | createServer 的 CJS 兼容     | createServer 消除                           |
| `globalThis[Symbol.for('lessjs:adapter')]`               | 跨实例共享 adapter           | bundle 单实例，模块变量即可                 |
| `globalThis[Symbol.for('lessjs:content:posts')]`         | 跨实例共享博客数据           | bundle 单实例，模块变量即可                 |
| `globalThis[Symbol.for('lessjs:content:options')]`       | 跨实例共享博客配置           | bundle 单实例，模块变量即可                 |
| `globalThis[Symbol.for('lessjs:lit-adapter-installed')]` | 跨实例幂等守卫               | bundle 单实例，单次执行                     |
| `.less/blog-options.json`                                | IPC：content 插件 → SSG      | 数据内联到 SSR bundle                       |
| `.less/nav-data.json`                                    | IPC：content 插件 → 虚拟模块 | `virtual:less-nav` 编译时解析               |
| `.less/header-nav.json`                                  | IPC：content 插件 → 虚拟模块 | 编译时解析                                  |
| `.less/sitemap-options.json`                             | IPC：content 插件 → SSG      | 数据内联到 SSR bundle                       |
| `.less/i18n-options.json`                                | IPC：i18n 插件 → SSG         | 数据内联到 SSR bundle                       |
| `.less/head-extras.html`                                 | IPC：entry 代码 → 运行时读取 | 构建时常量内联到 bundle                     |
| `.less/.less-runtime.ts`                                 | 运行时 shim 文件             | `virtual:less-runtime` 替代物理文件 + alias |
| `.less/.less-ssg-entry.ts`                               | SSG 入口文件                 | 虚拟模块或 inline                           |
| `.less/.less-client-entry.ts`                            | 客户端入口文件               | 虚拟模块或 inline                           |
| `.less/build-metadata.json`                              | 岛屿清单 IPC                 | 编译时内联                                  |
| `createRuntimeShimCode()`                                | 避免加载 Vite 插件依赖图     | bundle 直接引用 virtual:less-runtime        |
| `less:ssg-virtual-nav` 插件                              | createServer 的虚拟模块桥接  | createServer 消除                           |
| `Symbol.for('lit-nothing')`                              | 跨实例 Lit nothing 检测      | bundle 单实例                               |

### 重构步骤（4 个 Phase）

#### Phase A: 将 .less/ 临时文件 IPC 替换为编译时内联

**目标**：消除所有 `.less/*.json` 和 `.less/head-extras.html`。

1. **重构 `entry-renderer.ts`**：将 headExtras 作为 `define` 常量注入到 SSR bundle，而非运行时读取文件。在 `viteBuild` 配置中通过 `define: { '__LESS_HEAD_EXTRAS__': JSON.stringify(headExtras) }` 注入。

2. **重构 `@openelement/content` 插件**：不再写 `.less/blog-options.json`、`.less/nav-data.json`、`.less/header-nav.json`、`.less/sitemap-options.json`。改为在 Vite `config()` hook 中通过 `define` 注入构建时常量：
   ```ts
   // 之前：写入 .less/blog-options.json
   // 之后：通过 Vite define 注入
   config() {
     return {
       define: {
         '__LESS_BLOG_OPTIONS__': JSON.stringify(blogOptions),
         '__LESS_NAV_DATA__': JSON.stringify(navSections),
         '__LESS_HEADER_NAV__': JSON.stringify(headerNav),
         '__LESS_SITEMAP_OPTIONS__': JSON.stringify(sitemapOptions),
       }
     };
   }
   ```

3. **重构 `@openelement/i18n` 插件**：同样改为 `define` 注入 `__LESS_I18N_OPTIONS__`。

4. **重构 `virtual:less-nav`**：改为从 `__LESS_NAV_DATA__` / `__LESS_HEADER_NAV__` 构建时常量导出，而非从 `.less/nav-data.json` 读取。

5. **重构 `build-ssg.ts`**：移除所有 `readFileSync('.less/*.json')` 调用，改为从构建时注入的常量或 bundle 导出获取数据。

#### Phase B: 将 globalThis[Symbol.for()] 桥接替换为模块变量

**目标**：所有 `globalThis` 桥接退化为普通模块作用域变量，与 `i18n-data.ts` 的干净模式对齐。

1. **`core/types.ts`**：
   ```ts
   // 之前
   const ADAPTER_KEY = Symbol.for('lessjs:adapter');
   export function registerAdapter(adapter) {
     globalThis[ADAPTER_KEY] = adapter;
   }
   export function getAdapter() {
     return globalThis[ADAPTER_KEY];
   }

   // 之后
   let _adapter: RenderAdapter | undefined;
   export function registerAdapter(adapter) {
     _adapter = adapter;
   }
   export function getAdapter() {
     return _adapter;
   }
   ```

2. **`content/blog-data.ts`**：
   ```ts
   // 之前
   const BLOG_POSTS_KEY = Symbol.for('lessjs:content:posts');
   const BLOG_OPTIONS_KEY = Symbol.for('lessjs:content:options');
   // ... globalThis 桥接 ...

   // 之后
   let _posts: BlogPost[] = [];
   let _options: LessBlogOptions = {};
   // 直接读写模块变量
   ```

3. **`adapter-lit/ssr.ts`**：
   ```ts
   // 之前
   const INSTALLED_KEY = Symbol.for('lessjs:lit-adapter-installed');
   if (globalThis[INSTALLED_KEY]) return;

   // 之后
   let _installed = false;
   if (_installed) return;
   _installed = true;
   ```

#### Phase C: 消除 createServer()，改为 viteBuild + import()

**目标**：SSR bundle 真正被消费，而非仅产出后丢弃。

1. **`build-ssg.ts` 核心变更**：
   ```ts
   // 之前（3 阶段）
   await viteBuild(clientConfig); // Phase 1
   await viteBuild(ssrConfig); // Phase 2（产出但未消费）
   const server = await createServer(ssrServerOpts); // Phase 3（消费）
   await server.ssrLoadModule('...');
   await server.close();

   // 之后（2 阶段）
   await viteBuild(ssrConfig); // Phase 1：产出 SSR bundle
   const ssrBundle = await import('./dist/server/entry.js'); // Phase 2：直接消费
   await viteBuild(clientConfig); // Phase 3：产出客户端
   ```

2. **移除 `less:ssg-virtual-nav` 插件**：虚拟模块在 `viteBuild` 编译时已解析，不再需要运行时桥接。

3. **移除 `globalThis.module` / `globalThis.exports` CJS shim**：不再使用 `createServer()`，无需 CJS 兼容。

4. **移除 `customElements.define` 拦截的 `server` 依赖**：`build-ssg.ts` L295-307 的 `customElements.define` 幂等补丁改为在 bundle 入口代码中执行。

5. **移除 `server.ssrLoadModule()` 的所有调用**：改用 `import()` 加载 bundle 导出的函数。这包括：
   - L285: `server.ssrLoadModule('@openelement/adapter-lit')` → bundle 入口自动执行 `installLitAdapter()`
   - L345-350: `server.ssrLoadModule('@openelement/core/render-dsd')` → 从 bundle 导入
   - L371: `server.ssrLoadModule('@openelement/content')` → 从 bundle 导入
   - L537-542: `server.ssrLoadModule('@openelement/core/render-dsd')` → 从 bundle 导入
   - L557: `server.ssrLoadModule('@openelement/i18n')` → 从 bundle 导入
   - L868: `server.ssrLoadModule('@openelement/content/sitemap')` → 从 bundle 导入

6. **调整 SSR 构建顺序**：SSR 构建移到客户端构建之前（先产出 bundle → 消费渲染 → 再产出客户端资源）。

#### Phase D: 消除 runtime-shim 机制

**目标**：`.less/.less-runtime.ts` 和 `createRuntimeShimCode()` 不再需要。

1. **SSR bundle 直接 import `virtual:less-runtime`**：当 bundle 自包含时，`@openelement/core/less-runtime` 路径由 Vite 插件的 `resolveId` hook 拦截并指向 `virtual:less-runtime`，该虚拟模块从各源文件 re-export（`registerAdapter` from `adapter-registry.ts`、`renderDSD` from `render-dsd.ts`、`wrapInDocument` from `html-escape.ts`、`log` from `logger.ts`）。

2. **移除 `generate-runtime-shim.ts` 脚本**：AST 提取 + 编译 + 字符串化的机制不再需要。

3. **移除 `runtime-shim.ts`**：巨型字符串常量不再需要。

4. **移除 `less()` 插件中的 `.less/.less-runtime.ts` 写入逻辑**（`index.ts` L199-208）及相关的 `writeFileSync` + `userResolveAlias` + `resolve.alias` 配置（L183-217），全部由 `virtual:less-runtime` 的 `resolveId`/`load` hook 替代。

5. **删除物理 `less-runtime.ts` 文件**：不再需要物理 re-export 文件，`virtual:less-runtime` 在插件中集中声明 re-export 映射。消费者 import 路径 `@openelement/core/less-runtime` 保持不变，由插件自动拦截。

6. **移除 `export { Hono } from 'hono'`**：第三方包不应通过 runtime 中间层 re-export，消费者直接 `import { Hono } from 'hono'`。

### 风险与缓解

| 风险                                           | 影响                                         | 缓解                                                     |
| ---------------------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| SSR bundle 体积过大                            | `noExternal` 将 lit/parse5/entities 全部打包 | 当前 `createServer()` 也是全量加载，体积不减             |
| `import()` 在 Deno 中路径解析                  | Deno 的 `import()` 不支持所有 Node 路径      | 使用绝对路径 `import(resolve('./dist/server/entry.js'))` |
| `define` 注入大字符串（headExtras）            | JSON.stringify 大字符串可能影响构建性能      | headExtras 通常 < 10KB，可接受；若超限可 split chunk     |
| Sitemap 生成依赖 `ssrLoadModule`               | 改为从 bundle 导入 `generateSitemap`         | bundle 已包含 `@openelement/content/sitemap`                  |
| `viteBuild(ssr:true)` 不解析虚拟模块           | 需要确保 SSR 构建配置包含所有插件            | SSR 构建应复用用户的 Vite 配置 + 所有插件                |
| Phase B 单独执行时可能破坏 `createServer` 路径 | 模块变量在 `ssrLoadModule` 下仍可能多实例    | Phase B 应与 Phase C 同步执行，或先做 Phase C            |

### 建议执行顺序

**推荐**：先 C 后 B，再 A，最后 D。理由：

1. **Phase C 优先**：消除 `createServer()` 是所有其他变更的前提。只有 bundle 被直接消费后，globalThis 桥接和文件 IPC 才能安全移除。
2. **Phase B 与 C 同步**：`createServer()` 消除后，globalThis 桥接自动变得不必要，应同步清理。
3. **Phase A 紧随**：`.less/` 临时文件可以改为 `define` 注入，但需要确认 SSR 构建配置能正确传递这些 `define`。
4. **Phase D 最后**：runtime-shim 消除依赖前面所有 Phase 完成，是纯清理工作。

### 预期收益

| 指标                        | 当前                    | 重构后                  |
| --------------------------- | ----------------------- | ----------------------- |
| Vite 调用次数               | 3                       | 2                       |
| `createServer()`            | 有                      | 无                      |
| `.less/` 临时文件           | 8+                      | 0                       |
| `globalThis` 桥接键         | 4                       | 0                       |
| SSR bundle 是否被消费       | 否（产出后丢弃）        | 是（直接 import）       |
| `runtime-shim` 字符串化     | 有（手工同步）          | 无                      |
| `less:ssg-virtual-nav` 插件 | 有                      | 无                      |
| CJS 兼容 shim               | 有                      | 无                      |
| 构建管线复杂度              | 高（3 阶段 + 文件 IPC） | 低（2 阶段 + 内存传递） |

## Consequences

**正面：**

- 构建管线从 3 阶段简化到 2 阶段，概念复杂度大幅降低
- 消除文件系统 IPC，消除"文件缺失/格式错误/编码问题"类的间歇性 bug
- 消除 `globalThis` 污染，SSR 运行更加干净
- 消除 runtime-shim 手工同步问题，SSR 输出与源码一致
- SSR bundle 真正被消费，不再"产出后丢弃"
- 为后续增量构建（ISR）奠定基础：bundle 可缓存

**负面：**

- 一次性重构量大，需谨慎分 Phase 执行
- SSR bundle 的 `import()` 路径在不同运行时（Deno/Node）下行为可能不同
- `define` 注入的方式需要在 SSR 构建配置中正确传递所有插件定义

**缓解：**

- 严格按 Phase 执行，每个 Phase 完成后运行全量测试
- SSR bundle 使用绝对路径 `import()`，兼容 Deno 和 Node
- 保留 `.less/` 目录作为构建缓存（如增量构建 hash），但不作为 IPC

## 参考

- [ADR 0005: WithDsdHydration Mixin](/blog/0005-with-dsd-hydration-mixin)
- [ADR 0006: 版本号策略](/blog/0006-version-strategy)
- `packages/core/src/cli/build-ssg.ts` — 当前 SSG 构建主文件
- `packages/core/src/types.ts` — adapter 全局桥定义
- `packages/content/src/blog/blog-data.ts` — blog 全局桥定义
- `packages/adapter-lit/src/ssr.ts` — Lit adapter 幂等守卫
- `packages/i18n/src/i18n-data.ts` — 干净模式参考（无 globalThis）

---

_决策日期: 2026-05-10 | 版本: v0.9.0_

## Implementation Summary

本 ADR 的各 Phase 通过后续 ADR 分步实施完成：

| Phase | 描述                                              | 实施 ADR                   | 状态    |
| ----- | ------------------------------------------------- | -------------------------- | ------- |
| A     | .less/ 临时文件 IPC → LessBuildContext + 虚拟模块 | ADR 0010                   | ✅ 完成 |
| B     | globalThis[Symbol.for()] → 模块变量               | ADR 0011 (部分) + ADR 0012 | ✅ 完成 |
| C     | 消除 createServer()，改为 closeBundle 内联        | ADR 0011                   | ✅ 完成 |
| D     | runtime-shim → virtual:less-runtime               | ADR 0010 (Step 1)          | ✅ 完成 |
| E     | lessjs() 统一入口 → 拆到 @openelement/app              | ADR 0012                   | ✅ 完成 |

### 最终指标

| 指标                    | ADR 0008 提出时         | 当前                              |
| ----------------------- | ----------------------- | --------------------------------- |
| `createServer()`        | 有                      | **无**                            |
| `.less/` 临时文件       | 8+                      | **0**                             |
| `globalThis` 桥接键     | 4                       | **0**                             |
| `runtime-shim` 字符串化 | 有                      | 无（使用 virtual:less-runtime）   |
| 构建管线                | 3 阶段 + 文件 IPC       | 1 次 viteBuild + closeBundle 内联 |
| ctx 传递                | globalThis 隐式共享     | 显式参数传递                      |
| `lessjs()` 入口         | 在 core 中，动态 import | 在 @openelement/app 中，静态 import    |
