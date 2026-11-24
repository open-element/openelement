---
title: '流式渲染'
lede: '延迟字段流式渲染不属于本次发布。本页说明什么退役了、为什么退役，以及现在该怎么做。'
navLabel: '流式渲染'
order: 45
---

> **本次发布不提供。** `renderIntent.stream` 是 class 通道的延迟字段通道，随 class 通道一起退役。它的替代载体归 Alpha18 所有。不要写它，也不要从旧文档里抄流式配方：该声明在模块求值时就会被拒绝（`OE_PAGE_RENDER_MODE`），页面无法构建。

## 退役的模式是什么

已接受的设计（[ADR-0158](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0158-streaming-server-executor.md)、[ADR-0159](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0159-part-backfill-and-late-claim.md)，2026-09-25）允许 `'dynamic'` 页面先冲刷壳，再回填那些取值仍在解析中的 loader 字段。它从来不是第二个渲染器：同一份编译程序既产出壳也产出回填帧，而延迟的值焊死在编译程序的 **Part owner** 上——也就是该程序声明的锚点、文本 part 与 block。

正因如此它无法存活。载体是 class 通道的编译 Part Program。取代 class 通道的函数通道没有 Part Program 可以挂延迟字段，如今也没有任何通道会产出它。因此创作在模块求值时即以 `OE_PAGE_RENDER_MODE` 拒绝该声明——"streaming is a compiled-Part-Program channel … and a server function page has none"——而不是接受一条没有任何东西能伺服其帧的路由。（构建还保留了一个更晚的拒绝（`OE_ROUTE_SCAN_GENERATED_ELEMENT_PAGE_UNSUPPORTED`），针对万一走到那一步的生成页面；实践中创作检查总是先触发，因为存续的两种页面形态都是函数组件。）

退役的声明长这样，它只作为历史展示，不是 API：

```text
// REFUSED — this shape does not build in this release.
export default definePage(ArticlePage, {
  renderIntent: { mode: 'dynamic', stream: { defer: ['body'] } },
});
```

本页不记录字段数量、预算规则、帧协议或无 JS 尾部，因为它们都不可达。`@openelement/element` 仍导出的那些常量（`STREAM_MAX_FIELDS`、`STREAM_MAX_OWNERS`、`STREAM_TIMEOUT_MS` 等）是已退役执行器自身的界限；它们描述的是一个本次发布不会接入任何页面的载体。

## 今天用什么代替

响应重新是一份完整文档：loader 解析，页面序列化，响应发出。本次发布中每个页面都走这条路径，它是一条受支持的路径，不是降级路径。

**在 loader 里解析数据。** 页面需要的一切都在壳写出之前 await 完成。一个 await 自己工作的 loader 就是延迟字段的替代，而且是最诚实的替代：读者拿到完整文档，不存在第二套协议能把某个区间留在 pending。

**把 HTTP 决定集中在一处。** 状态码、重定向、响应头、Cookie 与已解析的文档 head 都在响应开始前决定，因为第一个字节之后再没有可以重新考虑它们的时点。会话 Cookie 从 loader 的 `responseHeaders` 通道写出；重定向从 loader 或 action 抛出。[路由与数据](/zh/guide/routing-and-data) 说明了每条通道拿到的上下文。

**把无 JS 内容留在页面自身。** 页面渲染一个壳，内容就在壳里。如果某个区块必须在没有 JavaScript 时可读，它就必须属于那次渲染——稍后 hydrate 的 island 是叠加在已有内容之上的增强，绝不是为它占位。island 仍按 `load`、`idle`、`visible`、`media` 或 `only` 独立激活，而这个轴从不依赖流式渲染。

**响应开始前的失败交给 error 投影器。** `definePage(Component, { error })` 是仍能改写状态行、用错误变体重渲染页面的通道。响应一旦开始就没有这样的通道，这也是本次发布把响应一次性提交的另一个原因。[错误处理](/zh/guide/error-handling) 覆盖投影器、`fail()`、`redirect()` 与 `notFound()`。

## 不宣称什么

替代品**不是**换了个名字的增量回填。本次发布中没有任何东西：

- 在壳之后发出惰性帧或类型化 seed 数据；
- 在客户端安装 Part-range claim；
- 为迟到内容准入 `<noscript>` 尾部；
- 为延迟字段设界或超时。

寻找这些保证的读者看到的是未来版本。Alpha18 拥有载体；有载体之后本页会重写，在那之前它不会教授一个会抛错的 API。

## 另见

- [路由与数据](/zh/guide/routing-and-data)——页面改用的 loader/props 边界。
- [Island 与服务端渲染](/zh/guide/islands-and-ssr)——与流式渲染无关、也未改变的 hydration 轴。
- [错误处理](/zh/guide/error-handling)——存续的失败通道，以及各自的边界。
- [DSD 渲染](/zh/architecture/dsd)——每个页面都经由它渲染的 shadow-root 契约。
