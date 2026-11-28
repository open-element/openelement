# @openelement/protocol

Cross-system contracts and tiny pure predicates for the OpenElement framework:
server JSX lowering types, generated host markers, error codes, admission descriptors, and policy
constants. Zero dependencies by charter — every module here is importable from
the compiler, the runtime, and the build adapters without dragging any of them
into the others' graphs.

## Subpaths

| Subpath                                | Import it for                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `@openelement/protocol`                | The umbrella re-export of the shared contracts.                                                                                              |
| `@openelement/protocol/app-model`      | Host-agnostic route and asset contracts shared by app and build drivers (the route tree node, matched-path shapes).                          |
| `@openelement/protocol/client-assets`  | The client asset manifest protocol (#1471): compile-time island identity joined with build output for per-page script wiring.                 |
| `@openelement/protocol/data`           | The platform-neutral data adapter protocol.                                                                                                  |
| `@openelement/protocol/diagnostics`    | The machine-readable diagnostics envelope (#1612): one JSON shape every build failure answers on, the `openelement.diagnostics/1` report format, and the fail-closed parser. |
| `@openelement/protocol/errors`         | The single declaration site of the error contract (#1386): coded error classes, phase catalogs (`RuntimeErrorCode`, `KernelErrorCode`, ...).   |
| `@openelement/protocol/forbidden-sinks`| Canonical sink names and attribute safety checks shared by the compiler and runtime.                       |
| `@openelement/protocol/framework`      | Framework, build, layout, routing, and plugin metadata contracts.                                                                          |
| `@openelement/protocol/island`         | Island contracts (`IslandOptions`, hydration options).                                                                                       |
| `@openelement/protocol/island-admission` | The single definition of the router's island admission descriptor.                                                                         |
| `@openelement/protocol/manifest`       | CEM manifest and compatibility contract types.                                                                                               |
| `@openelement/protocol/module-descriptors` | Binding-identity module descriptors shared by the compiler's semantic core and its hosts (#1557 package split).                           |
| `@openelement/protocol/module-vocabulary` | The router's module-scan vocabulary injected into the element semantic core.                                                               |
| `@openelement/protocol/part-program`   | Server JSX lowering types and the generated host markers and root modes. |
| `@openelement/protocol/policy`         | Numeric bounds for composition depth, action bodies, and idle delivery.                                     |
| `@openelement/protocol/registry-markers` | SSR customElements registry marker contract (#965).                                                                                        |
| `@openelement/protocol/render`         | Render pipeline types (render errors, hydration hints, SSR admission decisions).                                                                                    |
| `@openelement/protocol/runtime`        | Runtime adapter protocol.                                                                                                                    |
| `@openelement/protocol/server-only`    | Side-effect import that marks an application module as server-only in Router browser builds and dev.                                         |
| `@openelement/protocol/signal`         | Signal contracts (`Signal`, `ReadonlySignal`, brands).                                                                                       |
| `@openelement/protocol/ssg`            | SSG engine contracts (route manifests, island declarations).                                                        |
| `@openelement/protocol/stream-frame-policy` | URL safety checks shared by generated DOM writes and server markup.                          |
| `@openelement/protocol/style-sheet`    | The cross-environment `StyleSheet` abstraction contract.                                                                                     |
| `@openelement/protocol/void-tags`      | The canonical HTML void-element set shared by rendering and compilation.                                               |

## Boundary

Everything here is declarative or a pure predicate: no DOM, no Node APIs, no
I/O. Modules at this layer sit at the base of the module graph so the compiler
(`@openelement/compiler`), the runtime (`@openelement/element`), and the build
adapters (`@openelement/router`) can share one definition without importing
each other.
