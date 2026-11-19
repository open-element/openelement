---
status: active
topic: Stage authority (M01–M14)
summary: M01–M14, the 16a/16b/17/18 split, G1/G2/G3, work classes and risk register; the dependency spine is the stage definition, with the 2026-11-13 amendment (M10-final, M11, 16b slices) and the 2026-11-14 correction retaining the §13.3 capabilities as M09/M10 obligations.
---

# Alpha16–18 execution plan

Date: 2026-11-03 (fourth pass). Status: **APPROVED DIRECTION**, owner decisions
D-O1 approved; the fourth-pass package P-1…P-5 (class retirement, Part Program retirement, `__partProgram` removal, validator/version retirement, no adapter) **approved 2026-11-03**. Baseline: `4f1f2001b24909086f7e7efe9e5016d48d615c91`.

This plan implements the direction in
[ADR-0173](../adr/ADR-0173-component-execution-and-composition.md) and
[ADR-0174](../adr/ADR-0174-generated-code-runtime-and-compatibility.md), with the
author contract in [the TSX contract](./tsx-author-candidate-contract.md), the
model in [JSX values and repeatable children](./jsx-value-and-children-model.md),
the canonical architecture in
[compiler-native-architecture](./compiler-native-architecture.md), and the state
of the tree as recorded on 2026-11-03 (retired into Git history on 2026-11-10).

Nothing here is implemented. No dates are promised and no duration estimates are
claimed: the order below is a **dependency spine**, not a critical path in the
scheduling sense.

## 0. Work classes

| Class | Meaning | May be described as |
| --- | --- | --- |
| **A** Architecture decision | recorded decision with rationale | decided |
| **P** Prototype | disposable code proving a mechanism fits | spike, not a feature |
| **I** Production implementation | reviewed, tested, maintained code | implemented |
| **Q** Qualification | browser matrix, packed consumers, budgets, exact SHA | qualified |
| **R** Release | published artifact and notes | released |

A prototype never counts as feature completion; a green CI run never counts as
browser qualification.

## 1. Alpha16a — internal compiler-native foundation

Alpha16a is an **internal engineering milestone**. It creates no public version,
tag, publication, Starter default or release claim, and it is not a licence to
ship two execution models.

The table follows the dependency spine, not the phase boundary: **only M01–M08
form the Alpha16a exit set**. M09–M14 are Alpha16b work; M10a is a non-gating
early smoke that may run during 16a but is not an exit condition.

| ID | Work | Class | Depends on | Exit evidence |
| --- | --- | --- | --- | --- |
| M01 | Semantic IR / layer boundary decision (IR · Part Program · emitted field · module ABI · wire) | A | — | recorded layer map consistent with the canonical doc |
| M02 | Alpha16 TSX foundation grammar admission (fragments, multi-root, value-position JSX, inline tracked expressions) | I | M01 | admitted cases with source-located diagnostics and negatives in the same change |
| M03 | Function component frontend (the only long-term frontend; class frontend retires in 16b) | I | M02 | diagnostics / Source Map / security parity with the Alpha15 **baseline** |
| M04 | Runtime ownership + recipe primitives (insertion owner, tracked props, lineage check) | P→I | M01 | G2 on two insertions, keyed replacement, disposal modes |
| M05 | Generated leaf mount / update / dispose | I | M03, M04 | G1: generated code actually executes in a browser |
| M06 | Stateful hostless list on the generated path | I | M05 | identity, private draft, keyed reorder, conditions, multi/empty root |
| M07 | Generated claim (leaf) | I | M05 | claim fidelity on the leaf slice |
| M08 | Generated claim + SSR for the stateful list | I | M06, M07 | the same list across SSR → claim → update → dispose |
| M09 | Generated Native Custom Element boundary — emitted element class, registration, property/attribute conversion, events, Shadow DOM/DSD interop, third-party WC compatibility. **Only explicit Native Export / Island Boundary sites generate a CE**; hostless function components are never forced into elements. This is **not** a class adapter: class-authoring migration is M10 partition evidence | I | M05 | emitted element behaves from ordinary HTML and foreign frameworks; no author-facing class requirement; hostless components stay hostless |
| M10 | Legacy-consumer migration and retirement evidence, **per area**: browser runtime, server runtime, build/SSG, ABI/module contract, public API | I→Q | M05–M09 | five separate proofs — see §12a; generic-executor unreachability alone is not sufficient |
| M10a | Early packed-consumer smoke | Q | M05 | generated artifact installs and runs from a fresh packed app, no aliases |
| M11 | Router integration for the generated path | I | M08, M10 | Framework Mode contract unchanged |
| M12 | Final packed-consumer qualification (same stateful list) | Q | M06, M08, M11 | tarball consumption of the full slice; scope per §5 |
| M13 | Browser + server qualification, exact SHA | Q | M09–M12, M14 | three engines, release train |
| M14 | Async server components, full-await (OEC9032 lifted with defined semantics) — **Alpha16b** | I | M02 | awaited output, server-only graph guard intact |

**Alpha16a exit = M01–M08 with G1 and G2 evidence recorded.** M09–M14 belong to
Alpha16b. G3 is not claimed by Alpha16a.

**M03 baseline.** The function-component frontend must match the Alpha15 class
frontend on diagnostics, Source Map fidelity and security semantics; that parity is
the regression baseline. The class frontend is no longer described as a long-lived
parallel path — it retires in Alpha16b.

**M10a is not an Alpha16a exit condition.** It is an early, non-gating smoke run
that may happen as soon as a generated artifact can be packed. Alpha16a still
completes on M01–M08 alone; do not lower it to "whatever M10a proved".

**Claim acceptance chain (M07–M08).** M07 proves the leaf claim: marker/order
encoding, key alignment, permitted seed state, bounded mismatch recovery and
duplicate-subscription accounting. M08 proves the same chain on the stateful list
through SSR → claim → update → dispose. Marker, key, seed and recovery are one
acceptance chain; none of them may be deferred to Alpha17 with the callback or
API name. TSX-18 and TSX-30 are the ledger rows.

## 1a. M02 acceptance — Semantic IR feasibility

Owner-set scope (2026-11-03): M02 proves the IR can **express** the five approved
worked examples. It does not implement SSR or claim.

| # | Criterion |
| --- | --- |
| 1 | All five examples have explicit semantic test cases. |
| 2 | The first four (static hostless, signals-driven, keyed list, reusable JSX value) are covered by IR unit tests. |
| 3 | The fifth (SSR → DSD → Claim) is verified only as **IR expressiveness of the same stateful list**; end-to-end SSR/claim belongs to M06–M08, and the claim marker protocol stays OPEN in M02. |
| 4 | Every newly admitted syntax ships positive **and** negative tests. |
| 5 | Source span, diagnostics, identity and ownership information are asserted, not assumed. |
| 6 | No VNode, no generic interpreter, no second JavaScript AST. |

A pass at M02 is design-feasibility evidence. It is **not** G1, not G2, and not an
Alpha16a exit.

## 2. Alpha16b — retirement and Alpha16 release qualification

Alpha16b is the only route to a formal Alpha16 release.

Required before release:

1. every required browser execution capability migrated (M10);
2. generated mount, update, claim and disposal complete (M05, M07, M08);
3. generated Native Custom Element boundary complete (M09);
3a. the Class authoring frontend and the serialized Part Program protocol retired
    from production paths (approved fourth pass), with the ABI replaced per M01;
    class retirement requires a per-file class→function migration matrix **and**
    the capability inventory in
    the retirement roadmap (retired into Git history on 2026-11-10)
    to show an approved replacement for every current class capability;
4. Router integration (M11);
5. independent packed-consumer qualification (M12);
6. browser and server qualification (M13);
7. **graph evidence that the old generic browser executor is unreachable from
   every applicable production browser entry graph** (M10, proof 1 of 5);
8. behavioural coverage for every migrated capability.

**Two different obligations, often confused.** The ADR-0174 hard gate and the
approved retirement policy are not the same requirement, and neither substitutes
for the other:

| Obligation | Scope | Failure consequence |
| --- | --- | --- |
| **ADR-0174 release gate** | the old generic **browser executor** must be unreachable from every applicable production browser entry graph | Alpha16 does not qualify for release |
| **Approved retirement policy (P-2/P-3/P-4)** | Part Program v2 as a shared serialized browser protocol, `validatePartProgram`, `PART_PROGRAM_VERSION` and `__partProgram` are retired **from the target production contract**; the narrow ABI replaces them | the retirement is incomplete; the ABI work is unfinished |
| **Five M10 proofs** | browser runtime · server runtime · build/SSG · ABI/module contract · public API | any missing proof means M10 is not met |

What retirement **does not** mean: deleting the server's private rendering
structure, the SSR serializer, streaming data, DSD, claim markers, security sinks
or any server-side semantic capability. The server keeps its own structure; it
simply is not the old shared protocol and is not shipped to the browser.

**If Alpha16a succeeds and Alpha16b does not:** the work stays internal; no
Alpha16 release is cut; the failing capability is named and re-planned. Do not
reinterpret the 16a milestone as a release.

## 3. Dependency spine, parallel work and rollback

```text
M01 → M02 → M03 ─┐
      └──→ M04 ──┴→ M05 → M06 → M08 → M11 → M13
                       ├→ M07 ─┘
                       ├→ M09 ──────┘
                       ├→ M10a
                       └→ M10 → M12
```

- **Spine:** M01 → M02 → M04 → M05 → M06 → M08 → M11 → M12/M13.
- M03 is on the spine in practice: M05 cannot be produced without the
  function-component frontend, so it is not parallel with M05.
- **Genuinely parallel:** M07 (leaf claim) and M09 (generated Native CE boundary) both need only
  M05; M10a starts the moment a generated artifact can be packed; security and
  output-separation work is independent of all of the above.
- **M10 cannot start before M05–M09** — reachability evidence for a replacement
  requires the replacement to exist.
- M12 (final packed qualification) follows M11; it is not the same work as M10a
  (early, non-gating smoke).
- M14 (async server components) is parallelisable with M05–M11; it does not
  gate Alpha16a.

Rollback boundaries:

| Boundary | What reverts | What must not be inferred |
| --- | --- | --- |
| after M04 | recipe/insertion primitives (no public surface yet) | nothing about class or Lit support |
| after M07 | claim implementation only; mount stays | not a Part Program decision |
| after M09 | the generated CE boundary implementation | reverting it must not change the authoring-model decision (class retirement is a separate owner decision) |
| after M11 | Router integration of the generated path | Framework Mode contract unchanged |
| before M13 | release boundary | no version, tag or publication |

## 4. Slices

| Slice | Prerequisites | Contents | Evidence |
| --- | --- | --- | --- |
| S1 running leaf | M02–M05 | single/multi root, fragment, empty output, signal+computed, dispose, throwing cleanup | generated code executes; no IR/snapshot-only proof |
| S2 stateful hostless list | S1 + M06 + M04 | private draft, props replacement, keyed reorder, insert/delete, conditions, reusable JSX values, repeated children projection, owner isolation | instance/owner counts, DOM identity, focus/selection, cleanup counts |
| S3 list across SSR/claim/consumer | S2 + M07 + M08 + M12 | SSR, claim, update, dispose, mismatch, pre-activation input, source maps, packed consumption | SSR→claim parity; packed app without aliases |

S3's final acceptance **must** use the same stateful list as S2. Early packed
smoke (M10a) may use a smaller artifact; it is not S3 evidence.

## 5. Packed-consumer scope (Alpha16 vs Alpha17)

- **Alpha16 (M10a, M12):** the generated artifact and the supported consumption
  surface work from a fresh packed application with no workspace aliases and no
  library TSX. The stateful list is packaged as one compiled artifact.
- **Alpha16 does not require** arbitrary cross-module function-component recipe
  composition; that ABI is deferred.
- **Alpha17** qualifies cross-module component recipes and the frozen precompiled
  ABI.

TSX-21 rows must state which of the two they exercised. A green Alpha16 TSX-21
does not prove cross-module recipe distribution.

## 6. Alpha17 — Full TSX productization

Only what Alpha16 proved may be productized here.

- Complete function component API: props typing, children, fragments, context,
  ref, lifecycle, error boundary.
- Full TSX productization: cross-module recipes, remaining admission, author
  experience.
- Generated-module ABI versioned and rejected early on mismatch in Alpha16b
  (compatibility check only); the cross-module ABI freeze is Alpha17 and only
  with packed-consumer evidence (M01 boundary §7.1).
- Precompiled component distribution: server/client entries, declarations,
  relocatable CSS, runtime-uniqueness checks, one supported consumption mode.
- Starter, docs and examples migration. **No class compatibility adapter** is
  built (approved P-5); class-authored examples are rewritten as function
  components, and the retired API is documented in the migration note.

Not allowed: a second rendering backend; an ABI frozen without a consumer; package
distribution proven only inside the monorepo.

## 7. Alpha18 — bounded defer

Only on the stable Alpha17 model.

- Explicit deferred component scope with bounded concurrency, queue depth,
  buffered bytes, deadline and cancellation.
- SSR/client coordination for streamed regions; wire compatibility and build
  identity checks.
- Cancellation propagates to framework scheduling; external promises are not
  claimed interruptible.
- Request isolation and existing stream security regressions preserved.

Not allowed: arbitrary Promise as a child; unbounded nesting; defer without
resource and cancellation bounds; a Flight/RSC rewrite.

## 8. Finite-readiness of the design

Readiness is judged **per phase, not once**. The question list is kept whole, but a
question gates only the phase whose exit set contains it (§1: Alpha16a exit =
M01–M08 + G1/G2). A question in §8b is a **tracked risk** during Alpha16a; it is
not an Alpha16a success condition, and no 16a claim rests on it.

### 8a. Alpha16a must answer these (gate 16a)

| # | Question | Answered by | Gates 16a |
| --- | --- | --- | --- |
| 1 | Can the compiler emit mount/update/dispose that runs? | M05 / G1 | **yes** |
| 2 | Are identity, owner, region, signals and cleanup coherent? | M04, M06 / G2 | **yes** |
| 3 | Do authors accept the semantics? | M02 admission, contract review | **yes** — both land inside 16a |
| 5 | Does claim preserve DOM, input and focus? | M07, M08 | **yes** — M07/M08 are inside the 16a exit set |

### 8b. Alpha16b must answer these (tracked during 16a, never gate 16a)

| # | Question | Answered by | Why it cannot gate 16a |
| --- | --- | --- | --- |
| 4 | Do packed consumers work without aliases? | M12; M10a is an early non-gating smoke | M12 needs M11, and M09 is 16b; a green M10a proves a smaller artifact, not S3 |
| 6 | Is the old executor's reachability measurable? | M10's five proofs (§12a) | M10 cannot start before M05–M09, and M09 is 16b |

**SUPERSEDED HISTORY:** the earlier §8 list presented all six questions as
"must be answered before Alpha16a claims success", which contradicted §1 and is
replaced by §8a/§8b above. Questions 4 and 6 remain required work; they are
answered at 16b, and their absence at 16a is expected, not a failure. During 16a
they are tracked as risk R11 (16b unreachability) and the packed-consumer rows;
M10a may run opportunistically without becoming the answer to question 4.

## 9. Risk register

| # | Risk | Probability | Impact | Detection | Mitigation | Blocking gate | Owner decision? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | JSX value model re-worked after consumers exist | Medium | High | TSX-23/25/26 fail late | prove before any public type; keep the recipe opaque | G2 | No |
| R2 | Props replacement silently stale | Medium | High | handler-sees-new-item fails | live-getter invariant; mirror `itemBox` | G2 | No |
| R3 | Generated code larger than the program it replaces | Medium | Medium | full-closure byte measurement per change | keep the old path until graph evidence | G1 | No |
| R4 | Claim cannot reproduce repeated insertion order | Medium | High | S3 matrix | design the marker protocol in M07/M08 and carry it into the Alpha16b ABI compatibility check (freeze is Alpha17) | G2 | No |
| R5 | Two runtimes across a package boundary | Low | High | packed consumer with two copies | singleton check or explicit rejection | G3 | No |
| R6 | Safety regression while grammar widens | Low | High | sink fixtures per new expression position | one sink source of truth; negatives per position | G1 | No |
| R7 | Lit retirement contaminates Alpha16 | Medium | Medium | scope creep in PRs | separate ADR-0152 track; not on this spine | — | No (already decided) |
| R8 | Public API frozen early to unblock a demo | Medium | High | names in docs/starters before G3 | G3 gate; names stay candidate | G3 | No |
| R9 | Evaluation-timing surprise (props getters evaluate **per read**, not per insertion or per update tick) | High | Medium | author reports; TSX-28 counts | document the §4.2a counts; per-read is approved semantics, not a cost toggle; consider dev warning | G3 | No — owner ruling: per-read (2026-11) |
| R10 | Owner/region model outgrows `LifetimeScope` | Low | High | cross-owner projection demand | keep projection inside the subtree; lineage check | G2 | No |
| R11 | Alpha16b does not reach executor-unreachable state | Medium | High | M10 evidence missing at release | work stays internal; no release; re-plan with the named capability | release | No (D-O1 settled the shape) |
| R12 | Layer split breaks a `__partProgram` consumer | Medium | High | Router/SSG/CSS tests after any field-shape change | migrate the two lexical consumers in the same change; staged per D-O2 | G1 | No (D-O2 settled) |
| R13 | Test migration lags implementation | Medium | Medium | matrix rows unbacked | migrate per slice, not at the end | G3 | No |
| R14 | Documentation drift between canonical docs and ADRs | Medium | Medium | index/doc checks; review | canonical doc + link map; amend ADRs, never rewrite | — | No |
| R15 | Scope expansion (Rust, Flight, second renderer) | Medium | High | proposal review | non-goals list; nine-question constraint check | — | Yes if proposed |

**APPROVED TARGET (owner ruling; semantics, not implementation): props getters evaluate per read.** A getter body
runs each time it is read, inside whatever tracking context performs the read. A
per-update-tick memoisation is **not** an equivalent variant of this contract: it
changes observable evaluation counts, returned values and side-effect order, so it
cannot be adopted as a pure cost optimisation. TSX-28's job is to verify the counts
and record the cost, not to choose between the two. The count table is
[the model note §4.2a](./jsx-value-and-children-model.md).

## 10. Stop conditions

Stop and re-plan rather than push through when:

1. a slice needs props evaluation semantics that differ from the approved per-read
   contract, or the observed counts cannot be made to match it;
2. children are owned by more than one live owner in any test;
3. SSR/claim identity of the same list diverges;
4. a packed consumer needs source or aliases;
5. two runtime copies appear across an ownership boundary;
6. byte budgets regress without a measured explanation;
7. a safety fixture fails;
8. the author sample must be rewritten in a special way to keep the model
   consistent;
9. reaching the M10 unreachability evidence would require weakening a guarantee.

## 11. What "done" means

- Every claim in the contract has a matrix row with a phase-specific result.
- S1–S3 pass in a browser and in a packed consumer at a recorded SHA.
- **Alpha16b release requires the old generic browser executor to be unreachable
  from every applicable production browser entry graph.** A release that keeps
  both production execution paths does not qualify.
- The Class API is **retired** (approved P-1/P-5); no compatibility adapter is
  built and no second authoring path exists.
- Public API remains candidate until G3 evidence exists.
- The Lit boundary is unchanged unless its own separate track gate is met.

A passing CI run is none of the above.

## 12. Approved fourth-pass package (P-1…P-5, 2026-11-03)

The owner approved, as one package: retire the Class/Decorator authoring API; retire
Part Program v2 as a public shared serialized execution protocol; remove
`__partProgram` from the target generated-module ABI; retire the old validator and
version while keeping version compatibility checks; build no authoring
compatibility adapter.

Consequences for this plan:

- Alpha16b retires the class frontend and the old protocol; Alpha17 carries **no**
  adapter obligation and instead owns Full TSX productization, the frozen ABI and
  Starter/docs migration.
- The new ABI's **actual structure is not frozen here**. M01 designs it and packed
  consumer evidence constrains it. It must not become another large JSON
  descriptor, and it must not recreate a generic execution protocol.
- Alpha15 class frontend remains the regression baseline for diagnostics, Source
  Map and security parity (M03), not a maintained parallel authoring path.

### 12a. M10 must produce five separate proofs

| Area | Proof |
| --- | --- |
| Browser runtime | no production browser entry loads the generic executor or the old protocol |
| Server runtime | SSR/streaming consumers read the new server structure, not the old schema |
| Build/SSG | CSS recovery, blocks detection and route classification read build-time facts; CSS/blocks use emitted metadata/ABI facts, while route classification is a Router-plugin build-time fact — none re-parses the old schema or source-text markers |
| ABI/module contract | generated modules carry the narrow ABI; no `__partProgram` in production output |
| Public API | retired exports are gone or deprecated per the approved policy, with the migration note **and the class capability/replacement inventory complete** (the inventory is retired into Git history on 2026-11-10; see the [archive and removal register](../legacy/README.md)) |

Generic-executor unreachability is **one** of the five. It does not stand in for the
other four. Class-authoring migration is M10 partition evidence — public API **and**
browser runtime — not M09 evidence: M09 owns the generated Native Custom Element
boundary only.

## 13. Dated amendment 2026-11-13 (owner-approved)

This section amends three cells and one rule. It **adds**; it does not rewrite
§1, §2 or §12a, and the amended readings below are authoritative where they
disagree with an earlier cell. Approval of this section creates no P5 evidence of
its own (see 13.5).

### 13.1 M10-final, M11 and the dependency cell

**Supersedes the §1 M11 dependency cell (`M08, M10`) and its reading in §3.**

- **M11 start gate** = M08 exit **+ M10-0 preparation**: the capability
  inventory, replacement reachability and graph-tool design. M10-0 is a
  document-local label for preparation; it is not a milestone, not a gate, does
  not gate M11 on its own and does not rename M10a. The §1 M10a row keeps its
  meaning ("Early packed-consumer smoke").
- **M10-final closing gate.** P1–P5 are judged **separately at one SHA**. P1
  (the old generic browser executor is unreachable from every applicable
  production browser entry graph) and M11-3 (the client entry cutover) are **one
  joint integration with two independent verdicts**: landing them together is
  allowed; a green joint integration does not lower either verdict, and neither
  verdict is inferred from the other. M10-final closes after M11-3.
- The dependency spine in §3 stays the ordering authority; this clause only fixes
  *which* M10 obligation gates M11 and when M10 closes.

### 13.2 Five Alpha16b obligation slices

Lifecycle, error boundary, context, refs and the migration note are Alpha16b
obligations with named slices. They are **not** scope exceptions, and no
Alpha17-first implementation is permitted for any of them.

| Slice | Capability | Minimum Alpha16b obligation | Evidence the slice must produce |
| --- | --- | --- | --- |
| `16b-LC` | Class lifecycle (CAP-03) | Generated owner plus `LifetimeScope`, with the author `setup`/`onDispose` (or replacement) decision made inside Alpha16b | setup-once, dispose, reconnect and exception-cleanup matrix on the generated path |
| `16b-EB` | Error boundary (CAP-05) | Boundary API plus capture at connect/claim/update and an SSR fallback | capture points, retry/reset, SSR fallback, no silent swallow |
| `16b-CTX` | Context (CAP-09) | Provider/consumer API and generated wiring with provider/consumer lifecycle | nested providers, consumer update on provider change, disconnect cleanup, TSX-13 |
| `16b-REF` | Refs (CAP-11) | Generated ref API with cleanup and reconnect semantics | ref lifetime across mount/claim/update/disconnect |
| `16b-MN` | Migration note (CAP-26) | The minimum migration guide ships **with Alpha16**: what changes, per-capability mapping and the function replacement for each consumed capability | the note itself, linked from the release-facing surface; Alpha17 only expands it |

### 13.3 Scope exceptions: definition and the approved M09-2 set

> **Superseded in part by §14 (2026-11-14).** The definition paragraph and the
> three exception rows below are replaced: the three capabilities are retained as
> Alpha16 obligations riding M09/M10, not waived. The text below stays as written
> (amend-never-rewrite); §14 is the later reading.

A **scope exception** is a recorded, owner-approved statement that one capability
retires without a same-milestone replacement. It is admissible only when all four
hold:

1. the capability is not required by any Alpha16 release-qualification obligation
   (§2 items 1–8 and §12a P1–P5);
2. a named later milestone carries it, and that carrying is written down;
3. the loss is stated in terms of who is affected (people using sites, authors,
   or implementors) and what they can no longer do;
4. it appears row-for-row in `16b-MN`.

An exception may **not** cover a capability with no replacement, and may **not**
cover the five obligation slices in 13.2. "Belongs to Alpha17" is not by itself a
justification: the retirement-required argument (2) must be made per row.

The approved Alpha16 exceptions for the generated native element boundary are:

| Capability | Recorded as | Carried by | Why it is not required for Alpha16 retirement |
| --- | --- | --- | --- |
| `custom-elements.json` (CEM) generation for generated elements | exception | Alpha17 productization | No Alpha16 qualification path reads a generated element's CEM; the class-only CEM keeps serving the existing corpus unchanged |
| array/object/`trustedHtml` property conversion | exception | Alpha17 | No in-tree consumer declares a non-primitive attribute; conversion of the primitive set is delivered in M09-2 |
| form validity policy (`setValidity` rules) | exception | Alpha17 | Form association, value, reset and restore ship in M09-2; validity *policy* is a product decision, not a mechanism the retirement depends on |

Two items that earlier drafts carried as exceptions are **not** exceptions:

- **Client style declaration for generated islands** is a **deferred
  obligation**, not an exception: a replacement path exists (the router style
  plan and authored `.css` imports), so §13.3's first condition fails. M11
  re-verifies it on a real build and Alpha17 may consolidate it.
- **Utility and theme CSS** is **removed from the list entirely**: it is a
  build-side capability that depends on no authoring model, so it is not a
  capability gap at all. M11 re-verifies it.

### 13.4 Alpha17 boundary

Alpha17 implements no capability whose first implementation is required for
Alpha16 retirement. It owns Full TSX productization, the cross-module ABI freeze
with packed-consumer evidence, precompiled distribution, and the Starter, docs
and example migration. It expands `16b-MN`; it does not become the first home of
a 13.2 obligation, and it does not carry a 13.3 exception as its only record.

### 13.5 P5 evidence

P5 evidence is the **tracked** capability inventory, the final-SHA matrix, the
migration note and the owner sign-off. A draft does not satisfy P5, and applying
this amendment creates none of them. The inventory that this section refers to
stays a working draft until it is tracked and signed; until then, P5 is not
claimable and Alpha16 release qualification is not openable.

### 13.6 Evidence provenance

Every claim that cites this plan — in a ledger, a matrix cell, a closeout record
or a pull request — carries the four-part record (commit, worktree, command,
result) defined in [the evidence baseline](./evidence-baseline.md). The canonical
worktree is named there; other checkouts are advisory only.

## 14. Dated amendment 2026-11-14 (owner-approved correction of §13.3)

This section supersedes the §13.3 exception definition and the three §13.3
exception rows. It adds; it does not rewrite §1, §2, §12a or the rest of §13. It
creates no milestone evidence and no P5 evidence of its own (§13.5 stays in force).

### 14.1 Scope exceptions: corrected definition (replaces the §13.3 definition paragraph)

A **scope exception** is a recorded, owner-approved statement that one capability's
same-surface replacement is deferred to a named later milestone. It is admissible
only when all of the following hold at the recording SHA:

1. **No Alpha16 consumer loses the capability.** No Alpha16 release-qualification
   obligation (§2 items 1–8, §12a P1–P5) and no Alpha16-retained consumer — an
   in-tree production app or package, a packed harness, a public-API consumer, or a
   test that asserts the behaviour — depends on the capability at that SHA.
2. **The absence is proven, not asserted.** Every "no consumer" claim carries a
   four-part evidence record (commit, clean status, exact command, exact result;
   §13.6 and [the evidence baseline](./evidence-baseline.md)) plus a per-file
   search result at a recorded SHA, and is re-proven at the SHA that removes the
   source.
3. **No asserted behaviour disappears.** Removing the capability loses no behaviour
   asserted by an in-tree test, a packed consumer, the public-interface snapshot or
   a documented user-facing contract. If any consumer is affected, the capability
   is retained in Alpha16 as a named obligation and cannot be an exception.
4. **A named later milestone carries the replacement**, written down with its own
   obligations. "Belongs to Alpha17" is never sufficient.
5. **The loss is stated per affected party** (people using sites, authors, or
   implementors) and per capability; a row that cannot name the affected party
   cannot be recorded.
6. **The row appears row-for-row in `16b-MN`**, one capability per row.
7. **The row is a single capability.** An exception is not a package of
   capabilities and may not cover any of the five obligation slices in §13.2.

Retention is the default. If any condition fails, the capability is retained in
Alpha16 as part of the M09/M10 obligations rather than waived; approval of plan
text validates none of the factual claims inside a row.

### 14.2 The three §13.3 rows are superseded: retained Alpha16 obligations

The rows below replace the three rows of the §13.3 table. No capability is waived
and no new milestone or slice label is introduced: each retained capability rides
the existing M09 (generated native element platform surface) and M10 (legacy
consumer migration and the five §12a proofs) obligations, with its migration-note
row in `16b-MN`.

| Capability (superseded §13.3 row) | Corrected record | Carried by | Minimum obligation in Alpha16 | Evidence |
| --- | --- | --- | --- | --- |
| `custom-elements.json` (CEM) generation for generated elements | **retained obligation** (was: exception) | M09 generated element platform surface; M10 P3/P5; M12 packed qualification | Generated-element CEM generation, or an owner-approved Alpha16 migration of the packed CEM artifact contract, so the packed qualification chain keeps component metadata through and after the class→function migration; `@openelement/ui#ui-cem:check`, `@openelement/tools-release#package-artifacts:check:prepacked` and the `customElements` metadata equality stay green | generated CEM structure test; packed `@openelement/ui` metadata read back by the CEM scanner; `gate:release` and `gate:packed` green at the same SHA |
| array/object/`trustedHtml` property conversion | **retained obligation** (was: exception) | M09 generated element platform surface (property/attribute conversion); M10 P5 | Non-primitive property channels on the generated element descriptor and emitter: array/object value types (including the `trustedHtml` value model), `attribute: false` property path and SSR property folding; primitive conversion stays as delivered by M09-2 | property round-trip tests for the in-tree consumers (`notes-live`, `open-article-view`, `open-reading-shell`); packed ui-app/site build; the TSX rows that carry those components |
| form validity policy (`setValidity` rules) | **retained obligation** (was: exception) | M09 forms on the generated element surface; M10 P5; `16b-MN` | Form association, value, reset and restore plus the `required → valueMissing` mapping and the `:invalid` / `checkValidity()` / blocked-submit contract of the migrating UI component; full constraint mirroring (type/email, minlength, …) may stay a deferred sub-obligation listed in `16b-MN`, never an exception | the existing form e2e contract re-run on the generated CE; form value/reset/restore tests on the generated path |

### 14.3 No blanket waiver; factual claims require evidence

1. A scope exception is never recorded for a package of capabilities, for a
   capability with a live consumer, or for any obligation slice in §13.2.
2. Every row's justification is evidence: the four-part record, a per-file list
   and re-proof at the removal SHA. An unproven "no consumer" claim is a finding,
   not a justification.
3. A capability whose premise fails is retained, not deferred to Alpha17.
4. Alpha17 implements no capability whose first implementation is required for
   Alpha16 retirement (§13.4 stays in force).

### 14.4 What this amendment does not change

- §13.1 (M10-final, M11 start gate, P1/M11-3 joint integration) is unchanged.
- §13.2's five obligation slices are unchanged; §14.2 introduces no new slice and
  no new milestone — the three retained capabilities ride M09 and M10.
- §13.3's two non-exception items are unchanged: client style declaration stays a
  deferred obligation; utility/theme CSS stays outside the capability list.
- §13.4, §13.5 and §13.6 are unchanged as written. §13.6's "other checkouts are
  advisory only" is read with the 2026-11-14 evidence-baseline correction: the
  four-part record decides admissibility, and any checkout at the cited commit
  with clean status is legitimate (the baseline document carries the rule).
- No version, tag, publication, public API freeze or release claim is created.

## 15. Dated amendment 2026-11-14 (release-prerequisite citation correction)

This section **adds**; it does not rewrite §1, §2, §12a, §13 or §14. It follows
the amend-never-rewrite form of §13 and §14: the earlier text stays as written
and this is the later reading. It creates no milestone evidence, no P5 evidence,
no gate record, and no version, tag, publication, public API freeze or release
claim.

### 15.1 Later reading of §2 item 3a and the §12a Public API proof

§2:111-116 requires "the capability inventory in the retirement roadmap
(retired into Git history on 2026-11-10)" for class retirement, and §12a:351
requires the "class capability/replacement inventory complete (the inventory is
retired into Git history on 2026-11-10; see the archive and removal register)".
`alpha16-18-retirement-roadmap.md` was removed on 2026-11-10 with
`docs/history.json`:83-93 recording `nowLivesIn: []` / `noSuccessor: true`, and
`docs/legacy/README.md`:38 states "No in-tree successor; recover from Git
history". A release prerequisite that points at a deliberately removed document
with no in-tree successor is not satisfiable as an in-tree object.

**Later reading:** the class-retirement capability inventory is the **tracked,
signed inventory required by §13.5** — a tracked capability inventory, the
final-SHA per-file class→function migration matrix, the migration note with its
row-for-row entries in `16b-MN`, and the owner sign-off. Git history remains a
recovery path for decision history; it is not an in-tree successor and does not
satisfy "tracked" or "signed". The removed roadmap's `carried` disposition
matrix (`docs/history.json`:87) describes what that inventory had to contain.

§13.5 stays in force and is not relaxed: "P5 is not claimable and Alpha16 release
qualification is not openable" until that inventory and the owner sign-off exist.
`docs/architecture/16b-migration-note.md` is the tracked carrier of `16b-MN`; it
is **not** the P5 capability inventory and records no sign-off.

### 15.2 What this amendment does not change

- §2 items 1–8 remain required. No item is removed, lowered or reordered; item
  3a is re-read, not waived.
- §12a's five proofs remain five **separate** proofs judged at one SHA
  (§13.1:374-379); generic-executor unreachability is still one of five
  (§12a:353-354).
- §13.1 (M10-final / M11 start gate / the P1–M11-3 joint integration with two
  independent verdicts), §13.2 (five obligation slices), §13.5, §13.6 and all of
  §14 are unchanged. No new milestone or slice label is introduced.
- §3's dependency spine remains the ordering authority: M10 cannot start before
  M05–M09 (§3:160-161). This amendment adds no dependency edge.
- No version, tag, publication, public API freeze or release claim is created.

## 16. Dated amendment 2026-11-15 (owner-approved decision register for the Alpha16b capability train)

This amendment registers three decisions the owner made on 2026-11-15 and
corrects two records that the train left stale. It introduces **no new
milestone and no new slice label** (§14.4:525-527 stays in force), and it
changes no verdict.

### 16.1 Decisions registered

| # | Decision | Carrier |
| --- | --- | --- |
| D-16a | The author lifecycle surface is **two named compiler-erased intrinsics** (`onConnect`, `onDispose`) with a per-connection callback-returned cleanup; a component-returns-cleanup contract and a single-hook form were rejected. Root-only in Alpha16b. | [ADR-0180](../adr/ADR-0180-function-component-lifecycle-intrinsics.md) (amends ADR-0173) |
| D-16b | M14 "full await" is **defined as exactly two positions** (a text child, and a server-component prop of a nested server component); every other position is a deliberate boundary with a located `OEC9032` and a named later carrier. | [the M14 definition](./m14-full-await-definition.md) |
| D-16c | Generated-island component styles use a **sidecar `styles` declaration wired into the existing router style plan**; a shadow-root declaration fails closed until the DSD style-link carrier exists; full shadow adoption is carried by GH #1800 (Alpha17). | [ADR-0181](../adr/ADR-0181-generated-element-ssr-and-retention.md) |

The same record authorizes the generated-element server-rendering surface and
the private retained-instance ledger enumerated in ADR-0181.

### 16.2 Label correction (no new slice)

The working-tree records used the string `16b-LC-2` for the retained-child
slice. **That label is withdrawn.** ADR-0181 and the updated
[`16b-migration-note.md`](./16b-migration-note.md) describe the same work as the
retained-child half of the existing `16b-LC` obligation. `16b-LC` remains the
only lifecycle slice; its root half is delivered and its nested/hostless half is
OPEN.

### 16.3 M11 wording correction

Commits and records in the train call the server-rendering work an "M11 vertical
slice". Precisely: it is a **bounded vertical slice of M11's server-rendering
direction**, not M11 and not M11-3. The §13.1 start gate is unchanged and the
plan's own record stands:

- M11-2 (request-time rendering of generated **pages**) is not done.
- M11-3 (client entry cutover) is not done, so P1 stays NOT MET.
- `M10-0 preparation` is tracked but **unsigned**; the unsigned document is not
  §13.5 P5 evidence (§13.5:447-451 unchanged).

### 16.4 What this amendment does not change

- §2 items 1–8, §12a's five separate proofs, §13.1, §13.2, §13.4, §13.5, §13.6,
  §14 and §15 are unchanged.
- No milestone, gate, exit or release claim is created or moved. M09, M10, M11,
  M12, M13 and M14 keep their recorded statuses.
- No version, tag, publication or public-API freeze is authorized.

## 17. Dated amendment 2026-11-16 (owner direction register — draft; formal sign-off pending)

This amendment records three directions the owner gave on 2026-11-16: **D1 = A**
(generated islands of the workspace `@openelement/ui` package migrate inside
Alpha16, targeting the Alpha16 release line), **D2 = the experience-edition
capability API**, and **D3 = B** (a JSON seed channel for non-attribute
properties). It is a **draft carrier of the direction only**: the formal owner
sign-off line in §17.2 is intentionally blank, and this draft records no
signature, approval, verdict, evidence or release authorization. The proposed
decision text lives in
[the ADR-0182 draft](../adr/ADR-0182-function-component-capability-api.md).

It introduces **no new milestone and no new slice label** (§14.4:525-527 stays
in force) and it changes no verdict.

### 17.1 Decisions directed

| # | Direction (owner, 2026-11-16) | Boundaries recorded by this draft |
| --- | --- | --- |
| D-17a | **D1 = A.** Generated-lane island admission extends to workspace package modules, and the three `@openelement/ui` islands the docs site consumes (`open-button`, `open-code-block`, `open-theme-toggle`) migrate to function/generated components **inside Alpha16**, targeting the Alpha16 release line subject to the release gates. | Not class retirement, not a package split or rename, and not a second admission mechanism. The workspace-source-versus-build-metadata route for the package-module site fact, and the scope of the CEM live input plus the ui package build/publish chain, are implementation decisions recorded by the implementation slices — not selected or waived here. |
| D-17b | **D2 = experience-edition capability API:** lifecycle callbacks receive `env = { host, signal }`; an `onError` error-boundary intrinsic; `provideContext` / `useContext` as a scope tree over generated owners (hostless owners included); an intrinsic element `ref` plus `useHost` host-element access; a **component `ref` stays FUTURE** and is not part of this edition. | Compiler-erased intrinsics admitted by binding provenance (the ADR-0180 pattern): no runtime dispatcher, no hook-order slots, no second lifecycle engine, no class adapter. "Experience edition" is a deliberate **no-stability-promise** label; exact signatures, the boundary reset policy and the context representation/lifetime/reactivity remain implementation decisions (the candidate contract's TSX-12 ref-timing boundary and TSX-13/TSX-19 OPEN items are unchanged). Every public export or tracked-interface delta is enumerated in the implementation record and its regenerated snapshot change. |
| D-17c | **D3 = B.** Declared non-attribute (`attribute: false` / non-primitive) property values cross to the client through a dedicated **JSON seed channel**; attribute encoding is not the chosen carrier. | Only declared property-only rows whose declared value type is JSON-encodable are in scope; values are JSON-safe and validated, and no raw-markup channel is added. The `trustedHtml` crossing and the exact transport are separate decisions — [`m09-2d-nonprimitive-properties.md`](./m09-2d-nonprimitive-properties.md):126 already assigns a future transport to M11 and records that no server-to-client seed exists today. Claim acceptance: an equal seed writes nothing and a structurally divergent seed fails closed through the existing claim-mismatch path. |

### 17.2 Formal sign-off (pending — intentionally blank)

| Field | Value |
| --- | --- |
| Owner direction recorded | 2026-11-16 (the three directions above) |
| Owner sign-off | ____________________________ (pending; blank by design) |
| Sign-off date | ____________________________ (pending) |

This draft does not move §17 from draft to an approved amendment, and the blank
line is not a signature. Only the owner's recorded sign-off can do that.

Implementation slices may proceed under this recorded direction (the owner gave
it on 2026-11-16); the blank sign-off blocks any claim that the direction is
delivered, that a §17.3 evidence row is satisfied, or that any gate, exit or
release condition is met.

### 17.3 Acceptance evidence required before the direction is claimed delivered

The evidence below is what the implementation slices must produce; **this
amendment produces none of it**:

- **D-17a:** a real `www` build with the migrated ui islands (the normal build,
  the browser-entry graph's P1 result and the docs-site output), with every
  non-migrated package component keeping its bytes and behavior.
- **D-17b:** consumer-form tests for each capability — Node artifact rows and
  Chromium rows for the `env` shape, the per-connection signal (abort on
  disconnect, fresh signal on reconnect), cleanup order, zero-argument
  compatibility, host usability, context isolation, error-boundary containment
  and ref lifecycle — plus unchanged bytes for every non-participating module
  and an enumerated public-interface delta (if any) with its snapshot change.
- **D-17c:** SSR-to-claim parity for the declared JSON-encodable values
  (byte/fixture/browser rows), an equal-seed zero-write claim, a divergent-seed
  claim that fails closed, and the explicit absence of an attribute or
  raw-markup carrier.

No partial row, green CI run or draft record satisfies any of these.

### 17.4 What this amendment does not change

- §2 items 1–8, §12a's five separate proofs, §13.1, §13.2, §13.4, §13.5,
  §13.6, §14, §15 and §16 are unchanged.
- No milestone, gate, exit or release claim is created or moved. M09, M10, M11,
  M12, M13 and M14 keep their recorded statuses; the ui migration is not an M09
  exit and the capability API is not an M11 delivery.
- No version, tag, publication or public-API freeze is authorized.
- No implementation slice is approved by this direction; no owner sign-off is
  recorded, and no P5 evidence or M13 qualification is claimed.

## 18. Dated amendment 2026-11-20 (owner-approved remediation of PR #1804)

This section is the **approved carrier** of the PR #1804 remediation decisions.
It follows the amend-never-rewrite form of §13–§17: every earlier section stays
as written, and this is the later reading. Where §16.3 and §17.4 state a
superseded position, §18.1 and §18.2 name it explicitly; §17.2 is kept as
written (its blank line is not a signature and this amendment does not fill it)
and the approved carrier of the same direction is this section, which ADR-0182's
2026-11-20 amendment records in the ADR layer.

### Authorization record (delegated, in-session)

Owner SisyphusZheng authorized a remediation team in the 2026-11-20 session —
verbatim direction "全全交给你负责，启动团队把这些任务全部解决掉" — to carry
out the PR #1804 remediation, including the decisions recorded below. This
amendment is recorded by that authorized team under the delegation.

It is **not a personal written signature**: every "owner-approved 2026-11-20"
line in this section means owner-approved by the 2026-11-20 in-session
delegation, and each downstream record must carry the same wording (§18.7).
The delegation is dated to one session and one task; it authorizes no version,
tag, publication, public-API freeze, release qualification or personal P5
sign-off.

This section introduces no new milestone and no new slice label (§14.4:525-527
stays in force); it modifies one §13.2 minimum-obligation cell (§18.3), records
status authority (§18.1, §18.2), ratifies two SLO raises (§18.4), authorizes the
three subpaths already published by this PR (§18.5), and names what remains
open (§18.6).

### 18.1 Supersedes §16.3: M11-2 and M11-3 are delivered; the P1 verdict is MET at the final head

§16.3:610-620 recorded, on 2026-11-15, that "M11-2 (request-time rendering of
generated **pages**) is not done" and "M11-3 (client entry cutover) is not done,
so P1 stays NOT MET". That was the recorded state **before** the integration
slices landed; it is superseded here:

- **M11-2 is delivered at this PR head**, as the bounded lane the code carries:
  the build-time page classifier returns the `generated-element-page` kind with
  the compiler-owned host-producer identity instead of refusing every generated
  page, and the earlier universal refusal survives only for the shapes that
  really are unsupported (a `renderIntent.stream` declaration on a generated
  element page, a missing host-producer identity, and a page whose component
  resolves to a generated island without the page half) with the unchanged
  `OE_ROUTE_SCAN_GENERATED_ELEMENT_PAGE_UNSUPPORTED` identity. The lane is
  synchronous-SSR only; streaming/deferred DSD stays outside it (ADR-0181 A6).
- **M11-3 (client entry cutover) is delivered**: the compiler's emitted runtime
  specifier resolves the narrow `./internal/compiled/leaf-runtime` entry
  (§18.5), so a generated island chunk no longer pulls the generic executor in
  through the runtime facade.
- **The P1 verdict is re-measured MET at the final head** (the old generic
  browser executor is unreachable from every applicable production browser
  entry graph). The evidence carrier is the
  [p1 applicability record](./p1-applicability-record.md) **2026-11-20
  re-record** and the head re-recorded [progress ledger](./alpha16-18-progress.md);
  this amendment records only the status and its authority, and asserts no
  measurement number of its own.

§16.3's third bullet — "`M10-0 preparation` is tracked but **unsigned**; the
unsigned document is not §13.5 P5 evidence" — is unchanged and stays in force.

### 18.2 Supersedes the applicability of §17.4: the head re-record moves the listed rows, and still declares no exit

§17.4:690-699 said "No milestone, gate, exit or release claim is created or
moved. M09, M10, M11, M12, M13 and M14 keep their recorded statuses; the ui
migration is not an M09 exit and the capability API is not an M11 delivery."

The **claim** rule stays in force: this PR creates no milestone exit, no gate
record, no release claim and no release qualification, and §17.4's two
"not an exit/delivery" statements stand. What no longer describes the ledger is
the status sentence: the **final-head re-record is the authority for the status
columns**, and it moves the rows below (all anchored to the same 2026-11-20
head re-record, not to the unreachable SHAs the review lists; historical rows
that cannot be re-anchored stay `advisory only`).

| Row | Movement recorded by the head re-record | Still not claimed |
| --- | --- | --- |
| M09 | Sub-slice state: the named sub-slices are landed and consumed and the row carries no open sub-slice. The row is a sub-slice record. | An M09 exit. |
| M10 | P1–P5 verdicts re-recorded at the final head; P1 is MET per §18.1 and the remaining verdicts are the re-record's to state. | An M10 exit, the final-SHA matrix and the owner sign-off (§18.6). |
| M11 | Router integration for the generated path is landed and consumed in production; M11-2 (bounded) and M11-3 are delivered per §18.1. | An M11 qualification or M13 qualification. |
| M12 | Final packed-consumer evidence is recorded (three engines, packed tarballs). | A **declared exit**: recorded evidence only. |
| M13 | Site-side three-engine evidence is recorded. | A declared qualification: it needs the exact-SHA dispatch record and the server matrix (§18.6). |
| M14 | Unchanged: the row keeps its dated gap-closure record and still names what the exit needs. | An M14 exit. |

This section plus the status re-record is what closes the status conflict: the
documents that still state the 2026-11-15 position are read against this section
(their later-reading notes point here) rather than against the superseded
position.

### 18.3 Amends the §13.2 `16b-EB` minimum obligation: capture points delivered, SSR fallback deferred to Alpha17 (named carry, not a §13.3 exception)

The §13.2:392 cell reads "Boundary API plus capture at connect/claim/update and
an SSR fallback | capture points, retry/reset, SSR fallback, no silent swallow".
That cell is replaced by this later reading; the slice itself stays a §13.2
obligation and no new slice label is introduced.

**Delivered minimum obligation.** The boundary API (the `onError` intrinsic) plus
**two** capture points — not three:

1. the connect/claim pass: the shell's `connectedCallback` catch already covered
   mount, claim, setup and the `onConnect` replay as ONE instance pass, so the
   plan's "connect" and "claim" site labels are one capture point, not two;
2. the update phase: refresh subscriptions and DOM event dispatch through the
   generated `guardUpdate(fn, sink)` channel.

The shell's own contract records it — "the one owner of the author-facing
`onError` handler list and of the two capture points it can honestly attribute to
one element" (`packages/element/src/internal/compiled/generated-element/shell.ts`).
An async rejection is deliberately **not** a capture point: there is no scheduler
and no global listener, so a rejection cannot be attributed to one element. With
no registered handler both capture points keep the pre-`16b-EB` rethrow/rollback
behaviour, so "no silent swallow" holds. The boundary **reset policy** remains
the implementation decision ADR-0182 D-18b records as OPEN; the "retry/reset"
label in the evidence column is read as the shell's existing post-failure
semantics (a connect-phase failure retries on a later reconnect; an update-phase
failure keeps the subscription and listener live for the next write/dispatch),
not as a new author-facing reset API.

**Deferred: the SSR fallback.** No SSR fallback exists, and none is required in
Alpha16. It is deferred to **Alpha17** as a named carry. For this capability
only, the §13.2 preamble sentence (§13.2:386-387) "no Alpha17-first
implementation is permitted for any of them" is superseded: the SSR fallback's
first implementation is Alpha17's.

This is **not a §13.3 scope exception**. An exception waives a capability that
retires; nothing retires here and no §14.2 retained obligation is affected —
this section changes the §13.2 obligation itself, which is why it cannot be and
is not routed through §13.3/§14.1.

The carry is satisfied only when all of the following hold, and until then the
row stays an open carry (not a delivered capability):

1. Alpha17 defines the server-time fallback contract for a failing descendant
   producer during `__ssr` — what bytes are emitted for the boundary, how the
   failure stays observable, and that a producer throw owned by the boundary no
   longer fails the whole render;
2. the client claim adopts those fallback bytes under the unchanged claim and
   identity rules (a new identity needs its own record), and the ADR-0182
   D-18b boundary reset policy is decided in the same record;
3. consumer-form evidence at one SHA: the fallback bytes for a failing
   producer, claim parity over them, the no-silent-swallow row, and the two
   Alpha16 capture points unchanged;
4. the `16b-MN` row updates row-for-row and the capability inventory's
   `16b-EB` row moves from the deferred state to the delivered one.

**Corrected records.** The capability inventory's `16b-EB` row is corrected by
the 2026-11-20 remediation to the true delivery — `onError` with the two capture
points, no SSR fallback, the Alpha17 carry — and the `16b-MN` `16b-EB` section
carries the same dated note. This plan section is the authority for that text;
no inventory row is evidence of its own (ADR-0182's 2026-11-20 EB amendment
records the same truth in the ADR layer).

### 18.4 Ratifies the two client-JS SLO raises (344 → 376 → 408 KiB)

`www/site-budget.ts` is the single published SLO decision. It records two
raises, both now **owner-approved**:

- **2026-11-17: `totalJsKB` 344 → 376.** Measured at the first two migrated
  generated islands (`open-dragon-live-gaze`, `open-cinematic-scroll`): 353.5
  KiB total, i.e. +8.8 KiB for two islands, because a generated island carries
  its own compiled recipe instead of sharing the class runtime's chunk; 376
  kept ~6% headroom over that measurement. The file already carried the
  "(owner decision)" label for this raise.
- **2026-11-18: `totalJsKB` 376 → 408.** Measured on the `open-search`
  migration (the fourth and largest www island): the search island moved
  21.7 → 47.0 KiB (+25.3) and the shared runtime chunk 125.0 → 127.3 KiB
  (+2.3), for a measured baseline 359.4 → 390.0 KiB (+30.6); 408 keeps ~4.4%
  headroom over that measurement and leaves the 376-era headroom for
  `open-page-rail`, which was still class-lane. This raise carried only a
  measurement explanation; the 2026-11-20 delegated approval recorded here
  ratifies it as an owner decision.

The numbers above are quoted from the `www/site-budget.ts` comment as the
measurement record of those decisions; this amendment does not re-measure and
does not raise the SLO again. The next re-measure point is the **P1 end state**
(the generic executor leaves the shared chunk once every island has migrated),
where the value is re-decided rather than carried: 408 is not permanent slack,
and lowering the value remains the only way to tighten the SLO.

ADR-0182's 2026-11-17 amendment sentences "344 KB" and "migrations NOT landed"
are history from before both raises; ADR-0182's 2026-11-20 SLO amendment records
the correction and points here.

### 18.5 Authorizes the three subpaths published by this PR

- **`./lifecycle` and `./document-services`** (public subpaths of
  `@openelement/element`) are authorized by **ADR-0182's 2026-11-20 amendment**:
  decision, P7 four questions, P5 retirement condition and the enumerated
  interface (6 and 3 `publicSymbols` in the regenerated snapshot).
- **`./internal/compiled/leaf-runtime`** (third `/internal/*` export subpath) is
  authorized by **ADR-0177's 2026-11-20 amendment**: purpose, why it is internal
  rather than public, P7 short form and the retirement wording, with ADR-0177
  staying the single record owner of the internal-subpath deviation.

All three authorizations are same-day (2026-11-20). No other subpath is added,
removed or renamed by this PR; the exports-map change is enumerated by the
regenerated `docs/release/public-interface-snapshot.json`. Two derived pointers
that name the older subpath counts — the `packages/element/package.json:5`
annotation ("the two") and the `16b-MN` row ("the subpath set now numbers four")
— are derived pointers, not additional owners; the authority remains ADR-0177
(and, for the public subpaths, ADR-0182).

### 18.6 Named follow-ups (not closed by this PR)

The remediation does not pretend these are closed; each is a named follow-up,
and none is a blocker this section waives:

1. **Output-discipline scope.** The single-line success-path rule is enforced
   for `tools/repo/check-*.ts` today; the same single-line discipline for the
   checkers under `www/tools` and `tools/release` is **not** delivered by this
   PR and is a named follow-up (its own change with its own byte-level
   evidence).
2. **Cohesion-header machine check.** The three TypeScript files that crossed
   the 1200-line threshold in this PR carry their cohesion header; a **machine
   check** for the threshold (rather than review) is a named follow-up.
3. **M12/M13/P5 consolidation.** The M12 S2 list-matrix expansion, the M13
   exact-SHA dispatch record (the `e2e-full` qualification) and the P5
   final-SHA matrix with the owner's own sign-off belong to one independent
   consolidation PR. Until it lands, M12/M13 stay "recorded evidence, not
   declared exit" (§18.2) and §13.5 P5 evidence stays unsigned.
4. **Pre-existing CodeQL alerts.** The five open code-scanning alerts on `main`
   (4256, 4257, 4249, 4248, 4247) are not introduced by this PR. The disposition
   this change set records for them is: the four test-code alerts are
   dispositioned by construction fixes in the test code, and the medium
   `tools/repo/check-dependency-age.ts` case by a written safety-review dismissal
   reason or a by-construction fix. The per-alert record (thread + dismissal) is
   the canonical one, not this plan.
5. **P1's checker is report-only.** `browser-graph:check`
   (`tools/repo/check-browser-entry-graph.ts`) exists but is wired into no
   required gate. Wiring it is a gate-policy change with no existing
   authorization in this plan (the risk register leaves it unassigned) and is
   recorded here as a named follow-up, not silently skipped.

### 18.7 Record form (owner-approved 2026-11-20, delegated session)

| Field | Value |
| --- | --- |
| Authorization | owner-approved 2026-11-20, delegated in-session remediation session |
| Authority quoted | "全全交给你负责，启动团队把这些任务全部解决掉" (2026-11-20 session) |
| Recorder | the authorized remediation team — recorded as "remediated by the agent team under owner delegation" |
| Signature status | no personal written signature is recorded or implied; every "owner-approved 2026-11-20" in this plan means the delegation in this section |
| Downstream records | must carry the same wording (delegated, dated 2026-11-20); a record that requires a personal signature (a §13.5 owner sign-off on a final-SHA matrix, a release authorization) needs the owner's own line and is **not** satisfied by this delegation |

This section records the decisions above under that form and nothing more: it
creates no version, tag, publication or public-API freeze, no release
qualification and no milestone exit.
