---
title: 'Core Concepts'
lede: 'The core model is standards-first: authored elements, declarative rendering, file routes and optional islands.'
order: 10
---

## OpenElement

`OpenElement` from `@openelement/element` extends `HTMLElement` and is the base class of every component in an application. Components are authored in TSX and lowered at build time into a Part Program — a versioned, serializable artifact that the runtime replays. No virtual-DOM runtime and no interpreter ship to the browser: unsupported authoring fails with a compiler diagnostic instead of falling back to a runtime render path.

Two compile-time decorators carry a component's contract:

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

`@element(tag, { root })` names the custom element and where its content renders: `'light'` is the default and renders into light DOM so document-level styles apply directly, while `'shadow-open'` and `'shadow-closed'` attach a shadow root. `@property({ reflect })` declares a reactive field. The attribute is the default channel, named after the kebab-cased property (`attribute: 'my-name'` overrides it); `attribute: false` opts out for values that must never be serialized into markup. A derived value is a `computed(...)` field, which the compiler requires to be `reflect: false, attribute: false` because it has no attribute channel. `signal()` sits behind both — `computed()` derives from it and `effect()` subscribes to it; all three are exported from `@openelement/element`.

A state change re-renders only the Parts that read the changed value. Event handlers written in the template (`onClick`, `onInput`) are bound at upgrade; nothing is looked up by string at runtime. Server-side, the same compiled class is serialized to markup by `renderDsd`, so there is one program behind both outputs rather than two renderers that can drift.

### Shadow root behavior: delegatesFocus

`@element('my-dialog', { root: 'shadow-open', delegatesFocus: true })` emits the matching class static, so the attached shadow root is created with `delegatesFocus`. Focus moving into the host is then delegated to the first focusable element inside the shadow tree, and the host itself matches `:focus` — which is what makes a wrapper such as a dialog, a menu or a composite field keyboard-navigable without a manual focus trap. It applies to shadow roots only (a `'light'` root has no shadow root to configure) and the compiler accepts the literal only: `@element(..., { delegatesFocus: <boolean literal> })`. Anything else fails closed with `OEC9002`.

### Form participation: formAssociated

`@element('my-field', { root: 'shadow-open', formAssociated: true })` emits `static formAssociated = true`, and the runtime then associates the host with the surrounding form through `ElementInternals` when it connects. The host becomes a form control: it appears in `form.elements`, participates in submission and `form.reset()`, and receives `form`, `name` and `value` semantics. Because association is a platform contract rather than a framework one, put the interactive control inside the shadow root and keep the host's own attributes for the form-facing name and value; the runtime does not invent a form value for you. As with `delegatesFocus`, the option takes a boolean literal, and an unsupported `@element` option fails closed with `OEC9002`.

### Attribute conversion: converter

`@property({ reflect: false, type: Number })` and `@property({ reflect: false, converter: Number })` mean the same thing to the compiler: the converter names the built-in conversion the host attribute is parsed through, and it is one of `String`, `Number`, `Boolean`, `Array` or `Object` — anything else fails closed with `OEC9021`. `type` is the declaring form and reads best in a component's contract; `converter` is the same declaration under the name Lit-style code uses, accepted so a ported element does not need rewriting. `Boolean` follows the platform attribute convention: presence is `true`, absence is `false`, so a boolean property reflects as an empty attribute rather than `"true"`. When neither is given, the converter is inferred from the field's initializer (`count = 0` → `Number`, `label = ''` → `String`, `items: string[] = []` → `Array`), so a typed field with a literal default already declares its own channel.

## DSD

Server output is Declarative Shadow DOM: component markup travels inside `<template shadowrootmode="open">` and the browser parses it natively, without script. The document is styled and readable on first paint — before any client module is fetched. Styles declared in a component's `static styles` are inlined; for a light root the server scopes them in a `@scope(<tag>)` block so page rules cannot leak into the rest of the document.

Interactivity arrives through the platform's own Custom Element upgrade: when the generated client entry defines the class, it claims the DOM that is already there, binds the handlers the compiled template declared, and fills `@property` fields from host attributes. Host attributes restore fields — they never invent events. An element whose class never loads still renders its markup, which is why a JS failure degrades to a static page instead of an empty one.

## Islands

An island is a module under the islands directory (`app/islands` by default) that opts into client delivery. It declares how it is delivered next to the component it exports:

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });
```

`hydrate` selects when the browser imports the module — `'load'` for controls needed at first paint such as navigation and theme, `'idle'` for everything else that can wait, `'visible'` for components that only matter as they scroll into view, and `'only'` for browser-only components that skip SSR. The build records which islands belong to which page, so a page references only the chunks it can use and an island that is never reached is never fetched.

## Conditional regions and the grammar bound

A conditional region lowers a JSX conditional into the compiled Part Program instead of shipping a comparison in JavaScript. The compiler admits exactly these forms, each comparing one `@property` against a literal:

- `{this.count > 5 && <p>over</p>}` — ordering with `>`, `>=`, `<`, `<=` against a finite number (the signal value is coerced with `Number()`).
- `{this.status === 'pending' && <Spinner />}` — strict `===` / `!==` against a number, string, or boolean literal. Equality is strict on purpose: `1` never matches `"1"`.
- `{this.ready && <Dashboard />}` and `{!this.ready && <Spinner />}` — bare truthiness, optionally negated, via `Boolean(value)`.

A ternary is the two-branch spelling of the same test: `{this.status === 'pending' ? <Spinner /> : <Done />}`.

Why the grammar is bounded, and what is deliberately outside it: a condition must lower to a serializable test the server serializer, a fresh mount, and the existing-DOM claim can all evaluate identically without shipping JavaScript — that is what keeps the three modes byte-identical. Comparisons between two properties (`this.count > this.limit`), loose equality (`==`), and arithmetic on either side stay outside the grammar and fail closed at build time with `OEC9013`; the idiomatic path is a computed `@property` or getter that holds the already-computed boolean, which the bare-truthiness form then tests.

Everything else — content, layout, documentation — needs no client behavior and stays static DSD, shipping no JavaScript at all. That split is the whole runtime story: browser code exists only where a module declared it.

## Keyed lists and the update contract

A keyed list (an `each` region) reuses the DOM it already built. The runtime derives each item's identity with the canonical key rule — `` `${typeof}:${String}` `` over the declared key field — and a new array is diffed against the entries it already has: unchanged keys keep their nodes, new keys build, missing keys dispose. Two boundaries follow from that, both deliberate:

- **Identity is the key, values are read from the item.** An entry is re-rendered from the item object it currently holds; when an update hands back the *same* object reference, its slots are already the projection of that object and the slot walk is skipped entirely.
- **Mutating an item in place is outside the reactive contract.** Reassigning `rows[3].label` changes an object the runtime has no reason to re-read — the same reference-comparison boundary a `signal()` holding an object draws. The supported shape is to produce a new item (`{ ...row, label }`) or a new array, which is what the runtime diff is built to notice. This is a performance boundary, not an accident: it is what makes the common update proportional to what actually changed.

## Measuring updates: the afterframe floor

The JFB harness (`benchmarks/jfb`) times a click the way the upstream benchmark does — afterframe, meaning one `requestAnimationFrame` plus one `MessageChannel` task. That protocol has a floor of its own: an afterframe round-trip with **no DOM work at all** measured ~12.8 ms (median) on this repo's runner, which is scheduling and event-loop cost, not runtime work. A reported number such as "swap 1000 rows ≈ 26 ms" therefore contains that floor; the part the runtime owns is the synchronous segment between the click and the handler returning (~3 ms on the same run, with the keyed-list walk dominating it). When reading any benchmark number, compare the sync segment first — the afterframe total can move several milliseconds either way without the runtime having changed a line.

## See also

- [Routing and Data](/guide/routing-and-data) — pages, loaders and actions on top of these elements.
- [Getting Started](/guide/getting-started) — the three commands that create a project.
- [DSD Rendering](/architecture/dsd) — how Declarative Shadow DOM carries the server output.
