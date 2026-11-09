# M07b static sibling ranges

Status: scope accepted in workboard §13 (technical plan only); implementation
not independently reviewed at this head. Not a public ABI, not an SSR producer,
and not the M07 exit. The directory consumer is the bounded M07b slice; the
fixed-head QA record is its acceptance evidence.

The base is `146d838573d130e07bbe9b4eebe86efacb43fe9d`. M07a behavior stays:
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

Claims proceed in order. A failure does not advance. A success advances
permanently, including after `dispose`. Reclaiming a committed ordinal fails.
A failed attempt may be retried only while it is uncommitted and only after
its cleanup; the caller calls the same API again. That is not bounded recovery.

## Reservation

`claimStaticSiblingRange` takes an exclusive reservation before it reads the
DOM and before it calls `activate`. The reservation, the next ordinal, and
the committed start and end comments belong to the parent element. A second
`openStaticSiblingDirectory` on that parent is another view of the same pair
identity. Only the holder releases an uncommitted reservation. A reentered
claim, including one made through the other view or by a previously held
marker, fails `busy` and does not clear the holder's reservation. Opening
again while the reservation is held also fails `busy`. After `dispose`, a
later open of the same parent still rejects that ordinal and those marker
nodes. A different parent element is a different identity. That identity is
not a global marker lock. Moving a committed start or end comment onto
another parent and claiming it there is outside this slice.
`openStaticSiblingDirectory` has no caller callback. The activation callback
and a DOM getter are the reentry cases the fixture covers. There is no
further dynamic-host reentry suite.

A validation mismatch creates no owner and writes nothing. An activation
failure disposes the uncommitted scope with `dispose(false)`: resources are
released, borrowed nodes stay, and a dynamic write that already happened may
stay. `dispose` does not erase the pair tombstone. `LifetimeScope`
first-dispose semantics are unchanged. A parent `dispose(true)` cascades only
to children that are still live.

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
input, focus, selection, bounded recovery, an SSR producer, production
wiring, and a public ABI freeze remain M07/M08 work. Mount emission for a
pure static directory is the bounded generator section below.
A global marker lock is not part of this slice. A committed node moved to a
different parent is outside the supported domain. Different parents stay
different identities.
The same-list path SSR → claim → update → dispose is still required. These
fixtures do not fill TSX-18 or TSX-30.

## Open items for the M07 private contract

Recorded here, not decided by this slice; the M07 protocol record (M07-5) owns
them:

- **Attribute-seed strictness**: this slice compares parsed attributes as an
  ordered, exact set (`sameAttributes`), which is stricter than "parsed DOM
  values" and differs from the M07a leaf claim's lenient declared-attribute
  compare. The contract must choose exact-set (order-insensitive) or state the
  order requirement explicitly.
- **Mismatch diagnostic identity**: this slice throws the catalogued
  `OE_RUNTIME_STATIC_RANGE_MISMATCH`; the generated leaf claim throws a bare
  `Error` carrying `OEIR_LEAF_CLAIM_MISMATCH`. One M07 chain must not ship two
  incompatible mismatch surfaces.
- **Namespace checks**: this slice requires the HTML namespace on the parent,
  its ancestors and in-range elements; the M07a claim walk is namespace-agnostic.
- **Mount/claim node-set asymmetry**: the bounded generator extension emits the
  markers, so the asymmetry is now an explicit internal contract in that
  section (mount projection nodes include the marker comments; claim projection
  nodes are the range interiors only). The M07 protocol record (M07-5) still
  owns the general contract for a directory that admits a dynamic slot.

## M07b generator extension

This is a bounded generator extension inside M07b, not a new slice or
milestone. The head branch ref `cursor/m07c-generator-mount-claim-21d0` is a
slice name only; M07c and M07d remain unapproved labels (workboard §3, §13.5,
§14.2).

PR #1749 carries two commits — the generator change with its tests, and this
document. They were authored on the accepted M07b head
`197f243260447c48728785110f53e82260fbc4a9` and are rebased onto current `main`
after #1747's squash merge. For a parent whose flattened children are two or
more fully static elements, mount emits the paired markers and the generated
claim calls `openStaticSiblingDirectory` and `claimStaticSiblingRange`.
Expected ordinals are generator literals. The fixed-head QA record on this head
is the implementation acceptance evidence for the extension.

**D5 is closed by this extension.** §13.2 recorded "Mount markers | Left open
as D5". Mount now emits the paired `oe:r:` markers for a parent whose flattened
children are two or more fully static elements, claim consumes them through the
§13 directory consumer, and the Owner accepted the bounded extension on
2026-11-09 (workboard §14.2). This is not the M07c design (key, dynamic
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

`claimRecipe` records one owner and one region before it calls the generated
claim, then `dispose(false)`s that owner when the claim throws. `runtimeProbe`
owners and regions only increment. The +1 after a failed generated claim is an
observation of that allocation. It is not a live owner and it is not a live
region. On a first-range validation failure the consumer creates no range owner
and registers no cleanup; on a mid-directory partial commit an earlier range
keeps its owner and cleanup (see the known limitation below). A direct
`claimStaticSiblingRange` validation failure still creates no owner for that
failed range. Static zero subscriptions remain not a dynamic subscription
account.

### Known limitation: no recovery after a mid-directory partial commit

Bounded recovery is M07-4 work, outside this slice. This slice claims ranges in
order and does not batch-reserve. If range 0 commits and range 1 fails
validation, the claim throws, the range-0 success tombstone remains, and a
retry fails with `consumed:`. That directory is permanently unclaimable until
the parent is replaced. A retry is not possible after a mid-directory partial
commit. Only a first-range validation failure leaves the directory retryable
after cleanup.
