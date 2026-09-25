# Third-party Web Components qualification fixture

Qualifies that mature third-party Web Components can be consumed directly
inside an OpenElement app.

## Contract

The human-readable interop contract lives at [using-third-party-web-components.md](../../../docs/integrations/using-third-party-web-components.md).

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
  event propagation; hydration safety is `null` unless pre-upgrade identity
  was actually captured;
- metadata availability per library (CEM / Stencil collection manifest).

The run prints a deterministic JSON record to stdout. Three Lit-based
representatives also probe no-JS server-born children, `:defined` styling,
and pre-upgrade host/child identity. The tier report grants only the highest
observed tier; unavailable probes are named as gaps, and T1/T2 are never
inferred from CEM metadata. Set `OPEN_ELEMENT_TIER_REPORT` to a writable path
to emit the generated JSON. The release workflow uploads it as an advisory
artifact; it does not gate publishing or claim a real Workers deployment.
Generated evidence is not committed to the repository.

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
deno task --cwd tests/fixtures/third-party-web-components smoke   # from the repository root
# or directly:
deno run --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys \
  tests/fixtures/third-party-web-components/qualify.ts
```

Set `OPEN_ELEMENT_KEEP_THIRD_PARTY_WC_SMOKE=1` to keep the generated temp app
for inspection.

## T1 snapshot prototype

`snapshot:prototype` captures a pinned Lit fixture's _structure_ in a
headless browser, removes volatile Lit comment markers, hashes the exact
package/bundle/tool/browser/inputs, checks an ephemeral cache read and a
simulated version-bump miss, and serves a generated DSD demo route without
JavaScript. The same run observes upgrade node identity and focus; failed
upgrade keeps `highestPassedTier: null`. It neither caches request data nor
qualifies T1 or a third-party T2 adapter. The release workflow uploads the
report as advisory evidence, never as a publishing gate.

```sh
OPEN_ELEMENT_T1_PROTOTYPE_REPORT=/tmp/openelement-t1-report.json \
  deno task --cwd tests/fixtures/third-party-web-components snapshot:prototype
```

Set `OPEN_ELEMENT_KEEP_T1_PROTOTYPE=1` to retain the generated demo and
cache for inspection; otherwise both are removed after the proof. The version
change in the report is simulated, not a dependency upgrade.
