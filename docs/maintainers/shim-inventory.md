# Shim 盘点（P5 登记簿）

设计宪法 P5 要求：每个 shim 落地时写明退役条件；"平台追账评审"每个
release 周期用这把尺子重温一遍。本文件是那个此前缺失的登记簿
（issue #1559）：全仓每一个兼容层 / 适配器 / 垫片，逐项标注所有者、
方向、存在原因、退役条件与处置。

处置只有三档：**现在删** / **条件到即删**（条件写死，条件到即执行删除，
不等下一次评审）/ **保留为平台边缘**（平台尚未追上，删除条件是平台事件
而非工程事件）。默认倾向删：登记一项却不写条件 = 缺陷。

方向一栏回答"谁写、谁读"——P8 接缝（见
[seams.md](../architecture/seams.md)）在跨界工件上有常驻守卫测试；本表
回答的是另一个问题："这块代码为什么还活着、平台/工具链追上来时删什么"。
两表互补，不重复登记守卫。

盘点基线：alpha10（`ca4671c75`），2026-10-07，工作树干净。扫描范围：
`packages/ tools/ www/ apps/ tests/` 全量源码，关键词 shim / polyfill /
adapter / compat / fallback / 退役 / "Delete when" / deno；再对每处命中
逐个读码定性。

## 汇总表

| # | 垫片 / 适配层 | 位置 | 处置 |
| --- | --- | --- | --- |
| 1 | 岛 CSS 压缩变换（#1543） | `packages/router/src/vite/internal/island-css.ts` | 条件到即删（随 #1558） |
| 2 | `styleAssetProtocol` 激活开关（#1553） | element 编译器选项 | 条件到即删（随 #1558） |
| 3 | CSS 双适配器：fetch 回退形态（#1553） | `packages/router/src/vite/internal/style-assets.ts` | 条件到即删（Safari + 工具链）；单一化子裁决待 owner |
| 4 | dev/SSR 内联 sheet 适配器（#1553） | 同上 | 条件到即删（同 #3 的判定翻转或 dev 走 HTTP） |
| 5 | `ShimStyleSheet`（SSR 侧 CSSStyleSheet） | `packages/element/src/internal/core/style-sheet.ts` | 保留为平台边缘 |
| 6 | SSR 全局垫片（CSSStyleSheet banner + customElements stub） | `packages/router/src/vite/internal/ssg/ssr-polyfills.ts` | 保留为平台边缘 |
| 7 | 浏览器怪癖台账（#579/#604/#610） | `morph-webkit-fix.ts`、`form-enhance.ts` | 保留为平台边缘（各条目自带删除条件） |
| 8 | `@lit-labs/ssr` 全局 DOM shim | `packages/router/src/lit-ssr.ts` 等 | 保留为平台边缘（上游 + 教义） |
| 9 | Nitro mount 适配 | `packages/router/src/nitro-mount.ts` | 保留为平台边缘（P5 明示的部署边界） |
| 10 | node:http `serveFetch` 适配 | `packages/router/src/internal/node-http.ts` | 保留为平台边缘 |
| 11 | Workers `nodeCompat`（unenv） | `apps/saas/nitro.config.ts`、fixture 同形 | 保留为平台边缘 |
| 12 | `Deno.Command` 形状仿真（deno→node 残余） | `tools/repo/node-command.ts` | 条件到即删（工具车道重塑调用点后删） |
| 13 | TypeScript `ParserPort` 后端 | `packages/element/src/internal/compiler/semantic-core/parse-module.ts` | 保留为平台边缘（双触发器已写死） |
| 14 | signal 引擎 Preact 适配 | `packages/element/src/internal/signal/` | 保留为平台边缘 |
| 15 | `@openelement/url-pattern-list` 维护 fork | `packages/router/src/internal/router/route-table.ts` | 保留为平台边缘（附评估结论） |
| 16 | CEM 兼容分类（第三方 WC 准入） | `packages/router/src/vite/internal/ssg/cem-compat.ts` | 保留为平台边缘（产品互操作面） |
| 17 | 渲染器适配缝（native / lit） | `packages/router/src/vite/internal/ssg/renderer-adapter.ts` | 保留为平台边缘（教义，非债） |

没有"现在删"项：扫描发现的文本级残余（脚本头部陈旧的 `deno run` 用法
散文）已在 alpha8/alpha10 清理；其余命中要么已含书面退役条件，要么是
平台缺口本身。

## 条目详情

### 1. 岛 CSS 压缩变换（#1543）——条件到即删（随 #1558）

- 所有者：router client build（`open:minify-island-css` post transform，
  接缝登记 [seams.md](../architecture/seams.md) "Island CSS shipped bytes
  (#1543)" 行，守卫 `island-css.test.ts` / `island-css-pipeline.test.ts`）。
- 方向：client-build transform → 交付的 island chunk 字节。
- 存在原因：`build.minify: 'oxc'` 是 JS 压缩器，永不触及模板字面量内容，
  而当时每份组件样式表都活在其中。
- 退役条件（已写在
  `packages/router/src/vite/internal/island-css.ts:240-246`）：遗留逐字
  通道清空之时——#1558 把唯一创作形态改为文件式样式（css 标签模板
  退役）后，所有岛模块都走 #1553 抽取路径，本变换随之整段删除。
- 处置：条件到即删。#1558 已排期；本车道不提前动手。

### 2. `styleAssetProtocol` 激活开关（#1553）——条件到即删（随 #1558）

- 所有者：element 编译器（`compiledElementPlugin` / semantic core 选项）。
- 方向：宿主构建配置 → 编译器抽取行为。
- 存在原因：#1553 交付期以显式开关控制抽取路径的激活面。
- 退役条件（[ADR-0164](../adr/ADR-0164-island-style-asset-protocol.md)
  2026-10-07 修正案——一次具名偏离）：router build 是唯一宿主且已硬编码
  激活，选项文本上今天就可删；为避免连续两个 release 两次破坏公共编译器
  表面，随 #1558 删除准入机制时一并退役。
- 处置：条件到即删。

### 3. CSS 双适配器之 fetch 回退形态——条件到即删；单一化子裁决待 owner

- 所有者：router client build（`style-assets.ts`，接缝
  "CSS import compatibility (#1553)" 行）。
- 方向：拦截 `.oe-style.css` 请求 → 交还模块图的 sheet adapter 模块。
- 存在原因：原生 CSS Module Script（`import … with { type: 'css' }`）
  双重不可用——rolldown 1.0.3 对原生形态 MISSING_EXPORT 硬失败，
  Safari 截至 27 未实现（[ADR-0164](../adr/ADR-0164-island-style-asset-protocol.md)
  附录 C）。能力判定是构建期事实：`NATIVE_CSS_MODULE_SCRIPTS = false`
  （`style-assets.ts:77`），现实构建全部产出 fetch 形态（TLA 守卫，
  fail-closed）。
- 退役条件（已写在 `style-assets.ts:42-44`）：当某个工具链既能打包原生
  形态、又能覆盖交付舰队（即 Safari 落地 CSS Module Script）时，翻转
  判定，删除 fetch 生成器 `fetchSheetAdapterModule`。
- 开放子裁决（issue #1559 记录，owner 默认倾向"机制更少"）：(a) 维持
  双形态 + 上述条件（代码现状）；(b) 单一适配器策略——始终 URL +
  fetch + replace，立即删除惰性的 `nativeSheetAdapterModule` 生成器与
  判定常量（约两行状态的删除，原生形态今天本就零次产出）。任一裁决都
  收敛到单一机制；本登记簿按代码现状记录 (a) 的条件，(b) 一经批准即
  变成"现在删"。
- 处置：条件到即删（(a)）；(b) 批准则立即删原生形态一侧。

### 4. dev/SSR 内联 sheet 适配器——条件到即删

- 所有者：router（`inlineSheetAdapterModule` / `serverStyleAssetPlugin`，
  同在 `style-assets.ts`）。
- 方向：dev server / SSR build → 模块图内联的 sheet 文本。
- 存在原因：dev 与 SSR 没有可供 fetch 的已产出资产；内联是这两个通道的
  过渡形态。
- 退役条件（已写在 `style-assets.ts:181-184`）：#3 的原生判定翻转，或
  dev 学会用 HTTP 服务协议资产——届时 dev 通道塌缩进生产适配器形态，
  本生成器随同一判定删除。
- 处置：条件到即删（与 #3 同一批执行）。

### 5. `ShimStyleSheet`（SSR 侧 CSSStyleSheet）——保留为平台边缘

- 所有者：element core（`packages/element/src/internal/core/style-sheet.ts:54-70`）。
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
- 各条目自带删除条件，条件未到（2026-10 现状）：
  - #579 DSD 只由 HTML parser 实例化，DOMParser 树保持惰性
    `instantiateDsd()` 先于插入手动实例化 → "所有引擎对 DOMParser 树
    实例化 DSD"即删；
  - #604 WebKit 对 parser-inert 文档迁入 shadow root 的元素永久跳过
    升级，`repairShadowUpgrades()` 重插补票 → "WebKit 在 adoption 时
    升级此类元素"即删；
  - #610 submit 事件并非每个引擎都 composed，文档级监听看不见 DSD 内
    表单，`attachSubmit()` 逐 shadow root 挂接 → "submit 全引擎
    composed（或表单不再住 shadow root）"即删。
- 处置：保留为平台边缘。台账纪律已内建：条件到即删对应条目及其
  workaround，无需另行评审。

### 8. `@lit-labs/ssr` 全局 DOM shim——保留为平台边缘

- 所有者：router lit 渲染器（`lit-ssr.ts:26` 副作用首导入，`:9-11`
  Server-only 契约；`renderer-adapter.ts:87`、`plugin-virtual-modules.ts:39-43`、
  `build-ssg.ts:68` 装配同一事实）。
- 方向：服务端全局 DOM shim → Lit SSR 渲染通道。
- 存在原因：`@lit-labs/ssr` 需要 DOM 全局（`installWindowOnGlobal` 只补
  缺失项）；这是上游依赖的形状，不是我们自建的层。
- 退役条件：上游提供免 DOM 的 SSR 路径，或 Lit 渲染器模式移除——后者
  是 ADR 级决定（[ADR-0152](../adr/ADR-0152-product-router-and-alpha-convergence.md)
  2026-09-16 修正案："Lit renderer mode is doctrine, not debt"，其存在
  与移除都是 ADR 级）。
- 处置：保留为平台边缘。

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
  （[node-porting-residuals.md](./node-porting-residuals.md) §5）。
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

### 12. `Deno.Command` 形状仿真——条件到即删

- 所有者：repo 工具（`tools/repo/node-command.ts`；21 个消费文件、33
  个调用点，横跨 `tools/repo` 与 `tools/release`）。
- 方向：node:child_process 之上仿真 `Deno.Command` 的结果形状
  （`{success, code, signal, stdout, stderr}`、信号杀进程报
  `128 + 信号号`、env 合并非替换、spawn 失败 reject）。
- 存在原因：B1b 机械移植时保持调用点逐字不动。这是全仓唯一存活的
  deno→node 兼容层
  （[node-porting-residuals.md](./node-porting-residuals.md) §7"the
  single seam"；§1–§6、§8–§9 均已 RESOLVED；create 预设/模板侧的
  deno→node 残余已随 owner ruling 2026-10-03 清零，
  `packages/create/src/install-command.ts:47-49`）。
- 退役条件：宿主已退（Deno），形状保持的理由随之失效——一次机械清扫
  把调用点改成 node 原生语义（或反过来：正式承认这些形状为本仓规范
  spawn 助手，重写该文件头删除 Deno 叙事——二选一，不许维持"仿真"
  名分）。附带债务：§7 记录的 abort 路径仅在 Deno 主机下验证过，重塑
  时须在 Node 重新验证。
- 处置：条件到即删（工具车道的一次机械重塑；本车道不执行）。

### 13. TypeScript `ParserPort` 后端——保留为平台边缘

- 所有者：element 编译器（`parse-module.ts`，语义核唯一解析缝，#1473）。
- 方向：TS JS 解析 API → 语义核 AST。
- 存在原因：oxc 尚未稳定支持标准装饰器；tsgo 原生 API 尚未成为受支持
  解析入口。
- 退役条件（已写在 `parse-module.ts:11-19`，双触发器取先到）：TS 6 线
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
  `packages/router/package.json:33`；供给链已有 provenance 闸
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

### 17. 渲染器适配缝（native / lit）——保留为平台边缘（教义，非债）

- 所有者：router SSG（`renderer-adapter.ts`——生成入口对两套页面渲染
  运行时的唯一分叉点；`lit.ts` / `lit-ssr.ts` 为 lit 侧入口）。
- 方向：entry codegen → 渲染器运行时绑定（两模式共享应用语义，分叉
  仅在此缝）。
- 退役条件：Lit 模式移除 = ADR 级决定（同 #8）；native 侧没有可退的
  垫片——它是主产物。
- 处置：保留为平台边缘。

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
- `packages/element/src/internal/compiled/runtime/test-engine.ts`：
  测试替身，不交付。
- `html-escape.ts:183`、`security.ts:15` 等处注释里的"retired"：已偿
  债务的墓碑记录，指认的是删掉的东西。
- `tests/fixtures/url-pattern-list-audit`：供给链证明 fixture（#15 的
  守卫），非运行时代码。

## 复审机制

本登记簿由"平台追账评审"（[design-principles](../architecture/design-principles.zh.md)
末节）按 release 周期驱动：每周期逐行重估"条件到即删"的到期情况与
"平台边缘"的追账进度，新 shim 入场时必须同时入表并写死条件。与
[seams.md](../architecture/seams.md) 的分工：接缝表管"谁写谁读、守卫
在哪"，本表管"为何存在、何时能删"；同一工件两边都该有一行，交叉引用
即可，不重复维护事实。
