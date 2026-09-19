---
title: 'Pick an island strategy'
lede: 'Five strategies, one decision per component: when its JavaScript may load, and what the reader gets before it does.'
navLabel: 'Island strategies'
order: 122
section: 'Recipes'
---

## The default is no island

A component that renders content, layout or documentation stays `dsd-static`: serialized as DSD, no client module, ever. Only promote a component to an island when it needs runtime state or framework interop. The decision below assumes promotion already earned its keep.

## The five options

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'visible', ssr: true, dsd: true });
```

- `load` — first-paint controls: navigation, search, theme. Imported immediately after parse; blocking paint is the point.
- `idle` — everything interactive but non-critical: counters, forms, tabs. Upgrades when the browser is idle and never blocks paint.
- `visible` — below-the-fold weight: comments, charts, embeds. An IntersectionObserver gates the fetch until scroll-in.
- `media` — capability-gated weight: declare the media query in the island's `media` field and the chunk loads only while it matches.
- `only` — browser-only components that cannot produce reliable DSD (canvas, media, WebGL). The server emits the host tag and serialized props; SSR is skipped.

## Worked choices

- **Theme toggle** → `load`. It must answer the first click; a late toggle flashes the wrong theme.
- **Docs search** → `load`. Same reason: the header control is first-paint chrome.
- **Code-block copy buttons** → `idle`. Useful, but nobody copies code in the first 50ms.
- **Comment thread under an article** → `visible`. Heavy, far down the page, often never reached.
- **Live cursor follower on the hero** → `only`. It cannot SSR meaningfully and must never delay the document.

## Before any of it loads

Until the chunk arrives the element keeps its server markup and styling — DSD content, or the declared host tag for `only`. The page never depends on an island having loaded, which is exactly why the choice above is about timing, never about correctness.

## See also

- [Islands and SSR](/guide/islands-and-ssr) — declaring strategies in an application.
- [Island Hydration](/architecture/islands) — layers, the manifest and the claim.
- [Glossary](/guide/glossary) — island, strategy, manifest in one place.
