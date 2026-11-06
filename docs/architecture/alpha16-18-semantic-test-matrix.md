# Alpha16–18 semantic test matrix

Date: 2026-11-03. Status: **PROPOSED / ALL ROWS NOT RUN**. Baseline:
`4f1f2001b24909086f7e7efe9e5016d48d615c91`.

Revision 2026-11-05: acceptance area 17 is redefined as **Class authoring
migration coverage** — M10 partition evidence for the public API and browser
runtime. The earlier "class compatibility on the shared backend" reading is
SUPERSEDED HISTORY — it conflicted with approved P-5 (no authoring compatibility
adapter), and it assigned migration work to M09, whose definition is the generated
Native Custom Element boundary, not a class adapter. Class→function migration is
M10 evidence; M09 owns only the generated CE boundary.

One row per case in [the TSX contract](./tsx-author-candidate-contract.md). This
matrix is the evidence ledger: a case is "done" only when its required cells
carry a recorded result at a recorded SHA. An empty cell is unfinished work, not
a pass.

## Legend

| Column | Meaning |
| --- | --- |
| **T+** | type-checks with the authored types |
| **T−** | a type error is reported for the stated misuse |
| **C+** | compiles successfully |
| **C−** | a source-located compile diagnostic is produced |
| **M** | fresh Mount in a browser |
| **U** | Update |
| **S** | SSR |
| **K** | Claim on existing SSR DOM |
| **D** | Dispose / cleanup accounting |
| **F** | failure recovery (error, mismatch, throwing cleanup) |
| **B** | cross-engine (Chromium / Firefox / WebKit) |
| **P** | independent packed consumer |

Symbols: `R` required, `o` optional-but-recorded, `n/a` inapplicable (the reason
is in the contract's matrix), `—` not yet defined and therefore an OPEN blocker.

Cross-engine is required for every case that touches DOM, and is marked `R` for
the slices that the release gates on (TSX-04, 06, 07, 09, 10, 14, 18, 23, 30).

## Matrix

| Case | T+ | T− | C+ | C− | M | U | S | K | D | F | B | P |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TSX-01 roots/fragments/empty | R | R | R | R | R | n/a | R | R | R | R | R | o |
| TSX-02 signal/computed | R | R | R | R | R | R | R | R | R | R | R | o |
| TSX-03 props/destructuring | R | R | R | R | R | R | R | R | n/a | R | R | o |
| TSX-04 keyed props replacement | R | R | R | R | R | R | n/a | R | R | R | R | R |
| TSX-05 local vs computed vs inline | R | R | R | R | R | R | R | R | n/a | R | R | o |
| TSX-06 conditions/zero | R | R | R | R | R | R | R | R | R | R | R | o |
| TSX-07 keyed movement | R | R | R | R | R | R | n/a | R | R | R | R | R |
| TSX-08 unkeyed positions | R | R | R | R | R | R | R | R | R | R | R | o |
| TSX-09 reusable JSX values | R | R | R | R | R | R | R | R | R | R | R | R |
| TSX-10 repeatable children | R | R | R | R | R | R | R | R | R | R | R | R |
| TSX-11 spread order/removal | R | R | R | R | R | R | R | R | n/a | R | R | o |
| TSX-12 events/callbacks/refs | R | R | R | R | R | R | n/a | R | R | R | R | o |
| TSX-13 context isolation | R | R | R | R | R | R | R | R | R | R | R | o |
| TSX-14 CE connection lifetime | R | R | R | R | R | R | n/a | R | R | R | R | o |
| TSX-15 runtime renderability | R | R | R | R | R | R | R | R | n/a | R | R | o |
| TSX-16 iterables | R | R | R | R | R | R | R | R | n/a | R | R | o |
| TSX-17 server async boundary | R | R | R | R | n/a | n/a | R | n/a | n/a | R | o | o |
| TSX-18 SSR seed/claim fidelity | R | R | R | R | n/a | R | R | R | R | R | R | o |
| TSX-19 error/cleanup containment | R | R | R | R | R | R | R | R | R | R | R | o |
| TSX-20 native CE / third-party WC | R | R | R | R | R | R | n/a | R | R | R | R | R |
| TSX-21 precompiled package | R | R | R | R | R | R | R | R | R | R | o | R |
| TSX-22 HMR/source locations | R | R | R | R | R | R | R | n/a | n/a | R | o | n/a |
| TSX-23 one recipe inserted twice | R | R | R | R | R | R | R | R | R | R | R | R |
| TSX-24 shared external signal | R | R | R | R | R | R | R | R | R | R | R | o |
| TSX-25 deferred insertion | R | R | R | R | R | R | n/a | n/a | R | R | R | o |
| TSX-26 projection deletion/cross-owner | R | R | R | R | R | R | n/a | n/a | R | R | R | o |
| TSX-27 parent owner disposal | R | R | R | R | R | n/a | n/a | R | R | R | R | o |
| TSX-28 evaluation counts | R | R | R | R | R | R | R | R | n/a | R | R | o |
| TSX-29 dynamic component type | R | R | R | R | n/a | n/a | n/a | n/a | n/a | R | n/a | n/a |
| TSX-30 repeated instances SSR/claim | R | R | R | R | n/a | n/a | R | R | R | R | R | R |

`n/a` reasons live in the contract's applicability matrix and must not be
invented per row.

**Claim acceptance chain.** Rows TSX-18 and TSX-30 are one chain, not separate
checkboxes: marker/order encoding, key alignment, permitted seed state, bounded
mismatch recovery and duplicate-subscription accounting. M07 owns the leaf proof;
M08 owns the stateful SSR→claim proof.

## Acceptance coverage (taskbook §18)

The 21 required acceptance areas map to matrix rows and milestones. A row with
no backing matrix row is a defect in this document, not a gap in the product.

| # | Acceptance area | Matrix rows | Milestone |
| --- | --- | --- | --- |
| 1 | Function Components | TSX-01, 02, 23 | M03 |
| 2 | Nested hostless composition | TSX-01, 09, 10 | M04, M06 |
| 3 | Fragments and multi-root | TSX-01 | M02 |
| 4 | Empty output | TSX-01 | M02 |
| 5 | Props and Children | TSX-03, 04, 10 | M04, M06 |
| 6 | Reusable JSX values | TSX-09, 23, 25 | M04 |
| 7 | Signals | TSX-02, 05 | M04 |
| 8 | Fine-grained updates | TSX-02, 05, 28 | M05 |
| 9 | Keyed identity | TSX-07, 08 | M06 |
| 10 | Props replacement | TSX-04, 24 | M06 |
| 11 | Event behaviour | TSX-12, 20 | M05 |
| 12 | Cleanup and disposal | TSX-19, 26, 27 | M04 |
| 13 | SSR | TSX-17, 18, 30 | M08 |
| 14 | DSD | TSX-18, 30 | M08 |
| 15 | Claim / hydration | TSX-18, 30 | M07, M08 |
| 16 | Security | cross-cutting negatives §4 (all rows) | M05, M13 |
| 17 | Class authoring migration coverage | migration equivalence for the 2026-11-03 baseline set of 219 in-tree files recorded as matching `@element(` (historical size metric, not a current count), plus the generated CE platform boundary (TSX-14/20 cover the CE slice; no dedicated TSX row) | M10 (migration); M09 (CE boundary) |
| 18 | Router compatibility | Framework Mode regression (not a TSX row) | M11 |
| 19 | Packed consumer compatibility | TSX-21 | M10a (non-gating smoke), M12 (final) |
| 20 | Browser and server qualification | cross-engine column plus server matrix; qualifies the M06/M08 dual-backend comparison | M13 |
| 21 | No unintended dependency on the old generic executor | graph + reachability evidence | M10 |

Two acceptance areas deliberately have no dedicated TSX row: class authoring
migration and Router compatibility are cross-cutting regressions, not
author-language cases. They still need evidence: class migration is owned by M10
and the generated CE slice by M09; Router is owned by M11.

Area 17 is **Class authoring migration coverage**, and its status must not be
misread:

- **CURRENT FACT**: at the 2026-11-03 baseline, 219 in-tree files matched
  `@element(` in that round's scan. That is a **historical size metric**, not a
  current precise count; execution re-inventories the actual set at its own SHA.
  This document previously described area 17 as "class fixtures on the shared
  backend".
- **SUPERSEDED HISTORY**: that shared-backend reading is replaced. It assumed a
  class frontend is retained and made to share a backend with function
  components — an adapter. Approved P-5 builds no authoring compatibility
  adapter, and the Class authoring API retires in Alpha16b.
- **APPROVED TARGET** ([execution plan](./alpha16-18-execution-plan.md), M09 and
  M10): M09 is the generated Native Custom Element boundary — emitted element
  class, registration, property/attribute conversion, events, Shadow DOM/DSD
  interop, third-party WC compatibility. Only explicit Native Export / Island
  Boundary sites generate a CE; hostless function components are never forced into
  elements. M10 owns the separate class-authoring migration evidence under its
  public-API and browser-runtime partitions; it is not an adapter either.

So area 17 is **migration-and-retirement evidence**: behavioural equivalence after
that baseline file set is migrated to function components (M10; the inventory is
re-taken at execution), plus the generated CE platform boundary (M09). It is
*not* evidence that a class frontend is preserved and shares a backend with
function components. The per-file class→function migration matrix and capability
inventory named as evidence in
[the retirement roadmap](./alpha16-18-retirement-roadmap.md#class-retirement-capability-gate-alpha16b)
are the record for the migration half; matrix rows TSX-14 and TSX-20 cover the
CE-boundary slice.

## Evidence format

Each recorded result needs, at minimum:

```text
case:      TSX-23
phase:     Claim
result:    pass | fail | not-run
sha:       <commit the evidence was produced from>
artifact:  <test name, browser, command, or packed-consumer log>
notes:     instance count, owner count, cleanup count where relevant
```

A result without a SHA is not evidence. A result copied from a previous release
is not evidence for this one.

## Assertions that a screenshot or text diff must never replace

1. Instance and owner counts (two insertions ⇒ two owners).
2. Cleanup counts (zero surviving resources after dispose).
3. DOM node identity across keyed reuse.
4. Input value, focus and selection preservation across claim and reuse.
5. Handler reads the current item after keyed replacement.
6. Duplicate-subscription counts after claim.
7. Source-located diagnostics for every negative case.
8. Absence of server-only modules from the client graph.
9. Byte attribution for generated code plus helpers, measured on the full
   reachable closure.
10. Packed-consumer install with no workspace alias and no library TSX.

Alpha16a claims only M01-M08 evidence with G1/G2 recorded. Rows depending on
M09-M13 (generated CE boundary, class authoring migration under M10, Router
integration, packed qualification, full browser/server qualification, executor
unreachability) belong to Alpha16b and must not be reported as Alpha16a results.
