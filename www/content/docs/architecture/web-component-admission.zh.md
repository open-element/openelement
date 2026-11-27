---
title: 'Web Component 准入层级'
lede: '准入层级描述的是 openElement 对某个 Custom Element 实际能够渲染并保留什么。'
navLabel: 'WC 准入'
order: 45
---

## 各层级的含义

准入针对具体的 tag 与解析后的包版本，而不是某个库中的每一个组件。适配器或
Custom Elements Manifest 条目本身都不构成证据。最终结果是服务端与浏览器
相应检查中通过的最高层级。

| 层级                         | 服务端写入                                                                             | 浏览器行为                                                                          | 适用场景                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **T0 · Custom Element leaf** | 宿主元素、属性以及创作时写下的 slot-first light-DOM 子节点。不承诺第三方 shadow root。 | 组件自行注册并升级；CSS `:not(:defined)` 与 `:defined` 可以对升级过渡进行样式控制。 | 任何无需经过 SSR 验证即可使用的 WC；不需要适配器。                     |
| **T1 · Structure snapshot**  | 构建期对稳定结构的无头 DSD 快照，**不含请求数据**。                                    | 升级既有宿主元素，不丢弃该结构。                                                    | 固定版本通过了快照与升级检查的组件。                                   |
| **T2 · Runtime adapter** | 通过验证的适配器 SSR 输出。 | 通过组件运行时升级。 | 计划用于通过 SSR 与升级验证的第三方组件。 |
| **T3 · Native compiled** | 编译生成的服务端渲染器输出 HTML 和 DSD。 | 浏览器运行编译生成的挂载或 claim 函数并绑定行为。 | openElement 组件。 |

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

T1 快照只有稳定结构。页面通过 loader 读取请求所需的数据。T2 要求对适配器的 SSR 与浏览器升级进行验证。

## 当前可用能力

浏览器测试在 Chromium、Firefox 和 WebKit 中验证标准、Lit、FAST 与 Stencil 元素的 T0 行为。服务端输出宿主及作者声明的 light DOM 子节点，第三方组件在浏览器中升级。openElement 自身的组件在 T3 通过编译生成的渲染器生成 HTML，再按各自的 hydration 策略激活。T1 快照和 T2 第三方 SSR adapter 仍在规划中。

## 另见

- [Island Hydration](/zh/guide/islands-and-ssr)——组件何时进入客户端投递：分层与 hydration 策略。
- [DSD Rendering](/zh/architecture/dsd)——平台 shadow-root 契约。
