# ADR-0174: Generated code, shared runtime and compatibility

- Status: ACCEPTED (2026-10-31, architectural direction; implementation pending)
- Amends: ADR-0143, ADR-0148 and principle P2
- Related: ADR-0158, ADR-0159, ADR-0171, ADR-0173

## Decision and current state

Generate browser mount, claim, update and dispose code, rather than shipping a
generic Part opcode execution loop. Keep one execution foundation for functions
and compatible classes, one Signals engine and one owner per DOM region. This
accepts a direction, not implementation evidence: new codegen, size attribution,
component slices and release qualification are **NOT RUN**. Existing Part Program
behavior remains current until qualified replacement. No ABI, helper signature,
wire encoding or package metadata format is frozen by this document.

## Three contracts, not one executable artifact

1. **Compile-time semantic/structural IR** supports analysis, lowering and
   generation. Do not deliver it as a generic browser-interpreted program.
   Servers may retain suitable serialization IR; no full server rewrite is
   required merely for symmetry.
2. **Generated-module ABI** defines calls, capabilities and compatibility between
   generated modules and shared helpers. Executable code need not pretend to be
   serializable data.
3. **HTML/claim/stream wire** carries location markers, permitted seed data,
   resources and deployment identity. It does not serialize arbitrary closures,
   functions, DOM nodes or complete Signals graphs.

Static templates, location markers, necessary data structures and shared
helpers are permitted. The prohibition targets generic interpretation, not all
data. There is no VNode tree or runtime JSX fallback. Unsupported structures
fail with source-located diagnostics rather than invoking another renderer.

The bundler-neutral semantic core owns author semantics, lowering, identity and
diagnostics. It must not import Vite/Rollup, routing/SSG/deployment, ambient
network/time or mutable global build state. Integration owns resolution, module
graphs, scheduling, caching, HMR, resources, bundling and map composition, not
language semantics. Public compiler packaging remains as recorded in the
2026-10-11 ADR-0148 addendum.

## Necessary runtime, cost and ownership

Identity, regions, Signals, events, cleanup, CE adaptation and bounded recovery
may use shared helpers. Each has one owner, behavior tests, byte attribution
and a retirement condition when no longer needed. P2 becomes build-time first,
with minimal justified runtime, not an impossible claim that no runtime exists.
Measure generated code plus helpers in the full reachable page closure;
relocating bytes must not manufacture a gain. Existing runtime, reference island
and home budgets remain. Codegen is not inherently smaller or faster.

Component update, navigation morph and stream installation cannot concurrently
write the same region. Register actual implementation seams and consumer-form
tests when they land; this decision does not invent a second metadata registry.
Preserve claim fidelity, form input, focus/selection, pre-activation events,
styles, refs, diagnostics, cleanup and bounded recovery through replacement.
The old generic client executor retires only with coverage and qualification;
Alpha16 release requires graph evidence that it is unreachable. Author-class
migration follows ADR-0173 separately.

## Compatibility and independent distribution

Reject incompatible generated ABI and mixed artifacts early with actionable
package/component, expected/actual capability and source diagnostics. ABI
compatibility and deployment build identity are separate checks. Rollback must
match server and client, not replace one side alone.

Start distribution qualification with library-side precompilation: generated
server/client entries, real declarations, relocatable CSS/resources and minimal
metadata consumed from a tarball by a fresh application without monorepo aliases
or library TSX. The application selects entries, links resources and bundles;
the initial supported mode is one validated mode, not arbitrary dependency TSX
recompilation. Check missing entries, server code in client graphs, prop/Children
type errors, missing/duplicated CSS, ABI mismatch, absent sources and build skew.
Two physical runtime/Signals copies crossing ownership boundaries must resolve
to one instance or reject clearly; equal versions do not prove singleton identity.

The distribution schema/version ranges remain unselected. A later consumer-backed
contract must freeze their actual format; this record only accepts requirements.
Internal module consumption and explicit CE exports need distinct proof, including
ordinary HTML/foreign-framework properties/events/slots/forms/SSR/claim for CE.

## Safety and streaming preservation

Publish allowlists, content/serialization safety and request isolation are
independent proofs (ADR-0171). Keep existing route/field streaming regression
coverage under ADR-0158/0159. Their current admission, HTTP commitment, nonce,
typed seeds, ownership, cancellation and bounded recovery are not broadened by
this backend change. Identity/marker/installer changes require migration and
rejection fixtures. Component defer remains separate Alpha18 qualification;
material wire changes require a successor decision before rollout.

## Verification before expansion or freeze

Retain the stateful list, SSR/claim/failure and independent tarball slices from
ADR-0173. Validate exception-safe cleanup and initial byte attribution before
large executor replacement; validate related identity/owner/region structures
before expansion and stable ABI; validate public types, author examples and
consumers before API freeze/default-starter recommendation. Independent output
safety, server-only work and validated leaves need not wait for every slice.

Run old Part/Block behavior, mixed classes/functions, SSR/create/claim, styles,
refs/events/pre-activation and mismatch matrices. Prove compiler/Vite/server-only
code and retired executor are absent from browser graphs; use real packed
consumers and Chromium/Firefox/WebKit. Record full JS/CSS closure measurements,
including helper and duplicated generated code costs. Failed evidence blocks
its dependent expansion, not unrelated work. Do not weaken state, cleanup or
native guarantees to make a test green.
