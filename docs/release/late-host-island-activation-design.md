# Late-host island activation — design and decision record

- 状态：**G1 已批准（2026-10-18）**。实现落在 `packages/router/src/vite/internal/ssg/island-scheduler.ts`。
- 任务：T8（alpha15 收尾批）· lane `lane/t8-design`。
- 设计基线：`f395b1e1fc06a727a3e27f26a5aad62ea2929ab8`；落地基线：`ed50abeaa`（含 t3-release 的 third-party harness 修复）。
- 上游决策（G0，已批准）：**D2=A 泛用** / D3=B / D4=A / D5=A；HERO 不门控（本文不涉及）。
- 本文的机制结论来自只读代码探查 + 既有单测实跑（见附录 A 证据索引）。

## 批准记录（G1，2026-10-18）

Owner 批准 4/4，均按本文 §11 的推荐取值；第 5 条（引擎口径）随后亦获裁决（接受推荐的收敛口径）。

| # | 决策点 | 结论 |
| --- | --- | --- |
| 1 | 探测预算 | **6 次/窗口、3000 ms/窗口、3 窗口、绝对 9000 ms**（⇒ 绝对扫描次数上限 18） |
| 2 | 新公开诊断事件 `open:island-host-timeout` | **接受**（informational，每页 ≤1 次，无监听者成本 ≈ 0） |
| 3 | 多库 fixture 是否含 A3（真 Stencil 自撰 host） | **包含**（`@stencil/core@4.43.5`，磁盘/网络 +0） |
| 4 | 改动面 | **收敛为单文件** `island-scheduler.ts`；不碰 `entry-client-codegen.ts`、不碰 protocol、不碰构建期 |
| 5 | 三引擎 third-party WC smoke 的收敛口径 | **接受推荐口径**：契约级断言（注册 / 升级 / late-host 激活 / exactly-once / unused tag 0 fetch）**三引擎全绿**；其余能力探针按引擎记录，差异表达为 `null`，不算失败。实现形态 = **build 一次、三个 session**，每引擎结果并入 record/tierReport |

批准附带的实现约束（已并入 §10 验收清单）：

- `grep -i lit` 在新增生产代码中必须 **= 0**。
- 新增 src 必须自带 **branch tests**（仓库 coverage 余量仅 +0.21pp）。
- **KR-17 摘钩**必须贴三引擎结论摘要作为证据（只写「本地通过」不合格）。
- 三引擎 e2e 是最重的一腿，执行前与 lead 协调机器资源（另有 lane 在跑 gate）。
- **三引擎首跑若出现 firefox 红，不得用重试掩盖**（KR-18：owner 已定 `retries=0`，禁止恢复 retries/skip）：按台账格式记录现象 + 证据路径，标 `flaky`/`open`，如实上报，由 lead 决定是否允许记账后的 rerun。

### 三引擎是门禁默认值（裁决 + 代价，已记）

- **默认引擎集 = `chromium,firefox,webkit`**：`qualify.ts` 的 `CONTRACT_ENGINES` 即门禁默认。理由是 D5 的台账纪律 —— 若默认 chromium、由调用方设 env，则 KR-17 的退役证据依赖「调用方设对」，门禁本身不成立。
- **`OPEN_ELEMENT_WC_ENGINES` 只是本地迭代的收窄手段**：用完必须复跑默认集；**不得**作为 CI / release 的常规配置。
- **已接受的代价**：`@openelement/fixture-third-party-web-components#smoke` 的浏览器段约为原来的 **3 倍**，而该 target 挂在 `@openelement/tools-release#gate:packed` → `release:check`（以及 CI 的 `published-consumers` workflow）。**`release:check` 会因此变慢**，这是 owner 在 G1-5 明确知悉并接受的取舍（契约证据优先于门禁时长）。
- 结构上只 build 一次（`prepareFixtureApp`），三引擎各开一个 session，所以 ×3 只落在浏览器段，不落在外层 `pnpm install` / router build / `stencil build` 上。
- 三引擎首跑结果（chromium 147.0.7727.15 / firefox 148.0.2 / webkit 26.4）：**契约级断言三引擎全绿、零失败、零引擎差异**，因此**没有**触发「非契约探针按引擎记 `null`」的分类裁决。实测 `elapsedMs` 5638 / 5987 / 5675，`attempts` 均为 6（预算在三个引擎上都成立）。

## 实现偏离（已批准意图内）

实现 `672847cb7` 时，**冻结既有 28 例零修改**这一硬约束（§4.5 I-4）逼出了三处对 §3.1 伪代码字面的收敛。三条都不改 B2 / F01 的语义，也都由既有钉法直接证明其必要性，经 lead 判定**在 G1 批准意图内**（不需重开决策门）。D-4 是 seam 登记后的记录订正，不涉及实现行为。四条在此集中登记，便于 owner 复审一处可见。

| # | 偏离 | 为什么必须 | 既有钉法（证明其必要性） |
| --- | --- | --- | --- |
| D-1 | **`idle` 尝试 outstanding 时不参与探测**：`pendingTags()` 在 `idlePending === true` 时跳过 idle tag；该尝试**结束后**若仍有未消费的 idle factory，则由 deferred 步骤 arm 同一探测（2026-10-19 补记，FR-02 收口；原「idle 永不探测」的范围表述作废） | idle bucket 自带 deferred step。探测在构造末尾 arm，此刻 idle 尝试**必然**还 outstanding；再为它排一个 timer 就是给同一个 tag 排两次 deferred step。等尝试结束再 arm，既不重复排 idle step，又补上了「尝试已花掉、宿主才出现」的缺口 | `#605 idle fallback defers through setTimeout with the injected policy timeout`（断言 `scheduled.length === 1`）、`#F01 idle: the re-armed attempt keeps the fallback selection`（断言重扫后恰好 2 个 timer 且 `[1][1] === 25`）、`FR-02 idle-only: a host that appears after the idle attempt activates` |
| D-2 | **探测搭 ready 门，不抢跑**：`readyState === 'loading'` 且存在 `visible` island 时，构造末尾不 arm，改由 `onReady(rescanAndArm)` 在那次扫描结束时 arm | `onReady(observeVisible)` 在等 DOMContentLoaded；若探测直接调 `observeVisible()`，就会在文档 ready 前挂上 observer，破坏 ready 扫描承诺的延后语义 | `the ready-time visible scan waits for DOMContentLoaded on a loading document`（断言 `observed === []` 且 `listeners.length === 1`） |
| D-3 | **`visible` 命中即 settle**：命中记入 `probeSettled`，`pendingTags()` 跳过已 settle 的 tag | `visible` island 的 host 存在但未进入视口是**健康态**，不是缺 host。不 settle 则探测每轮重复命中、耗尽预算，并对完全正常的 tag 报 `open:island-host-timeout`（假诊断） | `#1039 detached visible island is released and a reinsert gets a fresh observer`（证明 visible 的 host-present 状态由 observer 链路拥有，与"缺 host"无关） |
| D-4 | **seam 判定与 §10.5 措辞订正**：实现同时把 `open:island-host-timeout` 登记进 `docs/architecture/seams.md`（P8），因此 §10.5 原句「本改动不新增跨系统 seam」不再成立，改为「新增一个 client runtime → page 的公开诊断面，已登记」 | 该事件是面向页面的公开诊断面，按 ADR-0163 / P8 必须登记 owner 与 consumer-form guard；scheduler 仍是唯一 owner，未新增构建期产物或跨阶段交接 | `docs/architecture/seams.md` 的「Late-host activation give-up announcement」行 + `tests/fixtures/third-party-web-components/qualify.ts` 的 listener / zero-fetch guard；ADR-0170 记录该判定 |

`observeVisible()` 的函数体逐字未改（F01 语义冻结）；新增的只是 `rescanAndArm = observeVisible(); armProbe()` 这层**幂等**包装（`armProbe()` 在已 arm / 已注销 / 无 pending tag 时立即返回）。另在实现中移除了两处死分支以保覆盖：`endWindow` 内永远为假的 `probePending` 清 timer 块（真正需要清的是 `onIslandLoadActivity` 内那次，由 T-8 覆盖），以及 `giveUp` 载荷改用重算的 `pendingTags()`（避免点名已 settle 的 tag）。

## 0. 决策摘要

**问题**：第三方 WC（Lit）组件在**自己的 open shadow root 内后创建** `<wc-open-child>`；B2 的 host-gated load 在 ready 扫描时找不到 host，factory 留在 map 里；而**该页面上根本不存在任何 rescan 触发路径**（enhance 层不存在、`visible` bucket 为空）→ island 永不注册 → smoke `missing=wc-open-child`。这是**泛用互操作缺陷**：任何「第三方组件在自身 shadow root 内创建 openElement island host」的应用都坏，与 Lit 无关。

**主选机制（P-A）**：scheduler 自己持有的**有界 late-host 探测**（bounded late-host probe）。
它在 ready 扫描结束后，若仍有「已声明但 factory 未被消费」的 tag，就按固定预算做 ≤6 次**融合式 composed-tree 扫描**；命中即调用**既有的** `observeVisible()`（F01 的唯一下游），不新增激活路径。预算耗尽即停止，并派发一次 `open:island-host-timeout` 诊断事件。
**零新增依赖、零新增导出、零 protocol 改动、唯一生产文件**。

**硬预算（主选）**：≤6 次扫描，≤3000 ms 窗口，1 次「活动续期」（可再续 2 个窗口）⇒ 绝对上限 **18 次扫描 / 9000 ms**；观察目标数 **0**（不使用 MutationObserver）；单次扫描复杂度 **O(V)**（V = composed tree 元素数），一次遍历覆盖全部 pending tag。

**需要在 G1 拍板的 4 个取舍点**见 §11（已全部批准，第 5 条随后亦获裁决）。

---

## 1. 问题陈述

### 1.1 复现路径（步骤化，全部有代码依据）

fixture 形状（`tests/fixtures/third-party-web-components/`）：

- `app/islands/wc-open-child.tsx`：`defineIslandConfig({ hydrate: 'load', ssr: false, dsd: false })`，`@element('wc-open-child', { root: 'shadow-open' })`。
- `app/islands/wc-fixture.tsx`：`hydrate:'load', ssr:true, dsd:true`；`onDsdHydrated()` → `activateForeignWidgets()` → `void import('../client/wc-client.ts')`。
- `app/client/wc-client.ts`：`class WcLitHost extends LitElement { render() { return html\`<wc-open-child></wc-open-child>\` } }`，并在同文件 `customElements.define('wc-lit-host', WcLitHost)`。
- `app/components/page-third-party-wc.tsx`：显式 `import '../islands/wc-open-child.tsx'`（仅为 delivery graph 可达性）。
- 页面 `/third-party-wc/`：`renderIntent: { mode: 'static' }`，**无 `data-open-enhance` 表单**。
- 构建期 `island: { upgradeStrategy: 'load' }`（`qualify.ts:590-594`）。

时序（t=0 为 generated client entry 求值）：

| t | 事件 | 关键代码 |
|---|---|---|
| t0 | client entry 求值，`createIslandScheduler()` 同步跑 ready 扫描 | `island-scheduler.ts:165-170` |
| t0 | `load('wc-fixture')`：host 在 SSR DSD 里 → import 开始 | `island-scheduler.ts:121-139` |
| t0 | `load('wc-open-child')`：`hasIslandHost(doc,'wc-open-child') === false` → **return false，factory 留在 map** | `island-scheduler.ts:124` |
| t0 | `visibleTags.length === 0`（无 island 声明 `visible`）→ **`onReady(observeVisible)` 不注册** | `island-scheduler.ts:340` |
| t1 | `wc-fixture` chunk 到 → 升级 → `onDsdHydrated` → `void import('../client/wc-client.ts')`（**独立 chunk，异步**） | `wc-fixture.tsx:31,45` |
| t2 | `wc-client.ts` 求值 → `customElements.define('wc-lit-host', …)` | `wc-client.ts:111` |
| t3 | `<wc-lit-host>` 升级 → Lit 微任务调度 update → `render()` 在**自己的 open shadow root** 内创建 `<wc-open-child>` | `wc-client.ts:64-70` |
| t4 | `<wc-open-child>` 是未知元素（定义不存在）→ 保持未升级，且**没有任何东西会再来找它** | — |
| t5 | smoke `page.waitForFunction(tags.every(t => customElements.get(t)), { timeout: 10_000 })` 超时 | `qualify.ts:271-286` |
| t6 | 报错 `custom-element registration failed; missing=wc-open-child; browserErrors=` | `qualify.ts:281-285` |

### 1.2 为什么现有四条路径一条都救不了

| 路径 | 为何无效 | 证据 |
|---|---|---|
| **B2 host-gated load 自身** | ready 扫描是一次性的；`hasIslandHost` 在 t0 必然为 false | `island-scheduler.ts:124`；`__tests__/island-scheduler.test.ts:425-457` |
| **F01 post-morph rescan (`observeVisible`)** | 只在 morph 后被调用；本页无 `data-open-enhance` ⇒ **enhance 层根本不生成** | `form-enhance.ts:305`（`observeVisible()` 紧跟 `morphDocument` 之后）；`entry-client-codegen.ts:668-707`；`build-client.ts:426` |
| **`onReady(observeVisible)`** | 仅当 `visibleTags.length > 0` 才注册；本页 `load` + `only` bucket 之外为空 | `island-scheduler.ts:340` |
| **`onIslandLoaded` 后的 rescan** | `enhancedForms === false` 时该 dep 被生成为 **`null`** | `entry-client-codegen.ts:675` |

**结论（比审计 P1 更精确）**：不是「rescan 漏了这次机会」，而是**这个页面形状上不存在任何 rescan 代码路径**。这与外部审计已核实的结论一致（`.zcode/plans/alpha15-external-audit-verification-2026-10-18.md:75`：`missing=wc-open-child` 在 `53fc1d4fb` + 已发布 alpha.14 上同样失败）。

**另一个时序事实**：即使 `observeVisible()` 在该页被调用（例如页面有 enhance 表单），它也只会在 morph 之后跑一次；而此处 morph 发生在 t1 之前，`wc-client.ts` chunk 在 t2/t3 才落地 —— **仍然错过**。所以机制必须是「时间/活动驱动」，不能只是「morph 驱动」。

**现状（已核实，t3-release handoff）**：前序 harness 陷阱（scaffold 未带 `--no-install` ⇒ `ERR_PNPM_NO_MATCHING_VERSION`）**已由 t3-release 修复并落地**（`6d52fa580`；`qualify.ts:583-589`）。修复后的 smoke 顺序是 `create --no-install` → `pnpm install --no-frozen-lockfile` → `pnpm run build`（**全绿**）→ 浏览器阶段**恰好在 `missing=wc-open-child` 失败，且 `browserErrors` 为空**。这正面确认了本节的根因判断：失败**不是** chunk/模块加载错误，而是**注册门控**本身。残余即 committed ledger 的 **KR-17**（the internal working ledger (not published)），其退休条件是「T8 的三引擎、多库用例全绿」——**该条件已并入 §10 验收清单**。

### 1.3 为什么这是泛用互操作缺陷，不是 Lit 问题

- 触发条件是**纯 DOM 事实**：一个 island host 在本页 ready 扫描之后才出现在 composed tree 里。
- 产生该事实的主体可以是任何东西：第三方组件（Lit / FAST / Stencil / Shoelace / Material / Ionic）、vanilla `attachShadow`、应用自己的 `setTimeout`/`fetch` 回调、另一个 island 的渲染副作用。
- Lit 只是**本仓库恰好用它做 fixture**；把 Lit 换成 FAST/Stencil/vanilla 复现完全相同（§9 A1–A4 逐库证明）。
- 反过来，Lit 应用若所有 host 都在 SSR 标记里，则完全不受影响 —— 说明缺陷的维度是「host 出现时机」，不是「框架」。
- 产品承诺面：`docs/integrations/using-third-party-web-components.md:116-117` 明确承诺「openElement can contain a Lit element, and a Lit element can contain an openElement custom element」。**当前该承诺在双向用例上实际不成立**（`qualify.ts:313,351-362` 正是这条断言）。这是对外文档承诺与实现的直接矛盾，属发布级互操作缺口。

---

## 2. 通用契约

### 2.1 支持（新增承诺）

| 形态 | 支持 | 说明 |
|---|---|---|
| 任意深度 **open** shadow root 内后创建的 host | ✅ | 遍历对每个元素的 `shadowRoot`（非 null 即 open）递归，深度无上限 |
| **light-DOM 后插入** 的 host（`appendChild`/morph/框架 patch） | ✅ | 同一遍历的首层 `querySelectorAll` 覆盖 |
| host 由**另一个 island 的渲染副作用**创建 | ✅ | 与来源无关 |
| host 出现在**已被扫描过的**容器内（容器先存在、内容后到） | ✅ | 探测按时间重跑整棵 composed tree |
| `closed` 之外不可见构造（`<iframe>` 文档、未 attach 的 DocumentFragment） | ❌（见 §6） | 前者是另一个 document；后者不在 composed tree（**不激活才是正确行为**） |
| **closed** shadow root 内的 host | ❌ **明确不支持** | 见 2.2 |

### 2.2 closed shadow root：为什么检测不到，以及降级行为

- 平台事实：`element.attachShadow({ mode: 'closed' })` 之后，`element.shadowRoot === null`，且**没有任何标准 API 能枚举或穿透 closed root**（`Element.shadowRoot` 是唯一入口；`getComposedRanges`/`elementsFromPoint` 不给出 root 引用）。
- 因此**不是**「暂未实现」，而是**平台不可观测**。
- 本设计**拒绝** monkey-patch `Element.prototype.attachShadow`（理由见 §5.2）—— 那会让 runtime 变成一个全局平台补丁器，代价与风险远大于收益。
- **降级行为（必须被测试钉住）**：探测在 closed root 处静默止步 →
  1. 不抛异常、不产生 page error、不影响同页任何其它 island（包括同页 open root 内的 late host）；
  2. `map[tag]` 保持非 null ⇒ **不消费工厂、不 fetch 该 chunk**（对未使用 island 的承诺不破）；
  3. 窗口结束时 `open:island-host-timeout` 的 `detail.pending` **会点名该 tag**（可诊断信号，§6）；
  4. 之后任何一次 `observeVisible()`（F01 morph 路径）仍然有效：一旦该 host 迁移到可观测 root，仍会被激活。

---

## 3. 观察 / 重试机制

### 3.1 主选方案 P-A：bounded late-host probe（scheduler 自有）

**位置**：全部逻辑内联在 `createIslandScheduler()` 内部（§4.5 不变量 I-6）。
**时钟**：只用 `deps.win.setTimeout`（模块已用；不引入 rAF / `requestIdleCallback`：前者在隐藏标签页暂停，后者在高负载下可能错过窗口，且本机制的正确性不依赖帧对齐）。
**不改** `load()`、不改 `observeVisible()` 的语义；探测只是**多调用几次 `observeVisible()`**。

伪代码（实现 lane 可直接照抄结构）：

```ts
// ── 全部在 createIslandScheduler() 内部，模块保持 import-free ──────────
const LATE_HOST_MAX_ATTEMPTS = 6;                          // 单窗口扫描次数上限
const LATE_HOST_DELAYS_MS = [0, 25, 100, 250, 750, 1500];  // 第 n 次扫描的排程延迟
const LATE_HOST_WINDOW_MS = 3000;                          // 单窗口墙钟上限
const LATE_HOST_MAX_WINDOWS = 3;                           // 窗口数上限（含首次）
const LATE_HOST_MAX_TOTAL_MS = 9000;                       // 绝对墙钟上限

let probeWindow = 0;         // 已用窗口数（含首次）
let probeAttempt = 0;        // 当前窗口内已用扫描次数
let probeStartTs = 0;        // 当前窗口起始时刻（单窗口墙钟判定）
let probeStartedAt = 0;      // 首个窗口起始时刻（绝对上限基准，只写一次）
let probePending = false;    // 同一时刻至多一个待执行 timer
let probeTimer = 0;          // 当前 timer 句柄（续期时取消）
let probeAwaiting = false;   // true = 已进入「续期待命」，等一次 island load 活动
let probeDone = false;       // 注销后永不再排程

/** pending = 所有 bucket 中 factory 仍在 map 里的 tag。
 *  media 中 query 不匹配的 tag 不算 pending（那是能力门控，不是缺 host）。 */
function pendingTags(): string[];

/** 一次融合式 composed-tree 遍历：返回 tags 中当前有 host 的子集。
 *  每个 root 只做两次原生查询：tag 选择器列表（一次解答全部 tag）+ '*'（复用做 shadow 下行）。
 *  命中全部 tag 后可提前返回。O(V)。 */
function collectHosts(root: ParentNode, tags: readonly string[]): string[];

function scheduleProbe(delayMs: number): void {
  if (probePending || probeDone) return;                       // 只留一个 timer
  probePending = true;
  probeTimer = win.setTimeout(function () { probePending = false; probe(Date.now()); }, delayMs);
}

function probe(now: number): void {
  if (probeDone) return;
  // 续期待命超时（没有活动到达）→ 放弃并给出诊断，绝不无限等待。
  if (probeAwaiting) { const p = pendingTags(); probeDone = true; if (p.length > 0) giveUp(p, now); return; }
  const pending = pendingTags();
  if (pending.length === 0) { probeDone = true; return; }       // 全部激活 → 提前注销
  if (collectHosts(doc, pending).length > 0) observeVisible();  // 命中 → 走既有 F01 路径
  probeAttempt++;
  if (probeAttempt >= LATE_HOST_MAX_ATTEMPTS || now - probeStartTs >= LATE_HOST_WINDOW_MS) {
    endWindow(pending, now);
    return;
  }
  scheduleProbe(LATE_HOST_DELAYS_MS[probeAttempt]);
}

/** 当前窗口结束：能续期就进入有界待命，否则放弃。 */
function endWindow(pending: readonly string[], now: number): void {
  if (probeWindow >= LATE_HOST_MAX_WINDOWS || now - probeStartedAt >= LATE_HOST_MAX_TOTAL_MS) {
    giveUp(pending, now);
    return;
  }
  probeAwaiting = true;
  // 待命本身也有界：没有活动到达时，这个 timer 会唤醒 probe() 并放弃 ——
  // 「诊断事件必然可达」是硬要求，不能依赖活动一定会来。
  scheduleProbe(Math.min(LATE_HOST_WINDOW_MS, probeStartedAt + LATE_HOST_MAX_TOTAL_MS - now));
}

/** load() 的 .then() 成功分支里调用（新增一行）。 */
function onIslandLoadActivity(): void {
  if (probeDone || !probeAwaiting) return;                      // 未在待命 → 无副作用
  probeAwaiting = false;
  probeWindow++;
  probeAttempt = 0;
  probeStartTs = Date.now();
  if (probePending) { win.clearTimeout(probeTimer); probePending = false; }  // 取消待命 timer
  scheduleProbe(0);                                             // 新窗口从第 1 次扫描开始
}

/** 预算耗尽：disarm + 一次性可诊断信号。不消费工厂、不抛错。 */
function giveUp(pending: readonly string[], now: number): void {
  probeDone = true;
  probeAwaiting = false;
  doc.dispatchEvent(new win.CustomEvent('open:island-host-timeout', {
    detail: { pending: pending, attempts: probeAttempt, elapsedMs: now - probeStartedAt },
  }));
}

// 工厂末尾（ready 扫描 + 媒体/idle 初始化之后）：
if (pendingTags().length > 0) {
  probeStartedAt = probeStartTs = Date.now();
  probeWindow = 1;
  scheduleProbe(0);
}
```

**活动续期（本方案唯一的自适应部分）**：`load()` 现有 `.then()` 里已经有成功分支（`island-scheduler.ts:126-135`）；在那里加一行 `onIslandLoadActivity()`。语义是：

> 「只要仍有 island 模块在陆续到达，就说明本页的客户端资源流还没结束，late host 仍可能出现 → 再给一个窗口。」

这样**慢 chunk**（本 fixture 的 `wc-client.ts` 打包了 Lit+Shoelace+Material+FAST+Ionic，几百 KB）不会因为固定 3 s 窗口而在慢网下失效；同时没有任何无条件的长窗口。

**为什么这是安全的**：续期只延长「多久之后放弃」，不改变「谁能被激活」（永远是 `load()` 的 host gate 决定）。`probeDone` + `map[tag] === null` 两道闸保证 exactly-once。

### 3.2 硬预算表（主选 P-A，实现必须以此为准）

| 预算项 | 常量 | 值 | 依据 |
|---|---|---|---|
| 单窗口最大扫描次数 | `LATE_HOST_MAX_ATTEMPTS` | **6** | 排程点 0 / 25 / 125 / 375 / 1125 / 2625 ms |
| 单窗口墙钟上限 | `LATE_HOST_WINDOW_MS` | **3000 ms** | 覆盖 3G 级 code-split chunk 到达；单次扫描与既有 ready 扫描同阶 |
| 窗口数上限（含首次） | `LATE_HOST_MAX_WINDOWS` | **3** | 只有 island 模块仍在 resolve 时才续期 |
| 绝对墙钟上限 | `LATE_HOST_MAX_TOTAL_MS` | **9000 ms** | 硬闸：任何路径都不得在 9 s 后还持有 timer |
| 绝对扫描次数上限 | 派生 | **18** | `6 × 3` |
| 观察目标数（Observer） | — | **0** | P-A 不使用 MutationObserver |
| 单次扫描复杂度 | — | **O(V + E)**，一次遍历覆盖全部 pending tag | V = composed tree 元素数 |
| 单次扫描原生查询数 | — | **≤ 2 × (1 + open shadow root 数)** | 每个 root：1 次 tag 选择器列表 + 1 次 `'*'` |
| 探测持有的 timer 数 | — | **≤ 1** | `probePending` 守卫（与 `idlePending` 同模式） |
| 续期待命的等待上界 | — | **≤ min(3000 ms, 剩余绝对预算)** | 待命也排程；无活动到达时唤醒即放弃 ⇒ 诊断事件必然可达 |
| 探测期内的 fetch 数（无 host 页） | — | **0** | 探测不直接调 factory |
| 诊断事件数 | — | **≤ 1 / 页面** | `probeDone` 后不再派发 |
| 卸载/注销 | — | 窗口结束或 `pending.length === 0` 即 `probeDone = true`，不保留任何引用 | — |

### 3.3 备选方案 P-B：探测 + 有界 MutationObserver 混合

- 首次探测时记录发现的 **open shadow root**（含 document），对其中前 `LATE_HOST_MAX_ROOTS = 32` 个挂 `{ childList: true, subtree: true }` observer；每个 observer 回调合并为**一次微任务去重**的 rescan；总记录数或总时间达上限即全部 `disconnect()`。
- 优点：反应延迟更低（无需等下一次排程），稳态扫描次数可降到 1。
- 缺点（为何不作主选）：
  1. **不能替代探测**：`attachShadow()` 不产生任何 mutation record，全新 shadow root 只能靠扫描发现 —— P-B 是 P-A 的超集，不是替代。
  2. 生命周期面更大：每个 root 一个 observer、需要 disconnect、需要防泄漏（参考 `form-enhance.ts:145-162` 的 `scanSubmitRoots` prune 逻辑，说明这类簿记在本仓库确实会出错）。
  3. 本仓库客户端 runtime 目前**没有任何 MutationObserver**（全仓仅 `open-element-theme.ts` 与 server 端 `stream-runtime.ts`），引入会成为新的全局观察先例。
  4. `win.MutationObserver` 需要注入或从 `win` 取，DOM-free 单测需要新增 double。
- 结论：**记录为升级路径**。若 P2 实测显示 P-A 最坏成本不可接受（大 DOM × 多 pending tag），再上 P-B。

### 3.4 备选方案 P-C：把探测收窄到 `ssr:false` 的 island

- 依据：`ssr:false` 意味着服务端不序列化该组件 ⇒ 其 host 只能由客户端代码创建 ⇒ 天然是 late host。本 fixture 的 `wc-open-child` 正是 `ssr:false`。
- 优点：pending 集合极小，成本 ≈ 0。
- 拒绝理由：**违反 D2=A「泛用」**。它救不了 `ssr:true` island 的 light-DOM 后插入（§2.1 明确承诺支持），也救不了「SSR 声明了 host 但第三方组件把它挪走/重建」的情形。记录为「若 owner 事后要收缩运行时面，这是最小回退」。

### 3.5 对比与推荐

| | P-A（主选） | P-B | P-C |
|---|---|---|---|
| 覆盖 open shadow root late host | ✅ | ✅ | ✅ |
| 覆盖 light-DOM 后插入 | ✅ | ✅ | ❌ |
| 覆盖 `ssr:true` island | ✅ | ✅ | ❌ |
| 观察目标数 | 0 | ≤32 | 0 |
| 最坏扫描次数 | 18 / 9 s | 1 + ≤16 回调 rescan | 18 / 9 s |
| 新增代码面 | 1 文件 / ~60 行 | 1 文件 / ~110 行 + 单测 double | 1 文件 / ~55 行 + 构建期元数据 |
| 新依赖 / 新导出 / protocol 改动 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0（但需改 codegen 传 `ssr` 标记） |

**推荐 P-A。**

---

## 4. 与既有机制的关系

### 4.1 B2（不预加载未使用的 island）—— 不破，且不变

- `load()` 的 `hasIslandHost` 门**保持唯一激活权威**（`island-scheduler.ts:124`）。探测**从不直接调用 factory**，只在命中后调用 `observeVisible()`，由后者走 `load()`。
- 因此「本页无 host ⇒ 不 fetch」是**构造性成立**的，不依赖探测的准确性：即使探测误判命中，`load()` 仍会再检查一次。
- 语义澄清（建议写进 docs）：B2 的承诺是**可达性**（an island a page never reaches is never fetched），不是**求值时机**。本设计把「可达性」的求值窗口从「ready 一次」扩展到「ready + 有界 late 窗口」，是对 B2 的**泛化**而非削弱。
- `open:ready` 形状不变：仍是「每个在这里启动 load 的 bucket 各发一次，`detail.islands` 是本页实际激活的子集」（`island-scheduler.ts:154-162`；偏离声明在 `__tests__/island-scheduler.test.ts:110-177` 被钉住）。探测可能让**同一个 bucket 多出一条事件**（新激活的 tag），这与 F01 morph 后的行为完全一致，需要一条新单测钉住「每次激活一条，不是每次扫描一条」。

### 4.2 F01（morph rescan）—— 不破，不改

- 探测的下游就是 `observeVisible()` 本身：`loadAll(load)` → `loadAll(only)` → `rescanIdle()` → `rescanMedia()` → visible observers 重挂。**F01 的五行语义一行不改**。
- F01 已有的性质**全部继承**：idle 走同一 idle 原语 + `idlePending` 合并；media 重读 `matches`；`map[tag]` 是一次性闸；`observeVisible` 幂等（`__tests__/island-scheduler.test.ts:496-502`）。
- 探测器注销后，`observeVisible()` 作为 morph 回调**继续完全有效**（返回对象不变）。
- `visible` bucket：探测命中时会经 `observeVisible()` 给新出现的 visible host 挂 `IntersectionObserver`，并在扫描前先释放 `isConnected === false` 的旧 observer（`island-scheduler.ts:220-225`）—— 沿用，不重复实现。

### 4.3 启用条件（arm condition）

探测**只在满足以下条件时**排程首个 timer：

1. `pendingTags().length > 0` —— 有「已声明但 host 还没出现」的 tag（全部 bucket 合并，media 中不匹配者排除）。
2. 下列**策略状态转换**在构造之后补一次 arm（2026-10-19 补记，FR-02）：idle 尝试执行完且仍有未消费 idle factory；media 监听器翻为 matching 且该 tag 仍未被消费。arm 幂等、每页至多一条探测链，且不新增激活权限（仍只调用 `observeVisible()`）。

**并且不做** `activatedAny` 门控。理由（这是一个必须写清的反直觉点）：若加「本页至少激活过一个 island」的条件，则「页面只声明一个 island、且它的 host 恰好是 late host」的合法场景会被误杀 —— 这正是最需要修的形状之一。成本由预算表（≤6 次/窗口）而非 arm 条件控制。

成本结果：**零 island 声明页 → 0 timer、0 扫描**；**全部 island 在 ready 就已托管页 → `pending` 为空 → 0 timer、0 扫描**；**声明多但本页不用多**的页 → 1 个 timer + 若中途无激活则 6 次扫描。

### 4.4 幂等注销（disarm）

| 触发 | 行为 |
|---|---|
| `pendingTags().length === 0`（全部激活） | `probeDone = true`，清 `probePending`，**立即停止**，不再排程 |
| 预算耗尽（窗口/总数） | `probeDone = true`，派发一次 `open:island-host-timeout`，不再排程 |
| 已注销后 timer 才被唤醒（`probeDone` 已置位） | `probe()` 首行直接 return，无副作用 |
| 多次 `observeVisible()`（morph）与探测并发 | 二者都只是调用同一个幂等函数；`load()` 的 `map[tag] = null` 是唯一一次性闸 ⇒ exactly-once |
| 页面离开 / 模块卸载 | 无需额外处理：timer 在预算内自然终止；不持有 DOM 引用、不注册全局监听 |

### 4.5 必须被测试钉住的不变量

- **I-1**：`load()` 仍是唯一能调用 factory 的地方（`grep` 断言：新代码中除 `load` 外无 `map[` 赋 null）。
- **I-2**：无 host 的 tag 在任何探测次数下都**不被 fetch**。
- **I-3**：`open:ready` 每次激活恰一条，扫描次数不影响事件数。
- **I-4**：探测结束后 `observeVisible()` 语义与 F01 版本逐位一致（既有 28 个单测全绿且**不做任何修改**）。
- **I-5**：`pending` 为空后不再产生任何 timer（`setTimeout` 调用计数断言）。
- **I-6**：模块保持 **import-free**（`generated-entry-gate.test.ts:326-338` 会 walk `island-scheduler.ts` 的 import 图并断言 server-runtime free）；所有新符号内联在 `createIslandScheduler()` 内。
- **I-7**：`grep -i lit packages/router/src/vite/internal/ssg/island-scheduler.ts` == 0。

---

## 5. 被拒绝的方案

### 5.1 Lit 特化（首要拒绝项）

**候选形态**：检测 `LitElement` / `lit-element-hydrate-support`；hook `ReactiveElement.updateComplete`；或让 island 声明 `createdBy: 'lit'` 走专用通道。

**拒绝理由（逐条）**：

1. **违反 owner 约束 D2=A**：G0 已定「泛用」，且本 note 的验收清单要求新增生产代码中 `grep -i lit` == 0。这是 owner 的明确边界，不是本 lane 的偏好。
2. **不解决问题**：缺陷维度是「host 出现时机」，不是「框架」。§9 A1–A4 会证明 FAST/Stencil/vanilla 同样复现。Lit 特化只修 1/4 个 fixture 用例，却要新增一套 API。
3. **每库一个适配器 = N 个新 seam**：FAST（`FASTElement.$fastController`）、Stencil（compiler 输出无公开 update 钩子）、Shoelace/Material（无 host 内容创作 API）、Ionic（同上）。按 constitution P8 / ADR-0163，每个 seam 都要登记 + 消费者形态测试，成本远超收益。
4. **对「非库来源」无效**：应用自己的 `setTimeout(() => appendChild(...))`、另一个 island 的渲染副作用、morph 之外的 DOM patch —— 都没有「库」可特化。
5. **时序上也不可靠**：`updateComplete` 只覆盖 Lit 自己的 update；本 fixture 的 host 是 **`wc-client.ts` chunk 到达后**才被定义/渲染的，hook 一个尚未存在的类的 `updateComplete` 无从谈起。

### 5.2 其它考虑过但拒绝的方案

| 方案 | 拒绝理由 |
|---|---|
| **无界 MutationObserver（document + 所有 shadow root）** | ① `attachShadow()` 不产生 mutation record，全新 shadow root 不可见；② 不能跨 shadow 边界，每个 root 需单独 observer；③ 无界 observer 会永久持有引用并在每次 DOM 变动时唤醒（动画/流式渲染场景 CPU 不可控）；④ 本仓库客户端 runtime 目前 0 个 MutationObserver，不引入新先例。 |
| **monkey-patch `Element.prototype.attachShadow`** | 从框架 runtime 全局改写平台原型不可接受：影响所有装载 runtime 的页面、与其它补丁器冲突、在 frozen intrinsics 下抛错、把库的内部时序泄漏进产品契约。**明确记录为禁止项。** |
| **只扩展 `observeVisible` 的 wiring（`onReady` 无条件注册 + `onIslandLoaded` 里调一次）** | **必要但不充分**。本页需要的那次 rescan 必须发生在 `wc-client.ts` chunk 落地**之后**，而那一刻没有任何事件：`onIslandLoaded` 由 island 模块 resolve 触发，而 `wc-open-child` 恰恰是永远不会 resolve 的那个（这就是 bug 本身）。死循环，必须引入定时/观察，故并入 P-A 而非独立方案。 |
| **`customElements.whenDefined(tag)`** | 与问题无关：`tag` 的定义由我们控制，未知的是 **host** 是否存在。 |
| **`DOMNodeInserted` / mutation events** | 已废弃；跨 shadow 行为不一致；同步派发，性能更差。 |
| **永久轮询** | 无界 CPU；后台标签页节流下行为不可预测。 |
| **只在 fixture 侧适配（审计 P1-1 option c：known-red / 改口径 / gate 摘钩）** | owner 已选 D2=A。且它是真缺口：任何第三方组件在自身 open shadow root 内创建 openElement child 的应用都坏，且对外文档已承诺支持（`using-third-party-web-components.md:116-117`）。**保留为「若 G1 否决 P-A」的降级项**，此时必须把该 known-red 写进 committed ledger 并在 gate 显式排除。 |
| **让 island 作者声明「host 由外部创建」** | 需要新的构建期声明面 + 扫描/校验 + 文档；D2=A 明确要求泛用、不要按 host 来源声明；且 manifest 无法知道运行期 DOM 事实。 |
| **把预算常量放进 `packages/protocol/src/policy.ts`** | `policy.ts` 自述的收录标准是「**more than one executor** checks the same number」（`policy.ts:5-12`）。本预算只有 scheduler 一个执行者；且新增 protocol 导出会触发 `interface:snapshot:write`（`IDLE_FALLBACK_TIMEOUT_MS` 在 snapshot 中出现 6 次）。**故常量内联在 scheduler 内**（与 I-6 一致）。 |

---

## 6. 失败模式

| # | 失败模式 | 可检测性 | 行为（实现必须如此） | 是否静默丢 island |
|---|---|---|---|---|
| F-1 | host 在 **closed** shadow root 内 | 平台不可观测（`shadowRoot === null`，无枚举 API） | 不抛错、不产生 pageerror、不影响同页其它 island；不消费工厂、不 fetch；窗口结束时 `open:island-host-timeout` 点名该 tag；后续 morph rescan 仍有效 | **否**（可诊断信号 + 仍可被后续 rescan 激活） |
| F-2 | host 在 **`<iframe>` 内**（另一个 document） | 不在 `deps.doc` 的 composed tree 内 | 同 F-1 | 否 |
| F-3 | host 在**未 attach 的 DocumentFragment** 内 | 不在 composed tree | 不激活、**不发诊断**（这是正确行为，不是失败） | 否（本来就不该激活） |
| F-4 | 预算耗尽但 host 仍在到达（慢网 / 后台标签页节流） | 窗口到期 + `pending` 非空 | **不是 drop**：`map[tag]` 保持非 null；派发一次 `open:island-host-timeout`；之后任何 morph rescan、media change 仍可激活 | 否 |
| F-5 | `setTimeout` 被节流/暂停（后台标签页） | 探测停滞 | 链式排程在尝试次数上限内自然终止，不泄漏 timer；页面可见后若仍有 host 事件（morph）仍可激活 | 否 |
| F-6 | 应用**合法地**声明了本页不使用的 island | `detail.pending` 会列出它们 | 诊断事件是 **informational，不是 error**。文档必须写明：消费者不得仅凭该事件判定失败，需与 per-page island manifest 交叉核对 | 否 |
| F-7 | 探测与 morph rescan 并发 | — | 两者调用同一幂等函数；`map[tag] === null` + `probeDone` 保证 exactly-once | 否 |
| F-8 | 超大 composed tree + 大量 pending tag | 预算表 | 成本上界 O(V) × 18，分散在多个 macrotask；实现 lane 必须实测（§7.4） | 否 |

**诊断信号契约（建议写进 docs）**：

```
事件名：open:island-host-timeout
目标：document
detail：{ pending: string[], attempts: number, elapsedMs: number }
时机：探测预算耗尽且仍有未消费 factory，每页至多一次
语义：informational。pending = 「本页声明了、本页 composed tree 里始终没有 host」的 tag 集合，
      可能是「本页确实不用这些 island」（正常），也可能是「host 在我们看不见的 root 里」（F-1/F-2）。
      消费者必须与 per-page island manifest 交叉核对后才可以判定失败。
```
命名与 `open:ready` / `open:action-failure` 一致（同样用 `win.CustomEvent` 派发）。选事件而非 `log.warn` 的理由：`log.warn` 会在每个「声明了但没用到」的正常页面上刷噪声；事件无监听者时成本 ≈ 0。

---

## 7. 性能论证（P2）

### 7.1 最坏情况成本上界

- **未启用时严格为 0**：`pendingTags().length === 0` 时不排任何 timer、不做任何遍历。
  - 无 island 声明的静态页：`load/only/visible/idle/media` 全空 → 0。
  - 所有 island 在 ready 就已托管的页：ready 扫描已把 `map[tag]` 置 null → 0。
- **启用时**：≤ `LATE_HOST_MAX_ATTEMPTS` 次/窗口 × ≤ `LATE_HOST_MAX_WINDOWS` = **≤18 次融合遍历 / ≤9000 ms**，每次 **O(V)**（一次 `querySelectorAll(tagList)` + 一次 `querySelectorAll('*')` per root，命中即早退）。
- **关键对照**：**今天的 ready 扫描已经对每个 pending tag 各做一次同阶深遍历**（`loadAll` → `load` → `hasIslandHost`，每 tag 一次 `querySelectorAll('*')` 全树）。也就是说：
  - 一次探测的成本 ≤ 今天为**一个** tag 付出的 ready 扫描成本；
  - 探测把「pending 个 tag × 1 次」换成「1 次覆盖全部 pending tag」——**单次通过比现状更便宜**，只是重复 ≤6 次。
- **量级参照（不作为承诺，仅作 scale）**：www `/reference` 页约 13,496 个元素（审计 §3）。18 次遍历的上界 ≈ 2.4×10⁵ 次元素访问，每次是「`querySelectorAll` 结果索引 + `.shadowRoot` 属性读」。实现 lane 必须实测（§7.4），不得以估算代替。
- **内存**：1 个 timer id + 1 个 pending 字符串数组；disarm 后不保留任何引用、不注册全局监听、不持有 observer。

### 7.2 与现有 hydration 流程的关系

- **不在关键路径上**：首个探测是 `setTimeout(0)`，排在工厂构造（= ready 扫描 + `open:ready` 派发 + idle/media 初始化）**之后**的宏任务。不延迟 `open:ready`、不延迟 DSD 解析、不延迟首帧。
- **不改变任何既有阶段的顺序**：`document.readyState` 分支、`onReady(observeVisible)`、`scheduleIdle()` 全部原样。
- **与 visible/idle/media 的交互**：探测命中后调用的是既有 `observeVisible()`，因此 idle 仍走 `requestIdleCallback → rAF → 注入 timeout` 的同一原语且被 `idlePending` 合并；media 仍重读 `matches`；visible 仍走 `IntersectionObserver`。探测只改「何时 rescan」，不改「rescan 做什么」。
- **不与 morph 抢跑**：`observeVisible()` 幂等；探测期间发生 morph 只是多一次无副作用的调用。

### 7.3 为什么不会让未使用的 island 产生 fetch

三条独立保证：

1. **构造性**：探测本身不调用任何 factory（代码形状上不允许：新代码里除 `load()` 外没有 `map[...] = null`，见 I-1）。
2. **门控复用**：唯一的下游是 `observeVisible()` → `loadAll()` → `load()` → `hasIslandHost()`。**false 就不 fetch，且 factory 留在 map**（`island-scheduler.ts:124`，B2 原始语义）。
3. **负向测试**：§9 C4 用 playwright 请求监听断言「本页未使用的 island chunk 请求数 == 0」。该测试必须在探测启用前后都为 0，否则实现有误。

### 7.4 实现 lane 必须实测并落盘（不得以估算代替）

1. **单次融合遍历 benchmark**：≥10,000 元素的合成树 + 1 个 pending tag + 无 host，chromium 中测量单次 `collectHosts` 的 p50/p95（目标 < 2 ms/次，18 次总计 < 10 ms）；报告数字与测量方法进 PR body。
2. **探测期 CPU profile**：`/third-party-wc/` 页面加载的 3 s 窗口内，`Performance` 火焰图不得出现 > 5 ms 的单次长任务归因于探测。
3. **零成本断言**：静态页（无 island）与全托管页各跑一次，断言 `setTimeout` 调用计数不因本改动增加。
4. 若 (1) 不达标：把实测数字带回 owner，按 §3.3 升级 P-B 或调低 `LATE_HOST_MAX_ATTEMPTS`；**不得**在 release PR 内悄悄改预算常量。

**测量状态（2026-10-19）**：第 1 项已用 10,100 元素合成树（100 个 open shadow root + 5,000 个 light 节点，1 个 pending tag、无 host）在 Chromium headless 中以生产融合遍历的复刻脚本实测：单次 p50 **0.40 ms** / p95 **0.70 ms**（worst 1.7 ms）；按 18 次绝对上限折算 p50 合计 7.2 ms、p95 上界 12.6 ms。单次目标（< 2 ms）达标，18 次 p50 达标，p95 上界高于 10 ms 目标 2.6 ms，按原样记录、不做四舍五入（方法、局限与结论见 ADR-0170「Cost evidence」）。第 3 项由既有 DOM-free 测试 T-1/T-6/T-6b 的 `setTimeout` 计数断言覆盖。第 2 项（生产长任务剖面）与「用插桩构建替代复刻脚本」登记为 alpha16 项，不在本批声称。

---

## 8. 可测性

### 8.1 扫描器接口设计（函数签名级别，DOM-free）

全部符号内联在 `createIslandScheduler()` 内（I-6），签名如下：

```ts
/** pending = 所有 bucket 中 factory 仍在 map 里的 tag；media 中 matches===false 者排除。 */
function pendingTags(): string[];

/**
 * 一次融合式 composed-tree 遍历。
 * 返回 tags 中当前有 host 的子集（顺序与 tags 一致）。
 *
 * - `root` 只需满足 ParentNode（Document / ShadowRoot / 测试 double 均可）。
 * - 每个 root 至多两次原生查询：tags 逗号连接的选择器列表 + '*'（复用做 shadow 下行）。
 * - 只用 `el.shadowRoot`（非 null 即 open）下钻 ⇒ closed root 天然止步，无异常路径。
 * - 找到全部 tags 后提前返回 ⇒ 最坏 O(V + E)，最好 O(1)。
 * - 不做任何 DOM 变更、不发事件、不写 map ⇒ 可被任意次安全调用。
 */
function collectHosts(root: ParentNode, tags: readonly string[]): string[];

/** 唯一时钟入口：deps.win.setTimeout。测试可注入受控队列。 */
function scheduleProbe(delayMs: number): void;

/** 探测单步；对 probeDone / 空 pending 幂等。 */
function probe(now: number): void;
```

**为什么这个形状适合 DOM-free 单测**：`collectHosts` 只依赖 `ParentNode` 契约（`querySelectorAll` + 元素的 `shadowRoot`），既有测试 double（`__tests__/island-scheduler.test.ts:18-38` 的 `FakeElement`）已经提供了这两者，只需把 `querySelectorAll` 的 selector 解析从「`'*'` 或单 tag」扩到「逗号列表」（**测试文件改动，implementation lane 负责**）。`probe` 的时间只来自 `deps.win`，不需要 `vi.useFakeTimers()`。

### 8.2 时钟注入（不新增 dep）

沿用既有 `makeWin(overrides)` 模式，新增一个受控定时器 helper（写在测试文件里）：

```ts
function makeTimers() {
  const queue: Array<{ id: number; fn: () => void; delay: number }> = [];
  let nextId = 1;
  return {
    win: {
      setTimeout: (fn: () => void, delay: number) => {
        const id = nextId++;
        queue.push({ id, fn, delay });
        return id;
      },
      // 续期路径会取消待命 timer，受控 double 必须实现 clearTimeout
      // （既有 makeWin 未提供；仅 onIslandLoadActivity 会用到）。
      clearTimeout: (id: number) => {
        const at = queue.findIndex((entry) => entry.id === id);
        if (at >= 0) queue.splice(at, 1);
      },
    },
    runNext: () => { const next = queue.shift(); next?.fn(); return next?.delay ?? null; },
    drain: () => { while (queue.length > 0) queue.shift()!.fn(); },
    pending: () => queue.length,
  };
}
```

> **测试 double 影响**：既有 `makeWin()`（`island-scheduler.test.ts:52-65`）没有 `clearTimeout`。它**不会**被现有用例触达 —— 续期只在窗口耗尽后发生，而同步 `setTimeout` double 下探测链会一次性跑完并直接 `giveUp`，不会进入 `onIslandLoadActivity`。新增的续期用例（T-8）必须使用上面的 `makeTimers()`。

**兼容性实测（本 lane 已跑）**：现有 `makeWin()` 的 `setTimeout` 是**同步执行**（`island-scheduler.test.ts:54`）。因此探测链在那些测试里会在构造期同步跑完。这**不会**破坏现有断言（已逐一推演：`x-load` 无 host 的用例 `pending` 为空不排程；`treeWithTags('x-load')` 的用例探测跑完也找不到 host，`loaded` 仍为 `['x-load']`，`readyEvents` 不变），但 implementation lane **必须实跑全量 28 个用例并以「零修改测试文件」为通过标准**；任何需要改既有断言的 delta 都按设计错误处理（I-4），不得改测试迁就实现。

### 8.3 DOM-free 单测矩阵（first-party，新增到 `packages/router/__tests__/island-scheduler.test.ts`）

| # | 用例 | 断言 |
|---|---|---|
| T-1 | 无 island 声明页 | `setTimeout` 调用 0 次；无 `open:island-host-timeout` |
| T-2 | 全部 island 在 ready 已托管 | `pending` 为空 → 0 timer、0 遍历 |
| T-3 | **open shadow root 内 late host（核心）** | 构造后向 `FakeElement.shadowRoot` 追加 host → 第 n 次探测把它激活；`open:ready` 恰一条 `{strategy:'load', islands:[tag]}`；factory 恰好调用 1 次 |
| T-4 | light-DOM 后插入 | 同上，host 插在 light 层 |
| T-5 | 嵌套 open shadow root（2 层） | 同上 |
| T-6 | 预算耗尽（host 永不到） | 恰好 `LATE_HOST_MAX_ATTEMPTS` 次排程后停止；`open:island-host-timeout` 恰 1 次，`detail.pending` == 期望 tag 列表；`detail.attempts`/`elapsedMs` 与预算一致 |
| T-7 | 提前注销 | host 在第 2 次出现 → 此后 `setTimeout` 调用数不再增长 |
| T-8 | 活动续期 | 窗口 1 耗尽 → 触发一次 island load activity → 新窗口开启；总计 ≤ `MAX_WINDOWS`；绝对上限 `MAX_TOTAL_MS` 生效 |
| T-9 | **closed shadow root 不崩溃** | double 模拟 `shadowRoot === null` 但内部有 host：无异常、无激活、无 fetch；超时事件点名该 tag；同页 open root 的 late host **仍然**被激活 |
| T-10 | B2 负向 | 无 host 的 tag 在全部探测轮次中 factory 调用 0 次 |
| T-11 | F01 兼容 | 探测激活后手动 `observeVisible()` ×2 → 仍只有 1 条 `open:ready`、1 次 factory（对齐既有 `:496-502` 的钉法） |
| T-12 | 复杂度守卫 | double 统计 `querySelectorAll` 调用：单次 `collectHosts` ≤ 2 × (1 + open root 数)；提前命中时严格更少 |
| T-13 | 时钟缺失/节流 | `setTimeout` 从不回调 → 不抛错、不消费 factory；`setTimeout` 抛错 → 不冒泡（与 `load()` 现有容错一致） |
| T-14 | `probe` 幂等 | 重复调用 `probe()` 不产生额外 timer、不重复派发诊断 |

**覆盖要求**：探测新增的每条分支（排程/命中/未命中/续期/耗尽/注销/media 排除）都必须有对应用例。仓库 coverage 门槛是 line 81 / branch 74 / function 81（`tools/repo/package.json:21`），而审计 P2-2 已记录**余量仅 +0.21pp** —— 因此新增 branch 测试是硬要求，且**禁止在 release PR 内改 threshold**。

### 8.4 first-party e2e（三引擎）

在既有三引擎 fixture 里各加一条（配置已含 chromium+firefox+webkit）：

- `tests/fixtures/router-native-framework/e2e/`（config: chromium/firefox/webkit，见 `e2e/playwright.config.ts:55-65`）。
- `tests/fixtures/router-request-time/e2e/live.spec.ts` —— 与既有 `#606 client:visible island inside page DSD loads on intersection`（`live.spec.ts:913`）并列，新增「late host in an open shadow root activates without a morph」。
- fixture 需要一个新的 route：页面上有一个**第一方** vanilla 组件（`attachShadow({mode:'open'})`）在 `setTimeout`/升级后把自己的 shadow root 里塞入一个 island host。这是 DOM-free 单测之外的端到端形状验证，且**不依赖任何第三方库**（可稳定跑三引擎）。

**并且 third-party WC smoke 自身必须三引擎**（这是 KR-17 的退休条件原文：「T8's three-engine, multi-library cases green」）：

- 现状：`verifyBrowser(distDir)` 硬编码 `launchQualifyBrowser({ distDir })`（`qualify.ts:177`），而 `drive-chromium.ts:36` 的 `browserName` **默认 chromium** ⇒ 今天只跑 chromium。
- 改法：`verifyBrowser` 增加 `browserName` 参数，`main()` 里**只 build 一次**（`prepareFixtureApp` 已 build），然后对 `['chromium','firefox','webkit']` 各开一个 session 跑同一套探针，把每引擎的结果并入 record/tierReport（并按引擎分别判定 pass/gap）。
- **不要**让三引擎各自 scaffold+build 一次（会把 smoke 的墙钟时间乘 3；build 是这条路径上最贵的一段）。
- 风险：KR-18 已记录 firefox fixture flake，且 owner 已定 `retries=0`、禁止用 retry 掩盖。三引擎会把 WC smoke 的 flake 面放大到 3 倍，且第三方库（Shoelace/Material/FAST/Ionic）在不同引擎上的 capability 探测本来就可能给出**合法的**不同结果。因此：
  1. 每引擎的 capability 判定必须允许「该引擎上不适用」表达为 `null`（现有契约 `using-third-party-web-components.md:136-137` 已经这么规定），**不得**把引擎差异转成失败或把 `null` 转成 `true`；
  2. 只把「注册/升级/迟到 host 激活」这类**契约级**断言设为三引擎必须全绿，其余能力探针按引擎记录；
  3. 不用固定 sleep，一律 `expect.poll` / `waitForFunction`（KR-18 的教训）。

---

## 9. 多库 fixture 计划

### 9.1 用例矩阵

**A 组 —「open shadow root 内 late host」，每库一例（核心互操作契约）**

| # | 库 | 承载组件（fixture 自撰） | 新增依赖 | 说明 |
|---|---|---|---|---|
| A1 | **Lit** | `wc-lit-host extends LitElement` → `render()` 返回 `<wc-open-child>` | `lit@3.3.3`（已 pin） | **已存在**，即当前 repro；保留为主用例 |
| A2 | **FAST** | `wc-fast-host extends FASTElement`，`fastHtml` 模板返回 `<wc-open-fast>` | `@microsoft/fast-element@3.0.2`（已 pin） | 不同模板引擎/更新时机，证明非 Lit 专属 |
| A3 | **Stencil** | `wc-stencil-host`，用 `@stencil/core` 编写 + `stencil build --config …`（`dist-custom-elements`），fixture app 用 `defineCustomElement()` 消费（与 `ion-button` 同路径） | `@stencil/core@4.43.5` | **关键：`@ionic/core@8.8.18` 的 `dependencies` 已含 `"@stencil/core": "4.43.5"`** ⇒ 该包**今天就已经被安装**（本地 pnpm store 已缓存 `@stencil/core@4.43.5`；残留 temp app 的 `.pnpm` 里也有它）。把它显式写进 `THIRD_PARTY_IMPORTS` 只为「上升为直接依赖 + 版本锁定」，**不新增下载/磁盘**。代价是 harness 多一个 `stencil build` 步骤（预计 +5–10 s） |
| A4 | **bare native** | `wc-native-host extends HTMLElement` + `attachShadow({mode:'open'})` + 后插 child | 无 | 语料已有同类（`wc-native-badge`）；零成本对照组 |

**B 组 —「light-DOM 后插入到第三方 host」（每库一例，覆盖 §2.1 第二行）**

| # | 库 | 用例 | 依赖 | 说明 |
|---|---|---|---|---|
| B1 | Shoelace | `sl-button.appendChild(<wc-late-sl slot=…>)`（升级后） | `@shoelace-style/shoelace@2.20.1`（已 pin） | 走 slot 投影，host 在 light DOM |
| B2 | Material Web | `md-filled-button.appendChild(<wc-late-md>)`（升级后） | `@material/web@2.4.1`（已 pin） | 同上 |
| B3 | Ionic/Stencil | `ion-button.appendChild(<wc-late-ion>)`（升级后） | `@ionic/core@8.8.18`（已 pin） | 同上；同时是 Stencil 运行时路径的对照 |

> B 组的价值：这三库**不提供**让消费者自撰 shadow 内容的 API（它们只暴露组件，不暴露基类），所以「库内 shadow 内容由库自己写」——诚实的对应用例就是「把 host 后插入到该库组件的 light DOM / slot」。A 组（Lit/FAST/Stencil/native）覆盖真·shadow 内部。

**C 组 — 结构性与负向**

| # | 用例 | 断言 |
|---|---|---|
| C1 | **嵌套 open shadow root**：`wc-lit-host` → 内层 `wc-fast-host` → late island | 深度无上限；两层都在扫描后被找到 |
| C2 | **closed shadow root 不崩溃**：`wc-native-closed-host`（`attachShadow({mode:'closed'})`）内创建 island tag | 无 pageerror；该 tag 未注册；同页 A1–A4 全部正常；harness 把该例记为**文档化缺口**（`null`/gap），绝不转换成 pass |
| C3 | **exactly-once 激活**：late host 被创建 → 移除 → 再创建（或追加第二个 host） | `customElements.get(tag)` 定义 1 次；`open:ready` 中该 tag 恰 1 条；该 chunk 的请求数 == 1 |
| C4 | **unused tag 0 fetch（负向，P2/B2 控制项）** | app 声明但本页无 host 的 island：`page.on('request')` 中其 chunk URL 请求数 **== 0**；且 `open:island-host-timeout` 的 `detail.pending` 含它 |
| C5 | **诊断信号** | 监听 `open:island-host-timeout`：C2 的 tag 出现在 `pending` 中；`attempts`/`elapsedMs` 不超过预算表 |

现有 `qualify.ts` 的 `expectedTags`（`:256-269`）、`thirdPartyReady`（`:288-318`）、`summary`（`:329-376`）需要相应扩展；**不得削弱任何现有断言**（尤其 `litHostContainsOpenElement`，`:360-362`）。

### 9.2 每个库需要新增的依赖与体积/网络影响

| 包 | 版本 | 解包体积（`dist.unpackedSize`） | 现状 | 本计划新增 |
|---|---|---|---|---|
| `lit` | 3.3.3 | 106,390 B（meta；+ lit-html / lit-element / @lit/reactive-element） | 已 pin | 0 |
| `@microsoft/fast-element` | 3.0.2 | 3,309,788 B | 已 pin | 0 |
| `@shoelace-style/shoelace` | 2.20.1 | 8,350,254 B | 已 pin | 0 |
| `@material/web` | 2.4.1 | 4,047,089 B | 已 pin | 0 |
| `@ionic/core` | 8.8.18 | 20,456,789 B（+ ionicons / tslib） | 已 pin | 0 |
| `@stencil/core` | 4.43.5 | 23,067,665 B，**0 个 dependencies** | 作为 `@ionic/core` 的直接依赖**已被安装** | **0 额外字节** |

**结论**：
- **新增直接依赖仅 1 个（`@stencil/core`），而它今天已经因为 `@ionic/core` 被下载/安装**（同版本 4.43.5，pnpm 解析到同一实例；本地 store 已缓存）。⇒ **本地与 CI 的额外网络/磁盘均为 0**。
- fixture 第三方直接依赖解包总量约 **36.3 MB**（lit meta 0.10 + fast 3.16 + shoelace 7.96 + material 3.86 + ionic 19.5 + stencil 22.0，其中 stencil 本就在册），本计划**不增加**这个总量。
- A3 的隐含成本是 **构建时间**（`stencil build` +5–10 s）与 harness 复杂度，不是磁盘。**这是 §11 的一个 G1 取舍点。**

### 9.3 磁盘预算（当前可用 ≈ 9.9 GB）

- `df` 实测：`/System/Volumes/Data` **9.9 GiB** 可用；pnpm store `~/Library/pnpm/store/v11` 已占 **9.2 GB**（共享、hardlink 复用）。
- fixture 每次运行在系统 temp 下生成一个 app 目录，pnpm 从 store **hardlink** ⇒ 峰值新增磁盘 ≈ store 增量 + 构建产物。本计划 store 增量为 **0**。
- 既有清理契约：`qualify.ts:1040-1044` 在 `finally` 中 `rm(tmpRoot, { recursive: true })`，仅当 `OPEN_ELEMENT_KEEP_THIRD_PARTY_WC_SMOKE=1` 保留（`:881`）。**遗留 temp 目录在诊断时确实存在**（本机发现 4 个上次运行残留的骨架目录）——建议在验收清单里加一条「harness 失败路径也必须清理；CI 不得设置 `OPEN_ELEMENT_KEEP_*`」。
- ✅ **前序 harness 陷阱已由 t3-release 修复并落地**（`6d52fa580`）：`qualify.ts:583-589` 现在 `scaffoldApp({ ..., extraArgs: ['--no-install'] })`，`tests/fixtures/web-component-interop/qualify.ts` 同步改了同一行。**实现 lane 不得 revert 该改动**；本计划不再需要为此留依赖项。

### 9.4 harness 改动点（fixture 侧，implementation lane 负责）

1. `tests/fixtures/third-party-web-components/qualify.ts`
   - `THIRD_PARTY_IMPORTS` 增 `'@stencil/core': '4.43.5'`（显式直接依赖，锁到 Ionic 已带的版本）。
   - `FIXTURE_SOURCE_FILES`（`:564-572`）增加新组件/宿主源文件。
   - `CORPUS`（`:622+`）增加文档化条目（含 A4/C2 的 closed-root gap 表达为 `null`，不转成 pass）。
   - `expectedTags`（`:256-269`）扩展；`thirdPartyReady`/`summary` 增加新探针；**新增 `open:island-host-timeout` 监听并把 `pending` 折进失败消息**（比今天的 `missing=` 更有诊断力）。
   - A3 需要在 `prepareFixtureApp`（`:578-602`）里加 `stencil build` 步骤，并在 app 里 `defineCustomElement()` 注册。
   - **三引擎**：`verifyBrowser(distDir)`（`:172-177`）改为接受 `browserName`，`main()` 里 build 一次后对 chromium/firefox/webkit 各开一个 session（§8.4）；结果按引擎并入 record 与 tierReport。
   - **KR-17 退休**：全绿后更新／摘除 the internal working ledger (not published)（ledger 的 `Retirement condition` 就是本条；摘钩需给出三引擎证据）。
2. 体积/依赖声明：`docs/integrations/using-third-party-web-components.md` 的支持矩阵（`:129-134`）与「Library Evidence」段（`:108-127`）需要补 A/B 组条目；新增一条**明确的 late-host 支持声明**与 **closed shadow root 不支持声明**；三引擎结果需要一条说明（含 `null` 语义）。

---

## 10. 验收清单（implementation lane 直接照做）

### 10.1 生产代码

- [ ] 唯一改动的生产文件：`packages/router/src/vite/internal/ssg/island-scheduler.ts`（+ 约 60 行，全部内联在 `createIslandScheduler()` 内）。
- [ ] 不新增任何 `import`（`generated-entry-gate.test.ts` 会 walk import 图断言 server-runtime free）。
- [ ] 不新增/不修改任何导出（`export` 仍为 `IslandSchedulerDeps` / `IslandScheduler` / `createIslandScheduler` 三个）。
- [ ] `load()` 的 host gate 与 `map[tag] = null` 一次性闸**原样保留**；新代码中除 `load()` 外无 `map[...] = null`。
- [ ] `observeVisible()` 的函数体**逐字未改**（F01 语义冻结）。
- [ ] `grep -i lit packages/router/src/vite/internal/ssg/island-scheduler.ts` → **0 命中**。
- [ ] 不引入 `MutationObserver`（P-A 方案）；不 patch 任何平台原型。
- [ ] **新增/改写的注释不得包含仓库内路径字面量**（`packages/`、`tests/`、`tools/`、`www/`、`apps/`、`benchmarks/`、`node_modules/…` 及其 `./`、`../`、绝对路径变体）：router 发布 `src/**`，`@openelement/tools-release#pack-surface:check` 会对 shipped 文本里的这些 token fail closed（前例：`82792403d` 正是为此改写本文件注释）。引用历史时用 commit subject 而非路径。
- [ ] 不改 `packages/protocol/src/policy.ts`；预算常量内联（理由见 §5.2 末条）。
- [ ] 未触碰 `docs/`（**G1 批准前禁止**）。

### 10.2 单测（first-party）

- [ ] `packages/router/__tests__/island-scheduler.test.ts`：新增 §8.3 的 T-1…T-14，扩展现有 `FakeElement.querySelectorAll` 支持逗号选择器列表。
- [ ] **既有 28 个用例零修改全绿**（I-4）；任何既有断言需要改动 → 视为设计错误，回到本 note。
- [ ] `vp run --no-cache --fail-if-no-match --filter @openelement/router test` 全绿。
- [ ] coverage：新增分支全覆盖；**不改 threshold**（line 81 / branch 74 / function 81，余量仅 +0.21pp）。
- [ ] `vp run --fail-if-no-match @openelement/tools-repo#test:coverage:check` 通过。

### 10.3 e2e（三引擎，硬要求）

- [ ] `router-native-framework` e2e 新增「late host in an open shadow root activates without a morph」，chromium + firefox + webkit 全绿。
- [ ] `router-request-time` e2e 新增同形用例（与 `live.spec.ts:913` 并列），三引擎全绿。
- [ ] **third-party WC smoke 三引擎**：`launchQualifyBrowser` 按 §8.4 接上 chromium + firefox + webkit，**build 一次、三个 session**；注册/升级/late-host 激活这类契约级断言三引擎全绿。
- [ ] `browserVersion` 与每引擎 capability 结果都进 record/tierReport；引擎差异只能表达为 `null`/gap，**不得**转成 pass。
- [ ] `vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-native-framework e2e` 与 `--filter @openelement/fixture-router-request-time e2e`。
- [ ] 无 flake：不依赖固定 sleep 断言（用 `expect.poll` / `waitForFunction`）；owner 已定 `retries=0`，**禁止**用 retry 掩盖（KR-18）。

### 10.4 fixture（§9）

- [ ] A1–A4、B1–B3、C1–C5 全部落地；A 组每库一例 open-shadow-root late host。
- [ ] `pnpm --dir tests/fixtures/third-party-web-components run smoke` 在 `wc-open-child` 上**由红转绿**（当前失败信息是 `custom-element registration failed; missing=wc-open-child; browserErrors=`，三引擎都要绿）。
- [ ] C4 负向用例（unused tag 0 fetch）为绿。
- [ ] C2 closed root 记为 gap（`null`），**不得**转成 pass。
- [ ] **KR-17 退休**：the internal working ledger (not published) 的 KR-17 条目 `Latest observation` 更新为「已修复」并摘钩（或按 ledger 惯例保留条目 + 标注 retired），证据 = 三引擎 smoke 全绿的日志。
- [ ] 不 revert t3-release 已落地的 `--no-install`（`qualify.ts:583-589`）。
- [ ] 新增直接依赖仅 `@stencil/core@4.43.5`，且确认它为 0 额外体积；在 PR body 记录该事实与验证方式（`@ionic/core@8.8.18` 的 dependencies 已含同版本）。

### 10.5 文档 / seam

- [ ] `docs/integrations/using-third-party-web-components.md`：late-host 支持声明 + closed shadow root 不支持声明 + 支持矩阵更新。
- [ ] `www/content/docs/guide/islands-and-ssr.md`（+ `.zh.md`）：B2 段落补一句「可达性在有界 late 窗口内持续求值」；如触发 `doc-figures` >1% 增长则按 ritual 重基线。
- [ ] 新增 `open:island-host-timeout` 事件记入公开事件面文档（与 `open:ready` / `open:action-failure` 并列）。
- [x] 按 constitution P8 / ADR-0163 判定：该事件构成 client runtime → page 的公开诊断面，已登记 `docs/architecture/seams.md`（「Late-host activation give-up announcement」行，owner/consumer-form guard 齐备）；scheduler 仍是唯一 owner，未新增构建期产物或跨阶段交接。判定与替代方案见 ADR-0170。
- [ ] 若 owner 要求把设计提交为文档：`docs/release/late-host-island-activation-design.md`（G1 批准后由本 lane 提交）。

### 10.6 门禁命令（提交前本地全绿）

```sh
vp run fmt
vp run check
vp run --no-cache --fail-if-no-match --filter @openelement/router test
vp run --fail-if-no-match @openelement/tools-repo#test:coverage:check
vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-native-framework e2e
vp run --no-cache --fail-if-no-match --filter @openelement/fixture-router-request-time e2e
# 三引擎 third-party WC smoke（§8.4；今天是 chromium only，需先接上引擎开关）
vp run --no-cache --fail-if-no-match --filter @openelement/fixture-third-party-web-components smoke
```

无需运行：`interface:snapshot:write`（无导出变化）、`version-bump`（非发布 PR）。
定稿前置：完整 `release:check` 需在**新 SHA** 上重跑（审计 §4.6；t3-release 只跑了 smoke 本身，未跑完整 `release:check`）。

### 10.7 禁止项

- ❌ 不 patch `Element.prototype.attachShadow` 或任何平台原型。
- ❌ 不引入 `MutationObserver`（P-A）。
- ❌ 不为 Lit 或任何具体 WC 库新增特化分支/标记。
- ❌ 不修改 `load()` 的 host gate 语义、不绕过 `observeVisible()`。
- ❌ 不新增无界轮询/无界 observer。
- ❌ 不在 release PR 内调整 coverage threshold。
- ❌ 不削弱 fixture 既有断言（尤其 `qualify.ts:360-362`）。
- ❌ 不 push / merge / tag / publish。

---

## 11. G1 需要 owner 拍板的取舍点

1. **预算取值（窗口长度 vs 尾延迟成本）**
   - 建议：6 次/窗口、3000 ms/窗口、3 窗口、绝对 9000 ms。
   - 备选 A（更省）：4 次/窗口、1500 ms/窗口、2 窗口、绝对 4000 ms —— 更快收敛，但对慢网下几百 KB 的第三方 chunk 余量变小。
   - 备选 B（更稳）：8 次/窗口、5000 ms/窗口、4 窗口、绝对 20000 ms —— 覆盖更慢的第三方注册，但最坏扫描次数升到 32。
   - 取舍本质：**「late host 承诺的强度」vs「最坏情况下多做的全树扫描次数」**。
2. **是否接受 `open:island-host-timeout` 这个新公开事件**
   - 它解决了「不得静默丢 island」的诊断要求，但会在「应用声明了本页不使用的 island」这一**完全正常**的场景下也派发（每页 ≤1 次，无监听者成本 ≈0）。
   - 替代：不派发事件，只在测试/诊断模式下暴露状态（则生产环境仍无信号）；或派发但要求文档写明 informational 语义（建议后者）。
3. **多库 fixture 是否包含 A3（真 Stencil 自撰 host）**
   - 含：证明「非 Lit、非 FAST 的第三方编译器路径」，代价是 harness 增加一个 `stencil build` 步骤（+5–10 s）与 ~40 行 harness 代码，**磁盘/网络 +0**。
   - 不含：A 组只剩 Lit / FAST / native 三例（仍满足「3+」，但 Stencil 只以 light-DOM 形式（B3）出现），与 owner 原话「Shoelace / FAST / Stencil / Ionic / Lit 中选 3+，每库都要有 late host in open shadow root 用例」相比，Stencil 的 shadow 内部用例会缺席。
4. **改动面是否收敛为「单文件生产改动」**
   - 建议：是（只改 `island-scheduler.ts`）。探测的下游完全复用 F01 的 `observeVisible()`，不碰 `entry-client-codegen.ts`、不碰 protocol、不碰构建期。
   - 备选：额外把 `onIslandLoaded` 在 `enhancedForms === false` 时也无条件生成（`entry-client-codegen.ts:675`），让「任何 island 加载」立即触发一次 rescan —— 能让首个 late host 更快被激活，但把改动面扩到第二个文件 + codegen 测试，且**不能替代定时探测**（§5.2）。建议不做。
5. **（t3 handoff 新增，需 owner 知悉成本）三引擎 third-party WC smoke 的范围**
   - KR-17 的退休条件已写死为「T8's three-engine, multi-library cases green」，因此 WC smoke 必须接上 chromium/firefox/webkit（§8.4）。这不是本 lane 可自行收窄的。
   - 但需要 owner 知悉两点成本/风险：① 浏览器阶段变成 3 个 session（建议 build 一次、三 session，避免 3× 构建）；② KR-18 已记录 firefox fixture flake 且 owner 已定 `retries=0`、禁止 retry 掩盖，三引擎会放大暴露面。建议的收敛口径：**只有「注册 / 升级 / late-host 激活」这类契约级断言要求三引擎全绿**，其余能力探针按引擎记录、差异表达为 `null`（符合 `using-third-party-web-components.md:136-137` 既有契约）。

**G1 结论：1–4 按上述推荐批准；第 5 条（引擎口径）随后裁决为「接受推荐收敛口径」（见顶部「批准记录」）。**

---

## 附录 A：证据索引（本 lane 实际读过的位置）

**核心实现**

- `packages/router/src/vite/internal/ssg/island-scheduler.ts:98-106`（`hasIslandHost`，模块作用域）、`:121-139`（`load()` host gate + `map[tag] = null`）、`:191-251`（`observeVisible`，F01 后的形状）、`:290-295`（`rescanMedia`）、`:307-336`（`scheduleIdle`/`rescanIdle`）、`:340`（`onReady(observeVisible)` 仅在 `visibleTags.length > 0` 时注册）、`:342`（返回面）。
- `packages/router/src/vite/internal/ssg/form-enhance.ts:303-305`（`morphDocument` 之后 `scanSubmitRoots(doc); observeVisible();`）、`:145-162`（`scanSubmitRoots` 的幂等 + prune 先例）。
- `packages/router/src/vite/internal/ssg/entry-client-codegen.ts:477-495`（bucket 由 `admittedIslands.filter(strategy)` 派生）、`:653-677`（`__schedule({...})`，`onIslandLoaded` 在 `enhancedForms === false` 时为 `null`）、`:679-708`（enhance 层仅在有表单时生成）。
- `packages/router/src/cli/build-client.ts:403-426`（`localIslands` 为 app 级；`enhancedForms` 来自 `cachedRoutes.some(hasEnhancedForms)`）、`:717-743`（单次 `generateClientEntry`）。
- `packages/router/src/vite/internal/ssg/island-scanner.ts:77-82`（`resolveIslandHydrate = hydrate || upgradeStrategy || 'idle'`）。
- `packages/router/src/vite/internal/ssg/island-lifecycle.ts:20-85`。
- `packages/router/src/vite/internal/ssg/entry-descriptor.ts:501-540`。

**既有约束 / 门禁**

- `packages/router/__tests__/generated-entry-gate.test.ts:326-338`（walk `island-scheduler.ts` import 图，断言 server-runtime free）。
- `packages/router/__tests__/island-scheduler.test.ts`：`:18-38`（`FakeElement` double）、`:40-71`（`makeDoc`/`makeWin`，**`setTimeout` 同步**）、`:110-177`（B2 偏离声明）、`:425-457`（无 host 不 load）、`:467-503`（late host + exactly-once 钉法）、`:496-502`（idempotent rescan 钉法）、**`:531-552`（深查询确实能在 shadow root 内找到 host，eager `load` bucket；这是「一旦 host 出现，探测的 `observeVisible()` 必然能激活它」的直接证据）**。
- `packages/router/__tests__/dev-island-rescan.test.ts`、`entry-generators.test.ts:512`（`observeVisible: __scheduler.observeVisible`）。
- `tools/lib/vp-pack.ts:81`（`island-scheduler.ts` 是显式 pack entry）。
- `tools/repo/package.json:21`（coverage: line 81 / branch 74 / function 81）、`:31`（`gate:release` 步骤表）。
- `tools/release/package.json:24`（`gate:packed` 含 `@openelement/fixture-third-party-web-components#smoke`）。
- `.github/workflows/published-consumers.yml:83`（smoke 在 CI 中的位置）。
- `packages/protocol/src/policy.ts:1-17`（收录标准：more than one executor）、`:70`（`IDLE_FALLBACK_TIMEOUT_MS`）。
- `docs/release/public-interface-snapshot.json`（`IslandScheduler*` 0 命中；`IDLE_FALLBACK_TIMEOUT_MS` 6 命中）。

**fixture / 互操作**

- `tests/fixtures/third-party-web-components/app/islands/wc-open-child.tsx:14-20`、`app/islands/wc-fixture.tsx:31-46,113-116`、`app/client/wc-client.ts:64-70,111`、`app/components/page-third-party-wc.tsx`、`app/routes/third-party-wc.tsx`。
- `tests/fixtures/third-party-web-components/qualify.ts:64-70`（pins）、`:254-286`（`missing=` 失败信息）、`:288-318`（`thirdPartyReady`）、`:329-376`（`summary`，含 `litHostContainsOpenElement`）、`:564-602`（`FIXTURE_SOURCE_FILES` / `prepareFixtureApp` / `--no-install` 缺失点）、`:622+`（`CORPUS`）、`:881,1040-1044`（keep 开关 / `finally` 清理）。
- `tests/lib/qualify-harness/scaffold-app.ts:43-56`、`workspace-alias.ts:129-138`、`drive-chromium.ts:13,36`。
- `docs/integrations/using-third-party-web-components.md:108-137`（Library Evidence / 支持矩阵 / 双向承诺）。
- `www/content/docs/guide/islands-and-ssr.md:25,43`（B2 承诺的文档表述）。

**运行时/依赖事实（实测，非推断）**

- `npx vitest run packages/router/__tests__/island-scheduler.test.ts` → **28 passed / 225 ms**（harness 可用且 DOM-free）。
- `npm view` 解包体积：shoelace 8,350,254 B；material 4,047,089 B；fast-element 3,309,788 B；ionic 20,456,789 B；lit 106,390 B；`@stencil/core@4.45.2` 22,183,565 B / 332 files；`@stencil/core@4.43.5` 23,067,665 B（0 deps）。
- `npm view @ionic/core@8.8.18 dependencies` → `{ tslib, ionicons ^8.0.13, '@stencil/core': '4.43.5' }` ⇒ Stencil 编译器已随 Ionic 安装。
- pnpm store `~/Library/pnpm/store/v11/index.db` 已缓存 `@shoelace-style/shoelace@2.20.1` / `@material/web@2.4.1` / `@microsoft/fast-element@3.0.2` / `@ionic/core@8.8.18` / `@stencil/core@4.43.5` 与 `4.45.2`。
- `df -h` → `/System/Volumes/Data` 9.9 GiB 可用；store 9.2 GB。
- `tools/lib/vp-pack.ts` 说明 router 发布 `src/**`（所以源码注释会进 tarball，`pack-surface:check` 会对 `tests/`、`packages/` 字面量 fail closed —— 见 `82792403d`；新增注释**不得**写仓库内路径）。

**上游记录**

- `.zcode/plans/alpha15-external-audit-verification-2026-10-18.md:15,75,88,104,128`（P1-1 与 `missing=wc-open-child` 的核实结论；owner 决策建议 a/b/c）。
- the internal working ledger (not published) 的 **KR-17** 条目（committed；`Owner: alpha15 batch — T8 takes the fixture follow-up`；`Retirement condition: T8's three-engine, multi-library cases green`；`Latest observation: 2026-10-18, lane/t3-release @ f395b1e1f`——smoke 到达浏览器阶段且恰好 `missing=wc-open-child`、browser errors 为空）。同文件 KR-18（firefox fixture flake；`retries=0` 为已批准策略、禁止 retry 掩盖）直接约束 §8.4 的三引擎方案。
- t3-release handoff（lane/t3-release，未 push）：`6d52fa580` fix(tests): keep the pre-publish registry install out of qualify scaffolds；`36c60cdd1` test(release): qualify the create initializer alias before and after publish；`ed50abeaa` docs(release): commit the known-reds ledger for release readers（三者均为 lane 历史提交，不是主分支祖先；主分支落地提交见 KR-17 条目）。lane 报告：`.zcode/scratch/t3-release/REPORT.md`（§1 harness 修复 + 正/负向证明；handoff notes；「no gate currently runs `fixture-web-component-interop#qualify`」记为 alpha16 候选）。
- git：`c27f1ae6b`（F01）、`3c472f08f` / `82792403d`（toString 自包含不变量及其后的注释改写；F01 已把 `hasIslandHost` 提升回模块作用域，inline 路径退役 —— `tests/fixtures/router-request-time/app/routes/visible-probe.tsx:6` 明示改为 virtual module）。

## 附录 B：未决 / 残留风险

1. **窗口内的 host 才被承诺**。窗口外出现、且此后没有任何 morph/media/idle 事件的 host 仍不会被激活。这是有界预算的必然代价，属**已声明的残留缺口**，不是静默失败（有 `open:island-host-timeout`）。
2. **`open:island-host-timeout` 的噪声面**：需在文档中明确 informational 语义，避免消费者把它当错误（§11.2）。
3. **P-B 升级触发条件**：若 §7.4 的实测显示单次遍历 > 2 ms 或总长任务 > 5 ms，需要重新找 owner 决策（不得自行改预算）。
4. **A3 的 Stencil 构建步骤**会给 harness 增加构建时间与一处新的失败面（Stencil 配置/版本），需在 fixture 里 fail loud（stencil build 非零退出必须让 smoke 失败，不得静默降级）。
5. **`ssr:false` island 的 host 也可能在 SSR 标记里**（只是组件未序列化）——文档描述 late host 时不要把它等价为「客户端加载」，需以「host 出现时机」表述。
6. **三引擎 WC smoke 的 flake 面**：KR-18（firefox fixture flake，`retries=0` 政策）说明本仓库的三引擎 fixture 已在 flake 边缘。WC smoke 加密到三引擎后，任何新的跨引擎差异都会被 gate 观察到；收敛口径见 §11.5（只把契约级断言设成全绿），并把首次三引擎跑的结果如实记录（包括合法的引擎差异）。
7. **KR-17 摘钩的证据形态**：ledger 摘钩需要「三引擎全绿的日志」作为证据；建议在 PR body 直接贴三段引擎的 smoke 结论摘要 + `OPEN_ELEMENT_TIER_REPORT` 产物路径（产物不入库），不要只写「本地通过」。

---

## 实现补记（2026-10-19，PR #1611 评审 FR-02 / FR-03 收口）

本节是 §3.1 伪代码与 D-1…D-4 偏离表之后的状态机**收口记录**；预算常量、单一激活权限和诊断事件均未变，ADR-0170 的 2026-10-19 Amendment 与本补记同义。

### A. 策略状态转换补 arm（FR-02）

评审复现的两条路径在原状态机下**永远不会 arm** 探测：

- **idle-only（默认策略）**：构造时 idle 尝试 outstanding ⇒ `pendingTags()` 按 D-1 排除该 tag ⇒ 不 arm；idle callback 执行时没有宿主，该尝试就此花掉，之后没有任何路径再看一眼。
- **media-only**：不匹配的查询被能力门控排除在 `pendingTags()` 外 ⇒ 构造时不 arm；查询翻为 matching 时没有宿主，change listener 当时是唯一事件，也不 arm。

现实现（`packages/router/src/vite/internal/ssg/island-scheduler.ts`）：

- idle 的 deferred 步骤在 `loadAll(idleTags)` **之后**调用 `armProbe()`：加载本身仍走浏览器 idle 原语（探测只重跑 rescan，不直接 load），因此 idle 的异步调度语义不变；尝试仍在 outstanding 时 `pendingTags()` 的排除保持不变（不重复排 idle step）。
- media 的 change listener 在 `event.matches === true` 且该 tag 仍未被消费时调用 `armProbe()`。
- `armProbe()` 幂等（每页一条链）、无激活权限（`load()` 的 host gate 仍是唯一入口）；预算耗尽仍只发一次 `open:island-host-timeout`。

### B. 9000 ms 绝对上限改为入口闸（FR-03）

原实现只在 `probe()` 的**扫描之后**（`probeAttempt`/窗口判定）与 `endWindow()` 中检查总时限，`onIslandLoadActivity()` 的续窗入口完全不查；评审以「冻结首个 probe timer、把注入时钟推进到 10,000 ms、再插入宿主」复现了超限激活。

现实现新增 `probeAgeOut(now)`，并在以下**每一个入口**、任何 DOM 扫描或激活之前判 `now - probeStartedAt >= LATE_HOST_MAX_TOTAL_MS`：

1. `probe(now)` 首部（覆盖所有 timer 唤醒，含后台标签页挂起/节流后迟到的唤醒）；
2. `onIslandLoadActivity()` 首部（覆盖续窗入口；此处同时 `clearTimeout` 掉待命 timer，保证上限后不再持有 timer）。

超限路径：注销探测链（`probeDone`）、不扫描、不激活、不消费 factory，派发一次 `open:island-host-timeout` 且 `elapsedMs >= 9000`；随后显式 rescan 与 media change 仍可激活（契约边界未变）。

### C. 证据

- `packages/router/__tests__/island-scheduler.test.ts`（58 例，原 50 例；原有用例的语义断言未削弱）：
  - FR-02：`FR-02 idle-only: …activates, with open:ready`、`FR-02 media-only: …arms the probe`、`FR-02 no duplicate load`、`FR-02 positive control`、`FR-02 idle-only: … never gets a host … diagnostic`；
  - FR-03：`T-18b`（冻结 timer + 10,000 ms：不扫描——以 `CountingElement` 断言查询数不变、不加载、无 `open:ready`、超时事件 `elapsedMs >= 9000`）、`T-18c`（8,999 ms 正控制，仍激活）、`T-18d`（挂起/节流：待命 timer 与 load activity 两个续窗入口都只注销）；
  - `#F01 idle: the re-armed attempt keeps the fallback selection` 改为按 25 ms 策略延迟定位 idle 重排步骤（该页现在合法的多出一个有界探测 step，fallback 选择断言保留）。
- 合同文档：`docs/adr/ADR-0170-late-host-island-activation.md` 的 2026-10-19 Amendment；公开文档 `www/content/docs/guide/islands-and-ssr.md` / `.zh.md`（新增“Late hosts / 迟到宿主”）与 `recipe-island-strategies.md` / `.zh.md`。
