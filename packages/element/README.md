# @openelement/element

Canonical component-authoring facade for the OpenElement 1.0 baseline.

Docs and guides: <https://openelement.org>.

This package exposes `OpenElement`, the product-facing base class for native
Web Components, running on the compiled Part Program kernel: one mandatory
compiler (`@openelement/element/compiler`) lowers each component's `render()` into
a serializable program consumed by server serialization, fresh DOM creation,
and existing-DOM claim alike. Light DOM is the current compiled default;
Shadow/DSD is a first-class mode selected explicitly with
`@element(tag, { root: 'shadow-open' | 'shadow-closed' })`.

Also includes:

- `ErrorBoundary` — error boundary (`static isErrorBoundary = true`) that automatically captures subtree render failures: on SSR the boundary renders its `onError()` fallback in place of the failed subtree, and on the client a failing descendant's render/update bubbles to the nearest boundary's `catchError()`. A subclass `render()` branches on `hasError` to swap in the `onError()` fallback UI; `retry()` re-renders both the boundary and the captured source element, `reset()` clears the state entirely. Without a boundary, SSR keeps the bare-tag degradation and CSR keeps the per-element `onRenderError()` fallback
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
facade for one job; none of them names an `internal/` module.

| Subpath                                | Import it for                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@openelement/element`                 | Authoring: `OpenElement`, `element`/`property`, signals, `ErrorBoundary`, `StyleSheet`, HTML escaping, `trustedHtml`.           |
| `@openelement/element/jsx-runtime`     | Automatic JSX runtime target (`jsxImportSource`); typecheck-only — compiled output never calls the factories, they fail closed. |
| `@openelement/element/jsx-dev-runtime` | Development JSX runtime target; same typecheck-only, fail-closed contract.                                                      |
| `@openelement/element/authoring`       | Runtime guards shared by authoring layers (tag names, dangerous keys, error class, hydration strategies, action headers).       |
| `@openelement/element/html`            | Pure document helpers: `escapeHtml`/`escapeAttr`, `wrapInDocument`, `trustedHtml` — no runtime kernel in the graph.             |
| `@openelement/element/logger`          | The shared structured logger (`createLogger`, `createWarnScope`, `warnOnce`) without pulling in the compiled runtime.           |
| `@openelement/element/build-utils`     | Build orchestration for adapters: JSON formatting, tag/path helpers, `SsrRenderError`, island transforms, runtime adapters.     |
| `@openelement/element/compiler`        | Compiler tooling **inside a build process**: the TSX-to-Part-Program semantic core plus the Vite plugin boundary.               |
| `@openelement/element/vite`            | The standalone Element authoring plugin (`element()`), for builds that do not use Router.                                       |

`compiler` and `vite` are host-side build entries: they import the TypeScript
compiler API (and Vite, for `vite`) and must never be reached from
browser/runtime entry points.

## Boundary

`@openelement/element` does not own routing, Vite, Nitro, UI components,
database, auth, or cache. It owns the framework-level signal API
(`signal`/`computed`/`effect`) and a minimal internal `SignalEngine` protocol.
The only engine supported and verified in 1.0.0-alpha.1 is the built-in
`@preact/signals-core` adapter; Preact's own API is not Element public API,
and arbitrary third-party engines are not promised.

## License

MIT
