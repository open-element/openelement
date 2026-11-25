---
title: 'Web Component Admission Tiers'
lede: 'A compatibility tier says what OpenElement can actually render and preserve for a particular Custom Element.'
navLabel: 'WC Admission'
order: 45
---

## What the tiers mean

Admission applies to a specific tag and resolved package version, not every
component in a library. An adapter or a Custom Elements Manifest entry is not
proof on its own. The result is the highest tier that passes the corresponding
server and browser checks.

| Tier                         | Server writes                                                                                             | Browser does                                                                                               | When to use it                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **T0 · Custom Element leaf** | The host, attributes, and authored slot-first light-DOM children. No third-party shadow root is promised. | The component registers and upgrades itself; CSS `:not(:defined)` and `:defined` can style the transition. | Any usable WC without proven SSR; no adapter required.                                           |
| **T1 · Structure snapshot**  | A build-time headless DSD snapshot of stable structure, **not request data**.                             | Upgrades the existing host without discarding that structure.                                              | Components whose pinned version passes snapshot and upgrade checks.                              |
| **T2 · Runtime adapter** | Qualified SSR output from an adapter. | Upgrades through the component runtime. | Proposed for third-party packages that pass SSR and upgrade checks. |
| **T3 · Native compiled** | Generated server renderer emits HTML and DSD. | Generated mount and claim functions bind behavior. | OpenElement components. |

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

A T1 snapshot captures stable structure. Request data comes from the page loader. T2 requires adapter SSR and browser upgrade checks.

## What is available now

Browser tests cover T0 behavior for standard, Lit, FAST and Stencil elements in Chromium, Firefox and WebKit. The server emits the host and authored light DOM children, and third-party components upgrade in the browser. OpenElement’s T3 components render HTML through generated renderers and activate according to their hydration strategies. T1 snapshots and T2 third-party SSR adapters are planned.

## See also

- [Island Hydration](/architecture/islands) — delivery and upgrade strategies.
- [DSD Rendering](/architecture/dsd) — the platform shadow-root contract.
