# M07b static sibling ranges

Status: private reviewed scope for this branch. Not a public ABI, not an SSR
producer, and not the M07 exit. PR #1745 stays at its own head; this document
does not move that branch.

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
nodes. A different parent element is a different identity.
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
directory parent, an ancestor, and any descendant inside a range. An element
whose namespace is not the HTML namespace is refused whatever its local name
is. The fixture DOM does not parse HTML. A passing shim is not browser proof.

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
input, focus, selection, bounded recovery, an SSR producer, mount emission of
these markers, production wiring, and a public ABI freeze remain M07/M08 work.
The same-list path SSR → claim → update → dispose is still required. These
fixtures do not fill TSX-18 or TSX-30.
