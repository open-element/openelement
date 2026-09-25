---
title: '流式渲染'
lede: '一种可选模式：先提交文档壳，再回填那些数据仍在加载中的部分。'
navLabel: '流式渲染'
order: 45
---

> alpha5 已接受（[ADR-0158](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0158-streaming-server-executor.md)、[ADR-0159](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0159-part-backfill-and-late-claim.md)，2026-09-25）；它是编译后服务器执行器的一种可选模式，本页描述当前实现所强制的边界。

## 它改变了什么

`'dynamic'` 页面通常每个请求渲染一份完整文档：loader 解析、页面序列化、响应发出。流式渲染只改变*字节何时离开服务器*。处理器先把 HTTP 响应无法收回的决定定下来——状态码、重定向、响应头、Cookie、已解析的文档 head——再冲刷编译后的壳，然后回填那些 loader 字段仍在解析中的 Part。

它仍是同一份编译程序，不是第二个渲染器：没有运行时 JSX，没有 VNode 回退，也没有 server component 模型。生成的处理器依旧返回一个 body 为 `ReadableStream` 的 Web `Response`；Nitro 只是这个处理器的部署出口。

两个粒度彼此独立：服务端冲刷壳并按字段解析顺序回填 Part，而 island 仍按 `load`、`idle`、`visible`、`media` 或 `only` 激活。两者互不调度，流式页面也完全可以没有 island。

### 流式壳不序列化什么

流式壳由延迟执行器渲染，而该执行器不接受任何嵌套渲染器。因此壳里的每个自定义元素标签——无论是声明了 `ssr: true, dsd: true` 的 island，还是任何嵌套的已编译组件——都只会输出为**不透明的空宿主**：作者写的 light DOM 子节点被保留，元素内部为空。island 的 `ssr`/`dsd` 设置与常规的组件序列化规则在流式路由上都不适用：这些组件在浏览器里激活并渲染。

这是该模式自身的性质，不是可以重新打开的配置；也正因如此，必须在无 JavaScript 时也能读到内容应留在页面自己的壳里。服务端出生的第三方宿主还能承诺什么，见 [Web Component 准入层级](/zh/architecture/web-component-admission)。

## 开启方式

一个路由声明该模式，并列出允许延迟的 loader 字段：

```ts
import { definePage } from '@openelement/router';
import ArticlePage from '../components/page-article.tsx';

export function loader(ctx: { request: Request }) {
  const url = new URL(ctx.request.url);
  return {
    // Front gate: awaited before the shell is committed.
    heading: url.searchParams.get('title') ?? 'Untitled',
    // Deferred: the shell flushes while this Part is still pending.
    body: loadBody(url.searchParams.get('id')),
  };
}

export default definePage(ArticlePage, {
  renderIntent: { mode: 'dynamic', stream: { defer: ['body'] } },
});
```

被延迟的字段按**同名映射**到页面自己编译出的属性上：

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('article-page', { root: 'shadow-open' })
export default class ArticlePage extends OpenElement {
  @property({ reflect: false, attribute: false })
  heading = '';

  // Deferrable: writable, non-computed, attribute: false, reflect: false.
  @property({ reflect: false, attribute: false })
  body = '';

  render() {
    return (
      <main>
        <h1>{this.heading}</h1>
        <p id='body'>{this.body}</p>
      </main>
    );
  }
}
```

这份声明刻意要求字面量。构建会拒绝任何它无法从源码里直接读出的写法：

- `stream` 只与 `mode: 'dynamic'` 同时有效。
- `defer` 必须是非空、无重复的字面量安全属性名列表——不接受变量、展开或计算键。
- 每个字段必须是已声明的编译属性，可写、非 computed、`attribute: false`、`reflect: false`，且不得与路由参数或 `locale` 冲突。
- 路由描述符不得携带自定义 `props` 投影器或依赖请求的 head；`renderIntent` 只能包含字面量的 `mode` 与 `stream` 赋值。
- 只接受原生编译页面；`defineLitPage` 会被拒绝。

有两个项目级约束容易漏掉。流式渲染要求应用壳在**整个项目范围内关闭**（`openElement({ appShell: false })`，且不得有 `layouts`）：流式文档是分片冲刷的，无法被壳包裹，因此单个路由写 `route: { layout: false }` 并不能满足这道门禁。并且 loader 仍然只返回**一个对象**——没有第二个 loader，也没有新的数据形状。

## 前置门禁决定一切 HTTP 结果

任何后续字节都无法收回的东西都在第一个分片之前定下来：中间件准入、认证与安全检查、适用的 CSRF、路由选择、loader 初始化、每个未被延迟的字段、状态码/重定向/未找到/错误决定、已解析的文档 head、头部通道合并（含全部 `Set-Cookie`）、缓存策略与 CSP nonce。响应头在这一刻被复制并冻结。

因此延迟计算不得掌握重定向、Cookie、响应状态或响应头决定。提交之后，框架自身的响应头写入会被忽略并给出结构化的迟到写入诊断，而不是抛错——响应一经暴露，头部即不可变——而迟到的 `redirect()` 或状态信号是该 Part 的协议失败，不是被改写的响应。提交前的失败保留其真实状态：选择了流式的路由若在提交前重定向、认证失败或抛错，返回的是它正常的响应，绝不会是一个成功壳。

由于响应头先于壳确定，常规 loader 约定仍然成立：会话 Cookie 与按请求的响应头都从 loader 写出；任何希望体现在状态码或响应头里的取值都应留在前置门禁里。

## 延迟字段可以拥有什么

编译器根据 `defer` 列表、编译属性元数据以及页面程序既有的 signal→Part 依赖，派生出路由专属的清单，然后检查该 signal 的每一个消费点。只要存在任何不合格的用法，整个字段就会被拒绝——没有部分延迟。

合格：锚点拥有的**文本 Part**，以及有界的 `when`/`each` **Region**。Region 的 item 模板仅当其动态取值完全由该 Region 拥有、且通过常规序列化转义时才合格。

不合格，每一项都会带路由、字段、源码位置与确切的违规 sink 报错：

- 经由 computed signal 的依赖，包括传递依赖；
- attribute、boolean、class、style、raw HTML、ref、事件或 slot 路由 sink；
- 壳/布局或 head 取值；
- 宿主或子节点的开标签，以及锚点路径跨越 slot 或自定义元素宿主的任何 sink；
- item 模板中含有自定义元素（不透明宿主）或帧不安全标签/属性的 Region；
- 不透明的 renderer 或外部组件包装。

诊断会以 `field -> computed total -> text p3` 或 `field -> attribute p4` 的形式点名 sink，补救方式总是三者之一：把该字段放回前置门禁、移除这个 sink，或关闭流式渲染。普通非流式路由完全不受这些规则影响。

## 预算

延迟是有界的，而且这个上界在四个地方镜像——构建扫描、生成的处理器、浏览器安装器，以及公开的手写清单执行器（`createDeferredDsdExecutor`）——因此超预算的路由会构建失败，而不是在 hydration 时静默失败：

- 每个路由最多 **32 个延迟字段**；
- 这些字段合计最多 **64 个 Part owner**。

一个字段拥有多个 Part 时，每个 Part 都计入。超出预算时，请减少延迟字段、减少每个字段的延迟 sink，或拆分页面。

seed 另有一条彼此独立的界：流式页面的类型化 seed 最多携带 **64 个属性**。它是页面类上非 computed 属性的总数，而不是延迟 Part 的数量，因此属性面较大的组件完全可能在远未触及延迟预算时就越过它。seed 一旦超限会被整体拒绝，所以该检查在构造壳时就失败发声，而不是留下一个静默拒绝 hydration 的页面。

## 启用 JavaScript 时

每个结算的字段为它拥有的每个 Part 发出一个惰性 `<template>` 帧，携带文档/程序/实例身份元组、Part 索引、字段名、编译类型、终态结果，以及该区间的 HTML。安装器在触碰 DOM 之前先校验元组与路由清单，然后只替换该 Part 两个锚点之间的节点——绝不替换整份文档或相邻区间。

相互独立的 Part 可以以任意顺序到达；某个元组的第一个有效终态帧生效，完全相同的重复帧被忽略，互相冲突的重复帧会被诊断并忽略。帧被拒绝——未知 Part、错误的请求/程序/版本/实例、未授权的 sink、不安全的标记、类型不符的取值——不会产生任何 DOM 变更。

壳还携带页面属性的惰性类型化 seed 数据：每个前置门禁属性一个带标记的已解析值，每个延迟属性一个带标记的 pending 状态，pending 的 Part 索引按完整元组存放。`null`、缺失与 pending 是三种彼此不同的状态；claim 在连接任何东西之前先消费 seed，因此 pending 的 Part 绝不会被拿去和编译默认值比较，也不会被报告为不匹配。延迟的文本 Part 通过规范字符串形式渲染其结算值，因此解析为 `null` 的字段会流式输出字面文本 `null`，数字与布尔同样如此（`0` 输出 `0`）。这一渲染是当前契约，owner 保留更改它的权利。

一个字段可以拥有多个 Part，此时它的每个帧必须携带相同的结算值；出现不同值的帧属于协议冲突，会让其余 Part 保持 pending。

## 无 JavaScript 时

响应无法知道 JavaScript 是否启用，因此服务器在每个惰性帧旁边还会发出一个可用的 `<noscript>` 块，按到达顺序排列在壳之后。启用 JavaScript 时该尾部不激活，安装器把内容装到它的锚点上；禁用 JavaScript 时，读者看到的就是这个尾部。

这意味着可见位置可能比 pending 占位符更靠后，壳也绝不能把 pending 的动作用作已完成来呈现。**无 JS 时不做原位顺序的承诺**：如果位置重要，请把该字段放进前置门禁，或让路由保持非流式。尾部里的链接与表单照常可用——包括普通的表单 POST，它仍走既有的非流式 action 路径。

有一处标记差异是刻意为之：流式壳中延迟的文本 Part 除起始锚点外还会带上闭合锚点，让空区间有明确定义。非流式输出保持它既有的单锚点形状，逐字节不变。

## 壳之后的失败

提交之后的延迟失败是流内结果，无法改写 HTTP 元数据：状态码、响应头与 Cookie 已经发出。路由为该 Part 发出一个终态错误帧——`error` 结果，**既无内容也无取值**——并在无 JS 尾部给出通用替代文本 `Content unavailable.`。致命失败可能结束整个流，让其他 pending Part 明显降级。后续成功的值不得覆盖错误，被拒绝的帧也绝不会变成成功回填。恢复意味着带新文档 token 的新请求，而不是隐式的重试帧。

页面的 `error` 投影器与其错误变体渲染属于*提交前*通道：它们回应的是第一字节之前发生的失败，那时响应仍可被替换。壳一经提交，流内就没有可渲染的错误页——只有上面那个有界的终态帧。

未在处理器内置预算内结算的字段——默认 30 秒——会以超时失败并走同一条终态错误路径。取消（`Request.signal` 中止或流 `cancel()`）汇聚到一次幂等的清理：中止待处理工作、释放资源，并忽略之后的一切解析结果。

不在这个边界内的：action、表单 POST、上传、webhook、自定义 API 处理器与安全拒绝都保持既有的非流式语义；增强的客户端导航 GET 也不会消费流式帧。只有在更晚的导航真正取得意图所有权时，才会取代正在进行的流式文档。

## 第三方 Web Components

在流式路由上，第三方 Custom Element 只有一种已验证的放置方式：**在流式壳内服务端出生**。上面的准入规则本就禁止延迟 sink 跨越自定义元素宿主，而回填路径对帧内容中的外部自定义元素标签是失败关闭的——把第三方组件放进回填区间不是受支持的放置方式。

资格探针钉住可行的形状：壳内恰好一个实例，在客户端 upgrade，保留其服务端出生的 light DOM 子节点，并在回填之后仍可交互。第三方标签的层级状态记录在 [Web Component 准入层级](/zh/architecture/web-component-admission)：该语料库目前为三个带服务端出生 light 子节点的标签证明 T0，正式的 T1/T2 资格仍未完成。

## 关闭流式渲染时

省略 `stream` 会原样保留既有路径。静态页面与不带 `stream.defer` 的动态页面产出与这一模式存在之前完全相同的字节——没有流式元数据、没有 seed、没有帧、没有无 JS 尾部，也没有闭合的文本锚点。静态与非流式两条生成边界之间的字节一致性由测试钉住；只有显式选择加入的路由，输出才会改变。

## 另见

- [路由与数据](/zh/guide/routing-and-data)——本模式延迟其中一部分的 loader/props 边界。
- [Island 与服务端渲染](/zh/guide/islands-and-ssr)——服务端优先的基线与彼此独立的 hydration 轴。
- [Web Component 准入层级](/zh/architecture/web-component-admission)——第三方组件在流式路由上可以放在哪里。
- [DSD 渲染](/zh/architecture/dsd)——壳背后的 shadow root 契约。
