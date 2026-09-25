# ADR-0159: Out-of-order Part backfill and late claim

- Status: ACCEPTED (2026-09-25, owner ruling — approved for the alpha5 lane)
- Tracking: #1445, #1448, #1449, #1451
- Depends on: ADR-0158; preserves ADR-0143, ADR-0129, and ADR-0155

## Wire identity and ownership

Every streamed full-document GET receives a request-unique, unpredictable
document token. Every compiled element occurrence in that document has a
unique instance identity and an exact owning root (light DOM or open DSD).
The stream's identity tuple is **document token + program identity/version +
instance identity + Part index**. `oe:pN` alone is only an index within one
instance's program, not a page-global key. The generated, route-specific
manifest in ADR-0158 authorizes exactly which tuples can be pending and
which loader field supplies each. A frame includes the tuple, one terminal
outcome (`content` or `error`), the compiled field's typed settled value
(for content), and the owned Part-range HTML. The server assigns instance
identities before flush; a duplicate or ambiguous instance/Part is a
protocol error.

For the streaming shell only, a deferred **text** Part gets a closing
`<!--oe:/pN-->` anchor as well as its existing `<!--oe:pN-->` start.
Regions already have both markers. The empty range holds only a
framework-owned inert pending placeholder; no promised value or compiled
default is serialized as if resolved. The normal serializer and static output
retain their existing text-anchor shape, byte for byte. Anchors and
instance/root identities are located by the compiler-owned path/manifest,
never by a document-wide search for a matching `oe:pN` comment.

The shell also carries inert, JSON-safe typed seed data keyed by document,
program, instance, and property name: a tagged `resolved` value for each
front-gate property, or a tagged `pending` state with the compiled property
type for each deferred property. Pending Part indices are separately keyed
by the full tuple. Seed values are JSON-serializable according to compiled
metadata;
invalid, cyclic, or unrepresentable values fail before commitment. `null`,
missing, and pending are distinct; neither a Promise nor an untyped string
is assigned to a host property. Claim consumes the seed **before** facade
connection and Part reconciliation, restores resolved properties to their
signals without attribute reflection, and treats pending ranges as pending
instead of comparing them to compiled defaults. Pending Parts do not
subscribe as resolved content or generate a false mismatch. On a valid
terminal frame, the installer records the typed property value once per
field/instance and clears pending for that Part, then reconciles only its
authorized Part/Region. If one field owns multiple Parts, their frames must
carry the same settled typed value; a differing frame is a protocol conflict
and leaves the remaining Parts pending. Seeds and frames must agree on type
and owner; a mismatched value is rejected, not coerced by an HTML attribute.
The field-to-property identity and nonreflecting restriction are the
admission rule of ADR-0158.

Frames may arrive in either order across independent Parts. The first valid
terminal frame for a tuple wins; an identical duplicate is ignored and a
conflicting duplicate is diagnosed and ignored. Unknown Part, missing or
ambiguous anchors, wrong request/program/version/instance, unauthorized sink,
unsafe markup, bad typed value, or retired navigation owner rejects a frame
without touching the DOM. The installer replaces only nodes between the
owned anchors, never an entire document or a neighboring element's range.

## Inert transport, escaping, and no-JS tail

The shell and each backfill are well-formed HTML. Only the document's
`body`/`html` wrappers remain open until the final suffix; no Part, element
attribute, template, or shadow root remains half-open for a later frame.
The transport uses inert `<template>` frames with
framework-generated identity attributes and a nonce-bearing, framework-owned
installer/bootstrap; values are never concatenated into executable source or
unescaped attributes. Identity and seed payloads have canonical encoding and
strict size/shape validation. JSON embedded in HTML escapes `<`, `>`, `&`,
U+2028/U+2029 and script/template terminators. Text Parts use the compiled
serializer's text escaping; Region markup uses its normal element/attribute
escaping. Author-controlled raw HTML, inline event handlers, scripts, and
untrusted `html` sinks are **not** admitted into deferred ranges. A future
trusted-HTML extension requires a separate capability and conformance proof,
not a fallback to string injection. The installer validates the tuple and
manifest before parsing/inserting any owned range; data templates themselves
do not execute. Only framework-owned executable scripts receive the request
CSP nonce; no user data crosses that script boundary.

The response cannot know whether JavaScript is enabled. After the shell,
each settled Part therefore emits a functional **no-JS tail** in a
`<noscript>` block in arrival order, alongside its inert frame. With JS
enabled the tail is inactive and the installer installs content at its
anchor; with JS disabled the visible tail has ordinary links and forms,
possibly later on the page than their pending placeholders. A terminal
error yields readable, non-sensitive no-JS error content. The pending shell
must not present an action as complete. Exact in-place no-JS ordering is
not promised: such routes must stay non-streaming or make the field
front-gate. Native form POST still uses the existing non-streaming action
path; an enhanced submission during a stream is neither replayed nor made
idempotent by this protocol.

## Failure and claim interleavings

Before commitment, redirect, auth, not-found, error, and headers follow
the normal HTTP path. After commitment, a failed deferred Part emits one
terminal error frame with safe error-boundary content if the boundary can
render without the failed value or new response metadata. Otherwise it
emits a generic safe failure and ends the stream; no successful later value
can overwrite the error. A fatal failure may terminate the stream, leaving
other pending Parts visibly degraded, but it cannot rewrite HTTP status.
ADR-0129 late header writes are no-ops with diagnostics, not Part failures;
a late `redirect()` or status signal is a Part protocol failure. Recovery
means a new request with a new document token, never an implicit retry frame.

If a frame arrives before claim, the installer replaces just its pending
range and records the typed settled seed; claim adopts those nodes in place.
If claim has already bound a pending range, the installer coordinates with
that instance: dispose only that range's subscriptions/listeners, install
the typed signal value and range content, and claim its new nodes. When
adoption cannot be proved, rebuild only the owning Part/Region and issue
a structured diagnostic with tuple, reason, and rebuilt node count. The
worst-case cost is proportional to that bounded range (and its nested
custom elements), not the document or unrelated siblings. Preserve live
form state, focus/selection, nested custom-element identity, and unrelated
subscriptions wherever they are outside the replaced range; inside it,
preserve state on adoption and test/document the bounded rebuild loss.
No generic hydration walker, duplicate shadow root, or whole-document
fallback is authorized.

## Navigation ownership and scope

The full-document GET is the baseline. An enhanced router GET does **not**
consume streamed frames under this proposal; adding that transport requires
its own explicit admission, response and installer contract. For a live
streamed document, the client Router's ticket may invalidate its reader and
pending frames only when a newer navigation **owns** intent (guards passed,
latest ticket still held), at the existing #1343 ownership point. A guard
veto, stale or aborted traversal, duplicate landing, hash-only change, or
navigation attempt that does not take ownership leaves the current stream
alive. A real full-document unload also retires that document's token; old
results cannot be applied to the next document. A POST may supersede the
stream only when its navigation actually takes ownership, not merely when
the user begins an enhanced submission.

Backfill never creates history entries or repeats scroll/focus restoration.
Restoration happens at the owning navigation point; a focused pending range
uses bounded focus restoration when replaced. BFCache `pageshow` resumes
the saved DOM/claim state without replaying terminal frames. A new
network request gets a fresh token and cannot accept BFCache-era frames.

## Route and interleaving matrix

| Request/state                               | Browser behavior                                        | HTTP/claim invariant                                               |
| ------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| Static or dynamic GET without stream opt-in | Existing HTML/claim                                     | No end anchor for text, seed, frames, or no-JS tail                |
| Opted-in full-document GET, JS on           | Pending shell then out-of-order inert frames            | Final headers/status before shell; one tuple, one terminal outcome |
| Opted-in full-document GET, JS off          | Pending shell then visible arrival-order no-JS tail     | Links/forms usable; exact placement not guaranteed                 |
| Frame before claim                          | Replace owned range, record typed settled seed          | Claim adopts installed DOM without default-value drift             |
| Frame after claim                           | Local disposal, replacement/adoption or bounded rebuild | No unrelated Part or whole-document replacement                    |
| Deferred error after shell                  | Safe terminal error or fatal stream end                 | No changed status/cookie, no later success overwrite               |
| Vetoed navigation or hash-only change       | Keep reader and current token                           | Ownership not transferred                                          |
| Owned new navigation/full unload            | Cancel/retire old reader and token                      | Stale frame ignored; new request uses new token                    |
| Enhanced GET or action POST                 | Existing non-streaming behavior                         | No implicit streamed-fragment consumer or changed action semantics |

## Codegen and protocol fixture checklist

- Pin byte-parity for static/non-streaming output; streamed text end anchors
  only, Region anchors unchanged, unique nested instance identities and
  source-program version binding.
- Pin route-field manifest/tuple encoding, typed resolved/pending seeds
  (`null` versus missing versus pending), nonreflecting property restoration,
  typed resolution after/before claim, and computed/shell rejection.
- Pin fast/slow reversed arrivals, duplicate/conflicting duplicate,
  missing/ambiguous anchor, wrong request/program/version/instance/Part,
  unauthorized sink, invalid type, error-then-content, and cancellation
  after resolution; rejected frames make zero DOM mutations.
- Pin nonce/CSP, adversarial text and attributes, script/template
  terminators, unsafe HTML/event/script rejection, and JavaScript-disabled
  no-JS forms/errors for both light DOM and open DSD.
- Pin nested custom elements, form state, focus/selection, scroll, BFCache,
  frame-before/after-claim adoption, forced bounded rebuild and its measured
  cost, abort/slow reader, and owning versus vetoed/stale navigation.
- Pin generated GET/POST behavior against ADR-0158's route matrix on the
  same handler. Freeze HTML/frame encoding in a wire fixture before calling
  an implementation conformant; no new public wire shape is implied for
  non-streaming responses.
