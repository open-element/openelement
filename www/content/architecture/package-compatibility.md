---
title: 'Package Compatibility'
lede: 'OpenElement treats third-party Custom Elements as standards-based dependencies. Current builds use explicit package-island configuration and available Custom Elements Manifest metadata for SSR admission.'
order: 90
---

## Current contract

`@openelement/element` owns authoring; `app` and `adapter-vite` keep application and build behavior separate.

## Explicit admission

Known packages can be configured as package islands and use available CEM metadata without importing retired package surfaces.

## Current diagnostics

The current line ships Universal DSD/light/client-only classification,
hydration-mismatch diagnostics and the tracked third-party WC SSR corpus —
first shipped on the 0.43 line and kept green by CI on the compiled line.
Admission still depends on explicit package-island configuration and observed
metadata; it is not a blanket certification of every third-party component.
