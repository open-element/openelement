---
title: 'Web Component Admission Tiers'
lede: 'A compatibility tier says what OpenElement can actually render and preserve for a particular Custom Element.'
navLabel: 'WC Admission'
order: 45
---

> Proposed for alpha5 ([ADR-0157](https://github.com/open-element/openelement/blob/main/docs/adr/ADR-0157-web-component-admission-tiers.md)); not a claim that all tiers ship in the current version.

## What the tiers mean

Admission applies to a specific tag and resolved package version, not every
component in a library. An adapter or a Custom Elements Manifest entry is not
proof on its own. The result is the highest tier that passes the corresponding
server and browser checks.

| Tier                         | Server writes                                                                                             | Browser does                                                                                               | When to use it                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **T0 · Custom Element leaf** | The host, attributes, and authored slot-first light-DOM children. No third-party shadow root is promised. | The component registers and upgrades itself; CSS `:not(:defined)` and `:defined` can style the transition. | Any usable WC without proven SSR; no adapter required.                                           |
| **T1 · Structure snapshot**  | A build-time headless DSD snapshot of stable structure, **not request data**.                             | Upgrades the existing host without discarding that structure.                                              | Components whose pinned version passes snapshot and upgrade checks.                              |
| **T2 · Runtime adapter**     | Qualified SSR output for the adapter's runtime; first-party Lit mode already has a direct path.           | Hydrates/upgrades through the component runtime without replacing server-born state.                       | Third-party Lit only after admission passes; failure returns to **T0**, not an assumed snapshot. |
| **T3 · Native compiled**     | The first-party compiled Part Program serializes HTML/DSD.                                                | The same program creates or claims DOM and binds behavior.                                                 | OpenElement components.                                                                          |

T0 is useful even without JavaScript when the authored children contain the
essential content. Prefer meaningful slotted text and controls in the source
HTML; do not depend on the foreign shadow tree appearing on the server. For
example, authors can style a component before and after it is defined:

```css
my-widget:not(:defined) {
  display: block;
}
my-widget:defined {
  display: block;
}
```

T1 snapshots are **structure-only**. On a streaming route, per-request data
still comes from the route's dynamic parts; it is never captured in the
snapshot. Snapshot caches are keyed to resolved versions and build inputs,
are invalidated when those inputs change, and are **never committed to Git**.

T2 is not automatic for a tag just because it extends LitElement. The
third-party package must survive adapter SSR, the streamed route when used,
and deferred hydration/upgrade checks. If it does not, the server emits the
T0 host and light children with a downgrade diagnostic **before streaming
begins**. An error after bytes are sent cannot turn that response into T0;
it follows the stream error contract. First-party
`renderer: 'lit'` qualification does not certify all third-party Lit packages.

## What is available now

The current foreign-tag corpus checks T0-shaped output for native, Lit, FAST,
and Stencil probes: hosts and authored light children are present, foreign
DSD is absent, and browser upgrade is exercised in Chromium, Firefox, and
WebKit. The Lit Framework Mode separately server-renders explicitly
registered Lit pages/islands; native OpenElement components use their compiled
program. Build-time headless snapshots and automatic third-party Lit T2
admission are **proposed**, not current blanket guarantees.

On a streamed route the verified third-party placement is server-born in the
streamed shell: the qualification probe pins a single instance that upgrades,
keeps its server-born slot children, and stays interactive after the
backfill. Backfilled frame content fails closed on foreign custom-element
tags — a third-party component inside a backfill range is not a supported
placement. The third-party qualification smoke's current tier report proves
T0 for the three corpus tags with server-born light children
(`wc-lit-counter`, `sl-button`, `md-filled-button` — 3/11); formal T1/T2
qualification remains open.

The [admission harness issue](https://github.com/open-element/openelement/issues/1451)
will report the highest passed tier for pinned OSS Lit fixtures, including
slot-first content, definition-state styling, streaming, and downgrade
checks. Its evidence is generated for the run, not a hand-maintained
certification list. A failed check never counts as a passed tier.

## See also

- [Island Hydration](/architecture/islands) — delivery and upgrade strategies.
- [DSD Rendering](/architecture/dsd) — the platform shadow-root contract.
