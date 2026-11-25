---
status: active
topic: M14 full-await definition
summary: Owner-approved Alpha16 definition of M14 full await: exactly two await positions (a text child, a nested server-component prop), nine located OEC9032 boundaries with their carriers, the #1801 / Alpha18 §7 extension carrier, and the evidence the consolidation PR still owes. Not the M14 exit.
---

# M14 full await — the Alpha16 DEFINITION (exactly two positions)

Date: 2026-11-15. Status: **DEFINITION — owner-approved, recorded; documentation-only.**
Owner approval carrier: [execution plan §16.1 D-16b](./alpha16-18-execution-plan.md)
(dated amendment 2026-11-15). This document is the definition itself; the
amendment is the authorization that registers it.
Baseline: the clean worktree at `6bd3667d4`. The bounded implementations this
definition describes are PR #1748 (squash
`bbe25445dda16afae0ba99e477eec55a96245844`, 2026-11-09) and PR #1776 (squash
`e9a9cf643`, 2026-11-13); both are ancestors of the baseline.

This is a dated decision record. It records what Alpha16 means by **"full
await"** — the M14 semantic definition — so that every later test, diagnostic
and claim is read against one definition instead of against an accumulated
list of refusals. It is a **DEFINITION, not an exception list**: the two
positions in §2 are the whole admitted set, and every other position is outside
the definition by decision, with a named carrier (§3), not a feature that is
merely missing.

The record changes no milestone status. It does not write the progress ledger,
it does not fill a semantic-matrix cell, and it is not the M14 exit (§6, §7).

## 1. What this record is, and is not

**Is** — the tracked carrier of the Alpha16 definition of M14 registered by
[execution plan §16.1 D-16b](./alpha16-18-execution-plan.md)
full await; the located boundary table for every refused position; the
extension carrier and its reason; the evidence that exists today; the evidence
the consolidation PR still owes; the explicit non-claims.

**Is not** — the M14 exit or exit evidence; a status change in
[the progress ledger](https://github.com/open-element/openelement/blob/fc55986d7966da2c2e67cae253e536ca4b898e6e/docs/architecture/alpha16-18-progress.md) (the M14 row stays "In
progress", "M14 exit not met"); a result in
[the semantic test matrix](./alpha16-18-semantic-test-matrix.md) (the TSX-17
row stays `R`); a public API, ABI, version, tag, publication or release claim;
an authorization to widen the await grammar in Alpha16.

The definition agrees with the shipped admission: the compiler already admits
exactly these two positions (`packages/compiler/__tests__/server-component-full-await.test.ts`,
the bounded merges above). This record therefore adds no implementation
obligation and implies no code change; it fixes the meaning the implementation
already has.

## 2. The definition (normative)

**Alpha16 "full await" means: an async server function component awaits its
data, and its HTML is emitted only after every awaited value settles. Exactly
two positions carry an await.**

| # | Position | Admitted spelling | What the compiler emits |
| --- | --- | --- | --- |
| **D1** | a text child | `{await load()}`, `{await load(<literal or props.field>)}`, or `{await props.field}` as the **whole** JSX child | `__t(await …)` — the ONE escaped server text channel, no new sink (`lower-program.ts:1432-1437`) |
| **D2** | a server-component prop of a nested server component | `<Child value={await load()} />` — **one leading await as the whole prop value**, `Child` being another server function component composed by direct call | the recorded call `await Child({ value: await … })` in the generated constructor module (`lower-program.ts:1063-1069`) |

Rules that belong to the definition, not to a slice:

- **R1 — the enclosing component is async.** An `async function` or an
  `async` arrow; `await` in a sync component is refused
  (`'await is admitted only inside an async server function component'`,
  `lower-program.ts:476-484`).
- **R2 — the envelope is a single JSX return.** A component is a single
  `return <jsx>` (or an arrow with an expression body). The production
  admission bridge re-derives the same shape and refuses near-misses
  (`server-component.ts:201-232`, `:631-647`).
- **R3 — a sync parent cannot call an async child.** The message says why —
  HTML is built only after the child settles — and the fix is inside the
  definition: mark the parent async (`lower-program.ts:1009-1015`).
- **R4 — the awaited operand grammar is closed.** `await <identifier>(…)`
  with literal or `props.field` arguments, or `await props.field`. Nothing
  else is an awaited operand (`lower-program.ts:487-539`).
- **R5 — timing is full-await.** Every await settles before any HTML exists:
  no partial output, no out-of-order emission, no per-fragment flushing. The
  await is the whole value at its position, never a subexpression of a larger
  value.
- **R6 — no new sink.** Awaited text rides the existing escaped `__t`
  channel; attribute/URL/raw-HTML admission is unchanged; awaited text is not
  trusted HTML (ADR-0169 amendment item 3).
- **R7 — composition auto-awaits.** When an async parent composes an async
  child, the generated direct call itself is awaited (`await Child(...)`,
  `server-component.ts:808-812`). That is D2's composition channel, not a
  third author-written await position.

"Exactly two positions" is exhaustive by construction: an await is admitted
only where it is the entire emitted value at D1 or D2. The next section locates
every other position and names its carrier.

## 3. The located boundary: every other position is outside the definition, by design

One diagnostic code — `OEC9032` — carries every refusal; the *position clause*
is what the author reads (`SERVER_AWAIT_HEAD` + one clause per position,
`lower-program.ts:141-186`). That is a message contract over one boundary, not
a set of unimplemented features.

Two carriers are named per row. The **carrier today** is the lawful spelling
that expresses the same intent *inside* the definition. The **widening
carrier** is GitHub issue #1801, to be answered by Alpha18 §7 bounded defer
(§4 of this record); a row marked *no widening* is a permanent negative, not
deferred work. All locations are line numbers at the baseline `6bd3667d4`.

| Refused position | Located `OEC9032` rule | Position clause the author reads | Why the boundary is deliberate | Named carrier |
| --- | --- | --- | --- | --- |
| **Attribute** (intrinsic attribute, or a custom-element / `__ssr` host prop) | `lower-program.ts:819` (`serverAwaitRefusal('attribute')`) | "the refused position is an attribute value (including a custom-element host prop); await the value into a nested server-component prop, or await it in a text child" | An attribute is constructed synchronously inside its parent's node call; awaiting it would suspend one attribute mid-node — per-fragment scheduling, which is not full await (R5). | Today: await into D2, or into D1. Widen: #1801 / Alpha18 §7. |
| **Condition / branch test** | `lower-program.ts:1392-1400` (position classifier, `'condition'`) → `:1439`; a static branch → `:1433` (`'staticBranch'`) | "the refused position is a condition test; await the value into a nested server-component prop and branch in a sync child component, or await it in a text child first" / "the refused position is a static branch; …" | A condition decides which subtree is built; awaiting the test suspends the branch decision inside the parent's synchronous build. | Today: D2 carries the awaited value; branch in a sync child. Widen: #1801 / Alpha18 §7. |
| **List item / mapper body** | `lower-program.ts:1860` (`'listItem'`); a `….map()` child is classified `'listItem'` at `:1392-1400` → `:1439` | "the refused position is a list item or mapper body; await the whole list into a nested server-component prop and map it in a sync child component" | One settle per entry would interleave entry construction with settlement — unbounded scheduling over a collection, exactly the bounded-defer question (Alpha18 §7 queue/depth bounds). | Today: await the whole list into D2, map in a sync child. Widen: #1801 / Alpha18 §7. |
| **Operand in a larger expression** | `lower-program.ts:523` and `:537` (`'operand'`); a spread argument `:517`; child classifier `:1392-1400` (`'operand'`) | "the refused shape is the awaited operand or a larger expression; the await must be the whole child and its operand must be await load(), await load(<literal or props.field>), or await props.field" | R5 requires the await to be the whole value; embedding it makes the surrounding expression's evaluation timing unspecified, and the grammar must stay closed because the operand is spliced into the generated module (R4). | Today: make the await the whole D1/D2 value; compute the rest in a sync child. Widen: #1801 / Alpha18 §7. |
| **Component prop outside the nested position** (a D2 value that is not one whole await — a second await or a larger expression; a host/intrinsic prop falls to the attribute row) | `lower-program.ts:1068` (`'componentProp'`) | "the refused position is inside a nested server-component prop, and a prop admits one leading await as its whole value; await the value in its own prop first" | D2 admits exactly one whole-value await per prop. Anything more is the operand boundary again, in prop position, and would need scheduling inside a child's argument construction. | Today: one await per prop value; additional values via D1/D2 in the child. Widen: #1801 / Alpha18 §7. |
| **Reserved callee** (`__h`, `__t`, `__ssr`, `eval`, an imported server-component binding) | `lower-program.ts:513` (`'reservedCallee'`) | "the refused shape is a reserved callee; that callee belongs to the generated constructor module — await the authored function instead" | The reserved names are generated-module machinery, not author-callable functions; composition is D2, and an async child is already awaited by its parent's direct call (R7). | Today: nest the child (R7 auto-await) and await only authored data functions. Widen: #1801 / Alpha18 §7 for the scheduling question only — the name reservation is not a missing capability. |
| **Promise-annotated prop read at a sink** | `lower-program.ts:589` via `refusePromiseField` (text child call site `:1441`, attribute call site `:836`); the `Promise<...>` annotation table is read in admission (`server-component.ts:139-197`, wired `:470-475`) | "a Promise is not a normal child/attribute value — props.p is annotated Promise<...>, so this read would stringify the pending value (`[object Promise]`); await it first: {await props.p} …" | A pending thenable has no display value; this is the TSX-17 negative "a Promise is not a normal child". The guard is on the read, never on the declaration, so the sanctioned spelling never passes through it. | Today: `{await props.p}` or `value={await props.p}` (D1/D2). Widen: **no widening** — permanent negative (TSX-17; Alpha18 §7 "Not allowed: arbitrary Promise as a child"), with the internal `OE_SERVER_TEXT_THENABLE` backstop for untyped reads (`packages/element/src/server.ts:115`). |
| **Statements before the return** | `server-component.ts:381-394` — the production admission bridge's near-miss gate (`OEC9032`); the admitted-shape re-derivation is `server-component.ts:201-232` | "this exported function renders JSX but is not an admitted server function component (a component is a single return of one JSX element) — runtime JSX has no interpreter in the server lane; fix the shape or move it out of the module" | R2's envelope exists so the ONE lowering walk sees a JSX-rooted body; a statement body admits control flow and non-JSX computation the generative lane does not model, and a near-miss must not fall through as runtime JSX. | Today: put the awaits in D1/D2 of the single returned JSX. Widen: #1801 (a definition change, not a bug fix). |
| **Block-bodied arrow** | `server-component.ts:381-394` — the same near-miss gate; the admitted arrow shape requires an expression body (fact predicate `module-analysis.ts:455-500`) | same near-miss sentence | Same envelope reason: a block body is a statement body, and the near-miss must fail closed rather than ship JSX the server lane cannot evaluate. | Today: `export const C = (props) => <…>`. Widen: #1801. |

One boundary is *inside* the definition and therefore needs no extension
carrier: **a synchronous parent of an async child** is refused with a located
`OEC9032` (`lower-program.ts:1009-1015`), and the lawful fix is part of the
definition — mark the parent async (R1/R3). It is not a missing feature and not
an Alpha18 item.

## 4. The extension carrier: #1801 and Alpha18 §7 (bounded defer)

Any widening beyond §2 — a third await position, or output before all awaits
settle — is a change to this definition, not a compiler bug fix. It is not
carried in Alpha16. The tracked carrier is **GitHub issue #1801**
(https://github.com/open-element/openelement/issues/1801), which is answered by
[the execution plan](./alpha16-18-execution-plan.md) **§7, Alpha18 — bounded
defer**.

The reason is an overlap of semantics, not a backlog ordering: the positions
outside the definition all need to **suspend the construction of a
partially-built tree** and resume it later. That is per-fragment scheduling —
queue depth, buffered bytes, deadline, cancellation, SSR/client coordination
for streamed regions — which is exactly Alpha18 §7's subject. Full await, by
contrast, produces HTML only after every await settles (R5). The two
capabilities touch the same suspension point and must not be designed
separately: beating a "full await" width out of the compiler without that
design would either ship per-fragment output under the full-await name or
freeze a suspension model before it is bounded.

[The semantic test matrix](./alpha16-18-semantic-test-matrix.md) TSX-17 states
the same separation: ordinary async server components including full-await
output are **M14 / Alpha16b**, bounded defer is **Alpha18**, and the two must
not be conflated. [The canonical architecture](./compiler-native-architecture.md)
§4.6a repeats it: "ordinary `await` and deferred regions are different
capabilities".

## 5. Evidence that exists today

At the baseline `6bd3667d4`, after both bounded merges above:

- **Admission and lowering (code facts).** One admission bridge
  (`compileServerComponentIfAdmitted`) and one lowering walk
  (`Lowering` + `ConstructorEmitter`): the async flag and the
  `Promise<...>` field table enter the walk as bindings
  (`server-component.ts:455-480`, `lower-program.ts:64-88`); D1 and D2 are
  admitted at the sites named in §2; the refusals are located at the sites
  named in §3; the generated entries await the published
  `renderFunctionPageAwaited` while the synchronous `renderFunctionPage`
  string contract is unchanged
  (`packages/router/src/vite/internal/server-runtime/page-render.ts:184-197`,
  `packages/router/src/vite/internal/ssg/entry-descriptor.ts:183-184`).
- **Compiler tests.** `packages/compiler/__tests__/server-component-full-await.test.ts`
  covers, in five groups: emission inside the admitted grammar (sync shape
  preserved, async function and async arrow, async parent awaiting an
  imported async child in source order, helper-only import); refusals that
  stay located `OEC9032` (sync parent of an async child, statements before
  the return, attribute await, condition await, arbitrary awaited
  expression, block-bodied arrow); the per-position message contract
  (each clause naming the nearest lawful spelling); previously untested
  refused shapes keeping a location (static branch, `__ssr` host prop,
  list-item attribute, member-expression callee); and "a Promise is not a
  normal child (M14-2)" (text read, attribute read, the sanctioned
  `{await props.p}`, the untyped-prop runtime backstop, and the class path
  unchanged).
- **Router tests.** `packages/router/__tests__/function-page.test.ts` — the
  awaited seam, the preserved synchronous contract, and the generated-entry
  wiring.
- **Recorded evidence.** [The progress ledger](https://github.com/open-element/openelement/blob/fc55986d7966da2c2e67cae253e536ca4b898e6e/docs/architecture/alpha16-18-progress.md) §3
  M14 row records the two bounded merges and their LOCAL counts at #1748
  (compiler focused 203 tests, router 121, element focused 64, Node
  v24.18.0; PR-head CI green). [ADR-0169](../adr/ADR-0169-request-time-rendering-surface.md)
  records the bounded decision (amendment, 2026-11-09);
  [the canonical architecture](./compiler-native-architecture.md) §4.6a and
  [TSX-17](./tsx-author-candidate-contract.md) state the contract position.

What that evidence is **not**: it is LOCAL, bounded-slice evidence on the
Alpha15 request-time lane. It is not a matrix result, not the M14 exit, not
browser evidence (TSX-17 is SSR-only, so no browser instance is required), not
three-engine qualification (M13), and not a replacement for the M08
generated-leaf SSR producer.

## 6. What the consolidation PR still must record

This record is deliberately *not* the evidence ledger. The consolidation PR
still owes, at a recorded SHA:

1. **The matrix TSX-17 rows.** In
   [the semantic test matrix](./alpha16-18-semantic-test-matrix.md) the
   `TSX-17 server async boundary` row is still all-`R` (`T+`, `T−`, `C+`,
   `C−`, `S`, `F` required; `M`, `U`, `K`, `D` n/a; `B`, `P` optional). The
   consolidation PR records the per-cell results for D1/D2 admission and for
   the §3 refusals (`C−` for the located compile refusals) at that SHA. This
   record cannot be cited as a matrix result.
2. **The ledger exit row.** In
   [the progress ledger](https://github.com/open-element/openelement/blob/fc55986d7966da2c2e67cae253e536ca4b898e6e/docs/architecture/alpha16-18-progress.md) §3 the M14 row stays "In
   progress … M14 exit not met" until the exit evidence is recorded there.
   The consolidation PR writes that exit row — the M14 gate is "OEC9032 lifted
   with defined semantics" and its exit is "awaited output, server-only graph
   guard intact" for the defined surface
   ([execution plan](./alpha16-18-execution-plan.md) §1) — and reconciles the
   in-force descriptions that still call the merge a bounded slice
   (ADR-0169 amendment, native architecture §4.6a).

Until that PR lands, every reader should treat the M14 status as **In
progress** and this document as a definition only: it fixes what the milestone
means, not whether the milestone is met.

## 7. Non-claims

Explicit, because the definition is easy to over-read:

- **No streaming or defer support.** Full await emits HTML only after every
  await settles (R5). Nothing here streams, defers, flushes partial output or
  cancels. Bounded defer, cancellation and streamed regions stay Alpha18 §7
  and are not implemented.
- **No extension of await positions in Alpha16.** The two positions in §2 are
  the whole set. None of the nine boundaries in §3 is a placeholder for
  upcoming Alpha16 work, and no row is scheduled to flip in this milestone.
- **No second async path.** There is one admission bridge, one lowering walk,
  one server-helpers module and the existing escaped sinks; the synchronous
  `renderFunctionPage` contract is unchanged, and the server-only import guard
  remains the graph enforcement point. No alternate async runtime, no parallel
  lane, no second sink table.
- **No milestone-status change.** M14 stays In progress; this is not M14 Met
  and not the M14 exit. The progress ledger and the semantic test matrix are
  not edited by this record.
- **No release claim.** No version, tag, publication, ABI freeze, public API
  addition or release evidence; no external promise is claimed interruptible.
- **No broader qualification.** No M13 three-engine qualification, no
  replacement of the M08 generated-leaf SSR producer, no class-authoring
  migration claim.

## 8. References

- [Alpha16–18 execution plan](./alpha16-18-execution-plan.md) — §1 milestone
  table (M14 row), §7 Alpha18 bounded defer.
- [Alpha16–18 progress ledger](https://github.com/open-element/openelement/blob/fc55986d7966da2c2e67cae253e536ca4b898e6e/docs/architecture/alpha16-18-progress.md) — §3 M14 row (the
  bounded merges; exit not met).
- [Alpha16–18 semantic test matrix](./alpha16-18-semantic-test-matrix.md) —
  TSX-17 row (still `R`).
- [TSX author candidate contract](./tsx-author-candidate-contract.md) —
  TSX-17 server async boundary.
- [Compiler-native architecture](./compiler-native-architecture.md) — §4.6a
  async server components.
- [ADR-0169 request-time rendering surface](../adr/ADR-0169-request-time-rendering-surface.md)
  — the 2026-11-09 bounded full-await amendment.
- GitHub issue #1801 — https://github.com/open-element/openelement/issues/1801
  — the extension carrier (answered by Alpha18 §7).
- Code: `packages/compiler/src/internal/compiler/semantic-core/server-component.ts`,
  `packages/compiler/src/internal/compiler/semantic-core/lower-program.ts`,
  `packages/compiler/src/internal/compiler/semantic-core/module-analysis.ts`,
  `packages/router/src/vite/internal/server-runtime/page-render.ts`,
  `packages/element/src/server.ts`.
- Tests: `packages/compiler/__tests__/server-component-full-await.test.ts`,
  `packages/router/__tests__/function-page.test.ts`.

## 9. Verification record (2026-11-17, lane C2 — LOCAL, not the exit)

Append-only fact record in the [evidence baseline](./evidence-baseline.md)
five-field form. It records the fresh consumer-side verification of the §2
admission, the §3 boundary table and the request-time path at one clean SHA. It
does not write the matrix TSX-17 cells, does not write the ledger exit row, and
records no sign-off: those stay with the consolidation PR (§6) and the
integration single-writer.

| Field | Record |
| --- | --- |
| commit | `7bdb1a2064706abd70fe31398ce6929f7b5fcfb9` (branch `work/alpha16-qualification`, isolated worktree) — the commit that contains the 29-test suite as run |
| status | clean before and after the runs at this commit (`git status --porcelain` empty at `7bdb1a206`, before and after every command below) |
| commands | `node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/compiler test packages/compiler/__tests__/server-component-full-await.test.ts` → **1 file / 29 passed**; `node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/router test packages/router/__tests__/function-page.test.ts packages/router/__tests__/browser-entry-boundary.test.ts packages/router/__tests__/entry-graph-boundary.test.ts` → **3 files / 54 passed**; `node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/element test packages/element/__tests__/server-html.test.ts` → **1 file / 19 passed** — each vp call forwards the file targets to the package task's `vitest run` script (verified live; the dispatch log shows the script line with the targets appended) |
| result | all green, Node v24 (LOCAL, no CI identity, chromium not required — TSX-17 is SSR-only) |
| provenance | LOCAL (isolated worktree); not a gate, not M13, not a milestone exit |

**Correction (2026-11-17; append-never-rewrite, corrected by a docs-only commit
that carries no test change and cites no run of its own).** The first recording
of this section named `aa1f949d9` as the verification commit with 29 tests: that
was wrong. The 26 pre-existing rows were green at `aa1f949d9` (direct
`node_modules/.bin/vitest` call), the three reserved-callee rows were added in
`7bdb1a206`, and the suite as run (29/54/19) was re-executed clean at
`7bdb1a206` itself — first via the direct `vitest` call, then via the canonical
vp task entry above. The verification SHA is therefore `7bdb1a206`, and the
dirty intermediate runs (test file edited before commit) are not baseline-clean
records. The pre-correction text stands as the mis-attribution history; this
paragraph is the correction.

**Coverage map (read from the passing rows, not asserted).**

- **D1/D2 admission** (5 emission rows): the sync shape is preserved; an async
  function awaits a call before the text helper runs (D1); an async arrow keeps
  `async` on the generated const; an async parent awaits an imported async
  child in source order (D2 + R7 auto-await); the artifact imports only the
  server helper entry (R6, no new sink).
- **All nine §3 boundaries carry a named consumer row**: attribute (`an await in
  an attribute is refused` + the `__ssr` host-prop shape), condition test, static
  branch, list item/mapper body, component prop outside the nested position,
  operand in a larger expression (arbitrary expression + member-expression
  callee), **reserved callee (NEW: generated helper `__t`, `eval`, and an
  authored await of an imported server component — the composition auto-await
  makes the authored await a refusal)**, Promise-annotated prop read at a sink
  (text + attribute + sanctioned spelling + untyped `__t` backstop in the
  element suite + class path unchanged), statements before the return, and a
  block-bodied arrow. Every refusal is located at the authored node and carries
  the per-position clause.
- **Request-time SSR path** (router rows): `renderFunctionPageAwaited` is
  `Promise<string>` with the sync contract unchanged; the production transform
  proves no HTML until the awaited value settles for the request handler, SSG,
  error re-render and 404; a rejected async render keeps the original failure
  channel; nested async components settle left to right before the parent HTML
  exists.
- **Server-only graph guard intact** (guard rows): a `node:*` island import and
  a transitive one fail the client build with a coded diagnostic while a route
  loader importing `node:*` still builds (the server graph is not the browser
  graph); the element/html leaves stay kernel-free with the negative control;
  a function page puts no server helpers and no page function on the client
  entry.

**Still owed (explicitly not written here).** The matrix TSX-17 per-cell record
(`T+`/`T−`/`C+`/`C−`/`S`/`F`) and the progress-ledger exit row are the
consolidation PR's write, owned by the integration single-writer; this record
supplies the evidence they would cite, not the cells themselves. No signature,
no exit, no admission change.
