---
title: 'LessJS 架构分析报告'
date: '2026-05-13'
lang: 'zh'
type: 'post'
tags: ['architecture', 'analysis']
draft: false
---

# LessJS 架构分析报告

> 日期：2026-05-13
> 目标：E S M 原生 + DSD 驱动 + Vite 可选的 SSG 框架可行性分析

---

## 一、核心三问：DSD 能去依赖吗？ESM SSG 可行吗？项目能更干净吗？

### 1.1 DSD 已经零依赖

`packages/core/src/render-dsd.ts` 的依赖链：

```
render-dsd.ts
  ├── html-escape.ts           ← core 内部（纯函数，零依赖）
  ├── types.ts                 ← core 内部（interface 定义）
  ├── adapter-registry.ts      ← core 内部（单例 Map）
  ├── render-nested.ts         ← core 内部（递归 DSD）
  └── logger.ts                ← core 内部（console wrapper）
```

**没有 Lit，没有 Vite，没有 node:*，没有 npm: 前缀。**  
所有 DSD 渲染是纯字符串拼接 + `async/await`。用户组件只要写 `render(): string`，就不需要 Lit。

Lit 只通过 `@openelement/adapter-lit` 的 `installLitAdapter()` 注入——用户主动调用才激活。如果用原生 Web Components（`render(): string`）或者 Lit 之外的框架，整套管线不需要 Lit。

**结论：DSD 已经做到了你想要的——核心依赖为零，Lit 可选。**

### 1.2 ESM SSG 可行，且解决真实摩擦

当前 Phase 3 的流程：

```
closeBundle (Vite plugin)
  → viteBuild(ssr:true, noExternal:true)     ← 用 Vite 产出一个自包含的 SSR bundle
  → register SSR bundle from disk             ← 用 import() 加载
  → render all pages                           ← 纯 DSD 渲染
  → write HTML files                           ← 纯文件写入
```

**第 1 步和第 2 步耦合了 Vite**。改成 ESM 模式的关键变化：

```
当前（Vite 强耦合）                      ESM 模式（Vite 可选）
─────────────────                      ─────────────────
Phase 1:                                  Phase 1:
  scanRoutes()  ← 纯 TS，无 Vite             scanRoutes()  ← 不变
  genHonoEntry() ← 纯字符串拼接              genHonoEntry() ← 不变
  viteBuild(ssr, noExternal) ↓              esbuild --format=esm ↓
  → ssr/server/entry.js                      → ssr/server/entry.mjs
                                            + ssr/importmap.json   ← NEW

Phase 2:                                  Phase 2:
  viteBuild(client islands)                  viteBuild(client islands)
  ← 保留 Vite/esbuild/rolldown               ← 保留，仅打包时用

Phase 3:                                  Phase 3:
  register('./dist/server/entry.js')         register('./dist/server/entry.mjs')
  renderAll(routes)                          renderAll(routes)  
  ← 在 closeBundle 里跑                       ← 独立 CLI，不依赖 Vite
```

**新增的 `importmap.json`**：

```json
// ssr/importmap.json — Phase 1 生成 SSR bundle 时自动产出
{
  "imports": {
    "hono": "https://jsr.io/@hono/hono/4.7.0/mod.ts",
    "lit": "npm:lit@3.3.2",
    "@openelement/core": "npm:@jsr/lessjs__core@0.13.0",
    "@openelement/core/logger": "npm:@jsr/lessjs__core@0.13.0/logger",
    "@openelement/adapter-lit": "npm:@jsr/lessjs__adapter-lit@0.8.0"
  }
}
```

加载方式（任意 runtime）：

```js
// Node.js / Deno / Bun — 都行
const ssrBundle = await import('./dist/server/entry.mjs');
// 配合 importmap 解析
const routes = ssrBundle.getRoutes();
for (const route of routes) {
  const html = await ssrBundle.render(route);
  writeFileSync(`dist/${route.path}.html`, html);
}
```

**为什么这解决了 `npm:` vs `jsr:` 的坑？**  
因为 SSR bundle 不再依赖"构建环境的隐式 import map"，而是**自己带一份明文 import map**。不管用户用 `jsr:@openelement/app` 还是 `npm:@jsr/lessjs__app` 还是 workspace，Phase 3 都读这份 sidecar import map 来解析 bare specifier。

### 1.3 项目能更干净吗？能，但不碰伤筋动骨的东西

当前项目的脏点：

| 脏点 | 描述 | 改的成本 |
|------|------|---------|
| `closeBundle` 里塞了整个 Phase 3 | SSG 逻辑不该是 Vite 插件的一个 hook handler | 中（1d 抽出 CLI） |
| `@hono/vite-dev-server` 作为生产依赖 | dev-only 的包卡了安装流程 | 小（0.5d 改为 optional dep） |
| `BuildSSGOptions` 的默认值从 ctx 和 options 两处读取 | 同个值有两个源，优先级靠"如果 CLI 传了就覆盖" | 中（1d 统一为单一 options 对象） |
| `allNoExternal` 列表硬编码 lit/parse5 等 | 用户想加自定义 adapter 时不知道往哪加 | 小（0.5d 改为可外部配置） |

**不碰的：** BuildStep 模式、branded token、LessBuildContext 结构。它们不脏，只是"内部细节多"，内部项目不需要改。

---

## 二、同类产品对比

### 对比矩阵

| 维度 | LessJS 当前 | LessJS ESM 改造后 | Astro | Fresh (Deno) | Eleventy |
|------|------------|------------------|-------|-------------|----------|
| **SSG 是否依赖构建工具** | 🔴 依赖 Vite | 🟢 独立 CLI | 🟢 独立 CLI | 🟢 独立 | 🟢 独立 |
| **SSR bundle 格式** | ESM（noExternal 内联） | ESM + sidecar importmap | 无（无传统 SSR bundle） | JSX → Preact | 无 |
| **运行时要求** | Vite 进程内 | 任意支持 ESM import() 的 runtime | Node.js | Deno | Node.js |
| **核心渲染** | DSD 字符串拼接 | DSD 字符串拼接（不变） | 模板字符串 | JSX → VNode | 模板引擎 |
| **Islands** | ✅ DSD + Lit | ✅ 不变 | ✅ Astro Islands | ✅ Fresh Islands | ❌ 无 |
| **HMR** | ✅ Vite HMR | ✅ Vite HMR（dev 时） | ✅ Vite HMR | ✅ Fresh HMR | ❌ 无 |
| **技术选型自由** | Lit 优先，无 adapter 可自行扩展 | 不变 | React/Vue/Svelte/Lit | Preact | 任意模板引擎 |
| **外部用户安装摩擦** | ⚠️ npm: vs jsr: 坑 | 🟢 零摩擦 | 🟢 零摩擦 | 🟢 零摩擦 | 🟢 零摩擦 |

### 关键差异

**Astro vs LessJS：**
- Astro 的 `astro build` 本身就是一个 CLI，Vite 作为打包器被调用，不控制执行流程
- Astro 没有"SSR bundle"这个概念——渲染在 build 进程里直接做
- LessJS 的 DSD + Lit SSR 管线比 Astro 的模板渲染更灵活（组件可以用 Lit 装饰器、生命周期、reactive properties）
- **改造后**：LessJS 的 SSG 独立性和 Astro 同级，但内容渲染能力（组件模型）更强

**Fresh vs LessJS：**
- Fresh 锁死在 Deno 上，LessJS 可以跑在任何 runtime
- Fresh 的 islands 是 Preact 的，LessJS 是 Web Components 的（更标准）
- Fresh 没有 DSD，客户端重建整个 shadow tree

**Eleventy vs LessJS：**
- Eleventy 不碰客户端 JS，LessJS 有完整的 Islands/DSD 管线
- Eleventy 插件生态成熟，LessJS 还小

### 改造后的差异化定位

```
LessJS = DSD + ESM-native SSG + Islands + 任意 runtime
         ↑ Astro 没有 DSD/任意 runtime
         ↑ Fresh 锁 Deno
         ↑ Eleventy 没有互动能力
```

---

## 三、工作量和优先级

### 改造范围（分三批）

**P0（解决痛点，必须做）**

| 任务 | 文件影响 | 估算 |
|------|---------|------|
| Phase 1 产出 SSR bundle 时附带 `importmap.json` | `build-ssg.ts` 追加写文件 | 0.5d |
| 独立 SSG CLI 入口 | 新增 `packages/adapter-vite/src/cli/ssg.ts` | 1d |
| 将 `@hono/vite-dev-server` 移为 optional dep | `packages/adapter-vite/deno.json` + `package.json` | 0.5d |
| 文档：写明 `jsr:` vs `npm:` 差异 | README | 0.5d |
| **小计** | | **2.5d** |

**P1（值得做）**

| 任务 | 文件影响 | 估算 |
|------|---------|------|
| 统一 `BuildSSGOptions` 单一数据源（不再从 ctx 和 options 两处读） | `build-ssg.ts` | 1d |
| `allNoExternal` 列表改为可外部配置 | `build-ssg.ts` + `types.ts` | 0.5d |
| 测试：SSG CLI 独立运行测试（不经过 Vite closeBundle） | 新增 test | 1d |
| **小计** | | **2.5d** |

**P2（后面再说）**

| 任务 | 文件影响 | 估算 |
|------|---------|------|
| 将 route-scanner.ts / hono-entry.ts 独立成纯函数（无 Vite 类型依赖） | `route-scanner.ts`, `hono-entry.ts` | 1.5d |
| dev 模式支持纯 ESM 热更新（不需要 Vite HMR 的轻量路径） | 新增 | 3d+ |
| 全面 Typescript化 `BuildStep`（去掉 `any` 和隐式类型） | `build.ts`, `build-context.ts` | 1d |

### 总计

| 批次 | 工作量 | 效果 |
|------|--------|------|
| P0 | 2.5d | ✅ 解决 `npm:` vs `jsr:` 摩擦，SSG 可独立运行 |
| P0+P1 | 5d | ✅ 架构清晰、可维护性提升、外部用户零阻碍 |
| P0+P1+P2 | ~10d | ✅ 全链路纯函数化、dev 模式可完全脱离 Vite |

---

## 四、最终效果（用户视角）

### 安装

```bash
# 方法 1: npm（干净，推荐外部用户）
npm install @openelement/app @openelement/adapter-lit

# 方法 2: JSR（干净）
deno add jsr:@openelement/app jsr:@openelement/adapter-lit

# 方法 3: Workspace（开发 LessJS 本身用）
git clone https://github.com/open-element/open-element.git
```

**三种方式都能跑，没有 `npm:` vs `jsr:` 的差异。** 因为 importmap.json 是 SSR bundle 自带的。

### 开发

```bash
deno task dev    # Vite dev server，和现在一样
```

### 构建

```bash
deno task build  # Vite build + SSG，和现在一样

# 或者独立 SSG（不需要 Vite 环境）
npx lessjs-ssg    # 读 dist/server/entry.mjs + importmap.json
# 或者
deno run -A npm:@openelement/adapter-vite/ssg
# 或者
node ssg.mjs      # 只要 Node 18+
```

### 部署

```bash
# Cloudflare Pages / Vercel / Netlify / 纯静态托管
# dist/ 就是你的站点
# 不需要服务端，不需要函数
```

---

## 五、实事求是的判断

| 问题 | 答案 |
|------|------|
| **DSD 能零依赖吗？** | ✅ **已经做到了。** `render-dsd.ts` 零 Vite、零 Lit、零 node:* |
| **ESM SSG 可行吗？** | ✅ **可行。** 只加一个 `importmap.json` 和一个独立 CLI，Phase 3 逻辑不需要动 |
| **能解决 `npm:` vs `jsr:` 摩擦吗？** | ✅ **能。** SSR bundle 自带 import map，加载时不依赖环境解析器 |
| **项目能更干净吗？** | ⚠️ **能，但 P0 改动不大。** 核心脏点只有 `closeBundle` 的耦合 + 一个 optional dep |
| **HMR 会断吗？** | ✅ **不会。** dev 模式继续用 Vite，不受影响 |
| **和 Astro 比呢？** | 🟢 **改造后同级，且 DSD + Lit 组件模型更强。** Astro 不能做到零 Vite 依赖的 SSG |
| **工作量值不值？** | ✅ **P0 的 2.5d 值。** 解决了一个真实摩擦，外部用户引导文档也不用写"注意 jsr: 和 npm: 区别"这种尴尬话 |
