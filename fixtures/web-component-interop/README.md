# Web Components interoperability qualification fixture

Canonical Web Components **contract** qualification (#1175): an owned,
synthetic probe corpus covering the four framework origins — native, Lit,
FAST, and Stencil (Ionic compiled output) — exercised against the
browser-native Custom Element contract.

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
  input) and corpus/CEM tag parity;
- fail-closed SSR capability classification (`classifySsrCapability` — unknown
  capability is an explicit client-only decision, never a fallback);
- SSR form: foreign probe tags present with authored light-DOM children, no
  DSD template, explicit `client-only` admission decisions; the OpenElement
  fixture island renders with DSD;
- the browser-native CE contract in **chromium, firefox, and webkit**:
  property/attribute reflection, composed events, slot projection, css-part
  presence, shadow root, upgrade order (constructor before connected),
  pre-upgrade identity and live-state preservation, plus fresh-DOM probes.

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
deno task test       # fast corpus/CEM validation tests (no browsers)
deno task qualify    # full qualification: builds a temp app, probes 3 browsers
```

Set `OPEN_ELEMENT_KEEP_INTEROP=1` to keep the generated temp app and the
regenerated CEM/evidence artifacts for inspection.
