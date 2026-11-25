---
title: 'Islands 与 SSR'
lede: 'SSR 与 DSD 提供文档基线。Islands 在声明的边界上添加客户端行为。'
order: 90
---

## Light DOM、DSD、SSR 与 islands

本指南反复出现的这些术语不是互相竞争的默认值：它们回答两个不同的问题——**组件的标记落在哪里**（root 选择：light DOM 或 shadow DOM），以及 **HTML 到达浏览器之后发生什么**（DSD、SSR、islands）。

| 术语 | 它是什么 | 它决定什么 |
| --- | --- | --- |
| Light DOM | 组件把子节点渲染进文档树本身 | 没有样式边界：页面样式直接作用于子节点 |
| Shadow DOM | 组件渲染进自己拥有的 shadow root | 有样式边界：外部的类选择器到不了组件的子节点 |
| DSD（Declarative Shadow DOM） | 一种平台 HTML 格式，用标记携带 shadow root——`<template shadowrootmode="open">` 由浏览器原生解析 | shadow 内容在任何客户端 JavaScript 加载之前就已存在，且不涉及任何框架 |
| SSR | 在服务端把页面渲染为 HTML：静态路由在构建期，`renderIntent: { mode: 'dynamic' }` 路由按请求 | 首个响应里包含什么 |
| Islands | 按模块选择进入客户端投递，声明在组件旁 | 组件的 chunk 是否、以及何时被拉取、其行为何时绑定 |

**Root：light 还是 shadow。** 每个生成元素都由默认导出的函数组件与 `defineIslandConfig` sidecar 组成。sidecar 的 `root` 字段决定组件内容的渲染位置：`light` 是默认值，`shadow` 声明 open shadow root，`closed` 声明封装的 shadow root。shadow root 都通过 Declarative Shadow DOM 交付；两种情况下都由同一编译器处理，root 选择改变的是样式可达范围，也不决定组件是否交互。

**DSD 是浏览器格式，不是客户端框架。** Declarative Shadow DOM 是平台 HTML 格式：`<template shadowrootmode="open">` 由 HTML 解析器解析成真正的 shadow root，不需要脚本；closed root 使用 `shadowrootmode="closed"`。生成的 HTML 用 DSD 作为 shadow-root 组件的线上格式，因此标记在任何客户端模块被拉取之前就可读、已样式化。DSD 与交互性无关：DSD 组件也完全可以保持静态。

**先服务端 HTML，再浏览器 upgrade。** 服务端把编译组件序列化为 HTML——静态路由在构建期，动态路由按请求，两边是同一份程序。light DOM 本来就在文档里；DSD 被解析成 shadow root。对于已声明的 island，生成的客户端模块会定义 Custom Element，浏览器随后 upgrade 它：编译后的 claim 对已经存在的 DOM 应用同一份程序，并绑定模板声明过的处理器。sidecar 的 `properties` 项定义宿主可访问的属性与 attribute 通道。不会重建树，不会用字符串查找绑定，也不会从 `data-*` attribute 合成事件。没有客户端模块的组件会保留服务端渲染的标记与样式。

**Islands 决定的是“在哪、何时”，不是渲染模式。** island 是通过 `defineIslandConfig({ hydrate, ssr, dsd })` 选择进入客户端投递的模块；`hydrate` 选择浏览器何时 import 它——`load`、`idle`、`visible`、`media` 或 `only`——构建会逐页记录它实际到达哪些 island，所以页面只拉取自己 manifest 里点名的 chunk。island 与静态组件都使用生成的函数组件形式，可以渲染到 light DOM 或 DSD shadow root；`ssr` 与 `dsd` 说明服务端是否序列化它，`only` 则跳过 SSR。island 增加的只是必须在浏览器里运行的那部分：状态、处理器、生命周期。

整条路径，一行一个阶段：

```text
1  请求
   │
   ▼
2  服务端渲染——静态路由在构建期，
   动态路由按请求
   │  产出
   ▼
3  HTML——light DOM，或声明了 shadow root
   时的 DSD
   │
   ▼
4  浏览器解析——DSD 无需脚本就变成真正
   的 shadow root
   │
   ▼
5  Custom Element upgrade——只为生成的
   客户端模块随 island 发布的元素运行：
   claim 复用既有 DOM
   │
   ▼
6  交互——island chunk 按其声明的策略
   加载，随后状态与处理器开始运行
```

步骤 1–4 复用的都是服务端已经产出的内容：不需要任何客户端工作，HTML 本身就是页面。步骤 5 只为已声明 island 发布的生成客户端模块加载代码，而且复用既有 DOM 而不是重建。步骤 6 是唯一与 island 专属的步骤：它只在模块声明了 `hydrate` 策略的地方运行，没有任何交互 island 的页面不会执行自己页面的 island chunk。

需要说明的边界：“不需要客户端工作”指的是渲染和阅读页面不需要，而不是永远不执行任何字节——只要应用声明了任意 island 或增强表单，静态页面上仍会运行一个很小的全应用 claim 引导脚本；而 manifest 里带可客户端激活 island 的页面还会预加载共享的 element-runtime chunk（[小运行时](#小运行时)会给这两项定价）。至于“不重建”，它描述的是 upgrade 路径，而不是“永远不更新”的承诺：upgrade 之后，signal 变化只会重渲染读取该值的那些编译 Part。

## 服务端优先

默认情况下每个路由都在构建时渲染为 HTML。输出是普通的声明式标记：内容组件默认序列化为 light DOM，声明了 shadow 模式的组件则序列化为浏览器无需脚本即可解析的 shadow root；样式表被内联（light root 用 `@scope(<tag>)` 限定作用域），文档在任何客户端模块被拉取之前就已样式化且可读。因此只要标记是静态的，即使网络很慢、模块加载失败或 JavaScript 被禁用，页面依然是静态的。

页作用域组件——位于 islands 目录之外、以标签组合进页面的编译模块——只做服务端渲染，这是契约而非降级。它们的组件代码不会随客户端发布：浏览器收到的是按 sidecar root 序列化的 HTML（light DOM 或 DSD），且永远不会升级它们，因此它们在运行时没有生命周期、事件处理器或 context。任何必须在浏览器中响应的东西都采用 island 形态，并只为那条边界付费。每种形态如何被发现见[编译模块文法](/zh/guide/compiled-grammar)——页作用域组件经路由导入链以默认导出被发现，island 经页面/岛模板扫描被发现、无需导入。

确实无法预渲染的页面声明 `renderIntent: { mode: 'dynamic' }`，通过生成的 `dist/server` 入口按请求渲染。它仍是同一个编译程序——只是由 loader 而不是构建来提供数据——所以把页面在 static 与 dynamic 之间移动，改变的是渲染位置，而不是标记的产生方式。保留静态 GET 但导出 action 的页面照旧保持预渲染，只有它的 POST 会分派到服务器。

## 声明的 islands

客户端行为按模块显式选择，并且写在 metadata 里，从不靠推断。island 在所导出的组件旁声明投递方式：

```tsx
import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'profile-counter',
  hydrate: 'visible',
  ssr: true,
  dsd: true,
  root: 'shadow',
});

export default function ProfileCounter() {
  const count = signal(0);
  return (
    <button type='button' onClick={() => (count.value = count.value + 1)}>
      Views: {count.value}
    </button>
  );
}
```

默认导出是函数组件；`defineIslandConfig` sidecar 声明它的 tag、root、宿主属性与投递策略。`hydrate` 决定模块何时被 import——`'load'` 用于首屏关键控件，尽早导入并升级，`'idle'` 用于可以等待的工作，`'visible'` 用于接近视口才重要的组件，`'media'` 用于按能力门控的加载（chunk 只在 island `media` 字段声明的查询匹配期间拉取），`'only'` 用于跳过 SSR 的浏览器专用组件。`'none'` 仅交付服务端 HTML：服务端照常序列化该组件，但构建永不发射它的 chunk——组件零客户端 JavaScript，同时保留 manifest 里的 island 记录。`ssr` 与 `dsd` 说明服务端是否序列化该组件。构建会逐页记录结果，因此页面永远到不了的 island 永远不会被执行。

upgrade 本身是浏览器的 Custom Element 机制。编译生成的服务端渲染器输出 Declarative Shadow DOM。浏览器定义生成元素之后，claim 函数会把模板声明的处理器绑定到现有 DOM。attribute-backed 值来自 sidecar 的 `properties` 声明。不会重建树，不会用字符串查找绑定，也不会从 attribute 合成事件。

## 迟到宿主

已声明 island 的宿主不必在页面的 ready 扫描时就已存在。第三方组件、另一个 island 的渲染、或应用在一次异步请求后运行的代码，都可能在之后创建它——在 open shadow root 内，或在 light DOM 里。只要本页仍有「已声明但工厂尚未被消费」的 island，调度器就会按有界预算重跑同一套页面范围扫描：每个 3000 ms 窗口最多 6 次尝试，最多 3 个窗口且只有 island 模块仍在加载时才续期，并在每次探测入口与每个续窗入口检查 9000 ms 绝对上限。因此被挂起或节流的页面无法在上限之后才激活宿主。预算内找到的宿主会沿其声明的策略激活，并触发同样的 `open:ready` 事件；调度器只是重新询问宿主是否存在，真正做出激活决定的仍然只有 `load()` 的宿主门——「页面永远到不了的 island 永远不会被拉取」这条承诺不变。

只有一次机会的两种策略也在覆盖范围内。`'idle'` 页面的空闲尝试在无宿主时执行过后，deferred 步骤会启动同一套有界查找（加载本身仍走浏览器的空闲调度）；`'media'` 页面的查询在宿主仍缺失时翻为匹配，则查询的 change 监听器会启动它。若上限耗尽而仍有已声明 island 未激活，调度器会在 `document` 上派发一次信息性的 `CustomEvent('open:island-host-timeout')`，`detail.pending` 会点名这些 tag。该事件是提示而非错误——页面声明了本页不使用的 island 是合法的——之后的显式 rescan 或媒体变更仍可激活这些 tag。

## Light islands

island 的 root 在 `defineIslandConfig` sidecar 中声明：`root: 'light'` 会把子节点放入文档树；`root: 'shadow'` 或 `root: 'closed'` 则通过 Declarative Shadow DOM 交付，分别形成 open 或 closed shadow 边界。这个设置也决定组件的样式边界：

```tsx
export const openElement = defineIslandConfig({
  tag: 'status-panel',
  hydrate: 'visible',
  root: 'light',
});
```

sidecar 是生成元素编译器与 Router island 投递路径共同使用的 root 声明，因此构建各阶段读取的是同一份 tag 和 root 信息。

生成的 light root 在 SSR 时可以把具名或默认子节点投影到对应插槽，也会投影条件分支或列表当前选中的输出。服务端 HTML 会正确呈现；未展开的嵌套宿主则保留原始 `oe:when` 和 `oe:each` 回退标记。目前不支持通过生成的 light root 进行交互式投影：父组件与子组件的 claim 都需要接管同一批节点。SSR 会给这类宿主写入内部标记，任一 island 升级时都会在 claim 前以 `OEIR_LEAF_UNSUPPORTED_LIGHT_SLOT_PROJECTION` 失败。如果条件或列表起始为空、之后可能生成子节点，也会触发同一保护。交互式投影请让子组件使用 shadow root 与原生 `<slot>`；否则应让这段组合只做服务端渲染。

Light island 是 utility-first 样式的实际路径。shadow root 是一道样式边界——在其外部编写的类选择器到不了组件的子节点——所以 shadow island 需要编译器侧的 utility 提取来跨越它；而 light island 的子节点是普通文档节点，页面已编译的样式表本就覆盖它们。代价是放弃了 shadow root 本会提供的隔离。

## 小运行时

发出的内容是页面声明的那组 island chunk 加上生成的 claim 代码——不存在每个页面都必须加载的框架运行时。没有任何交互模块的页面不执行任何 island chunk；只要应用存在任意 island（或增强表单），一个约 2 KB（gzip）的 claim 引导脚本是这类页面唯一的执行脚本。“被拉取”与“被执行”是两种不同的成本：读者沿着链接跳转前，目标页面的 chunk 可能已被预取；而只要页面的 manifest 里有可客户端激活的 island，构建就会为共享的 element-runtime chunk 加上 `modulepreload`（在 www 构建里约 29 KB gzip），即使该页所有 island 都是 `'visible'`——runtime 会提前拉取并解析，而 island 自己的 chunk 仍推迟到宿主激活时才取。

这个预算正是静态表面重要的原因。凡是能用标记表达的——内容、布局、文档，甚至样式完整、看起来可交互的组件——都应保持静态 DSD；island 只留给状态与浏览器 API。两种情况下的组件代码完全相同，所以这个决定是一次声明而不是一次重写，也可以在组件真实需求明确后再回来调整。

## 另见

- [Island Hydration](/zh/architecture/islands)——四层组件模型、claim 的工作原理，以及同一套边界在组件模型上的描述。
- [DSD 渲染](/zh/architecture/dsd)——服务端输出背后的平台契约。
