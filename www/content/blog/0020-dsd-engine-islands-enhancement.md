---
title: 'ADR 0020: DSD 渲染引擎与 Islands 策略增强 — 核心护城河建设'
date: '2026-05-12'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**PROPOSED** — v0.14.0+ 目标

## Context

### 战略背景

ADR 0019（综合改进计划）确立了"先固本，后拓疆"的策略。Phase 0/1 解决的是质量缺口的补救。**但护城河不是修出来的——护城河是在别人没去过的地方挖出来的。**

四份审查报告的共识结论：LessJS 最大的差异化在于 **DSD-first**。然而当前这个差异化是理念层面的，到了开发者体验层面，DSD 的独特价值并未充分展现——开发者看到的依然是"Lit + Vite 构建的又一个 SSG"。

Astro 6.x、Fresh 2.0 beta、Qwik、Lume 3 都没有以 DSD 为核心模型。这意味着 **DSD 相关的能力建设是 LessJS 唯一不可被快速复制的竞争壁垒**。如果 LessJS 能在 DSD 领域做到"这个体验只有这里有"，就获得了真正的时间窗口。

### 问题分析

#### 问题 1：DSD 对开发者不可见

DSD 的核心价值（原生 CSS 封装、零 JS 组件边界、浏览器级渲染）在构建产物中是隐形的。开发者在 dev 工具中看不到 DSD 的影子：

```
DSD 在浏览器中:  DOM 树上看到一个 <template shadowrootmode="open"> 
                  → 开发者需要手动打开 Elements 面板去确认
                  → 无法直观看到"哪些组件用了 DSD、哪些没用到"
                  → 无法验证 DSD 嵌套是否正确
                  → 无法区分 DSD Interactive 和 DSD Static
```

**对比**：Vue 开发者能看到 Vue DevTools 面板里的组件树；React 开发者能看到 Components 面板。DSD 开发者——什么都没有。

#### 问题 2：Island 策略缺乏智能

当前 4 种策略（eager/lazy/visible/idle）依赖开发者手动指定。但在实践中：

- 开发者经常不清楚某个组件应该用什么策略
- 策略选择缺乏客观标准（"这个组件交互复杂吗？"是主观判断）
- 同一组件的策略在页面的不同实例中可能不同
- 没有运行时反馈来验证策略是否合理

#### 问题 3：DSD 渲染引擎能力边界

当前 DSD 渲染引擎支持 L2 嵌套（通过 parse5 AST O(n·d)），但：

- 深层嵌套（L3+）的性能未见公开基准
- 无流式输出能力（大页面需全部渲染完成才输出）
- 无 DSD 错误定位机制（渲染失败时，开发者不知哪个组件的哪个属性出了问题）
- 无 DSD 渲染报告（构建后无法查看页面 DSD 的"健康度"）

### 竞品对比：DSD 体验差距

| 能力                         | Astro | Fresh | Qwik | LessJS 当前 | LessJS 目标 |
| ---------------------------- | ----- | ----- | ---- | ----------- | ----------- |
| DSD DevTools 面板            | ❌    | ❌    | ❌   | ❌          | ✅ **独家** |
| DSD Tree View                | ❌    | ❌    | ❌   | ❌          | ✅ **独家** |
| DSD Hydration 监控           | ❌    | ❌    | ❌   | ❌          | ✅ **独家** |
| DSD 渲染报告                 | ❌    | ❌    | ❌   | ❌          | ✅ **独家** |
| Island 策略推荐              | ❌    | ❌    | ❌   | ❌          | ✅ **独家** |
| Speculative Loading 深度集成 | 基础  | ❌    | ❌   | 基础        | ✅ **领先** |
| View Transitions 零配置      | ❌    | ❌    | ❌   | 基础        | ✅ **领先** |
| DSD Streaming                | ❌    | ❌    | ❌   | ❌          | ✅ **独家** |

**核心结论**：LessJS 站在 DSD 的天然位置，但当前的能力建设程度与这个位置不匹配。DSD-first 不能只是 README 中的一句话——它应该是开发者每一次交互中都能感受到的体验。

## Decision

### 核心原则

**"让 DSD 好到无法被忽视，而不是让框架小到没有依赖。"**

### Proposal A: DSD DevTools Panel（v0.14.0）

#### 目标

参考 Astro Dev Toolbar 的模式，在开发环境中注入一个 DSD 调试面板，让 DSD 变得**可见、可审查、可调试**。

#### 实现方案

**注入方式**：Vite Dev Server 在 HTML 响应末尾注入一个 `<script>` 标签，加载 DevTool Panel。

```
Dev 模式 HTML 响应:
  <html>
    <head>...</head>
    <body>
      ... 页面内容 ...
      <less-devtool>                                    ← 注入的自定义元素
        #shadow-root:
          <panel-toggle>  (右下角浮动按钮)                ← 点击打开面板
          <panel-overlay> (全屏覆盖)
             ├── DSD Tree View     → 组件树 + DSD 层级
             ├── Hydration Status  → 哪些跳过渲染、哪些做了
             ├── Island Explorer → 策略分布与实际行为
             └── Performance Tab   → 渲染时间 / DSD 数量
      </less-devtool>
      <script type="module" src="/@openelement/devtool"></script>  ← 虚拟模块入口
    </body>
  </html>
```

**DSD Tree View 数据结构**：

```ts
interface DsdTreeNode {
  tagName: string; // 'less-button', 'home-page', etc.
  layer: 'dsd-static' | 'dsd-interactive' | 'pure-island';
  shadowRootAttached: boolean; // 浏览器是否已附加 DSD
  hydrationSkipped: boolean; // Lit 是否跳过了重渲染
  childNodes: DsdTreeNode[]; // 嵌套的 DSD 子节点
  renderTime: number; // SSR 渲染时间 (ms)
  templateSize: number; // DSD 模板字节数
}

interface DsdReport {
  totalComponents: number;
  dsdComponents: number; // 有 DSD 模板的
  hydratedComponents: number; // 跳过了渲染的
  pureIslands: number;
  totalDsdSize: number; // 所有 DSD 模板的总 KB
  maxNestingDepth: number;
}
```

**采集方式**：

```
SSR 渲染阶段:
  renderDSD() 收集：组件名 → 渲染时间 → DSD 模板大小
  通过构建上下文传递到 dev 阶段

浏览器运行时:
  MutationObserver 观察 Custom Elements 升级
  Lit connectedCallback() 检测 _dsdHydrated 标志
  汇总数据发送到 DevTool Panel
```

**运行时校验**：

DevTool Panel 在运行时执行自动检查：

```ts
// 自动检查清单（面板中显示 4 个状态灯）
const checks = {
  dsdNestingValid: checkNoShadowDOMInjection(), // ✅ DSD 嵌套完整
  ssrClientMatch: compareSSRandClient(), // ✅ SSR 客户端一致
  noDuplicateContent: checkBlankBoxes(), // ✅ 无重复渲染
  islandStrategiesOptimal: evalIslandStrategies(), // ✅ Island 策略合理
};
```

#### 为什么是护城河

这个面板 Astro 不可能做——它没有 DSD 为核心。Fresh 不可能做——Preact 不支持 DSD。Qwik 不需要做——它的渲染模型是完全不同的。**只有 LessJS 能以原生 DSD-first 的视角呈现这些信息。**

一旦开发者体验了这个面板，他们就会理解"为什么 LessJS 选择 DSD"。这不是营销话术，是一种"亲眼看到"的体验。

---

### Proposal B: Island 策略推荐系统（v0.14.0）

#### 目标

消除"开发者不知道该用哪种策略"的问题，在构建时自动推荐最优策略。

#### 实现方案

**分析维度**（构建时静态分析）：

```ts
interface IslandProfile {
  // 交互维度
  hasEventListeners: boolean; // 有 click/input 等事件绑定
  hasDomMutations: boolean; // 修改了 DOM 结构
  usesExternalState: boolean; // 依赖外部信号/状态
  renderComplexity: 'simple' | 'moderate' | 'complex'; // render() 复杂度判断

  // 可见性维度
  isAboveFold: boolean; // 是否在首屏
  isInViewport: boolean; // 初始可见（非懒加载区域）

  // 性能维度
  estimatedChunkSize: number; // 估算的 JS chunk 大小
  dependencyCount: number; // 依赖图大小
}

type RecommendedStrategy = 'eager' | 'lazy' | 'visible' | 'idle';
```

**决策规则**：

```
if (isAboveFold || hasEventListeners):        → eager      (首屏交互)
else if (isInViewport && hasDomMutations):    → lazy       (中低优先级)
else if (renderComplexity === 'complex'):      → visible    (IntersectionObserver)
else:                                          → idle       (requestIdleCallback)
```

**开发者交互**：

- 推荐策略输出到构建日志：`[LessJS] less-theme-toggle: recommended = idle (no event listeners, below fold, 0.8KB)`
- DevTool Panel 中显示当前策略 vs 推荐策略对比
- 开发者可手动覆盖策略（显式指定的优先级高于推荐）

#### 落地方式

不需要复杂的 AST 全量分析。通过在 build 阶段的 SSR 上下文中收集元数据：

```ts
// SSR 渲染时，renderDSD() 收集 island 元数据
function renderDSD(tagName, cls, props, source, options) {
  // ... existing rendering logic ...

  // NEW: collect island profile
  if (options?.layer === 'pure-island' || options?.layer === 'dsd-interactive') {
    ctx.collectIslandProfile({
      tagName,
      componentSource: source?.source,
      chunkSize: estimatedSize,
      hasEvents: detectEventBindings(cls),
      strategy: options.strategy || 'eager',
      recommended: recommendStrategy(profile),
    });
  }

  // ... continue rendering ...
}
```

---

### Proposal C: 无限制 DSD 嵌套 + 渲染报告（v0.15.0）

#### 目标

将 DSD 嵌套从 L2 扩展到无限制，并提供构建时的 DSD 渲染报告。

#### L3+ 嵌套的技术方案

当前 `renderNestedCustomElements()` 使用 parse5 AST 进行自底向上的 DSD 包装。对于 L2 嵌套，一次 AST 遍历就够了。对于 L3+，需要**多次 AST 遍历**：

```
输入:  <outer-ce>
         <template shadowrootmode="open">
           <inner-ce>
             <template shadowrootmode="open">
               <p>Hello</p>
             </template>
           </inner-ce>
         </template>
       </outer-ce>

L3+ 扩展:
  <outer-ce>                                    ← DSD 由 renderDSD() 包装
    <template shadowrootmode="open">
      <inner-ce>                                ← DSD 由 renderNested() 包装
        <template shadowrootmode="open">
          <p>Hello</p>
        </template>
      </inner-ce>
    </template>
  </outer-ce>
```

**策略**：递归 AST 遍历 + 深度缓存

```ts
/**
 * 无限制 DSD 嵌套渲染
 *
 * 策略：自底向上递归 AST 遍历
 * 1. parse5 parseFragment(html) → AST
 * 2. 自底向上遍历，每遇到一个 Custom Element
 * 3. 递归渲染其内容中的嵌套 CE
 * 4. 用 <template shadowrootmode> 包裹渲染结果
 * 5. 替换 AST 中的原始 CE 节点
 * 6. 序列化 AST → HTML
 *
 * 性能保障：通过 maxDepth 参数防止栈溢出
 */
export async function renderNestedCustomElements(
  html: string,
  ctx: LessBuildContext,
  maxDepth = 10, // 防止栈溢出
): Promise<string> {
  // ... parse5 AST 遍历 + 递归渲染 ...
}
```

#### DSD 渲染报告

构建完成后输出一份可读的 DSD 健康报告：

```
=== DSD 渲染报告: 页面 index.html ===

Total Components:      24
DSD Components:        18  (75%)
  ├── DSD Static:      12  (no JS needed)
  ├── DSD Interactive: 4   (event hydration)
  └── Pure Island:     2   (client JS chunk)
Non-DSD Components:    6   (void elements)

DSD Template Size:     12.4 KB
Max Nesting Depth:     3   (home-page → less-layout → less-button)
DSD Coverage:          92% (22/24 components have shadow DOM)

Island Distribution:
  eager:  1  (less-theme-toggle)
  idle:   1  (less-hero-ping)

Hydration Efficiency:
  Skipped: 4  (DSD interactive, ready from server)
  Active:  2  (Pure islands, client JS)

=== Summary: 92% DSD coverage, 12.4KB templates, 2 client chunks ===
```

---

### Proposal D: Speculative Loading 与 View Transitions 深度集成（v0.14.0 并行）

#### 现状

LessJS 已经为 Island 的资源提示做了策略化注入（eager → modulepreload，其他 → prefetch）。但这是"浅集成"——它只做了资源提示，没有利用浏览器的更高级能力。

#### Speculation Rules API 深度集成

WHATWG Speculation Rules API 允许浏览器**预渲染**页面（不仅仅是预取资源）。LessJS 可以利用 SSG 的内置信息生成最优的 Speculation Rules：

```html
<!-- 自动生成的预渲染规则（基于 SSG 路由图） -->
<script type="speculationrules">
{
  "prerender": [
    {
      "source": "list",
      "urls": ["/", "/blog", "/about", "/docs"],
      "eagerness": "moderate",
      "referrer_policy": "strict-origin-when-cross-origin"
    }
  ],
  "prefetch": [
    {
      "source": "list",
      "urls": ["/blog/hello-world", "/changelog", "/roadmap"],
      "eagerness": "conservative"
    }
  ]
}
</script>
```

**智能规则生成逻辑**：

```
SSG 构建完成后，获取路由表：
  首页        → prerender (moderate)   → 用户大概率访问
  博客列表    → prerender (moderate)   → 导航栏链接
  关于页      → prerender (conservative) → 不太可能但可能
  博客文章    → prefetch (conservative) → 数量多，只预取不预渲染
  404页       → 不处理

规则基于路由深度 + 链接在页面中的位置自动生成。
```

#### View Transitions API 零配置集成

目前 LessJS 已支持 View Transitions 的 SSR meta tag 注入。但开发者仍需手动配置过渡动画。目标：**零配置的同站过渡**。

```
SSG 构建时分析页面间 DOM 结构差异：
  如果两个页面共享相同的 <header> <nav> <open-layout> 结构
  自动添加 view-transition-name 以保持过渡一致性

用户不需要写任何 CSS，框架自动处理：
  document.startViewTransition(() => { navigate(url); });
```

---

## Consequences

### Positive

- **DSD DevTools Panel（Proposal A）是最大的差异化武器**。一旦这个面板存在，Astro/Fresh 用户试用 LessJS 后的第一个感受就是"这个框架把那些我看不见的东西变得可见了"。这是一个体验层面的护城河
- **Island 策略推荐（Proposal B）降低认知负担**。策略从"开发者决策"变为"框架建议，开发者选择"，这是 DX 层面的实质性提升
- **DSD 渲染报告（Proposal C）把构建产物变成可量化、可优化、可炫耀的东西**。"我的站点 92% DSD 覆盖，零 JS 渲染"是一个强有力的产品叙事
- **Speculative Rules 深度集成（Proposal D）天然只有 SSG 框架能做**。Astro 也能做，但 LessJS 有 Island 策略信息，能生成更精准的预渲染规则

### Negative

- **Proposal A（DevTools Panel）的开发成本最高**（估计 3-4 周），需要 Vite 虚拟模块、Custom Element 面板、DSD 元数据采集三个子系统配合
- **Proposal B（策略推荐）精度有限**。静态分析无法准确判断"这个 Island 是否需要交互"——一些条件绑定的交互在 render() 之前不可见
- **Proposal C（L3+ 嵌套）可能引入性能回归**。parse5 的多次 AST 遍历加递归渲染需要严格的性能基准测试

### Neutral

- **护城河是时间积累的结果**，不是某个版本一次性建成的。ADR 0020 的四个 Proposal 分布在 v0.14.0-v0.15.0 两个版本周期中
- DSD DevTools Panel 的注入机制（`<less-devtool>` CE + virtual module）本身就是对 LessJS 自身框架能力的一次验证（dogfooding）
- 这些能力中的大部分在 Astro/Fresh 的 roadmaps 中不出现——不是因为它们不重要，而是因为它们的架构不支持。这正是护城河的逻辑

## Implementation Roadmap

```
v0.14.0（2026-07）
  ├── Proposal B: Island 策略推荐系统       (2 周)
  │   ├── SSR 渲染时收集 Island profile
  │   ├── 决策规则引擎
  │   └── 构建日志输出推荐
  │
  ├── Proposal D: Speculative Loading 深度集成  (1 周)
  │   ├── SSG 路由表 → 规则生成
  │   └── 优化现有 modulepreload/prefetch
  │
  └── View Transitions 零配置                (1 周)
      └── 自动 view-transition-name 注入

v0.15.0（2026-08）
  ├── Proposal A: DSD DevTools Panel         (3-4 周)
  │   ├── Vite Dev Server 注入
  │   ├── DSD Tree View 组件
  │   ├── Hydration / Island 监控面板
  │   ├── 性能 Tab
  │   └── 运行时校验检查
  │
  └── Proposal C: 无限制 DSD 嵌套 + 渲染报告   (2 周)
      ├── 递归 AST 遍历实现 L3+
      ├── 构建时 DSD 报告生成
      └── 性能基准测试
```

## 参考

- [ADR 0019: 综合改进计划](/blog/0019-post-review-improvement-plan) — 本 ADR 的上层战略框架
- [Astro Dev Toolbar](https://docs.astro.build/en/reference/dev-toolbar/) — 启发 LessJS DevTools Panel 的模式
- [Speculation Rules API](https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API) — 浏览器预渲染标准
- [View Transitions API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API) — 过渡动画标准
- [WhatWG Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API) — 客户端路由标准（已在 core 中使用）
- [ADR 0018: 虚拟模块数据模式](/blog/0018-dev-build-data-consistency-plugin-data-bridge) — DevTools Panel 的虚拟模块注入可复用此模式
- 四份审查报告：`deliverables/review-architecture.md`、`deliverables/review-code-quality.md`

---

_提出日期：2026-05-12 | 状态：PROPOSED | 目标版本：v0.14.0+ | 提出人：齐活林（Qi）_
