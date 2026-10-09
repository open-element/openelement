---
title: 'The compiled module grammar'
lede: 'One bounded authoring grammar, enforced at build time with coded diagnostics — what the compiler admits, and what it rejects instead of falling back at runtime.'
navLabel: 'Module grammar'
order: 15
section: 'Core'
---

The compiler lowers every `@element` module into a Part Program — a serializable artifact the server serializer, a fresh mount, and the existing-DOM claim all replay identically. That three-way identity is what the grammar buys, and it is why the grammar is closed: a construct the compiler cannot lower fails the build with an `OEC9xxx` diagnostic instead of shipping a runtime interpreter. This page is the cheat sheet — the laws in one table, then each law with a working example and the shape that fails.

## The laws

| Law | The compiler admits | The compiler rejects |
| --- | --- | --- |
| One compiled class per module | exactly one class, carrying one canonical `@element(...)` decorator | a second class in the module — even an undecorated helper — or a second decorator (`OEC9001`, `OEC9004`) |
| The class is exported | `export class` or `export default class`, with no other class modifiers | a module-local class, `abstract`, `declare` (`OEC9006`) |
| The base class is canonical | `extends OpenElement` or `extends ErrorBoundary`, both runtime named imports of `@openelement/element` | a same-name local class, a foreign import, a namespace, a default or type-only import, a re-export (`OEC9003`) |
| Every instance field is a `@property` | `@property({ ... }) name = <literal after the admitted initializer forms>` | an undecorated field, a constructor, a getter or accessor (`OEC9005`, `OEC9006`) |
| The only static member is `styles` | `static override styles: StyleSheetLike[] = [sheet]`, arraying the module's `.css` imports | any other static member; an inline sheet string or a non-import sheet binding (`OEC9005`, `OEC9029`) |
| No runtime top-level statements | imports, `type`/`interface`/`module`/`declare` declarations, and the island policy statement (`export const openElement = defineIslandConfig(...)`) | `const x = signal(0)`, `createContext(...)`, a module-level lookup table, any other executing statement (`OEC9008`) |
| JSX composes by tag name | lowercase intrinsic elements and custom-element hosts (`<my-counter>`) | a class value as the tag (`<ChildCard />`) (`OEC9010`) |
| `innerHTML` carries the explicit trust gesture | `@property({ type: Object, reflect: false, attribute: false }) body = trustedHtml(...)` plus `innerHTML={this.body} trustedHtml` | a `String`-typed source, a plain string value, a value with no `trustedHtml()` brand (`OEC9026`) |
| Text reads properties | `{this.label}`, `{this.count}`, literal text | a method call or any other expression in a text position (`OEC9013`) |
| Branches are fully static | `{this.flag ? <b>on</b> : <i>off</i>}`, `{this.count > 5 && <p>over</p>}` | a branch that is not a single static JSX element; a nested ternary (`OEC9012`) |
| `render()` is one return | `render() { return <main>…</main>; }` | locals before the return, two root elements, a fragment root, text as the root (`OEC9007`) |
| Handlers are method references | `onClick={this.pick}` or a single-action arrow | `onClick={this.pick()}` and other inline call expressions (`OEC9016`) |
| Attributes are static or property reads | literals, `this.<property>` sinks, the admitted boolean/class/style forms | spreads, computed expressions (`OEC9011`) |

## One compiled class per module

A module is one component. Declare the helper classes, constants and functions it needs in plain modules and import them — a compiled module admits no other top-level class.

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
// rejected: a second class in the module fails with OEC9001
class CardStyles { padding = 1; }
```

## The class is exported

The route and island scanners find components through the module's exports, and the compiler states the same requirement: `export class` or `export default class`, nothing else on the class line.

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
// rejected: not exported, or decorated with abstract/declare — OEC9006
@element('my-badge')
class MyBadge extends OpenElement { /* … */ }
```

## The base class is canonical

The base class must be a runtime named import of `@openelement/element` — `OpenElement`, or `ErrorBoundary` for the documented error-boundary form. Binding provenance decides, never the spelling: a local class that happens to be called `OpenElement`, a default or namespace import, and an import through a re-exporting module all fail closed.

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
    return <div>{this.hasError ? <p>Something went wrong</p> : <slot></slot>}</div>;
  }
}
```

```text
// rejected: re-export provenance is never followed — OEC9003
import { OpenElement } from './my-element-re-export.ts';
```

## Every instance field is a `@property`

Reactive state is the compiled property contract: the constructor is generated, attributes map onto properties, and a field without `@property` has no channel. Derived values are `computed(...)` fields, and internal helpers that are not state belong in a plain module.

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
// rejected: undecorated fields, constructors and getters are outside the
// grammar — OEC9005 / OEC9006
@element('my-counter')
export class MyCounter extends OpenElement {
  helper = 1;                 // no @property
  constructor() { super(); } // constructors are generated
  get double() { return this.count * 2; } // use a computed property
}
```

## The only static member is `styles`

`static styles` is the one static the grammar keeps, and it must array real `.css` file imports: the sheet's bytes live in exactly one place — the authored file — and the build emits them as content-addressed assets. An inline string would put stylesheet bytes back into the JavaScript chunk, so every other sheet spelling (a string literal, a factory call, a value built in another module) fails closed.

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
// rejected: any other static member, and inline sheets — OEC9005 / OEC9029
static cache = 1;
static override styles: StyleSheetLike[] = [`:host { display: block; }`];
```

## No runtime top-level statements

A compiled module is data plus a class. Signals, contexts and shared constants live in plain `.ts` modules — `app/islands/lab-context.ts` in the starter is the pattern — and the compiled module imports them. The one admitted statement is the island delivery policy.

```ts
// app/islands/lab-context.ts — a plain module owns module-level state
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
// rejected: signal()/createContext() at module top level — OEC9008
const count = signal(0);
const ThemeCtx = createContext<string>(Symbol('theme'), 'dark');
```

## JSX composes by tag name

Compiled markup is written in terms of HTML tags and custom-element hosts; the class is registered by its `@element` tag, so the render reads that tag as a string. A class value in the JSX position is outside the grammar — the compiler only lowers known tags.

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
// rejected: a class value is not a tag — OEC9010
import { ChildCard } from './child-card.tsx';
render() { return <div><ChildCard /></div>; }
```

## `innerHTML` carries the explicit trust gesture

Injected markup needs both halves of the trust boundary: the property must be Object-typed and hold a `trustedHtml(...)` value, and the sink must carry the literal `trustedHtml` marker. Nothing else opens the sink — not a string that merely looks like HTML, and not a value that crossed a serialization boundary (the brand is an in-memory capability and does not survive JSON).

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
// rejected: a String property cannot feed the sink, and the marker without an
// Object-typed trustedHtml source fails too — OEC9026
@property({ reflect: false }) bodyHtml = '<p>raw</p>';
render() { return <div innerHTML={this.bodyHtml} trustedHtml></div>; }
```

## Text reads properties

A text position is a compiled Part: it re-renders when the property's signal changes, and the serializer can evaluate it server-side. Literal text, `this.<property>` reads and the admitted list mapper cover the language; anything else — a method call, arithmetic, a template literal — has no serializable form and fails closed. Compute it in a `computed(...)` property instead.

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
// rejected: the text position lowers to a Part over a property signal —
// method calls have no Part — OEC9013
render() { return <p>{this.name.trim()}</p>; }
```

## Branches are fully static

A conditional lowers to a `when` Region, so each branch must be exactly one static JSX element (optionally with its own Parts). A branch whose shape depends on runtime data — a ternary that lands on a non-element expression, a nested ternary — cannot be represented, and the fix is a `computed(...)` boolean that the branch tests.

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
// rejected: a branch must be one static JSX element — OEC9012
render() { return <div>{this.ready ? <b>{this.label}</b> : <i>Waiting</i>}</div>; }
// and a text-only ternary is not a Region at all:
render() { return <div>{this.ready ? 'yes' : 'no'}</div>; }
```

## `render()` is one return

The Part Program is derived from the method's single returned element, so `render()` is a single `return` of one JSX element with one root: no locals before the return, no two roots, no fragment root. Values that need computing live in `computed(...)` properties or module scope.

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
// rejected: locals before the return, two roots, a fragment root — OEC9007
render() { const text = this.label; return <p>{text}</p>; }
render() { return <><div>a</div><div>b</div></>; }
```

## Handlers are method references

Template handlers lower into the program as `this.<method>` references (or a single-action arrow), so the runtime binds them without evaluating expressions during render. A call inside the handler position would execute at bind time.

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
// rejected: the handler position takes a reference, not a call — OEC9016
render() { return <button onClick={this.toggle()}>x</button>; }
// and a property named `on*` is reserved for event channels:
@property({ reflect: false }) on = false;
```

## Attributes are static or property reads

Attribute values are evaluated by the serializer, the fresh mount and the claim alike, so each one is either a literal or a single `this.<property>` sink (with the boolean, class and style forms admitted as their own Parts). Spreads and computed expressions have no common serializable form.

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
// rejected: spreads and computed attribute expressions — OEC9011
render() { return <a {...this.props}>Docs</a>; }
render() { return <a title={'See ' + this.href}>Docs</a>; }
```

## See also

- [Core Concepts](/guide/core-concepts) — the element and Part model these laws lower onto.
- [Error Handling](/guide/error-handling) — where the codes above are catalogued with their contracts.
- [Error codes](/errors) — the generated reference table for every `OEC9xxx` diagnostic.
