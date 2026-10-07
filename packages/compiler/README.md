# @openelement/compiler

Build-time compiler for OpenElement: transforms TSX modules that opt in with a
canonically bound `@element(...)` decorator into Part Program modules (the
compiled element model, #1473). The only TypeScript-dependent package —
this subpath is host-side tooling and must never be reached from a browser
runtime graph.

## Subpaths

| Subpath                        | Import it for                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@openelement/compiler`        | The semantic core tooling entry: `compileElementProgram` / `compileElementModule` (the one transform the Vite plugin and the build lanes share), `analyzeModuleSemantics`, diagnostics, the style-edge registry, and `stableModuleId`. |
| `@openelement/compiler/vite`   | The standalone `element()` Vite plugin (`compiledElementPlugin`) — the `open:compiled-element` transform for hosts that compose their own Vite config. No Router, SSG or deployment imports. |

## Boundary

Admission is binding-provenance based (#1209): a module is compiled only when
its `@element` decorator resolves to a runtime named import from
`@openelement/element`. Unsupported grammar fails closed with source-located
`OEC9xxx` diagnostics — there is no runtime fallback renderer.
