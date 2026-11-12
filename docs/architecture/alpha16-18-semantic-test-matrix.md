---
status: active
topic: Semantic evidence grid
summary: Per-case evidence ledger; a case is done only when its required cells carry a recorded result at a recorded SHA.
---

# Alpha16–18 semantic test matrix

Date: 2026-11-03. Status: **PROPOSED — results are recorded in the per-milestone
annexes below; the grid cells are not filled**. Baseline:
`4f1f2001b24909086f7e7efe9e5016d48d615c91`. Latest recorded annex: the M07-2
leaf-scope browser clean-path annex, signed off on
`70eb2381cab2ef238903cb583f3925976206e901` (browser qualification, chromium
147.0.7727.15, LOCAL). M07-1 is signed off on
`ac8c218614e2d4749435c51edf3eaf15eb65f6fd` (Node DOM shim, 非浏览器资格).
M07-4 bounded mismatch recovery is signed off on
`c4bff6dfc7efbdf2d5ad65442b82f1ccd4b3bb20`. M07-5 is in progress and is not
signed off. The M08-1b annex at the end records the dynamic SSR producer and a
single-engine parse→claim vertical; it is not an M08 exit, and it loads no
grid cell. The M08 text-boundary annex records the standard dynamic-text pair,
the `{ node }` claim cursor, the lazy empty slot and the precise
restricted-context refusal; the M08 condition annex records the fixed
`oe:when`/`oe:/when` pair, the no-branch-id claim/SSR agreement and the
Custom Element reconnect vertical. Neither annex loads a grid cell, is an M08
exit, or makes TSX-18 or TSX-30 passing. None of these records fills the grid,
TSX-18, or TSX-30. The grid
cells stay `R`. Leaf-range protocol notes under TSX-18 / TSX-30 are
非浏览器资格 (Node DOM shim, LOCAL) comments only; those rows are not passing
and SSR→claim is not done.

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
browser. M07-5 (in progress, not signed off) suppresses `oe:r:` / `oe:/r:`
markers on a pure-mount tree (ADR-0175 D-2). A tree that emits a claim function
still mounts them. That suppression is not SSR→claim and does not fill
TSX-18 or TSX-30.

The M07-1 annex below records leaf-scope **K** notes for TSX-09, TSX-10,
TSX-23 and a partial TSX-01 shape. Those notes do not fill the grid, do not
fill TSX-18 or TSX-30, and are not SSR→claim. Qualification is 非浏览器
(Node DOM shim). M07-1 is signed off on
`ac8c218614e2d4749435c51edf3eaf15eb65f6fd`; that sign-off is the Node DOM shim
result and does not fill the grid. The M07-2 annex below records leaf-scope
chromium evidence and is signed off on
`70eb2381cab2ef238903cb583f3925976206e901`. The M07-4 note records that
bounded mismatch recovery is signed off on
`c4bff6dfc7efbdf2d5ad65442b82f1ccd4b3bb20`. The M07-5 note records a leaf-range
protocol that is in progress and is not signed off. None of these fills
TSX-18 or TSX-30, and none of them is SSR→claim.

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

Scope: leaf-scope browser evidence only. Status: **signed off on
`70eb2381cab2ef238903cb583f3925976206e901`**. This annex does not fill any
grid cell, does not mark TSX-18 or TSX-30 passing, and is not an M07 exit or
an Alpha16 sign-off. Official
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

## M07-4 recorded status — bounded mismatch recovery

Status: **signed off** on `c4bff6dfc7efbdf2d5ad65442b82f1ccd4b3bb20`. This note
does not fill any grid cell, does not mark TSX-18 or TSX-30 passing, and is
not an M07 exit, not the M07-5 protocol record, and not an M08 SSR→claim
result. The M07-2 chromium clean-path is not transferred as this slice's
recovery pass.

ADR-0175 D-1 for a directory claim: a failed claim releases the reservation,
rolls back tombstones and the success cursor committed in that attempt, and
releases those owners. Borrowed nodes are not deleted. A dynamic write that
already happened may stay. A directory claim that commits every declared
range stays permanent, including after `dispose`. The evidence file is
`packages/element/__tests__/compiled-runtime/static-sibling-ranges.test.ts`.
Qualification for that suite is 非浏览器资格 (Node DOM shim). Firefox and
WebKit remain M13. Skip / NOT RUN is not a pass. CI green is not this
slice's qualification.

## M07-5 recorded status — protocol record

Status: **signed off on `b82e63bdfa1794897e9ddf1ef32c262f48368883`** (owner decision 2026-11-12; see the progress
ledger §4.3/§4.4). This note still fills no grid cell and does not mark TSX-18
or TSX-30 passing: those leaf-scope cells moved to M08 with the generated-leaf
SSR producer they require (progress ledger §4.3). There is no generated-leaf
SSR producer and no permitted seed-state compare.

ADR-0175 D-2 suppresses unconsumed `oe:r:` / `oe:/r:` markers on a pure-mount
tree. A tree that emits a claim function still carries the marker pair.
Generated-leaf static attribute seed is an ordered exact set, compared after HTML ASCII case folding. Structural
mismatch is an `OpenElementError` carrying the internal identity
`OEIR_LEAF_CLAIM_MISMATCH` (not a member of the exported `RuntimeErrorCode`
catalogue, and no public snapshot change); it is not the directory code. The claim path requires
the HTML namespace (XHTML URI). The directory exact-set, case labels, and
namespace checks are unchanged. The record is
[m07-5-protocol-record.md](./m07-5-protocol-record.md).

TSX-18 and TSX-30 leaf-range cells: the protocol above is a 非浏览器资格
(Node DOM shim, LOCAL) comment on the leaf claim surfaces. The grid cells
stay `R`. They are not passing, and they are **M08 obligations** (progress
ledger §4.3, 2026-11-12): the matrix `K`/`S` columns require SSR DOM, so a
legal leaf cell cannot be produced before the M08 SSR producer. SSR→claim is
not done.

## M08-1b recorded results — dynamic SSR producer (Node + chromium parse → claim)

Scope: leaf-scope **S (SSR)** producer notes and one **K (Claim)** vertical. Status:
**not signed off as an M08 exit and it fills no grid cell.** The grid cells above
stay `R`; TSX-18 and TSX-30 are not passing. This is not per-phase equivalence
(M08-3), not claim negatives (M08-4), and not a filled matrix row (M08-5).

Qualification: **Node DOM shim (LOCAL)** for the producer contract, and
**browser qualification (chromium 147.0.7727.15, LOCAL)** for the parse → claim
vertical. Firefox and WebKit remain M13 and are not a gate. Skip / NOT RUN is
not a pass, and CI green is not this slice's browser qualification. Artifact:
`packages/compiler/__tests__/semantic-ir/generated-leaf.ssr-dynamic.test.ts`,
with the static producer suite `packages/compiler/__tests__/semantic-ir/generated-leaf.ssr.test.ts`.

The claim input on this path is the generated `__ssr()` string: produced in
Node by the emitted function, parsed by the browser, then adopted by the
generated claim. It is never a generated mount tree. The producer emits the
same lowered records the mount consumes, so no second evaluation model exists:
`<Name>__ssr(props, host)` is one-shot request-time evaluation that allocates no
owner, scope, subscription, DOM, cleanup or `onConnect`.

| Case | S / K (leaf scope only) | What this annex records | What it does not record |
| --- | --- | --- | --- |
| TSX-01 roots/fragments/empty | leaf-scope S note, 非浏览器资格 | Static roots and fragments serialize in authored order; a static sibling directory inside a component that also has a dynamic slot keeps its paired `oe:r:<ordinal>` / `oe:/r:<ordinal>` comments, and the chromium vertical parses that string and claims it with 0 claim-period mutations. | Not the full TSX-01 row. No empty-root or void-element producer, no update-period claim. |
| TSX-02 signal/computed | leaf-scope S note, 非浏览器资格 | `{count.value}` and `{doubled.value}` are read at request time: mutating the signal changes the next call's bytes. In chromium the parsed string claims unmutated, and a later signal write refreshes the claimed text, attribute and boolean slots. | Not the full TSX-02 row. No update-period zero-mutation acceptance, no multi-engine `B`. |
| TSX-03 props/destructuring | leaf-scope S note, 非浏览器资格 | A props getter is read once per slot (the probe counts one read), a component-local snapshot is evaluated once, and a missing host binding keeps the mount identity `OEIR_LEAF_MISSING_VALUE: <name>`. | Only the admitted named props parameter is covered. Not the full TSX-03 row. |
| TSX-18 SSR seed/claim fidelity | leaf-scope S + K vertical, single engine | The dynamic producer bytes, their parse, and the claim's adoption of those nodes on the listed shapes (text, attribute, boolean, plus a static directory beside a dynamic slot). | **Does not fill TSX-18.** No permitted-seed-state compare, no per-phase equivalence, no claim negatives, no duplicate-subscription account, no firefox/webkit, no update-period result. |
| TSX-30 repeated instances SSR/claim | not recorded | — | No repeated-instance server→claim shape was produced by this slice; the row stays `R`. |

**M08-2 residuals (explicit, not complete).** These are open work, not accepted
results:

1. **Adjacent text slots.** Authored `{a}: {b}` serializes correctly, but a real
   HTML parser coalesces the three authored text slots into one `Text` node. The
   claim walks one node per authored slot and therefore cannot adopt that string
   (`OEIR_LEAF_CLAIM_MISMATCH`). Only the producer bytes are asserted today.
2. **Nullish text slot.** A `null`/`undefined` dynamic text serializes to no
   bytes, and the parser then produces no `Text` node where the mount creates an
   empty one. Claiming that string is the same open boundary.
3. **Permitted seed-state compare** is not implemented.
4. **Per-phase equivalence** (mount bytes vs SSR bytes per phase) is not
   measured; the M08-1a/1b pairing is one string against one mount serialization
   on the recorded shapes.
5. **Claim negatives** for the SSR string (structural mismatch, rollback) are
   not produced by this slice.
6. **Cross-engine `B`** is not claimed; chromium only.
7. **No producer** is emitted for lists, component references, insertion
   sites, children projections, `property` channels or void elements — absence,
   not a pass. Conditions now have a producer only for the branch shapes the
   condition annex records; the list/component/property/void absence is
   unchanged.

**Source-map correction recorded here.** The audit of the dynamic producer found
a pre-existing chunk-offset defect: offsets were counted in `lines` array
elements, but one multi-line lowered expression is a single element containing
real newlines, so every later chunk drifted by the embedded-newline count. In
the multi-line fixture the claim placement pointed one line above its expression
(pre-existing since M05b) and the new SSR block two lines above. `generate.ts`
now tracks physical generated lines for `push`/`pushParts` and for the
`claimShift` / `ssrShift` / `lineOffset` offsets. The consumer test
`every placement points at the generated line that carries its lowered text`
(`packages/compiler/__tests__/semantic-ir/generated-leaf.sourcemap.test.ts`)
anchors on the emitted module instead of the placement's own coordinates: it is
red on the pre-fix generator and green after. This annex's map statement covers
that property only; it is not a claim about any other editor consumer.

## M08 text-boundary recorded results — dynamic-text pair (Node + chromium)

Scope: leaf-scope **S (SSR)** and **K (Claim)** notes for dynamic text only.
Status: **not signed off as an M08 exit and it fills no grid cell.** The grid
cells above stay `R`; TSX-18 and TSX-30 are not passing. This is not full
SSR→claim parity (M08-2), not per-phase equivalence (M08-3), not claim
negatives (M08-4) and not a filled matrix row (M08-5).

Evidence at the review-closed head `eb82e0178` (clean worktree): the
text+condition+review focused group is **12 files / 208 tests passed**, the
text browser file is **11/11**, the condition review file is **4/4**, and the
Custom Element shell file is **21/21**. The earlier Lead run of 44/44 is
superseded for committed-head status by these runs. The baseline of this annex is the last merged slice,
`df17534db` (M08-1b, PR #1767). Qualification: Node contract plus
**chromium 147.0.7727.15, LOCAL**.
Firefox and WebKit remain M13. Skip / NOT RUN is not a pass, and CI green is
not this slice's browser qualification. Artifacts:
`packages/compiler/__tests__/semantic-ir/generated-leaf.text-boundary.test.ts`
(Node), `generated-leaf.text-boundary.browser.test.ts` (Chromium), and the
element-level marker and text-slot-invariant suites.

The claim input is the generated `__ssr()` string: produced in Node, parsed by
the browser, then adopted by the generated claim. It is never a generated
mount tree. Each dynamic text slot carries the standard
`<!--oe:t:<n>-->TEXT?<!--oe:/t:<n>-->` pair; the pair is value-independent and
an empty value is two adjacent comments. The claim walks
`start, [0..1 Text], end` on a `{ node }` cursor with a one-position marker
check, and it performs no DOM write while walking. The protocol is recorded in
[the M08 text boundary record](./m08-text-boundary.md).

| Case | S / K (leaf scope only) | What this annex records | What it does not record |
| --- | --- | --- | --- |
| TSX-01 roots/fragments/empty | leaf-scope S + K note, LOCAL | Static adjacent text is one run in mount and SSR; an empty dynamic slot is two adjacent comments; a claim whose parsed values equal the client values has 0 claim-period mutations. | Not the full TSX-01 row. No update-period 0-mutation acceptance, no cross-engine `B`. |
| TSX-02 signal/computed | leaf-scope S + K note, LOCAL | The producer reads the signal/computed at request time and changes the next call's bytes; the parsed pair is claimed and a later signal write changes only that slot's Text. An empty slot is filled lazily on update. | Not the full TSX-02 row. No per-phase equivalence and no duplicate-subscription account for the stateful list. |
| TSX-03 props/destructuring | leaf-scope S + K note, LOCAL | A props getter is still read once per slot; an empty slot claims without a Text and the lazy writer creates at most one. | Only the admitted props shapes. Not the full TSX-03 row. |
| TSX-18 SSR seed/claim fidelity | leaf-scope S + K vertical, single engine | Pair bytes, parser node shape, the `{ node }` cursor, the lazy empty slot and the restricted-context refusal on the listed dynamic-text shapes. | **Does not fill TSX-18.** No permitted seed-state compare, no full per-phase equivalence, no full claim-negative set and no update-period result. |
| TSX-30 repeated instances SSR/claim | not recorded | — | No repeated-instance server→claim shape was produced by this slice; the row stays `R`. |

**M08-1b residual update.** Residuals 1 (adjacent text slots coalesce) and 2
(nullish text slot emits no Text node) in the M08-1b annex above are superseded
for a claimable dynamic text slot by the standard pair: the pair keeps the slot
identity in the bytes and the claim consumes `start, optional Text, end` instead
of one node per authored slot. They remain open only for shapes this slice does
not produce. Residuals 3–7 (permitted seed-state compare, per-phase equivalence,
claim negatives, cross-engine and the absent list/component/reference/
insertion-site/children/property/void producers) remain open; the condition
producer covers only the admitted branch shapes recorded in the condition annex
below. M08 is not complete and the list milestone has not started.

**Failure and wire boundaries recorded here.** A structural negative observed
before phase 2 writes nothing; the browser test also records a composition
failure after an earlier child slot's lazy insert, where `dispose(false)`
releases resources but keeps borrowed DOM and the inserted Text. That is
non-transactional, not a byte rollback. The old server-constructor `__h`/`__t`
string is pair-free and is refused with `OEIR_LEAF_CLAIM_MISMATCH`; no adapter
was added and `server-component.ts` is untouched. This is an internal M08 wire
change, not a production rollback. A value the parser normalizes (CR/NUL) is a
legitimate first claim write, not 0 mutation.

## M08 condition recorded results — `oe:when` / `oe:/when` (Node + chromium)

Scope: leaf-scope **S (SSR)** and **K (Claim)** notes for conditions only.
Status: **not signed off as an M08 exit and it fills no grid cell.** The grid
cells above stay `R`; TSX-18 and TSX-30 are not passing. This is not full
SSR→claim parity (M08-2), not per-phase equivalence (M08-3), not claim
negatives (M08-4), not a filled matrix row (M08-5), and it does not start the
list milestone.

Evidence: the condition and text slices land in one consolidation whose
review-closed head is `eb82e0178`. Qualification is Node contract plus
**chromium 147.0.7727.15, LOCAL**; Firefox and WebKit remain M13. Skip / NOT
RUN is not a pass. Artifacts:
`packages/compiler/__tests__/semantic-ir/generated-leaf.claim-condition.test.ts`
(Node), `generated-leaf.claim-condition.browser.test.ts` (Chromium),
`packages/element/__tests__/compiled-runtime/condition-wire.test.ts` (wire), and
the Custom Element vertical in `generated-element.shell.test.ts` (21/21).

The wire is the existing `oe:when` start marker plus the fixed `oe:/when` end
marker. There is no branch id and no ordinal; `parseWhenMarker` accepts exactly
the two fixed values, and the text parser never accepts them. Mount emits
`anchor + branch + end`; SSR evaluates the test once per call and emits the
selected branch chunk between the markers with ordinals restarting at 0; the
claim asserts one start/one end, evaluates the same test once, adopts the
selected client branch and moves writes/subscriptions to phase 2.

| Case | S / K (leaf scope only) | What this annex records | What it does not record |
| --- | --- | --- | --- |
| TSX-06 conditions/zero | leaf-scope S + K note, LOCAL | Ternary branches with static elements; false→true→false replaces only the branch; anchor/end node identity is stable; equal seed has 0 claim-period mutations. | Not the full TSX-06 row. No three-engine `B`, no update-period 0-mutation acceptance and no per-phase equivalence. |
| TSX-01 roots/fragments | leaf-scope S + K note, LOCAL | A condition nested in an element root claims the selected branch through the shared `{ node }` cursor; branch text/attribute slots use the admitted shapes. | Not the full TSX-01 row. Nested condition/list/component-ref/property branch shapes remain mount-only. |
| TSX-02 signal/computed | leaf-scope S + K note, LOCAL | The condition test is evaluated once per SSR call and once at claim; a later branch toggle replaces the branch without touching the anchor/end. | No computed-specific matrix row; no duplicate-subscription account for lists (list not started). |
| TSX-03 props/destructuring | leaf-scope S + K note, LOCAL | The Custom Element shell passes its per-read props record through `propsChanged`; `el.ok = false/true` toggles the claimed branch after reconnect. | Only the admitted boolean/primitive prop shape. Not the full TSX-03 row. |
| TSX-18 SSR seed/claim fidelity | leaf-scope S + K vertical, single engine | `__ssr` condition bytes → real parser → generated claim with anchor/branch/end identity; server-empty branch insertion is recorded as non-clean; server/client mismatch and a stripped end fail closed without deleting borrowed DOM. | **Does not fill TSX-18.** No permitted seed-state compare, no full per-phase equivalence and no full claim-negative set. |
| TSX-30 repeated instances SSR/claim | not recorded | — | No repeated-instance condition server→claim shape was produced; the row stays `R`. |

**Independent-review closure (B1/B2/B3).** B1 evaluates a component-local
snapshot once before the claim walk (no TDZ); B2 commits shared-cursor
activation only after the cursor owner's final structure check, so a late
enclosing mismatch opens no subscription, writes no DOM and performs no
server-empty insert while claim owners are still disposed and borrowed nodes
kept; B3 keeps branch-builder refresh functions in their own function scope so
a keyed-entry `update(next)` does not throw `__oe_refreshN is not defined`.
`generated-leaf.condition-review.browser.test.ts` is the real-Chromium RED→GREEN
evidence (4 tests, LOCAL). This is still a slice record, not an M08 exit.

**Explicit boundaries.** Only the previously admitted branch shapes are
claimable: static elements, static text, dynamic-text pairs and attributes. A
nested condition, list, component reference, insertion site, children
projection or `property` channel inside a branch stays mount-only, as does a
condition under a restricted parser context (the text context scan descends the
branch and refuses with `OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT`). The list
milestone (`oe:/each`, keys, list claim/refresh/SSR) is not started. Condition
SSR still reads `host.bindings[name]` directly; there is no request-scoped
`props`/`bindings` lifecycle, no composition SSR and no production wiring.
`runUntracked` is a built-in-engine escape, not an arbitrary-engine capability.
The M08 exit is not claimed.
