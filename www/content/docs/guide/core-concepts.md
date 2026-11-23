---
title: 'Core Concepts'
lede: 'The core model is standards-first: authored function components, declarative rendering, file routes and optional islands.'
order: 10
---

## The component model

A component is a module that default-exports a function beside a `defineIslandConfig` sidecar. The compiler lowers that pair into a **Native Custom Element** — a real constructor the browser upgrades — so the output is a standard custom element with no virtual-DOM runtime and no interpreter shipped to the browser. A construct the compiler cannot lower fails the build with a coded diagnostic instead of falling back to a runtime render path.

The sidecar carries the two facts a function cannot express: the custom-element `tag`, and the `root` its content renders in (`'light'`, `'shadow'` or `'closed'`). Reactive inputs are declared once, in the sidecar's `properties` table, and read in the component as plain typed props.

```tsx
import { computed, signal } from '@openelement/element';
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'my-counter',
  root: 'shadow',
  // Every row here is one declared property: the tag, the attribute channel
  // and the initial value all live in this one table.
  properties: {
    count: { reflect: true, default: 0 },
    label: { default: '' },
  },
});

export default function MyCounter(props: { count: number; label: string }) {
  // Local state is a signal in setup scope; the runtime keeps this record for
  // the element's whole lifetime, so a reconnect re-reads the same source.
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

The attribute is the default channel, named after the kebab-cased property; `attribute: false` opts a row out for values that must never be serialized into markup, and `reflect: true` writes a property change back to the attribute. Only `string`, `number` and `boolean` rows are admitted — no converter, no array or object wire — so a non-primitive row must declare `attribute: false` and arrive through the props projector. A derived value is a `computed(...)`, read as `.value` at the places that use it. `signal()` sits behind both: `computed()` derives from it and `effect()` subscribes to it; all three are exported from `@openelement/element`.

A state change refreshes only the slots and attributes that read the changed value. Event handlers written in the template (`onClick`, `onInput`) are bound when the element upgrades; nothing is looked up by string at runtime. Server-side, the same compiled component is serialized to markup by `renderToString`, so there is one program behind both outputs rather than two renderers that can drift.

### Shadow root behavior: delegatesFocus

`defineIslandConfig({ root: 'shadow', delegatesFocus: true })` declares the shadow root with `delegatesFocus`. Focus moving into the host is then delegated to the first focusable element inside the shadow tree, and the host itself matches `:focus`. What that buys is the ENTRY half of a composite widget's focus story, and only that half: the initial focus lands where the control wants it instead of on the host element. It is not a focus trap — Tab still leaves the host for the next tabbable in the document — and it is not a keyboard model. A dialog that must contain focus, a menu that answers arrow keys, a composite field that manages a roving tabindex: each of those is still yours to write, on top of the delegation. It applies to shadow roots only, so `delegatesFocus: true` beside `root: 'light'` fails closed with `OEIR_GENERATED_ELEMENT_DELEGATES_FOCUS_WITHOUT_SHADOW`.

### Form participation: formAssociated

`defineIslandConfig({ root: 'shadow', formAssociated: true })` associates the host with the surrounding native form through `ElementInternals` when it connects. The host becomes a form control: it appears in `form.elements`, participates in submission and `form.reset()`, and receives `form`, `name` and `value` semantics. The form value is the declared string property named `value`, with optional boolean `required` and `disabled` properties enabling the required/value-missing mirror and the fieldset-disabled state — there is deliberately no separate `formValue` field, because one declared property is the source. Because association is a platform contract rather than a framework one, put the interactive control inside the shadow root and keep the host's own attributes for the form-facing name and value; the runtime does not invent a form value for you.

### Which property channel a row gets

The sidecar row is the declaration; the TypeScript type cannot express the platform facts, so it does not try. `reflect: true` mirrors a property write to the attribute, which requires an attribute channel — `reflect: true` with `attribute: false` is refused. An omitted `attribute` derives the kebab-cased name, `attribute: false` declares a property-only channel, and a string renames it (lowercased, and it must be a safe HTML attribute name). When a primitive row omits `default`, the shell applies the type's zero value; a non-primitive row requires an explicit literal default because there is no zero value to guess.

## DSD

Light DOM is one root choice, not the default that shadow overrides. A component whose sidecar declares `root: 'shadow'` or `'closed'` is served as Declarative Shadow DOM: component markup travels inside `<template shadowrootmode="open">` and the browser parses it natively, without script. Either way the content can paint and be read first — before any client module is fetched; handlers and signals bind when the element upgrades.

Interactivity arrives through the platform's own Custom Element upgrade: when the generated client entry defines the element, it claims the DOM that is already there, binds the handlers the compiled template declared, and fills declared properties from host attributes. Host attributes restore properties — they never invent events. An element whose module never loads still renders its markup, which is why a JS failure degrades to a static page instead of an empty one.

A light-root component renders its children into the document itself, so page styles reach them directly and no shadow boundary intervenes. That is also why a light-root component cannot be a generated page root: the server-side shadow template is produced by the compiler's host wrapper, and a light root has none. A light page therefore takes the server-function form — the route module's own exported component wrapped in `definePage`.

## Islands

An island is a module under the islands directory (`app/islands` by default) that opts into client delivery. It declares how it is delivered in the same sidecar as the component it exports:

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'idle', ssr: true, dsd: true });
```

`hydrate` selects when the browser imports the module — `'load'` for first-screen controls such as navigation and theme, imported and upgraded as early as possible, `'idle'` for everything else that can wait, `'visible'` for components that only matter as they scroll into view, `'media'` for capability-gated weight (the chunk loads only while the query declared in the island's `media` field matches), and `'only'` for browser-only components that skip SSR. The build records which islands belong to which page, so a page executes only the islands it activates; a page's manifest also decides whether its shared element runtime is `modulepreload`-fetched early, while a never-reached island's own chunk stays deferred.

An island is still one component with one program: a page-scope component that is not an island is server-rendered and never upgraded, so it has no lifecycle, handlers or context at runtime. Anything that must react in the browser takes the island form, and that declaration is the whole delivery decision.

## Conditional blocks and the expression bound

A conditional lowers a JSX conditional into a compiled `when` block rather than shipping a comparison for a runtime interpreter. Each branch must be one JSX element or `null` — a text branch and a nested ternary have no representable branch shape and fail closed with `OEC9042`.

The condition itself is an ordinary expression over declared props, signals and imports, evaluated where the block lives:

- `{props.count > 5 && <p>over</p>}` — an ordering comparison.
- `{props.status === 'pending' && <Spinner />}` — equality against any expression the module can read.
- `{props.ready && <Dashboard />}` and `{!props.ready && <Spinner />}` — truthiness, optionally negated.

A ternary is the two-branch spelling of the same test: `{props.status === 'pending' ? <Spinner /> : <Done />}`. Both branches stay JSX elements, so a text-only ternary is the one shape to avoid — derive the text with a `computed(...)` and interpolate `{value}` instead.

Why the bound is where it is: a branch has to lower to a serializable test that the server serializer, a fresh mount and an existing-DOM claim can all evaluate identically. That is what keeps the three paths byte-identical, and it is why the *branch shape* is constrained rather than the condition's arithmetic.

### Lists and the interaction boundary

A keyed list (an `each` block) reuses the DOM it already built: `props.rows.map((row) => <li key={row.id}>{row.label}</li>)`. The runtime derives each item's identity from the declared key field and diffs a new array against the entries it already has — unchanged keys keep their nodes, new keys build, missing keys dispose.

Two boundaries follow, both deliberate:

- **Event channels stay outside the list template.** A handler *inside* a per-item template needs a per-entry update hook, which this release does not ship; the compiler refuses it with `OEIR_LEAF_UNSUPPORTED_ATTRIBUTE` rather than binding a handler that would read a stale item. Put the handler on the surrounding element and let it read the item through state the list itself declares.
- **Identity is the key, values are read from the item.** An entry re-renders from the item object it currently holds; when an update hands back the *same* object reference, its slots are already the projection of that object and the slot walk is skipped entirely. Reassigning a field in place (`rows[3].label = …`) therefore changes an object the runtime has no reason to re-read — the same reference-comparison boundary a `signal()` holding an object draws. Produce a new item (`{ ...row, label }`) or a new array instead. This is a performance boundary, not an accident: it is what keeps the common update proportional to what actually changed.

## Measuring updates

The in-repo js-framework-benchmark harness was removed on 2026-10-03; the upstream benchmark lane lives on the fork.

## See also

- [Routing and Data](/guide/routing-and-data) — pages, loaders and actions on top of these components.
- [Getting Started](/guide/getting-started) — the {{QUICKSTART_COMMAND_COUNT}} commands that create a project.
- [DSD Rendering](/architecture/dsd) — how Declarative Shadow DOM carries the server output.
