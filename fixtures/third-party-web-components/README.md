# Third-party Web Components qualification fixture

Qualifies that mature third-party Web Components can be consumed directly
inside an OpenElement app.

## Artifact consumption

This fixture consumes workspace **source** artifacts: `qualify.ts` generates a
fresh app with `packages/create` into a temp directory, aliases every
workspace package to its in-repo source (file: URLs in the app import map and
Vite config), copies the fixture sources from `./app` in, and builds with the
in-repo Router build CLI. The third-party libraries (Lit, Shoelace, Material
Web, FAST, Ionic/Stencil) are consumed as pinned npm packages, exactly as a
real application would consume them.

## What it pins

For each consumed component kind (Lit, Shoelace, Material Web, FAST,
Ionic/Stencil, bare-native, plus the OpenElement control island):

- SSR form: tag presence, authored literal attributes, light-DOM children,
  DSD `<template shadowrootmode>` presence/absence, no `data-eid` markers;
- the build's `ssrAdmissionPlan` decision per tag;
- browser capability evidence: registration, upgrade, shadow root, slot
  projection, attribute/property reflection, composed events, interaction
  event propagation, hydration safety;
- metadata availability per library (CEM / Stencil collection manifest).

The run prints a deterministic JSON record to stdout; generated evidence is
not committed to the repository.

## Boundary with `fixtures/web-component-interop/`

This fixture owns **real third-party library** admission and smoke behavior
(published npm packages, chromium). `fixtures/web-component-interop/` owns
the **canonical Web Components contract** corpus (owned synthetic probe
components: native, Lit, FAST, Stencil) — CEM manifest validation, fail-closed
SSR capability classification, and the full browser-native Custom Element
contract (property/attribute/event/slot/css-part/root/upgrade-order,
pre-upgrade identity and live-state preservation) across chromium, firefox,
and webkit. Do not duplicate contract probes here or real-library admission
checks there.

## Run

```sh
deno task third-party-wc:smoke   # from the repository root
# or directly:
deno run --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys \
  fixtures/third-party-web-components/qualify.ts
```

Set `OPEN_ELEMENT_KEEP_THIRD_PARTY_WC_SMOKE=1` to keep the generated temp app
for inspection.
