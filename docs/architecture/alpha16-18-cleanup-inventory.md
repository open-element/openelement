# Alpha16–18 cleanup and migration inventory

Date: 2026-11-03. Status: **APPROVED POLICY / NOTHING MAY BE DELETED FROM THIS LIST
ALONE**. Baseline: `4f1f2001b24909086f7e7efe9e5016d48d615c91`.

Actions: **KEEP**, **REFACTOR**, **REPLACE**, **RETIRE AFTER QUALIFICATION**,
**OUT OF SCOPE**, **NEEDS FURTHER INVESTIGATION**.

Every row names its actual consumers where traced. A row whose consumers are
listed as "not fully traced" is INVESTIGATE, not deletable.

## Compiler

| Item / path | Current responsibility | Actual consumers | Target responsibility | Action | Blockers / dependencies | Exit criteria |
| --- | --- | --- | --- | --- | --- | --- |
| `semantic-core/parse-module.ts` + `typescriptParser` | one TS parse helper | compile lane, server-component lane, CSS/class scans | keep as the parse helper; stop calling it backend-neutral | KEEP | none | wording corrected (done); no behavioural change |
| `semantic-core/analyze-module.ts` | class/module shape analysis | compile lane only | function-first frontend; class frontend retires | REFACTOR (class frontend RETIRE, approved) | Full TSX admission; M03 parity on diagnostics/spans | function adapter matches the Alpha15 diagnostic/Source Map/security baseline |
| `semantic-core/lower-program.ts` (1689 lines) | restricted JSX → program tree | compile lane | admit fragments/multi-root/value-position JSX; keep one walk | REFACTOR | per-case contract; S1 slice | new admissions land with diagnostics + negatives in the same change |
| `semantic-core/emit-program.ts` | assemble + validate program | compile lane | keep validation; add metadata split | REFACTOR | D-O2 | metadata/execution split decided |
| `semantic-core/emit-module.ts` | emit module with `__partProgram` JSON | generated modules, Element runtime, SSR, Router build/runtime consumers | add generated client/server code paths; keep JSON until proven | REFACTOR | codegen ABI | generated output measured, not assumed smaller |
| `semantic-core/server-component.ts` | server function components → string calls | client build + SSG build | extend (locals, async policy, composition) | REFACTOR | server semantics decision | async rule decided and documented |
| `compiler-diagnostics.ts` + OEC codes | source-located diagnostics | every compile consumer | add codes for new admissions | KEEP | none | catalogue generator covers new codes (currently misses two sources) |
| `source-map.ts` | Source Map v3 | compiler, dev tooling | extend to generated code | KEEP | none | generated code maps to authored TSX |
| `semantic-core/type-check.ts` | emitter typecheck | compile lane | keep | KEEP | none | — |

## Element runtime

| Item / path | Current responsibility | Actual consumers | Target responsibility | Action | Blockers | Exit criteria |
| --- | --- | --- | --- | --- | --- | --- |
| `compiled/lifetime-scope.ts` | owner tree + cleanup | kernel, blocks, parts, streams | the ownership primitive of the target | KEEP | none | unchanged contract; new tests for per-instance owners |
| `compiled/runtime/fresh-dom.ts` | generic DOM walk from program | kernel connect (fresh) | replaced by generated mount | REPLACE | generated mount exists and covers multi-root/fragments | graph evidence + full behaviour coverage |
| `compiled/runtime/parts.ts` | fixed Part executors | fresh-dom, hydrate | split into generated operations + small helpers | REFACTOR | codegen | helpers justified by retirement condition |
| `compiled/runtime/blocks.ts` | when/each builders + keyed entries | fresh-dom, hydrate | generated keyed algorithm with minimal coordination | REFACTOR | S2 slice | keyed identity, ranges, disposal proven in browser |
| `itemBox` pattern (`blocks.ts:175-224`) | live value for reused entries | per-item event dispatch | props-replacement live value | KEEP (pattern) | none | reused by component props; tested |
| `compiled/runtime/hydrate.ts` (1004 lines) | claim + bounded recovery | kernel connect (claim) | generated claim with the same guarantees | REFACTOR → REPLACE where feasible | S3 slice | claim fidelity matrix passes |
| `compiled/runtime-program.ts` | per-class program normalization | every connect | shrink once browser does not interpret structure | REFACTOR | D-O2 | no runtime-only normalization remains |
| `compiled/runtime/blocks-install.ts`, `runtime/hydrate-seam.ts` | side-effect installation for tree-shaking | public entries `src/index.ts`, `./client-only` | keep until measured; claim seam changes only with evidence | KEEP | measurement | measured bytes and graph proof before any change |
| `compiled/facade-host.ts` | binds properties/attrs to signals | every compiled element | keep; extend for props | KEEP | none | — |
| `jsx-runtime.ts` / `jsx-dev-runtime.ts` | typecheck-only factories that throw | typechecking; fail-closed guard | keep the guard; JSX values are a separate representation | KEEP | model note | guard still fails closed after recipes exist |
| `public-runtime.ts` | serializer, registration, stream shell | SSR, Router, consumers | keep SSR serializer; split metadata use | REFACTOR | D-O2 | SSR parity tests |

## Protocol / metadata

| Item / path | Current responsibility | Actual consumers | Target responsibility | Action | Blockers | Exit criteria |
| --- | --- | --- | --- | --- | --- | --- |
| `protocol/part-program.ts` types + `validatePartProgram` | structural contract + validator | compiler, element, router, tooling | **RETIRE (approved)** with the browser protocol; server keeps a private structure | RETIRE (approved) | all consumers migrated; M01 ABI design | no production consumer reads the schema |
| `PART_PROGRAM_VERSION` / `COMPILED_MODULE_ABI_VERSION` | format + ABI stamps | generated modules, stream identity | version generated-module ABI separately | REFACTOR | ABI design | mismatch rejected early with actionable diagnostics |
| `__partProgram` static (emitted field carrying Part Program v2) | browser execution route + SSR input + Router/stream identity + CSS recovery | see the consumer map in [current reality](./alpha16-18-current-reality.md#c-bis-__partprogram-production-consumer-map) | metadata/identity remains; browser-execution use retires with the generic executor | **REFACTOR (staged)** | D-O2 approved; two lexical consumers must migrate with any field-shape change | every production consumer migrated to metadata/ABI or explicitly retained, with its exit condition met |
| `protocol/src/index.ts` public export of the program module | public surface | no external users (owner-declared) | retires with the protocol; a new ABI subpath arrives in Alpha17 | RETIRE (approved P-2/P-4) | release note + migration statement | retired export documented in the breaking release |

`__partProgram` is the highest-risk row in this inventory. It is a compiler
**output** (not the compiler's internal semantic IR), and it is consumed by four
different kinds of consumer at once:

- browser execution (generic walkers, normalization, facade),
- server serialization and streaming,
- Router/stream identity and page classification,
- build-time CSS recovery and SSG blocks detection.

Exactly two consumers read the emitted field as **text**, and they live in
different packages: `router/src/vite/internal/ssg/island-blocks-scan.ts:117-120`
and `compiler/src/internal/compiler/compiled-artifact-style-requests.ts:42,122`.
Everything else accesses the property at runtime. An earlier draft of this
inventory described the Router check in `authoring.ts:441-445` as lexical; it is
a **runtime property-presence check** and has been corrected.

Consequence: retiring the old generic browser executor does **not** delete the
Part Program, its validator, the emitted field, the tag/version metadata, the
server serializer or the streaming program data.

## Router / full stack

| Item / path | Current responsibility | Consumers | Target | Action | Blockers | Exit criteria |
| --- | --- | --- | --- | --- | --- | --- |
| Framework Mode (routes, loaders/actions/forms, SSR/SSG) | the application layer | users, fixtures | keep | KEEP | none | unchanged |
| Native renderer integration | selects and renders compiled components | Framework Mode | keep; extend to generated backend | KEEP | codegen | renderer integration unchanged in contract |
| Lit renderer (`src/lit.ts`, `lit-ssr.ts`, subpaths, fixture) | first-party Lit pages | Lit users (unknown count) | retire on a separate track | RETIRE AFTER QUALIFICATION (separate) | last-supported version, breaking release, window, security owner, Native parity | ADR-0152 amendment conditions met |
| Third-party Lit/WC interop | client-only foreign components | users | keep | KEEP | none | no SSR promise made |
| `authoring.ts` compiled-class detection | routing discriminator | route scanning | migrate to metadata, not presence of execution data | REFACTOR | D-O2 | detection survives the split |
| `island-blocks-scan.ts` source-text detection | builds detection | SSG | migrate to emitted metadata flag | REFACTOR | D-O2 | string scan replaced with a fact |
| `stream-runtime.ts` identity checks | build skew rejection | streaming | keep | KEEP | ABI change | mismatch diagnostics preserved |

## Distribution / docs / tests

| Item | Responsibility | Consumers | Action | Exit criteria |
| --- | --- | --- | --- | --- |
| Package exports and `sideEffects` | consumption contract | packed consumers | KEEP this cycle (documentation-only task) | any change is a future implementation item |
| Release gates, exact-SHA evidence, packed consumers | qualification | releases | KEEP | unchanged |
| Existing behavioural tests | regression base | all slices | KEEP and migrate per slice | every slice's matrix rows backed by tests |
| Fixtures that only exercise the old executor | regression of current behaviour | current release | REFACTOR as the new path lands | replaced only when the replacement covers them |
| Superseded docs | guidance | contributors | REFACTOR (amend, do not rewrite history) | canonical doc established (done) |
| Lit-specific fixtures/tests | Lit renderer qualification | Lit retirement | **OUT OF SCOPE for Alpha16** | handled in the Lit track |

## Explicit non-actions

This inventory does **not** authorise, in this task or in Alpha16 without its own
qualification:

1. deleting the Part Program, its validator, or `__partProgram`;
2. deleting the class/decorator authoring API;
3. deleting the Lit renderer or its subpaths;
4. removing installation seams because they "look obsolete";
5. changing package exports, dependencies, versions or release artifacts;
6. removing `runtime-program.ts` normalization while the browser still
   interprets structure;
7. treating a filename or a 1000-line module as evidence of obsolescence.

Every REPLACE or RETIRE row above requires: consumer trace, behaviour coverage,
browser matrix, packed consumer evidence, an owner for the transition, and a
rollback path.
