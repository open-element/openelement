# ADR-0143: Compiled OpenElement model

- Status: ACCEPTED (current `1.0.0-alpha.1` baseline)
- Preserves: Custom Elements, DSD-first server output, progressive enhancement

## Decision

`OpenElement extends HTMLElement` is the concrete component model. The single supported authoring
path compiles TSX into a versioned Part Program containing static structure plus typed Part and
Region instructions.

```text
TSX -> compiler semantic core -> Part Program
                                  |-> server serialization
                                  |-> browser creation
                                  `-> existing-DOM claim
```

Fixed Parts own mutable text, attributes, properties, events, refs, class, and style. Regions own
bounded structural content and nested lifetime. One element instance owns its Parts, Regions,
subscriptions, and cleanup. There is no shipped VNode diff renderer, binding-discovery tree,
generic hydration walker, or interpreter fallback.

Claim attaches the program to existing SSR DOM. A successful claim preserves live form state,
focus/selection, nested custom-element identity, and captured pre-upgrade events. A mismatch emits
structured diagnostics and permits only bounded element-local recovery.

Signal engines satisfy a small internal conformance contract. Engine selection does not change
Part Program semantics or create a separate public product. Light DOM and open/closed Shadow DOM
follow platform semantics.

The compiler is mandatory tooling delivered through the official Element/Vite path, but it is not
a public compiler package. Unsupported syntax fails at build time with source-located diagnostics.

## Verification

Conformance fixtures must cover serialization, creation, claim, updates, events, cleanup, roots,
foreign custom elements, and mismatch behavior in Chromium, Firefox, and WebKit. Packed Element
qualification must start from an author project and run in an ordinary HTML consumer without a
workspace alias or Router dependency.
