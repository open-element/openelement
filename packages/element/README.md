# @openelement/element

Canonical component-authoring facade for the OpenElement 1.0 baseline.

Docs and guides: <https://openelement.org>.

This package exposes `OpenElement`, the product-facing base class for native
Web Components, running on the compiled Part Program kernel: one mandatory
compiler (`@openelement/compiler`) lowers each component's `render()` into
a serializable program consumed by server serialization, fresh DOM creation,
and existing-DOM hydration alike. Light DOM is the current compiled default;
Shadow/DSD is a first-class mode selected explicitly with
`@element(tag, { root: 'shadow-open' | 'shadow-closed' })`.

Also includes:

- `ErrorBoundary` — error boundary (`static isErrorBoundary = true`) that automatically captures subtree failures: on SSR a failed subtree evaluation renders the boundary's fallback branch in place of the failed subtree (the throw surfaces at the nearest boundary; without one the route still fails), and on the client descendant failures route to the nearest boundary's `catchError()` through three automatic capture points: authored platform lifecycle callback bodies (the compiler wraps `connectedCallback`/`disconnectedCallback`/`adoptedCallback`/`attributeChangedCallback`/`formAssociatedCallback`/`formResetCallback`/`formStateRestoreCallback` at compile time), post-activation Block update failures, and property writes whose signal-graph evaluation throws (the facade property setter — handler-driven and external writes alike; a handler body that throws without writing a property still needs its own try/catch). In a compiled module the subclass re-declares `hasError` as its own `@property`, sets it in `catchError()`, and branches on it with a fully static JSX ternary inside a single-return `render()` (the compiled grammar guide has the exact compilable shape — a plain `if (this.hasError) return …; return …;` with two returns does not compile, and neither does a branch containing a binding). `retry()` re-renders both the boundary and the captured source element, `reset()` clears the state entirely. Without a boundary, SSR keeps the bare-tag degradation and CSR keeps the per-element `onRenderError()` fallback
- `element` / `property` — compile-time-only decorator intrinsics: the compiler admits them by binding provenance and erases them from generated code; evaluated without the compiler they are inert no-ops
- Signals: `signal`, `computed`, `effect`, and the `Signal` type
- Context (`createContext` / `provideContext` / `consumeContext`), `StyleSheet`, HTML escaping utilities, and the `trustedHtml` explicit trust boundary

## Install

```bash
npm install @openelement/element
```

## Usage

Components are classes decorated with `@element` and compiled by the
`@openelement/router` build — there is no runtime registration call in
authoring source:

```tsx
import { element, OpenElement, property } from '@openelement/element';

@element('my-card', { root: 'shadow-open' })
export class MyCard extends OpenElement {
  @property({ reflect: false, attribute: false })
  title = '';

  render() {
    return (
      <article>
        <h2>{this.title}</h2>
      </article>
    );
  }
}
```

Instance properties decorated with `@property` are the reactive state contract;
the compiler wires them to the signal engine so server output, fresh DOM, and
claimed DOM share one identity model. Styles ship via `static styles` (a scoped
`StyleSheet`); raw-text `<style>`/`<script>` tags are rejected from templates.

The 1.0 baseline intentionally starts at the compiled class model. Historic
0.x authoring behavior remains available in Git history.

## Subpath exports

The package root is the authoring surface. Every other subpath is a deliberate
facade for one job. The two `internal/` spellings at the bottom of the table are
the compiler-contract pair M09-1b ships so a packaged generated Native Custom
Element resolves the same runtime a workspace build uses; they are emitted-code
import targets, not author API.

| Subpath                                | Import it for                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@openelement/element`                 | Authoring: `OpenElement`, `element`/`property`, signals, `ErrorBoundary`, `StyleSheet`, HTML escaping, `trustedHtml`.                                                        |
| `@openelement/element/jsx-runtime`     | Automatic JSX runtime target (`jsxImportSource`); typecheck-only — compiled output never calls the factories, they fail closed.                                              |
| `@openelement/element/jsx-dev-runtime` | Development JSX runtime target; same typecheck-only, fail-closed contract.                                                                                                   |
| `@openelement/element/authoring`       | Runtime guards shared by authoring layers (tag names, dangerous keys, error class, hydration strategies, action headers).                                                    |
| `@openelement/element/html`            | Pure document helpers: `escapeHtml`/`escapeAttr`, `wrapInDocument`, `trustedHtml` — no runtime kernel in the graph.                                                          |
| `@openelement/element/logger`          | The shared structured logger (`createLogger`, `createWarnScope`, `warnOnce`) without pulling in the compiled runtime.                                                        |
| `@openelement/element/build-utils`     | Build orchestration for adapters: JSON formatting, tag/path helpers, `SsrRenderError`, island transforms, runtime adapters.                                                  |
| `@openelement/element/client-only`     | The fresh-DOM runtime WITHOUT the existing-DOM hydration executor — selected by the Router for pages where no island can hydrate server DOM. Same public surface, ~9 KB smaller. |
| `@openelement/element/no-blocks`      | The hydrating runtime WITHOUT the when/each Block builders (#1548) — selected by the Router when the island blocks scan proves no admitted island module lowers a conditional or list Block. Same public surface; a Block Part reaching it fails closed (`OE_RUNTIME_BLOCK_BUILDERS_MISSING`). |
| `@openelement/element/base`            | Neither optional install: no hydration executor, no Block builders (#1548) — the `base` row of the per-feature floor table, for pages whose every island is client-only AND uses no Blocks. The Router's two-predicate selection lands here only on proof of both. |
| `@openelement/element/css-modules`     | Ambient `*.css` module type (#1558): the default export of an imported `.css` sheet is the cross-realm `StyleSheetLike`. Types-only — load it through tsconfig `types` (the vite/client pattern); it resolves no runtime module. |
| `@openelement/element/lifecycle`        | The compiler-erased intrinsics (`onConnect`, `onDispose`, `onPropertyChange`, `provideContext`, `ref`, `useContext`) with NO side effects and no path to the compiled executor (A16-LANE-M, M10-P1/P4). A side-effect-free subpath on purpose: the generated-element lane recognizes these calls by binding provenance and deletes them from the emitted module, so an author module importing them from the root entry would keep the root's `sideEffects` flag (and with it the generic executor) in the client graph for a binding compilation erases. Import them from here instead. Calling one at runtime still fails closed with the same identity as the root spelling — these are the same functions, re-exported. `ref(cb?)` declares a node handle (`const field = ref<HTMLInputElement>()`, then `<input ref={field} />`): the compiler builds the handle in the retained setup factory, so `current` survives mount, claim of server DOM and reconnect, and is cleared on detach. `provideContext(token, () => value)` and `const value = useContext(token)` are the scope-tree pair: the provider registers per owner on connect and republishes on a declared-property commit, and the consumer is one persistent signal a tracked slot reads, so nested providers shadow and a reconnect re-reads the nearest one. An element that READS a consumer is also server-renderable: its `__ssr` producer resolves the consumer from the nearest provider of the same owner tree (a per-call render scope threaded through the producer's own arguments, never module state), so the server bytes carry the provided value and the claim adopts them without a write. | — NOTE: the ROOT subpaths additionally export `onError` (16b-EB), which this side-effect-free subpath deliberately does not re-export; an author importing `onError` must use the root entry and no path to the compiled executor (A16-LANE-M, M10-P1/P4). A side-effect-free subpath on purpose: the generated-element lane recognizes these calls by binding provenance and deletes them from the emitted module, so an author module importing them from the root entry would keep the root's `sideEffects` flag (and with it the generic executor) in the client graph for a binding compilation erases. Import them from here instead. Calling one at runtime still fails closed with the same identity as the root spelling — these are the same functions, re-exported. |
| `@openelement/element/document-services` | The document-level services a client entry installs on EVERY page that ships client JS: `ensureDeepFragmentNavigation` (fragment navigation across nested shadow roots, #1090) and `ensurePreHydrationClickCapture` (the bounded pre-upgrade interaction capture a claiming island replays after activation). Its reason to exist is the executor-free page floor: a page whose islands are ALL generated-lane emits no `element-services` loader, so without this surface those two installers would silently stop running — measured on the live site before it landed (`#start` never got `data-open-target`). The installers are the SAME function objects the root entry exports, called by the generated entry (no module-scope side effect), and the reachable value closure is four modules with no executor entry: `internal/core/deep-fragment.ts` (zero imports) and the pre-upgrade capture, which used to reach `program-kernel.ts` for one throw and now calls the error façade origin with the same code, phase and message. |
| `@openelement/element/server`          | The server HTML constructor helpers (`__h`/`__t`/`__ssr`) a compiled server function page's generated body calls — internal by convention (the `__` prefix), application code calls the compiled components. Server-graph only: it imports the compiled serializer directly and never the client barrel, so no hydration machinery enters the graph. |
| `@openelement/element/internal/compiled/leaf-runtime` | The generated-leaf module's CLOSED runtime entry (M11-3): the same primitives, re-exported from their origin modules and deliberately never from `program-kernel.ts`. Emitted-code import target — it exists so a generated island chunk does not reach the generic executor through its own leaf imports; not author API, and not a stability promise beyond the compiled-leaf ABI. Carries the SSR half of the context engine (`createRenderContextScope`) for the same reason: an emitted producer that renders a consumer imports it from here, and a module that does not render one never does. |
| `@openelement/element/internal/styles` | The shared sheet registry (`themeManager`). Emitted-code import target: the generated client entry registers the compiled component stylesheet here, which used to happen through the class base's `registerGlobalStyles` static. The symbol is deliberately NOT on the public surface — the caller is framework-generated code, not author API — and this entry carries no stability promise (ADR-0177). |
| `@openelement/element/internal/compiled/runtime` | The generated-leaf module's runtime surface (recipe mount/claim, claim markers and invariants, SSR escape, list keys). Emitted-code import target; not author API, and not a stability promise beyond the compiled-leaf ABI. |
| `@openelement/element/internal/compiled/generated-element/shell` | The generated Native Custom Element shell (`createGeneratedElementClass`, `defineGeneratedElement`). Emitted-code import target; not author API — the compiler-private descriptor is the only contract. |

Reconnect is a core capability, not an entry option: reconnecting an
activated element re-binds the DOM that instance produced, from the ownership
record the runtime keeps (one retained binding per Part anchor in
`MountContext.bindings`), verified against the program before anything is
re-armed — so `./client-only` and `./base` resume a moved island without the
hydration executor (`internal/compiled/runtime/revive.ts`). The entries differ
only in which *first-activation* capabilities they install, and an entry
without the executor still refuses unknown DOM on a first connect, naming the
entry that can hydrate it. Repo-local measurement of the four entries (this
package's runtime plus one text Part, minified ESM, 2026-10-12): `.` 100,646 B
raw / 27,605 B gzip, `./client-only` 83,444 / 23,211, `./no-blocks`
92,219 / 25,224, `./base` 73,386 / 20,328 — the claim axis is worth ~17 KB raw
and the blocks axis ~8 KB raw, while the shared reconnect capability costs
~5 KB raw (1.3 KB gzip) per entry.

The compiler (`@openelement/compiler`, including the standalone `element()`
Vite plugin at `@openelement/compiler/vite`) is a separate package since the
#1557 split: it imports the TypeScript compiler API and must never be reached
from browser/runtime entry points. The cross-system contracts (Part Program
IR, error dialect, admission descriptors) live in `@openelement/protocol`.

## Boundary

`@openelement/element` does not own routing, Vite, Nitro, UI components,
database, auth, or cache. It owns the framework-level signal API
(`signal`/`computed`/`effect`) and a minimal internal `SignalEngine` protocol.
The only engine supported and verified is the built-in
`@preact/signals-core` adapter; Preact's own API is not Element public API,
and arbitrary third-party engines are not promised.

## License

MIT
