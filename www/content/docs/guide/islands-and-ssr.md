---
title: 'Islands and SSR'
lede: 'SSR and DSD provide the document baseline. Islands add client behavior at declared boundaries.'
order: 90
---

## Light DOM, DSD, SSR and islands

The terms that run through this guide are not competing defaults: they answer two different questions — **where a component's markup lives** (a root choice: light DOM or shadow DOM) and **what happens in the browser after the HTML arrives** (DSD, SSR, islands).

| Term | What it is | What it decides |
| --- | --- | --- |
| Light DOM | the component renders its children into the document tree itself | no style boundary: the page's styles reach the children directly |
| Shadow DOM | the component renders into a shadow root it owns | a style boundary: outside class selectors do not reach the component's children |
| DSD (Declarative Shadow DOM) | the platform HTML format that carries a shadow root as markup — a `<template shadowrootmode="open">` the browser parses natively | the shadow content exists before any client JavaScript loads, with no framework involved |
| SSR | rendering a page to HTML on the server: at build time for static routes, per request for `renderIntent: { mode: 'dynamic' }` routes | what the first response contains |
| Islands | a per-module opt-in for client delivery, declared next to the component | whether and when a component's chunk is fetched and its behavior binds |

**Root: light or shadow.** A generated element pairs a default-exported function component with a `defineIslandConfig` sidecar. Its `root` field chooses where the content renders: `light` is the default, `shadow` declares an open shadow root, and `closed` declares an encapsulated shadow root. Shadow roots are delivered as Declarative Shadow DOM; the compiler produces the component either way, while the choice changes styling reach — neither mode is “the interactive one.”

**DSD is a browser format, not a client framework.** Declarative Shadow DOM is a platform HTML format: `<template shadowrootmode="open">` is parsed into a real shadow root by the HTML parser, without script; a closed root uses `shadowrootmode="closed"`. The generated markup uses DSD as the wire format for shadow-root components, so it is readable and styled before any client module is fetched. DSD says nothing about interactivity: a DSD component can be completely static.

**Server HTML, then browser upgrade.** The server serializes the compiled component to HTML — at build time for static routes, per request for dynamic ones. Light DOM is already part of the document; DSD is parsed into a shadow root. For a declared island, the generated client module defines its Custom Element and the browser upgrades it: the compiled claim applies the same program to the DOM that is already there and binds the handlers the template declared. The sidecar's `properties` rows define any host-facing property and attribute channels. No tree is rebuilt, no binding is looked up by string, and no event is synthesized from a `data-*` attribute. Components without a client module keep their server-rendered markup and styling.

**Islands are WHERE and WHEN, not a rendering mode.** An island is a module that opts into client delivery with `defineIslandConfig({ hydrate, ssr, dsd })`; `hydrate` selects when the browser imports it — `load`, `idle`, `visible`, `media` or `only` — and the build records which islands each page reaches, so a page fetches only the chunks its own manifest names. An island uses the same generated function-component form as a static component and can render into light DOM or a DSD shadow root; `ssr` and `dsd` say whether the server serializes it at all, and `only` skips SSR. What the island adds is the part that needs the browser: state, handlers, lifecycle.

The whole path, one stage per line:

```text
1  request
   │
   ▼
2  server render — at build time for a static
   route, per request for a dynamic one
   │  emits
   ▼
3  HTML — light DOM, or DSD for a declared
   shadow root
   │
   ▼
4  browser parse — DSD becomes a real shadow
   root with no script
   │
   ▼
5  Custom Element upgrade — only for an island
   whose generated client module ships: the
   claim reuses its existing DOM
   │
   ▼
6  interaction — the island chunk loads per
   its declared strategy, then state and
   handlers run
```

Steps 1–4 reuse what the server produced: no client work, and the HTML is already the page. Step 5 needs a client module only for a declared island — and it reuses the existing DOM rather than rebuilding it. Step 6 is the only island-specific step: it runs where a module declared a `hydrate` strategy, and a page with no interactive island executes no island chunk of its own.

The honest caveats: "no client work" means none needed to render or read the page, not that zero bytes are ever executed — while an app declares any island or enhanced form, one small app-wide claim bootstrap still runs on static pages, and a page whose manifest carries a client-activatable island also preloads the shared element-runtime chunk ([Small runtime](#small-runtime) below prices both). And "no rebuild" describes the upgrade path, not a promise that nothing ever updates: after upgrade, a signal change re-renders only the compiled Parts that read the changed value.

## Server first

Every route renders to HTML at build time by default. The output is ordinary declarative markup: content components are serialized as light DOM by default, or as shadow roots the browser parses without script when the component declares a shadow mode; style sheets are inlined (scoped with `@scope(<tag>)` for light roots), and the document is styled and readable before a single client module is fetched. A page whose markup is static therefore stays static even if the network is slow, the module fails to load or JavaScript is disabled.

Page-scope components — compiled modules that live outside the islands directory and are composed into pages by tag — are server-rendered only, and that is the contract, not a degradation. None of their component code ships to the client: the browser receives their server-rendered markup, in light DOM or DSD according to the sidecar root, and never upgrades them, so they have no lifecycle, handlers or context at runtime. Anything that must react in the browser takes the island form and pays for exactly that boundary. The [compiled module grammar](/guide/compiled-grammar) covers how each form is discovered — page-scope components through the route import chain as default exports, islands through the page/island template scan with no import needed.

A page that genuinely cannot be prerendered declares `renderIntent: { mode: 'dynamic' }` and renders per request through the generated `dist/server` entry. It is still the same compiled program — a loader supplies the data instead of the build — so moving a page between static and dynamic changes where it renders, not how the markup is produced. A page that keeps a static GET but exports an action stays prerendered and dispatches only its POSTs to the server.

## Declared islands

Client behavior is opt-in per module and visible in metadata, never inferred. An island declares its delivery next to the component it exports:

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

The default export is a function component; the `defineIslandConfig` sidecar declares its tag, root, host properties and delivery policy. `hydrate` selects when the module is imported — `'load'` for first-screen controls, imported and upgraded as early as possible, `'idle'` for work that can wait, `'visible'` for components that matter as they approach the viewport, `'media'` for capability-gated loading (the chunk loads only while the query declared in the island's `media` field matches), and `'only'` for browser-only components that skip SSR. `'none'` delivers only server HTML: the server still serializes the component, but the build never emits its chunk, so the component costs zero client JavaScript while keeping its island manifest entry. `ssr` and `dsd` state whether the server serializes the component at all. The build records the result per page, so an island that a page never reaches is never executed.

The upgrade itself is the browser's Custom Element mechanism. The compiled server renderer produces Declarative Shadow DOM. Once the browser defines the generated element, the claim function binds the template's handlers to the existing DOM. Attribute-backed values come from the sidecar's `properties` declarations. No tree is rebuilt, no binding is discovered by string lookup, and no event is synthesized from an attribute.

## Late hosts

A declared island's host does not have to exist when the page's ready scan runs. A third-party component, another island's render, or application code after an async fetch may create it later — inside an open shadow root or in the light DOM. While this page still has a declared island whose factory nobody has consumed, the scheduler re-runs the same page-scope scan on a bounded schedule: at most six attempts per 3000 ms window, at most three windows renewed only by island-module load activity, and a 9000 ms absolute cap checked at every probe entry and every continuation window. A suspended or throttled page therefore cannot activate a host past the cap. A host found inside the budget activates through its declared strategy and fires the same `open:ready` event; the scheduler only re-asks for the host, so `load()`'s host gate — and with it "an island a page never reaches is never fetched" — stays the only activation decision.

Both strategies that otherwise get a single chance are covered. After an `'idle'` page's idle attempt runs without a host, the deferred step arms the same bounded search (the load itself still goes through the browser's idle scheduling); a `'media'` page whose query turns matching while the host is still missing arms it from the query's change listener. If the budget expires with declared islands still unactivated, the scheduler dispatches one informational `CustomEvent('open:island-host-timeout')` on `document` whose `detail.pending` names the tags. That event is a hint, not an error — declaring an island a page never hosts is legitimate — and a later explicit rescan or media change can still activate those tags.

## Light islands

An island's root is declared in its `defineIslandConfig` sidecar: `root: 'light'` puts its children in the document tree, while `root: 'shadow'` or `root: 'closed'` delivers them in Declarative Shadow DOM with an open or closed shadow boundary. The same setting controls the component's style boundary:

```tsx
export const openElement = defineIslandConfig({
  tag: 'status-panel',
  hydrate: 'visible',
  root: 'light',
});
```

The sidecar is the authored root declaration used by the generated-element compiler and the Router's island delivery path, so the build stages share one tag and root fact.

Generated light roots can project named and default children during SSR, including the selected output of a conditional or list. That server HTML is correct, and an unexpanded nested host keeps the original `oe:when` and `oe:each` fallback markers. Interactive projection through a generated light root is not supported yet: the parent and child claims would both need to adopt the same nodes. SSR marks the projected host, and either island upgrade stops with `OEIR_LEAF_UNSUPPORTED_LIGHT_SLOT_PROJECTION` before claiming it. The guard also applies when a conditional or list is initially empty but can produce children after an update. For interactive projected content, give the child a shadow root and use native `<slot>` elements; otherwise keep the composition server-rendered only.

Light islands are the practical route for utility-first styling. A shadow root is a style boundary — class selectors authored outside it do not reach the component's children — so a shadow island needs compiler-side utility extraction to bridge it, while a light island's children are ordinary document nodes that the page's compiled sheet already styles. What it gives up in exchange is the isolation the shadow root would have provided.

## Small runtime

What ships is the set of island chunks a page declares plus the generated claim code — there is no framework runtime that every page must load. A page with no interactive module executes none of its island chunks; while the app has any island (or enhanced form), a small app-wide claim bootstrap — about 2 KB gzipped — is the one script such a page executes. Fetched and executed are different costs: a link target's chunks can be prefetched before the reader follows the link, and any page whose manifest has a client-activatable island `modulepreload`s the shared element-runtime chunk (about 29 KB gzipped in the www build) even when every island on it is `'visible'` — the runtime is fetched and parsed up front, while the island's own chunk stays deferred until its host activates.

That budget is the reason the static surface matters. Anything that can be expressed as markup — content, layout, documentation, even fully styled interactive-looking components — should stay static DSD; islands are reserved for state and browser APIs. Component code is identical in both cases, so the decision is a one-line declaration rather than a rewrite, and it can be revisited when the component's real requirements become clear.

## See also

- [DSD Rendering](/architecture/dsd) — the platform contract behind the server output.

## Architecture: Islands and SSR

## Static surface

The server emits a complete document: page markup, style sheets scoped to their hosts, and each component's content inside a Declarative Shadow DOM template (`<template shadowrootmode="open">`) — or directly in the DOM when the component declares a light root. The browser parses all of it natively, so the page is readable, styled and crawlable before any framework module is fetched.

Every component is classified into one of four layers, and the layer decides what the server writes and what a client module later claims:

- `dsd-static` — serialized as DSD; no client module ever loads it.
- `dsd-interactive` — serialized as DSD; the compiled claim binds behavior on upgrade.
- `light-dom` — compiled light root; no shadow boundary, so document styles apply directly.
- `pure-island` — browser-only; the server writes the host tag and its serialized props, and the client owns rendering.

The same classification admits third-party elements (standard Custom Elements, Lit, FAST, Stencil) at build time with actionable diagnostics, rather than letting an unrenderable component through.

## Hydration boundary

The boundary is declared, not discovered. An island module opts in next to the component it exports with `defineIslandConfig({ hydrate, ssr, dsd })`, and the build records the outcome per page in an island manifest: one JSON artifact per page carrying the route and, for each island, its tag, chunk URL, layer and strategy. The generated client entry imports only the modules that page declares, so a page's client graph is a direct consequence of its own metadata.

Because the manifest is emitted next to the HTML, the built output answers "which JavaScript does this page load, and when?" without opening the client bundle.

## Progressive behavior

The generated claim function binds the template's handlers to existing DOM and reads host attributes declared in the sidecar. A client-only island mounts for the first time.

The strategy decides when the chunk is fetched — `load`, `idle`, `visible`, `media` or `only`. A `media` island declares its query in the island's `media` field, and the chunk loads only while that query matches. Until it arrives, the element keeps its server markup and its styling: the page never depends on an island having loaded, and an island that is never reached costs nothing beyond its own chunk.

## Upgrade Model

The compiler emits server rendering, client mounting and claim functions from the same component. Each island has its own loading strategy. The app can also load a shared bootstrap.

openElement uses the browser Custom Element upgrade mechanism. SSG writes HTML first, then the generated client entry imports only the island modules used by the current page and registers their compiled classes.

## Four Layers

### Layer 1 — `dsd-static` — No client JavaScript

Static Web Components render as DSD during SSG. They remain visible and styled even when no client module runs.

### Layer 2 — `dsd-interactive` — DSD plus compiled claim

The generated server renderer emits DSD. On upgrade, the generated claim function binds event handlers to existing DOM.

### Layer 3 — `pure-island` — Client-owned shadow root

Browser-only components can opt out of SSR with the `only` strategy. The server emits the host tag and its serialized props; the client owns rendering.

### Layer 4 — `light-dom` — No shadow boundary

A component that declares a light root renders its content into light DOM with no DSD encapsulation, so document-level styles apply directly. The compiled default is a light root; a shadow root is opt-in per component. Hydration strategies still apply to such islands.

## Strategies

- `load` — Import immediately for first-paint controls such as navigation and theme.
- `idle` — Import during idle time for non-critical interactive components.
- `visible` — Import when the island approaches the viewport.
- `only` — Skip SSR for browser-only components that cannot produce reliable DSD.

## Props Are Not Events

Host attributes and serialized props restore into the island's compiled `@property` fields on upgrade; the claim does not invent events from them. Events exist only where the compiled template declared a handler.

## Dynamic Content

Dynamic island content comes from signal-driven `@property` state inside the compiled template. HTML injection stays behind the explicit `trustedHtml` boundary for pre-sanitized, non-interactive content only.
