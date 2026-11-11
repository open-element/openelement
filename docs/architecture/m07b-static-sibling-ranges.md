---
status: active
topic: M07b static sibling ranges
summary: The paired-marker static sibling-range directory and the bounded M07b generator extension; not a public ABI and not the M07 exit.
---

# M07b static sibling ranges

Status: scope accepted in the retired M07 workboard §13 (Git history, 2026-11-10;
technical plan only); fixed-head QA
passed at `4feffef00` (#1747) and at `d7a4db434` (bounded generator extension,
#1749). Not a public ABI, not an SSR producer, and not the M07 exit.

The slice was authored on the M07a acceptance head `146d8385` (squash
`0a97602c4`) and retargeted onto `main` after #1747's squash (`0df1621a5`); the
QA-accepted #1747 head was `4feffef00`. M07a behavior stays:
a missing generated claim is `OE_RUNTIME_LEAF_CLAIM_UNAVAILABLE`; validation
writes nothing; activation may keep an earlier dynamic write;
`dispose(false)` does not upgrade to `dispose(true)`.

## Directory

One HTML element parent. Its child list is exactly the ranges `0..N-1`. Each
range is the comment `oe:r:<ordinal>`, its interior, and the comment
`oe:/r:<ordinal>`. Ordinals are canonical decimals: `0` or `[1-9][0-9]*`, no
sign, no leading zero, and no value above `Number.MAX_SAFE_INTEGER`. The
parser does not call `parseInt`.

An outside node, a gap, a duplicate, a crossed or nested marker, a missing
end, or a non-canonical ordinal fails closed. Nothing is skipped. `table`,
`select`, `template`, `svg`, and `math` are unsupported as the parent or as an
interior element. Mixed non-range siblings are not part of this slice; they
are the outside-node failure, not a second directory mode. A later slice that
needs them has to declare an unowned prefix or suffix. This slice does not.

The comments and the interior are the owned range. Author element and text
identities are kept. There is no key, build, or version field.

## Caller input

The caller passes the declaration and, on each claim, either the expected
ordinal or a start comment it already holds. The runtime does not choose the
ordinal by searching for equal content. Identical ranges are distinguished by
ordinal and by node identity. Tests hold start, end, and interior references
before the call.

Claims proceed in order. A successful range records a tombstone and advances
the cursor. Those records stay with the attempt until every declared range
has committed. A failure after the reservation is taken rolls that attempt
back: the reservation is released, the tombstones and success cursor
committed in the attempt are cleared, and those ranges' owners are released
with `dispose(false)`. Borrowed nodes stay. A dynamic write that already
happened may stay. This is not a byte-level restore of the claim. The caller
retries by calling the same API again, from the first rolled-back ordinal.

A directory claim that commits every declared range is permanent, including
after `dispose`. Reclaiming that ordinal fails. A failure before a reservation
is taken does not roll the attempt back. Caller `dispose` still does not
clear a tombstone by itself.

## Reservation

`claimStaticSiblingRange` takes an exclusive reservation before it reads the
DOM and before it calls `activate`. The reservation, the next ordinal, and
the committed start and end comments belong to the parent element. A second
`openStaticSiblingDirectory` on that parent is another view of the same pair
identity. Only the holder releases an uncommitted reservation. A reentered
claim, including one made through the other view or by a previously held
marker, fails `busy` and does not clear the holder's reservation. Opening
again while the reservation is held also fails `busy`. After `dispose` of a
completed directory claim, a later open of the same parent still rejects that
ordinal and those marker nodes. After a failed attempt rolls the tombstones
back, the same parent can be claimed again. A different parent element is a
different identity. That identity is
not a global marker lock. Moving a committed start or end comment onto
another parent and claiming it there is outside this slice.
`openStaticSiblingDirectory` has no caller callback. The activation callback
and a DOM getter are the reentry cases the fixture covers. There is no
further dynamic-host reentry suite.

A validation mismatch of the range in hand creates no owner for that range
and writes nothing. An activation failure disposes that uncommitted scope
with `dispose(false)`: resources are released, borrowed nodes stay, and a
dynamic write that already happened may stay. Either failure then rolls back
ranges committed earlier in the same attempt, using the same `dispose(false)`
release. A completed directory claim's tombstone stays across `dispose`.
`LifetimeScope` first-dispose semantics are unchanged. A parent `dispose(true)`
cascades only to children that are still live.

The static subset refuses `table`, `caption`, `colgroup`, `col`, `thead`,
`tbody`, `tfoot`, `tr`, `td`, `th`, `select`, `optgroup`, `option`,
`template`, `svg`, and `math` in any ASCII case. The refusal covers the
directory parent, an ancestor, and any descendant inside a range. The
directory parent, every element ancestor, and every element inside a range
must have `namespaceURI === "http://www.w3.org/1999/xhtml"`. `null` is
refused, as is every other namespace. Comments and text nodes are not element
namespace checks. The fixture's admitted elements use that HTML namespace.
The fixture DOM does not parse HTML. A passing shim is not browser proof.

## Seed and errors

Static seed compares parsed `localName`, attributes, `nodeValue`, node kind,
and order. It does not compare HTML source bytes. Static ranges in the
fixture subscribe to nothing; that number is not a dynamic subscription
account.

Marker and seed failures use one catalogue code,
`OE_RUNTIME_STATIC_RANGE_MISMATCH`. The message carries the case (`boundary`,
`ordinal`, `order`, `static-seed`, `consumed`, `busy`, `parent`). Those cases
do not each get a public code. `LEAF_CLAIM_UNAVAILABLE` stays the missing-claim
code and is not reused here. The public interface snapshot records the new
member because `RuntimeErrorCode` is exported.

## Still outside M07b

Key alignment, dynamic seed, subscription multisets, property channels,
input, focus, selection, byte-level restoration of a claim, an SSR producer,
production wiring, and a public ABI freeze remain M07/M08 work. Mount emission
for a pure static directory is the bounded generator section below.
A global marker lock is not part of this slice. A committed node moved to a
different parent is outside the supported domain. Different parents stay
different identities.
The same-list path SSR → claim → update → dispose is still required. These
fixtures do not fill TSX-18 or TSX-30.

## M07 private contract

The directory behavior in this note is unchanged. The three surfaces that used
to differ from the generated leaf are recorded in
[the M07-5 protocol record](./m07-5-protocol-record.md). That record is in
progress and is not signed off. It is not an M07 exit, not an SSR producer,
and not a public ABI freeze. The marker/seed private contract stays OPEN.

- **Attribute-seed strictness**: this directory still compares parsed
  attributes as an ordered exact set (`sameAttributes`). The generated-leaf
  static seed now uses that same exact set and order. This directory is not
  loosened.
- **Mismatch diagnostic identity**: this directory still throws the catalogued
  `OE_RUNTIME_STATIC_RANGE_MISMATCH` with the existing case labels. The
  generated leaf structural mismatch is a catalogued `OpenElementError` whose
  code value stays `OEIR_LEAF_CLAIM_MISMATCH`. The leaf is not folded into the
  directory code.
- **Namespace checks**: this directory still requires the HTML namespace on
  the parent, its element ancestors, and in-range elements. The generated-leaf
  claim path now requires that namespace too. This directory check is not
  loosened.
- **Mount/claim node-set asymmetry**: for a directory whose component emits a
  claim function, mount projection nodes include the marker comments and claim
  projection nodes are the range interiors only. A pure-mount tree no longer
  emits those markers (ADR-0175 D-2). The general contract for a directory
  that admits a dynamic slot stays outside this note.

## M07b generator extension

This is a bounded generator extension inside M07b, not a new slice or
milestone. The head branch ref `cursor/m07c-generator-mount-claim-21d0` is a
slice name only; M07c and M07d remain unapproved labels (retired workboard
§3, §13.5, §14.2; Git history, 2026-11-10).

PR #1749 carries two commits — the generator change with its tests, and this
document. They were authored on the M07b head
`197f243260447c48728785110f53e82260fbc4a9`, rebased to `4feffef00` for the
fixed-head QA, and rebased onto `main` after #1747's squash merge
(`0df1621a5`). For a parent whose flattened children are two or
more fully static elements, mount emits the paired markers and the generated
claim calls `openStaticSiblingDirectory` and `claimStaticSiblingRange`.
Expected ordinals are generator literals. The fixed-head QA record on this head
is the implementation acceptance evidence for the extension.

**D5 is closed by this extension.** The retired workboard's §13.2 (Git history,
2026-11-10) recorded "Mount markers | Left open
as D5". Mount now emits the paired `oe:r:` markers for a parent whose flattened
children are two or more fully static elements, claim consumes them through the
§13 directory consumer of the retired workboard (Git history, 2026-11-10), and
the Owner accepted the bounded extension on 2026-11-09 (retired workboard
§14.2). This is not the M07c design (key, dynamic
structure, duplicate subscription, cleanup).

**Internal contract: mount/claim node-set asymmetry.** For a directory, mount
projection nodes include the `oe:r:` / `oe:/r:` marker comments; claim
projection nodes are the range interiors only. Mount returns the nodes it
created, so the markers are part of that projection. Claim adopts existing
nodes and returns the interiors the generated code references; the directory
consumer owns the markers. The tests assert both node sets explicitly and must
keep doing so.

The generated `activate` is the empty function `() => {}` on purpose. This
slice has no dynamic binding to run after the reservation. That empty function
is not a complete claim. A later path that admits a dynamic slot into a
directory must pass an `activate` that performs those bindings. Keeping
`() => {}` on that path would present an incomplete claim as complete.

**Known consequence, closed for pure-mount trees by M07-5 (in progress, not
signed off).** ADR-0175 D-2: mount emits `oe:r:` / `oe:/r:` pairs only when a
claim function is emitted for that component. A pure-static directory inside a
condition, a list template, a reusable-JSX recipe that belongs to a component
whose claim is omitted, or any other pure-mount tree no longer carries those
comments. `childNodes` / `innerHTML` do not gain the pair; `children` and
`textContent` stay the element and text contract. A component that does emit
a claim function still mounts the markers, and claim still consumes them.
This is not an SSR producer and not SSR→claim.

`claimRecipe` records one owner and one region before it calls the generated
claim, then `dispose(false)`s that owner when the claim throws. `runtimeProbe`
owners and regions only increment. The +1 after a failed generated claim is an
observation of that allocation. It is not a live owner and it is not a live
region. On a first-range validation failure the consumer creates no range owner
and registers no cleanup. On a mid-directory failure the earlier ranges of that
attempt are rolled back with the directory consumer (see below). A direct
`claimStaticSiblingRange` validation failure still creates no owner for that
failed range. Static zero subscriptions remain not a dynamic subscription
account.

### Bounded recovery after a mid-directory partial commit

M07-4 is signed off on `c4bff6dfc7efbdf2d5ad65442b82f1ccd4b3bb20` (not an M07
exit). It closes the previous
limitation that a mid-directory partial commit was permanent. The directory
still claims ranges in order. It does not batch-reserve up front. If an
earlier range commits and a later range fails validation or activation, the
failed claim releases the reservation, rolls back the tombstones and success
cursor committed in that attempt, and releases those ranges' owners with
`dispose(false)`. The same parent can be claimed again from the start of the
rolled-back attempt. A retry does not fail with `consumed:` solely because of
that partial commit. Borrowed nodes are not deleted. A dynamic write made
during activation is not restored. A directory claim that commits every
declared range stays permanent, including after `dispose`.

Still outside this recovery: byte-level restoration of the whole claim,
deleting borrowed nodes, undoing a fully successful claim, and moving a
committed marker onto another parent. A first-range validation failure is
unchanged: no owner, no DOM write, reservation released, and the same parent
can be claimed again. This recovery is not the M07-5 protocol record, not M08,
and not SSR→claim.
