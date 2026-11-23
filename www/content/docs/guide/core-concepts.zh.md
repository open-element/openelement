---
title: '核心概念'
lede: '核心模型是 standards-first：由作者编写的函数组件、声明式渲染、文件路由与可选 islands。'
order: 10
---

## 组件模型

一个组件就是一个模块：它默认导出一个函数，旁边放着一份 `defineIslandConfig` sidecar。编译器把这一对降级为一个 **Native Custom Element**——一个浏览器可以 upgrade 的真实构造器——所以产物是标准的自定义元素，既没有虚拟 DOM 运行时，也没有解释器发到浏览器。编译器无法降级的写法会在构建期以带码诊断失败，而不是回退到某条运行时渲染路径。

sidecar 承载函数表达不了的两个事实：自定义元素的 `tag`，以及内容渲染所在的 `root`（`'light'`、`'shadow'` 或 `'closed'`）。响应式输入只声明一次，就在 sidecar 的 `properties` 表里，然后在组件中以普通的带类型 props 读取。

```tsx
import { computed, signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'my-counter',
  root: 'shadow',
  // 这里的每一行就是一个声明的属性：标签、attribute 通道与初始值
  // 全都住在这一张表里。
  properties: {
    count: { reflect: true, default: 0 },
    label: { default: '' },
  },
});

export default function MyCounter(props: { count: number; label: string }) {
  // 局部状态是 setup 作用域里的信号；运行时为元素的整个生命周期保留
  // 这份记录，所以重新连接会重读同一个来源。
  const clicks = signal(0);
  const heading = computed(() => `${props.label} (${clicks.value})`);

  return (
    <div class='counter'>
      <p>{heading.value}</p>
      <button type='button' onClick={() => { clicks.value = clicks.value + 1; }}>+</button>
      <span id='count'>{props.count}</span>
    </div>
  );
}
```

attribute 是默认通道，名字取自属性名的 kebab-case 形式；`attribute: false` 让那些绝不能序列化进标记的值所在的行退出 attribute 通道，而 `reflect: true` 会把属性变更写回 attribute。只有 `string`、`number` 与 `boolean` 行被承认——没有 converter，也没有数组或对象的线上格式——所以非原语行必须声明 `attribute: false`，经 props 投影器抵达。派生值是一个 `computed(...)`，在使用它的地方以 `.value` 读取。`signal()` 是两者背后的底座：`computed()` 从它派生，`effect()` 订阅它；三者都由 `@openelement/element` 导出。

一次状态变化只刷新读取了该新值的那些槽位与属性。模板里写下的事件处理器（`onClick`、`onInput`）在元素 upgrade 时绑定；运行时不会用字符串做任何查找。服务端则由 `renderToString` 序列化同一个编译组件，因此两种输出背后是同一份程序，而不是两个会互相漂移的渲染器。

### shadow root 行为：delegatesFocus

`defineIslandConfig({ root: 'shadow', delegatesFocus: true })` 声明一个带 `delegatesFocus` 的 shadow root。聚焦进入宿主时会被委派到 shadow 树中的第一个可聚焦元素，且宿主自身匹配 `:focus`。它买到的是复合控件焦点体系中的「进入」那一半，也只有那一半：初始焦点落在控件希望的位置，而不是宿主元素本身。它不是 focus trap——Tab 仍会离开宿主、走向文档中的下一个可聚焦项——也不是键盘模型。必须把焦点关在里面的 dialog、响应方向键的 menu、管理 roving tabindex 的复合字段，这些仍然要在委派之上自己写。它只对 shadow root 生效，因此 `root: 'light'` 旁边写 `delegatesFocus: true` 会以 `OEIR_GENERATED_ELEMENT_DELEGATES_FOCUS_WITHOUT_SHADOW` fail closed。

### 表单参与：formAssociated

`defineIslandConfig({ root: 'shadow', formAssociated: true })` 在连接时通过 `ElementInternals` 把宿主关联到周围的表单。宿主因此成为一个表单控件：出现在 `form.elements` 中，参与提交与 `form.reset()`，并具备 `form`、`name`、`value` 语义。表单值就是名为 `value` 的那个声明过的字符串属性，可选的布尔属性 `required` 与 `disabled` 则启用「必填/缺值」镜像与 fieldset 禁用态——这里刻意没有单独的 `formValue` 字段，因为唯一来源就是那一个声明过的属性。由于关联是平台契约而非框架契约，请把交互控件放在 shadow root 内，并让宿主自身的属性承担面向表单的 name 与 value；运行时不会替你发明表单值。

### 一行该走哪条属性通道

sidecar 的行就是声明本身；TypeScript 类型表达不了这些平台事实，所以它也不去尝试。`reflect: true` 把属性写入镜像到 attribute，那需要一条 attribute 通道——`reflect: true` 配上 `attribute: false` 会被拒绝。省略 `attribute` 会推导出 kebab-case 名字，`attribute: false` 声明一条纯 property 通道，写一个字符串则给它改名（会转小写，且必须是安全的 HTML attribute 名）。原语行省略 `default` 时，壳会套用该类型的零值；非原语行必须给出显式的字面量默认值，因为没有零值可猜。

## DSD

light DOM 是一种 root 选择，而不是被 shadow 覆盖掉的默认值。sidecar 声明 `root: 'shadow'` 或 `'closed'` 的组件以 Declarative Shadow DOM 交付：组件标记装在 `<template shadowrootmode="open">` 里，由浏览器原生解析，不需要脚本。无论哪种方式，内容都可以先绘制、先可读——在任何客户端模块被拉取之前；处理器与信号在元素 upgrade 之后才绑定。

交互通过平台自身的 Custom Element upgrade 到达：生成的客户端入口定义该元素后，它认领已经存在的 DOM，绑定编译模板声明过的处理器，并用宿主 attribute 填充声明过的属性。宿主 attribute 只还原属性——它们从不凭空造出事件。模块始终没有加载的元素仍然渲染其标记，所以 JS 失败会退化为静态页面，而不是空白页面。

light root 组件把子节点渲染进文档本身，因此页面样式直接抵达它们，中间没有任何 shadow 边界。这也正是 light root 组件不能充当生成的页面根的原因：服务端那份 shadow 模板由编译器的宿主包装器产出，而 light root 根本没有它。因此 light 页面采用服务端函数形态——路由模块自己导出的组件，包在 `definePage` 里。

## Islands

island 是 islands 目录（默认 `app/islands`）下选择进入客户端投递的模块。它在与所导出组件同一份 sidecar 里声明投递方式：

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });
```

`hydrate` 决定浏览器何时 import 该模块——`'load'` 用于导航、主题这类首屏关键控件，尽早导入并 upgrade，`'idle'` 留给其余可以等待的，`'visible'` 给随着滚动进入视口才重要的组件，`'media'` 给按能力门控的重模块（chunk 只在 island `media` 字段声明的查询匹配期间拉取），`'only'` 给跳过 SSR 的浏览器专用组件。构建会记录哪些 island 属于哪个页面，因此页面只执行它实际激活的 island；页面的 manifest 同时决定是否提前 `modulepreload` 共享的 element runtime，而永远到不了的 island 自身 chunk 仍然延迟获取。

island 仍然是一个组件、一份程序：不是 island 的页作用域组件只在服务端渲染，从不 upgrade，因此运行时没有生命周期、处理器或 context。任何必须在浏览器里响应的东西都采用 island 形态，而那份声明就是全部的投递决定。

## 条件块与表达式边界

条件把 JSX 里的条件降级为一个编译后的 `when` 块，而不是把一段比较逻辑发给运行时解释器。每个分支必须是一个 JSX 元素或 `null`——文本分支与嵌套三元没有可表示的分支形状，会以 `OEC9042` fail closed。

条件本身是声明过的 props、信号与 import 之上的普通表达式，就在块所在的位置求值：

- `{props.count > 5 && <p>over</p>}` —— 一次顺序比较。
- `{props.status === 'pending' && <Spinner />}` —— 与模块能读到的任意表达式做相等判断。
- `{props.ready && <Dashboard />}` 与 `{!props.ready && <Spinner />}` —— 真值判断，可取反。

三元表达式是同一个测试的双分支写法：`{props.status === 'pending' ? <Spinner /> : <Done />}`。两个分支都保持为 JSX 元素，所以纯文本三元是唯一要避开的那一种形态——请用 `computed(...)` 推导文本，再插值 `{value}`。

边界为什么划在这里：一个分支必须降级成一个可序列化的测试，让服务端序列化器、全新挂载与既有 DOM 认领三方能得出完全一致的求值。这正是三种路径字节一致的前提，也是受约束的是*分支形状*、而不是条件里的算术的原因。

### 列表与交互边界

键控列表（`each` 块）复用已经建好的 DOM：`props.rows.map((row) => <li key={row.id}>{row.label}</li>)`。运行时从声明的 key 字段推导每项的身份，并把新数组与已有条目做 diff：key 未变的保留节点，新 key 建行，消失的 key 释放。

由此引出两条边界，两条都是刻意的：

- **事件通道留在列表模板之外。** 写在逐条目模板*内部*的处理器需要一个逐条目更新钩子，而本版本不提供；编译器会以 `OEIR_LEAF_UNSUPPORTED_ATTRIBUTE` 拒绝它，而不是绑定一个会读到过期条目的处理器。请把处理器放在外围元素上，让它通过列表自己声明的状态去读条目。
- **身份由 key 决定，取值来自 item 对象。** 条目的槽位始终是它当前持有的那个 item 对象的投影；当一次更新交回**同一个对象引用**时，它的槽位本就已经是那个对象的投影，整段槽位遍历直接跳过。因此在原地重新赋值字段（`rows[3].label = …`）改的是一个运行时没有任何理由重读的对象——这与「`signal()` 持有对象时按引用比较」是同一条边界。请产生新 item（`{ ...row, label }`）或新数组。这是性能边界而非疏漏：正因如此，常见更新量才与实际变化量成正比。

## 测量更新

仓库内 js-framework-benchmark 基准已于 2026-10-03 移除；上游基准 lane 见 fork。

## 另见

- [路由与数据](/zh/guide/routing-and-data)——这些组件之上的页面、loader 与 action。
- [快速开始](/zh/guide/getting-started)——创建项目的 {{QUICKSTART_COMMAND_COUNT}} 条命令。
- [DSD 渲染](/zh/architecture/dsd)——服务端输出背后的平台契约。
