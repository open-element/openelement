---
title: 'OpenElement Alpha16–18：从 CE 中心的组件模型走向函数组合'
date: '2026-10-31'
lang: 'zh'
tags: ['roadmap', 'architecture', 'alpha']
excerpt: '函数式 JSX 与 Signals、无需额外 host 的有状态组合、显式原生边界：编译与安全交付、组件创作和异步内容交付的规划顺序。'
---

接下来的 OpenElement 将提供函数式 JSX 与 Signals，让组件封装自己的状态和订阅，拆分业务 UI 时无需逐个增加 DOM host。需要原生属性、事件、slots、Shadow DOM、表单关联或跨框架消费时，Custom Elements 继续提供正式出口。Alpha16–18 依次改进编译与安全交付、组件创作和异步内容交付。

## 写法会怎样变化

下面摘自已核读的 `compiled-element-v2/counter.tsx` fixture，保留计数、方法与按钮，其余样式和列表省略。旧例按钮显示“+”，并不显示计数；下面的新例显示计数，两段也不构成UI输出等价证明。

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('oe-program-counter')
export class ProgramCounter extends OpenElement {
  @property({ reflect: true })
  count = 0;

  increment(): void {
    this.count++;
  }

  render() {
    return <button type='button' onClick={this.increment}>+</button>;
  }
}
```

计划中的内部组件写法如下。`component(...)` 是未发布候选入口，下面只展示局部状态；旧例的属性反射需由正式 CE 出口承接，两段不构成平台能力等价证明。

```tsx
// 目标 API，尚未发布；尚未验证编译通过。
const Counter = component(() => {
  const count = signal(0);
  return (
    <button type='button' onClick={() => count.value++}>
      {count.value}
    </button>
  );
});
```

作者可以把草稿、展开状态和订阅放进组件，资源清理由框架负责。旧 class 用户无需立即重写。当前 OE 没有 React Hooks；新模型沿用 Signals，不引入 Hooks/React 生态兼容层。具体名称和类型仍需验证。

## 当前架构解决了什么

OpenElement 已经有一套编译型组件基础。TSX 在构建期转换成版本化 Part Program，记录静态结构、动态位置和身份信息。服务端据此输出 HTML，浏览器执行器负责创建节点、接管已有 DOM、绑定响应式更新与清理资源。

交互组件以 `OpenElement extends HTMLElement` 为中心。每个元素实例拥有根节点、program instance、订阅和清理范围。这个安排让 Custom Element 的平台身份与框架实例保持一致，也为 DSD、原生属性和跨框架使用提供了明确入口。CE 提供元素身份和连接回调；内部条件、列表和任务仍需 scope 管理资源寿命，不能把这部分已有责任全部记成 hostless 新增成本。

当前浏览器路径仍在读取 program 结构并按 Part 类型建立绑定。编译器提前定位动态位置，运行时无需重新发现所有绑定；执行器依然需要理解 Part Program 的结构和语义。这一点决定了下一阶段的后端工作量：Direct DOM Codegen 要替换真实执行职责，已有 claim、预激活事件、样式、错误恢复和清理行为都需要保留。

## 困境一：内部组合被绑定到元素边界

[ADR-0143](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0143-0-44-compiled-element-model-reentry.md) 将 CE class 定为具体组件模型，并规定元素实例拥有 Parts、结构、订阅与清理。

这种边界适合独立分发的原生元素。页面内部拆出一段业务 UI 时，额外 host、元素注册和 property/attribute 映射可能增加使用成本。组件若输出多个相邻节点或空内容，也难以直接沿用“一个元素就是一个实例边界”的假设。

我们计划让函数组件承担内部组合，默认无需额外 host。需要原生 slots、Shadow DOM、属性反射、表单关联或跨框架消费时，再显式导出 Custom Element。首版 island 根继续使用现有 CE 激活边界。

这要求框架建立逻辑实例与 DOM region 的关系：分支删除要释放整个子树，keyed 移动要保留身份和状态，Children 插入必须有唯一清理责任。用户仍通过 props 和 children 组合组件，这些所有权细节由编译器与运行时承担。

[ADR-0173：组件执行与组合模型](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0173-component-execution-and-composition.md) 已正式接受架构方向并修订 ADR-0143 中唯一 CE/class 模型的约束，保留 claim fidelity、原生互操作及独立消费者验证要求。旧 class 继续兼容，新增函数模型共用后端与 Signals；反射、表单、Context 和连接行为的适配仍需要逐项验证。

## 困境二：共享 program 的便利限制了执行后端

[ADR-0148](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0148-compiler-semantic-core-vite-integration-boundary.md) 将语义核心与 Vite 集成分开，并要求 compiler/runtime 只通过确定、可序列化的版本化产物交互。统一的 program 便于让 SSR、浏览器创建和接管共享结构信息，也把浏览器执行路径与 program 格式绑定在一起。

Alpha16 将让客户端生成模块直接承担 mount、claim、update 和 dispose。我们会区分三个层次：

- **编译期结构信息：** 用于分析、lowering 和生成，不要求发送到浏览器。
- **生成模块 ABI：** 生成代码与少量共享 helper 的调用契约。
- **HTML 与数据 wire：** DOM 定位标记、允许的初始数据、资源和构建身份。

这个区分允许服务器继续复用适合它的序列化路径，也允许客户端交付针对具体组件的代码。身份匹配、Signals、事件、region 和清理仍可使用共享 helper。helper 的费用和生成代码一起进入页面可达体积统计。

[ADR-0174：生成代码、共享运行时与兼容契约](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0174-generated-code-runtime-and-compatibility.md) 已正式接受架构方向并修订 ADR-0148 的单一可序列化产物约束，同时保留语义核心与打包外壳的一向依赖。设计原则 P2 已明确必要运行时的边界、责任与测量要求；实现和资格验证仍待完成。现有“无需 runtime JSX fallback”的要求继续保留，旧通用客户端执行路径在覆盖和资格完成后退休。

## 困境三：服务端函数已经存在，表达能力仍受限制

OpenElement 已有服务端函数与组合路径。当前编译器对其中的函数声明拒绝 async，要求函数体只有一次 JSX 返回。常见的局部计算和 data-in-place 因而受到限制，异步数据需要提前放到 loader。

Alpha16 会扩展这条既有路径，支持普通局部计算、异步执行和跨模块组合。首先采用 full-await，完成后交付 HTML；交互组件的 setup 首版仍保持同步。

开放表达式需要清楚定义求值时机。某段表达式在 SSR、mount、claim 和更新时运行几次，未激活或已退出的条件分支是否清理活动订阅，异常之后哪个边界负责清理，都要由可运行例子验证。未知 JSX helper、动态组件和跨端不可序列化值仍有明确限制。

这项工作沿用既有 TSX 与页面能力，保留 `definePage` 和 layout 约定。新的表达式规则也不能静默改变已发布 class 的行为。

## 困境四：服务端代码的安全交付仍需要结构隔离

[ADR-0171](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0171-private-artifact-static-boundary.md) 记录了现有私有产物保护：共享静态分发拒绝对服务端产物命名空间的访问，并考虑解码、大小写和 realpath。文档也明确了宿主覆盖范围及残留限制。

Alpha16 将进一步拆开公开根与私有输出，并由发布 manifest 确定允许发布的文件集合。不同宿主分别承担运行时校验或打包上传过滤，避免依赖操作者手工排除私有目录。

这部分优先修订 ADR-0171。URL 去掉 `/client/` 前缀属于独立迁移，安排在 Alpha17；目录安全隔离在 Alpha16 推进。manifest 只能约束允许公开的文件，无法替代 HTML 安全、序列化安全或应用授权检查。

## 函数组件沿用 Signals

新函数组件计划采用 setup-once：每个客户端实例初始化一次，后续 props 或 signal 变化驱动相关绑定与结构更新。SSR 和客户端接管分别建立实例。状态显式读写 `.value`，普通局部变量与解构保留 JavaScript 语义。

OpenElement 当前没有 React Hooks。函数组件也不引入 Hooks 兼容承诺。函数、JSX、props 和 children 提供熟悉的组合方式，执行与状态语义由 OE 的 Signals 模型定义。

连接生命周期与实例寿命在内部区分。重连可能重新建立订阅，旧订阅必须已释放；同 owner 的 keyed 移动保留框架实例状态，但无法保证第三方 CE 完全不触发平台连接回调。

连接型候选统一为 `onConnect`：DOM/refs 就绪且已连接时执行，可返回 cleanup；SSR 不执行，同实例重连可再次执行而 setup 不重跑。它不表示可见性或每次更新后的 layout effect，也不全局改变既有 effect 时序。名称尚未发布。

CSS 隐藏且仍挂载会保留实例和订阅。条件分支未激活时不创建实例，退出时销毁，重新进入建立新实例；首版没有隐含 keep-alive。SSR 和客户端分别初始化，接管需避免客户端意外重复 setup 和重复活动订阅；局部恢复重建时先正确清理。

推荐路径需要在真实作者样例、类型检查、源码定位、旧/新混用和完整页面对照中得到验证。已有 class 用户无需立即重写项目。

## 组件包必须跨出 monorepo

独立库在 monorepo 中能运行，还不足以证明分发能力。应用必须能只安装 tarball，正确消费 server/client 入口、props 类型、CSS、组件身份和兼容元数据。

正式实现切片从库端预编译开始，应用负责入口选择、资源链接和打包。首版只选择一种通过验证的分发模式。两份物理 runtime 或 Signals 跨所有权边界时需要去重或明确拒绝，同一版本号不能替代实例唯一性检查。

《预编译组件包分发契约》会随独立消费者切片形成。具体元数据和版本范围尚未冻结，正式 API 发布前仍需完整验证。

## 为什么组件级 streaming 放在 Alpha18

OpenElement 已有 route/field streaming。[ADR-0158](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0158-streaming-server-executor.md) 已规定 admission、HTTP commitment、有界队列、背压、取消和部署证据要求。

组件级 defer 会增加子树身份、资源就绪和 DOM 写入所有权问题。旧导航请求的结果不能覆盖新页面，延迟片段不能在样式缺失或版本错误时激活，也不能与导航 morph 同时接管同一 region。

我们将先稳定执行后端和组件身份，再扩展该能力。对应 ADR 会补充有限并发、排队与累计任务、缓冲字节、深度、时限及宿主容量政策；协议若有实质变化，再形成后继记录。

取消覆盖框架调度、资源持有和过期结果隔离。任意用户 Promise 或外部服务未必能立即终止。完整等待 fallback 同样受输出和时限约束。

实际收益将通过部署链路测量，包含代理缓冲、首个有效内容、服务器驻留和峰值内存。缺少正确性或收益证据的路径不会默认启用。现有流式通道继续维护和回归验证。

## 如何验证所选架构

首批正式实现切片共用一个列表和现有基础：有私有草稿的 hostless 行支持重排、删除、条件和多根/空输出；同一列表走 SSR、接管、更新、销毁，并注入局部不匹配与 cleanup 异常；其中组件预编译打包，交给全新应用消费类型、CSS 和两端入口。切片通过后保留扩展。

局部失败先修实现，再收窄支持结构。私有状态、框架清理与必要 WC 能力不能被删掉以换取通过。输出安全等独立工作继续，不等待所有切片结束。

## 三个版本的交付顺序

| 版本 | 主要工作 | 用户影响 |
| --- | --- | --- |
| Alpha16 | 直接 DOM codegen、公开/私有输出隔离、服务端函数扩展、页级客户端需求判定 | 现有组件迁移到新后端；无实际客户端需求的页面目标为零 JS |
| Alpha17 | 响应式函数组件、组合、显式 CE、独立组件包及迁移 | 新项目获得统一推荐路径；旧 class 保留兼容；通用 upgrade 和 URL 迁移独立推进 |
| Alpha18 | 组件级 defer、资源准备、有限资源及导航整合 | 快内容可以先显示，迟到结果和失败有明确处理与fallback |

Element 与 Router 继续承担核心产品职责。Lit 现有兼容继续维护，独立 OhMyLit 产品另行规划；Native 的新增能力不自动构成 Lit 对等支持承诺。

以上是规划目标。ADR-0173/0174 已正式接受架构方向，已登记的 amendment 保留历史与变更关系；实现仍待完成，预编译组件包分发契约尚未冻结。具体 API、发布状态和性能收益以实现与验证结果为准，当前没有固定发布日期或新的收益数字。
