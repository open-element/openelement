---
title: '编译模块文法'
lede: '生成元素范式的创作文法：编译器允许什么进入一个组件模块，以及它拒绝什么，而不是在运行时回退。'
navLabel: '模块文法'
order: 15
section: 'Core'
---

每个编译组件都是一个模块：它默认导出一个函数组件，旁边放着一份 `defineIslandConfig` sidecar。编译器把这一对降级为一个 Native Custom Element——一个构建作者所写树的构造器，外加（对 shadow root 而言）服务端渲染所用的宿主生成器。这份文法是封闭的：编译器无法降级的写法会在构建期以带码诊断失败，而不是把运行时解释器发到浏览器。本页即速查表——先一表列出全部法则，再逐条给出可用示例与失败形态。

类范式已在本版本中删除。`extends OpenElement` 与 `@element(...)` 类都不再是创作面：`OpenElement` 与 `ErrorBoundary` 不再导出，也没有任何兼容垫片替代它们。`element` 与 `property` 装饰器仍以惰性的空操作替身存在，好让旧模块能被单元测试或配置加载*求值*，但没有任何编译器会编译它们——仍然带着它们的模块不会被任何范式接纳。

## 法则一览

| 法则 | 编译器承认 | 编译器拒绝 |
| --- | --- | --- |
| 一模块一组件 | 一个默认导出的函数组件加上它的 `defineIslandConfig` sidecar | 类的默认导出，或没有默认导出函数的模块（本范式不接纳它）；默认导出的函数不是组件（`OEC9040`） |
| sidecar 就是身份 | `tag`、`root: 'light' \| 'shadow' \| 'closed'` | 已退役的写法 `'shadow-open'` / `'shadow-closed'`（`OEIR_GENERATED_ELEMENT_ROOT_INVALID`） |
| props 是一张声明的表 | 带类型的 props 形参，其成员与 `properties` 一一对应 | 没有 sidecar 行的类型成员，或没有类型成员的 sidecar 行（`OEIR_GENERATED_ELEMENT_PROPERTY_MISMATCH`） |
| 只有原语走 attribute 通道 | `string`、`number` 与 `boolean` 行 | 未声明 `attribute: false` 的数组、对象或 `trustedHtml` 行（`OEIR_GENERATED_ELEMENT_PROPERTY_INVALID`） |
| 模块作用域只有 import、sidecar 和组件 | import、`export const openElement`、默认导出 | 组件正文会读取的模块局部 `const` 或 `function`（`OEIR_GENERATED_ELEMENT_UNBOUND_BINDING`） |
| setup 声明状态，只有一个 return | `signal(...)`、`computed(...)`、`const` 绑定、箭头辅助函数、内置调用、最终唯一一个 `return` | 嵌套的 `function` 声明、`if` 语句或第二个 `return`（`OEC9041`） |
| 正文返回一个 JSX 元素 | 恰好一个被返回的 JSX 元素 | 字符串或其它非 JSX 返回值（`OEC9040`） |
| JSX 按标签组合 | 内置标签、自定义元素宿主、同一模块内声明的组件 | 从其它模块导入的组件（`OEIR_LEAF_UNKNOWN_COMPONENT`） |
| 属性是 JSX 表达式 | 字面量值，以及动态的 `attribute` / `boolean` / `property` / `event` / `ref` 通道 | 展开（`OEC9042`）；动态的 `class` 或 `style` 通道（`OEIR_LEAF_UNSUPPORTED_ATTRIBUTE`） |
| 分支是 JSX 或 null | `{cond ? <b/> : <i/>}` 与 `{cond ? <b/> : null}` | 文本分支、嵌套三元（`OEC9042`） |
| `innerHTML` 不在本范式内 | 什么都不承认——见下文 | 任何 `innerHTML` sink（`OEC9044`） |
| 生命周期是根 setup 里的内置调用 | 根正文里的 `onConnect`、`onDispose`、`onPropertyChange`、`onError` | 没有保留正文持有的 hook（`OEIR_LEAF_INVALID_ARTIFACT`） |
| 页面是服务端函数 | 路由模块自己导出的组件，由 `definePage` 包起来 | return 前的局部 `const`、事件处理器、作为 JSX 的导入组件（`OEC9031`、`OEC9032`） |

## 一模块一组件

一个模块就是一个组件。组件是默认导出，sidecar 名为 `openElement`。共享的辅助函数、表与常量住在普通模块里并被导入——编译模块的正文可以读取 import，但不能读取本模块自己声明的标识符，所以局部 `const` 不是私有辅助函数。

```tsx
// app/islands/my-card.tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'my-card',
  root: 'shadow',
  hydrate: 'idle',
  ssr: true,
  properties: { title: { default: '' } },
});

export default function MyCard(props: { title: string }) {
  return (
    <article>
      <h2>{props.title}</h2>
      <slot></slot>
    </article>
  );
}
```

```text
// 不接纳、不编译：类的默认导出属于已退役的范式，
// 而没有默认导出函数的模块不是本范式的组件
export default class MyCard { render() { return <article></article>; } }
export function MyCard() { return <article></article>; }

// 拒绝：默认导出的函数返回非 JSX 值 —— OEC9040
export default function MyCard() { return 'not a component'; }
```

## sidecar 声明身份与 root

这里没有基类要导入，也没有装饰器要施加。身份就是数据：sidecar 的 `tag` 命名自定义元素，`root` 选择它的内容渲染到哪里。`'shadow'` 是一个开放的声明式 shadow root，`'closed'` 是封装起来的那一个，`'light'` 则渲染进文档树。Alpha15 的两种写法 `'shadow-open'` 与 `'shadow-closed'` 已经不存在——闭合性现在是独立的 `'closed'` 取值，而不再是 `-open`/`-closed` 后缀，因此移植过来的取值必须重写。

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  // 身份住在这里，而不是某个装饰器上：本范式把这张表当作
  // 这个元素的完整声明来读。
  tag: 'my-badge',
  root: 'light',
  properties: { tone: { default: 'neutral' } },
});

export default function MyBadge(props: { tone: string }) {
  return <span class='badge'>{props.tone}</span>;
}
```

```text
// 拒绝：已退役的 root 写法 —— OEIR_GENERATED_ELEMENT_ROOT_INVALID
export const openElement = defineIslandConfig({ tag: 'my-badge', root: 'shadow-open' });
```

`root` 还决定构建能为这个模块产出什么。shadow root 会得到一份编译器自有的宿主生成器（`<Name>__ssrHost`），服务端把它渲染进 `<template shadowrootmode>`；light root 则什么都没有，因为没有模板可产出。正是这种不对称，使得 light root 组件可以被嵌套进页面、却不能自己充当生成的页面根——light 的*页面*要使用下文的服务端函数形态。

```text
// 产出的形态，shadow root：一个只含内容的 <Name>__ssr 加一个宿主生成器
export function MyCard__ssrHost(props, lightChildren) { … }

// 产出的形态，light root：根本没有宿主生成器
// （没有什么可包裹——子节点就是普通的文档节点）
```

## props 是一张声明的表

组件的输入只经过一条通道：带类型的 `props` 形参。它的每个成员都必须在 sidecar 里有对应的 `properties` 行，而每一行也必须点名一个类型成员。这个形参是有名字、非泛型、就地书写的对象类型——解构形参、rest 形参、可选成员，以及导入的或泛型的类型，全都在文法之外：编译器读不懂的形状会悄悄从属性通道里掉出去。

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'my-counter',
  root: 'shadow',
  properties: {
    // 原语行省略默认值时会取其类型的零值；写出它，是为了记录
    // 服务端与浏览器共同起步的那个种子值。
    start: { default: 0 },
  },
});

export default function MyCounter(props: { start: number }) {
  return <div class='counter-row'><span id='count'>{props.start}</span></div>;
}
```

```text
// 拒绝：类型成员 `other` 没有 sidecar 行 —— PROPERTY_MISMATCH
export default function MyCounter(props: { start: number; other: number }) { … }

// 拒绝：props 形参从未声明的 sidecar 行 —— 同一个诊断
export const openElement = defineIslandConfig({
  tag: 'my-counter',
  properties: { start: { default: 0 }, extra: { default: '' } },
});
```

### 哪些行带 attribute

一行的 `attribute` 通道就是该属性的 attribute 侧：`reflect: true` 会写回，`attribute: false` 声明一个完全没有 attribute 的属性，省略 `attribute` 则推导出 kebab-case 的名字。只有 `string`、`number` 与 `boolean` 被承认——没有 converter，也没有数组或对象的线上格式——所以非原语行必须显式写出 `attribute: false`，而不是让构建去猜一种 JSON 编码。

```tsx
import { defineIslandConfig } from '@openelement/router';

interface Row {
  id: string;
  label: string;
}

export const openElement = defineIslandConfig({
  tag: 'my-list',
  properties: {
    heading: { default: '' },
    // 没有任何 attribute 或 JSON 线上格式承载行列表：值经
    // props 投影器抵达，所以这一行声明自己是纯 property 的。
    rows: { attribute: false, default: [] },
  },
});

export default function MyList(props: { heading: string; rows: Row[] }) {
  return (
    <section>
      <h2>{props.heading}</h2>
      <ul>
        {props.rows.map((row) => <li key={row.id}>{row.label}</li>)}
      </ul>
    </section>
  );
}
```

```text
// 拒绝：非原语行没有显式的 attribute: false —— PROPERTY_INVALID
export const openElement = defineIslandConfig({
  tag: 'my-list',
  properties: { rows: { default: [] } },
});
```

## 模块作用域只有 import、sidecar 和组件

一个编译模块只声明三样东西：它的 import、`openElement` sidecar，以及默认导出的组件。状态、context 与共享表都属于普通 `.ts` 模块——而且它们必须被*导入*，因为一个模块为自己声明的标识符会被当作未绑定的宿主绑定，而不是被捕获的局部变量。

```ts
// app/lib/lab-context.ts —— 普通模块持有模块级状态、令牌，
// 以及编译组件自己无法携带的绑定表
import { createContext, signal } from '@openelement/element';

export const labA = signal(0);
export const LabCtx = createContext<string>(Symbol('lab-ctx'), 'lab-default');
```

```tsx
// app/islands/element-lab.tsx
import { defineIslandConfig } from '@openelement/router';
import { labA } from '../lib/lab-context.ts';

export const openElement = defineIslandConfig({
  tag: 'element-lab',
  root: 'shadow',
  properties: { summary: { default: '' } },
});

export default function ElementLab(props: { summary: string }) {
  // `labA` 是导入的，因此这个引用落在模块作用域；在本文件里声明的
  // `const` 会成为未绑定绑定并让构建失败。
  return <p>{props.summary} — lab A at {labA.value}</p>;
}
```

```text
// 拒绝：组件模块里的顶层状态——正文对 `count` 的读取
// 会变成未绑定的宿主绑定，OEIR_GENERATED_ELEMENT_UNBOUND_BINDING
const count = signal(0);

// 同种方式拒绝：正文调用的模块局部辅助函数
function helper(): string { return 'a'; }
```

这条法则的后半段讲的是*读取*。组件正文从不触碰的模块局部声明是惰性的、无害的；构建只拒绝正文真正读到的标识符。

## setup 声明状态，只有一个 return

组件正文是一个 setup 函数，而不是一个通用方法。它可以声明 `signal` 与 `computed` 值、普通 `const` 绑定、箭头辅助函数，以及生命周期内置函数——然后以一个 `return` 结束，返回一个 JSX 元素。嵌套的 `function` 声明、`if` 语句或提前 return，都在被承认的语句文法之外。

```tsx
import { computed, signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'my-profile', properties: { name: { default: '' } } });

export default function MyProfile(props: { name: string }) {
  // 信号住在 setup 作用域：运行时在整个元素生命周期里保留这份记录，
  // 所以重新连接会重读同一个来源。
  const visits = signal(0);
  const greeting = computed(() => `Hello, ${props.name}`);

  return (
    <section>
      <h2>{greeting.value}</h2>
      <p>visits: {visits.value}</p>
    </section>
  );
}
```

```text
// 拒绝：嵌套的函数声明 —— OEC9041
export default function MyProfile() { function fmt(v: number) { return String(v); } return <p>{fmt(1)}</p>; }

// 拒绝：return 之前的控制流 —— OEC9041
export default function MyProfile() { if (ready) return <b>a</b>; return <i>b</i>; }

// 拒绝：根本没有 JSX 返回 —— OEC9040
export default function MyProfile() { return 'hello'; }
```

注意这里*没有*被限制的东西：return 之前由 props 算出的 `const` 是被承认的（`const text = props.label + '!'`），箭头辅助函数也被承认，而 `function` 声明不被承认。两条前端在这里是有意不同的——函数前端承认表达式形态的 setup，而不是语句形态的 setup。

## JSX 按标签组合

标记里写的是 HTML 标签、自定义元素宿主和同模块组件。自定义元素宿主按它注册的标签查找，所以宿主模块要导入子组件的模块来完成注册；同一文件里声明的兄弟组件按标识符被承认。但从*另一个*模块导入的组件不被承认：跨模块的组件组合不在这一片之内。

```tsx
import { defineIslandConfig } from '@openelement/router';
import './my-counter.tsx';

/** 同模块的子组件：就声明在这里，因此本范式能读到它的 props 形状。 */
function ChildCard(props: { label: string }) {
  return <b class='child'>{props.label}</b>;
}

export const openElement = defineIslandConfig({ tag: 'my-dashboard', properties: { label: { default: '' } } });

export default function MyDashboard(props: { label: string }) {
  return (
    <section>
      <ChildCard label={props.label} />
      <my-counter count={3}></my-counter>
    </section>
  );
}
```

```text
// 拒绝：把从另一个模块导入的组件当作标签 ——
// OEIR_LEAF_UNKNOWN_COMPONENT（在这里声明它，或以 <my-child-card> 承载它）
import { ChildCard } from './child-card.tsx';
export default function MyDashboard() { return <div><ChildCard /></div>; }
```

## `innerHTML` 不在本范式内

生成元素范式没有 `innerHTML` sink。`trustedHtml` 能力契约本是类创作的机制，函数前端则直接拒绝这个 sink，而不是发出一条更弱的信任规则。必须注入第一方标记的组件属于服务端函数页面范式——那一个范式确实承认这个 sink。

```tsx
// app/routes/post.tsx —— 服务端函数页面，承认 innerHTML 的唯一形态
import { definePage } from '@openelement/router';
import { type TrustedHtml } from '@openelement/element';

export function PostPage(props: { title: string; html: TrustedHtml }) {
  return (
    <main>
      <h1>{props.title}</h1>
      {/* post.html 是本仓库里撰写的 markdown —— 信任决定做在
          值被产出的地方，而不是在 sink 上。 */}
      <article class='post-body' innerHTML={props.html} trustedHtml></article>
    </main>
  );
}

export default definePage(PostPage, { head: { title: 'Post' } });
```

```text
// 在生成组件里被拒绝 —— OEC9044，那里的 sink 不被承认
export default function MyArticle(props: { body: TrustedHtml }) {
  return <div innerHTML={props.body} trustedHtml></div>;
}
```

## 文本是一个表达式

文本位置承认一个表达式：属性读取、信号读取、方法调用、算术。编译器把它降级为一个跟踪槽位，于是它读取的值一变就刷新，而别的东西一概不刷新。请让这个表达式既便宜又处处有定义——它在它所读之物每次更新时都会运行，而且它不能抛出，因为更新阶段写入中的抛出会逃逸到 `onError`。

```tsx
import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'my-total', properties: { label: { default: '' }, price: { default: 0 } } });

export default function MyTotal(props: { label: string; price: number }) {
  const quantity = signal(1);
  return (
    <p>
      {props.label.trim()}: {props.price * quantity.value}
    </p>
  );
}
```

被承认的文本文法刻意比已退役的类范式更宽：表达式是可以的，而且它是一个*槽位*，不是对周边树的重渲染。在不止一处使用的派生值仍然更适合做成 `computed`，好让派生只跑一次。

## 分支是 JSX 或 null

条件会降级为一个 `when` 块，因此每个分支是一个 JSX 元素——或者 `null` 表示缺席。文本分支与嵌套三元被拒绝：两者都没有可表示的分支形状，把它们折进一个条件才是正解。

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'my-status', properties: { ready: { default: false } } });

export default function MyStatus(props: { ready: boolean }) {
  return (
    <div>
      {props.ready ? <b data-state='ready'>Ready</b> : <i data-state='waiting'>Waiting</i>}
    </div>
  );
}
```

```text
// 拒绝：文本分支不是块分支 —— OEC9042
export default function MyStatus(props: { ready: boolean }) { return <div>{props.ready ? 'yes' : 'no'}</div>; }

// 拒绝：每个块只带一个条件；嵌套三元没有可表示的形态 —— OEC9042
export default function MyStatus(props: { ready: boolean }) { return <div>{props.ready ? (props.busy ? <b>a</b> : <b>b</b>) : <i>c</i>}</div>; }
```

## 处理器是函数

处理器属性取一个函数值：内联箭头函数，或从 setup 作用域读到的函数。运行时在元素 upgrade 时把它绑定，并以 DOM 事件调用它。这个值是在组件正文运行期间求值的，所以 `onClick={props.on()}` 并没有指名一个处理器——它在 setup 期间*调用*了 `props.on`，而它返回的值变成了处理器。那仍然能编译；错的是语义，所以请传引用。

```tsx
import { signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'my-toggle', properties: { enabled: { default: false } } });

export default function MyToggle(props: { enabled: boolean }) {
  const clicks = signal(0);

  const toggle = () => {
    clicks.value = clicks.value + 1;
  };

  return (
    <button type='button' onClick={toggle}>{props.enabled ? <b>on</b> : <i>off</i>}</button>
  );
}
```

名为 `on*` 的属性在这里不像在类范式里那样被保留：props 表按字面读取，所以 `on` 是个普通成员。仍然成立的是：处理器位置取一个函数——一次调用的返回值不是处理器。

## 属性是字面量或受承认的通道

内置元素上的属性，要么是字面量，要么是五种动态通道之一：`attribute`、`boolean`、`property`、`event` 与 `ref`。这个集合就是全部——`class` 与 `style` 仅限字面量，因为计算出来的 class 或 style 需要一条 leaf 切片并不安装的通道，请求它会以 `OEIR_LEAF_UNSUPPORTED_ATTRIBUTE` 失败关闭，而不是发出一条永远不会生效的规则。展开被拒绝的理由更深：它的键集是运行时事实，服务端与浏览器没有可达成一致的共同形态。

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'my-link',
  properties: { href: { default: '/' }, active: { default: false } },
});

export default function MyLink(props: { href: string; active: boolean }) {
  return (
    // `class` 保持字面量；动态的事实走 `attribute` 通道。
    // 计算出来的 class 需要一条本范式不安装的通道。
    <a class='link' title={`See ${props.href}`} href={props.href} data-active={props.active}>
      Docs
    </a>
  );
}
```

```text
// 拒绝：展开没有可序列化的形态 —— OEC9042
export default function MyLink(props: { href: string }) { return <a {...props}>Docs</a>; }

// 拒绝：`class` 与 `style` 只取字面量——动态值在 leaf 切片之外，
// OEIR_LEAF_UNSUPPORTED_ATTRIBUTE
export default function MyLink(props: { active: boolean }) {
  return <a class={props.active ? 'link link-active' : 'link'}>Docs</a>;
}
```

## 生命周期是根 setup 里的内置调用

类范式的 hook 只有一个替代品：从 `@openelement/element` 导入、并在根组件正文顶层调用的内置函数，编译器把它们降级进被保留的实例工厂。`onConnect` 同时替代 `onDsdHydrated` 与 `onCsrRendered`——一个回调，认领之后与全新挂载之后同样运行——而 `onDispose` 替代类范式的 `onDispose`。嵌套组件的 hook 只有在该组件被编译器保留为无宿主正文时才被携带；没有保留宿主者的 hook 会以 `OEIR_LEAF_INVALID_ARTIFACT` 失败关闭，所以请把元素生命周期放在拥有它的那个元素上。

```tsx
import { onConnect, onDispose, useHost } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'my-probe', root: 'shadow', hydrate: 'visible', ssr: true });

export default function MyProbe() {
  // 宿主元素本身取代了类范式的 `this`。
  const host = useHost();

  onConnect((env) => {
    host.setAttribute('data-ready', '1');
    // 每次连接的信号在断开时中止，因此在这里注册的监听器会被释放，
    // 不需要第二张记账表。
    env.signal.addEventListener('abort', () => host.removeAttribute('data-ready'));
  });

  onDispose(() => {
    host.removeAttribute('data-ready');
  });

  return <span class='probe'>probe</span>;
}
```

`onPropertyChange(cb)` 在声明的行提交新值之后运行，`onError(cb)` 是错误边界。`useHost()` 返回本实例所属的元素——类范式 `this` 的替代品——并且它只作为 setup 绑定（`const host = useHost()`）被擦除，所以请通过那个绑定读取宿主，而不要在处理器或文本槽位里调用它。断开期间仍须可达的状态属于 `ref`：句柄在节点挂载时填充、在卸载时清空，而编译器只在 `ref` 属性里承认它。

```tsx
import { onPropertyChange, ref } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'my-field', properties: { value: { default: '' } } });

export default function MyField(props: { value: string }) {
  const input = ref<HTMLInputElement>();

  onPropertyChange((event) => {
    // `name` 与 `value` 就是被提交的那一行——类范式写成属性 setter 的
    // 那条变更通道。
    if (event.name === 'value' && input.current) input.current.value = String(event.value);
  });

  return <input ref={input} value={props.value} />;
}
```

### 错误边界是元素作用域的

`onError(cb)` 是**一个生成元素**面向作者的边界。当某个值逃出该元素自己的工作范围时它运行：连接/认领过程（挂载、认领、setup 与 `onConnect` 重放），或一次更新阶段的写入（一次跟踪槽位刷新，或编译正文内派发的一次 DOM 事件处理器）。它不是子树边界，也不跨元素捕获——跨元素围堵随类基类一同退役了，也没有包装组件替代它。

```tsx
import { onError } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'my-widget', hydrate: 'idle', ssr: true });

export default function MyWidget() {
  onError((env) => {
    // `env.error` 就是被抛出的那个值本身，从不包装；一个自己抛出的
    // 处理器会取代它，成为最终浮出的那个错误。
    env.host.setAttribute('data-failed', '1');
  });

  return <p>widget</p>;
}
```

会捕获的处理器只改变错误是否逃逸。连接阶段的失败仍然让元素停在它定义好的失败后状态（没有投影、没有监听器），之后的重连会从头重试；更新阶段的失败保留已经写下的 DOM，订阅依然存活。没有注册处理器时，抛出原样浮出。该回调由客户端所有：它被擦进编译模块，在服务端渲染期间从不运行。

## 页面是服务端函数

对页面而言，路由模块自己声明组件，再用 `definePage` 把它包起来。这个函数从本模块导出、以标识符传入，并由服务端函数范式降级为一个生成式 HTML 构造器——因此它在构造上就是纯服务端的，不发布任何组件状态。这正是 light root 页面使用的形态，因为 light 生成组件没有可作为页面根的 DSD 宿主生成器。

```tsx
// app/routes/about.tsx
import { definePage } from '@openelement/router';

export const loader = async () => ({ title: 'About' });

export function AboutPage(props: { title: string }) {
  return (
    <main>
      <h1>{props.title}</h1>
    </main>
  );
}

export default definePage(AboutPage, { head: { title: 'About' } });
```

```ts
// 描述符是数据，不是标记：head、renderIntent、props 与 error 就是
// 全部表面——没有 render() 字段。
export default definePage(AboutPage, {
  head: { title: 'Hello — my-app' },
});
```

```text
// 拒绝：return 之前的局部 const —— 服务端函数组件是
// 一个 JSX 元素的一次 return（OEC9032）
export function AboutPage(props: { title: string }) { const t = props.title + '!'; return <main>{t}</main>; }

// 拒绝：事件处理器是纯客户端构造——交互性属于
// island 模块（OEC9031）
export function AboutPage() { return <button onClick={() => {}}>x</button>; }

// 拒绝：服务端函数组件按直接调用组合，而不是按对导入组件的
// JSX 引用（OEC9032）
export function AboutPage() { return <main><Child /></main>; }
```

需要状态、处理器或生命周期的页面不是服务端函数页面：那是一个包着编译组件的路由模块，而那个组件如果必须在浏览器里运行，就是一个 island。[Islands 与 SSR](/zh/guide/islands-and-ssr) 说明了每种形态买到的交付契约。

## 另见

- [核心概念](/zh/guide/core-concepts)——这些法则降级到其上的元素与槽位模型。
- [错误处理](/zh/guide/error-handling)——上文各错误码及其契约的目录。
- [错误码](/zh/errors)——全部 `OEC9xxx` 诊断的生成参考表。
