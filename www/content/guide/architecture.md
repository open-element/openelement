---
title: 'Architecture Guide'
lede: 'The short orientation: how OpenElement is organized, and where the full architecture page lives.'
order: 20
---

## Layers

The consumer graph is five packages: `element` (one authoring surface), `app` (pages, routes, islands), `adapter-vite` (the only host side), `create` (the starter), and optional `ui`. Deep modules hide implementation complexity.

## Strategic direction

Web Components are the application architecture: WC SSR, a complete application loop, and portable output — not a growing package count.

## Release gates

Current truth is checked mechanically: package surface, docs truth, artifacts, and browser tests reject a return to the retired product graph.

The full page with the package graph and layer map lives in the Architecture section: [Current Architecture](/architecture/architecture)
