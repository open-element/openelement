# Product model

OpenElement has exactly two public core products: **Element** and **Router**.

| Product | Responsibility                                                                                                                 | Independent boundary                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Element | Compiled Custom Elements, reactivity, lifecycle, server serialization, fresh DOM, and existing-DOM hydration/update                | Installs, builds, and runs without Router                              |
| Router  | Route selection, HTTP semantics, navigation, loaders/actions, Document resolution, and Native/Lit Framework Mode orchestration | Route Mode runs without Element; renderer integrations remain explicit |

The table above describes the current alpha.15 implementation and support, not the completed next architecture. The accepted target is an **HTML-first full-stack framework with Full TSX authoring, explicit Signals and an explicit CE boundary**. Internal function components compose without mandatory hosts; standard Custom Elements remain the native export, independent-control and island activation boundary, including DSD where qualified. JSX is compiled input, not a public runtime virtual-DOM contract. Explicit and file-generated routes share one route authority; URLPattern owns pattern syntax while Router owns ordered winner selection, method dispatch, cancellation, and application outcomes.

The `create` package is the supported creation entry for the two core products. The canonical target architecture — principles P1–P5, the Part Program's transitional role and the responsibility split — lives in
[the compiler-native architecture](./compiler-native-architecture.md); this document states product scope, not that architecture. `packages/ui` is an experimental product maintained in this repository outside the 1.0 stable promise. `www` is the official product surface. `apps/saas` is an independent first-party application in this repository, governed separately from the Alpha repository candidate; it is not a core product, not a public package, and not part of the Alpha repository GO criteria. Neither Site nor SaaS extends the Element/Router stable API promise, but both are owned and maintained by this repository.

## Accepted direction and evidence (2026-11-03)

The owner ended OhMyLit as an independent product initiative and formally started
first-party Lit renderer retirement. This focuses investment on one Native path;
it is not a finding that Lit or DSD is unusable. Alpha.15's implementation and
support remain facts: nothing is removed by this decision. The last supported
version, breaking prerelease and compatibility/security window remain **OPEN**.
Third-party Lit Web Components remain a client-only interoperability use case,
not a promise of automatic SSR or OpenElement-managed Lit DSD hydration. See the
[superseding ADR-0152 amendment](../adr/ADR-0152-product-router-and-alpha-convergence.md).

| Status | Contract | Evidence required / responsible milestone |
| --- | --- | --- |
| Current fact | Alpha.15 Part Program, classes and Native/Lit modes remain | Existing release evidence; no new qualification claimed here |
| Accepted target | Full TSX syntax input, explicit Signals, HTML-first output, native Request/Response |
| Proposed (owner review) | Retire the serialized Part Program protocol and the Class authoring API; narrow generated ABI | Alpha16 semantic samples and connected codegen slices; Alpha17 author productization |
| Candidate | Tracked readonly props, computed derivation, Children and JSX values | [Author candidate contract](./tsx-author-candidate-contract.md); author review and consumer tests before freeze |
| OPEN | Exact props/computed/Children APIs, ref/context, iterable admission, flush timing, ABI and Lit release window | Resolve with scoped tests and owner decisions before dependent rollout |
| Non-goals | React Hooks/behavior compatibility, a second renderer or OhMyLit product, Rust/Flight migration, zero-runtime claims | Do not add these as delivery commitments |

Full TSX syntax is not permission to render every JavaScript value. Ordinary
locals and destructuring keep JavaScript evaluation semantics; unknown children
may require source-located runtime guards. Compiler IR, generated helpers and
markers are mechanisms, not the product or a zero-runtime guarantee. SSR and
client setup initialize separately. Existing security, independent consumption,
three-engine qualification, input fidelity and size budgets remain required.

| Familiar authoring | Compatibility boundary |
| --- | --- |
| Functions, JSX expressions, fragments and composition | Not React rerender snapshots, Hooks or a React scheduler |
| Explicit Signals and derivation | Ordinary locals do not become reactive by magic |
| CE properties/events/slots/forms | Foreign CE identity does not establish SSR capability |
| SSR followed by client claim | Hydration, not serialized closures or resumability |

Alpha16 is split (owner decision D-O1). **Alpha16a** is an internal
compiler-native foundation: semantics, generation, leaf and stateful proofs, with
no public version, tag, publication or release claim. **Alpha16b** is the formal
Alpha16 release qualification, and it requires the old generic browser executor
to be unreachable from production browser entry graphs; the ADR-0174 gate is
unchanged, and shipping both execution paths as a release does not qualify.
Alpha17 owns Full TSX productization, public composition APIs, cross-module
recipes, precompiled consumers and Starter/app migration. Alpha18 owns bounded
component defer only on a stable foundation; arbitrary Promises and unbounded
nesting are not admitted. The Class API was retained through a long-lived compatibility adapter on the
shared backend (D-O3, approved 2026-11-03). The **fourth pass proposes retiring
the authoring API** instead, keeping native Custom Elements and an internal
generated class; see
[the reassessment](./alpha16-18-fourth-pass-reassessment.md). This is a proposal
pending owner approval, not a decision, and it never permits two execution
architectures. These
are gated milestones, not dates or assertions of implementation. Preserve G1 (real codegen
slice), G2 (identity/owner before related expansion), G3 (author and independent
consumer proof before public API/default Starter). Historical direction blogs
remain records of their date; this document and the amended ADRs state the current
direction without rewriting those records.

`1.0.0-alpha.1` establishes a new public baseline. Historic pre-1.0 APIs do not create compatibility obligations unless a durable external data, protocol, security, or explicitly promised contract requires one.
