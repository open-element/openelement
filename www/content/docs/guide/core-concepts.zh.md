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

### shadow root 行为：delegatesFocus

`@element('my-dialog', { root: 'shadow-open', delegatesFocus: true })` 会生成对应的 class static，因此挂载的 shadow root 以 `delegatesFocus` 创建。聚焦进入宿主时会被委派到 shadow 树中的第一个可聚焦元素，且宿主自身匹配 `:focus`——这正是 dialog、menu 或复合字段这类包装组件无需手写 focus trap 即可键盘可用的原因。它只对 shadow root 生效（`'light'` root 没有可配置的 shadow root），且编译器只接受字面量：`@element(..., { delegatesFocus: <布尔字面量> })`，其他写法以 `OEC9002` fail closed。

### 表单参与：formAssociated

`@element('my-field', { root: 'shadow-open', formAssociated: true })` 会生成 `static formAssociated = true`，运行时在连接时据此通过 `ElementInternals` 把宿主关联到所在的 form。宿主因此成为一个表单控件：出现在 `form.elements` 中，参与提交与 `form.reset()`，并具备 `form`、`name`、`value` 语义。由于关联是平台契约而非框架契约，请把交互控件放在 shadow root 内，并让宿主自身的属性承担面向表单的 name 与 value；运行时不会替你发明表单值。与 `delegatesFocus` 一样，该选项只接受布尔字面量，不支持的 `@element` 选项以 `OEC9002` fail closed。

### attribute 转换：converter

`@property({ reflect: false, type: Number })` 与 `@property({ reflect: false, converter: Number })` 对编译器含义相同：converter 指明宿主 attribute 依哪种内建转换被解析，取值只能是 `String`、`Number`、`Boolean`、`Array` 或 `Object`——其他取值以 `OEC9021` fail closed。`type` 是声明写法，在组件契约里读起来最清楚；`converter` 是同一份声明在 Lit 风格代码中使用的名字，被接受是为了让移植过来的元素不必改写。`Boolean` 遵循平台 attribute 惯例：存在即 `true`，不存在即 `false`，因此布尔属性反映为空 attribute 而不是 `"true"`。两者都不给时，converter 由字段初始值推断（`count = 0` → `Number`，`label = ''` → `String`，`items: string[] = []` → `Array`），所以带字面量默认值的类型字段本身就已经声明了自己的通道。

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

## 条件区域与语法边界

条件区域（conditional region）把 JSX 里的条件编译进 Part Program，而不是把一段比较逻辑随 JavaScript 下发。编译器恰好接受以下形式，每条都是一个 `@property` 与一个字面量的比较：

- `{this.count > 5 && <p>over</p>}` —— 用 `>`、`>=`、`<`、`<=` 与有限数字比较（信号值经 `Number()` 强制转换）。
- `{this.status === 'pending' && <Spinner />}` —— 与数字、字符串或布尔字面量做严格 `===` / `!==`。相等判断刻意保持严格：`1` 永远不等于 `"1"`。
- `{this.ready && <Dashboard />}` 与 `{!this.ready && <Spinner />}` —— 裸真值判断，可取反，按 `Boolean(value)` 求值。

三元表达式是同一个测试的双分支写法：`{this.status === 'pending' ? <Spinner /> : <Done />}`。

语法为什么有界、哪些东西刻意留在界外：条件必须能降级成一个可序列化的测试，让服务端序列化器、全新挂载与既有 DOM 接管（claim）三种模式在不下发 JavaScript 的前提下得出完全一致的求值——这正是三种模式字节一致的前提。属性之间的比较（`this.count > this.limit`）、宽松相等（`==`）以及任意一侧的算术都在语法之外，构建时以 `OEC9013` fail closed；惯用做法是用一个计算好的 `@property` 或 getter 承载已经算完的布尔值，再用裸真值形式去测试它。

其余的一切——内容、布局、文档——都不需要客户端行为，保持静态 DSD，完全不发 JavaScript。这个分界就是运行时的全部故事：浏览器代码只存在于显式声明它的模块里。

## 另见

- [路由与数据](/zh/guide/routing-and-data)——这些元素之上的页面、loader 与 action。
- [快速开始](/zh/guide/getting-started)——创建项目的三条命令。
- [DSD 渲染](/zh/architecture/dsd)——服务端输出背后的平台契约。
