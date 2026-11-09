---
status: active
topic: Stage authority (M01–M14)
summary: M01–M14, the 16a/16b/17/18 stage split, G1/G2/G3, work classes and the risk register; the dependency spine, not dates, is the authoritative stage definition.
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
