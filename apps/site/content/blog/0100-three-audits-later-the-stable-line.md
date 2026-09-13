---
title: 'Three audits later, the stable line'
date: '2026-07-26'
lang: 'en'
type: 'dispatch'
tags: ['release-truth', 'architecture', 'audit']
draft: false
hidden: false
---

In July we audited the whole repository three times. Not a vendor, not a
checklist — a line-by-line adversarial read of the renderer, the router, the
release tooling, and every document that claims something about them. This is
what three rounds found in our own framework, and why 0.41.0 freezes only
what the evidence proves.

> The markup is the application — so the markup gets audited.

## Round one: correctness was not what the gates said

The first audit (ADR-0116) found defects no qualification gate had caught:
`observedAttributes` registered at `connectedCallback` time, which real
browsers read once at `customElements.define` — attribute-to-signal
synchronization never fired outside our DOM shim. SSR-to-hydration event
markers relied on an implicit identical traversal order on both sides, and
runtime-dependent `<Show>`/`<For>` branches could deterministically misalign
handler binding. The island chunk matcher forgot the base64url alphabet and
silently dropped islands. The published `latest` dist-tag pointed six alphas
back.

Every one of those shipped behind green CI. The lesson that stuck: a gate
that cannot see a class of failure is evidence for nothing.

## Round two: the half-fix is the default outcome

The second audit (ADR-0117) verified the first round's repairs and found the
meta-pattern: fixes closed one path and left siblings open. The anchor gate
asserted new version claims but never rejected stale ones. The missing-closure
CI failure was fixed on the CI path but not on local `patch-release`. And
`reflect: true` static props — a publicly documented feature — was broken in
all three browser engines with zero test coverage: write-loop storms and SSR
attributes overwritten at connect.

Alpha.18 therefore shipped with a rule we now treat as doctrine: every fix
enumerates its sibling paths, or it does not count as a fix.

## Round three: the bugs moved to the combinations

The third round (ADR-0118, issues #481–#506) found no correctness bugs on the
main paths at all. What remained was the combinations: the reflect short
circuit over-suppressing on `removeAttribute` when the value equals the
default, a popstate redirect whose target guard then blocks — the browser URL
and router state silently forking — a `For` drift token colliding on
separator smuggling, and the gates' own coverage edges (header zones, regex
prefixes, four-file whitelists).

That is what a framework approaching a freeze looks like: the defects migrate
from the mechanism to the edges of the mechanism's evidence.

## What we froze, and what we did not

ADR-0119 records the decision. Frozen in 0.41.0: `defineElement`,
`definePage`, `buildApp`, the static and SPA semantics of `defineApp` as
shipped, the five-package graph, and the supported subpaths of
`PACKAGE_SURFACE.md`. Explicitly not frozen: request-time data, forms,
sessions and cache — those belong to the Application Loop (0.42) and the
Production Runtime (0.44), and pretending otherwise would be the same kind of
overclaim the audits kept finding.

The external adopter pilot #390 was retired by maintainer decision after zero
recruitment across three release cycles. We did not substitute internal CI
for external evidence; we recorded the exception and narrowed the freeze to
what three audits and the consumer matrix actually prove.

The stable line is not a claim that nothing will break. It is a claim about
which interfaces we will not break — written down, gated, and small enough to
keep.
