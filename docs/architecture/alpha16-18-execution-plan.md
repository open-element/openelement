---
status: active
topic: Compiler and release qualification
summary: Required compiler, runtime, browser and packed-consumer evidence, with the current scope of product and server contracts.
---

# Compiler and release qualification

The [compiler-native architecture](./compiler-native-architecture.md) defines the implementation boundaries, and the [TSX contract](./tsx-author-candidate-contract.md) and [semantic test matrix](./alpha16-18-semantic-test-matrix.md) specify the admitted behavior and its verification. [ADR-0173](../adr/ADR-0173-component-execution-and-composition.md) and [ADR-0174](../adr/ADR-0174-generated-code-runtime-and-compatibility.md) govern the model and release gate.

## Compiler and runtime evidence

| Gate | Required evidence |
| --- | --- |
| G1 | Real generated code executes in a browser. Demonstrate mount, update and disposal before expanding the backend. Preserve source-mapped diagnostics and safety at each admitted sink. |
| G2 | Show region and owner isolation across repeated insertion, keyed reorder, and disconnection. Demonstrate the same stateful list through SSR, claim, update and disposal, including structural mismatch and cleanup failures. |
| G3 | Before freezing author API or recommending a starter default, verify normal author usage, the supported packed consumers, public types, module resolution and runtime ownership across a real package boundary. |

Keep a running leaf case, a stateful hostless list and the same list through server render and claim. The last case must retain the original DOM, input, selection and keyed state, with balanced subscriptions and bounded mismatch recovery. An unsupported shape needs a located refusal. A generated module snapshot or an IR-only test establishes compilation shape, and a parsed production artifact and browser run establish execution.

The semantic frontend uses one binding and expression model. An ordinary local is a JavaScript snapshot. Prop getters evaluate per read, and changing that timing is observable. Safety checks, authored locations and Source Map fidelity are part of the acceptance contract.

## Release qualification

The release candidate must demonstrate generated browser mount, update, claim and disposal, native custom elements and their platform behavior, and Router integration through supported production paths. The old generic browser executor must be unreachable from **every applicable production browser entry graph**. Application graph receipts, native behavior tests and packed consumers each cover a separate part of this requirement. [Production graph applicability](./p1-applicability-record.md)

Record the following runtime and artifact proofs:

| Area | Evidence |
| --- | --- |
| Browser runtime | Production graph reachability, plus actual generated component behavior. |
| Server runtime | Server-owned serialization, DSD, property seeds, request-time rendering and claim contracts. The compiler's IR stays at build time. |
| Build and SSG | Router generates and consumes the same identity, route and generated style facts. Track named metadata producers and readers in the [seam registry](./seams.md). |
| Module ABI and wire | The generated modules use the narrow ABI. Build skew and unsupported artifacts are rejected where they meet the current runtime. [IR and ABI boundary](./compiler-ir-and-abi-boundary.md) |
| Public API | The tracked public-interface snapshot and artifact metadata match the shipped exports. In packed form, verify the normal routes through the public contract and the declared platform metadata. |

Run browser and server acceptance on the frozen revision, including Chromium, Firefox and WebKit. The independent packed proof installs the actual tarballs in a fresh app, with no workspace aliases, and exercises the same stateful list through server rendering and browser claim. Verify supported host paths through their real build and runtime outputs. Follow the [release workflow](../../.github/workflows/autoflow-release.yml) and [evidence provenance rules](./evidence-baseline.md) for the exact revision and canonical result.

Stop when a safety fixture fails, SSR and claim disagree on identity, an authoring change alters the approved evaluation order, a test reveals competing owners or runtime copies, an independent consumer needs source aliases, or a budget regression lacks measured authorization. The release gate may require evidence outside Base and Full CI. A passing run covers the jobs it actually exercised.

### Output safety and budgets

Keep private server artifacts unreachable from static delivery. Structural public/private output isolation and the publication allowlist carry their own inventory and host-boundary proof. Retain the existing static boundary until each replacement consumer qualifies. URL prefix changes can be verified independently. [Private-artifact boundary](../adr/ADR-0171-private-artifact-static-boundary.md)

Apply runtime, reference-island and home closure budgets to the reachable bytes, including generated code, adapter and shared helpers. The checker sums each emitted response compressed separately at gzip level 9 and fails the release on a missing input or any cap overage. The Site SLO, Site figures and report-only release A/B measurements retain their own scopes. [Packed starter budget](../agent-contract.md#packed-starter-javascript-budget)

The owner approved fixed Alpha16 gzip limits of 13,437 bytes for shared runtime and 17,071 bytes for home. The packed starter at `46ee1701804d41ca6e096416f263fb4e69475c3e` measured 13,045 and 16,573 bytes respectively. Each limit adds a 3% runner allowance to its measured baseline, rounding the allowance up to a whole byte and following the Site gzip figures precedent. The reference island retains its 2,000-byte limit. The owner moved further runtime size reduction to Alpha17. Future threshold changes require measured evidence and explicit owner approval. [Reference budget tracker](https://github.com/open-element/openelement/issues/1633)

### Retained platform concerns

- The packed Custom Elements Manifest must agree with generated declarations and the published `customElements` metadata. Run `ui-cem:check`, verify the packed artifact, and keep the release and packed gates on the same revision.
- The generated property channel retains primitives and declared property-only arrays and objects. The JSON property seed carries only the admitted data shapes. Trusted HTML stays an in-process capability.
- Form association, reset, restore, required validity and custom states are platform contracts. The shell exposes author validation through the element's internals.
- Third-party interoperability covers connection lifetime, foreign tags and server rendering through an actual consumer. [Runtime behavior](./compiler-and-element-runtime.md) · [Interop harnesses](../integrations/web-components-interop.md)

### P5 evidence

Document the active capability, its owner and the relevant consumer contract. Record observable behavior and remaining boundaries with the command and result at the reviewed SHA. A change that affects a currently supported capability needs a tracked disposition and owner approval. The owner's dated sign-off is specific to the reviewed revision.

The completed Alpha16 review and its earlier migration evidence remain pinned to the revisions on which they were accepted. Future work uses the current [capability inventory](./alpha16-capability-inventory.md) and current [runtime contract](./compiler-and-element-runtime.md). The old per-file conversion inventory and upgrade instructions have no ongoing acceptance role. [Verified e655a0b matrix](https://github.com/open-element/openelement/pull/1814#issuecomment-7161223186) · [Owner sign-off](https://github.com/open-element/openelement/pull/1814#issuecomment-7161266060)

## Server rendering and future scope

[M14 full await](./m14-full-await-definition.md) covers two server positions: a text child and a nested server-component prop. The server waits for those values before returning HTML. Verify both positions and named refusals, and retain server-only graph isolation. Browser setup remains synchronous.

Bounded defer is a separate future carrier with ownership, cancellation, stylesheet/chunk readiness and security requirements. It must retain request isolation and the invariant that a streamed installer, navigation morph and compiled binding do not write the same region concurrently. [Current Router contract](./router-and-server-runtime.md) · [Server async boundaries](https://github.com/open-element/openelement/issues/1801)

External precompiled package distribution requires independent server and client entries, resource relocation, public types, actionable compatibility rejection and one runtime across the consumer boundary. Qualifying the current tarball consumers does not freeze a future distribution ABI.

## Decision provenance

Earlier stage exits, dated amendments and owner decisions are preserved at their recorded revisions. The historical implementation requirements do not create an upgrade obligation for the current product. [Original execution plan at the signed candidate](https://github.com/open-element/openelement/blob/e655a0bab6f1396f4ed1a10208794e51e592b0ce/docs/architecture/alpha16-18-execution-plan.md)
