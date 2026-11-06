# Alpha16–18 retirement roadmap

Date: 2026-11-03. Baseline: `4f1f2001b`. Status: **APPROVED POLICY / NOTHING IS
AUTHORISED FOR DELETION BY THIS DOCUMENT ALONE**. Companion to
[the freeze audit](./alpha16-18-freeze-audit.md) and
[the cleanup inventory](./alpha16-18-cleanup-inventory.md).

Rules that govern every row:

1. No deletion on filename, size or personal preference.
2. Every deletion names its consumers and its replacement evidence first.
3. Public API removal needs an owner decision; internal removal needs graph
   evidence plus behaviour coverage.
4. Lit retirement follows ADR-0152 and is never mixed into Alpha16.
5. The Class authoring API retirement is **approved** (P-1/P-5, 2026-11-03); the earlier D-O3 adapter decision is superseded. No adapter is built and no second authoring path exists.

## 1. Disposition matrix

| Object | Kind | Current consumers | Disposition | Replacement | Deletion precondition | Test / gate | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `@element` decorator | public API | app authors; 2026-11-03 baseline recorded 219 in-tree files (historical size metric, not a current count) | **RETIRE (approved 2026-11-03)** | function components + generated native CE boundary | per-file class→function migration matrix **and** the [capability inventory](#class-retirement-capability-gate-alpha16b) show an approved replacement for every current capability; the file inventory is re-taken at execution; no external users (owner-declared) | class→function migration matrix + capability parity | Alpha16b |
| `OpenElement` base class | public API | authors, runtime | **RETIRE as author surface (approved)**; internal generated base may remain | emitted internal base | no author imports it; internal need re-checked | registration/lifecycle tests | Alpha16b |
| `jsx-runtime.ts` / `jsx-dev-runtime.ts` | public types + guard | typecheck, fail-closed test | **KEEP** | — | guard must keep failing closed | JSX-outside-compiler test | permanent |
| `LifetimeScope` | internal primitive | kernel, blocks, parts, hydrate | **KEEP** | — | — | TSX-27 | permanent |
| Signals (`@preact/signals-core` + internal contract) | dependency | everything | **KEEP** | — | — | signal tests | permanent |
| Part Program v2 + validator | protocol + public export | runtime, SSR, Router, build, tests | **RETIRE (approved)** as serialized browser protocol | compiler IR + narrow ABI | per-consumer migration complete; M10 evidence | consumer map + M10 | Alpha16b |
| `__partProgram` emitted field | generated ABI | see consumer map | **REMOVE (approved)** from target contract | narrow generated ABI | every consumer migrated; ABI designed in M01 | M01 + M10 | Alpha16b |
| `PART_PROGRAM_VERSION` | ABI stamp | generated modules, stream identity | **RETIRE (approved P-4)** | new ABI version constant | schema retirement + new ABI version exists | mismatch tests | Alpha16b |
| `COMPILED_MODULE_ABI_VERSION` v2 (old generated-module stamp) | ABI stamp | generated modules, facade | **RETIRE in Alpha16b** (approved P-3/P-4) — this is the *old* ABI's number, superseded by the new ABI's own version | the new ABI's own version constant | new constant exists and every v2 consumer is migrated | abi mismatch tests | Alpha16b |
| **New generated-module ABI version** — compatibility checking | ABI stamp | generated module ↔ runtime helpers ↔ server/client build identity | **INTRODUCE in Alpha16b: check only, no freeze** | — | module, runtime helpers and build identity agree; mismatch rejected early | mismatch + build-identity tests | Alpha16b |
| **Cross-module ABI freeze** | published contract guarantee | precompiled library ↔ consumer | **FREEZE in Alpha17**; never a 16b deliverable | — | packed-consumer evidence constrains the contract | TSX-21 packed consumers | Alpha17 |
| Generic browser executor: `fresh-dom.ts` walker | internal | kernel connect (fresh) | **RETIRE AFTER QUALIFICATION** | generated mount | M10 unreachability + full behaviour coverage | M10, M13 | Alpha16b |
| Part dispatch helpers in `parts.ts` | internal | fresh-dom, hydrate | **REFACTOR** — split generated operations from retained helpers | generated code + small helpers | per-helper retirement condition | per-part regression | Alpha16b |
| `blocks.ts` when/each builders | internal | fresh-dom, hydrate | **REFACTOR** — keep keyed identity/`itemBox` concepts, replace structural walk | generated keyed algorithm | S2/S3 evidence | TSX-04/06/07/08 | Alpha16b |
| `hydrate.ts` claim executor (1004 lines) | internal | kernel connect (claim) | **REFACTOR → REPLACE where feasible** | generated claim | claim fidelity matrix | TSX-18/30 | Alpha16b |
| `runtime-program.ts` normalization | internal | every connect | **RETIRE AFTER QUALIFICATION** | generated code carries structure | no runtime-only normalization left | M10 | Alpha16b |
| `blocks-install.ts` / `hydrate-seam.ts` | internal seams | public entries (`index.ts`, `client-only`) | **KEEP until byte+graph measurement** | — | measured bytes + graph proof | contract tests | Alpha16b |
| `no-blocks.ts` / `client-only` entries | public subpath | bundlers, apps | **KEEP** | — | deprecation decision | subpath tests | — |
| `base.ts` / `./base` subpath | public subpath | apps | **KEEP** | — | deprecation decision | subpath tests | — |
| `authoring.ts` compiled-class detection | internal | routing | **REFACTOR** to a Router **build-time page-classification fact** (not an ABI field) | plugin-derived classification at build time | migration with M01 boundary §7 | router authoring tests | Alpha16b |
| `island-blocks-scan.ts` lexical scan | internal | SSG blocks detection | **REPLACE** with emitted flag | metadata | must migrate with any field-shape change | SSG tests | Alpha16b |
| `compiled-artifact-style-requests.ts` lexical scan | internal | CSS edge recovery | **REPLACE** with emitted ABI metadata | metadata | same change as the field shape | CSS recovery tests | Alpha16b |
| `server-component.ts` (string composition) | internal | client + SSG builds | **REFACTOR** (extend: locals; async per M14) | — | — | M14 | Alpha16b |
| SSR serializer + DSD path | internal | server rendering | **KEEP** | — | — | SSR matrix | permanent |
| Security sinks (`forbidden-sinks.ts`) | internal | compiler, server, runtime | **KEEP** | — | — | sink fixtures | permanent |
| `renderer-adapter.ts` native branch | internal | Framework Mode | **KEEP** | — | — | router tests | permanent |
| `renderer-adapter.ts` lit branch | internal | Lit users | **RETIRE (ADR-0152 track)** | Native | last-supported version, window, security owner, parity | Lit track gate | independent |
| `router/src/lit.ts`, `lit-ssr.ts`, `./lit`, `./lit-ssr` | public API | Lit users (count unknown) | **RETIRE (ADR-0152 track)** | Native | ADR-0152 conditions | Lit track gate | independent |
| `@lit-labs/ssr` shim (shim #8) | shim | `lit-ssr.ts` | **RETIRE with the Lit track** | — | Lit track | Lit track gate | independent |
| Lit-only fixtures/tests | tests | Lit renderer | **RETIRE with the Lit track** after shared assertions migrate | native/neutral fixture | shared assertions migrated first | — | independent |
| Third-party WC interop | product capability | users | **KEEP** | — | — | interop fixtures | permanent |

**Three ABI actions, deliberately kept apart** (the earlier single "KEEP …
Alpha17" row conflated them; that wording is **SUPERSEDED HISTORY**):

| Action | Phase | Meaning | Not |
| --- | --- | --- | --- |
| old version constant retires (`PART_PROGRAM_VERSION`, `COMPILED_MODULE_ABI_VERSION` v2) | Alpha16b | the old stamps disappear with the old schema/ABI | not a freeze |
| new ABI version **compatibility check** | Alpha16b | generated module, runtime helpers and server/client build identity agree; mismatch rejected early | not a freeze |
| cross-module ABI **freeze** | Alpha17 | a library compiled against ABI N is guaranteed to work in a consumer on ABI N | not a 16b deliverable |

Status: **CURRENT FACT** — v2 is the present stamp. **APPROVED TARGET** — it retires
in Alpha16b and is replaced by the new ABI's own version. **Alpha17** owns the
freeze, constrained by packed-consumer evidence. Authoritative table:
[compiler-ir-and-abi-boundary §7.1](./compiler-ir-and-abi-boundary.md#71-versioning-three-separate-checks).

### Class retirement capability gate (Alpha16b)

The 2026-11-03 baseline count of 219 files is a **historical size metric**, not
migration **evidence** and not a current inventory. Before the `@element` /
`OpenElement` author surface is withdrawn, the Alpha16b record must carry both:
a per-file matrix re-taken at the then-current SHA, and the capability inventory
below.

1. a per-file class→function migration matrix (every in-tree call site, its
   replacement and its evidence), and
2. the capability inventory below, with an approved replacement for every
   capability the class path currently supplies.

At minimum, the inventory covers:

- setup/dispose lifecycle, ownership, cleanup and error containment;
- single-root, multi-root, fragment and empty output;
- read-only props, Signals, `computed`, inline tracked expressions and
  destructuring snapshots;
- events, refs, conditions, lists and keyed identity/reuse;
- `children` and reusable JSX values, including repeated projection;
- styles/classes, Shadow DOM, DSD, slots, CE registration,
  property/attribute conversion, native events and forms;
- SSR, claim markers/order, key alignment, permitted seed, bounded recovery and
  claim-phase input/focus/selection preservation (platform detach/reinsert is a
  different, platform-controlled case; see the model note §4.1d);
- Router Framework Mode and build-time page classification;
- third-party WC interop, and the build/SSG/package classification facts.

The evidence for these lines is the existing acceptance areas and TSX rows
(M06–M10, M13, TSX-14/18/20/30); the inventory is a checklist, not a new test
vocabulary. This is evidence mapping, not a new API promise, and it does not
authorise deletion by itself.

**No capability may be closed by renaming the API or by moving its semantics to
Alpha17.** Alpha17 may productize semantics already proved in Alpha16b; it may
not be the first place a necessary class capability receives a replacement.

## 2. Phased roadmap

### Phase 0 — architecture freeze (this PR)

- correct the contradictions (freeze audit §5);
- rebuild the consumer matrix;
- produce this inventory and the freeze audit;
- **no product source changes**.

Exit: PR reviewed and merged; no open P1.

### Phase 1 — Alpha16a

- build the generated execution foundation (M01–M08);
- keep the old executor for un-migrated capabilities;
- prove G1/G2 on leaf and stateful slices;
- no release, tag, publication or Starter default.

Exit: M01–M08 evidence with G1/G2 recorded. **Retirement: none.** M10a may run opportunistically.

### Phase 2 — Alpha16b

- migrate every required browser capability (M09–M13);
- retire the class authoring API and frontend only after the per-file migration
  matrix and the [capability inventory](#class-retirement-capability-gate-alpha16b)
  show every current capability has an approved replacement; no adapter is built;
- **M14 full-await async server components** (Alpha16b; never Alpha16a, never Alpha18 bounded defer);
- produce M10 reachability evidence for **each** production browser entry
  (Element default, `client-only`, `no-blocks`, `base`, Router-generated client
  entry);
- retire the generic walker, the runtime-only normalization and superseded seams;
- qualify packed consumers, browsers and the release.

Exit: ADR-0174 gate satisfied; release qualified. If it is not satisfied, no
release — the work stays internal.

### Phase 3 — Alpha17

- Full TSX productization, cross-module recipes, frozen generated ABI, public API
  completion, Starter/docs/examples migration;
- class-authored examples and docs migrate to function components; **no adapter
  exists**, and the class API itself is already retired in Alpha16b. Alpha17 may
  not be used to defer a necessary 16b replacement behind a product API name.

Exit: G3 consumer evidence; API freeze decisions.

### Phase 4 — Alpha18

- bounded defer, streaming, cancellation, request-scoped ownership;
- no unbounded Promise, no second execution model.

### Independent track — Lit retirement

Follow ADR-0152: last supported version, breaking release, compatibility window,
security owner, migration docs, export/dependency removal, Native parity,
rollback. Not merged into Alpha16.

## 3. What must never appear on this roadmap

Each row below is a prohibition on **unqualified** action, not on the approved retirement itself.

- Deleting the Class/decorator API before Alpha16b qualifies its migration with the per-file matrix and the [capability inventory](#class-retirement-capability-gate-alpha16b) (the retirement itself is approved).
- **Premature** deletion of the Part Program, its validator or `__partProgram` before their consumers are migrated and Alpha16b qualifies. Their retirement is approved policy, not an open question; what this roadmap forbids is deleting them without the evidence.
- Deleting the JSX type entry or its fail-closed guard.
- Deleting SSR/DSD, security sinks, Signals or `LifetimeScope` for size reasons.
- Removing a public subpath without a deprecation decision.
- Treating "no consumer found by grep" as proof of no consumer.

## 4. Required evidence per retirement action

Every action in Phase 2 or later must attach:

1. the object and its historical purpose;
2. the traced consumers (with file:line), separated into production, build,
   test and docs;
3. the replacement and its coverage proof;
4. entry-graph evidence for every production browser entry;
5. byte/size attribution before and after;
6. rollback: the revert set, not a partial in-place edit;
7. the owner who signs the removal.

An action missing any of these stays open, regardless of how obviously obsolete
the code looks.

## 5. Fourth-pass status

P-1…P-5 are **approved (2026-11-03)** as one decision package
([reassessment](./alpha16-18-fourth-pass-reassessment.md)). The rows above are
therefore approved destinations, not live deletions: every one still requires its
consumer trace, per-area M10 evidence (browser, server, build, ABI, public API) and
Alpha16b qualification. Approval is policy; the roadmap is execution.
