---
title: 'ADR 0006: 版本号策略 — 从 0.6 到 2.0 的递进路线'
date: '2026-05-07'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**ADOPTED** — v0.6.2 架构决策，替代旧 roadmap 中的 v0.7~v0.10 线性递增方案。

## Context

LessJS 当前的 roadmap 采用 0.7 → 0.8 → 0.9 → 0.10 的线性递增。这个方案有几个问题：

1. **SemVer 语义不精确**：0.7（Island Manifest）到 0.8（Fullstack）是架构能力的质变，不是量变。Patch 级别的递增不能传达这种差异。
2. **1.0 的门槛模糊**：什么时候可以打 1.0？是 P2 审计修复完成后？还是 Compiler 完成后？没有明确的判定标准。
3. **Compiler 和 Fullstack 的归属不清**：这两个能力会改变"LessJS 是什么"的定义。如果放在 1.0 之后，就是 Breaking Change 需要升 2.0；如果放在 1.0 之前，它们还是 0.x 的正常演化。
4. **审计发现尚未纳入**：2026-05-07 四维审计的 P0/P1/P2 修复任务没有对应的版本号。

## Decision

采用**三段式版本路线**，以"能力域"划分 MAJOR/MINOR，而非线性递增：

### 版本总览

```
v0.7.0  ← P0 稳定基线（审计修复）
v0.8.0  ← P1 功能完善 + Island Manifest
v0.9.0  ← i18n + View Transitions + Speculation Rules  ← 实际交付偏离原计划
v0.10.0 ← SSR Architecture Purification + API Boundary  ← 实际交付偏离原计划
v0.11.0 ← ISR + PWA + Compiler Alpha  ← 原 v0.10 ISR/PWA 内容后移至此
v1.0.0  ← API 稳定承诺
v1.x    ← 增量演进（不破坏公共 API）
v2.0.0  ← Compiler 成为默认（如需 Breaking Change）
```

### 判定 1.0.0 的标准

1.0.0 不是一个"完成了所有功能"的版本号，而是一个**公共 API 稳定承诺**的信号。以下条件全部满足时，可以打 1.0.0：

| # | 条件                                                          | 理由                                                     |
| - | ------------------------------------------------------------- | -------------------------------------------------------- |
| 1 | 核心模块测试覆盖率 ≥ 80%                                      | 覆盖率是 API 稳定的前提——没有测试的 API 无法保证行为不变 |
| 2 | CI 全链路门禁就位（test + typecheck + lint + coverage gate）  | 自动化防止退化                                           |
| 3 | runtime-shim 由 AST 生成，不再手工维护                        | 最大技术债消除，SSR 输出一致性可验证                     |
| 4 | 公共 API 列表明确文档化（exports、config options、CLI flags） | 用户知道哪些是承诺的，哪些是内部的                       |
| 5 | 至少 3 个真实项目 dogfooding（含 docs 站）                    | 实际使用验证                                             |
| 6 | 无 P0/P1 级已知 Bug                                           | 质量基线                                                 |

**1.0.0 不要求**：Compiler 生产可用、ISR 生产可用、Fullstack 示例丰富。这些是 1.x 的增量工作。

### 各版本详细规划

#### v0.7.0 — 稳定基线（P0 审计修复）

**定位**：消除不可信行为，建立工程纪律。

| 任务                              | 优先级 | 说明                                     |
| --------------------------------- | ------ | ---------------------------------------- |
| render-dsd.ts 单元测试            | P0     | 770 行核心渲染器零覆盖                   |
| island.ts 单元测试                | P0     | 321 行 Island 系统零覆盖                 |
| runtime-shim 一致性测试 + 修复    | P0     | serializeAttributes 缺失 escapeAttrValue |
| headExtras/headFragments XSS 修复 | P0     | 重命名 + 运行时警告                      |
| 消除静默 catch → console.warn     | P0     | 8+ 处错误吞没                            |
| CI 补全                           | P0     | adapter-lit/docs 测试任务、发布门禁      |
| pre-commit hooks                  | P0     | 格式化/lint/类型检查守卫                 |

**为什么是 0.7.0 而不是 0.6.3**：XSS 修复和 catch 行为变更属于破坏性变更（部分用户可能依赖当前的静默行为）。SemVer 0.x 的 MINOR 升级允许破坏性变更，正好对应。

#### v0.8.0 — 功能完善 + Island Manifest

**定位**：补全测试覆盖 + Island 系统演进。

| 任务                           | 优先级  | 说明                                  |
| ------------------------------ | ------- | ------------------------------------- |
| signals 测试套件               | P1      | 749 行零覆盖                          |
| dsd-hydration.ts 单元测试      | P1      | Mixin 核心逻辑验证                    |
| Signal 原生切换                | P1      | npm 依赖 + globalThis.Signal 条件回退 |
| render-dsd.ts 拆分为 4 模块    | P1      | 可维护性                              |
| UI 组件统一到 DsdLitElement    | P1      | 3 个组件未使用 Mixin                  |
| insertAfterHead 去重           | P1      | ui → core                             |
| 包版本统一                     | P1      | 6 包版本不一致                        |
| 定位重写（避免"全栈"过度承诺） | P1      | 诚实营销                              |
| Interactive Playground         | P1      | StackBlitz 一键体验                   |
| Playwright E2E 测试            | P1      | 浏览器级集成测试                      |
| Island Upgrade Manifest        | Roadmap | 页面级 island 清单替代全局入口        |
| Speculative Loading 可观测     | Roadmap | eager/visible/idle 策略浏览器测试     |

**合并旧 roadmap 的 v0.7 内容**：Island Manifest 和 Speculative Loading 与 P1 测试/组件统一工作属于同一能力域，合并到 0.8.0 合理。

#### v0.9.0 — i18n + View Transitions + Speculation Rules

**定位**：国际化 + 浏览器原生性能 API 集成。

> ⚠️ **实际交付偏离原计划**：原计划为 Serverless Fullstack（FormData actions, Typed RPC, env/secrets），实际因 SSG 稳定性需求和浏览器 API 成熟度而调整。i18n 和 View Transitions 是用户更紧迫的需求。Serverless Fullstack 推迟到 v1.x。

| 能力                  | 说明                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| @openelement/i18n 独立包   | 从 content 拆出，lessI18n() 独立插件，SSG locale 展开                      |
| 双语文档站            | 25/30 页面英文版 + language switcher + en/zh 路径                          |
| View Transitions API  | 跨页面 MPA 动画（Chrome 111+, Safari 18+, Firefox 129+）                   |
| Speculation Rules API | 浏览器 prefetch/prerender（Chrome 121+）                                   |
| SSG 后处理管线重构    | 5 步管线：clientScript → viewTransition → speculation → CSP → DSD polyfill |

#### v0.10.0 — SSR Architecture Purification + API Boundary

**定位**：消除 SSR 层全部边界违规，建立干净的公共 API。

> ⚠️ **实际交付偏离原计划**：原计划为 SSG + ISR + PWA（路由级 revalidation, Cache lock, Stale fallback），实际因 ADR 0008-0014 架构净化需求优先而调整。ISR/PWA 内容后移至 v0.11。

| 能力                                 | 说明                                         |
| ------------------------------------ | -------------------------------------------- |
| 消除 globalThis 桥接（ADR 0008）     | 消除 createServer() + 全部 globalThis 桥接   |
| 消除 .less/ 临时文件（ADR 0010）     | 构建 ctx 替代文件系统中间态                  |
| 消除 last globalThis（ADR 0011）     | closeBundle 替代 globalThis 数据传递         |
| 提取 @openelement/app（ADR 0012）         | umbrella 函数抽到独立包                      |
| 消除 less-runtime barrel（ADR 0013） | 内联 shim 替代 barrel 重导出                 |
| SSR Bundle 公共 API（ADR 0014）      | renderRoute() + getStaticPaths() + routeInfo |

#### v0.11.0 — ISR + PWA + Compiler Alpha

**定位**：构建能力成熟 + 编译器实验性能力。

| 任务                              | 来源     | 说明                                  |
| --------------------------------- | -------- | ------------------------------------- |
| 路由级 revalidation               | 原 v0.10 | 按需重新生成静态页面                  |
| Cache lock                        | 原 v0.10 | 并发构建时的缓存锁                    |
| Stale fallback                    | 原 v0.10 | 新内容构建中返回旧内容                |
| Service Worker 策略               | 原 v0.10 | NetworkFirst/CacheFirst 可配置        |
| CDN recipes                       | 原 v0.10 | Cloudflare/Netlify 缓存配置模板       |
| AST 代码生成替代手工 runtime-shim | P2 #19   | 根治 SSR 输出一致性                   |
| 增量 SSG 构建                     | P2 #20   | 文件哈希缓存                          |
| 性能基准                          | P2 #24   | 构建时间/产物体积/Lighthouse/竞品对比 |
| 覆盖率收集 + 门禁                 | P2 #25   | CI 覆盖率强制                         |
| 视觉回归测试                      | P2 #26   | 组件截图对比                          |
| 依赖安全审计自动化                | P2 #27   | CI 集成 npm audit / Snyk              |
| .less Compiler Alpha              | ADR 0002 | 可选零框架组件编译                    |

**为什么 Compiler 在 P2 之后**：Compiler 需要稳定的 DSD renderer 作为编译目标。如果 renderer 还在手工同步（runtime-shim 问题），Compiler 的输出也无法保证正确。P2 的 AST 替换解决了这个问题。

#### v1.0.0 — API 稳定承诺

**判定标准**：见上文 6 条标准。

**1.0.0 的含义**：

- 公共 API（`less()` 配置、CLI 命令、`@openelement/core` 导出、`@openelement/rpc` 导出）视为稳定
- Breaking Change 必须升 MAJOR
- Lit adapter 继续作为一等公民支持
- Compiler 仍为 opt-in，不是默认

#### v1.x — 增量演进

| 版本 | 方向                   | 说明                                |
| ---- | ---------------------- | ----------------------------------- |
| v1.1 | Compiler Beta → Stable | `.less` 文件成为推荐组件编写方式    |
| v1.2 | Fullstack 示例丰富     | CRM/admin 级 demo                   |
| v1.x | 更多 adapter           | Vue adapter、React island bridge 等 |

> **注**：`@openelement/blog` 开发提前到 v0.8.0 后启动（SSG 插件形态，不依赖 Fullstack），在 v0.9 期间 dogfooding。v1.0 时 blog 包随主框架一起稳定。

#### v2.0.0 — Compiler 成为默认（如果需要）

只有当以下条件同时满足时才考虑 2.0：

1. `.less` Compiler 生产可用且经过大量项目验证
2. 社区已自然迁移到 `.less` 组件
3. 将 Compiler 设为默认会破坏现有 Lit 用户的工作流

**如果 Lit 兼容模式可以无缝共存，则不需要 2.0。**

### Monorepo 包版本策略

LessJS 是 Deno workspace monorepo，7 个包发布到 JSR。仓库 Release tag 和包版本号**不需要一致**。

**规则：谁改了谁升级，仓库 tag 取本次发布中最大的包版本号。**

```
仓库 tag: v0.9.0

包版本变更：
  @openelement/core         0.8.1 → 0.9.0   (SSR 属性绑定行为变更)
  @openelement/adapter-lit  0.6.4 → 0.7.0   (interpolate 属性绑定输出变更)
  @openelement/content      0.1.0 → 0.2.0   (新增 nav/sitemap 模块)
  @openelement/ui           0.6.2 → 不变    (无变更)
  @openelement/rpc          0.6.1 → 不变    (无变更)
  @openelement/signal        0.6.2 → 不变   (无变更)
  @openelement/create       0.6.1 → 不变    (无变更)
```

**具体规则**：

1. **仓库 Release tag ≠ 任何单个包的版本**。tag 是这批变更的整体发布代号。
2. **包独立发版**：JSR 按包发版，不要求所有包版本一致。
3. **版本号判断标准**：
   - 有 Breaking Change 或行为变更 → MINOR bump（0.x 阶段）
   - 纯 Bug fix / 新增非 Breaking 功能 → PATCH bump
   - 没改 → 不动
4. **Release Note 按包分组**，列出每个包的变更版本，末尾列出未变更的包。
5. **跨包依赖版本引用**：必须引用已发布到 JSR 的版本（`jsr:@scope/package@^version/subpath`），不能引用本地路径。

**为什么不用固定版本（Fixed/Locked）**：

- Babel/Angular 的做法要求所有包版本号相同，但在 JSR 生态中不必要——JSR 天然按包发版。
- 新增包（如 content 0.1.0）如果被强制跳到 0.9.0，版本号含金量稀释。
- 没改的包浪费版本号，changelog 虚胖。

**为什么不用完全独立版本（不加仓库 tag）**：

- 用户需要知道"这一批变更的整体节奏"——仓库 tag 提供叙事感。
- GitHub Release 是用户发现更新的入口，不能省略。

### 版本号语义总结

| 版本段   | 含义                                | Breaking Change 规则     |
| -------- | ----------------------------------- | ------------------------ |
| 0.7–0.10 | 框架在定义自己                      | MINOR 升级允许破坏性变更 |
| 0.11     | 过渡版本：基础设施成熟 + 新能力引入 | 仍允许，但应尽量减少     |
| 1.0      | 公共 API 冻结                       | 绝不允许（必须升 MAJOR） |
| 1.x      | 增量扩展                            | 公共 API 不破坏          |
| 2.0      | 范式转换（如果需要）                | 允许，但需迁移指南       |

## Consequences

**正面：**

- 每个版本号有清晰的语义——用户看到版本号就能判断升级风险
- 1.0.0 有明确的判定标准，不再是"感觉差不多了"的主观判断
- Compiler 和 Fullstack 在 0.x 阶段完成，不用担心 1.0 后的 Breaking Change
- 审计发现有了正式的版本归属

**负面：**

- 0.x 阶段拉长（0.7 → 0.11 共 5 个 MINOR 版本），可能给人"不够稳定"的印象
- 需要在 1.0 前维护公共 API 列表，增加了文档工作量
- 如果 0.11 的 Compiler Alpha 发现需要调整 DSD renderer 输出格式，可能影响 1.0 的时间线

**缓解：**

- 每个 0.x 版本都应该有明确的里程碑文档，传递"渐进成熟"而非"还不稳定"的信号
- 公共 API 列表在 v0.8 就开始文档化（标记为 "Stable API Candidate"），让 1.0 的门槛更具体
- 如果 0.11 Compiler Alpha 进展顺利，可以合并到 1.0 直接发布

## 参考

- [ADR 0002: .less Compiler](/blog/0002-less-compiler-eliminate-lit)
- [ADR 0005: WithDsdHydration Mixin](/blog/0005-with-dsd-hydration-mixin)
- [SemVer 2.0.0](https://semver.org/)
- LessJS 四维审计报告 (2026-05-07)

---

_决策日期: 2026-05-07 | 版本: v0.6.2_
