---
title: 'Web Component 准入层级'
lede: '准入层级描述的是 openElement 对某个 Custom Element 实际能够渲染并保留什么。'
navLabel: 'WC 准入'
order: 45
---

> alpha5 提案（[ADR-0157](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0157-web-component-admission-tiers.md)）；并不代表所有层级都会在当前版本中交付。

## 各层级的含义

准入针对具体的 tag 与解析后的包版本，而不是某个库中的每一个组件。适配器或
Custom Elements Manifest 条目本身都不构成证据。最终结果是服务端与浏览器
相应检查中通过的最高层级。

| 层级                         | 服务端写入                                                                             | 浏览器行为                                                                          | 适用场景                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **T0 · Custom Element leaf** | 宿主元素、属性以及创作时写下的 slot-first light-DOM 子节点。不承诺第三方 shadow root。 | 组件自行注册并升级；CSS `:not(:defined)` 与 `:defined` 可以对升级过渡进行样式控制。 | 任何无需经过 SSR 验证即可使用的 WC；不需要适配器。                     |
| **T1 · Structure snapshot**  | 构建期对稳定结构的无头 DSD 快照，**不含请求数据**。                                    | 升级既有宿主元素，不丢弃该结构。                                                    | 固定版本通过了快照与升级检查的组件。                                   |
| **T2 · Runtime adapter**     | 适配器运行时经过资格验证的 SSR 输出；第一方 Lit 模式已有直达路径。                     | 通过组件运行时完成 hydration/升级，不替换服务端产生的状态。                         | 仅在第三方 Lit 通过准入之后；失败则回退到 **T0**，而不是假定存在快照。 |
| **T3 · Native compiled**     | 第一方编译后的 Part Program 序列化 HTML/DSD。                                          | 同一个程序负责创建或认领 DOM 并绑定行为。                                           | openElement 组件。                                                     |

即使没有 JavaScript，只要创作时的子节点承载了关键内容，T0 依然有用。请优先
在源码 HTML 中写出有意义的 slotted 文本与控件；不要依赖第三方 shadow tree
出现在服务端输出里。例如，作者可以在组件定义前后分别设置样式：

```css
my-widget:not(:defined) {
  display: block;
}
my-widget:defined {
  display: block;
}
```

T1 快照**只包含结构**。在流式路由上，每个请求的数据仍然来自路由的动态
Part；快照绝不捕获请求数据。快照缓存以解析后的版本与构建输入为键，输入
变化即失效，并且**绝不提交进 Git**。

T2 不会因为一个 tag 继承了 LitElement 就自动成立。第三方包必须经受住适配器
SSR、（使用时的）流式路由以及延迟 hydration/升级检查。如果做不到，服务端会
在**流式开始之前**输出 T0 宿主与 light 子节点并给出降级诊断。字节发出之后的
错误无法把响应变回 T0；它遵循流式错误契约。第一方
`renderer: 'lit'` 的资格验证并不为所有第三方 Lit 包背书。

## 当前可用能力

当前的第三方 tag 语料对 native、Lit、FAST 与 Stencil 探针检查的是 T0 形态的
输出：宿主与创作的 light 子节点存在，第三方 DSD 缺席，并在 Chromium、
Firefox 与 WebKit 中实际执行浏览器升级。Lit Framework Mode 单独对显式注册的
Lit 页面/island 做服务端渲染；native openElement 组件走编译后的程序。构建期
无头快照与第三方 Lit T2 自动准入仍是**提案**，不是当前的普遍保证。

在流式路由上，已验证的第三方放置方式是流式壳内的服务端出生：资格探针钉住
单个实例完成升级、保留其服务端出生的 slot 子节点，并在回填之后保持可交互。
回填帧内容对外来自定义元素 fail-closed 拒绝——把第三方组件放进回填区域不是
受支持的放置方式。第三方资格 smoke 的当前层级报告对三个携带服务端出生
light 子节点的语料 tag 证明了 T0（`wc-lit-counter`、`sl-button`、
`md-filled-button`——3/11）；正式的 T1/T2 资格验证仍然开放。

[准入 harness issue](https://github.com/open-element/openelement/issues/1451)
会报告固定版本 OSS Lit 探针的最高通过层级，涵盖 slot-first 内容、定义状态
样式、流式与降级检查。其证据按次生成，不是人工维护的认证清单。失败的检查
永远不会计作通过的层级。

## 另见

- [Island Hydration](/zh/architecture/islands)——组件何时进入客户端投递：分层与 hydration 策略。
- [DSD Rendering](/zh/architecture/dsd)——平台 shadow-root 契约。
