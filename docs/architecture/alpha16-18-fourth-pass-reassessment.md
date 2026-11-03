# Alpha16–18 fourth-pass reassessment: legacy disposition

Date: 2026-11-03 (fourth pass). Baseline: `4f1f2001b`; branch
`docs/alpha16-18-contract-revision`; previous HEAD `cba667e0c`.
Status: **PROPOSAL — NOT APPROVED.** Nothing here is an owner decision until the
owner accepts it. No product source was changed.

This pass re-opens D-O2 (Part Program v2) and D-O3 (Class API) because the owner
challenged their premise: *why carry historical implementation constraints into
the generation that exists to remove them?* The reassessment below is
evidence-first; each recommendation states what would change if accepted.

## 1. Executive summary

| Object | Previous decision | This pass | Confidence |
| --- | --- | --- | --- |
| Class/Decorator authoring API | KEEP, long-lived adapter (D-O3, approved 2026-11-03) | **PROPOSE RETIRE** the authoring API; keep native Custom Elements and any internal generated class | Medium — cost is large and measurable; benefit is architectural |
| Part Program v2 as a **serialized browser execution protocol** | KEEP, transitional (D-O2) | **PROPOSE RETIRE** as browser protocol | High |
| Part Program v2 as an **SSR/build data structure** | KEEP | **PROPOSE REPLACE** by backend-local structures that share the semantic model, not the schema | Medium |
| `__partProgram` field | KEEP, transitional | **PROPOSE REMOVE** from the target generated-module contract; replace with a narrow ABI | High |
| `validatePartProgram` / `PART_PROGRAM_VERSION` / `COMPILED_MODULE_ABI_VERSION` v2 | KEEP | **PROPOSE RETIRE** the first two; the new ABI gets its own version | High |
| `LifetimeScope` | KEEP | **KEEP**, but re-justified below (§6), not granted permanent status | High |
| Signals | KEEP | **KEEP** | High |
| Native Custom Elements | KEEP | **KEEP** (explicit platform boundary) | High |

**None of these is approved.** The documents now carry them as proposals; the
approved 2026-11-03 decisions remain recorded as history and are not silently
rewritten.

## 2. Class API re-evaluation

### 2.1 What "the Class API" actually is — three different things

| Layer | What it is | Disposition |
| --- | --- | --- |
| **A. Public Class authoring API** (`@element`, `class X extends OpenElement`, decorators) | the authoring surface Alpha15 shipped | **PROPOSE RETIRE** |
| **B. Internal generated class** | the compiler emits a class extending a generated base with `__partProgram` + handlers | **KEEP the concept**; keeps native lifecycle |
| **C. Native platform integration** (`HTMLElement`, `customElements.define`, attributes/properties/events/shadow) | browser boundary | **KEEP, first-class** |

The previous decision conflated A and C. Retiring A does **not** remove C: the
compiler can still emit a native Custom Element class internally for islands,
registration and third-party interop, and authors can still use those elements
from ordinary HTML.

### 2.2 Implementation and consumer evidence

| Evidence | Value | What it proves |
| --- | --- | --- |
| Files using `@element(` in-tree | **219** (`apps` 14, `packages` 75, `tests` 81, `www` 49) | migration cost is large **inside the repo** |
| Public subpaths carrying class authoring | `@openelement/element` root, `./authoring`, `./base`, `./client-only`, `./no-blocks` | public surface is not one symbol |
| Compiler frontend | `analyze-module.ts` (`analyzeCompiledModule`) + `lower-program.ts` | class-shaped pipeline is the only frontend today |
| Runtime coupling | `open-element-implementation.ts` fails closed without `__partProgram` | class and protocol are currently entangled |
| External downloads (last month) | `@openelement/element` **1,551**; `@openelement/router` **1,436**; last week element **51** | small but non-zero; **cannot** establish "no external users" |

External adoption **cannot be proven either way** from available evidence:
download counts include CI/mirrors, and no verified downstream project was found.
The repo's own 1.0 Alpha baseline explicitly does not promise 0.x migration,
which weakens the compatibility argument but does not eliminate it.

### 2.3 Cost of each option

| Option | Engineering cost | Compatibility cost | Architectural consequence |
| --- | --- | --- | --- |
| **KEEP + adapter** (previous) | adapter + dual authoring surface + permanent test matrix | none | one backend, but a second *frontend* and permanent `__partProgram` dependency |
| **DEPRECATE** | adapter + deprecation machinery + two supported paths for years | low near-term | postpones the decision, keeps both costs |
| **RETIRE** | migrate 219 in-tree files + rewrite compiler frontend as function-first + rewrite generated module + Starter/docs | breaking for any external class author; needs a migration note and a major-version statement | one authoring model, one frontend, no legacy frontend to keep honest |

### 2.4 Recommendation

**RETIRE the public Class/Decorator authoring API**, as a *proposed* decision:

1. Do **not** build a compatibility adapter for authoring.
2. Publish a migration note and a breaking-release statement; Alpha16 is already
   a fresh baseline, so no 0.x migration promise is broken.
3. Keep native Custom Elements as the public browser boundary, and keep an
   internal generated class where the platform requires an element (island root,
   registration, form/attribute interop).
4. Do **not** require authors to extend `OpenElement`. Whether the `OpenElement`
   symbol survives at all is an implementation question (it may become an
   internal base the generated code emits, with no author-facing export), not a
   naming decision.

The honest downside: 219 in-tree call sites migrate, and any external class
author breaks. That is a real cost and it is why this needs the owner's explicit
approval rather than being inferred from "the architecture is cleaner".

## 3. Part Program v2 re-evaluation

### 3.1 Three layers, again — and which one is being retired

| Layer | Today | Proposal |
| --- | --- | --- |
| Compiler-internal Semantic IR | implicit inside `semantic-core`; today the compiler's output shape is the program | **KEEP as compiler-owned IR.** It must not be defined by the old schema. |
| Part Program v2 as serialized artifact | `packages/protocol/src/part-program.ts` + emitted `__partProgram` | **RETIRE as a browser execution protocol**; replace per-backend |
| Browser interpretation of it | `fresh-dom.ts`, `parts.ts`, `blocks.ts`, `runtime-program.ts` | **RETIRE** once generated code covers it |

Retiring the serialized protocol does **not** mean the compiler loses structure,
and it does **not** mean the server loses a rendering path.

### 3.2 Verified consumers (by class)

Full table: `alpha16-18-current-reality.md` §C-bis. Summary of what depends on
the artifact today:

| Consumer class | Count | Can it survive without `__partProgram`? |
| --- | --- | --- |
| Browser production runtime | 6 direct sites | **No** — this is the thing being replaced |
| SSR serializer | 3 | **Yes**, with backend-local structure (the server may keep its own IR) |
| Streaming identity | 2 | **Yes**, with explicit build-identity metadata in the new ABI |
| Router page classification | 2 | **Yes**, with a metadata flag instead of field presence |
| Build-time lexical | 2 | **Yes**, migrated in the same change as the field shape |
| Type-only | 4 | Follow the ABI |
| Protocol/validator/public export | 3 | Retired or retained by product decision |

### 3.3 Cost and risk of retaining versus retiring

| | Retain as transitional | Retire |
| --- | --- | --- |
| Compiler freedom | constrained by a shipped schema | free |
| Browser bytes | ships a generic descriptor forever | ships only generated code + minimal metadata |
| Migration risk | low now, permanent dual-path | concentrated in Alpha16b |
| Consumer work | none | 3 SSR + 2 stream + 2 Router + 2 lexical + 4 type |

### 3.4 Recommendation

**RETIRE Part Program v2 as a serialized browser execution protocol**, and
**remove `__partProgram` from the target generated-module contract**:

- the compiler keeps a Semantic IR (internal, not the old schema);
- server and client backends render from the IR independently;
- the server may keep a private serialization structure — it need not ship to the
  browser and need not match the client;
- the module carries a **narrow ABI** (§4), not a structural program;
- `validatePartProgram` and `PART_PROGRAM_VERSION` retire with the schema;
  `COMPILED_MODULE_ABI_VERSION` is replaced by a new ABI version;
- the migration is staged: old consumers keep working until each is migrated
  (D-O2's staging discipline survives; its KEEP conclusion does not).

## 4. Proposed generated-module ABI

Nothing here is frozen. Responsibilities are justified by the traced consumers:

| Responsibility | Needed by | Justification |
| --- | --- | --- |
| Component identity + tag | registration, Router page classification | replaces `__partProgram.tag` presence checks |
| Property/attribute metadata | facade, SSR seeding, form interop | replaces `metadata.properties` reads |
| Style/scope metadata | CSS recovery, style delivery | replaces build-time CSS recovery scanning |
| Generated client entrypoints | mount/update/claim/dispose | replaces the walker's entry |
| Generated server entrypoints | SSR/DSD | keeps server rendering independent |
| Build-time feature flags | SSG blocks detection, streaming | replaces the lexical `"blocks": [{` probe |
| ABI version + build identity | mismatch rejection, stream identity | replaces `program.version` comparisons |

Rules: no oversized descriptor, no structural program, no runtime type dispatch,
and no field added without a named consumer. Metadata and entrypoints are
separate concerns and may be separate exports.

## 5. Boundary: one semantic model, two backends

```text
Authored TSX (function components)
        │
        ▼
Compiler frontend  →  Semantic IR (compiler-owned, never shipped)
        │
        ├─ Server backend → HTML / DSD / seed / stream metadata
        └─ Client backend → generated mount / update / claim / dispose
                                   │
                                   ▼
                         Minimal runtime (signals, ownership,
                         DOM, keyed identity, platform helpers)
```

No layer may become responsible for the others: the IR is not a wire format; the
ABI is not the IR; the HTML/claim/stream wire is not the ABI.

## 6. What is re-justified rather than inherited

| Object | Old reason | Re-justification |
| --- | --- | --- |
| `LifetimeScope` | "already exists" | It is the only primitive that already provides parent/child ownership, LIFO cleanup, idempotent dispose, error isolation and range cleanups (`lifetime-scope.ts:83-109`) — all required by the new model. Its **API shape** is still open (lineage query, detach semantics). |
| Signals | "already exists" | The reactive contract (tracked getters, computed, fine-grained updates) is exactly what the target requires; no second reactive system is warranted. |
| Native Custom Elements | "no VDOM" | Platform boundary for interop/islands, not an implementation convenience. |
| `validatePartProgram` | "consumers exist" | **Not** re-justified: its consumers are the retired protocol. Propose retirement with the schema. |
| `__partProgram` | "consumers exist" | **Not** re-justified: consumers are migrated, not preserved. |

## 7. External consumer evidence and its limits

- npm last month: `@openelement/element` 1,551; `@openelement/router` 1,436.
  Last week element: 51. These numbers include CI and mirrors; they are **not** a
  user count.
- No verified downstream dependent was found; GitHub search returns same-name
  projects and forks, not dependents.
- The repository's own position is a fresh 1.0 Alpha baseline without 0.x
  compatibility obligations.
- **Conclusion: external impact is unknown, not proven absent.** A retirement
  must therefore ship a migration note and a breaking-release statement, and
  must not claim "no users".

## 8. Updated milestones

| Milestone | Change |
| --- | --- |
| M01 | unchanged: IR / module ABI / metadata / wire boundary — now with the **proposed** retirement as the target, not "keep and split" |
| M02–M08 | unchanged |
| **M09** | **replaced.** Was "Class Compatibility Adapter". New M09: **Generated Native Custom Element boundary** — emitted element class, registration, property/attribute conversion, events, Shadow DOM/DSD interop, third-party WC compatibility |
| M10 | unchanged in purpose; now also covers removing `__partProgram` from production module contracts and proving the old protocol has no production browser consumer |
| M11–M13 | unchanged |
| **M14** | **normalised to Alpha16b.** Full-await async server components; not Alpha16a, not Alpha18 bounded defer |
| Alpha17 | no longer carries a class-adapter obligation; carries the frozen ABI, public function API, migration notes |
| Alpha18 | unchanged: bounded defer only |

If the class-retirement proposal is **not** approved, M09 reverts to the adapter
milestone and the execution plan's Alpha16b item "retire class frontend" is
removed. Both variants are stated so the plan is not silently pre-decided.

## 9. What the owner must approve

| # | Proposal | If rejected |
| --- | --- | --- |
| P-1 | Retire the public Class/Decorator authoring API; keep CE + internal generated class; migrate in-tree call sites | M09 remains the adapter; `__partProgram` retains a class-facing consumer |
| P-2 | Retire Part Program v2 as a serialized browser protocol | the protocol stays transitional and the walker survives longer |
| P-3 | Remove `__partProgram` from the target module contract; introduce the narrow ABI | the ABI work shrinks to splitting the existing field |
| P-4 | Retire `validatePartProgram` / `PART_PROGRAM_VERSION` with the schema | they survive as orphaned infrastructure |
| P-5 | No compatibility adapter for authoring | adapter is built and maintained |

Approving P-1 without P-2 (or vice versa) is coherent in theory but produces a
mixed state: a function-only frontend still emitting a structural descriptor.
That combination should be made explicit if chosen.

## 10. Status of the documents

Everything below is **proposal**, not frozen:
this document, the target sections of `compiler-native-architecture.md`, the
retirement roadmap matrix, the execution plan's M09/M10 wording, and the
PROPOSED amendments added to ADR-0173/0174. The approved 2026-11-03 decisions
(D-O1 split, D-O2 staging discipline, D-O3 adapter) remain recorded as approved
history until the owner supersedes them.

**Architecture consistency, engineering feasibility, retirement feasibility and
release readiness are four different questions.** This pass can claim only the
first: the documents are now internally consistent about the proposed direction.
