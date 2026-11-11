---
status: active
topic: M07-5 protocol record
summary: Leaf-range protocol for D-2 marker suppression and the three generated-leaf surfaces; in progress, not an M07 exit.
---

# M07-5 protocol record

Status: **in progress, not signed off**. This is the M07 protocol record. It is
not an M07 exit, not whole-stage Alpha16 sign-off, not a publish
authorization, and not an alignment of the published baseline
`1.0.0-alpha.15`. It does not start M08, P0, or Alpha17.

M07-4 (ADR-0175 D-1, bounded mismatch recovery) is signed off on
`c4bff6dfc7efbdf2d5ad65442b82f1ccd4b3bb20`. This note records that sign-off.
It does not re-qualify M07-4, and it does not transfer M07-2, M07-1, or any
earlier author LOCAL.

The marker/seed private contract stays OPEN. This record does not approve it
as a public contract. There is no generated-leaf SSR producer and no
permitted seed-state compare. SSR→claim is not done. TSX-18 and TSX-30 stay
unfilled; a leaf-range note under those rows is not a pass. Qualification of
the fixtures for this slice is 非浏览器资格 (Node DOM shim, LOCAL). It is not
browser qualification. Firefox and WebKit remain M13. Skip / NOT RUN is not a
pass. CI green is not this slice's qualification.

## D-2 marker suppression

ADR-0175 D-2 is already ACCEPTED. The generator emits an `oe:r:` / `oe:/r:`
pair only when it emits a claim function for that component. A pure-mount
tree — a condition, a list, a property channel, or any other shape whose
claim is omitted — does not carry those comments in the generated source or
in the DOM after mount. `childNodes` and `innerHTML` do not gain the pair
because of this suppression. `children` and `textContent` stay the element
and text contract; this suppression does not rewrite them into another
contract.

When a claim function is emitted, the pair still appears under the existing
directory / generated-leaf convention: mount projection nodes include the
marker comments, and claim projection nodes are the range interiors. An
already-signed claimable fixture does not become markerless.

## Static attribute seed

A generated-leaf claim checks static attributes as an ordered exact set, the
same rule the directory uses in `sameAttributes`. Extra attributes, missing
attributes, and a different order fail. The failure window does not write.
Dynamic slot names are not part of that static seed: their values are claim
writes after validation, and a mount-produced value may already be present.
On a fully static element the dynamic-name skip set is empty, so the check
is the directory rule. The directory consumer is not loosened, and its exact
set-and-order regression stays on `OE_RUNTIME_STATIC_RANGE_MISMATCH`.

## Mismatch identity

A generated-leaf structural mismatch throws `OpenElementError`. The code
value is `OEIR_LEAF_CLAIM_MISMATCH`
(`RuntimeErrorCode.LEAF_CLAIM_MISMATCH`). It is not a bare `Error`. It is
not folded into `OE_RUNTIME_STATIC_RANGE_MISMATCH`. The directory keeps that
code and its existing case labels (`boundary`, `ordinal`, `order`,
`static-seed`, `consumed`, `busy`, `parent`). Validation that fails still
does not write.

The new catalogue member is an additive candidate for the internal Alpha16a
chain. It does not freeze the public ABI and it is not releasable.

## HTML namespace

A generated-leaf claim requires `namespaceURI === "http://www.w3.org/1999/xhtml"`
on the claim parent, on each element ancestor, and on each claimed element.
`null` and every other namespace are refused. The failure window does not
write. Comments and text nodes are not element namespace checks. A
directory-root claim still reports a non-HTML parent through the directory
consumer as `OE_RUNTIME_STATIC_RANGE_MISMATCH`. That directory check is not
loosened.

## What this record does not do

Signed D-1 stays: a fully successful directory claim remains permanently
committed, borrowed nodes are not deleted, and this is not a byte-level
restore of a whole claim. The signed M07-2 product contract stays: an equal
claim-path write is skipped, mount writes stay unconditional, skipping a
write does not skip the subscription, and an update-period zero mutation is
not an acceptance. TSX-18 and TSX-30 are not marked passing.
