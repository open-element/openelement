# Web Components interoperability qualification fixture

Canonical Web Components **contract** qualification (#1175): an owned,
synthetic probe corpus covering the four framework origins — native, Lit,
FAST, and Stencil (Ionic compiled output) — exercised against the
browser-native Custom Element contract.

## Contract

The human-readable interop contract lives at [web-components-interop.md](../../../docs/integrations/web-components-interop.md).

## Artifact consumption

This fixture consumes workspace **source** artifacts: `qualify.ts` generates a
fresh app with `packages/create` into a temp directory, aliases every
workspace package to its in-repo source, copies the fixture sources from
`./app` in, and builds with the in-repo Router build CLI. The probe
dependencies (Lit, FAST, Ionic) are consumed as pinned npm packages.

## Canonical corpus vs generated evidence

- `corpus.json` is the **canonical corpus** — the single hand-maintained
  source of truth (components, tags, probes, placements).
- `compiler-output.cem.json` is **generated evidence**: the qualifier
  regenerates the CEM manifest from `corpus.json` on every run
  (`generateCemManifest`) and validates it fail-closed. It is gitignored and
  written only into the temporary work directory.
- `interop-evidence.json` is **generated evidence**: the full qualification
  record, regenerated on every run into the temporary work directory and
  printed to stdout. It is gitignored and must never be committed as a second
  source of truth.

## What it pins

- CEM manifest validation (`validateCemManifest`, fail-closed on malformed
  input) and corpus/CEM tag parity. The regenerated manifest is typed by the
  upstream CEM schema package (`npm:custom-elements-manifest@2.1.0`), the
  generic metadata authority; runtime schema validation and analyzer-based
  generation stay deferred (ADR-0154 and
  `docs/architecture/compiler-and-element-runtime.md`);
- fail-closed SSR capability classification (`classifySsrCapability` — unknown
  capability is an explicit client-only decision, never a fallback);
- SSR form: foreign probe tags present with authored light-DOM children, no
  DSD template, explicit `client-only` admission decisions; the OpenElement
  fixture island renders with DSD;
- the browser-native CE contract in **chromium, firefox, and webkit**:
  property/attribute reflection, composed events, slot projection, css-part
  presence, shadow root, upgrade order (constructor before connected),
  pre-upgrade identity and live-state preservation, plus fresh-DOM probes.

## Generated host slice (M09-3)

Besides the two canonical placements, the corpus is hosted a third time by a
**real generated Native Custom Element**: `app/islands/interop-generated-host.tsx`
is a function-component island (`defineIslandConfig({ hydrate: 'load',
ssr: false, root: 'shadow' })`) that the build's generated-element lane
compiles — the fixture never hand-writes generated Custom Element code. The
page authors the four canonical foreign probe tags as that host's **light
children**, so the host's authored `<slot>` / `part` / `onClick` surfaces
project and control the same four origins.

What the generated-host block asserts (same 7 probes as the canonical
placements, plus host-level facts):

- the host is a plain tag with authored light children in SSR, **no DSD
  template**, and the admission plan classifies it `client-only` with the
  `openElement.ssr is false` island reason — entry-level DSD SSR for generated
  islands has no production caller yet (M11 wiring), so this fixture records
  the boundary instead of faking SSR capability;
- the host is defined by its island client entry, upgrades in place, and
  mounts its authored shadow root; native slots project the named caption and
  the four foreign children; the authored `part` token is present; the authored
  `onClick` runs exactly once with no DOM event attribute; the composed click
  crosses the host's shadow boundary to the document;
- the four foreign probes still satisfy property/attribute, event, slot,
  css-part, root, upgrade-order, pre-upgrade identity and live-state; their own
  composed events reach the document through the host;
- the foreign probe tags are **not** registered before the fixture client runs
  (the fixture client stays the only definer — no auto-registration).

Not claimed: generated-host DSD SSR (M11), host-dispatched `CustomEvent`
vocabulary, styles/theme/`::part` styling, or any M13/CI matrix identity. The
`qualify` run is LOCAL, per-engine evidence.

## Boundary with `fixtures/third-party-web-components/`

This fixture owns the **canonical contract** corpus (owned synthetic probes,
three browsers, CEM + SSR capability semantics).
`fixtures/third-party-web-components/` owns **real third-party library**
admission and smoke behavior (published npm packages — Shoelace, Material
Web, FAST, Ionic — chromium). Do not duplicate real-library admission checks
here or contract probes there.

## Run

```sh
cd fixtures/web-component-interop
pnpm run test        # fast corpus/CEM validation tests (no browsers)
pnpm run qualify     # full qualification: builds a temp app, probes 3 browsers
```

Set `OPEN_ELEMENT_KEEP_INTEROP=1` to keep the generated temp app and the
regenerated CEM/evidence artifacts for inspection.
