# Compiler and element runtime

The 1.0 Element baseline uses one mandatory compiler to lower supported TSX into
a Part Program. `OpenElement extends HTMLElement` owns local lifecycle, root, program
instance, subscriptions, and cleanup. Unsupported authoring fails with diagnostics;
it does not fall back to a runtime virtual-DOM path.

## Toolchain decisions

One production compiler frontend: the classic TypeScript compiler API, reached through
the import-map name `typescript` (exact `npm:typescript@6.0.3`). A second parser is
admitted only with an independent benchmark and a semantic-equivalence proposal.
Generic parsing may move upstream; Part Program semantics, OpenElement component
semantics, reactivity semantics, and the generated artifact contract never do.

The Custom Elements Manifest is the generic metadata interchange authority for tags,
attributes, members, events, slots, and CSS parts. OpenElement adds a namespaced
`openElement` extension for compiler and SSR capability and keeps its own SSR admission
classification; it does not maintain a second generic metadata extractor. Runtime
schema validation and analyzer-based generation are deferred until the upstream
contract expresses the fail-closed invariants the interop corpus requires.
