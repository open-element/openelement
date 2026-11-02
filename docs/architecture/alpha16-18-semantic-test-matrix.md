# Alpha16–18 semantic test matrix

Date: 2026-11-03. Status: **PROPOSED / ALL ROWS NOT RUN**. Baseline:
`4f1f2001b24909086f7e7efe9e5016d48d615c91`.

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

## Acceptance coverage (taskbook §18)

The 21 required acceptance areas map to matrix rows and milestones. A row with
no backing matrix row is a defect in this document, not a gap in the product.

| # | Acceptance area | Matrix rows | Milestone |
| --- | --- | --- | --- |
| 1 | Function Components | TSX-01, 02, 23 | M03 |
| 2 | Nested hostless composition | TSX-01, 09, 10 | M03, M04 |
| 3 | Fragments and multi-root | TSX-01 | M02 |
| 4 | Empty output | TSX-01 | M02 |
| 5 | Props and Children | TSX-03, 04, 10 | M04, M08 |
| 6 | Reusable JSX values | TSX-09, 23, 25 | M04 |
| 7 | Signals | TSX-02, 05 | M04 |
| 8 | Fine-grained updates | TSX-02, 05, 28 | M05 |
| 9 | Keyed identity | TSX-07, 08 | M08 |
| 10 | Props replacement | TSX-04, 24 | M08 |
| 11 | Event behaviour | TSX-12, 20 | M05 |
| 12 | Cleanup and disposal | TSX-19, 26, 27 | M04 |
| 13 | SSR | TSX-17, 18, 30 | M07 |
| 14 | DSD | TSX-18, 30 | M07 |
| 15 | Claim / hydration | TSX-18, 30 | M06 |
| 16 | Security | cross-cutting negatives §4 (all rows) | M05 |
| 17 | Class compatibility | class fixtures on the shared backend (not a TSX row) | M09 |
| 18 | Router compatibility | Framework Mode regression (not a TSX row) | M11 |
| 19 | Packed consumer compatibility | TSX-21 | M12 |
| 20 | Browser and server qualification | cross-engine column plus server matrix | M13 |
| 21 | No unintended dependency on the old generic executor | graph + reachability evidence | M10 |

Two acceptance areas deliberately have no TSX row: class compatibility and
Router compatibility are cross-cutting regressions, not author-language cases.
They still need evidence, owned by M09 and M11.

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
