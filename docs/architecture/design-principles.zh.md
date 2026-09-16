# 设计原则

本文档是 OpenElement 的设计宪法，约束框架公共契约、运行期表面积与构建
机制的一切变更。它是活文档；修订本文档本身需要一条 ADR。

关键词 **必须**、**应当**、**可以** 分别按规范性要求、建议与可选
来解释。

工作规则是 **comply or explain（遵守或说明）**。偏离某条原则的变更并非
被禁止，但必须在提交信息或 ADR 中点名该偏离、并注明它与哪条原则做了
交换。未点名的偏离视为缺陷，直接回退。

## 序言：框架为什么存在

按 [The Extensible Web Manifesto][ewm] 的立场：标准进程的成功方式是向
平台添加低层能力，并用这些原语解释高层「魔法」。库与框架存在的意义是
先行验证平台尚未吸收的模式——然后被吸收。

OpenElement 认真对待这个循环：框架是 **web 标准 API 之上的最小增量**——
只补平台（尚）未提供的部分，能在构建期支付的成本绝不在运行期支付，并
把自身的每一块都视为平台追上来时必须可删的债务。Declarative Shadow
DOM、CSS `@scope`、Speculation Rules API、View Transitions 这些特性
被采纳，恰恰因为它们让框架代码得以删除。

## 选民优先级

原则之间冲突时，按以下顺序裁决（改写自 [W3C TAG 设计原则][tag-dp]）：

1. 使用 OpenElement 所建站点与应用的人
2. 用 OpenElement 构建的开发者
3. OpenElement 自身的实现者
4. 实现的优雅程度

方便实现但损耗用户或开发者的变更，输。内部优雅但给交付应用增加运行期
表面积的变更，输。

## P1 — 用平台

平台是默认实现。框架不得重造平台已提供之物；为补缺而提供的部分，是
附带退役条件的债务。

引用：[The Extensible Web Manifesto][ewm]；
[HTML Design Principles §3.5 Do Not Reinvent the Wheel][html-dp]；
[open-webcomponent 建议][open-wc]。

本仓实践：路由准入从 WHATWG `URLPattern` 派生；运行期组件模型是
custom elements + Declarative Shadow DOM + light root；样式边界是 CSS
`@scope`；预取是 Speculation Rules API；页面转场是 View Transitions；
void 元素集合有唯一属主。自建正则路由、scoping 运行时、元数据提取器
不进仓库。

判别问句：_平台今天能做、或在标准轨道上即将能做这件事吗？能 → 框架
一行不写。_

## P2 — 编译期支付，不在运行期支付

复杂度花在构建期。交付物必须读起来像普通平台代码。给用户应用增加的
运行期表面积，默认拒收。

引用：[W3C TAG Web Platform Design Principles][tag-dp]；
[The Rule of Least Power][least-power]；
[Svelte — Rethinking Reactivity][svelte]。

本仓实践：编译器在构建期把受支持的 TSX 降为 Part Program
（ADR-0143、ADR-0148）；不受支持的写法以诊断失败，绝不回退到运行期
虚拟 DOM 路径；SSR 产物是声明式平台标记，而不是被 ship 的渲染函数的
产物。构建期 IR 允许自造，因为运行期契约是浏览器自己的组件模型；IR
绝不向运行期渗漏。

判别问句：_这增加的是构建期表面积还是运行期表面积？运行期表面积需要
ADR。_

## P3 — 服务端契约即 WinterTC

每个服务端边界都是 `fetch(Request): Promise<Response>`。服务端 API
表面积必须落在 [WinterTC Minimum Common Web Platform API][wintertc]
加显式声明的扩展之内。运行时不许向用户代码渗漏：无 `process.env`、
无 Node HTTP 桥、公共契约中无 Hono/h3 上下文对象。

引用：[WinterTC][wintertc]（规范性引用，Ecma International）。

本仓实践：权威派发是 `dispatchRequest(request) => Promise<Response>`；
fetch middleware 是方言无关的 WinterCG 形态
`(request, next) => Promise<Response>`，在处理器边界组合；dev server、
`start` CLI、fixture server 与 Nitro 生产入口跑同一个 handler。Hono
只被当作这些原语之上的薄组合层使用，且必须定期重新证明其位置。

判别问句：_它在 Deno、Workers、Nitro mount 上不改一字能跑吗？_

## P4 — HTTP 保真与渐进增强

HTTP 语义绝不静默降级。表单无 JavaScript 可用；GET 缓存语义不被
悄悄弱化；重定向、状态码、方法语义保持忠实。安全边界 fail closed。

引用：[HTML Design Principles §3.2 Degrade Gracefully][html-dp]；
[Remix 文档][remix]。

本仓实践：导出 action 的页面可以保持静态 GET——预渲染并保留静态缓存
语义——其 POST 在请求期运行（ADR-0120 修订）；action POST 以 303 PRG
重定向、422 校验重渲染、RFC 9457 problem JSON（fetch 调用方）应答；
框架生成的 script 携带请求级 CSP nonce，使浏览器自身的安全边界能够
接纳；SSG 按设计拒绝 nonce，而不是输出错误的静态产物。

判别问句：_关掉 JavaScript、开启 CSP、前面放一层缓存——还成立吗？_

## P5 — 为删除而设计

每一层都必须可删。兼容只存在于部署边界，绝不渗入应用代码。每个 shim
落地时必须写明退役条件。

引用：[The Extensible Web Manifesto][ewm]；
[Write code that is easy to delete, not easy to extend][tef]。

本仓实践：Nitro mount 被关在 `dist/server` 出口，对应用代码不可见；
字符串拼接的 script 注入器与 `Function.toString()` 配置序列化被直接
删除而非包上兼容层（Alpha 允许破坏性清理）；退役的 ADR 留在 Git
历史中，而不是另建平行文档。

判别问句：_平台明天原生支持了这个，我们具体删什么、应用代码动几行？
答不出 → 这个抽象不该存在。_

## P6 — 单一来源，无平行机制

数据已存在于标准产物——模块图、类型检查器、文件系统、Playwright
report、打包 tarball——时，仓库不得在旁边长出第二份 source of
truth。不为已知机制另建注册表、扫描器或手工维护的副本。不可避免的
副本必须配漂移守卫，且守卫以临时为意图。

本条是本仓内部判例，立于 Alpha.1 闭包：禁列表漂移曾是真实安全缺口
的根因；硬编码文件清单让新文件逃过 typecheck；无身份绑定的 sidecar
让 E2E 证据可伪造。

本仓实践：一份 protocol 层禁列表谓词服务编译器、客户端校验器与服务端
校验器，序列化的 `DANGEROUS_KEYS` 副本配漂移守卫；starter 用原生目录
递归做 typecheck；E2E 证据从原始 Playwright report 重算，并以
SHA-256 与候选 SHA 绑定。

判别问句：_这是第二份 source of truth 吗？_

## P7 — 评审四问

任何进入框架的新代码在评审中回答四个问题。前三问重述 P1–P3；第四问
是制度化的先例审查。

1. 平台能做吗？（P1）
2. 成本能在编译期支付吗？（P2）
3. 必须在运行期的话，它读起来像平台代码、并遵守服务端契约吗？（P3）
4. 最近的成熟先例是什么，我们的差异是刻意选择的吗？

第四问的工作先例库：[Extensible Web Manifesto][ewm] 谱系
（Polymer → [Lit][open-wc]）、[Enhance][enhance]（HTML-first、标准
主义）、[Remix][remix]（HTTP 保真）、[Astro 岛屿架构][islands]
（选择性 hydration）、[Svelte][svelte]（编译期支付）、
[htmx essays][htmx]（行为局部性）、[WinterTC][wintertc]（服务端
契约）。说不清与先例的差异 = 设计漂移，打回。

## 平台追账评审

每个 release 周期，维护者列出平台新近使其冗余的框架代码并删除之。
这是 P1 与 P5 保持诚实的机制：待办应当朝着原语收缩，而不是朝着
聚合框架生长。渲染岔路与可选模式在每次评审中用同一把尺子重新量，
不能证明其表面积即退役。

## 参考文献

- [The Extensible Web Manifesto (2013)][ewm]
- [W3C TAG — Web Platform Design Principles][tag-dp]
- [W3C — HTML Design Principles (2007)][html-dp]
- [W3C TAG — The Rule of Least Power (2006)][least-power]
- [WinterTC — Minimum Common Web Platform API][wintertc]
- [Remix 文档][remix]
- [Svelte — Rethinking Reactivity][svelte]
- [open-webcomponent 建议][open-wc]
- [Enhance 文档][enhance]
- [Jason Miller — Islands Architecture][islands]
- [htmx essays][htmx]
- [tef — Write code that is easy to delete][tef]

[ewm]: https://github.com/extensibleweb/manifesto
[tag-dp]: https://w3ctag.github.io/design-principles/
[html-dp]: https://www.w3.org/TR/html-design-principles/
[least-power]: https://www.w3.org/2001/tag/doc/leastPower.html
[wintertc]: https://wintertc.org/
[remix]: https://remix.run/docs
[svelte]: https://svelte.dev/blog/svelte-3-rethinking-reactivity
[open-wc]: https://open-wc.org/
[enhance]: https://enhance.dev/docs/
[islands]: https://jasonformat.com/islands-architecture/
[htmx]: https://htmx.org/essays/
[tef]: https://programmingisterrible.com/post/139222674273/write-code-that-is-easy-to-delete-not-easy-to-extend
