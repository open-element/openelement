---
title: '样式'
lede: 'shadow root 在 custom element 内部以 declarative shadow DOM 渲染，全局样式表触及不到；light root 完全没有边界，构建会改为给它的样式表加作用域。'
order: 5
---

## shadow 边界

当页面的标记就是它自己的组件模块时，它渲染在每页一个的 custom element 内（例如 `<article-page>`），而这个**页面根永远是 shadow root**：编译器发射 DSD 宿主模板，sidecar 声明 `root: 'shadow'`，服务端把页面内容放进 `<template shadowrootmode="open">` 里发送。页面自己的 `.css` 样式表作为 `<link>` 声明在同一份模板内，因此它的规则只活在 shadow root 里，别处没有。

文档级规则如 `.card { ... }` 或 `h1 { ... }` 被限定在 light DOM，永远到不了 shadow 页面内容——而且是静默的：没有 console 警告，也没有构建错误。这是边界在正常工作，不是需要绕开的 bug。

真正需要文档样式的页面不去对抗边界，而是放弃它，改用服务端函数形态：路由模块声明自己的组件并包进 `definePage`，那份标记*就是*文档内容，没有 shadow root 需要穿越。构建会不加作用域地投递该页面模块声明的样式表，因为页面不拥有宿主元素，而 `@scope` 包住一个永远不会出现的标签只会匹配不到任何东西。

对于 `app/components/` 或 `app/islands/` 下的嵌套组件，根是一个真实的选择：sidecar 声明 `root: 'shadow'`、`'closed'` 或 `'light'`，省略即 light。

## 什么能穿过边界

CSS 自定义属性会穿透 shadow 边界继承：在 `:root` 上定义的 `--text-primary`、`--brand` 等在页面内均可读取。`:host` 从内部为页面元素本身设样式；`::slotted()` 为投影进 slot 的 light DOM 子节点设样式。可继承的文本属性（`color`、`font-family`、`line-height`）同样能穿过。

**light** root 没有边界，因此构建给它最接近的诚实等价物：发射的资产包在原生 `@scope (<tag>)` 中，并把仅限 shadow 的选择器投影到 light 树——`:host` 变成 `:scope`，`:host(<sel>)` 变成 `:scope:is(<sel>)`，`::slotted(<sel>)` 变成 `slot > :is(<sel>)`。因此同一套作者选择器词汇仍然有意义，只是被组件自己的标签限定。

## 什么不能

文档样式表中的 class、id 与标签选择器永远无法匹配到 shadow root 内部。全局 reset（`* { margin: 0 }`）、排版规则与工具类体系因此只对文档外壳生效。这是封装的设计意图——也是最常见的第一天陷阱，因为人的第一反应就是全局样式表。

## 受支持的样式路径

其一：作者编写的 `.css` 文件，在组件的 sidecar 中声明一次：`styles: ['./name.css']`——相对说明符按模块解析，每种根形态一次声明、一次投递。样式表发射为按内容寻址的资产，绝不以 CSS 文本形式进入 JavaScript chunk。它如何到达组件取决于根形态，而每种形态恰好只有一条投递路径：

- **服务端渲染的 shadow** 组件在其 DSD 模板内用解析器可见的 `<link rel="stylesheet" data-oe-static-styles>` 声明该资产。这条 link *就是*投递：壳刻意不再额外采纳一份可构造的副本，因为同一资源的两条投递会把同样的规则应用两次。
- **light root** 组件的样式表投递到文档，并包在其标签的 `@scope` 里（见上）。
- **light 页面模块**——路由模块自己的声明，即服务端函数形态——**不加作用域**地投递到文档，因为页面不拥有宿主元素。
- **纯客户端 island**（`ssr: false` 或 `hydrate: 'only'`）没有模板、也完全没有服务端渲染，因此编译器发射同一说明符的真实模块图 import，生成的壳把得到的样式表对象采纳进它创建的根，并在断开时释放。仍然只有一次声明，不是第二条通道。

只有位于项目根之外、且没有任何客户端图能发射的包内样式表，才会为该次渲染退回内联的内存 `StyleSheet`，构建会把这种回退报告为一条点名修复办法的警告（给所属包一个客户端入口）。其二：来自所配置 CSS provider 的工具类（默认 Tailwind preset；UnoCSS 经 style-provider 端口接入）——编译器准入静态 class token，构建把它们发射进 light root 的文档样式表与 shadow 组件的共享组件样式表，因此表现写在标记里，JavaScript 里不携带任何 CSS 文本。其三：在 `:root` 上定义的 CSS 自定义属性——它们会穿透 shadow 边界继承。文档级 `<link rel="stylesheet">` 与 head 里的 `<style>` 不会作用于 shadow 内容；编译模板中的裸 `<style>` 标签会被拒绝。

### 文档级样式表（不会生效）

```css
/* app/styles.css — linked in the document head */
.card { border: 1px solid silver; }  /* never matches shadow content */
```

### 组件 `.css` 文件（生效）

```css
/* app/components/example-page.css — the sheet is a file, not a JS string */
:host { display: block; }
.card {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 1rem;
  color: var(--text-primary);
}
```

```tsx
// app/components/example-page.tsx — compiled by the open:compiled-element transform
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'example-page',
  // The boundary is the whole point of this sheet: a document-level `.card`
  // rule cannot reach in, and this file's `.card` rule cannot leak out.
  root: 'shadow',
  // A specifier resolved against THIS module: the build emits it as a
  // content-addressed asset and declares it inside the DSD template, so no CSS
  // text is ever embedded in the component's JavaScript chunk.
  styles: ['./example-page.css'],
});

export default function ExamplePage() {
  return <section class='card'>Themed through custom properties.</section>;
}
```

`styles` 只接受相对的 `.css` 说明符：裸包说明符、URL 或绝对路径、非 `.css` 条目都会以 `OE_ISLAND_DESCRIPTOR_SHAPE` 失败；服务端渲染的 shadow 组件若没有编译 DSD 宿主生产者可在其中声明样式表，会以 `OE_ISLAND_STYLE_SHADOW_UNWIRED` 失败；生成通道不编译的模块会以 `OE_ISLAND_STYLE_LANE_UNSUPPORTED` 失败，而不是被静默地留在无样式状态。

## 自定义属性实战

starter 在 `:root` 上定义了一层设计令牌（颜色、字体、间距），正是为了让页面可以完全通过自定义属性来主题化。优先用令牌做主题；组件自身的布局与排版再交给组件的 `.css` 样式表。

## 另见

- [设计体系](/zh/architecture/design-system)——这些令牌与语义角色如何组织。
- [核心概念](/zh/guide/core-concepts)——这里引用的根形态与 sidecar 的 `properties` 表。
- [Islands 与 SSR](/zh/guide/islands-and-ssr)——组件什么时候才需要 shadow root。
