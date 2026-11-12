---
status: active
topic: M08 text boundary protocol
summary: The generated-leaf dynamic-text comment pair, node cursor, lazy empty slot, restricted parser contexts, the adjacent condition claim/SSR slice and the internal old-__h wire break; a LOCAL M08-2 slice record, not an M08 exit.
---

# M08 text boundary protocol

Date: 2026-11-13. Status: **LOCAL slice record, not signed off as an M08 exit.**
The baseline recorded here is the last merged slice, `735749b1c` (the M09-0
shell squash, PR #1768; the M08-1b producer is `df17534db`). The text and
condition implementations land together in the M08 consolidation at
`7bfbce00e`; this record mints no M08-exit SHA. Qualification is LOCAL only.

This record extends the leaf-range protocol of
[the M07-5 record](./m07-5-protocol-record.md) to dynamic text. It does not
replace that signed record, relax its rules, or approve the marker/seed
private contract as a public ABI. It adds no production wiring, no scanner and
no gate.

## 1. Standard pair

Every dynamic text slot in a claimable chunk (a component root or one recipe
target) carries one standard HTML comment pair:

```text
<!--oe:t:<n>-->TEXT?<!--oe:/t:<n>-->
```

`<n>` is a chunk-local, pre-order ordinal. The pair is emitted by the generated
mount and by the generated SSR, from the same `textSlotMarker` helper, so both
surfaces carry the same pair bytes for the same slot. The pair is
value-independent. In the SSR bytes an empty value is the two comments with no
text between them; the generated mount may still carry its empty Text node,
which serializes to no bytes. A pure-mount component emits no pair and keeps
authored text granularity.

The vocabulary has one owner, `packages/element/src/internal/compiled/runtime/markers.ts`.
`parseTextSlotMarker` accepts only the canonical `oe:t:` / `oe:/t:` spelling;
`parseRangeMarker` never accepts a text pair and the text parser never accepts
an `oe:r:` range pair. The generator contains no raw marker literal. Ordinals
are computed by one pure helper for mount, claim and SSR; a missing ordinal is
an internal diagnostic, never a guessed marker. Recipe and children chunks
restart their ordinals at 0.

Static adjacent text in a claimable child list is normalized to one run
(fragments are transparent), so mount, SSR, claim and the directory seed all see
the parser's one-node shape. The authored model is not mutated: the run merge is
an emission view, and pure-mount trees keep authored granularity.

## 2. Node cursor

The generated claim uses a small cursor, `{ node }`, which holds the next node
object and advances with `nextSibling`. It is not `{ list, i }`.

For one dynamic slot the claim consumes `start, [0..1 Text], end`, asserts both
comments with `assertTextSlotMarker(node, ordinal, end, where)`, and performs no
DOM write while walking. The assert is a one-position check: exactly one
Comment at the expected position, the expected start/end spelling, and the
expected canonical ordinal. It is not a scan, a descriptor table or a protocol
interpreter, and it never echoes the foreign comment text into the error.

A missing, mistyped or foreign comment fails closed with the existing internal
`OEIR_LEAF_CLAIM_MISMATCH` identity. That identity is intentionally not a member
of the exported `RuntimeErrorCode` catalogue and does not change the public
interface snapshot.

The cursor is what makes the lazy writer safe. The claim consumes the closing
marker before phase 2 runs, so a Text inserted before that already-consumed
marker cannot desynchronize a later sibling walk. No index compensation, no
`list[i] === end` test and no reserve slot is emitted.

## 3. Empty slot, lazy update and failure

The empty slot claims with no Text node: it adopts `start`, `end`, and no text.
The phase-2 writer has three branches:

- empty parsed slot + empty client value: no write;
- empty parsed slot + non-empty client value: create one Text, insert it before
  the closing marker, and register a claim-scope range cleanup for it;
- existing Text: assign `nodeValue` only when the value differs.

Non-empty to empty keeps the same Text with `nodeValue = ""`; it is not deleted.
A later non-empty value reuses that Text. The writer never creates a second
Text, never splits or merges a Text, and never normalizes at claim time. The
lazily created node is not part of the projected `nodes` array; its range
cleanup is the owner.

A successful claim whose parsed values all equal the client values is the
zero-mutation promise. It is not a general claim about every input. A value
that the HTML parser normalizes (CR and NUL are the recorded cases) is a
legitimate first claim write, not a zero-mutation result.

Failure is not a byte transaction:

- Validation that fails before phase 2 writes nothing.
- A composition failure after an earlier child slot's phase-2 write is
  non-transactional. The claim releases resources with `dispose(false)`, which
  keeps borrowed DOM and any write that already happened; it is not a whole
  claim byte rollback.
- The signed directory D-1 recovery is unchanged.

## 4. Restricted parser contexts

The generator tracks an explicit parser context, not a sticky excluded
ancestor. A dynamic text slot can be claimed only where the HTML parser exposes
the pair's comments as Comment nodes in `childNodes` and keeps the text in
place. The precise refusals are:

| Context | Reason |
| --- | --- |
| `textarea`, `title` (RCDATA) | comments parse as literal text |
| `script`, `style`, `xmp`, `iframe`, `noembed`, `noframes`, `plaintext` (rawtext) | comments parse as literal text |
| `template` | children live in `.content`, not `childNodes` |
| `noscript` | parsing depends on the scripting flag, so a Comment node is not stable |
| `svg`, `math` (foreign content) | the generated claim is HTML-namespace-only, so those elements are outside the claim contract |
| `table`, `colgroup`, `col`, `thead`, `tbody`, `tfoot`, `tr` (foster parenting) | non-whitespace text is foster-parented out of the table and the claim cannot find it in place |
| `select`, `optgroup`, `option` | a stated conservative slice boundary, not a parser fact |

`td`, `th`, and a table-level `caption` reset to normal flow. So
`<td><p>{value}</p></td>` and a table-level `<caption><p>{value}</p></caption>`
are accepted, while text directly in a table section or row is refused.
Non-whitespace static text under foster parenting is refused for the same
reason; whitespace-only static text is allowed, using the HTML space
characters, not JavaScript `trim` semantics.

The scan crosses component references and insertion-site recipes only while
the current context is restricted, and reports the child slot's authored span.
A `props.children` projection is refused only under a restricted context. The
result is the source-located compiler diagnostic
`OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT` and **no module**. It is never a silent
mount-only fallback.

A caller that wraps the generated bytes in `textarea`, `title`, `plaintext` or
another restricted context is outside what the producer can see. That wrapper
contract fails closed at claim time; the producer does not guess.

## 5. Old `__h` wire is incompatible

The old server constructor (`__h`/`__t`) predates this boundary and emits no
`oe:t` pair. The generated claim refuses that string with
`OEIR_LEAF_CLAIM_MISMATCH`; it does not silently fall back to per-node text
alignment. No compatibility adapter was added.

`server-component.ts` and the released Alpha15 production path are untouched.
This is an internal M08 wire change: the old constructor is a different,
pair-free wire, not a production regression. If that path ever has to remain
claim-compatible, it needs its own server-component wire change and evidence,
not a guess inside the claim.

## 6. Condition slice in the same consolidation

The condition slice lands in the same change as this text boundary because the
generator hunks, the marker vocabulary, the claim invariants and the
generated-leaf tests interleave; a split would leave a non-green intermediate
state. It is a separate leaf-scope producer, not a widening of the text
contract:

- **Vocabulary.** The existing `oe:when` start marker plus the new fixed
  `oe:/when` end marker. There is no branch id and no ordinal. The text and
  condition families are parsed by disjoint helpers (`parseWhenMarker` accepts
  exactly the two fixed values), so a text pair cannot be read as a condition
  pair or vice versa.
- **Mount/SSR/claim agree.** Mount emits `anchor + selected branch + end`; SSR
  evaluates the test once per call, emits `oe:when`, the selected branch chunk
  (ordinals restart at 0) and `oe:/when`; claim asserts exactly one start and
  one end, evaluates the same test once, and adopts the selected client branch
  through the ordinary claim walk. Equal parsed/client values make the claim
  phase-2 work a no-op (0 claim-period mutations) and preserve anchor, branch
  and text node identity.
- **Verify is DOM-read-only, not JS-free.** Claim verify reads the cursor/DOM,
  evaluates the condition test and setup-local snapshots once, and adopts the
  selected client branch. "Read-only" means it performs no DOM write, opens no
  subscription and runs no server-empty insert; it does not mean no JavaScript
  runs. A local snapshot such as `const visible = props.visible` is evaluated
  once before the structure walk (setup order, the same snapshot mount uses), so
  an authored side effect in that initializer is observable during claim. The
  independent-review B1 TDZ regression is covered by a real Chromium local
  snapshot case.
- **Activation is committed by the cursor owner.** In a shared-cursor module,
  per-element phase-2 work is appended to one module-level activation queue as
  closures (the closures keep block-scoped node bindings visible). Nested
  component and claim-time recipe claims append to the same queue and never
  flush it. Only the cursor owner drains the queue, after every nested claim's
  structure walk and its own final `extra node at /` check have succeeded. A
  late enclosing mismatch therefore opens no subscription, writes no DOM and
  performs no server-empty insert; `claimRecipe` rollback still releases the
  claim owner, condition/branch owners and child owners while keeping borrowed
  nodes. This is the independent-review B2 fix. In a module with no
  composition the non-shared claim already validated its root before phase 2;
  it keeps inline activation.
- **Activation remains non-transactional after commit.** Once the owner starts
  draining, a throwing activation step can leave earlier writes, as the
  `dispose(false)` contract says; this fix moves the commit point, it does not
  add a byte transaction or a rollback mechanism. A successful server-empty
  branch with a non-empty client branch still inserts before the end marker and
  is explicitly non-clean (a real `childList` mutation), not a 0-mutation claim.
  A server non-empty/client empty or structurally different branch, a stripped
  end marker, or a branch mismatch fails closed with the existing
  `OEIR_LEAF_CLAIM_MISMATCH` identity without deleting borrowed DOM.
- **List-entry condition mount (inherited M06 defect).** A condition inside a
  keyed or unkeyed list entry emits its branch builders with their own refresh
  collector. Branch-local refresh names no longer leak into the entry
  `update(next)` hook (the `__oe_refreshN is not defined` failure); the
  condition's own refresh stays registered and its forced rebuild re-runs the
  branch against the re-bound mapper parameter. A real same-key replacement
  case in Chromium covers the update path. This does not claim list SSR, list
  claim, keyed-entry completion or a new list shape.
- **Claimable branch shapes** are the previously admitted ones: static text,
  dynamic-text pairs, attributes and static elements. A nested condition,
  list, component reference, insertion site, children projection or property
  channel inside a branch remains mount-only, as does a condition under a
  restricted parser context. The text context scan descends condition
  branches, so a claimable condition carrying a dynamic text slot in an
  unsupported parser context is still a source-located
  `OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT` refusal rather than an unclaimable wire.
- **Custom Element evidence.** The shell's `Conditional` vertical claims
  Node-produced `Conditional__ssr` bytes, toggles the branch, disconnects with
  `dispose(false)`, reconnects with a fresh owner and updates again while the
  anchor/end identities stay fixed. This is the CE lifecycle proof the
  leaf-level condition suites do not provide.
- **`runUntracked`** is the narrow built-in-engine escape used while the
  condition test's own signal effect runs; it stays inside `internal/signal/`
  and is re-exported through the generated runtime `bindings.ts`. It is not a
  general arbitrary-engine capability.

Not claimed by the condition slice: list/`oe:/each` or keyed entries; a
request-scoped `props`/`bindings` layer (condition SSR still reads
`host.bindings[name]` directly); composition or component-reference SSR;
treating the non-transactional activation as a byte rollback; M08-2/3/4/5,
TSX-18/TSX-30, M13, production wiring, a public ABI or a release. The M08 exit
is not claimed and the list milestone is not started.

## 7. What this record does not claim

This is an M08-2 slice, not the M08 exit. It does not claim:

- full SSR→claim parity (M08-2), per-phase equivalence (M08-3), claim negatives
  (M08-4) or matrix rows (M08-5);
- TSX-18 or TSX-30 as passing grid cells, a permitted seed-state compare, or a
  duplicate-subscription account for the stateful list;
- lists, keyed entries, property channels, void elements, component-reference
  SSR, insertion-site SSR or children-projection SSR (the condition slice's
  own boundaries are recorded in §6);
- Firefox, WebKit or M13 qualification (the browser evidence is LOCAL
  Chromium only);
- production wiring, a public ABI, an error-catalogue change, a version, a tag,
  a publication or a release;
- that a minifier or sanitizer which strips `oe:` comments is supported; that
  is a deployment contract and currently fails closed at claim time.

## 8. Evidence

The consolidation's focused artifacts are:

- `packages/compiler/__tests__/semantic-ir/generated-leaf.text-boundary.test.ts`
  — Node contract: pair bytes, ordinals, static-run normalization, pure-mount
  absence, source-located restricted-context refusals, CR/NUL record.
- `packages/compiler/__tests__/semantic-ir/generated-leaf.text-boundary.browser.test.ts`
  — Chromium 147.0.7727.15 (LOCAL): SSR bytes → parser → claim → update, empty
  slot lazy insert, `dispose(false)` + re-claim, non-transactional composition
  failure, legal `td`/`p` text, static run, shared cursor and structural
  negatives.
- `packages/element/__tests__/compiled-runtime/markers.test.ts` — canonical
  spelling, ordinal round-trip, mutual exclusion of the two vocabularies.
- `packages/element/__tests__/compiled-runtime/claim-invariants-text-slot.test.ts`
  — expected start/end, missing/non-comment/wrong-ordinal/wrong-end refusal,
  no comment-text echo.

Condition slice on the same head:

- `packages/compiler/__tests__/semantic-ir/generated-leaf.claim-condition.test.ts`
  — Node: mount/SSR wire, no branch id, empty branch bytes, static-branch SSR,
  one test evaluation, source-map positions, restricted contexts, nested
  condition/list/component-ref/property boundaries.
- `packages/compiler/__tests__/semantic-ir/generated-leaf.claim-condition.browser.test.ts`
  — Chromium 147.0.7727.15 (LOCAL): equal seed 0 mutation/identity,
  false→true→false, empty-branch insert/removal, non-clean insert,
  server/client mismatch, stripped end, throwing activation, subscription
  isolation, shared cursor and both dispose modes.
- `packages/compiler/__tests__/semantic-ir/generated-leaf.condition-review.browser.test.ts`
  — Chromium red/green review closure for B1 (local snapshot TDZ), B2
  (shared-cursor activation commit point: no subscription/DOM write/insert
  before the enclosing mismatch) and B3 (keyed-entry condition branch refresh
  on same-key replacement). Four LOCAL tests; not M13.
- `packages/element/__tests__/compiled-runtime/condition-wire.test.ts` —
  spelling, parser mutual exclusion, one-position asserts, mismatch identity.
- `packages/compiler/__tests__/semantic-ir/generated-element.shell.test.ts` —
  21/21 (LOCAL Chromium): the condition claim/toggle/disconnect/reconnect/
  update vertical on the real Custom Element shell, plus the property-channel
  no-claim fixture that replaced the stale condition no-claim assumption.

Related suites updated by the same lane: `generated-leaf.claim.browser.test.ts`
(pair-free old `__h` refusal, then generated-pair claim),
`generated-leaf.claim.test.ts`, `generated-leaf.directory.test.ts`,
`generated-leaf.order.test.ts`, `generated-leaf.ssr.test.ts`,
`generated-leaf.ssr-dynamic.test.ts`, `generated-leaf.sourcemap.test.ts`,
`generated-leaf.test.ts` and `generated-leaf.browser.test.ts`.

At the consolidation head the recorded results are: the compiler focused
group 9 files / 112 tests passed, the element focused group 3 files / 37 tests
passed, the Custom Element shell file 21/21 passed, full compiler 48 files /
855 tests passed, and full element 115 files / 816 tests passed (clean worktree
at the consolidation commit; all LOCAL;
Chromium 147.0.7727.15 for the browser cases). These are focused and package
results, not a release qualification.

The record is LOCAL. It is not a release qualification and not an Alpha16a or
M08 exit. The implementation head is `7bfbce00e`; the exact command exits are
recorded in the landing review, not in this protocol record.

## 9. Related records

- [M07-5 protocol record](./m07-5-protocol-record.md) — the signed leaf-range
  protocol this record extends.
- [Alpha16–18 progress ledger](./alpha16-18-progress.md) — M08 status and exit
  gap.
- [Alpha16–18 semantic test matrix](./alpha16-18-semantic-test-matrix.md) —
  the M08 text-boundary and condition annexes; the grid cells stay `R`.
