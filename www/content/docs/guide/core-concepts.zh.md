---
title: '核心概念'
lede: '核心模型是 standards-first：authored elements、declarative rendering、file routes 与可选 islands。'
order: 10
---

## OpenElement

`@openelement/element` 的 `OpenElement` 继承 `HTMLElement`，是应用中每个组件的基类。组件用 TSX 编写，在构建时被降级为一个 Part Program——一份带版本、可序列化的产物，运行时只负责重放它。发往浏览器的既没有虚拟 DOM 运行时也没有解释器：不受支持的写法会以编译器诊断失败，而不会回退到某条运行时渲染路径。

两个编译期装饰器承载组件的契约：

```tsx
import { computed, element, OpenElement, property, type ReadonlySignal } from '@openelement/element';

@element('my-counter', { root: 'shadow-open' })
export default class MyCounter extends OpenElement {
  @property({ reflect: true })
  count = 0;

  @property({ reflect: false })
  label = '';

  @property({ reflect: false, attribute: false, type: Boolean })
  empty: ReadonlySignal<boolean> = computed(() => this.count === 0);

  render() {
    return (
      <div class='counter'>
        <p>{this.label}</p>
        <button type='button' disabled={this.empty}>-</button>
        <span id='count'>{this.count}</span>
        <button type='button'>+</button>
      </div>
    );
  }
}
```

`@element(tag, { root })` 为自定义元素命名并决定内容渲染到哪里：`'light'` 是默认值，渲染进 light DOM，因此文档级样式直接生效；`'shadow-open'` 与 `'shadow-closed'` 则挂载 shadow root。`@property({ reflect })` 声明响应式字段。attribute 是默认通道，名称取属性名的 kebab-case 形式（`attribute: 'my-name'` 可覆盖）；`attribute: false` 用于绝不能序列化进标记的值。派生值是 `computed(...)` 字段，编译器要求它必须是 `reflect: false, attribute: false`，因为派生值没有 attribute 通道。这两者背后都是 `signal()`——`computed()` 从它派生，`effect()` 订阅它；三者都由 `@openelement/element` 导出。

状态变化只会重渲染读取了该值的 Part。模板里写下的事件处理器（`onClick`、`onInput`）在 upgrade 时绑定；运行时不会用字符串做任何查找。服务端由 `renderDsd` 序列化同一个编译类，因此两种输出背后是同一份程序，而不是两个会互相漂移的渲染器。

## DSD

服务端输出是 Declarative Shadow DOM：组件标记装在 `<template shadowrootmode="open">` 里，由浏览器原生解析，不需要脚本。首屏即已样式化且可读——在任何客户端模块被拉取之前。组件 `static styles` 中声明的样式会被内联；对于 light root，服务端把它们包进 `@scope(<tag>)` 块，使页面规则不会泄漏到文档其余部分。

交互通过平台自身的 Custom Element upgrade 到达：生成的客户端入口定义该类后，它接管已经存在的 DOM，绑定编译模板声明过的处理器，并用宿主 attribute 填充 `@property` 字段。宿主 attribute 只还原字段——它们从不凭空造出事件。类始终没有加载的元素仍然渲染其标记，所以 JS 失败会退化为静态页面，而不是空白页面。

## Islands

island 是 islands 目录（默认 `app/islands`）下选择进入客户端投递的模块。它在所导出的组件旁声明投递方式：

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });
```

`hydrate` 决定浏览器何时 import 该模块——`'load'` 用于导航、主题这类首屏就需要的控件，`'idle'` 留给其余可以等待的，`'visible'` 给随着滚动进入视口才重要的组件，`'only'` 给跳过 SSR 的浏览器专用组件。构建会记录哪些 island 属于哪个页面，因此页面只引用它能用到的 chunk，永远到不了的 island 永远不会被拉取。

其余的一切——内容、布局、文档——都不需要客户端行为，保持静态 DSD，完全不发 JavaScript。这个分界就是运行时的全部故事：浏览器代码只存在于显式声明它的模块里。

## 另见

- [路由与数据](/zh/guide/routing-and-data)——这些元素之上的页面、loader 与 action。
- [快速开始](/zh/guide/getting-started)——创建项目的三条命令。
- [DSD 渲染](/zh/architecture/dsd)——服务端输出背后的平台契约。
