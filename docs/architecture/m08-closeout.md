---
status: active
topic: M08 closeout record
summary: The M08 exit record and the Alpha16a exit check: one stateful list across SSR to claim to update to dispose, the composition shapes, the claim negatives and the authored-location diagnostics, with the slice inventory and the explicit boundaries.
---

# M08 closeout: the generated claim and SSR of the stateful list

Date: 2026-11-13. Status: **M08 exit recorded; Alpha16a exit check recorded.**
The owner sign-off is the merge of this record (the closeout form of the
progress ledger §4.4). Baseline: `origin/main` = `116f4b5dffc2a4b8eb0aa730cb5208b7b142c59f` (PR
`#1777`, the resource-parity merge); the evidence set below it is
`0e67e176b` (PR #1775), `92a16e902` (PR #1774), `5ada043bf` (PR #1773),
`fcb8d4ae6` (PR #1771), `61efa69cb` (PR #1770), `431f1df59` (PR #1769),
`df17534db` (PR #1767) and `edbbae02e` (PR #1763).

This is an internal engineering record. It creates no version, tag,
publication, Starter default or release claim, and it authorizes no Alpha16b
work.

## What M08 is

M08 is the **generated claim and SSR of the stateful list**: one authored
stateful input crosses four phases on the generated path and the phases must
agree. The input is the S2 Board — a condition that is a sibling of a keyed
list (`key={item.id}`), a component-local private draft signal, entry-local
dynamic text, and a static focus carrier — plus one authored props text slot in
the per-phase row so the props-read count is observable. The four phases are
SSR at request time (`<Name>__ssr(props, host)`), Claim on the parsed server
bytes, Update on the claimed tree, and Dispose in both modes.

Agreement is asserted, not assumed: the server bytes are compared with the
mount's own structure, the claim must reproduce the author order with 0
claim-period mutations and the same node identity, the seed is classified per
slot under that one definition, the same
per-logical-dependency subscription multiset is observed in mount and claim,
and both dispose modes close exactly the live resources. The permitted seed
definition lives once in
[the M08 list wire record](./m08-list-wire.md#41-permitted-seed-state-the-single-m08-definition)
and is referenced, never restated here.

M08 also carries the composition shapes the M06 generator already admitted on
the mount path but the SSR producer did not emit — module-local component
references, reusable-JSX insertion sites including the same recipe twice, and
repeated `{props.children}` projections — and the claim negative set a
stateful SSR→claim proof needs, including the authored-location diagnostic
channel on a claim mismatch. It is not a second execution model: SSR evaluates
the same lowering records the mount and claim consume, one-shot, with no
owner, scope, subscription, DOM, cleanup or `onConnect`.

## Slice inventory

The command column is the reproduction command for the artifact. Results are
the recorded LOCAL results at the named head; the slice commands were not
re-run for this record. CI is named only where a PR-head CI run is the
artifact, and no CI run is used as browser qualification.

| Slice | PR / squash | Evidence artifact | Command | Result |
| --- | --- | --- | --- | --- |
| M08-1a static SSR producer | #1763 `edbbae02e` | `packages/compiler/__tests__/semantic-ir/generated-leaf.ssr.test.ts` | `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-leaf.ssr.test.ts` | `__ssr()` is byte-equal to the mount serialization on the static shapes under the shared escape contract; the merge commit records 154 files / 1535 tests, `pnpm run check` 5/5 and an unchanged interface snapshot (LOCAL, Node DOM shim) |
| M08-1b dynamic SSR producer | #1767 `df17534db` | `packages/compiler/__tests__/semantic-ir/generated-leaf.ssr-dynamic.test.ts` | `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-leaf.ssr-dynamic.test.ts` | `vitest --project compiler` 44 files / 779 tests passed; the Chromium vertical parses the Node `__ssr` string, claims it with 0 claim-period mutations and refreshes text/attribute/boolean on update (LOCAL) |
| Text boundary + condition claim/SSR | #1769 `431f1df59` | `generated-leaf.text-boundary.test.ts`, `generated-leaf.text-boundary.browser.test.ts`, `generated-leaf.claim-condition.browser.test.ts`, `generated-leaf.condition-review.browser.test.ts`, `generated-element.shell.test.ts` | `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-leaf.text-boundary.browser.test.ts packages/compiler/__tests__/semantic-ir/generated-leaf.condition-review.browser.test.ts packages/compiler/__tests__/semantic-ir/generated-element.shell.test.ts` | text browser file 11/11, condition review 4/4 and Custom Element shell 21/21 at the review-closed head `eb82e0178`; the merged tree is tree-equal to the reviewed head `112037daa` (LOCAL, chromium 147.0.7727.15); the matrix annex records the wider 12-file focused group |
| Keyed list SSR/claim wire | #1770 `61efa69cb` | `generated-leaf.claim-list.test.ts` (15), `generated-leaf.claim-list.browser.test.ts` (10), `packages/element/__tests__/compiled-runtime/list-key.test.ts` (41), `packages/element/__tests__/compiled-runtime/list-wire.test.ts` (14) | `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-leaf.claim-list.test.ts packages/compiler/__tests__/semantic-ir/generated-leaf.claim-list.browser.test.ts` and `./node_modules/.bin/vitest run --project element packages/element/__tests__/compiled-runtime/list-key.test.ts packages/element/__tests__/compiled-runtime/list-wire.test.ts` | 15 Node + 10 Chromium + 41 + 14 pass; canonical `s:`/`n:`/`b:` tokens, S1/S2/S3 seed predicate, duplicate-key multiplicity, read-only verify with phase-2 activation (LOCAL) |
| Void input SSR + S2 acceptance | #1771 `fcb8d4ae6` | `generated-leaf.input-ssr.test.ts` (13), `generated-leaf.input-ssr.browser.test.ts` (3), `generated-leaf.s2-ssr-claim.browser.test.ts` (13), `generated-leaf.s2-sourcemap.test.ts` (2) | `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-leaf.claim-list.test.ts packages/compiler/__tests__/semantic-ir/generated-leaf.claim-list.browser.test.ts packages/compiler/__tests__/semantic-ir/generated-leaf.s2-ssr-claim.browser.test.ts packages/compiler/__tests__/semantic-ir/generated-leaf.s2-sourcemap.test.ts` | 4 files / 40 tests passed; the `<input>` vertical is Node bytes to real parser to a pre-claim live edit to claim, with the same node, 0 claim-period mutations and the live value/focus/selection kept; `tsc`, `oxlint`, `oxfmt` pass (LOCAL, chromium 147.0.7727.15) |
| Composition SSR | #1773 `5ada043bf` | `generated-leaf.composition-ssr.test.ts` (12), `generated-leaf.composition-ssr.browser.test.ts` (2) | `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-leaf.composition-ssr.test.ts packages/compiler/__tests__/semantic-ir/generated-leaf.composition-ssr.browser.test.ts` | 2 files / 14 tests passed (12 Node + 2 Chromium); same-recipe probe `projections=3 regions=3 owners=3 subs=2` with 0 claim-period mutations; full compiler 58 files / 952 and element 117 files / 871; `pnpm run check` 5/5; PR #1773 CI green |
| Per-phase equivalence + claim negatives | #1774 `92a16e902` | `generated-leaf.phase-equivalence.browser.test.ts` (2), `generated-leaf.claim-negatives.browser.test.ts` (3), `testlib/m08-browser-harness.ts` | `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-leaf.phase-equivalence.browser.test.ts packages/compiler/__tests__/semantic-ir/generated-leaf.claim-negatives.browser.test.ts` | 2 files / 5 tests passed; full compiler 60 files / 957 and element 117 files / 871; `tsc`, `oxfmt`, `oxlint`; `pnpm run check` 5/5; PR-head CI green at `bd488f48d` (LOCAL, chromium 147.0.7727.15) |
| Authored claim-origin diagnostics | #1775 `0e67e176b` (PR head `b122fc7ce`) | `generated-leaf.authored-diagnostic.browser.test.ts` (7), `packages/element/__tests__/compiled-runtime/claim-invariants-origin.test.ts` (10), `generated-leaf.typecheck.test.ts` (2) | `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-leaf.authored-diagnostic.browser.test.ts` and `./node_modules/.bin/vitest run --project element packages/element/__tests__/compiled-runtime/claim-invariants-origin.test.ts` | 7/7, 10/10 and 2/2 passed; focused claim/order/S2 group 9 files / 85 tests; full compiler 59 files / 959 and element 118 files / 881; `pnpm run check` pass (LOCAL, chromium 147.0.7727.15) |
| Resource parity | PR `#1777`, squash `116f4b5dffc2a4b8eb0aa730cb5208b7b142c59f` | `generated-leaf.m08-resource-parity.browser.test.ts` (9 recorded cases) | `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-leaf.m08-resource-parity.browser.test.ts` | 9 tests passed (LOCAL, chromium 147.0.7727.15); two assertions written against the pre-`5ada043bf`/pre-`0e67e176b` tree are replaced by acceptance witnesses in the same change |

## Claim acceptance chain

The chain is one contract, not two checkboxes: marker/order encoding, key
alignment, permitted seed state, bounded mismatch recovery,
duplicate-subscription accounting, and the location a mismatch reports. M07
proved the leaf half and that history is unchanged; M08 proves the same chain
on the stateful list. TSX-18 and TSX-30 are the ledger rows.

| Chain link | M07 leaf proof (unchanged) | M08 stateful proof (this record) |
| --- | --- | --- |
| Marker / order encoding | M07a structural adoption; M07b paired `oe:r:` directory at leaf scope | SSR emits the standard text pair, the fixed `oe:when` / `oe:/when`, the `oe:each` / `oe:k:<token>` / `oe:/each` wire and the directory pairs; claim adopts them in authored order with 0 claim-period mutations at `92a16e902` |
| Key alignment | M07-1 repeated-insertion order at leaf scope (`ac8c218614e2d4749435c51edf3eaf15eb65f6fd`) | canonical primitive-key tokens, S1/S2/S3 seed predicate, duplicate-key multiplicity and minimal-move keyed reorder at `61efa69cb`, re-asserted in the S2 row at `fcb8d4ae6` |
| Permitted seed state | M07-5 ordered exact static-attribute set (`b82e63bdfa1794897e9ddf1ef32c262f48368883`) | one definition in [the list wire record](./m08-list-wire.md#41-permitted-seed-state-the-single-m08-definition); the S2 vertical asserts `{structure: "equal", values: "equal", clean: true}` and the permitted difference `{structure: "equal", values: "different", clean: false}` at `fcb8d4ae6` |
| Bounded mismatch recovery | M07-4 directory rollback (`c4bff6dfc7efbdf2d5ad65442b82f1ccd4b3bb20`) | condition anchor / foreign end, list entry template and nested directory seed negatives fail closed before phase 2 with 0 mutations and 0 subscriptions at `92a16e902`; consumer-first rebuild and a throwing entry activation release owners at `116f4b5dffc2a4b8eb0aa730cb5208b7b142c59f` |
| Duplicate-subscription accounting | M07-2 per-site account (`70eb2381cab2ef238903cb583f3925976206e901`) | exact per-logical-dependency multiset `[["count",2],["items",1],["open",1],["props",1]]` and a reclaim count that does not double, both asserted at `92a16e902`; the two-region account is at `116f4b5dffc2a4b8eb0aa730cb5208b7b142c59f` |
| Authored mismatch location | leaf-range protocol notes only (Node DOM shim) | additive ` (authored <file>:<line>:<column>)` suffix on `OEIR_LEAF_CLAIM_MISMATCH`, 7/7 exact-message assertions at `0e67e176b` |

## Row cells recorded

The grid rows are replaced in
[the semantic test matrix](./alpha16-18-semantic-test-matrix.md#matrix): TSX-18
records `S`, `K`, `U`, `D`, `F` and `C+`; TSX-30 records `S`, `K`, `D` and
`C+`. The per-cell evidence is the M08 annex of that document.

Cells that stay `R`, and why:

- **T+/T−** — no TypeScript type-check fixture exists for either case; the
  fixtures are compiled by the production frontend, not type-checked as
  authored types.
- **C−** — no case-specific source-located compile diagnostic is defined for
  these two rows; their negatives are runtime and are recorded as `F`.
- **B** — cross-engine is M13 (Alpha16b). This record is chromium
  `147.0.7727.15`, LOCAL only.
- **P** — the packed consumer is M12 (TSX-18 `o`, TSX-30 `R`).
- **TSX-30 `F`** — no repeated-instance-specific mismatch negative exists.
  The bounded-recovery mechanism is proved at list, condition and directory
  claim scope and is cited, not transferred.

## Alpha16a exit check

Alpha16a exit = M01–M08 with G1 and G2 evidence recorded (execution plan §1).
M01–M07 are met per the progress ledger, and the G1/G2 records are signed off
in its §4.1. With M08 recorded here, the M01–M08 exit set is complete.

The exit is internal. It does **not** authorize:

- M11 (Router integration) — the plan gives M11 the dependency `M08, M10`, and
  M10 is Alpha16b work;
- class retirement or the Part Program/ABI retirement (approved P-1…P-5, M10
  evidence);
- a version, tag, publication, release note or Starter default;
- a public API/ABI freeze (Alpha17) or any public claim about the marker,
  seed or diagnostic contract;
- M09–M14, the three-engine qualification (M13) or the packed consumer (M12);
- production wiring: the generated-leaf path is still not reachable from an
  entry.

## Boundaries

- **Not M13.** One engine, chromium `147.0.7727.15` (Playwright
  `browser.version()`), LOCAL. Firefox and WebKit are Alpha16b.
- **Not a packed consumer.** No tarball install, no alias-free consumer, no
  `TSX-21` evidence.
- **Not production wiring.** The generated-leaf producer is compiler-private;
  no product entry, no build integration, no registration.
- **Not Alpha16b.** M09–M14 are untouched by this record. The M09-0 shell and
  the M09-shadow root/DSD slice are separate LOCAL records, not an M09 exit.
- **No public ABI/API.** The marker, seed and diagnostic contracts stay
  private and OPEN; `ClaimOrigin` is internal to the compiled runtime and is
  not re-exported from the runtime barrel.
- **No byte-level claim rollback.** A validation failure writes nothing; an
  activation failure releases resources with `dispose(false)` and may leave an
  earlier dynamic write. Borrowed nodes are never deleted.
- **No request-scoped props/bindings lifecycle.** SSR reads
  `host.bindings[name]` at request time; there is no request object identity.
- **Still mount-only by design.** The `property` channel, entry-internal
  condition/list/composition, nested children composition and component
  references inside list entries remain refused or mount-only.

## Residual gaps

1. **Directory range-interior diagnostic precision.** A static-seed mismatch
   at a nested directory parent reports the leaf identity with a numbered DOM
   path (`at /0/0`), but a mismatch inside a range interior reports
   `OE_RUNTIME_STATIC_RANGE_MISMATCH` with the directory consumer's
   `file#Component` label and no DOM path. The fix is named and not done: the
   generator's `emitClaimedDirectory` would pass
   `${file}#${Component}@${line}:${column}` plus a per-range source, and
   `claimStaticSiblingRange` would use it for its failures. Do not read this gap as a logic failure: the claim still fails
   closed before any subscription or write.
2. **Firefox and WebKit.** M13, exact-SHA three-engine qualification. Not an
   M08 blocker and not claimed.
3. **No version, tag or publication.** Alpha16a creates none.
4. **TSX-30 `F` cell open.** A mismatch in the repeated-instance shape has no
   dedicated negative. One case in
   `generated-leaf.composition-ssr.browser.test.ts` would fill it (delete one
   of the two insertion projections from the SSR bytes, assert
   `OEIR_LEAF_CLAIM_MISMATCH`, 0 mutations, 0 subscriptions, borrowed DOM kept
   and a clean retry); until that case exists the cell stays `R`.

## Evidence

The closeout's own verification is the source gates plus the focused suites at
the base commit. Nothing below was run for the draft.

```sh
vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo seams:check
vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo docs-index:check
vp run --no-cache --fail-if-no-match --filter @openelement/www check:doc-claims
vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo adr-index:check
vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo interface:snapshot
pnpm run check
```

## Related records

- Stage authority: [Alpha16–18 execution plan](./alpha16-18-execution-plan.md).
- Status ledger and exit check:
  [Alpha16–18 progress ledger](./alpha16-18-progress.md#46-m08-exit-and-alpha16a-exit-check-2026-11-13).
- Evidence ledger: [Alpha16–18 semantic test matrix](./alpha16-18-semantic-test-matrix.md#m08-recorded-results).
- Seed definition: [M08 list wire protocol](./m08-list-wire.md).
- Text and condition wire: [M08 text boundary](./m08-text-boundary.md).
- Seams: [the live registry](./seams.md).
