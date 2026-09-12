---
title: 'Performance & Benchmarks'
lede: 'Zero-noise. What we actually measure.'
order: 100
---

## Build Performance

| Metric          | Value                                              |
| --------------- | -------------------------------------------------- |
| SSG build (www) | Every route prerendered; sitemap built from routes |
| Dev cold start  | Measured by CI performance evidence                |
| Vite dev start  | Measured by CI performance evidence                |
| Client bundle   | Budgeted island chunks; no mandatory page runtime  |

## Rendering

| Metric         | Value                                                    |
| -------------- | -------------------------------------------------------- |
| DSD SSR        | Zero JS parse cost (browser native)                      |
| Island hydrate | Per-component, strategy-gated                            |
| Navigation     | Browser-native navigation with optional View Transitions |

## Bundle Size

DSD components need no framework virtual DOM runtime. Client JS is emitted only when islands or enhanced forms exist; pure-static pages stay script-free. Islands load on-demand by strategy.
