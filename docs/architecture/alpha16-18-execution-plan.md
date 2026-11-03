# Alpha16–18 execution plan

Date: 2026-11-03 (second-round correction). Status: **PROPOSED**, owner decisions
D-O1/D-O2/D-O3 approved. Baseline: `4f1f2001b24909086f7e7efe9e5016d48d615c91`.

This plan implements the direction in
[ADR-0173](../adr/ADR-0173-component-execution-and-composition.md) and
[ADR-0174](../adr/ADR-0174-generated-code-runtime-and-compatibility.md), with the
author contract in [the TSX contract](./tsx-author-candidate-contract.md), the
model in [JSX values and repeatable children](./jsx-value-and-children-model.md),
the canonical architecture in
[compiler-native-architecture](./compiler-native-architecture.md), and the state
of the tree in [the current-reality audit](./alpha16-18-current-reality.md).

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

| ID | Work | Class | Depends on | Exit evidence |
| --- | --- | --- | --- | --- |
| M01 | Semantic IR / layer boundary decision (IR · Part Program · emitted field · module ABI · wire) | A | — | recorded layer map consistent with the canonical doc |
| M02 | Alpha16 TSX foundation grammar admission (fragments, multi-root, value-position JSX, inline tracked expressions) | I | M01 | admitted cases with source-located diagnostics and negatives in the same change |
| M03 | Function component frontend adapter | I | M02 | same diagnostics/spans/security as the class lane |
| M04 | Runtime ownership + recipe primitives (insertion owner, tracked props, lineage check) | P→I | M01 | G2 on two insertions, keyed replacement, disposal modes |
| M05 | Generated leaf mount / update / dispose | I | M03, M04 | G1: generated code actually executes in a browser |
| M06 | Stateful hostless list on the generated path | I | M05 | identity, private draft, keyed reorder, conditions, multi/empty root |
| M07 | Generated claim (leaf) | I | M05 | claim fidelity on the leaf slice |
| M08 | Generated claim + SSR for the stateful list | I | M06, M07 | the same list across SSR → claim → update → dispose |
| M09 | Class compatibility adapter on the shared backend | I | M05 | class fixtures pass on the generated backend; no second backend |
| M10 | Old-executor capability migration and reachability evidence | I→Q | M05–M09 | graph unreachability from every applicable production browser entry + behaviour coverage |
| M10a | Early packed-consumer smoke | Q | M05 | generated artifact installs and runs from a fresh packed app, no aliases |
| M11 | Router integration for the generated path | I | M08, M10 | Framework Mode contract unchanged |
| M12 | Final packed-consumer qualification (same stateful list) | Q | M06, M08, M11 | tarball consumption of the full slice; scope per §5 |
| M13 | Browser + server qualification, exact SHA | Q | M09–M12 | three engines, release train |

**Alpha16a exit = M01–M08 with G1 and G2 evidence recorded.** M09–M13 belong to
Alpha16b. G3 is not claimed by Alpha16a.

## 2. Alpha16b — retirement and Alpha16 release qualification

Alpha16b is the only route to a formal Alpha16 release.

Required before release:

1. every required browser execution capability migrated (M10);
2. generated mount, update, claim and disposal complete (M05, M07, M08);
3. class compatibility on the shared backend (M09);
4. Router integration (M11);
5. independent packed-consumer qualification (M12);
6. browser and server qualification (M13);
7. **graph evidence that the old generic browser executor is unreachable from
   every applicable production browser entry graph** (M10);
8. behavioural coverage for every migrated capability.

**The ADR-0174 hard gate is unchanged.** If the old generic browser executor is
still reachable in a production browser entry graph, Alpha16 does **not**
qualify. Shipping both execution paths as a release is not an option.

The gate concerns the old generic **browser execution path**. It does not require
deleting the Part Program artifact, its validator, the emitted field, tag/version
metadata, the server serializer, or streaming program data.

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
- M03 is on the spine in practice: M05 cannot be produced without the function
  adapter, so it is not parallel with M05.
- **Genuinely parallel:** M07 (leaf claim) and M09 (class adapter) both need only
  M05; M10a starts the moment a generated artifact can be packed; security and
  output-separation work is independent of all of the above.
- **M10 cannot start before M05–M09** — reachability evidence for a replacement
  requires the replacement to exist.
- M12 (final packed qualification) follows M11; it is not the same work as M10a
  (early smoke).

Rollback boundaries:

| Boundary | What reverts | What must not be inferred |
| --- | --- | --- |
| after M04 | recipe/insertion primitives (no public surface yet) | nothing about class or Lit support |
| after M07 | claim implementation only; mount stays | not a Part Program decision |
| after M09 | **the new adapter implementation**, not the Class API | reverting adapter code must never imply retiring the Class API |
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
- Generated-module ABI versioned and rejected early on mismatch (freeze only with
  consumer evidence).
- Precompiled component distribution: server/client entries, declarations,
  relocatable CSS, runtime-uniqueness checks, one supported consumption mode.
- Starter, docs, examples, and class-author migration through the adapter.

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

These questions must be answered before Alpha16a claims success:

| # | Question | Answered by |
| --- | --- | --- |
| 1 | Can the compiler emit mount/update/dispose that runs? | M05 / G1 |
| 2 | Are identity, owner, region, signals and cleanup coherent? | M04, M06 / G2 |
| 3 | Do authors accept the semantics? | M02, contract review |
| 4 | Do packed consumers work without aliases? | M10a |
| 5 | Does claim preserve DOM, input and focus? | M07, M08 |
| 6 | Is the old executor's reachability measurable? | M10 |

## 9. Risk register

| # | Risk | Probability | Impact | Detection | Mitigation | Blocking gate | Owner decision? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | JSX value model re-worked after consumers exist | Medium | High | TSX-23/25/26 fail late | prove before any public type; keep the recipe opaque | G2 | No |
| R2 | Props replacement silently stale | Medium | High | handler-sees-new-item fails | live-getter invariant; mirror `itemBox` | G2 | No |
| R3 | Generated code larger than the program it replaces | Medium | Medium | full-closure byte measurement per change | keep the old path until graph evidence | G1 | No |
| R4 | Claim cannot reproduce repeated insertion order | Medium | High | S3 matrix | design marker protocol in M07/M08 before ABI freeze | G2 | No |
| R5 | Two runtimes across a package boundary | Low | High | packed consumer with two copies | singleton check or explicit rejection | G3 | No |
| R6 | Safety regression while grammar widens | Low | High | sink fixtures per new expression position | one sink source of truth; negatives per position | G1 | No |
| R7 | Lit retirement contaminates Alpha16 | Medium | Medium | scope creep in PRs | separate ADR-0152 track; not on this spine | — | No (already decided) |
| R8 | Public API frozen early to unblock a demo | Medium | High | names in docs/starters before G3 | G3 gate; names stay candidate | G3 | No |
| R9 | Evaluation-timing surprise (per-insertion props) | High | Medium | author reports; TSX-28 counts | document §4.2a counts; consider dev warning | G3 | No |
| R10 | Owner/region model outgrows `LifetimeScope` | Low | High | cross-owner projection demand | keep projection inside the subtree; lineage check | G2 | No |
| R11 | Alpha16b does not reach executor-unreachable state | Medium | High | M10 evidence missing at release | work stays internal; no release; re-plan with the named capability | release | No (D-O1 settled the shape) |
| R12 | Layer split breaks a `__partProgram` consumer | Medium | High | Router/SSG/CSS tests after any field-shape change | migrate the two lexical consumers in the same change; staged per D-O2 | G1 | No (D-O2 settled) |
| R13 | Test migration lags implementation | Medium | Medium | matrix rows unbacked | migrate per slice, not at the end | G3 | No |
| R14 | Documentation drift between canonical docs and ADRs | Medium | Medium | index/doc checks; review | canonical doc + link map; amend ADRs, never rewrite | — | No |
| R15 | Scope expansion (Rust, Flight, second renderer) | Medium | High | proposal review | non-goals list; nine-question constraint check | — | Yes if proposed |

## 10. Stop conditions

Stop and re-plan rather than push through when:

1. props semantics are unresolved and a slice needs them;
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
- The Class API remains supported through the adapter; the adapter is not a
  second backend.
- Public API remains candidate until G3 evidence exists.
- The Lit boundary is unchanged unless its own separate track gate is met.

A passing CI run is none of the above.
