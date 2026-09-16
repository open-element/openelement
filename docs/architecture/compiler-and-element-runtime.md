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

## Precedents and deliberate differences

The nearest mature precedent for the Part Program is lit-html's `Template`/`Part`
model — a name neighbor that lives in this tree: the Lit framework mode depends on
`lit@3.3.3`. The differences are deliberate. The Part Program is a compile-time
artifact, not a runtime API: every dynamic location receives a compiler-owned
identity at build time, so nothing discovers bindings at runtime the way lit-html's
`TemplateInstance` resolves its Parts. The artifact is a serializable, versioned
JSON program rather than a non-serializable `TemplateResult`; compiler and runtime
meet only through that artifact, and no compiler internals ship in the runtime
(P2, ADR-0148). And there is no runtime interpreter fallback, VNode diff renderer,
or generic hydration walker: fixed executors replay the typed program, and claim
runs it against existing DOM with bounded element-local recovery (ADR-0143).

The compile-time lowering strategy itself follows Svelte's compiler-pays model
(P2). The deliberate difference is the runtime contract: the program executes on
the browser's own component model — `OpenElement extends HTMLElement` — rather
than on a private component runtime.
