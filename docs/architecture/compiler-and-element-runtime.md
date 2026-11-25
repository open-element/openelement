---
status: active
topic: Runtime architecture
summary: How the compiler, generated custom elements, server renderer and Router share component and DOM ownership.
---

# Compiler and element runtime

An island has a server renderer, a browser module and a native custom-element tag. The compiler owns the component's structure. Router chooses the delivery strategy and registers the constructor. The browser owns upgrade, element identity, shadow roots and form association.

## Compile a component

The TypeScript frontend resolves each binding in lexical scope and records the source location of each expression. Generated modules contain the instructions for mounting DOM, claiming server-rendered DOM, updating bindings and disposing resources. A change to a property or signal updates its dependent bindings. Unsupported source produces a located compiler diagnostic. The [scope resolver](./m03-scope-resolution.md) and [expression lowering contract](./m03-expression-identity.md) describe the compiler's inputs.

The class frontend was retired in Alpha16. The [migration matrix](./alpha16-class-migration-matrix.md) records how its consumers moved to function components.

## Render and claim a host

- The component's sidecar declares its root, property channels and styles. TypeScript supplies property names and types. The compiler checks the declarations against the root function and emits a descriptor for the custom-element shell. Package islands publish the corresponding compiler facts in the package manifest. The generic Custom Elements Manifest describes their public platform surface.
- The server emits light DOM inside the host or a declarative shadow template for a shadow root. The browser adopts the matching nodes and attaches event handlers and reactive updates. `delegatesFocus` belongs to the shadow root. Declared shadow styles must reach the same root at render and upgrade.
- String, boolean and number properties follow their declared attribute and reflection rules. Declared property-only arrays and objects can cross the HTML boundary through the generated host's JSON seed. The shell consumes that seed on upgrade. An HTML trust brand cannot be reconstructed from JSON.
- A connection owns its listeners and subscriptions. Disconnect ends that connection. Retained setup and owned DOM can survive reconnect. The claim checks the retained structure before reconciling changed properties. Full disposal releases the retained instance. The [seam registry](./seams.md) lists the browser regression tests for failed claims, retry and cleanup.
- A form-associated element obtains one `ElementInternals` record. Value-bearing controls publish their value and validity through it. A submit button can be form-associated without contributing a value. The form supplies validation, cancellation and submission behavior.

## Deliver and verify an island

Router derives an island's lane from compiler or package metadata. Generated entries import their constructors and the document services they use for pre-upgrade interaction and deep fragment navigation. Hydration policy still determines when each island activates.

Run the production builds, then pass both `dist/client/.vite/oe-browser-entry-graph.json` files to `@openelement/tools-repo`'s `browser-graph:check` task. It follows static and dynamic chunks and checks for the six generic executor entry modules. A missing or incomplete graph cannot establish a pass. Browser tests separately exercise the behavior of the built islands. The [progress ledger](./alpha16-18-progress.md) and [document history](../legacy/README.md) retain the evidence for earlier compiler milestones.
