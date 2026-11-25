---
title: 'The compiled module grammar'
lede: 'The authoring grammar of the generated-element lane: what the compiler admits into a component module, and what it refuses instead of falling back at runtime.'
navLabel: 'Module grammar'
order: 15
section: 'Core'
---

Every compiled component is one module that default-exports a function component beside a `defineIslandConfig` sidecar. The compiler lowers that pair into a Native Custom Element — a constructor that builds the authored tree, plus, for a shadow root, the host producer the server renders. The grammar is closed: a construct the compiler cannot lower fails the build with a coded diagnostic instead of shipping a runtime interpreter. This page is the cheat sheet — the laws in one table, then each law with a working example and the shape that fails.

## The laws

| Law | The compiler admits | The compiler rejects |
| --- | --- | --- |
| One component per module | one default-exported function component plus its `defineIslandConfig` sidecar | a class default export or a module with no default-exported function (the lane declines it); a default-exported function that is not a component (`OEC9040`) |
| The sidecar is identity | `tag`, `root: 'light' \| 'shadow' \| 'closed'` | invalid root values (`OEIR_GENERATED_ELEMENT_ROOT_INVALID`) |
| Props are a declared table | a typed props parameter whose members match `properties` one-for-one | a typed member with no sidecar row, or a sidecar row with no typed member (`OEIR_GENERATED_ELEMENT_PROPERTY_MISMATCH`) |
| Only primitives take the attribute channel | `string`, `number` and `boolean` rows | an array, object or `trustedHtml` row without `attribute: false` (`OEIR_GENERATED_ELEMENT_PROPERTY_INVALID`) |
| Module scope is imports, the sidecar and the component | imports, `export const openElement`, the default export | a module-local `const` or `function` the component body reads (`OEIR_GENERATED_ELEMENT_UNBOUND_BINDING`) |
| Setup declares state, one return | `signal(...)`, `computed(...)`, `const` bindings, arrow helpers, intrinsic calls, one final `return` | a nested `function` declaration, an `if` statement or a second `return` (`OEC9041`) |
| The body returns one JSX element | exactly one returned JSX element | a string or other non-JSX return (`OEC9040`) |
| JSX composes by tag | intrinsic tags, custom-element hosts, a component declared in this same module | a component imported from another module (`OEIR_LEAF_UNKNOWN_COMPONENT`) |
| Attributes are JSX expressions | literal values, and dynamic `attribute` / `boolean` / `property` / `event` / `ref` channels | a spread (`OEC9042`); a dynamic `class` or `style` channel (`OEIR_LEAF_UNSUPPORTED_ATTRIBUTE`) |
| Branches are JSX or null | `{cond ? <b/> : <i/>}` and `{cond ? <b/> : null}` | a text branch, a nested ternary (`OEC9042`) |
| `innerHTML` is out of this lane | nothing — see below | any `innerHTML` sink (`OEC9044`) |
| Lifecycle is intrinsic calls in root setup | `onConnect`, `onDispose`, `onPropertyChange`, `onError` in the root body | a hook no retained body owns (`OEIR_LEAF_INVALID_ARTIFACT`) |
| A page is a server function | the route module's own exported component wrapped by `definePage` | a local `const` before the return, an event handler, an imported component as JSX (`OEC9031`, `OEC9032`) |

## One component per module

A module is one component. The component is the default export; the sidecar is named `openElement`. Shared helpers, tables and constants live in plain modules and are imported — a compiled module's body may read imports but not its own module-local declarations, so a local `const` is not a private helper.

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
// The compiler requires a default-exported function.
export function MyCard() { return <article></article>; }

// refused: a default-exported function that returns a non-JSX value — OEC9040
export default function MyCard() { return 'not a component'; }
```

## The sidecar declares identity and root

The sidecar's `tag` names the custom element and `root` selects where its content renders. `'shadow'` is an open declarative shadow root, `'closed'` an encapsulated one, and `'light'` renders into the document tree.

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  // Identity lives here, not on a decorator: the lane reads this table as the
  // element's whole declaration.
  tag: 'my-badge',
  root: 'light',
  properties: { tone: { default: 'neutral' } },
});

export default function MyBadge(props: { tone: string }) {
  return <span class='badge'>{props.tone}</span>;
}
```

`root` also decides what the build can emit for the module. A shadow root gets a compiler-owned host producer (`<Name>__ssrHost`) that the server renders into a `<template shadowrootmode>`; a light root gets none, because there is no template to produce. That asymmetry is why a light-root component can be nested in a page but cannot itself be a generated page root — a light *page* uses the server-function form below.

```text
// emitted shape, shadow root: a content-only <Name>__ssr plus a host producer
export function MyCard__ssrHost(props, lightChildren) { … }

// emitted shape, light root: no host producer at all
// (nothing to wrap — the children are ordinary document nodes)
```

## Props are a declared table

A component's inputs cross exactly one channel: the typed `props` parameter, whose every member must have a `properties` row in the sidecar, and whose every row must name a typed member. The parameter is a named, non-generic, locally written object type — a destructured or rest parameter, an optional member, and an imported or generic type are all outside the grammar, because a shape the compiler cannot read would silently drop out of the property channel.

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'my-counter',
  root: 'shadow',
  properties: {
    // A primitive row defaults to its type's zero value when omitted; naming it
    // documents the seed the server and the browser both start from.
    start: { default: 0 },
  },
});

export default function MyCounter(props: { start: number }) {
  return <div class='counter-row'><span id='count'>{props.start}</span></div>;
}
```

```text
// rejected: the typed member `other` has no sidecar row — PROPERTY_MISMATCH
export default function MyCounter(props: { start: number; other: number }) { … }

// rejected: a sidecar row the props parameter never declares — same diagnostic
export const openElement = defineIslandConfig({
  tag: 'my-counter',
  properties: { start: { default: 0 }, extra: { default: '' } },
});
```

### Which rows take an attribute

A row's `attribute` channel is the attribute side of the property: `reflect: true` writes back, `attribute: false` declares a property with no attribute at all, and an omitted `attribute` derives the kebab-cased name. Only `string`, `number` and `boolean` are admitted — no converter, no array or object wire — so a non-primitive row must say `attribute: false` explicitly instead of leaving the build to guess a JSON encoding.

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
    // No attribute or JSON wire carries a row list: the value arrives through
    // the props projector, so the row declares itself property-only.
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
// rejected: a non-primitive row with no explicit attribute: false — PROPERTY_INVALID
export const openElement = defineIslandConfig({
  tag: 'my-list',
  properties: { rows: { default: [] } },
});
```

## Module scope is imports, the sidecar and the component

A compiled module declares three things: its imports, the `openElement` sidecar, and the default-exported component. State, contexts and shared tables belong in plain `.ts` modules — and they must be *imported*, because an identifier a module declares for itself is treated as an unbound host binding rather than a captured local.

```ts
// app/lib/lab-context.ts — a plain module owns module-level state, the token,
// and the binding tables a compiled component cannot carry itself
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
  // `labA` is imported, so the reference resolves to module scope; a `const`
  // declared in THIS file would be an unbound binding and fail the build.
  return <p>{props.summary} — lab A at {labA.value}</p>;
}
```

```text
// rejected: top-level state in the component module — the body's read of
// `count` becomes an unbound host binding, OEIR_GENERATED_ELEMENT_UNBOUND_BINDING
const count = signal(0);

// rejected the same way: a module-local helper the body calls
function helper(): string { return 'a'; }
```

The second half of that rule is about *reads*. A module-local declaration the component body never touches is inert and harmless; the build only refuses an identifier the body actually reaches.

## Setup declares state, one return

The component body is a setup function, not a general method. It may declare `signal` and `computed` values, plain `const` bindings, arrow helpers, and the lifecycle intrinsics — then it ends with one `return` of one JSX element. A nested `function` declaration, an `if` statement, or an early return are outside the admitted statement grammar.

```tsx
import { computed, signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'my-profile', properties: { name: { default: '' } } });

export default function MyProfile(props: { name: string }) {
  // Signals live in setup scope: the runtime keeps this record for the whole
  // element lifetime, so a reconnect re-reads the same source.
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
// rejected: a nested function declaration — OEC9041
export default function MyProfile() { function fmt(v: number) { return String(v); } return <p>{fmt(1)}</p>; }

// rejected: control flow before the return — OEC9041
export default function MyProfile() { if (ready) return <b>a</b>; return <i>b</i>; }

// rejected: no JSX return at all — OEC9040
export default function MyProfile() { return 'hello'; }
```

Note what is *not* restricted here: a `const` computed from props before the return is admitted (`const text = props.label + '!'`), and an arrow helper is admitted where a `function` declaration is not. The two lanes differ on purpose — the function frontend admits expression-shaped setup, not statement-shaped setup.

## JSX composes by tag

Markup names HTML tags, custom-element hosts and same-module components. A custom-element host is looked up by its registered tag, so the host module imports the child's module to register it; a sibling component declared in the same file is admitted by identifier. A component imported from *another* module is not: cross-module component composition is outside this slice.

```tsx
import { defineIslandConfig } from '@openelement/router';
import './my-counter.tsx';

/** A same-module child: declared here, so the lane can read its props shape. */
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
// rejected: a component imported from another module used as a tag —
// OEIR_LEAF_UNKNOWN_COMPONENT (declare it here, or host it as <my-child-card>)
import { ChildCard } from './child-card.tsx';
export default function MyDashboard() { return <div><ChildCard /></div>; }
```

## `innerHTML` is out of this lane

The generated lane has no `innerHTML` sink. The `trustedHtml` capability contract was a class-authoring mechanism, and the function frontend refuses the sink outright rather than shipping a weaker trust rule. A component that must inject first-party markup belongs on the server-function page lane, which does admit the sink.

```tsx
// app/routes/post.tsx — a server function page, the ONE form that admits innerHTML
import { definePage } from '@openelement/router';
import { type TrustedHtml } from '@openelement/element';

export function PostPage(props: { title: string; html: TrustedHtml }) {
  return (
    <main>
      <h1>{props.title}</h1>
      {/* post.html is markdown authored in this repo — the trust decision is
          made where the value is produced, not at the sink. */}
      <article class='post-body' innerHTML={props.html} trustedHtml></article>
    </main>
  );
}

export default definePage(PostPage, { head: { title: 'Post' } });
```

```text
// rejected in a generated component — OEC9044, the sink is not admitted there
export default function MyArticle(props: { body: TrustedHtml }) {
  return <div innerHTML={props.body} trustedHtml></div>;
}
```

## Text is an expression

A text position admits an expression: a property read, a signal read, a method call, arithmetic. The compiler lowers it into a tracked slot, so it refreshes when the value it reads changes and refreshes nothing else. Keep the expression cheap and total — it runs on every update of what it reads, and it must not throw, because a throw in an update-phase write escapes to `onError`.

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

A text expression creates a reactive slot and updates independently of its surrounding DOM. A derived value used in more than one place is still better as a `computed` so the derivation runs once.

## Branches are JSX or null

A conditional lowers to a `when` block, so each branch is one JSX element — or `null` for absence. A text branch and a nested ternary are refused: neither has a representable branch shape, and folding them into one condition is the fix.

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
// rejected: a text branch is not a block branch — OEC9042
export default function MyStatus(props: { ready: boolean }) { return <div>{props.ready ? 'yes' : 'no'}</div>; }

// rejected: one condition per block; a nested ternary has no representation — OEC9042
export default function MyStatus(props: { ready: boolean }) { return <div>{props.ready ? (props.busy ? <b>a</b> : <b>b</b>) : <i>c</i>}</div>; }
```

## Handlers are functions

A handler attribute takes a function value: an inline arrow or a function read from setup scope. The runtime binds it when the element upgrades and invokes it with the DOM event. The value is evaluated while the component body runs, so `onClick={props.on()}` does not name a handler — it *calls* `props.on` during setup, and the value it returns becomes the handler. That still compiles; the mistake is semantic, so pass a reference.

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

The props table accepts `on` as an ordinary member. What is still true is that the handler position takes a function — a call's return value is not a handler.

## Attributes are literals or admitted channels

An attribute on an intrinsic element is either a literal or one of five dynamic channels: `attribute`, `boolean`, `property`, `event` and `ref`. That set is the whole list — `class` and `style` are literal-only, because a computed class or style needs a channel the leaf slice does not install, and asking for one fails closed with `OEIR_LEAF_UNSUPPORTED_ATTRIBUTE` instead of emitting a rule that would never apply. A spread is refused for the deeper reason: its key set is a runtime fact, so the server and the browser have no common form to agree on.

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'my-link',
  properties: { href: { default: '/' }, active: { default: false } },
});

export default function MyLink(props: { href: string; active: boolean }) {
  return (
    // `class` stays a literal; the dynamic facts ride the `attribute` channel.
    // A computed class would need a channel this lane does not install.
    <a class='link' title={`See ${props.href}`} href={props.href} data-active={props.active}>
      Docs
    </a>
  );
}
```

```text
// rejected: a spread has no serializable form — OEC9042
export default function MyLink(props: { href: string }) { return <a {...props}>Docs</a>; }

// rejected: `class` and `style` take literals only — a dynamic value is outside
// the leaf slice, OEIR_LEAF_UNSUPPORTED_ATTRIBUTE
export default function MyLink(props: { active: boolean }) {
  return <a class={props.active ? 'link link-active' : 'link'}>Docs</a>;
}
```

## Lifecycle is intrinsic calls in root setup

Import lifecycle intrinsics from `@openelement/element` and call them at the top level of the component body. The compiler lowers them into the retained instance factory. `onConnect` runs on each connection before the generated body mounts fresh DOM or claims server markup. Its returned cleanup runs on disconnect. `onDispose` runs when the retained instance is torn down. The compiler admits nested hooks in retained hostless bodies and rejects hooks without a retained owner with `OEIR_LEAF_INVALID_ARTIFACT`.

```tsx
import { onConnect, onDispose, useHost } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'my-probe', root: 'shadow', hydrate: 'visible', ssr: true });

export default function MyProbe() {
  // This callback receives the host element.
  const host = useHost();

  onConnect((env) => {
    host.setAttribute('data-ready', '1');
    // The per-connection signal aborts before connection cleanups on disconnect.
    env.signal.addEventListener('abort', () => host.removeAttribute('data-ready'));
  });

  onDispose(() => {
    host.removeAttribute('data-ready');
  });

  return <span class='probe'>probe</span>;
}
```

`onPropertyChange(cb)` runs after a declared row commits a new value, and `onError(cb)` handles errors for the element. Read the owning element through a setup binding (`const host = useHost()`). To access a DOM node from a callback, pass a `ref()` handle to the node's JSX `ref` attribute. Its `current` is set on attach, cleared on detach, and can be read in callbacks without creating a reactive subscription.

```tsx
import { onPropertyChange, ref } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'my-field', properties: { value: { default: '' } } });

export default function MyField(props: { value: string }) {
  const input = ref<HTMLInputElement>();

  onPropertyChange((event) => {
    // `name` and `value` are the committed row — the change channel the class
    // lane spelled as a property setter.
    if (event.name === 'value' && input.current) input.current.value = String(event.value);
  });

  return <input ref={input} value={props.value} />;
}
```

### The error boundary is element-scoped

`onError(cb)` is the author-facing boundary of **one generated element**. It runs when a value escapes that element's own work: the connect/claim pass (mount, claim, setup and the `onConnect` replay) or an update-phase write (a tracked slot refresh, or a DOM event handler dispatched inside the compiled body). Each generated element handles its own errors.

```tsx
import { onError } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ tag: 'my-widget', hydrate: 'idle', ssr: true });

export default function MyWidget() {
  onError((env) => {
    // `env.error` is the thrown value exactly as thrown, never wrapped; a
    // handler that itself throws REPLACES it as the error that surfaces.
    env.host.setAttribute('data-failed', '1');
  });

  return <p>widget</p>;
}
```

A catching handler changes only whether the error escapes. A connect-phase failure still leaves the element in its defined post-failure state (no projection, no listeners) and a later reconnect retries from scratch; an update-phase failure leaves the previously written DOM in place with the subscription still live. With no registered handler, the throw surfaces unchanged. The callback is client-owned: it is erased into the compiled module and never runs during a server render.

## A page is a server function

For a page, the route module declares the component itself and wraps it with `definePage`. The function is exported from this module, passed by identifier, and lowered by the server-function lane into a generative HTML constructor — so it is server-only by construction and ships no component state. This is the form a light-root page uses, because a light generated component has no DSD host producer to be a page root.

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
// The descriptor is data, not markup: head, renderIntent, props and error are
// the whole surface — there is no render() field.
export default definePage(AboutPage, {
  head: { title: 'Hello — my-app' },
});
```

```text
// rejected: a local const before the return — a server function component is
// one return of one JSX element (OEC9032)
export function AboutPage(props: { title: string }) { const t = props.title + '!'; return <main>{t}</main>; }

// rejected: event handlers are a client-only construct — interactivity belongs
// to an island module (OEC9031)
export function AboutPage() { return <button onClick={() => {}}>x</button>; }

// rejected: a server function component composes by direct call, not by a JSX
// reference to an imported component (OEC9032)
export function AboutPage() { return <main><Child /></main>; }
```

A page that needs state, handlers or lifecycle is not a server function page: it is a route module that wraps a compiled component, and that component is an island if it must run in the browser. [Islands and SSR](/guide/islands-and-ssr) states the shipping contract each form buys.

## See also

- [Core Concepts](/guide/core-concepts) — the element and slot model these laws lower onto.
- [Error Handling](/guide/error-handling) — where the codes above are catalogued with their contracts.
- [Error codes](/errors) — the generated reference table for every `OEC9xxx` diagnostic.
