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

The package root is the authoring surface. Every other subpath is a deliberate
facade for one job. The two `internal/` spellings at the bottom of the table are
the compiler-contract pair M09-1b ships so a packaged generated Native Custom
Element resolves the same runtime a workspace build uses; they are emitted-code
import targets, not author API.

| Subpath                                | Import it for                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@openelement/element`                 | Runtime surface for generated components: signals, context, `StyleSheet`, HTML escaping, `trustedHtml`, and the compiler-erased lifecycle/error intrinsics (`onConnect`, `onDispose`, `onError`, `ref`, `useContext`). |
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
| `@openelement/element/lifecycle` | Side-effect-free imports for compiler intrinsics such as `onConnect`, `onDispose`, `onPropertyChange`, `provideContext`, `ref`, `useHost`, and `useContext`. Import `onError` from the package root. |
| `@openelement/element/document-services` | The document-level services a client entry installs on EVERY page that ships client JS: `ensureDeepFragmentNavigation` (fragment navigation across nested shadow roots, #1090) and `ensurePreHydrationClickCapture` (the bounded pre-upgrade interaction capture a claiming island replays after activation). Its reason to exist is the executor-free page floor: a page whose islands are ALL generated-lane emits no `element-services` loader, so without this surface those two installers would silently stop running — measured on the live site before it landed (`#start` never got `data-open-target`). The installers are the SAME function objects the root entry exports, called by the generated entry (no module-scope side effect), and the reachable value closure is four modules with no executor entry: `internal/core/deep-fragment.ts` (zero imports) and the pre-upgrade capture, which used to reach `program-kernel.ts` for one throw and now calls the error façade origin with the same code, phase and message. |
| `@openelement/element/server`          | The server HTML constructor helpers (`__h`/`__t`/`__ssr`) a compiled server function page's generated body calls — internal by convention (the `__` prefix), application code calls the compiled components. Server-graph only: it imports the compiled serializer directly and never the client barrel, so no hydration machinery enters the graph. |
| `@openelement/element/internal/compiled/leaf-runtime` | The generated-leaf module's CLOSED runtime entry (M11-3): the same primitives, re-exported from their origin modules and deliberately never from `program-kernel.ts`. Emitted-code import target — it exists so a generated island chunk does not reach the generic executor through its own leaf imports; not author API, and not a stability promise beyond the compiled-leaf ABI. Carries the SSR half of the context engine (`createRenderContextScope`) for the same reason: an emitted producer that renders a consumer imports it from here, and a module that does not render one never does. |
| `@openelement/element/internal/styles` | The shared sheet registry (`themeManager`). Emitted-code import target: the generated client entry registers the compiled component stylesheet here, which used to happen through the class base's `registerGlobalStyles` static. The symbol is deliberately NOT on the public surface — the caller is framework-generated code, not author API — and this entry carries no stability promise (ADR-0177). |
| `@openelement/element/internal/compiled/runtime` | The generated-leaf module's runtime surface (recipe mount/claim, claim markers and invariants, SSR escape, list keys). Emitted-code import target; not author API, and not a stability promise beyond the compiled-leaf ABI. |
| `@openelement/element/internal/compiled/generated-element/shell` | The generated Native Custom Element shell (`createGeneratedElementClass`, `defineGeneratedElement`). Emitted-code import target; not author API — the compiler-private descriptor is the only contract. |

In a compiled component, call `provideContext(token, () => value)` from the
`lifecycle` entry and read the nearest provider through the signal returned by
`useContext(token)`. A `ref()` handle keeps its identity across reconnects and
its `current` value is cleared on detach.

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
