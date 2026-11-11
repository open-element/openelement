---
status: active
topic: Semantic evidence grid
summary: Per-case evidence ledger; a case is done only when its required cells carry a recorded result at a recorded SHA.
---

# Alpha16–18 semantic test matrix

Date: 2026-11-03. Status: **PROPOSED — results are recorded in the per-milestone
annexes below; the grid cells are not filled**. Baseline:
`4f1f2001b24909086f7e7efe9e5016d48d615c91`. Latest recorded annex: the M07-2
leaf-scope browser clean-path annex (2026-11-12; in progress, not signed off).
M07-1 is signed off on `ac8c218614e2d4749435c51edf3eaf15eb65f6fd` (Node DOM
shim, 非浏览器资格). Neither annex fills the grid, TSX-18, or TSX-30. The grid
cells stay `R`.

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
M08 owns the stateful SSR→claim proof. The M07a slice (authored-order structural
adoption of a static leaf, mismatch before subscribe, one subscription set per
successful claim) does not fill TSX-18 or TSX-30. A validation failure writes
nothing. An activation failure may leave an earlier dynamic write while
resources are released with `dispose(false)`. That is not a whole-claim byte
rollback, and it does not change the successful-claim input/focus obligation.
M07b static sibling ranges are DOM contract fixtures for one private directory.
They are not SSR success evidence and do not fill TSX-18 or TSX-30 either.
Zero subscriptions on a static range are not a dynamic-subscription account.

The M07b generator extension (PR #1749) adds no TSX-18/TSX-30 cell: its
mount/claim directory DOM shape is proved against a Node DOM shim, not a
browser, and a mount-only pure-static directory also emits marker comments that
no claim consumes (recorded as a known consequence in the M07b note and as a
follow-up obligation).

The M07-1 annex below records leaf-scope **K** notes for TSX-09, TSX-10,
TSX-23 and a partial TSX-01 shape. Those notes do not fill the grid, do not
fill TSX-18 or TSX-30, and are not SSR→claim. Qualification is 非浏览器
(Node DOM shim). M07-1 is signed off on
`ac8c218614e2d4749435c51edf3eaf15eb65f6fd`; that sign-off is the Node DOM shim
result and does not fill the grid. The M07-2 annex below records leaf-scope
chromium evidence and is not signed off.

**TSX-04 row status (recorded 2026-11-09).** M06b2b's same-key keyed content
replacement is TSX-04-adjacent supporting evidence only; the TSX-04 `M`/`U`/`D`
cells stay open, and the row is not counted toward the already-recorded M06 exit
(M06's exit rests on its own rows and the S2 evidence). Filling the row and
assigning its per-phase cells is M08-era evidence work.

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
the retirement roadmap (retired into Git history on 2026-11-10)
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

## M03-scope recorded results — frontend parity evidence

Evidence head: `5cfd2fc80` (LOCAL run; PR #1734, squash SHA pinned by the next
slice). Scope: the admitted function-component grammar only. **T+** = the
fixture type-checks (TypeScript is the authority — the frontend is not a
checker), **T−** = a type error is reported for the stated misuse, **C+** = the
production function frontend compiles it cleanly, **C−** = a source-located OEC
diagnostic is produced. Artifacts:
`packages/compiler/__tests__/semantic-ir/m03-frontend-matrix.test.ts`
(T/C rows), `m03-sourcemap-parity.test.ts` (expression-level Source Map parity
for TSX-22), `m03-security-parity.test.ts` (per-position security negatives),
and the A4a `function-frontend.test.ts` Alpha15 diagnostics-parity harness.

| Case | T+ | T− | C+ | C− | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| TSX-01 roots/fragments/empty | pass | pass | pass | pass | `m03-frontend-matrix.test.ts` — TSX-01 row (fragment multi-root; non-JSX return `OEC9040`) |
| TSX-02 signal/computed | pass | pass | pass | pass | TSX-02 row (`signal`/`computed` A1-classified resources; unresolved computed body `OEC9043`) |
| TSX-03 props/destructuring | pass | pass | pass | pass | TSX-03 row (destructured props snapshot; array-pattern props parameter `OEC9040`) |
| TSX-05 local vs computed vs inline | pass | pass | pass | pass | TSX-05 row (local snapshot vs JSX slot; declaration without initializer `OEC9042`) |
| TSX-06 conditions/zero | pass | pass | pass | pass | TSX-06 row (ternary/`&&`/null; non-JSX branch `OEC9042`) |
| TSX-08 unkeyed positions | pass | pass | pass | pass | TSX-08 row (unkeyed list admitted; non-inline mapper `OEC9042`) |
| TSX-09 reusable JSX values | pass | pass | pass | pass | TSX-09 row (JSX in expression → recipe references; unsupported recipe target `OEC9042`) |
| TSX-10 repeatable children | pass | pass | pass | pass | TSX-10 row (`props.children` projection; children on a component reference `OEC9042`) |
| TSX-12 events/callbacks | pass | pass | pass | pass | TSX-12 row (arbitrary handler closures admitted; `this` in handler `OEC9043`) |
| TSX-16 iterables | pass | pass | pass | pass | TSX-16 row (`.map` per-entry template; non-JSX mapper body `OEC9042`) |
| TSX-22 HMR/source locations | pass | pass | pass | pass | TSX-22 row plus `m03-sourcemap-parity.test.ts` (expression-level segments decode to authored positions through `@jridgewell/trace-mapping@0.3.31`) |

Security parity is recorded separately by `m03-security-parity.test.ts` for every
newly admitted expression position (direct element attribute, condition branch,
list template, JSX-in-expression recipe target), with class-vs-function findings
compared on OEC code + offending authored token where the class baseline has an
equivalent construct and an explicit `n/a (no equivalent construct)` record
where it does not.

**Not run in this section:** every browser/claim/codegen cell (`M`, `U`, `S`,
`K`, `D`, `F`, `B`, `P`) — those belong to M05+ and are not implied by these
results. M03 rows above are frontend parity evidence only; no G1/G2 record and
no Alpha16a exit claim is made here.

## M06 S2 recorded results — stateful hostless list

Evidence head: `74f7badc0` (LOCAL; PR #1738). Scope: the M06a admitted generator
shapes (conditions, lists incl. keyed reorder/insert/delete/unkeyed/multi/empty
root). **C+** = the production function frontend and the M05/M06 generator admit
the fixture; **C−** = a source-located diagnostic; **T+**/**T−** = the fixture
type-checks / is a type error (TypeScript is the authority). Real-browser
evidence is the recorded LOCAL chromium S2 run, not a release qualification.

| Case | T+ | T− | C+ | C− | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| TSX-06 conditions/zero | pass | pass | pass | pass | `generated-leaf.browser.test.ts` S2 condition toggle (branches replaced, no leak), `generated-leaf.test.ts` condition contract, matrix row in `m03-frontend-matrix.test.ts` |
| TSX-07 keyed movement | pass | pass | pass | pass | `generated-leaf.browser.test.ts` S2 keyed reorder (same `li` nodes, focus + selection preserved), `generated-leaf.sourcemap.test.ts` list placements |
| TSX-08 unkeyed positions | pass | pass | pass | pass | generator unit contract (index keys share the reconcile path); browser evidence is keyed only in M06a — unkeyed browser scenario is not claimed |
| TSX-09 reusable JSX values | pass | pass | n/a | n/a | **not run** — recipes/insertion sites are M06b (generator still fails closed) |
| TSX-10 repeatable children | pass | pass | n/a | n/a | **not run** — children projection is M06b (generator still fails closed) |
| TSX-23 one recipe inserted twice | pass | pass | n/a | n/a | **not run** — M06b (owner-isolation evidence) |
| TSX-26 projection deletion/cross-owner | pass | pass | n/a | n/a | **not run** — M06b/M07 lineage evidence |

**Not run in this section:** every browser/claim/codegen cell (`M`, `U`, `S`,
`K`, `D`, `F`, `B`, `P`) — those remain M05+/M13 and are not implied by the LOCAL
chromium S2 evidence. M06 is **not** claimed complete by these rows; M06b and
M07/M08 are pending.

## M06b S2b recorded results — owner isolation

Evidence head: `55aec15b9` (LOCAL; branch `alpha16a/m06b-owner-isolation`, PR
opened by the Lead). Scope: the M06b1a-1/-2 admitted generated composition
shapes — module-level component mounts with module-local component references
and per-read props, and one reusable-JSX recipe projected at two sites or
inserted twice with isolated owners, regions, DOM nodes and cleanups. **C+** =
the production function frontend and the M05/M06b generator admit the fixture;
**C−** = a source-located diagnostic (the generator's fail-closed shapes are
covered by the existing M06b1a-2 unit suite; no new negative fixture is added
here); **T+**/**T−** = the fixture type-checks / is a type error (TypeScript is
the authority). Real-browser evidence is the recorded **LOCAL chromium
`147.0.7727.15`** (Playwright default engine, `browser.version()` recorded by
the harness); it is not a release qualification.

| Case | T+ | T− | C+ | C− | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| TSX-09 reusable JSX values | pass | pass | pass | pass | `generated-leaf.browser.test.ts` M06b1b S2b "reusable JSX value: one recipe projected at two sites yields two independent copies" — one inline `createRecipe` + two `{chip}` insertion sites; mount delta `projections`/`regions`/`owners`/`rangeCleanups`/`lineageAccepted` +3 (one root + two sites), `nodes` +3, `subscriptions` +4; one tone write refreshes both copies and default `dispose()` keeps the region while closing all four subscriptions. T+/T− = `m03-frontend-matrix.test.ts` TSX-09 row; C+ = `generated-leaf.test.ts` M06b1a-2 emission contract (one `createRecipe`, one `insertRecipe` per site); C− = the frontend `OEC9042` TSX-09 row plus the generator's `OEIR_LEAF_UNSUPPORTED_RECIPE` fail-closed test |
| TSX-23 one recipe inserted twice | pass | pass | pass | pass | `generated-leaf.browser.test.ts` M06b1b S2b "one recipe inserted twice: isolated owners, regions and nodes, both refresh" — the same generated recipe inserted twice yields two projections with distinct `region`, `owner`, props record and DOM node; insertion delta `projections`/`regions`/`owners`/`nodes`/`rangeCleanups`/`subscriptions`/`lineageAccepted` +2 with `lineageRejected`/`unsubscribed`/`disposed` 0, and one signal write refreshes both copies. C+ = `generated-leaf.test.ts` M06b1a-2 same-recipe two-site contract; C− = the fail-closed shapes above (no separate TSX-23 negative fixture is claimed); T+/T− = recorded pass in the M06 S2 section at `74f7badc0` for the same admitted JSX-value grammar (`m03-frontend-matrix.test.ts` TSX-09 row is the frontend authority) |
| TSX-10 repeatable children | pass | pass | n/a | n/a | **not run — M06b2** — children projection still fails closed; no browser evidence |
| TSX-26 projection deletion/cross-owner | pass | pass | n/a | n/a | **not run — M06b2** — projection deletion through generated sites is not evidenced; the S2b lineage negatives below only assert the runtime-side coded rejections (see below) |

Disposal isolation (feeds TSX-23/TSX-27 disposal accounting, not a matrix row of
its own): the S2b "disposal isolation" scenario proves `dispose(true)` on one of
two live projections removes only its own region (`disposed` +1, `unsubscribed`
+1) while the other projection stays attached and keeps refreshing, and the
default `dispose()` keeps its DOM attached (the M04 disconnect/suspend contract)
while releasing its subscription (`disposed` +2, `unsubscribed` +2 total).

The S2b lineage scenario records the M04 fail-closed codes for the cross-owner
and dead-owner shapes: cross-owner insertion raises `OE_KERNEL_ROOT_NOT_OWNED`;
a disposed definition owner and a disposed projection site both raise
`OE_KERNEL_DISPOSED`; each attempt increments `lineageRejected` +1, allocates no
owner/region/DOM (`projections`/`regions`/`owners`/`nodes`/`rangeCleanups`/`subscriptions`
deltas 0) and leaves the parent untouched, while the definition owner and one of
its live descendants stay admitted (`lineageAccepted` +2). These are runtime-side
negative inputs to TSX-26, not a TSX-26 result — deletion remains M06b2.

**Not run in this section:** every SSR/claim column (`S`, `K`), the three-engine
qualification (`B`; M13), firefox/webkit, packed-consumer (`P`) and children
projection (TSX-10; M06b2) remain unclaimed. M06 is **not** complete by these
rows; M06b2 and M07/M08 are pending. LOCAL chromium only — no G1/G2 record and no
Alpha16a exit claim is made here.

## M06b2b recorded results — repeated children + unkeyed

Evidence head: `241c1eef7` (LOCAL; branch `alpha16a/m06b2b-children-evidence`,
merge head `32487fafb` includes the M06b2c generator fix from main `0ee78ec78`;
PR opened by the Lead). Scope: the M06b2a component children-projection mechanics
(`<Frame><Counter n={signal.value}/></Frame>` — one children recipe per reference
site passed as the plain `children` prop, one M04 projection region per
`{props.children}` site), the M06a unkeyed-list shape, and same-key keyed content
replacement. **C+** = the production function frontend and the M05/M06b
generator admit the fixture; **C−** = a source-located compile diagnostic is
produced (the children refusals are unit contracts, not new fixtures here);
**T+**/**T−** = the fixture type-checks / is a type error (TypeScript is the
authority). Real-browser evidence is the recorded **LOCAL chromium
`147.0.7727.15`** (Playwright default engine, `browser.version()` recorded by
the harness); it is not a release qualification.

| Case | T+ | T− | C+ | C− | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| TSX-10 repeatable children | pass | pass | pass | pass | `generated-leaf.browser.test.ts` M06b1b S2b "children projection: two sites build two independent instances that both refresh" — `<Frame>` projects `{props.children}` at TWO sites over one `App` children recipe: tags `div,p,p` in authored order, mount delta `projections`/`regions`/`owners`/`nodes`/`rangeCleanups`/`lineageAccepted` 3 (`subscriptions` 2, `lineageRejected` 0), ONE parent write refreshes both children in place, root detach dispose closes both subscriptions; plus "host-root children component without a recipe throws coded OEIR_LEAF_MISSING_CHILDREN" (host/root boundary, no DOM written). C+ = `generated-leaf.test.ts` M06b2a emission contract (one children recipe per ref site, one projection per `{props.children}` site); C− = the M06b2a coded refusals (`OEIR_LEAF_MISSING_CHILDREN`, `OEIR_LEAF_UNSUPPORTED_CHILDREN`, `OEIR_LEAF_RECIPE_CYCLE`, explicit `children=` prop → `OEIR_LEAF_UNSUPPORTED_COMPONENT`) and the frontend `OEC9042` TSX-10 row (`props.children` in an expression value) |
| TSX-26 projection deletion/cross-owner | pass | pass | pass | pass | `generated-leaf.browser.test.ts` M06b1b S2b "children projection: disposing one generated site leaves the sibling subtree live" — the harness exposes each generated `__oe_childrenProjectionN` handle (test-harness text transform; generator unchanged): generated site A `dispose(true)` removes only A's subtree (`disposed` +1, `unsubscribed` +1), site B stays attached and keeps refreshing, B's default `dispose()` keeps its DOM (`disposed` +2, `unsubscribed` +2 total); cross-owner/dead-owner projections fail closed with `OE_KERNEL_ROOT_NOT_OWNED` / `OE_KERNEL_DISPOSED` (`lineageRejected` +1 each, zero allocation), recorded in the M06b S2b section above |
| TSX-08 unkeyed positions | pass | pass | pass | pass | `generated-leaf.browser.test.ts` M06b1b S2b "unkeyed list: positional identity, authored order, insert/delete content, clean disposal" — `items.value.map((item) => <li>{item}</li>)` mounts empty, then `['a','b','c'] → ['a','b','c','d'] → ['b','d']` renders li texts exactly `['a','b','c']`, `['a','b','c','d']`, `['b','d']` (the M06b2c entry-local refresh re-renders positionally reused items; unkeyed means positional identity, DOM node identity is NOT claimed), updates add no projections, emptying keeps the `<ul>` anchor, detach dispose closes the one list subscription (`disposed` 1, `unsubscribed` 1). C+ = the M06a list emission contract; C− = the M03 TSX-08 row (`OEC9042`, non-inline mapper) and the frontend/compiler refusals already recorded there. **This row supersedes the M06 S2 section's "unkeyed browser scenario is not claimed" note.** Same-key keyed content replacement (`key={item.id}`, stable ids, changed label: node identity preserved, `['A','B'] → ['A2','B']`, no entry recreated) is recorded as TSX-04-adjacent supporting evidence below; the TSX-04 row itself is not claimed here |

The children-projection evidence runs over the real M04 runtime bundle (no
stubs): the harness injects the generated module, mounts the generated root
factory, and asserts the `runtimeProbe` deltas above around every action. The
deletion-isolation scenario's `window.__oeChildrenProjections` exposure is a
test-harness transformation of the injected module text (mirroring the existing
factory extraction), not a generator emission.

The unkeyed and same-key scenarios above run on the post-M06b2c generator (the
M06b2c fix makes zero-reactive-dependency entry-local slots register a refresh
closure on the entry collector, so `update(next)` re-renders them for unkeyed
positional reuse and same-key keyed replacement); the previously recorded
stale-content observation is fixed and is not a pass claim for TSX-04.

**Not run in this section:** every SSR/claim column (`S`, `K`), the three-engine
qualification (`B`; M13), firefox/webkit, the TSX-04 matrix row, packed-consumer
(`P`) and production wiring remain unclaimed. M06 completion itself is recorded in
the progress ledger by the Lead, not by this evidence section. LOCAL chromium only
— no G1/G2 record and no Alpha16a exit claim is made here.

## M07-1 recorded results — composition / repeated-insertion claim order

Scope: leaf-scope **K (Claim)** only. The claim input is the generated mount
tree after `dispose(false)`, or the same nodes. This is not SSR→claim. The
harness is a Node DOM shim (`generated-leaf.order.test.ts`). Qualification:
非浏览器资格. M07-1 is signed off on
`ac8c218614e2d4749435c51edf3eaf15eb65f6fd`. This annex stays the Node DOM shim
record. It does not fill TSX-18 or TSX-30. Grid cells above stay `R`.

| Case | K (leaf scope only) | What this annex records | What it does not record |
| --- | --- | --- | --- |
| TSX-23 one recipe inserted twice | leaf-scope partial, 非浏览器资格 | `generated-leaf.order.test.ts`: `const item = <span><b>x</b><i>y</i></span>` inserted twice. Mount writes two spans; each span's children are `oe:r:0`, `b`, `oe:/r:0`, `oe:r:1`, `i`, `oe:/r:1`, with no nested directory. Claim adopts those two spans in that order as two projections with distinct owners and regions. `dispose(true)` of the first projection removes only the first span; the second span keeps its marker order. A second shape (`<span>x<i>y</i></span>` twice) claims each interior as text then `i`, with no `oe:r:` markers; swapping the first span's children throws `OEIR_LEAF_CLAIM_MISMATCH` and leaves the second span's order in place. | M06 mount browser evidence is not transferred. No SSR column, no browser, no three-engine `B`, no packed consumer. Not the full TSX-23 row. |
| TSX-10 repeatable children | leaf-scope partial, 非浏览器资格 | `Frame` projects `{props.children}` into `section` and `aside`. `Repeat` passes one children recipe (`<b>{label.value}</b><i>y</i>`). After claim, each site's children stay `b` then `i`, on distinct owners and regions, and the node identities match the mount. `label.value = 'z'` updates both texts and does not change order or identity. `dispose(true)` of the section projection empties only that site; the aside keeps `b` then `i`, and a later write updates only the aside. | Not SSR→claim. Not the full TSX-10 row. No browser qualification. |
| TSX-09 reusable JSX values | leaf-scope partial, 非浏览器资格 | `Mixed` mounts `<b>b</b>{chip}<Child text="k" /><u>u</u>` with `const chip = <i>c</i>`. Mount and claim child order are both `b`, `i`, `em`, `u`, and the text values are `b`, `c`, `k`, `u`. The chip claim is its own projection (distinct owner and region) and adopts the same `i` node the mount inserted. | One insertion among static siblings and a component reference. Not the two-site reusable-value row (that claim/order note is TSX-23 above), not SSR, not a browser. Not the full TSX-09 row. |
| TSX-01 roots/fragments/empty | leaf-scope partial, 非浏览器资格 | The adversarial shape `<div><p>a</p><section><><div><b>x</b><i>y</i></div></></section></div>` mounts one directory layer (`oe:r:0` / `oe:r:1` and the matching close comments). Claim consumes ordinals 0 then 1. The section's only child is the inner div, whose children are `b` then `i`, and `nestedMarkers` of the directory parent is empty. Wrapping that component in another `<div><Adversarial /></div>` keeps the same single marker layer on the inner div. | Not the full TSX-01 row (empty output, multi-root without a directory, SSR). Not a re-count of the #1753 clearance source test. Not TSX-18 or TSX-30. |

## M07-2 recorded results — browser clean-path claim

Scope: leaf-scope browser evidence only. Status: **in progress, not signed
off**. This annex does not fill any grid cell, does not mark TSX-18 or TSX-30
passing, and is not an M07 exit or an Alpha16 sign-off. Official
`generated-leaf.order` / `generated-leaf.directory` stay a Node LOCAL regression
gate and are not this slice's browser evidence. M05/M06 mount suites and the
M07-1 Node DOM shim are not transferred as a browser pass. Skip / NOT RUN is
not a pass. CI green is not browser qualification.

Qualification: **browser qualification (chromium 147.0.7727.15, LOCAL)**.
Playwright `browser.version()` on this run is `147.0.7727.15`. Firefox and
WebKit are M13 and are not a gate. Artifact:
`packages/compiler/__tests__/semantic-ir/generated-leaf.claim.browser.test.ts`.

Claim input for the four frozen shapes is the generated mount tree after
`dispose(false)`. That is not SSR→claim. The synchronous leaf path is
「服务端 HTML 字符串 → 生成叶 claim」: the server constructor returns the HTML
string `<p id="leaf">seed</p>`, the browser parses that string, and the
generated leaf claims it. The generated module does not contain `__h(`.

Claim-period first writes compare the current DOM to the value that would be
written and skip the DOM API when they are equal. Mount writes stay
unconditional. A later signal delivery shares the claim refresh body only as
an implementation coupling. This annex does not accept update-period 0
mutation, mismatch recovery, or reseeding. An unequal value still writes; it
does not throw.

| Case | K (leaf scope only) | What this annex records | What it does not record |
| --- | --- | --- | --- |
| TSX-23 one recipe inserted twice | leaf-scope browser qualification (chromium 147.0.7727.15, LOCAL), not a grid fill | The same recipe `<span><b>x</b><i>y</i></span>` inserted twice, and the flat shape `<span>x<i>y</i></span>` inserted twice. After a successful claim, author order, node identity, and two independent owners/regions still hold. `dispose(true)` of the first projection removes only that span. A MutationObserver on the observation root (`childList` / `characterData` / `attributes`) records 0 product mutations during the claim. | Not SSR→claim. Not the full TSX-23 row. Not TSX-18 or TSX-30. M06 mount evidence is not transferred. |
| TSX-10 repeatable children | leaf-scope browser qualification (chromium 147.0.7727.15, LOCAL), not a grid fill | `Frame` projects `{props.children}` into `section` and `aside`. After a successful claim each site stays `b` then `i` on a distinct owner and region, and the node identities match the mount. Each site subscribes to `label` exactly once (probe delta 2, site deltas `[1, 1]`). `dispose(false)` closes those subscriptions and leaves the DOM. 0 product mutations during the claim. | Not SSR→claim. Not the full TSX-10 row. Not a signed-off duplicate-subscription exit. Not TSX-18 or TSX-30. |
| TSX-09 reusable JSX values | leaf-scope browser qualification (chromium 147.0.7727.15, LOCAL), not a grid fill | `Mixed` claims `<b>b</b>{chip}<Child text="k" /><u>u</u>` as `b`, `i`, `em`, `u` with texts `b`, `c`, `k`, `u`. The chip projection keeps a distinct owner and region and the same `i` node. 0 product mutations during the claim. | Not the full TSX-09 row. Not SSR→claim. Not TSX-18 or TSX-30. |
| TSX-01 roots/fragments/empty | leaf-scope browser qualification (chromium 147.0.7727.15, LOCAL), not a grid fill | The adversarial shape and one wrapping composition. Claim consumes directory ordinals 0 then 1, the inner children stay `b` then `i`, `nestedMarkers` is empty, and the wrapping composition keeps that single marker layer. Author order and node identity hold. 0 product mutations during the claim. | Not the full TSX-01 row. Not SSR→claim. Not TSX-18 or TSX-30. |
| input / focus / selection | leaf-scope browser qualification (chromium 147.0.7727.15, LOCAL), not a matrix row | Static `<input id="field" value="hello" />`. Focus and `setSelectionRange(1, 4)` are set before claim. After a successful claim it is the same node, focus and selection are preserved, and the 0-mutation rule holds. | M06 keyed-reorder mount-period focus evidence is not transferred. Not an update-period mutation acceptance. |
| synchronous leaf | leaf-scope browser qualification (chromium 147.0.7727.15, LOCAL), not a grid fill | Fixture `export function Leaf(props: { name: string }) { return <p id="leaf">{props.name}</p>; }`. Path: 「服务端 HTML 字符串 → 生成叶 claim」. Seed string `<p id="leaf">seed</p>`, then `props.name = 'next'`. Claim of the equal seed skips the text write and still subscribes once; `dispose(false)` closes that subscription. | Not SSR→claim. Not TSX-18 or TSX-30. |
