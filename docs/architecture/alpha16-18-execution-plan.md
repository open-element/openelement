# Alpha16–18 execution plan

Date: 2026-11-03. Status: **PROPOSED**, awaiting owner review. Baseline:
`4f1f2001b24909086f7e7efe9e5016d48d615c91`.

This plan implements the direction accepted in
[ADR-0173](../adr/ADR-0173-component-execution-and-composition.md) and
[ADR-0174](../adr/ADR-0174-generated-code-runtime-and-compatibility.md), with
the author contract revised in
[the TSX contract](./tsx-author-candidate-contract.md), the model in
[JSX values and repeatable children](./jsx-value-and-children-model.md), and the
current-state evidence in
[the architecture audit](./alpha16-18-architecture-audit.md).

Nothing in this plan is implemented. No dates are promised; each stage is gated
on evidence, and a failed gate narrows scope rather than lowering the bar.

## 0. Work classes

Every item below carries one class. Confusing them is how a prototype becomes a
shipped promise:

| Class | Meaning | May be described as |
| --- | --- | --- |
| **A** Architecture decision | A recorded decision with rationale | decided |
| **P** Prototype | Disposable code proving a mechanism fits | spike, not a feature |
| **I** Production implementation | Reviewed, tested, maintained code | implemented |
| **Q** Qualification | Evidence: browser matrix, packed consumers, budgets, exact SHA | qualified |
| **R** Release | Published artifact and notes | released |

A prototype never counts as feature completion. A green CI run never counts as
browser qualification.

## 1. Alpha16 — semantic foundation and first real code generation

Goal: prove that the target author semantics and the target execution model work
together on one real slice, before replacing anything.

### A16-1 Grammar and semantics (A + I)

- Admit multi-root and fragment roots, then value-position JSX, then inline
  tracked expressions. Each admission lands with its diagnostics and its
  negative cases in the same change.
- Produce the semantic matrix for TSX-01…TSX-30 with explicit OPEN items, in
  [the test matrix](./alpha16-18-semantic-test-matrix.md).
- Do **not** widen grammar and rewrite lowering in one change.

Exit: the contract exists as executable expectations, and every case has a
stated phase applicability.

### A16-2 Runtime primitives (P → I)

- Mount recipe + insertion owner (`insert(owner, recipe, parent, before)`),
  built on `LifetimeScope.child()` and `addRangeCleanup`.
- Props as tracked getters; inline expression tracking on the same signals
  engine.
- Keyed reuse updating the value behind a props getter (the `itemBox` pattern,
  promoted).

Exit (G2): two insertions of one recipe produce two owners, two signal sets, two
DOM regions, two cleanups; keyed replacement preserves instance, draft, DOM
nodes, input value, focus and selection; disposal is idempotent.

### A16-3 Slices (P → I → Q)

Executed in order; each slice feeds the next. They are not three demos.

| Slice | Contents | Evidence required |
| --- | --- | --- |
| S1 running leaf | single/multi root, fragment, empty output, signal+computed update, dispose, throwing cleanup | real generated code executes in a browser; no IR or snapshot-only proof |
| S2 stateful hostless list | private draft, props replacement, keyed reorder, insert/delete, conditions, reusable JSX values, repeated children projection, owner/region isolation | instance counts, owner identity, DOM identity, focus/selection, cleanup counts |
| S3 same list across SSR/claim/consumer | SSR, claim, update, dispose, mismatch, pre-activation input, source maps, packed tarball consumer in a fresh app | SSR→claim parity; packed consumer without workspace aliases |

S3's consumer work starts as soon as S2's list exists; it must not wait for ABI
freeze.

### A16-4 Output and server foundation (I, partly independent)

- Public/private output separation, publish manifest authority, server-only
  import guard, server function async/full-await.
- These may proceed in parallel with A16-1..3 because they do not depend on the
  component model, but they share the release candidate.

### A16-5 Retirement assessment (Q)

- Establish graph evidence that the old generic executor is unreachable from
  production entries, and behavioural coverage for every capability it serves.
- Decision: retire in this release only if both hold. Otherwise ship with both
  paths present, both tested, and an explicit note; do not weaken.

### Alpha16 gates

| Gate | Question | Fail behaviour |
| --- | --- | --- |
| G1 | Does generated code actually execute (not just get emitted)? | Do not proceed to structure work; fix generation |
| G2 | Are instance identity, owner, region, signals, cleanup and keyed movement proven? | Limit structural expansion; no ABI work |
| G3 | Do authors and independent consumers accept it, with types, positive/negative compile cases and a packed consumer? | Do not freeze public API or switch the starter default |

G1/G2/G3 are the existing gates from ADR-0173/0174; this plan adds no approval
layer.

## 1A. Milestone map, dependencies and critical path

Milestone ids are stable for referencing in issues and evidence records.

| ID | Milestone | Depends on | Parallel with | Exit evidence |
| --- | --- | --- | --- | --- |
| M01 | Semantic IR / compiler boundary decision (compile-time vs wire vs metadata) | D-O2 decision | M05 | recorded split with consumer trace |
| M02 | Full TSX admission (fragments, multi-root, value-position JSX, inline expressions) | M01 | M04 | admitted cases with diagnostics + negatives |
| M03 | Function component frontend adapter | M02 | M05 | same diagnostics/spans as class path |
| M04 | Runtime primitives: mount recipe, insertion owner, tracked props | M01 | M03 | G2 evidence on two insertions and keyed replacement |
| M05 | Generated client codegen: mount/update/dispose | M03, M04 | M06 | G1: generated code actually runs in a browser |
| M06 | Generated claim | M05 | M07 | claim fidelity matrix |
| M07 | SSR integration for the generated backend | M05 | M06 | SSR→claim parity on the same slice |
| M08 | Keyed identity + props replacement on the generated path | M04, M05 | M09 | DOM identity, focus, selection, handler-current-item |
| M09 | Class compatibility adapter on the shared backend | M05 | M08 | class fixtures pass on the new backend |
| M10 | Old executor migration / retirement evidence | M05–M09 | — | graph reachability + behaviour coverage (D-O1) |
| M11 | Router integration for the generated path | M07, M10 | — | Framework Mode unchanged in contract |
| M12 | Packed consumer qualification | M05 (early), M11 | — | tarball in a fresh app, no aliases |
| M13 | Browser + server qualification | M05–M12 | — | three engines, exact SHA |

**Critical path:** M01 → M02 → M04 → M05 → M06/M07 → M10 → M11 → M13.

**Parallelisable without blocking:** M08 (keyed/props) after M04; M09 (class
adapter) after M05; M12 starts as soon as any generated slice can be packed, and
deliberately precedes ABI freeze; security/output separation work runs
independently.

**Rollback points:** after M04 (primitives can be abandoned with no public
surface), after M06 (claim can be reverted while mount stays), after M09 (class
adapter removal is additive), and before M13 (release boundary). Each rollback is
a revert of one change set, never a partial in-place surgery.

**Post-Alpha18:** Rust compiler PoC only after M01–M13 stabilise semantics, IR,
ABI, codegen, source maps, diagnostics and benchmarks. It implements the same
semantics; it does not rewrite the browser runtime.

## 2. Alpha17 — Full TSX productization

Only what Alpha16 proved may be productized here.

- Complete function component API: props typing, children, fragments, context,
  ref, lifecycle, error boundary.
- Generated-module ABI, versioned and rejected early on mismatch.
- Precompiled component distribution: server/client entries, declarations,
  relocatable CSS, runtime-uniqueness checks, one supported consumption mode.
- Starter, docs and example migration; class authors migrated with a documented
  adapter, not a parallel renderer.
- Public API freeze happens **after** consumer evidence, not before.

Not allowed: a second component execution model kept "for compatibility"; an ABI
frozen without a consumer; package distribution proven only inside the monorepo.

## 3. Alpha18 — bounded defer

Only on the stable Alpha17 model.

- Explicit deferred component scope with bounded concurrency, queue depth,
  buffered bytes, deadline and cancellation.
- SSR/client coordination for streamed regions; wire compatibility and build
  identity checks.
- Cancellation propagates to framework scheduling; external promises are not
  claimed to be interruptible.
- Request isolation and security regressions preserved from the existing stream
  channel.

Not allowed: arbitrary Promise as a child; unbounded nesting; defer without
resource and cancellation bounds; a Flight/RSC rewrite.

## 4. Sequencing and shared surfaces

Single writer by default (owner ruling: plan and review in the session layer,
implementation in the cheap-model lane, one consolidation change set). If
parallel lanes are ever opened, this is the conflict surface:

| Surface | Who must own it | Rule |
| --- | --- | --- |
| `lower-program.ts` / `compile.ts` grammar | one lane | grammar and diagnostics change together |
| `protocol/part-program.ts` + ABI | one lane | protocol change precedes its consumers |
| `element/.../runtime/*` executors and claim | one lane | no lane edits claim and codegen independently |
| generated module emission | one lane | size measurement in the same change |
| fixtures/packed consumers | one lane | one fixture, several assertions; never two fixtures for one behaviour |
| generated files, manifests, index, snapshots | integrator | regenerate once, after the lanes are merged |
| docs index and ADR index | one owner | one annotation per record |

Local sequence before any push: merge → generate → check → fix → then push.

## 5. Risk register

| # | Risk | Probability | Impact | Detection | Mitigation | Blocking gate | Owner decision? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | JSX value model chosen wrong and re-worked after consumers exist | Medium | High | two-insertion / deferred-insertion tests fail late | prove TSX-23/25/26 before any public type; keep the recipe opaque | G2 | No |
| R2 | Props replacement silently stale | Medium | High | handler-sees-new-item test fails | enforce live-getter invariant; mirror `itemBox` | G2 | No |
| R3 | Generated code larger than the program it replaces | Medium | Medium | full-closure byte measurement per change | keep old path until graph evidence; measure before removal | G1 | No |
| R4 | Claim cannot reproduce repeated insertion order | Medium | High | S3 matrix | design marker protocol in M06 before ABI freeze | G2 | No |
| R5 | Two runtimes across a package boundary | Low | High | packed consumer with two copies | singleton check or explicit rejection | G3 | No |
| R6 | Safety regressions while grammar widens | Low | High | sink fixtures per new expression position | one sink source of truth; negatives per position | G1 | No |
| R7 | Lit retirement contaminates Alpha16 | Medium | Medium | PR scope creep | separate track with its own gate | — | **Yes: D-O1/Lit** |
| R8 | Public API frozen early to unblock a demo | Medium | High | names appear in docs/starters before G3 | G3 gate; names stay candidate | G3 | No |
| R9 | Evaluation-timing surprise (per-insertion props) | High | Medium | author reports / TSX-28 counts | document counts; consider dev warning | G3 | No |
| R10 | Owner/region model outgrows `LifetimeScope` | Low | High | cross-owner projection demand | keep projection inside defining subtree in Alpha16 | G2 | No |
| R11 | Old-executor retirement gate infeasible in one release | High | High | M10 evidence missing at release time | split release or amend the gate explicitly (D-O1) | release | **Yes: D-O1** |
| R12 | `__partProgram` split breaks Router detection | Medium | High | routing/SSG tests after split | migrate lexical consumers in the same change | G1 | **Yes: D-O2** |
| R13 | Test migration lags implementation | Medium | Medium | matrix rows unbacked | migrate per slice, not at the end | G3 | No |
| R14 | Documentation drift between canonical docs and ADRs | Medium | Medium | index and documentation checks; review | canonical doc + link map; amend ADRs, never rewrite | — | No |
| R15 | Scope expansion (Rust, Flight, second renderer) | Medium | High | proposal review | non-goals list; constraint check (canonical §5) | — | **Yes if proposed** |

## 6. Stop conditions

Stop and re-plan rather than push through when:

1. Props semantics are still unresolved and a slice needs them.
2. Children are owned by more than one live owner in any test.
3. SSR/claim identity of the same list diverges.
4. A packed consumer needs source or aliases.
5. Two runtime copies appear across an ownership boundary.
6. Byte budgets regress without a measured explanation.
7. A safety fixture fails.
8. The author sample must be rewritten in a special way to keep the model
   consistent.

## 7. What "done" means for this plan

- Every claim in the contract has a matrix row with a phase-specific result.
- S1–S3 pass in a browser and in a packed consumer, at a recorded SHA.
- The old executor is either proven unreachable (retire) or explicitly kept with
  coverage and a note.
- Public API remains candidate until G3 evidence exists.
- The Lit boundary is unchanged unless its own gate is met.

A passing CI run is not any of the above.
