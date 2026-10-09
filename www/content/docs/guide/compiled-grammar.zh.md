---
title: '编译模块文法'
lede: '一套有界、构建期强制的创作文法，配以带码诊断——编译器承认什么，以及它拒绝什么（而不是回退到运行时解释）。'
navLabel: '模块文法'
order: 15
section: 'Core'
---

编译器把每个 `@element` 模块降级为 Part Program——一份可序列化的产物，服务端序列化器、全新挂载与既有 DOM 认领三方能逐字节一致地重放它。这份三态一致正是文法换来的东西，也是文法封闭的原因：编译器无法降级的写法会在构建期以 `OEC9xxx` 诊断失败，而不是把解释器发到浏览器。本页即速查表——先一表列全部法则，再逐条给出可用示例与失败形态。

## 法则一览

| 法则 | 编译器承认 | 编译器拒绝 |
| --- | --- | --- |
| 一模块一编译类 | 恰好一个类，携带恰好一个规范的 `@element(...)` 装饰器 | 模块内的第二个类（哪怕是无装饰器的辅助类），或第二个装饰器（`OEC9001`、`OEC9004`） |
| 类必须导出 | `export class` 或 `export default class`，类上无其它修饰符 | 模块内私有类、`abstract`、`declare`（`OEC9006`） |
| 基类必须规范 | `extends OpenElement` 或 `extends ErrorBoundary`，两者都须是 `@openelement/element` 的运行时具名导入 | 同名本地类、外部导入、命名空间、默认或 type-only 导入、经再导出（`OEC9003`） |
| 实例字段必须全是 `@property` | `@property({ ... }) name = <许可初始化形态之后的字面量>` | 无装饰器字段、constructor、getter/accessor（`OEC9005`、`OEC9006`） |
| 唯一 static 成员是 `styles` | `static override styles: StyleSheetLike[] = [sheet]`，数组里是本模块的 `.css` 导入 | 其它任何 static 成员；内联字符串表或没有导入绑定的表（`OEC9005`、`OEC9029`） |
| 禁止顶层运行语句 | import、`type`/`interface`/`module`/`declare` 声明，以及岛交付策略语句（`export const openElement = defineIslandConfig(...)`） | `const x = signal(0)`、`createContext(...)`、模块级查找表等任何会执行的语句（`OEC9008`） |
| JSX 用标签名组合 | 小写内置元素与自定义元素宿主（`<my-counter>`） | 把类值当标签（`<ChildCard />`）（`OEC9010`） |
| `innerHTML` 必须带显式信任手势 | `@property({ type: Object, reflect: false, attribute: false }) body = trustedHtml(...)`，且 `innerHTML={this.body} trustedHtml` | `String` 类型来源、普通字符串值、无 `trustedHtml()` 品牌的值（`OEC9026`） |
| 文本区读属性 | `{this.label}`、`{this.count}`、字面量文本 | 文本位置上的方法调用或任何其它表达式（`OEC9013`） |
| 分支必须全静态 | `{this.flag ? <b>on</b> : <i>off</i>}`、`{this.count > 5 && <p>over</p>}` | 不是单个静态 JSX 元素的分支；嵌套三元（`OEC9012`） |
| `render()` 单 return | `render() { return <main>…</main>; }` | return 前的局部变量、两个根元素、fragment 根、根为文本（`OEC9007`） |
| 事件处理器是方法引用 | `onClick={this.pick}` 或单一动作箭头函数 | `onClick={this.pick()}` 等内联调用表达式（`OEC9016`） |
| 属性值是字面量或属性读取 | 字面量、`this.<property>` sink、许可的 boolean/class/style 形态 | 展开属性、计算表达式（`OEC9011`） |

## 一模块一编译类

一个模块就是一个组件。它需要的辅助类、常量与函数写在普通模块里再导入——编译模块不允许出现别的顶层类。

```tsx
// app/components/my-card.tsx
import { element, OpenElement, property } from '@openelement/element';

@element('my-card', { root: 'shadow-open' })
export default class MyCard extends OpenElement {
  @property({ reflect: false })
  title = '';

  render() {
    return <article><h2>{this.title}</h2><slot></slot></article>;
  }
}
```

```text
// 拒绝：模块内的第二个类以 OEC9001 失败
class CardStyles { padding = 1; }
```

## 类必须导出

路由与岛的扫描器通过模块导出找到组件，编译器对此的要求与此一致：`export class` 或 `export default class`，类声明行上没有别的修饰符。

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('my-badge', { root: 'shadow-open' })
export class MyBadge extends OpenElement {
  @property({ reflect: true })
  tone = 'neutral';

  render() {
    return <span class='badge'>{this.tone}</span>;
  }
}
```

```text
// 拒绝：未导出，或带 abstract/declare —— OEC9006
@element('my-badge')
class MyBadge extends OpenElement { /* … */ }
```

## 基类必须规范

基类必须是 `@openelement/element` 的运行时具名导入——`OpenElement`，或文档化的错误边界形态 `ErrorBoundary`。决定权在绑定来源而非拼写：一个碰巧叫 `OpenElement` 的本地类、默认或命名空间导入、经再导出模块的导入，都会失败关闭。

```tsx
import { element, ErrorBoundary, property } from '@openelement/element';

@element('my-boundary', { root: 'shadow-open' })
export class MyBoundary extends ErrorBoundary {
  @property({ reflect: false, attribute: false })
  hasError = false;

  override retry(): void {
    super.retry();
  }

  render() {
    return <div>{this.hasError ? <p>出错了</p> : <slot></slot>}</div>;
  }
}
```

```text
// 拒绝：再导出来源永不被追踪 —— OEC9003
import { OpenElement } from './my-element-re-export.ts';
```

## 实例字段必须全是 `@property`

响应式状态就是编译属性契约：constructor 由编译器生成、attribute 映射到属性、没有 `@property` 的字段没有通道。派生值用 `computed(...)` 字段；不属于状态的内部辅助放在普通模块。

```tsx
import { computed, element, OpenElement, property, type ReadonlySignal } from '@openelement/element';

@element('my-counter', { root: 'shadow-open' })
export default class MyCounter extends OpenElement {
  @property({ reflect: true })
  count = 0;

  @property({ reflect: false, attribute: false, type: Boolean })
  empty: ReadonlySignal<boolean> = computed(() => this.count === 0);

  render() {
    return <p hidden={this.empty}>{this.count}</p>;
  }
}
```

```text
// 拒绝：无装饰器字段、constructor 与 getter 都在文法之外 —— OEC9005 / OEC9006
@element('my-counter')
export class MyCounter extends OpenElement {
  helper = 1;                 // 无 @property
  constructor() { super(); } // constructor 由编译器生成
  get double() { return this.count * 2; } // 请用 computed 属性
}
```

## 唯一 static 成员是 `styles`

`static styles` 是文法保留的唯一 static，且必须数组真实的 `.css` 文件导入：表的字节只存在于一处——作者写下的文件——构建再把它产出为带内容寻址的资产。内联字符串会把样式字节放回 JavaScript chunk，因此其它任何表的写法（字符串字面量、工厂调用、在别的模块里构造的值）都会失败关闭。

```tsx
import { element, OpenElement, type StyleSheetLike } from '@openelement/element';
import widgetStyles from './my-widget.css';

@element('my-widget', { root: 'shadow-open' })
export class MyWidget extends OpenElement {
  static override styles: StyleSheetLike[] = [widgetStyles];

  render() {
    return <div class='widget'><slot></slot></div>;
  }
}
```

```text
// 拒绝：别的 static 成员，以及内联表 —— OEC9005 / OEC9029
static cache = 1;
static override styles: StyleSheetLike[] = [`:host { display: block; }`];
```

## 禁止顶层运行语句

编译模块是数据加一个类。信号、context 与共享常量住在普通 `.ts` 模块里——starter 的 `app/islands/lab-context.ts` 就是范式——编译模块再导入它们。唯一被承认的语句是岛交付策略。

```ts
// app/islands/lab-context.ts —— 普通模块承载模块级状态
import { createContext, signal } from '@openelement/element';

export const labA = signal(0);
export const LabCtx = createContext<string>(Symbol('lab-ctx'), 'lab-default');
```

```tsx
import { defineIslandConfig } from '@openelement/router';
import { element, OpenElement, property } from '@openelement/element';
import { LabCtx, labA, consumeContext } from './lab-context.ts';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });

@element('element-lab', { root: 'shadow-open' })
export default class ElementLab extends OpenElement {
  @property({ reflect: false, attribute: false })
  summary = '';

  render() {
    return <p>{this.summary}</p>;
  }
}
```

```text
// 拒绝：模块顶层的 signal()/createContext() —— OEC9008
const count = signal(0);
const ThemeCtx = createContext<string>(Symbol('theme'), 'dark');
```

## JSX 用标签名组合

编译标记按 HTML 标签与自定义元素宿主书写；类以 `@element` 标签注册，因此 render 里读取的是该标签的字符串。类值出现在 JSX 位置是文法之外——编译器只降级已知标签。

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('my-dashboard', { root: 'shadow-open' })
export class MyDashboard extends OpenElement {
  @property({ reflect: false })
  label = '';

  render() {
    return (
      <section>
        <my-counter count={this.label}></my-counter>
      </section>
    );
  }
}
```

```text
// 拒绝：类值不是标签 —— OEC9010
import { ChildCard } from './child-card.tsx';
render() { return <div><ChildCard /></div>; }
```

## `innerHTML` 必须带显式信任手势

注入标记需要信任边界的两半：属性必须是 Object 类型并持有 `trustedHtml(...)` 值，sink 必须携带字面量 `trustedHtml` 标记。其余任何写法都打不开这个 sink——看似 HTML 的字符串不行，跨过序列化边界的值也不行（品牌是内存中的能力，不会在 JSON 中存活）。

```tsx
import { element, OpenElement, property, trustedHtml, type TrustedHtml } from '@openelement/element';

@element('my-article', { root: 'shadow-open' })
export class MyArticle extends OpenElement {
  @property({ type: Object, reflect: false, attribute: false })
  bodyHtml: TrustedHtml = trustedHtml('');

  render() {
    return <div innerHTML={this.bodyHtml} trustedHtml></div>;
  }
}
```

```text
// 拒绝：String 属性无法供 sink；标记配上非 Object 的 trustedHtml 来源同样失败 —— OEC9026
@property({ reflect: false }) bodyHtml = '<p>raw</p>';
render() { return <div innerHTML={this.bodyHtml} trustedHtml></div>; }
```

## 文本区读属性

文本位置是一个编译 Part：属性信号变化时它重新渲染，序列化器也能在服务端求值。字面量文本、`this.<property>` 读取与许可的列表映射覆盖了这门语言；其它任何写法——方法调用、算术、模板字面量——都没有可序列化形态，都会失败关闭。请在 `computed(...)` 属性里计算。

```tsx
import { computed, element, OpenElement, property, type ReadonlySignal } from '@openelement/element';

@element('my-profile', { root: 'shadow-open' })
export default class MyProfile extends OpenElement {
  @property({ reflect: false })
  name = '';

  @property({ reflect: false, attribute: false, type: String })
  displayName: ReadonlySignal<string> = computed(() => this.name.trim());

  render() {
    return <p>{this.displayName}</p>;
  }
}
```

```text
// 拒绝：文本位置只能降级为属性信号之上的 Part —— 方法调用没有 Part —— OEC9013
render() { return <p>{this.name.trim()}</p>; }
```

## 分支必须全静态

条件降级为 `when` Region，因此每个分支必须恰好是一个静态 JSX 元素（可自带 Part）。形状依赖运行时数据的分支——三元落到非元素表达式、嵌套三元——无法表示；修法是用一个 `computed(...)` 布尔值来测试分支。

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('my-status', { root: 'shadow-open' })
export class MyStatus extends OpenElement {
  @property({ reflect: false, type: Boolean })
  ready = false;

  render() {
    return <div>{this.ready ? <b>Ready</b> : <i>Waiting</i>}</div>;
  }
}
```

```text
// 拒绝：分支必须是单个静态 JSX 元素 —— OEC9012
render() { return <div>{this.ready ? <b>{this.label}</b> : <i>Waiting</i>}</div>; }
// 纯文本三元甚至不是 Region：
render() { return <div>{this.ready ? 'yes' : 'no'}</div>; }
```

## `render()` 单 return

Part Program 派生自该方法唯一 return 的元素，所以 `render()` 是单 `return`、单根的一个 JSX 元素：return 前没有局部变量，没有两个根，也没有 fragment 根。需要计算的值请放进 `computed(...)` 属性或模块作用域。

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('my-panel', { root: 'shadow-open' })
export class MyPanel extends OpenElement {
  @property({ reflect: false })
  label = '';

  render() {
    return (
      <section class='panel'>
        <h2>{this.label}</h2>
        <slot></slot>
      </section>
    );
  }
}
```

```text
// 拒绝：return 前的局部变量、两个根、fragment 根 —— OEC9007
render() { const text = this.label; return <p>{text}</p>; }
render() { return <><div>a</div><div>b</div></>; }
```

## 事件处理器是方法引用

模板处理器以 `this.<method>` 引用（或单一动作箭头函数）降级进程序，运行时无需在渲染期求值表达式即可绑定。在处理器位置上调用方法会在绑定时就执行。

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('my-toggle', { root: 'shadow-open' })
export class MyToggle extends OpenElement {
  @property({ reflect: false, type: Boolean })
  enabled = false;

  toggle(): void {
    this.enabled = !this.enabled;
  }

  render() {
    return <button type='button' onClick={this.toggle}>{this.enabled ? <b>on</b> : <i>off</i>}</button>;
  }
}
```

```text
// 拒绝：处理器位置取引用而不是调用 —— OEC9016
render() { return <button onClick={this.toggle()}>x</button>; }
// 且以 `on*` 命名的属性保留给事件通道：
@property({ reflect: false }) on = false;
```

## 属性值是字面量或属性读取

属性值由序列化器、全新挂载与认领三方共同求值，所以每个值要么是字面量，要么是单个 `this.<property>` sink（boolean/class/style 形态作为各自的 Part 被承认）。展开属性与计算表达式没有共同的可序列化形态。

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('my-link', { root: 'shadow-open' })
export class MyLink extends OpenElement {
  @property({ reflect: false })
  href = '/';

  render() {
    return <a class='link' href={this.href}>Docs</a>;
  }
}
```

```text
// 拒绝：展开属性与计算属性表达式 —— OEC9011
render() { return <a {...this.props}>Docs</a>; }
render() { return <a title={'See ' + this.href}>Docs</a>; }
```

## 另见

- [核心概念](/zh/guide/core-concepts)——这些法则降级到其上的元素与 Part 模型。
- [错误处理](/zh/guide/error-handling)——上文各错误码及其契约的目录。
- [错误码](/zh/errors)——全部 `OEC9xxx` 诊断的生成参考表。
