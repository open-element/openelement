# ADR-0157: Web Component admission tiers (T0-T3)

- Status: ACCEPTED (2026-09-25, owner ruling — approved for the alpha5 lane,
  with alpha-period public-API variability explicitly accepted).
- Tracking: [#1446](https://github.com/open-element/openelement/issues/1446);
  admission harness and Lit-in-stream qualification:
  [#1451](https://github.com/open-element/openelement/issues/1451).
- Preserves: ADR-0143's compiled native claim, ADR-0152's independently
  qualified Lit Framework Mode, and the platform-first interop contract.

## Context

An authored foreign custom-element tag is presently an opaque SSR passthrough:
the generated admission plan records `source: 'foreign'`,
`renderPath: 'client-only'`, while server HTML retains the tag, attributes,
and authored light-DOM children. The owned native/Lit/FAST/Stencil interop
corpus validates CEM shape, this SSR form, and browser upgrade in Chromium,
Firefox, and WebKit. The separate real-library smoke fixture also records
foreign components as client-only. These are T0 observations, not evidence
that foreign shadow roots are server-rendered. The existing CEM
`ssr-capable`/`client-only` classification and `ssr+client` admission names
are not the T0-T3 tiers defined here; a metadata declaration alone does not
prove an adapter or snapshot survived rendering and upgrade.

The first-party Lit renderer uses `@lit-labs/ssr` for explicitly registered
Lit pages/islands and produces DSD. That qualification does not certify an
arbitrary third-party Lit package. Native first-party components serialize
and claim a compiled Part Program (ADR-0143).

## Decision

Admission is **per custom-element tag and resolved package/version/build
configuration**, not a blanket endorsement of a library or a runtime
framework. Report the highest tier that actually passes its tests, with the
server form and client upgrade behavior attached. A tier describes what
OpenElement can prove for that component in that configuration, not an
author-controlled assertion.

| Tier   | Mechanism                                                                                                                                                          | Server output and limit                                                                                      | Admission result                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **T0** | Any valid Custom Element as an opaque leaf island; authored, slot-first light-DOM children born on the server, with author CSS `:not(:defined)` / `:defined` hooks | Host, primitive attributes, and light children; no foreign shadow SSR or framework claim                     | Baseline for WCs without an adapter; browser owns registration, shadow DOM, and lifecycle                               |
| **T1** | Build-time headless DSD snapshot prerender of a version-pinned component                                                                                           | Reusable **structure only**; not request-dependent data, authentication, or a live server component instance | Snapshot must be deterministic, safe to insert, and survive browser upgrade; otherwise T0                               |
| **T2** | Per-runtime SSR adapter (Lit mode exists for explicitly registered first-party Lit today)                                                                          | Adapter-produced DSD/HTML with supported request data, including the streaming route when opted in           | Third-party Lit must pass explicit adapter and upgrade/claim tests; failure **falls back to T0**, not T1 by implication |
| **T3** | First-party native compiled Part Program                                                                                                                           | Server serialization and browser creation/claim of the same program                                          | Only compiled OpenElement components with conformance evidence                                                          |

Higher tiers add a proved capability; they do not change the Custom Elements
platform contract. T0 is the default delivery path for otherwise usable
foreign tags, not an error state. The server-born children must be useful
before definition and remain available to slots after upgrade. Authors can
style the undefined/defined transition with platform selectors; no
framework-wide styling shim or arbitrary property serialization is implied.
An unusable tag, duplicate registration, unsafe server import, or invalid
metadata can still be a build/qualification error rather than an invented
successful T0 result.

### T1 snapshot boundary

The headless pass runs at build time in an isolated, version-pinned browser
environment. It captures the component's stable DSD structure for the
specified props/slots; it must not read request identity, cookies, secrets,
or per-request loader results. On an opted-in streamed route, the snapshot
can be emitted as static structure, while request data still streams through
the route's separately owned dynamic parts. Do not bake request data into a
snapshot or replay a snapshot as proof of request-time SSR.

The snapshot cache is local/ephemeral and **never committed to Git**. Its
version-hash key must cover the resolved component package version and
content/dependency identity, headless renderer/tool version, relevant
configuration, and snapshot inputs; a changed input invalidates the cache.
Generated snapshots and qualification reports are evidence artifacts, not
hand-maintained corpus entries or a second source of truth. A cache hit must
still bind to those exact inputs and the corresponding qualification result;
missing or stale evidence reruns the checks or falls back to T0. Cache
retention, key encoding, and runner choice are implementation details for
#1451, not a new public API.

### T2 third-party Lit boundary

First-party `renderer: 'lit'` is an existing, separately qualified Framework
Mode (ADR-0152). It does not auto-promote nested or package Lit elements.
For a third-party Lit tag, the harness must verify a resolved SSR-safe module
and registered class, adapter output (including DSD where claimed), streamed
route survival, and the browser's deferred-hydration/upgrade ownership without
duplicate shadow roots, lost live state, or replacement of server-born
children. An adapter declaration or CEM `openElement.ssr` flag is only a
candidate signal. Passing yields T2 for that exact tested identity. A failed
or unavailable adapter yields the **T0 opaque host/light-child path**, with a
diagnostic explaining the downgrade; it must not emit partial adapter HTML,
silently claim T1, or pretend a successful DSD render. Failures that also make
T0 unsafe remain errors. Admission and downgrade are resolved before the
first response byte. An adapter error after streaming has begun follows the
stream error contract and fails T2 qualification; it cannot rewrite the
already-sent response as T0.

## Machine-checkable admission contract

#1451 implements the harness; this ADR defines its observable obligations,
not a new committed test or report schema. Given a resolved WC and placement,
the harness records tag, package/version identity, requested checks, highest
**passed** tier, SSR form, downgrade reason, and the exact test/evidence
identity. Unknown, skipped, or inapplicable checks are never a pass. The
fixed OSS Lit fixture set (not one vendor-specific library) runs in CI with a
tier-report artifact attached to evidence; initial integration reports
diagnostics, with promotion to a release gate requiring a separate decision.
The hand-maintained interop corpus remains the input; CEM and run reports are
generated from it rather than checked in as duplicate truth.

| Check       | Machine assertion                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0 baseline | SSR has the host and authored light children in the intended slots, no invented foreign DSD; without JS they remain readable; CSS `:not(:defined)` then `:defined` transitions are observable; browser definition preserves host/children and slot/event/property behavior in the applicable probes.                                                                                                                                                              |
| T1 snapshot | Two clean builds of identical pinned inputs yield equivalent DSD structure; an input/version change invalidates the version-hash cache; no snapshot or cache is tracked in Git; missing/stale evidence denies T1. Distinct requests produce distinct streamed data without changing the structure snapshot; upgrade preserves the structure and live state.                                                                                                       |
| T2 adapter  | A pinned third-party Lit fixture produces validated SSR output through its adapter, including an opted-in slow streamed route; deferred hydration upgrades the existing host without double-render or lost state. Force preflight adapter failure, missing capability, and unsupported version: each reports T0 and emits only the T0 server form, or an explicit error if T0 itself cannot be delivered. A post-flush error never claims a successful downgrade. |
| T3 native   | First-party compiled serialization, fresh creation, and claim agree on the Part Program; interaction, mismatch diagnostics, recovery bounds, and state preservation pass the existing conformance fixtures.                                                                                                                                                                                                                                                       |

Evidence must compare the **emitted HTML/stream and browser-observed DOM**,
not merely a classification label. The harness's report names each failed
check and downgrade; it does not grant a tier by counting a skipped browser
or assuming a CEM extension is executable. Where T2 output is streamed, test
headers/status before the first byte and abort/backpressure under #1444/#1447
as applicable; this ADR does not authorize a second transport or a different
request-data channel.

## Consequences and review gate

- P1: Custom Elements, slots, DSD, CSS definition selectors, and browser
  upgrade remain the durable boundary. The framework does not reimplement a
  foreign component's runtime.
- P2: T1 capture and admission work happen at build/qualification time.
  T2's server adapter is an explicit renderer capability, not a shipped
  browser VDOM or a generic claim path.
- P3/P4: Dynamic data uses the existing WinterTC Request/Response and
  progressive HTML/streaming contract. An immutable snapshot cannot smuggle
  request state across users; response semantics remain correct before flush.
- P5/P6: Snapshot tooling can be retired if a component supplies a qualified
  server renderer or the platform makes it redundant. Version-bound caches
  and generated reports are disposable; the source corpus and resolved
  package graph remain canonical.
- P7 prior art: browser Custom Elements/DSD and Lit SSR/defer-hydration
  provide the native and mature adapter models. T1 deliberately captures
  static structure only; T2 is deliberately conditional on actual package
  survival, unlike a universal framework adapter claim.

This proposal neither changes current `renderPath` semantics nor grants
release approval. Wiring, thresholds for snapshot equivalence, cache
invalidation proof, and the first gating milestone must be settled during
#1451 review before any T1/third-party T2 documentation can be described as
shipped behavior.
