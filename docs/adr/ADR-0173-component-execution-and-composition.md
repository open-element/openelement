# ADR-0173: Component execution and composition

- Status: ACCEPTED (2026-10-31, architectural direction; implementation pending)
- Amends: ADR-0143; principles P1 and P5
- Related: ADR-0148, ADR-0157, ADR-0174

## Decision and evidence boundary

Choose function JSX with the existing Signals model for internal composition,
including private state and subscriptions without an extra DOM host. Custom
Elements remain the explicit native export and initial island activation
boundary. This is an accepted design, not shipped capability: implementation
slices, browser qualification and packed consumers are **NOT RUN** for this
model. Candidate API spellings, types and ABI are not frozen.

A client instance runs synchronous setup once. Dependencies subsequently update
bindings and structures, not repeated render snapshots. SSR and client claim
initialize separately. Signals retain explicit `.value`; computed values express
derivation, and ordinary locals/destructuring retain JavaScript semantics.
No React Hooks compatibility, hook-order slots, dependency arrays, React
scheduler, VDOM or second state engine is introduced.

Internal components may have multiple roots or empty output. Their logical
instance and owned DOM region are distinct from platform element identity.
The framework owns resource scopes, idempotent disposal and error containment;
one cleanup failure must not prevent remaining cleanups. Children retain their
creation-site lexical dependencies and source locations, with one active
cleanup owner. The initial fragment contract is single insertion, not arbitrary
cloning or transfer between roots.

## Connection and identity

`component(...)` and `onConnect` are unreleased candidate names, not public
imports promised by this record. `onConnect` denotes DOM/refs-ready connected
lifetime: no SSR invocation; an optional returned cleanup releases that
connection's resources; disconnect releases them and reconnect may invoke the
callback again without repeating setup. A logical subscription must not have
duplicate active registrations. Owner and CE/island boundaries coordinate
hostless connection state internally. This is not visibility, a post-update
layout effect, or a global change to existing effect timing.

| Situation | Required instance/resource behavior |
| --- | --- |
| CSS hidden but mounted | Keep instance and subscriptions; no automatic disconnect cleanup |
| Inactive condition | Create neither instance nor active subscriptions |
| Condition exits | Dispose subtree and resources |
| Condition re-enters | New instance and initial state; no implicit keep-alive |
| Same owner/key/type moves | Preserve framework instance/state; qualify input and focus behavior |
| Key/type changes | Clean replacement, not accidental state reuse |

Claim must not accidentally repeat client setup or retain duplicate active
subscriptions. Local mismatch rebuilding cleans old resources first and has
bounded, diagnosed state loss. Moving third-party CEs does not promise zero
platform callbacks or transactional DOM rollback.

## Native interoperability and migration

Explicit CE exports own native properties/events, slots, Shadow DOM, reflection,
form association and cross-framework consumption. Existing Lit compatibility
remains independently qualified; new Native features do not imply Lit parity.
Server-only functions may be async, but closures, DOM nodes and complete Signals
graphs do not become serialized state. This remains hydration, not resumability.

Existing classes remain temporarily supported through one adaptation boundary,
sharing the generated backend, Signals, scopes, resources and errors with new
functions (ADR-0174). This explicitly amends P5's deployment-only compatibility
rule: author compatibility is a bounded migration exception, not a parallel
renderer. Retire it only after required capability coverage, real consumer
migration and release qualification; no fixed deletion version or forced
immediate rewrite is set. Client executor retirement and author-class retirement
are separate decisions.

## Alternatives, costs and qualification

Making every internal unit a CE reuses platform identity but adds hosts,
registration and mappings to ordinary composition; it is not the sole model.
CE already needs scopes for internal conditions/lists/tasks, so that existing
cost must not all be charged as a new hostless cost. Function/class dual
backends and Hooks compatibility are rejected. The chosen model pays for
logical identity, region ownership, reactive props, Children and CE adaptation.

Solid's setup/tracking, cleanup ownership and identity are useful prior art,
not compatibility targets. Solid onMount is once after initial client render,
nontracking and not physical connection; its return does not register cleanup.
Its onCleanup follows reactive owner disposal/refresh. Item-value identity in
For is not OE's explicit key; its signal tuple is not OE `.value`.

Qualification must retain three connected implementation slices: a stateful
hostless list (drafts, reorder/delete/conditions, multiple/empty roots); the same
list through SSR/claim/update/dispose with mismatch and cleanup failures; and
precompiled components installed as a tarball in a fresh application. Validate
source locations, props/Children types, class/function mixing, CE reconnect,
input/focus, three engines and independent native consumers. Success keeps and
extends the slices, not a throwaway research renderer.

Failures first require implementation fixes, then narrower supported structures.
Do not delete private state, shift cleanup to authors or weaken required native
capabilities to claim success. Freeze public APIs/default starters only after
author and consumer evidence. Structural evidence may reopen the architecture;
ordinary local failures do not automatically revoke it or invite endless retries.

## References

- [ADR-0143](./ADR-0143-0-44-compiled-element-model-reentry.md)
- [ADR-0174](./ADR-0174-generated-code-runtime-and-compatibility.md)
- [Solid components](https://docs.solidjs.com/concepts/components/basics)
- [Solid onMount](https://docs.solidjs.com/reference/lifecycle/on-mount)
- [Solid onCleanup](https://docs.solidjs.com/reference/lifecycle/on-cleanup)
