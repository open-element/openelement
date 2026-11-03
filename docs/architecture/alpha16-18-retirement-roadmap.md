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
5. Class API removal requires **owner approval** (fourth-pass proposal P-1); the 2026-11-03 D-O3 adapter decision governs until superseded.

## 1. Disposition matrix

| Object | Kind | Current consumers | Disposition | Replacement | Deletion precondition | Test / gate | Milestone |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `@element` decorator | public API | app authors, 219 in-tree files | **RETIRE (approved 2026-11-03)** | function components | in-tree migration + release note; no external users (owner-declared) | class→function migration matrix | Alpha16b |
| `OpenElement` base class | public API | authors, runtime | **RETIRE as author surface (approved)**; internal generated base may remain | emitted internal base | no author imports it; internal need re-checked | registration/lifecycle tests | Alpha16b |
| `jsx-runtime.ts` / `jsx-dev-runtime.ts` | public types + guard | typecheck, fail-closed test | **KEEP** | — | guard must keep failing closed | JSX-outside-compiler test | permanent |
| `LifetimeScope` | internal primitive | kernel, blocks, parts, hydrate | **KEEP** | — | — | TSX-27 | permanent |
| Signals (`@preact/signals-core` + internal contract) | dependency | everything | **KEEP** | — | — | signal tests | permanent |
| Part Program v2 + validator | protocol + public export | runtime, SSR, Router, build, tests | **RETIRE (approved)** as serialized browser protocol | compiler IR + narrow ABI | per-consumer migration complete; M10 evidence | consumer map + M10 | Alpha16b |
| `__partProgram` emitted field | generated ABI | see consumer map | **REMOVE (approved)** from target contract | narrow generated ABI | every consumer migrated; ABI designed in M01 | M01 + M10 | Alpha16b |
| `PART_PROGRAM_VERSION` | ABI stamp | generated modules, stream identity | **KEEP** | — | — | mismatch tests | — |
| `COMPILED_MODULE_ABI_VERSION` v2 | ABI stamp | generated modules, facade | **KEEP, versioned separately from the future ABI** | new ABI gets its own number | no freeze before consumer evidence | abi mismatch tests | Alpha17 |
| Generic browser executor: `fresh-dom.ts` walker | internal | kernel connect (fresh) | **RETIRE AFTER QUALIFICATION** | generated mount | M10 unreachability + full behaviour coverage | M10, M13 | Alpha16b |
| Part dispatch helpers in `parts.ts` | internal | fresh-dom, hydrate | **REFACTOR** — split generated operations from retained helpers | generated code + small helpers | per-helper retirement condition | per-part regression | Alpha16b |
| `blocks.ts` when/each builders | internal | fresh-dom, hydrate | **REFACTOR** — keep keyed identity/`itemBox` concepts, replace structural walk | generated keyed algorithm | S2/S3 evidence | TSX-04/06/07/08 | Alpha16b |
| `hydrate.ts` claim executor (1004 lines) | internal | kernel connect (claim) | **REFACTOR → REPLACE where feasible** | generated claim | claim fidelity matrix | TSX-18/30 | Alpha16b |
| `runtime-program.ts` normalization | internal | every connect | **RETIRE AFTER QUALIFICATION** | generated code carries structure | no runtime-only normalization left | M10 | Alpha16b |
| `blocks-install.ts` / `hydrate-seam.ts` | internal seams | public entries (`index.ts`, `client-only`) | **KEEP until byte+graph measurement** | — | measured bytes + graph proof | contract tests | Alpha16b |
| `no-blocks.ts` / `client-only` entries | public subpath | bundlers, apps | **KEEP** | — | deprecation decision | subpath tests | — |
| `base.ts` / `./base` subpath | public subpath | apps | **KEEP** | — | deprecation decision | subpath tests | — |
| `authoring.ts` compiled-class detection | internal | routing | **REFACTOR** to metadata flag | emitted metadata | migration with M01 | router tests | Alpha16b |
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

Exit: M01–M08 evidence recorded. **Retirement: none.** M10a may run opportunistically.

### Phase 2 — Alpha16b

- migrate every required browser capability (M09–M13);
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
- class authoring continues through the adapter.

Exit: G3 consumer evidence; API freeze decisions.

### Phase 4 — Alpha18

- bounded defer, streaming, cancellation, request-scoped ownership;
- no unbounded Promise, no second execution model.

### Independent track — Lit retirement

Follow ADR-0152: last supported version, breaking release, compatibility window,
security owner, migration docs, export/dependency removal, Native parity,
rollback. Not merged into Alpha16.

## 3. What must never appear on this roadmap

- Deleting the Class/decorator API before Alpha16b qualifies its migration (the retirement itself is approved).
- Deleting the Part Program, its validator or `__partProgram` (D-O2).
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
