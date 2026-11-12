---
status: active
topic: M08 list wire protocol
summary: The generated-leaf keyed-list wire (`oe:each` / `oe:k:<token>` / `oe:/each`), canonical primitive-key tokens, duplicate-key multiplicity, read-only verify with phase-2 activation, the SSR producer and the parsed-DOM boundary; a LOCAL M08-2 slice record, not an M08 exit.
---

# M08 list wire protocol

Date: 2026-11-13. Status: **LOCAL slice record, not signed off as an M08 exit.**
The baseline recorded here is the merged squash `431f1df59` (PR #1769, the M08
text-boundary and condition consolidation; tree-equal to the reviewed head
`112037daa`). Qualification is LOCAL only: Node v24.18.0 plus the real Chromium
`147.0.7727.15` engine. Firefox and WebKit stay with M13. No grid cell, TSX-18
or TSX-30 is claimed, and no release, product wiring, public ABI or
packed-consumer claim is made.

This record extends the leaf-range protocol of
[the M07-5 record](./m07-5-protocol-record.md) and the text/condition slices of
[the M08 text boundary record](./m08-text-boundary.md) to the keyed list. It
adds no scanner, no gate and no public API surface: the marker vocabulary stays
the private generated-leaf wire.

## 1. Wire

A claimable list uses the existing `oe:each` comment as its one fixed anchor and
one list-level `oe:/each` comment as its fixed tail. Every entry starts with
exactly one `oe:k:<token>` comment. There is **no per-entry end marker**: the
next key marker (or the list end) terminates the previous entry, so an entry
cannot hide a foreign tail behind a missing close.

```
<!--oe:each--><!--oe:k:s:61--><li>a</li><!--oe:k:s:62--><li>b</li><!--oe:/each-->
```

The marker vocabularies stay disjoint: `parseWhenMarker`, `parseTextSlotMarker`,
`parseRangeMarker` and `parseEachMarker` accept only their own family, and
`parseEntryKeyMarker` is the only reader of the `oe:k:` prefix. The prefix
belongs to the marker owner (`markers.ts`); a token never contains it.

The list wire exists only when the component emits a claim/SSR. A mount-only
component keeps its historical shape: no inert comments and no second marker
vocabulary to maintain.

## 2. Canonical key tokens

`encodeListKey` is the only key → token surface. It accepts exactly three
primitive kinds and never stringifies, serialises or coerces an object:

| Key kind | Token | Rule |
| --- | --- | --- |
| string | `s:<lowercase hex>` | UTF-8 bytes, not UTF-16 code units; a lone surrogate throws instead of folding to U+FFFD |
| finite number | `n:<String(value)>` | `-0` normalises to `0`; `NaN`, `±Infinity` and every non-finite value throw |
| boolean | `b:0` / `b:1` | the closed two-value alphabet |

An unkeyed list keeps mount's positional identity: the index is the key, encoded
as `n:<index>`, so claim and SSR share the same rule instead of inventing a
second unkeyed spelling.

`isCanonicalListKeyToken` checks spelling, not semantics. `n:` is exact
(`Number(payload)` is finite and `String(value) === payload`); `b:` is exact;
`s:` checks the even-length lowercase hex alphabet **without decoding** and
without UTF-8 validation. A forged token that happens to have canonical hex
spelling still cannot equal a client token, because the claim compares strings
and never decodes a token back into a key.

An unsupported runtime key throws the internal coded identity
`OEIR_LEAF_UNSUPPORTED_KEY` (deliberately absent from the public
`RuntimeErrorCode` catalogue). Mount alone stays tolerant: `tryEncodeListKey`
turns only that identity into `null` and writes the mount-only `oe:k:u`
payload. SSR never writes `u`, and claim rejects it with the precise
`unsupported entry key kind` mismatch. A claimed list that is later updated to
an unsupported key preflights every key before any DOM write, throws the same
internal identity, writes no `u` marker, and keeps the previous DOM, owners,
entries and subscriptions in place so the next legal signal value recovers.

## 3. Duplicate multiplicity

The same token may legitimately appear more than once. Duplicate keys are
mount-relevant state, not wire corruption:

- mount keeps its existing used-set rule: the first occurrence adopts a
  previous entry, later occurrences insert;
- SSR emits one key marker per item, so duplicate items produce duplicate
  tokens and no half string;
- claim counts occurrences. `entrySeedMismatch` applies three rules in order,
  and the first failure wins:
  - **S1** a client key outside the admitted primitives;
  - **S2** a wire token occurs more often than the client list (an extra server
    occurrence has no client item to adopt it);
  - **S3** a wire token has no client item at all (would require deleting
    borrowed DOM).

  Wire-more is S2/S3. Client-more is the insert path, not a mismatch.

Every wire occurrence is a distinct entry identity. The seed assignment
consumes the Nth occurrence of a token for the Nth wire entry of that token, so
`[a, a]` server/client works, `[a, a]` / `[a]` fails closed, and a cross-key
reorder such as server `[a, a, c]` / client `[c, a, a]` keeps each token group's
occurrence order (`a0`, then `a1`) while the groups move as blocks. Ordering is
never compared as a whole: the claim matches by token and the existing
minimal-move placement handles reorder.

A duplicate claimed insert is re-claimable: the inserted entry carries its own
`oe:k:` marker, so `dispose(false)` + a fresh claim adopts every occurrence.
This is the B1 review closure; the internal duplicate-key refusal was removed
(it was never public).

## 4. Verify is read-only; activation is phase 2

Claim verify walks the list without creating DOM, opening a subscription or
writing a value:

1. assert the `oe:each` anchor at the current position;
2. read every `oe:k:` entry marker and adopt each entry template through the
   shared `{ node }` cursor (owner/cleanup registration only);
3. assert the `oe:/each` end and move the cursor past it;
4. evaluate the items expression once and each key once per item;
5. run `entrySeedMismatch` before any assignment, DOM write or activation.

Only after the enclosing owner's final structure check does the phase-2 queue
run: every seeded entry activates (compare-write refresh plus subscriptions),
the list/key outer reads bind, and one strict sync runs. A client-more seed
inserts after that; a reorder only moves existing nodes; a seeded node is never
deleted. An equal seed produces **0 claim-period mutations** and preserves
anchor, key-marker and entry node identity. A server-empty (or client-more)
insert is explicitly non-clean, like the condition slice's server-empty branch
insert. A late enclosing mismatch before phase 2 opens nothing: no
subscription, no DOM write, no queue drain; claim owners are released and
borrowed nodes are kept.

The first write of a dynamic slot skips the DOM operation when the current
value already equals the value that would be written; mount writes stay
unconditional. That skip is an implementation coupling to the shared refresh,
not an update-period zero-mutation acceptance, not mismatch recovery and not
SSR→claim reseeding.

### 4.1 Permitted seed state (the single M08 definition)

This subsection is the one definition of **permitted seed state** used by the
M08 evidence; [the progress ledger](./alpha16-18-progress.md) and
[the semantic test matrix](./alpha16-18-semantic-test-matrix.md) reference it
and do not restate it. It is a definition and an evidence classification, not a
runtime mode, and it adds no marker or wire byte.

> Permitted seed state = the DOM state produced by SSR from the caller's request
> snapshot, which the claim is permitted to adopt. It is judged per admitted
> slot: equal value **and** structure → clean; a text/attribute/boolean value
> difference → a permitted activation compare-write recorded as non-clean;
> structure/key/static-attribute mismatch → fail closed. The seed never travels
> on the wire.

- **P1 provenance.** SSR and claim receive the same caller request snapshot
  (`props`/`host.bindings` values); SSR is one-shot and the claim reads the same
  binding record shape. There is no JSON, `data-*`, wire seed or second state
  channel. The generated leaf has no provenance bit, so the rule is about the
  caller's input, not about detecting SSR input versus a mount tree.
- **P2 equal → clean.** With the same value and structure at an admitted slot,
  the claim performs 0 claim-period DOM mutations and keeps node identity. This
  is parity evidence and may count toward the TSX-18 clean sub-obligation; it
  does not by itself fill the TSX-18 row.
- **P3 unequal value → permitted write, non-clean.** A different text
  `nodeValue`, attribute string/presence or boolean value is **not** structural
  mismatch. The claim computes the expected value from the same lowered record
  and compare-writes at the first write; that write is allowed and the result is
  recorded as **non-clean**. It must not be reported as 0-mutation, equal-seed
  or TSX-18 parity. Rejection is not a requirement of TSX-18 or of this record,
  so there is no strict/default-refusal mode.
- **P4 structural mismatch → fail closed.** Missing/extra/duplicate/unordered
  key markers, a missing/extra/wrong static attribute seed, a branch-shape
  difference and an unsupported key still fail before subscription
  (`OEIR_LEAF_CLAIM_MISMATCH` / `OEIR_LEAF_UNSUPPORTED_KEY`); borrowed DOM is
  not deleted.
- **P5 input.** A successful claim preserves pre-activation user input, focus
  and selection. The real void `<input>` SSR→claim vertical is owned by the
  input lane and is not claimed by this list slice.

"Non-clean" is an evidence classification, not a runtime mode. This definition
introduces no `seed: 'permitted'` option, no wire seed, no JSON state and no
per-row resource gate.

## 5. SSR producer and the entry composition boundary

The list is claimable only when it is not inside a template, its parser context
is flow, and every entry-template child is a previously admitted shape (text, a
dynamic-text pair, an element or a fragment). In that shape SSR emits the
anchor, one key marker per item and the list end, evaluating the items
expression once and each key once per item. It throws before returning a string
if a key is unsupported; it never returns a half string.

Composition inside an entry stays **mount-only** in this slice, with no module
diagnostic: a nested condition, nested list, component reference, insertion
site, children projection or `property` channel inside an entry template keeps
the whole component mount-only. A list inside a reusable-JSX element recipe is
also kept mount-only by the `treeHasList` gate until it has a real
browser/consumer test of its own. A list under a restricted parser context
(e.g. `textarea`) is refused the same way: no unreadable wire, no partial
producer. The actual M08 target is the authored S2 Board with the condition as
a **sibling** of the list; an entry-internal condition is not required and is
not claimed.

## 6. Parsed DOM, not byte integrity

The claim checks the **parsed** tree at fixed positions. A marker removed or
altered in a way the parser preserves fails closed at its checked position.
An EOF truncation the HTML parser repairs into the same legal comment node —
for example `<!--oe:/each` at EOF, which the parser synthesises as the same
comment — is structurally indistinguishable from the producer's DOM and is
**not detectable here**. Raw-byte/transport completeness belongs to the
HTTP/build boundary. This slice adds no document/root sentinel, expands no
marker vocabulary and makes no claim about truncation of the original bytes.
That is the B3 review decision: a limitation recorded, not a sentinel added.

## 7. Explicit boundaries

Not claimed by this slice:

- an M08 exit; full M08-2 SSR→claim parity (the list is one shape; composition
  and component-reference SSR are absent);
- M08-3 per-phase equivalence, M08-4 claim negatives, M08-5 matrix rows,
  TSX-18 and TSX-30 (the rows stay `R`);
- Firefox/WebKit/M13 qualification, a packed consumer, production wiring, a
  public ABI or a release;
- entry-internal conditions/lists/composition, component-reference SSR,
  insertion-site SSR, children-projection SSR, `property` and void channels;
- a request-scoped props/bindings lifecycle;
- update-period zero-mutation acceptance, mismatch recovery and reseeding.

## 8. Evidence

Focused (LOCAL, Node v24.18.0):

- `packages/compiler/__tests__/semantic-ir/generated-leaf.claim-list.test.ts`
  — 15/15 (wire, SSR bytes, canonical kinds, duplicate multiplicity, mapper
  shadowing, unsupported-key refusal, source-map placements, mount-only
  boundaries);
- `packages/element/__tests__/compiled-runtime/list-key.test.ts` — 41/41
  (token alphabet, canonical predicate, `-0`/non-finite rejection, injection
  characters, unsupported identity, `===` identity agreement);
- `packages/element/__tests__/compiled-runtime/list-wire.test.ts` — 14/14
  (marker families, one-position checks, seed predicate S1–S3).

Real Chromium `147.0.7727.15` (LOCAL):

- `packages/compiler/__tests__/semantic-ir/generated-leaf.claim-list.browser.test.ts`
  — 10/10: equal seed is 0-mutation; reorder/update/insert/delete keep entry
  identity; same-key replacement; duplicate client key adopts once and inserts
  the rest; shared-cursor structure verifies before the activation queue opens
  anything; wire-more/duplicate-wire/`u` mismatches leave borrowed DOM and open
  nothing; mount-tree and re-claim duplicate paths; cross-key occurrence order;
  unsupported post-claim update fails closed before mutation and recovers;
  unkeyed positional and entry static-directory round trips.

Full projects at the same head: `@openelement/compiler` 52 files / 892 tests,
`@openelement/element` 117 files / 871 tests. The queue/condition consolidation
is the merged baseline `431f1df59`; the list work is a separate commit so a
future review can revert it without reverting the queue fix.

## 9. Review closure

- **B1 (duplicate/unsupported claimed updates).** Multiplicity is allowed per
  the rules above; every occurrence is a distinct identity; SSR emits one
  marker per item; a claimed update preflights keys and never writes `u`.
- **B2 (mapper parameter named `props`).** `declareReads`, `dependencyNames`
  and `readsEntryLocal` check the entry shadow (name and binding) before the
  component-props branch, so a legal `items.map((props) => …)` is entry-local
  and is not classified as a host/props dependency.
- **B3 (EOF truncation).** Recorded as the parsed-DOM limitation above; no
  sentinel was added.

See [the progress ledger](./alpha16-18-progress.md) and
[the semantic test matrix](./alpha16-18-semantic-test-matrix.md) for the
milestone status this record does not change.
