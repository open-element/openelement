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

| # | Risk | Trigger | Impact | Mitigation | Owner of the decision |
| --- | --- | --- | --- | --- | --- |
| R1 | JSX value model chosen wrong and re-worked after consumers exist | recipes shipped without the two-insertion and deferred-insertion tests | large rework, ABI churn | prove TSX-23/25/26 before any public type; keep the recipe opaque | architect |
| R2 | Props replacement silently stale | keyed reuse implemented with captured values | wrong data saved, hardest class of bug | require the live-getter invariant and the handler-sees-new-item test | runtime |
| R3 | Generated code larger than the program it replaces | codegen measured only after executor removal | budget regression, size-claim failure | measure full reachable closure per change; keep the old path until graph evidence exists | compiler |
| R4 | Claim cannot reproduce repeated insertion order | markers assumed order-free | hydration mismatch or silent duplication | design the marker protocol in S3 before A17 freeze | runtime |
| R5 | Two runtimes across a package boundary | precompiled library bundles its own copy | broken identity, double subscriptions | singleton check or explicit rejection; test from a tarball | distribution |
| R6 | Safety regressions while grammar widens | new expression positions bypass sink screening | XSS / URL injection | one sink source of truth; positive and negative fixtures per new position | security |
| R7 | Lit retirement confused with this programme | pressure to delete while native is unproven | lose a working renderer, break users | retirement is a separate gated change with its own announcement and window | product |
| R8 | Public API frozen early to unblock a demo | naming pressure | permanent compatibility debt | G3 gate; names stay candidate until consumer evidence | product |
| R9 | Evaluation-timing surprises (per-insertion props) | authors assume React snapshot semantics | confusing bugs, support load | document the counts (TSX-28) and test them; consider a dev-mode warning | architect |
| R10 | Owner/region model outgrows `LifetimeScope` | cross-owner projection or portals demanded | redesign mid-flight | keep projection inside the defining subtree in Alpha16; portals are a later explicit decision | architect |

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
