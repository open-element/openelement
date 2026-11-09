---
status: active
topic: Shim inventory
summary: Every compatibility layer with owner, direction, reason, retirement condition and disposition; machine-read by shims:check.
---

# Shim 盘点（P5 登记簿）

设计宪法 P5 要求：每个 shim 落地时写明退役条件；"平台追账评审"每个
release 周期用这把尺子重温一遍。本文件是那个此前缺失的登记簿
（issue #1559）：全仓每一个兼容层 / 适配器 / 垫片，逐项标注所有者、
方向、存在原因、退役条件与处置。

处置只有三档：**现在删** / **条件到即删**（条件写死，条件到即执行删除，
不等下一次评审）/ **保留为平台边缘**（平台尚未追上，删除条件是平台事件
而非工程事件），外加 **已删**（退役已执行的历史记录）。默认倾向删：登记
一项却不写条件 = 缺陷。这条封闭词表由
`tools/repo/check-shims.ts`（`@openelement/tools-repo#shims:check`，跑在
`gate:source` 里）机器校验。

## English summary

`shim-inventory.md` is the P5 shim registry: every compatibility layer,
adapter and polyfill in the tree, with its owner, direction, reason to exist,
retirement condition and disposition. Dispositions are a closed set — **delete
now** (`现在删`), **delete when the condition lands** (`条件到即删`), **keep as a
platform edge** (`保留为平台边缘`) — plus `已删` for a retirement that has already
executed. A registered shim without a written retirement condition is a defect.

`tools/repo/check-shims.ts` (`@openelement/tools-repo#shims:check`) reads this
file in `gate:source`: every row's location must exist and be Git-tracked (or be
struck through and absent, for an executed retirement), every row must have a
detail section carrying an owner and a non-empty retirement condition, and every
`path:line` citation must stay inside its file. The full English translation of
the prose below is an alpha16 candidate; this summary plus the machine-checked
table is the contract today.

方向一栏回答"谁写、谁读"——P8 接缝（见
[seams.md](./seams.md)）在跨界工件上有常驻守卫测试；本表
回答的是另一个问题："这块代码为什么还活着、平台/工具链追上来时删什么"。
两表互补，不重复登记守卫。

盘点基线：alpha10（`ca4671c75`），2026-10-07，工作树干净。扫描范围：
`packages/ tools/ www/ apps/ tests/` 全量源码，关键词 shim / polyfill /
adapter / compat / fallback / 退役 / "Delete when" / deno；再对每处命中
逐个读码定性。

## 汇总表

| # | 垫片 / 适配层 | 位置 | 处置 |
| --- | --- | --- | --- |
| 1 | 岛 CSS 压缩变换（#1543） | ~~`packages/router/src/vite/internal/island-css.ts`~~ | **已删（#1558）** |
| 2 | `styleAssetProtocol` 激活开关（#1553） | ~~element 编译器选项~~ | **已删（#1558）** |
| 4 | dev/SSR 内联 sheet 适配器（#1553） | `packages/router/src/vite/internal/style-assets.ts` | 保留为平台边缘（dev 半边已移除；SSR 文本待 server-only CSS 资产发现） |
| 5 | `ShimStyleSheet`（SSR 侧 CSSStyleSheet） | `packages/element/src/internal/core/style-sheet.ts` | 保留为平台边缘 |
| 6 | SSR 全局垫片（CSSStyleSheet banner + customElements stub） | `packages/router/src/vite/internal/ssg/ssr-polyfills.ts` | 保留为平台边缘 |
| 7 | 浏览器怪癖台账（#579/#604/#610） | `packages/router/src/vite/internal/ssg/morph-webkit-fix.ts`、`packages/router/src/vite/internal/ssg/form-enhance.ts` | 保留为平台边缘（各条目自带删除条件） |
| 8 | `@lit-labs/ssr` 全局 DOM shim | ~~`packages/router/src/lit-ssr.ts`~~ | **已删（ADR-0152 2026-11-08 零兼容退役）** |
| 9 | Nitro mount 适配 | `packages/router/src/nitro-mount.ts` | 保留为平台边缘（P5 明示的部署边界） |
| 10 | node:http `serveFetch` 适配 | `packages/router/src/internal/node-http.ts` | 保留为平台边缘 |
| 11 | Workers `nodeCompat`（unenv） | `apps/saas/nitro.config.ts`、fixture 同形 | 保留为平台边缘 |
| 12 | `Deno.Command` 形状仿真（deno→node 残余） | `tools/repo/node-command.ts`（形状仿真已删，模块保留为一等 spawn 助手） | **已删（N-1：重塑为一等 spawn 助手，2026-10-13）** |
| 13 | TypeScript `ParserPort` 后端 | `packages/compiler/src/internal/compiler/semantic-core/parse-module.ts` | 保留为平台边缘（双触发器已写死） |
| 14 | signal 引擎 Preact 适配 | `packages/element/src/internal/signal/` | 保留为平台边缘 |
| 15 | `@openelement/url-pattern-list` 维护 fork | `packages/router/src/internal/router/route-table.ts` | 保留为平台边缘（附评估结论） |
| 16 | CEM 兼容分类（第三方 WC 准入） | `packages/router/src/vite/internal/ssg/cem-compat.ts` | 保留为平台边缘（产品互操作面） |
| 17 | 渲染器适配缝（native / lit；lit 分支已删） | ~~`packages/router/src/lit.ts`~~、~~`packages/router/src/lit-ssr.ts`~~（native 选择缝保留于 `packages/router/src/vite/internal/ssg/renderer-adapter.ts`） | **已删（ADR-0152 2026-11-08 零兼容退役；native 为唯一渲染器）** |
| 18 | legacy 虚拟入口 id（`virtual:open-hono-entry`，ADR-0152） | `packages/router/src/vite/plugin-virtual-modules.ts` | 条件到即删（随下一次产物命名不兼容变更一起改名） |

没有"现在删"项：扫描发现的文本级残余（脚本头部陈旧的 `deno run` 用法
散文）已在 alpha8/alpha10 清理；其余命中要么已含书面退役条件，要么是
平台缺口本身。（2026-10-13 追加：第 12 项的退役条件随后到期并由 N-1 重塑
执行——形状仿真已删，模块改为一等 spawn 助手，见条目详情；其余结论不变。）
（2026-11-06 追加：第 3 项「CSS 双适配器」已注销——惰性的
`nativeSheetAdapterModule` 生成器与 `NATIVE_CSS_MODULE_SCRIPTS` 判定常量一并
删除，`style-assets.ts` 只发 fetch 一种形态；双适配器不复存在，因此不再是
待退役垫片，整行与详情小节一并移除。ADR-0164 附录 B/C 保留为支持矩阵的
历史证据。编号 3 留空不复用，避免历史引用错位。）
（2026-11-08 追加：第 8 项「`@lit-labs/ssr` 全局 DOM shim」已注销——
ADR-0152 当日 owner ruling 判定第一方 Lit renderer 零兼容退役，两个公共
入口与可选 peer 依赖一并删除；该 shim 随入口消失，不再是待退役垫片。
编号 8 保留在表中并标记「已删」，不复用。）
（2026-11-08 追加：第 17 项「渲染器适配缝（native / lit）」的退役条件同日
到期并执行——lit 侧入口 `lit.ts` / `lit-ssr.ts` 随第一方 Lit renderer 零兼容
退役删除，生成入口、服务端运行时与客户端构建只保留 native 分叉；
`renderer-adapter.ts` 收敛为 native 单模式，并对已退役的 `'lit'` 值显式抛出
迁移错误（迁移信号，不是兼容窗口）。该行标记「已删」，编号 17 保留不复用；
native 选择缝是主产物，不再作为垫片登记。）

## 条目详情

### 1. 岛 CSS 压缩变换（#1543）——已删（#1558，2026-10-07）

- 所有者（历史）：router OE Vite plugin（`packages/router/src/vite/internal/island-css.ts`，
  已随本项删除）。
- 退役条件已满足：#1558 把唯一创作形态改为 `.css` 文件 + import（css
  字符串模板整体退役，P5 无 shim），island chunk 里不再有任何 JS 内嵌
  CSS 可压。`island-css.ts` 与 `open:minify-island-css` transform、
  `island-css.test.ts` / `island-css-pipeline.test.ts` 守卫一并删除；
  接缝登记表的 "Island CSS shipped bytes (#1543)" 行随之注销。

### 2. `styleAssetProtocol` 激活开关（#1553）——已删（#1558，2026-10-07）

- 所有者（历史）：element 编译器选项 / router 样式准入（`style-admission.ts`
  + OEC9028，已随本项删除）。
- 退役条件已满足（ADR-0164 2026-10-07 修正案所记录的条件）：#1558 删除
  字符串准入机器（`style-admission.ts` + OEC9028）时一并退役了该选项，
  样式请求通道改为对编译模块的已授权 `.css` import 边的无条件登记
  （`style-requests.ts` 边注册表，P8 单写者不变）。

### 4. dev/SSR 内联 sheet 适配器——dev 半边已删除（S-C1.3），SSR 文本形态保留为边界

- 所有者（历史）：router（`inlineSheetAdapterModule`（已删除）/
  `serverStyleAssetPlugin`（保留），同在原 `style-assets.ts`）。
- 方向：dev server / SSR build → 模块图内联的 sheet 文本。
- 退役条件之一已经兑现（alpha15 S-C1.3，"dev 学会用 HTTP 服务协议资产"）：
  dev 通道现在把每条 authored 边服务为真实的 `text/css` 资源
  （`<base>.openElement/authored-css.<digest>.css`，字节 = Vite 自身
  `?inline` 处理后再做 S-C1.2 作用域投影），客户端适配器只携带 URL 并
  `fetch()` + `replace()` 到按 realm/边持有的共享 `CSSStyleSheet`
  （`STYLE_SHEET_LIVE` 使其在 markup 已声明同一链接时仍被 adopt，HMR 才能
  就地更新已连接的根）。`inlineSheetAdapterModule` 与其
  `replaceSync(<内联 CSS>)` 生成物、以及 `.css` 编辑触发的 full-reload
  分支都随之删除。
- 仍保留的一侧：SSR 构建对"没有产出资产的 sheet"（客户端图看不见的组件，
  如非 island 的页面组件；应用自带的内存 sheet）继续内联其文本
  —— 这是 S-C1.2 记录的边界，不是 dev 通道的退路，且文本本身就是构建期
  `@scope` 投影。dev 下这类 sheet 不再内联（dev 端点覆盖每条 edge）。
- 同源修正（S-C1.3 follow-up）：BUILD 侧发出的 `.css` 资产也不再是
  "作者原字节"而是同一条 Vite `?inline` 处理链的产物（`@import` 展开、
  `url()` 由 Vite 资产图产出并改写、随后做作用域投影），文件名哈希仍取自
  最终文本；SSR 文本形态是唯一保留作者原字节的一侧。退役条件不变
  （server-only CSS 资产发现）。
- 处置：dev 半边已删（S-C1.3）；SSR 文本形态保持"保留为边界"，其删除
  条件是 server-only CSS 资产发现（剩余 S 收口项）。

### 5. `ShimStyleSheet`（SSR 侧 CSSStyleSheet）——保留为平台边缘

- 所有者：element core（`packages/element/src/internal/core/style-sheet.ts:12`
  `parseRules`、`packages/element/src/internal/core/style-sheet.ts:97`
  `ShimStyleSheet`）。
- 方向：运行期 `StyleSheetLike` 契约——浏览器委托原生 `CSSStyleSheet`，
  Node SSR 落到内存 shim，序列化器经 `cssRules` 读回规则。
- 平台缺口：受支持的服务端运行时（Node 24）没有可构造、可读
  `cssRules` 的原生 `CSSStyleSheet`。
- 退役条件：全部受支持服务端运行时原生提供该 API 之日，`ShimStyleSheet`
  与 `parseRules` 整段删除，`StyleSheet` 收敛为原生构造器别名。
- 处置：保留为平台边缘。

### 6. SSR 全局垫片——保留为平台边缘

- 所有者：router SSG build（`ssr-polyfills.ts`：CSSStyleSheet banner +
  customElements Map stub；`build-ssg.ts` 的 output banner 与 dev 虚拟
  入口装配）。
- 方向：构建期生成代码 → SSR 产物全局对象（`customElements.define` 在
  路由模块顶层执行，垫片必须先于一切 import 求值；stub 带
  `SSR_REGISTRY_STUB_MARKER` 支持 dev 重求值，#952/#965）。
- 平台缺口：Node 无 DOM 注册表与样式表全局；这是"浏览器原语在服务端
  缺席"的最小补丁，不是第二个实现。
- 退役条件：SSR 目标运行时原生提供 `customElements` + 可构造
  `CSSStyleSheet`（Workers/Deno 具备、Node 不具备），或路由模块不再在
  模块顶层 `define()`（设计变更）。
- 处置：保留为平台边缘。

### 7. 浏览器怪癖台账（#579/#604/#610）——保留为平台边缘

- 所有者：router morph client（`morph-webkit-fix.ts`、`form-enhance.ts`，
  模块头即"KNOWN-BROWSER-QUIRKS 反腐台账"）。
- 方向：客户端运行时 → 浏览器引擎差异。
- 退役条件（P5；各条目自带删除条件，条件到即删对应条目及其 workaround，无需另行
  评审；2026-10 现状条件未到）：#579 DSD 只由 HTML parser 实例化，DOMParser
  树保持惰性 `instantiateDsd()` 先于插入手动实例化 → "所有引擎对 DOMParser 树
  实例化 DSD"即删；#604 WebKit 对 parser-inert 文档迁入 shadow root 的元素永久跳过
  升级，`repairShadowUpgrades()` 重插补票 → "WebKit 在 adoption 时
  升级此类元素"即删；#610 submit 事件并非每个引擎都 composed，文档级监听看不见 DSD 内
  表单，`attachSubmit()` 逐 shadow root 挂接 → "submit 全引擎
  composed（或表单不再住 shadow root）"即删。
- 处置：保留为平台边缘。台账纪律已内建：条件到即删对应条目及其
  workaround，无需另行评审。

### 8. `@lit-labs/ssr` 全局 DOM shim——已删

- 所有者：router 第一方 Lit 渲染器（服务端入口曾以副作用首导入装配
  `installWindowOnGlobal`；渲染器适配、虚拟模块与 SSG 构建 CLI 曾装配
  同一事实）。
- 方向：服务端全局 DOM shim → Lit SSR 渲染通道。
- 存在原因：上游 `@lit-labs/ssr` 需要 DOM 全局；这是上游依赖的形状，不是
  我们自建的层。
- 退役条件：**已执行**。ADR-0152 2026-11-08 owner ruling 判定 WC 作为通用
  host base 不成立，第一方 Lit renderer 零兼容退役；两个公共入口、可选
  peer 依赖与对应测试已删除，编号 8 保留不复用。2026-09-16 修正案
  「Lit renderer mode is doctrine, not debt」及 2026-11-03 取代性修正案
  均只在 Git 历史与 ADR 正文中保留为历史记录。
- 处置：**已删**。

### 9. Nitro mount 适配——保留为平台边缘

- 所有者：router（`packages/router/src/nitro-mount.ts`）。
- 方向：Nitro 路由事件 → OpenElement 请求上下文； Nitro v3 fetch 原生，
  pre-v3 的方法/头/体翻译层已删，mount 只包运行期上下文。
- 存在原因：P5 明文的部署边界——"兼容只存在于部署边界，绝不渗入应用
  代码"；mount 被关在 `dist/server` 出口，对应用代码不可见。
- 退役条件：无（只要 Nitro 是受支持部署目标，此缝即产品面）。若 Nitro
  事件形状再变，改的是这一个文件。
- 处置：保留为平台边缘。

### 10. node:http `serveFetch` 适配——保留为平台边缘

- 所有者：router（`packages/router/src/internal/node-http.ts`）。
- 方向：`node:http` 请求 → 标准 `fetch(Request): Promise<Response>`
  派发（`start` CLI、fixture server 共用）。
- 存在原因：node:* 没有把 fetch 处理器暴露为服务器的单行原语
  （node 移植残留记录：内部文档，不发布，§5）。
- 退役条件：Node 原生提供 fetch-handler 服务器原语（或仓库放弃本地
  `start` 通道）之日删除。
- 处置：保留为平台边缘。

### 11. Workers `nodeCompat`（unenv）——保留为平台边缘

- 所有者：部署配置（`apps/saas/nitro.config.ts:16`、
  `tests/fixtures/router-nitro/nitro.config.ts:22` 同形）。
- 方向：Nitro Workers preset → Cloudflare 运行时（unenv 在产物
  `_libs/` 中垫 Node 内建）。
- 存在原因：Workers 无原生 Node 内建；边界闸
  `tools/repo/check-workers-boundary.ts` 白名单恰为 `node:process` 与
  `node:buffer`，任何再引入的 Deno API 或未白名单 Node 面直接 fail。
- 退役条件：Workers preset 的服务端模块不再触碰 Node 内建（当前两个
  白名单成员消失），`nodeCompat: true` 即可关掉，unenv 从产物消失。
- 处置：保留为平台边缘。

### 12. `Deno.Command` 形状仿真——已删（N-1 重塑，2026-10-13）

- 所有者：repo 工具（`tools/repo/node-command.ts`；重塑覆盖 27 个消费文件，
  横跨 `tools/repo`、`tools/lib`、`tools/release`、`www/tools`、
  `benchmarks/streaming` 与 element `__wtr__`）。
- 退役条件已执行：宿主已退（Deno），形状保持的理由随之失效。N-1 工具车道按
  "正式承认这些形状为本仓规范 spawn 助手、重写文件头删除 Deno 叙事"一路执行：
  - 删除 `denoStatus` 与整段 Deno.Command 叙事；模块头就地写明信号/退出码/
    中止/env/stdio 语义与理由；
  - `commandOutput` 与 `commandStatus` 合并为单一异步 `spawnCommand`（原二分只
    镜像 `.output()/.spawn()`，实现本就同体）；`commandOutputSync` 改名
    `spawnCommandSync`；全部调用点随改。
- **保留的契约（有意为之，非残余）**：信号杀进程仍报 `128 + 信号号`
  （SIGTERM→143）——`check-coverage.ts` 的 native-crash 重试以 ≥128 为界
  （#1278），`run-in.ts`/`gate.ts` 把 `code` 交给 `process.exit`（node 的
  `code: null` 会退出 0），release harness 的失败诊断也打印该值；env 合并、
  spawn 失败 reject/throw 的形状不变。依赖由新增契约测试
  `tools/repo/node-command.contract.test.ts`（退出码、SIGTERM/SIGKILL、中止、
  env、stdio、spawn 失败）钉住。
- 附带债务已清：abort 路径已在 Node 24 上重新验证——运行中与运行前中止均以
  `SIGTERM`/143 resolve（不 reject），正是 packed-consumer 超时 harness 依赖的
  行为。
- 处置：**已删**（形状仿真）；`tools/repo/node-command.ts` 作为一等 spawn
  助手保留（工具车道的一次机械重塑，本分支执行）。

### 13. TypeScript `ParserPort` 后端——保留为平台边缘

- 所有者：element 编译器（现 `@openelement/compiler`；
  `packages/compiler/src/internal/compiler/semantic-core/parse-module.ts`
  `typescriptParser`，语义核唯一解析缝，#1473）。
- 方向：TS JS 解析 API → 语义核 AST。
- 存在原因：oxc 尚未稳定支持标准装饰器；tsgo 原生 API 尚未成为受支持
  解析入口。
- 退役条件（双触发器取先到；已写在
  `packages/compiler/src/internal/compiler/semantic-core/parse-module.ts:11-19`）：TS 6 线
  JS-API 维护终止，或 oxc 标准装饰器宣告稳定——届时 `typescriptParser`
  换为 oxc/tsgo 后端实现，TS 实现随删，管线与诊断契约不动。
- 处置：保留为平台边缘（工具链适配器，触发器已写死）。

### 14. signal 引擎 Preact 适配——保留为平台边缘

- 所有者：element signal 模块（`packages/element/src/internal/signal/`，
  内建 Preact adapter，`SignalEngine` 为可替换边界）。
- 方向：`@preact/signals-core` → 框架响应式原语。
- 平台缺口：Signals 尚非平台 API（TC39 提案阶段）。
- 退役条件：TC39 Signals 进平台（或经 `SignalEngine` 契约整体换引擎）
  之日，适配层随换。
- 处置：保留为平台边缘。

### 15. `@openelement/url-pattern-list` 维护 fork——保留为平台边缘（附评估结论）

- 所有者：router 路由核（`route-table.ts:1-2` 独一消费点；独立仓库
  `open-element/url-pattern-list` 维护 fork，npm 0.6.0，
  `packages/router/package.json:40`；供给链已有 provenance 闸
  `tests/fixtures/url-pattern-list-audit` + `minimumReleaseAge`）。
- 方向：URLPatternList（多模式优先级匹配数据结构）→ RouteTable 索引。
- 评估结论（本任务对 issue #1559 候选 3 的回答）：**该包不是
  URLPattern 的 polyfill，Baseline 评估对它不构成退役条件。**
  `URLPattern` 本体在树中早已原生强制、fail-closed、无 polyfill——
  `route-table.ts:95-108`：缺失即 `TypeError`，注释明言"there is no
  polyfill fallback"（[ADR-0154](../adr/ADR-0154-alpha-baseline-removals.md)
  §1：`urlpattern-polyfill` 回退已删；URLPattern 平台支持 Chrome 73 /
  Firefox 115 / Safari 16.4，2026 年的受支持目标全部自带）。树里待查的
  `URLPattern` 派生只有一个方言归一函数
  （`route-pattern.ts:1-11`，Hono 风格路由语法 → WHATWG URLPattern
  语法，作者面向边界，平台无对应物）。
  `URLPatternList` 本身是产品语义（声明序 + 优先级 + 身份的批量匹配
  算法），平台没有对应原语，标准轨道上也无多模式匹配提案——
  [ADR-0152](../adr/ADR-0152-product-router-and-alpha-convergence.md)
  已定性："URLPattern remains the platform/polyfill grammar owner;
  none belong in the generic list library"。
- 退役条件：不是平台事件而是设计事件——路由核改为静态路径索引 +
  单模式回退之类的自持结构（#1324 语义重审），或标准轨道出现多模式
  匹配原语。在此之前它是算法库，不是待偿垫片。
- 处置：保留为平台边缘。

### 16. CEM 兼容分类——保留为平台边缘（产品互操作面）

- 所有者：router SSG（`cem-compat.ts` / `cem-scanner.ts`；文件名里的
  "compat" 指 third-party custom elements manifest 的兼容分类，不是
  平台垫片）。
- 方向：第三方包 CEM 文件 → 准入分类（ADR-0157 的 T0–T3 层级）。
- 退役条件：无近期的——CEM 是生态事实标准，读它是产品互操作承诺
  （[ADR-0157](../adr/ADR-0157-web-component-admission-tiers.md)）；
  仅当 CEM 规范形状变更时随之改写。
- 处置：保留为平台边缘。

### 17. 渲染器适配缝（native / lit）——已删（ADR-0152，2026-11-08）

- 所有者（历史）：router SSG（`packages/router/src/vite/internal/ssg/renderer-adapter.ts`
  ——生成入口对页面渲染运行时的唯一分叉点；lit 侧入口 `lit.ts` / `lit-ssr.ts`
  已随本项删除）。收敛后的单模式选择仍在该文件：`RendererMode = 'native'`，
  `selectRendererAdapter` 只接受缺省或 `'native'`，对已退役的 `'lit'` 值抛出
  显式迁移错误（ADR-0152 当日 owner ruling），其余值 fail closed。
- 方向（历史）：entry codegen → 渲染器运行时绑定；两模式共享应用语义，
  分叉曾仅在此缝。
- 退役条件：**已执行**——lit 分支随 ADR-0152 独立轨道退役（同 #8）于
  2026-11-08 删除：两个 lit 公共入口与可选 peer 依赖移除，生成入口、服务端
  运行时与客户端构建不再有 lit 分叉；`renderer-adapter.ts` 收敛为 native
  单模式并保留对 `'lit'` 的显式退役拒绝作为迁移信号。native 侧没有可退的
  垫片——它是主产物，不是兼容层；原文「教义，非债」的定性已被 2026-11-03
  取代性修正案推翻，不再有效。
- 处置：**已删**（lit 分叉）；native 选择缝为长期主产物，不再是登记簿意义上
  的垫片。

### 18. legacy 虚拟入口 id（`virtual:open-hono-entry`，ADR-0152）——条件到即删

- 所有者：router OE Vite plugin（`packages/router/src/vite/plugin-virtual-modules.ts:14`
  `VIRTUAL_ENTRY_ID` 是唯一声明点；`packages/router/src/vite/internal/ssg/build-postprocess.ts:250`
  的 `_virtual_open-hono-entry` 前缀判定是唯一读者）。
- 方向：虚拟模块 id → dev/SSR 入口代码 + 产物文件名的 `_virtual_` 前缀。
- 存在原因：ADR-0152（2026-09-16 修正案）定性——该 id 与其
  `_virtual_open-hono-entry` 资产前缀是**保留的 legacy 名称，不携带依赖
  语义**；hono 已不是路由内部实现，改名只会搅动构建产物名称而没有可观察
  的变化。
- 退役条件：下一次产物命名 / 布局的不兼容变更（或该 id 不再出现在任何
  产物名中，例如 SSG 产物命名重排）随那次变更一起改名为
  `virtual:open-element-entry` 并删除旧前缀判定；单独为改名而改名已被
  ADR-0152 否决。
- 处置：条件到即删（随下一次产物命名不兼容变更一起改名）。

## 审计中排除的非垫片（避免下次重查）

- `jsx-runtime.ts` / `jsx-dev-runtime.ts`：标准 JSX runtime 入口点，
  平台形状本身。
- `createRuntimeAdapter` / `composeFetchMiddleware`（element
  `build-utils`）：P3 宿主集成缝，消费点
  `packages/router/src/vite/internal/server-runtime/app.ts:200`；是
  设计的扩展点，不是兼容层。
- `critical-assets.ts` / `minifyCriticalStyleBlocks`：文档头通道的
  关键资源管线，与 #1543 的 JS 内嵌 CSS 无关。
- `tools/lib/compatibility-date.ts`、`check-retired-api-refs.ts`、
  `pack-surface.ts` 等：门禁工具，是退役的执行者而非待退役者。
- `packages/element/__tests__/compiled-runtime/test-engine.ts`：
  测试替身，不交付。
- `packages/element/src/internal/core/html-escape.ts:256`、
  `packages/element/src/internal/core/security.ts:15` 等处注释里的"retired"：已偿
  债务的墓碑记录，指认的是删掉的东西。
- `tests/fixtures/url-pattern-list-audit`：供给链证明 fixture（#15 的
  守卫），非运行时代码。

## 复审机制

本登记簿由"平台追账评审"（[design-principles](./design-principles.md#platform-catch-up-review)；
逐版本记录见 [platform-catch-up.md](../release/platform-catch-up.md)）按 release 周期驱动：每周期逐行重估"条件到即删"的到期情况与
"平台边缘"的追账进度，新 shim 入场时必须同时入表并写死条件。与
[seams.md](./seams.md) 的分工：接缝表管"谁写谁读、守卫
在哪"，本表管"为何存在、何时能删"；同一工件两边都该有一行，交叉引用
即可，不重复维护事实。

机器面：`tools/repo/check-shims.ts`（`@openelement/tools-repo#shims:check`）
在 `gate:source` 里读本文件——汇总表每行的位置必须存在且被 Git 跟踪
（已删行相反：划线且不存在）、每个编号必须有详情小节且带非空的所有者与
退役条件、每条 `path:line` 引用必须落在文件行数内。评审结论改的是文字，
机器守住的是"登记项不会没有主人、不会没有退役条件、不会指向不存在的
路径"。
