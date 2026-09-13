---
title: 'ADR 0014: SSR Bundle 导出 renderRoute() — 消除 build-ssg.ts 的越权访问'
date: '2026-05-10'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**ACCEPTED** — v0.10.x 架构简化

## Context

ADR 0010/0011 将 SSG 构建从 `createServer() + ssrLoadModule()` 迁移到 `viteBuild(ssr:true, noExternal) + import()`，产出自包含 SSR bundle。`build-ssg.ts` 通过 `import(ssrBundlePath)` 加载 bundle，然后：

1. 调用 Hono `toSSG(app, ...)` 渲染默认 locale 的静态路由 ✅
2. 手动遍历路由，为每个 locale 和动态路由渲染额外页面 ❌

### 当前 i18n + 动态路由渲染的问题

`build-ssg.ts` 在渲染 locale 扩展和动态路由页面时，需要获取每个路由的 `tagName` 和 `ComponentClass`。但这两个信息的获取方式都存在问题：

#### 问题 1：正则提取 tagName（脆弱、侵入源码）

```ts
// build-ssg.ts L556-564
const src = readFileSync(routeSourcePath, 'utf-8');
const tagMatch = src.match(/export\s+const\s+tagName\s*=\s*['"]([^'"]+)['"]/);
```

- 读源码文件 + 正则解析 — 不是 API，是实现细节的逆向工程
- 如果用户用不同格式导出 tagName（间接引用、计算值），正则失败
- 构建工具不应该解析自己的输入源码来提取运行时信息

#### 问题 2：globalThis.customElements.get()（越权访问）

```ts
// build-ssg.ts L567-569
const ComponentClass = globalThis.customElements.get(tagName);
```

- `build-ssg.ts` 从外部读取 SSR bundle 内部通过副作用注册的全局数据
- 虽然这是 Web 标准 API，但调用位置在抽象边界之外——相当于"翻墙"进入 bundle 的内部状态
- 违背 ADR 0008/0011 "显式优于隐式"的原则

#### 问题 3：直接调用 renderDSD() + wrapInDocument()（越权操作）

```ts
// build-ssg.ts L619-631
const html = await renderDSDFn(tagName, ComponentClass, { ...params, locale }, { ... });
const fullHtml = wrapInDocumentFn(html, { title, lang, headExtras });
```

- `build-ssg.ts` 自己查找组件类、自己调渲染、自己包装 HTML — 全部是 SSR bundle 内部该做的事
- 每次 build-ssg.ts 需要新的渲染能力（如 renderer chain），都必须再"翻墙"获取

#### 问题 4：customElements.define 幂等补丁（外部修改全局状态）

```ts
// build-ssg.ts L304-321
const origDefine = globalThis.customElements?.define?.bind(globalThis.customElements);
globalThis.customElements.define = (name, ctor, options) => { ... };
```

- 从外部修改 Web 标准 API 的行为，影响整个 realm
- 这个补丁应该在 bundle 内部执行——只有 bundle 知道何时需要幂等

#### 问题 5：双作用域初始化（博客/i18n 数据）

```ts
// build-ssg.ts L349-368
// 先在 bundle scope 初始化
await module.initBlogData(blogOptions);
// 再在 file system scope 初始化（因为 await import() 创建了新的模块实例）
const fsContentModule = await import('@openelement/content');
await fsContentModule.initBlogData(blogOptions);
```

- `await import('@openelement/content')` 会创建独立的模块实例（不在 SSR bundle 内）
- 需要手动在两个作用域中同步状态 — ADR 0008 要消除的正是这类多实例问题
- 如果路由模块依赖虚拟模块（如 `virtual:less-nav`），`native import()` 直接失败

### 根本原因：抽象边界错误

```
┌─────────────────────────────────────┐
│        SSR Bundle (entry.js)       │
│  ┌───────────────────────────────┐  │
│  │  customElements registry      │  │
│  │  renderDSD()                   │  │
│  │  wrapInDocument()              │  │
│  │  所有路由模块 + 组件类           │  │
│  └───────────────────────────────┘  │
│         ↑ 被外部越权读取/调用        │
└─────────────────────────────────────┘
          ↑
┌─────────────────────────────────────┐
│       build-ssg.ts (外部)           │
│  globalThis.customElements.get()    │
│  readFileSync + regex (提取 tagName) │
│  renderDSDFn() + wrapInDocumentFn() │
│  customElements.define 幂等补丁     │
└─────────────────────────────────────┘
```

`build-ssg.ts` 扮演了两个角色：

1. **编排者**：决定渲染什么路径、写到哪个文件 ✅
2. **渲染执行者**：查找组件、调用渲染、包装 HTML ❌

角色 2 应该由 SSR bundle 内部承担。

## Decision

**将渲染能力封装为 SSR bundle 的显式导出**，让 `build-ssg.ts` 只做编排（路径枚举 + 文件写入），不再进入 bundle 内部。

### 新的抽象边界

```
┌─────────────────────────────────────┐
│        SSR Bundle (entry.js)       │
│                                     │
│  内部：                              │
│    customElements registry (Web API)│
│    renderDSD()                       │
│    wrapInDocument()                  │
│    所有路由模块 + 组件类               │
│    getStaticPaths() per route        │
│                                     │
│  导出（显式 API）：                    │
│    renderRoute(path, opts) → HTML   │
│    getStaticPaths(path) → params[]   │
│    routeInfo[]                       │
└─────────────────────────────────────┘
          ↓
┌─────────────────────────────────────┐
│       build-ssg.ts (外部)           │
│                                     │
│  只做编排：                            │
│    1. 哪些路径需要渲染？               │
│    2. 哪些 locale 需要扩展？          │
│    3. 结果写到哪个文件？               │
│                                     │
│  调用 bundle API：                    │
│    ssrBundle.renderRoute(path, opts) │
│    ssrBundle.getStaticPaths(path)    │
└─────────────────────────────────────┘
```

### 导出的 API 设计

```typescript
// SSR bundle 导出

/** 路由信息 — bundle 知道自己包含的所有路由 */
export interface RouteInfo {
  /** URL 模式，如 '/blog/:slug' 或 '/guide/dsd' */
  path: string;
  /** 注册的 Custom Element tag name */
  tagName: string;
  /** 是否为动态路由 */
  isDynamic: boolean;
  /** 动态路由的参数名 */
  paramNames: string[];
}

export const routeInfo: RouteInfo[];

/**
 * 渲染一个路由页面为完整 HTML。
 *
 * 内部使用 customElements.get() + renderDSD() + wrapInDocument()。
 * 调用者不需要知道组件类、tagName、或渲染细节。
 *
 * @param routePath - 路由路径模式（如 '/blog/:slug'）
 * @param options - 渲染选项
 * @returns 完整的 HTML 文档字符串
 */
export async function renderRoute(
  routePath: string,
  options?: {
    /** 动态路由参数（如 { slug: 'v0-8-0' }） */
    params?: Record<string, string>;
    /** i18n locale（如 'zh'） */
    locale?: string;
    /** HTML <title> */
    title?: string;
    /** HTML lang attribute */
    lang?: string;
    /** 额外 <head> 内容 */
    headExtras?: string;
  },
): Promise<string>;

/**
 * 获取动态路由的静态路径列表。
 *
 * 内部调用路由模块的 getStaticPaths()。
 * 只对 isDynamic: true 的路由有效。
 *
 * @param routePath - 路由路径模式（如 '/blog/:slug'）
 * @returns 参数组合列表
 */
export async function getStaticPaths(
  routePath: string,
): Promise<Array<Record<string, string>>>;
```

### 关键设计决策

#### 为什么导出 `renderRoute(path)` 而不是 `renderRoute(tagName)`

`build-ssg.ts` 工作的粒度是**路径**（path），不是 tagName。它遍历路由列表，对每个路径+locale 组合生成页面。tagName 是 bundle 内部的实现细节——调用者不应该需要知道它。

这也使得未来可以改变内部注册机制（比如不用 customElements 而用其他注册方式），而不影响调用方。

#### 为什么 `customElements` 是 Web 标准 API 的正确用法

在 ADR 讨论中，我们反复问"能不能干掉 `customElements`？"。答案是：

- **在 bundle 外部**：不应该直接使用。这是 ADR 0014 要消除的。
- **在 bundle 内部**：应该正常使用。Custom Elements Registry 是 Web Components 的标准基础设施，就如同 `document.createElement` 或 `fetch` 一样。

类比：你不会因为"用了 `document.createElement`"就觉得需要干掉它。`customElements` 在 bundle 内部的角色完全相同——它是 Web 平台提供的服务定位器（Service Locator），不是我们自己的全局变量。

#### 为什么不导出 N 个组件

导出 `routeRegistry = { 'page-dsd-guide': DsdGuidePage, ... }` 的问题是：

- N 随路由增长，接口不稳定
- 暴露了内部实现（组件类）
- 调用者仍需自己做 tagName → ComponentClass 映射 + 渲染调用

`renderRoute()` 封装了所有这些——接口大小为 1，永远不变。

#### 动态路由的 getStaticPaths() 如何处理

当前 `build-ssg.ts` 用 `await import(routeImportPath)` 加载动态路由模块来调用 `getStaticPaths()`。但路由模块可能依赖虚拟模块（如 `virtual:less-nav`），导致 native import 失败。

在新设计中，`getStaticPaths()` 从 bundle 内部获取——bundle 已经内联了所有路由模块，包括 `getStaticPaths` 函数。bundle 的 `getStaticPaths(routePath)` 导出在内部查找对应的路由模块并调用它。

这也解决了博客数据双作用域初始化问题：`getStaticPaths()` 在 bundle 内部执行时，自然使用 bundle 内的博客数据（同一模块作用域），无需外部手动初始化。

### 与已有 API 的关系

LessJS 已有 `renderDSDByName(tagName, props)` —— 它通过 `customElements.get(tagName)` 查找组件并渲染。`renderRoute(path, opts)` 是更高层的封装：

```
renderDSD(tagName, Cls, props)          ← 底层：已知组件类
renderDSDByName(tagName, props)         ← 中层：通过 registry 查组件类
renderRoute(path, opts)                 ← 高层：通过路径找组件 + 渲染 + 包装
```

三层共存在 bundle 内，各司其职。外部只调用高层 API。

### 代码变更

#### 1. `entry-renderer.ts` — 生成 routeInfo + renderRoute + getStaticPaths

在 SSG 模式下，在现有的 "SSG Utility Re-exports" 之后追加：

```ts
// --- Route info (build-ssg.ts needs this for path enumeration) ---
export const routeInfo = ${JSON.stringify(pageRoutes.map(r => ({
  path: r.path,
  tagName: r.tagName || r.defaultTagName,  // 编译时已知
  isDynamic: r.isDynamic,
  paramNames: r.paramNames,
})))};

// --- renderRoute: path → HTML (DSD-first) ---
export async function renderRoute(routePath, options = {}) {
  const info = routeInfo.find(r => r.path === routePath);
  if (!info) throw new Error('Route not found: ' + routePath);

  const { params = {}, locale, title = 'LessJS', lang = locale || 'en', headExtras = __headExtras || '' } = options;

  const html = await renderDSDByName(info.tagName, { ...params, locale }, { route: routePath, source: info.tagName });
  return wrapInDocument(html, { title, lang, headExtras });
}

// --- getStaticPaths: dynamic route → params[] ---
export async function getStaticPaths(routePath) {
  const info = routeInfo.find(r => r.path === routePath);
  if (!info || !info.isDynamic) return [];

  // 动态路由模块的 getStaticPaths 在 bundle 内已被内联
  // 直接查找并调用
  ${dynamicRoutes.map(r => {
    return `if (routePath === '${r.path}') return await ${r.varName}.getStaticPaths();`;
  }).join('\n  ')}
  return [];
}
```

#### 2. `build-ssg.ts` — 移除所有越权代码

**删除**：

- 正则提取 tagName（L556-566）
- `globalThis.customElements.get(tagName)` (L567-569)
- 直接调用 `renderDSDFn()` + `wrapInDocumentFn()` (L619-631, L433-442)
- `customElements.define` 幂等补丁 (L304-321)
- 博客数据双作用域初始化 (L346-368)
- `await import('@openelement/i18n')` 初始化 (L535-542)
- 动态路由的 `await import(routeImportPath)` (L387-388)

**替换为**：

```ts
const { renderRoute, getStaticPaths, routeInfo } = module;

// i18n locale expansion
for (const locale of locales) {
  for (const route of routeInfo) {
    if (route.isDynamic) {
      const paramsList = await getStaticPaths(route.path);
      for (const params of paramsList) {
        const html = await renderRoute(route.path, { params, locale, ... });
        // write to disk
      }
    } else {
      const html = await renderRoute(route.path, { locale, ... });
      // write to disk
    }
  }
}
```

#### 3. `customElements.define` 幂等补丁 — 移入 bundle 内部

在 `entry-renderer.ts` 生成的代码中，在 `customElements.define` 循环之前插入幂等补丁：

```ts
// Patch CustomElementRegistry.define to be idempotent in SSR
const _origDefine = customElements.define.bind(customElements);
customElements.define = (name, ctor, options) => {
  if (customElements.get(name)) return;
  try {
    _origDefine(name, ctor, options);
  } catch { /* already defined */ }
};
```

这样补丁在 bundle 内部执行，只影响 bundle 自己的注册行为，不污染外部 realm。

## Consequences

### Positive

- **彻底消除 globalThis 越权访问**：`build-ssg.ts` 不再直接读取 `customElements` registry
- **消除正则源码解析**：tagName 从 bundle 的显式导出获取，而非逆向工程
- **抽象边界清晰**：`build-ssg.ts` 只做编排（路径 + 文件），bundle 只做渲染（组件 + HTML）
- **customElements 在正确位置使用**：bundle 内部正常使用 Web 标准 API，外部不需要碰它
- **消除双作用域初始化**：博客/i18n 数据只在 bundle 作用域初始化一次
- **renderRoute 接口稳定**：1 个函数，不随路由数量增长
- **未来可扩展**：renderer chain、head 管理等渲染逻辑变更只影响 bundle 内部
- **DSD-first 对齐**："给我路径，给我 locale，我给你 HTML" — 这才是 DSD-first 框架该有的接口

### Negative

- **SSR bundle 体积微增**：新增 `routeInfo` 常量 + `renderRoute` + `getStaticPaths` 函数。预计增加 < 2KB，可忽略
- **renderRoute 丢失细粒度控制**：调用者不能自定义 `renderDSD` 的 `dsdOptions` 参数
  - **缓解**：可在 `renderRoute` 的 options 中增加 `dsdOptions` 透传；当前无使用场景
- **getStaticPaths 对动态路由硬编码 if/else**：每个动态路由生成一个 `if (routePath === ...)` 分支
  - **缓解**：动态路由数量通常 < 10，分支可接受；也可改为 routePath → module 的 map

### Neutral

- `toSSG(app, ...)` 仍然用于默认 locale 的静态路由渲染 — 这个用法正确且不变
- Hono app 对象仍然从 bundle 导出 — `build-ssg.ts` 用它调 `toSSG()`
- `renderDSD` / `renderDSDByName` / `wrapInDocument` 仍从 bundle 导出 — 供高级用例使用，但 `renderRoute` 是推荐入口

## 类似问题审计

在审查 `build-ssg.ts` 的越权模式时，发现以下同类问题：

### 已在本 ADR 中解决

| # | 问题                                     | 当前位置              | 修复方式                         |
| - | ---------------------------------------- | --------------------- | -------------------------------- |
| 1 | `globalThis.customElements.get()`        | build-ssg.ts L567     | → bundle 内部的 renderRoute()    |
| 2 | `readFileSync` + 正则提取 tagName        | build-ssg.ts L558-564 | → bundle 导出 routeInfo          |
| 3 | 直接调用 renderDSD + wrapInDocument      | build-ssg.ts L619-631 | → bundle 内部的 renderRoute()    |
| 4 | customElements.define 幂等补丁           | build-ssg.ts L304-321 | → 移入 bundle 内部               |
| 5 | 博客数据双作用域初始化                   | build-ssg.ts L346-368 | → bundle 内部的 getStaticPaths() |
| 6 | `await import('@openelement/i18n')` 初始化    | build-ssg.ts L535-542 | → bundle 内部处理                |
| 7 | 动态路由 `await import(routeImportPath)` | build-ssg.ts L387-388 | → bundle 内部的 getStaticPaths() |

### 值得关注但不在本 ADR 范围

| #  | 问题                                               | 位置                  | 建议                                    |
| -- | -------------------------------------------------- | --------------------- | --------------------------------------- |
| 8  | `await import('@openelement/content/sitemap')` 独立导入 | build-ssg.ts L851     | 可改为 bundle 导出，与 renderRoute 同源 |
| 9  | 客户端 manifest 读取 + 脚本注入                    | build-ssg.ts L676-698 | 纯文件 I/O，无越权，暂不处理            |
| 10 | PWA manifest + service worker 生成                 | build-ssg.ts L769-845 | 纯文件生成，无越权，暂不处理            |

## 参考

- [ADR 0008: 消除 createServer()、.less/ 临时文件与 globalThis 桥接](/blog/0008-eliminate-createserver-globalthis-bridges)
- [ADR 0010: 消除所有 .less/ 临时文件](/blog/0010-eliminate-all-dot-less-temp-files)
- [ADR 0011: 消除最后一个 globalThis 桥接](/blog/0011-eliminate-last-globalthis-via-closebundle)
- `packages/core/src/render-dsd.ts` — `renderDSDByName()` 已有的 registry 查找模式
- `packages/core/src/entry-renderer.ts` — SSR bundle 代码生成

---

_决策日期: 2026-05-10 | 版本: v0.10.0_
