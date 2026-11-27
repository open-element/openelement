# @openelement/element

Runtime surface for the generated component lane of the OpenElement 1.0 baseline.

Docs and guides: <https://openelement.org>.

OpenElement's compiler generates native Custom Elements from JSX and TSX
function components. The generated code renders HTML on the server, mounts
fresh DOM or claims existing DOM in the browser, and updates reactive bindings.
Declare shadow DOM in the `defineIslandConfig` sidecar with `root: 'shadow'`
or `root: 'closed'`. The default is light DOM.

Also includes:

- `onError(cb)` — the compiler-erased error-boundary intrinsic (16b-EB): the generated element's shell runs the registered handler at its connect/claim, update and event-dispatch capture points; outside a compiled generated element module the function fails closed
- Signals: `signal`, `computed`, `effect`, and the `Signal` type
- Context (`createContext` / `provideContext` / `consumeContext`), `StyleSheet`, HTML escaping utilities, and the `trustedHtml` explicit trust boundary

## Install

```bash
npm install @openelement/element
```

## Usage

In a Router application, default-export the component function and use
`defineIslandConfig` from `@openelement/router` to declare its tag, root and
reactive properties.

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'my-card',
  root: 'shadow',
  properties: { title: { attribute: false } },
});

export default function MyCard(props: { title: string }) {
  return (
    <article>
      <h2>{props.title}</h2>
    </article>
  );
}
```

The sidecar's `properties` table is the reactive state contract; the compiler
wires each row to the signal engine so server output, fresh DOM, and claimed DOM
share one identity model. Styles ship via a declared `.css` sheet in the
sidecar; raw-text `<style>`/`<script>` tags are rejected from templates.

## Subpath exports

The package root is the authoring surface. The internal subpaths support
compiler, build, and runtime integration.

| Subpath                                | Import it for                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@openelement/element`                 | Runtime surface for generated components: signals, context, `StyleSheet`, HTML escaping, `trustedHtml`, and the compiler-erased lifecycle/error intrinsics (`onConnect`, `onDispose`, `onError`, `ref`, `useContext`). |
| `@openelement/element/jsx-runtime`     | Automatic JSX runtime target (`jsxImportSource`); typecheck-only — compiled output never calls the factories, they fail closed.                                              |
| `@openelement/element/jsx-dev-runtime` | Development JSX runtime target; same typecheck-only, fail-closed contract.                                                                                                   |
| `@openelement/element/authoring`       | Runtime guards shared by authoring layers (tag names, dangerous keys, error class, hydration strategies, action headers).                                                    |
| `@openelement/element/html`            | Pure document helpers: `escapeHtml`/`escapeAttr`, `wrapInDocument`, `trustedHtml` — no runtime kernel in the graph.                                                          |
| `@openelement/element/logger`          | The shared structured logger (`createLogger`, `createWarnScope`, `warnOnce`) without pulling in the compiled runtime.                                                        |
| `@openelement/element/build-utils`     | Build orchestration for adapters: JSON formatting, tag/path helpers, `SsrRenderError`, island transforms, runtime adapters.                                                  |
| `@openelement/element/css-modules`     | Ambient `*.css` module type (#1558): the default export of an imported `.css` sheet is the cross-realm `StyleSheetLike`. Types-only — load it through tsconfig `types` (the vite/client pattern); it resolves no runtime module. |
| `@openelement/element/lifecycle` | Side-effect-free imports for compiler intrinsics such as `onConnect`, `onDispose`, `onPropertyChange`, `provideContext`, `ref`, `useHost`, and `useContext`. Import `onError` from the package root. |
| `@openelement/element/document-services` | Document-level installers for fragment navigation into shadow roots and pre-upgrade event capture. |
| `@openelement/element/server` | HTML constructors called by compiled server function components. |
| `@openelement/element/internal/compiled/leaf-runtime` | Runtime helpers imported by compiler-generated components, including mount, claim, and server context. |
| `@openelement/element/internal/styles` | The shared sheet registry (`themeManager`). Emitted-code import target: the generated client entry registers the compiled component stylesheet here, which used to happen through the class base's `registerGlobalStyles` static. The symbol is deliberately NOT on the public surface — the caller is framework-generated code, not author API — and this entry carries no stability promise (ADR-0177). |
| `@openelement/element/internal/compiled/generated-element/shell` | The generated Native Custom Element shell (`createGeneratedElementClass`, `defineGeneratedElement`). Emitted-code import target; not author API — the compiler-private descriptor is the only contract. |

In a compiled component, call `provideContext(token, () => value)` from the
`lifecycle` entry and read the nearest provider through the signal returned by
`useContext(token)`. A `ref()` handle keeps its identity across reconnects and
its `current` value is cleared on detach.

Generated elements carry their mount and claim functions. Reconnect uses
the element's retained instance and DOM ownership record.

The compiler (`@openelement/compiler`, including the standalone `element()`
Vite plugin at `@openelement/compiler/vite`) is a separate package since the
#1557 split: it imports the TypeScript compiler API and must never be reached
from browser/runtime entry points. The shared lowering types, generated host markers, error codes, and admission
descriptors live in `@openelement/protocol`.

## Boundary

`@openelement/element` does not own routing, Vite, Nitro, UI components,
database, auth, or cache. It owns the framework-level signal API
(`signal`/`computed`/`effect`), backed by the built-in
`@preact/signals-core` adapter. It is the only supported and verified engine; Preact's own API is not Element public API,
and arbitrary third-party engines are not promised.

## License

MIT
