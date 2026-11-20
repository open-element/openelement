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
| 19 | Part Program 执行器（旧执行后端） | `packages/element/src/internal/compiled/facade-host.ts`（Part Program → live element 行为的唯一入口；`packages/element/src/internal/compiled/runtime-program.ts` 与之同属该后端，`packages/element/src/internal/compiled/runtime/` 下的 hydrate/resume 的 Part 路径由它驱动） | 条件到即删（M08 的 SSR→claim 与 per-phase 等价在固定 SHA 签收后，下一个 release 周期随生成叶路径接入产品入口一起删除） |
| 20 | Class authoring API（旧作者面） | `packages/element/src/open-element-implementation.ts`（`OpenElement` 基类；`base.ts`、`open-element-configuration.ts`、`error-boundary.ts` 的类形状同属该面）；router 侧连带文件（退役执行时一并清理）：`packages/router/src/authoring.ts:456`（`isElementPageClass` 类形状判别）、`packages/router/src/vite/internal/server-runtime/renderer-runtime.ts:146`（`resolveCompiledPageTag` 读编译产物 `__partProgram.tag`）、`packages/router/src/vite/internal/ssg/entry-descriptor.ts:467`（页面路由 `defaultTagName` 载体） | 条件到即删（ADR-0173 第四轮已批准零兼容退役；Alpha16b 的 C-1/C-3 能力清单覆盖证据落地、starter/文档迁移完成后删除） |
| 21 | 生成宿主注册对（M11 垂直切片，ADR-0181） | `packages/router/src/vite/internal/server-runtime/security.ts`（`registerIsland`）+ `packages/protocol/src/registry-markers.ts`（`SSR_REGISTRY_GENERATED_HOSTS`） | 条件到即删（P1 在 tracked 依赖图工件上对全部适用应用判 MET 后随 M11-3 入口切换删除） |
| 22 | 私有实例保留账本（ADR-0181） | `packages/element/src/internal/compiled/runtime/instance-ledger.ts`（经 `runtime.ts` 对发射代码 re-export） | 条件到即删（Alpha17 预编译分发取代发射式保留计划、且无发射模块再 import 该账本） |
| 23 | browser-entry-graph 观测工件与检查器（temporary-by-intent） | `packages/router/src/vite/internal/browser-entry-graph.ts`、`browser-entry-graph-artifact.ts`、`tools/repo/check-browser-entry-graph.ts` | 条件到即删（P1 判 MET 且该证据并入 release 门禁后移除一次性检查器；工件本身不进入发布面） |
| 24 | `OE_ISLAND_STYLE_SHADOW_UNWIRED` 拒绝（ADR-0181） | `packages/router/src/vite/internal/ssg/island-scanner.ts` | 条件到即删（2026-11-20 已按书面条件退役一次：shadow 载体落地后范围收窄为 server-rendered 且无 producer 的诚实情形；client-only 半边随后也放开。剩余情形的删除条件：server-rendered 生成岛全部获得 producer） |
| 25 | legacy allocation-only 绑定工厂（descriptor `createBindings`，M09-0 shell 测试遗留） | `packages/element/src/internal/compiled/generated-element/shell.ts`（descriptor `createBindings` 字段及其 allocation-only 契约注释，条目引用 `:448-470`） | 条件到即删（M09 shell 测试全部迁移到 `createInstance` 后删除） |
| 26 | rolldown-vite `buildStart` 诊断面 workaround（#1616 报告先行契约） | `packages/router/src/vite/internal/build-diagnostics.ts`（"The interim contract, until the bundler is fixed"，条目引用 `:91`） | 条件到即删（rolldown-vite 修复对应缺陷后删除） |
| 27 | #1558 前已发布产物的 permissive 样式边兼容读 | `packages/compiler/src/internal/compiler/compiled-artifact-style-requests.ts`（PERMISSIVE 读，条目引用 `:23-25`） | 条件到即删（#1558 前发布的产物退出受支持窗口后收紧为严格准入） |
| 28 | `registerOpenUi` published-API 空操作垫片（`@openelement/ui`） | ~~`packages/ui/src/register.ts`~~ | **已删（1.0.0-alpha.16；该 shim 写的 breaking-alpha 条件已满足）** |

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

### 19. Part Program 执行器（旧执行后端）——条件到即删

- 所有者：element runtime（`packages/element/src/internal/compiled/facade-host.ts`
  与 `packages/element/src/internal/compiled/runtime-program.ts` 是 `__partProgram`
  的消费者；`packages/element/src/open-element-implementation.ts` 是编译期产物
  进入公开 facade 的唯一入口）。
- 方向：编译器产物（`__compiledProperties` / `__partProgram`）→ 公开基类的
  live element 行为。
- 存在原因：alpha.15 及以前唯一的执行后端；ADR-0174 接受下一代
  mount/claim/update/dispose 的直出路径，同时明示"旧执行器尚未退役"。生成叶
  路径目前只被编译器内部与测试使用，尚未接入产品入口，因此这条后端仍然是
  产品实际运行的路径。
- 退役条件：M08 的 SSR→claim 与 per-phase 等价（S/K/U/D）在固定 SHA 上签收，
  且生成叶路径已接入产品入口（同一入口只有一处路径决策点）之后，下一个
  release 周期删除本后端；删除时必须同时移除 `__partProgram` 产物形状与
  对应的 README/公开说明。条件事件而非日期。
- 处置：条件到即删。

### 20. Class authoring API（旧作者面）——条件到即删

- 所有者：element 作者面（`packages/element/src/open-element-implementation.ts`
  的 `OpenElement` 基类是唯一根；`base.ts` / `open-element-configuration.ts` /
  `error-boundary.ts` 继承它）。
- 方向：authoring 源（class + decorator）→ 编译期产物 → 上述执行器。
- 存在原因：alpha.15 的公开作者面。ADR-0173 第四轮修正案（2026-11-03，
  D-O3 取代）已批准**零兼容退役、不建迁移适配器**，但批准的形态变更不等于
  实现证据：类作者面仍在树内。
- 退役条件：Alpha16b 的 C-1（size attribution）与 C-3（base codegen）能力
  清单覆盖证据落地，且 starter/docs 完成迁移（`docs/architecture/tsx-author-candidate-contract.md`
  从候选转正）之后删除；删除时公开面只保留 Native Custom Element 边界，不留
  适配器。
- 处置：条件到即删。

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

### 21. 生成宿主注册对（M11 垂直切片）——条件到即删

- 所有者：router server-runtime 注册守卫（`installSsrRegistryGuard` 是唯一写者）。
- 方向：编译器 `ssrHostExport` → 生成入口静态命名导入 → `registerSsrIsland(tag, ctor, host)` 原子配对 → 元素序列化器在嵌套回调里按 tag 取回 renderer。
- 存在原因：生成元素没有 `__partProgram`，旧执行器路径无法为其提供 SSR；这层配对是让请求期渲染不必读模块形状（C07 禁止的模式）的最小载体。
- 退役条件：P1 在 tracked 依赖图工件上对全部适用生产应用判 MET（`tools/repo/check-browser-entry-graph.ts` 全 MET 于一个 clean SHA），且 M11-3 客户端入口切换落地后，配对表随旧执行器一起删除；核验用 `gate:source` + `gate:packed` 在同一 SHA 绿。
- 处置：条件到即删。

### 22. 私有实例保留账本——条件到即删

- 所有者：element 生成元素运行时（`generated-element/shell.ts` 是唯一消费方）。
- 方向：生成根 mount/claim 打开一次 pass → `retainChildInstance` 记条目 → 结构性/引用位点显式 release；销毁期 `releaseRetainedChildren`。
- 存在原因：ADR-0173 要求 setup 只跑一次、断连不重跑，而发射代码在 reconnect claim 时会重算 setup 局部；账本是让保留语义有单一所有者的最小运行时。
- 退役条件：Alpha17 预编译分发取代当前发射式保留计划，且 `packages/element` 内无发射模块再 import 该账本（`grep` 归零即谓词，`gate:source` 绿）。
- 处置：条件到即删。

### 23. browser-entry-graph 观测工件与检查器——temporary by intent

- 所有者：router 客户端构建（观察者插件是唯一写者）+ `tools/repo` 只读检查器（唯一读者）。
- 方向：客户端构建 → `<clientOutDir>/.vite/oe-browser-entry-graph.json` → 检查器判定 MET/VIOLATED/UNPROVEN。
- 存在原因：P1 要求"生产浏览器入口图上旧执行器不可达"的可重算证据，源码 grep 与包依赖图都不能替代真实 chunk 图。工具刻意不接入任何 gate（gate 顺序属 release lane 决定）。
- 退役条件：P1 判 MET 且该证据并入 release 门禁之后，一次性检查器删除；工件始终是 Git-ignored 构建输出，不进入发布面。
- 处置：条件到即删（工具本身不是产品面）。

### 24. `OE_ISLAND_STYLE_SHADOW_UNWIRED` 拒绝——**已退役**（2026-11-20）

- 所有者：`packages/router/src/vite/internal/ssg/island-scanner.ts`
  （`admitIslandStyles` 的 `missing-producer` 分支）。
- 退役条件：GH #1800 落地 shadow 样式 link 载体、且 shadow-root 生成岛带
  `styles` 能构建并渲染后移除该拒绝。**条件已满足**（载体 M09-2e 落地，随后
  client-only 半边也落地）。
- **退役动作**：`docs/architecture/alpha16-class-migration-matrix.md` 的
  "the shadow style carrier exists; the authoring face said otherwise" 一节。
- **退役时的事实**：DSD 样式 link 载波已落地 —— 编译器在宿主 producer 上发出类型化
  `styleLinks` 通道，`serializeGeneratedElementHtml` 在模版内写出规范 marked
  `<link>` 前缀；构建扫描对 `producer` 身份 + root `shadow` **准入**（原先是拒绝）。
  作者面（`defineIslandConfig`）此前仍以"载波未接"为由拒绝同一组合，已一并改正 ——
  这正是该 shim 记录要防的两面读同一事实却答案相反。
- **保留的部分**：`missing-producer` 情形仍 fail closed。那是**诚实的**情形 ——
  没有模版可以声明样式表，接受声明才是静默丢失。它与原 shim 的方向不同：原 shim
  拒绝的是"shadow root 一律拒绝"，现在拒绝的是"没有模版的 shadow root"。
- 证据：`island-styles.test.ts` 的准入行（原拒绝行已改写并写明原因）、
  `generated-light-styles.test.ts`、`@openelement/create` 3 files / 68 tests。
- **2026-11-20 追加：`missing-producer` 的范围再收窄一次。** client-only
  （`ssr: false` / `hydrate: 'only'`）的 shadow island 不再需要 host producer：
  浏览器自建 root，编译器为同一 `styles` 声明发出真实模块图 import，shell 用
  `CompiledStyleScope` 采用 sheet。因此扫描对 client-only 的 `missing-producer`
  **准入**，该拒绝只剩 server-rendered 无 producer 一种诚实情形。
  证据：`island-styles.test.ts` 的新增准入行、`generated-element.client-styles.test.ts`、
  element-browser `client-only-styles.test.js`（真实浏览器 computed `:host`）。

### 25. legacy allocation-only 绑定工厂（descriptor `createBindings`）——条件到即删

- 所有者：element 生成元素 shell（`packages/element/src/internal/compiled/generated-element/shell.ts:448-470` 的 descriptor 字段、allocation-only 契约注释与 `createBindings?.() ?? {}` 回退；语义记载于
  `docs/architecture/m09-generated-element-shell.md`——"the legacy allocation-only factory for hosts/tests"）。
- 方向：descriptor（hosts/tests 手写 fixture，或尚未发射 `createInstance` 的旧路径）→ shell 每元素首次连接调用一次 → 返回记录保留整个元素生命周期（重连不重跑）。
- 存在原因：M09-0 shell 测试先于 T3 的 `createInstance(owner, host)` 落地；该工厂拿不到 cleanup owner，契约因此被迫收窄为 allocation-only（不得申请任何需要清理的资源，只能分配 signals/computeds 与纯数据）。生成路径如今只对 ROOT 发射 `createInstance`，shell 仅为无 setup 快照的根保留 `createBindings?.() ?? {}` 回退。
- 退役条件：M09 shell 测试全部迁移到 `createInstance`（带 owner 的 retained setup 工厂，descriptor-fixture 证据随之改写）之后，从 descriptor 契约中删除 `createBindings` 字段及其校验；与 `createInstance` 的互斥 fail-closed 判定随本字段一并退役（只剩一个 call-once/retain 位点，互斥规则自然消失）。
- 处置：条件到即删。

### 26. rolldown-vite `buildStart` 诊断面 workaround——条件到即删

- 所有者：router 构建诊断（`reportScanFatal`——scan-phase fatal 的唯一"报告先行"缝，`packages/router/src/vite/internal/build-diagnostics.ts:84-103`）。
- 方向：scan-phase fatal → 诊断信封双通道（人读 `[CODE] …` 行进构建日志 + 信封记录供机器可读 exit 重放）→ 返回错误、由 raise 点保留自己的 `throw`。
- 存在原因：rolldown-vite 8 的 `buildStart` 错误面不把抛出的消息带给 CLI（alpha15 基线上即已存在的上游缺陷）：只 throw 的 scan-phase fatal 是开发者永远看不见的诊断——构建带着半空的 scan 继续走，随后以误导性的下游错误失败。
- 退役条件：rolldown-vite 修复该缺陷——`buildStart` 抛出的错误消息能原样到达 CLI——且修复版本进入受支持矩阵后，删除"报告先行"的中间契约，raise 点恢复直接 throw。上游修复是平台事件，条件到即删。
- 处置：条件到即删。

### 27. #1558 前已发布产物的 permissive 样式边兼容读——条件到即删

- 所有者：element 编译器（`packages/compiler/src/internal/compiler/compiled-artifact-style-requests.ts:23-25` 的 PERMISSIVE 读——只认相对 `.css` 默认 import 数组，对 `static styles` 数组的其余成员一概不碰）。
- 方向：#1558 前发布的已编译产物模块 → 从 `static styles` 数组词法恢复样式边（构建期）→ 走与 authored 边相同的 style-edge registry / Vite CSS 管线。
- 存在原因：#1558 把样式创作形态收敛为 `.css` 文件 + import 之前发布的产物（引用 plain module `StyleSheet` 的 legacy 内联 sheet）继续走旧路径不变——这里的严格准入会让每一个先前发布的包平白破产，换不来任何协议收益。
- 交叉登记：接缝事实（单写者、守卫测试与 Missing/unreadable 行为）登记在
  [seams.md](./seams.md) 的 "Compiled-artifact style-edge adoption (alpha.13 I1, KR-10b)" 行；迁移矩阵对应
  [m01-consumer-migration-matrix.md](./m01-consumer-migration-matrix.md) C13（词法读、build only、"facts emitted, not re-parsed"）。
- 退役条件：#1558 前发布的产物版本退出受支持窗口（消费方按
  [m01-consumer-migration-matrix.md](./m01-consumer-migration-matrix.md) 完成重编译迁移）之后，把这段 permissive 读收紧为对 ONE 样式创作语法（`semantic-core/style-imports.ts`）的严格准入；届时旧形状在打包消费证据上 fail closed，而不是静默走旧路径。
- 处置：条件到即删。

### 28. `registerOpenUi` published-API 空操作垫片（`@openelement/ui`）——**已退役**（2026-11-20）

- 所有者：`@openelement/ui` 的 published-API 面（`packages/ui/src/index.ts` 的
  `registerOpenUi` 导出及其 `register.ts` 实现）。
- 退役条件：`@openelement/ui` 不再发布该 export / 全部消费方改用 generated entry，
  **或**随下一次 breaking alpha 删除（该 export 属 experience-edition 面，不需要
  兼容适配器）。**条件已满足**：`1.0.0-alpha.16` 就是那次 breaking alpha。
- **退役动作**：`1.0.0-alpha.16`（本条线）。`packages/ui/src/register.ts` 删除，根
  导出与模块文档示例同步移除，packaged-consumer harness 不再调用它。
- **依据**：该 shim 自己写的第二个退役条件——"或随下一次 breaking alpha 删除（该
  export 属 experience-edition 面，不需要兼容适配器）"。alpha.16 是那次 breaking
  alpha，所以不等"全部消费方改用 generated entry"这条更慢的条件。
- **退役时的状态**（删除前的实测）：`packages/ui/src` 中 `extends OpenElement` 计数
  **0**，函数体为空，`registerOpenUi` 只出现在自身声明、根导出、文档示例与
  packaged-consumer harness 四处——即一个**纯兼容面**。
- **同步更新**：`docs/release/public-interface-snapshot.json`（diff 恰为删掉
  `registerOpenUi` 一个符号 + shape hash）、`packages/ui/__tests__/smoke.test.ts`
  （原"空注册表且幂等"行改写为"该面已退役而非仅空"，并仍断言每个元素由构建注册）。
- **不是缺口**：六个 first-party 元素依旧各自导出并通过构建自行注册；删除的是一次
  空调用，不是任何元素。
