---
status: active
topic: Runtime architecture
summary: How the compiler, generated custom elements, server renderer and Router share component and DOM ownership.
---

# Compiler and element runtime

An island has a server renderer, a browser module and a native custom-element tag. The compiler owns the component's structure. Router chooses the delivery strategy and registers the constructor. The browser owns upgrade, element identity, shadow roots and form association.

## Compile a component

The TypeScript frontend resolves each binding in lexical scope and records the source location of each expression. Generated modules contain the instructions for mounting DOM, claiming server-rendered DOM, updating bindings and disposing resources. A change to a property or signal updates its dependent bindings. Unsupported source produces a located compiler diagnostic. The [scope resolver](./m03-scope-resolution.md) and [expression lowering contract](./m03-expression-identity.md) describe the compiler's inputs.

The component body lives in its declaring module. A generated element's descriptor carries platform facts such as its tag, properties, root and styles. The server render entry and the browser claim entry are separate consumers of those facts. [IR, ABI and wire boundaries](./compiler-ir-and-abi-boundary.md)

### Reactive reads and component ownership

- Read `props.name`, `signal.value` or `computed.value` at the JSX binding that depends on it. An ordinary local that captures the value beforehand is a snapshot. Use `computed(() => ...)` for a retained derived value. A bare JSX attribute is a static fact, while an expression supplies a dynamic binding. [Reactive contract](../adr/ADR-0183-one-reactive-contract.md)
- Declare immutable facts such as a shadow child's ID in JSX. Claim verifies static attributes in parser order before activation. Use a ref or a DOM read after the region exists to find an owned node. `onConnect` runs before mount or claim of the region.
- Hook setup belongs to a retained component. A nested retained component can own hooks at any depth. A recipe or list body has no such component setup owner. Cleanup returned to `onConnect` runs on disconnect. `onDispose` runs when the retained instance is destroyed. [Lifecycle intrinsics](../adr/ADR-0180-function-component-lifecycle-intrinsics.md)
- Providers and readers follow the retained owner tree. A provider shadows the same token in its own subtree. Server rendering creates a separate scope for each render. A node `ref()` is a handle attached through JSX. Reading its `current` in a reactive binding is refused. [Context and refs](../adr/ADR-0182-function-component-capability-api.md)

### Errors and fallback

The generated element's `onError` reports synchronous connect, claim, refresh and event failures within its scope. A failed connection attempt releases the resources it opened before reporting the error. A later ordinary reconnect can retry. After an update or event failure, the subscription or listener remains live. Client capture ends at the custom-element boundary and asynchronous rejection is outside this channel.

During an SSR render, the render-level `onNestedFailure` option reports an admitted nested expansion's failure. A caller that supplies a reporter can supply literal fallback children for the existing host identity. The generated client claims that fallback under the same identity. With the reporter omitted, the original throw propagates. [Fallback and recovery decision](../adr/ADR-0182-function-component-capability-api.md#amendment-2026-11-25-16b-eb-fallback-and-recovery)

## Render and claim a host

- The component's sidecar declares its root, property channels and styles. TypeScript supplies property names and types. The compiler checks the declarations against the root function and emits a descriptor for the custom-element shell. Package islands publish the corresponding compiler facts in the package manifest. The generic Custom Elements Manifest describes their public platform surface.
- The server emits light DOM inside the host or a declarative shadow template for a shadow root. The browser adopts the matching nodes and attaches event handlers and reactive updates. `delegatesFocus` belongs to the shadow root. Declared shadow styles must reach the same root at render and upgrade.
- String, boolean and number properties follow their declared attribute and reflection rules. Declared property-only arrays and objects can cross the HTML boundary through the generated host's JSON seed. The shell consumes that seed on upgrade. An HTML trust brand cannot be reconstructed from JSON.
- A connection owns its listeners and subscriptions. Disconnect ends that connection. Retained setup and owned DOM can survive reconnect. The claim checks the retained structure before reconciling changed properties. Full disposal releases the retained instance. The [seam registry](./seams.md) lists the browser regression tests for failed claims, retry and cleanup.
- A form-associated element obtains one `ElementInternals` record. Value-bearing controls publish their value and validity through it. A submit button can be form-associated without contributing a value. The form supplies validation, cancellation and submission behavior.
- A generated form-associated component observes a disabled ancestor fieldset through the shell's disabled custom state. It can use the exposed form callbacks and internals for its own reset, restore and validation policy. During claim, an authored HTML input keeps its live draft while its model still equals the server default. A later model change writes the live value, and native reset uses the server default. [Form and claim guards](./seams.md)

### Styles and HTML trust

Router resolves declared styles through one style plan. The server emits marked stylesheet links for a declarative shadow root and uses the document style sink for light roots. Claim reads the existing links and retains their identity. A client-only shadow root adopts its declared sheet through the compiled style scope. A light root inside a shadow template cannot receive document styles. Use slot projection or a nested shadow root for that composition. [Shadow rendering and styles](../adr/ADR-0181-generated-element-ssr-and-retention.md)

Only declared JSON-safe array and object values use the host property seed. Trusted HTML is an in-process capability. The client cannot recreate that trust from serialized bytes. [Property seed contract](../adr/ADR-0182-function-component-capability-api.md)

## Deliver and verify an island

Router derives an island's admission from compiler or package metadata. Generated entries register their constructors and import the document services they use for pre-upgrade interaction and deep fragment navigation. Hydration policy determines when each island activates. The replay hook delivers captured interactions after a successful claim or mount, then releases the capture state.

Run the production builds and pass their `dist/client/.vite/oe-browser-entry-graph.json` files to `@openelement/tools-repo`'s `browser-graph:check` task. It follows static and dynamic chunks and checks for the retired executor's entry modules. A missing or incomplete graph cannot establish a pass. Browser tests separately exercise connection lifetime, foreign-tag registration, server rendering and ownership of the parsed nodes. The packed consumer verifies the emitted constructors and standard Custom Elements Manifest against an external installation. [Graph coverage](./p1-applicability-record.md) · [Interop acceptance](../integrations/web-components-interop.md)
