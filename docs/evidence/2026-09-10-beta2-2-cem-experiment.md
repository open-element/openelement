# Beta.2.2 CEM extraction experiment — reproducible evidence record

- Date: 2026-09-10
- Issue: #1156 (Beta.2.2 slice: "CEM extraction evaluation" per docs/architecture/alpha-maturation.md;
  proceed/block/defer required, "experiment success is not alpha.1 admission")
- Tested implementation: `f83398daeac7c3d25b88e6df2abbece493607db4`
  ("fix: close Beta.2.2 review findings (ADR-0153)") — the implementation commit whose clean tree the
  harness ran against (git status at run time: clean apart from the untracked docs/evidence/ files
  being drafted). This evidence file is added by a LATER evidence-only commit that changes no code,
  harness, lockfile or generated file; the PR final SHA is bound by the remote CI run on that final
  SHA, not by this file.
- Tree state: at run time the worktree was clean (see above); `packages/element` is imported
  transitively for `createLogger`/`formatError`/`isValidTagName`/`formatJson` helpers only.
- Supersedes: the 2026-09-09 scratch run in `/tmp/oe-cem-exp/` (same findings, then non-reproducible;
  this record moves the harness into the repo and re-runs everything on the current tree).

## Question

Can the upstream `@custom-elements-manifest/analyzer` carry OE's generic component metadata
scanning (tag, attributes, events, slots, CSS parts) while OE's layer/interop/hydration policy
remains local? The plan forbids CEM from auto-selecting an SSR provider or validating hydration
(alpha-maturation.md: "Do not claim CEM automatically selects an SSR provider or validates
hydration"; infrastructure-reduction.md: "Upstream CEM capability must be demonstrated before
local extraction is removed").

## Environment and versions

| Item                          | Value                                                                           | Source                          |
| ----------------------------- | ------------------------------------------------------------------------------- | ------------------------------- |
| OS                            | macOS 26.5.1, arm64 (Apple Silicon)                                             | `sw_vers`, `uname -m`           |
| Deno                          | 2.9.0 (stable, aarch64-apple-darwin)                                            | `deno --version`                |
| Node                          | v24.18.0 (npm 11.16.0) — footprint measurement only                             | `node --version`                |
| Analyzer                      | `@custom-elements-manifest/analyzer@0.11.0` (exact pin in the import specifier) | `npm view`                      |
| Analyzer's bundled TypeScript | 5.4.5 (dep range `~5.4.2`; repo workspace uses 5.9.x)                           | harness output                  |
| CEM schema package            | `custom-elements-manifest@1.0.0`                                                | package-lock of footprint probe |

## Harness (in-repo, pinned, gated)

New files (no production changes; `tools/autoflow`, CI and package src untouched; root `deno.json`
gains only the `experiment:cem` task line):

- `tools/experiments/cem/run.ts` — five checks, exit non-zero on any failure, `--out` JSON summary
- `tools/experiments/cem/oe-plugin.ts` — OE provenance plugin PoC for the analyzer
- `tools/experiments/cem/README.md` — run instructions and flag rationale
- `docs/evidence/2026-09-10-beta2-2-cem-experiment-results.json` — machine-readable results of the
  recorded run (90 checks, 0 failures)

The analyzer is pinned exactly in the import specifier (`npm:@custom-elements-manifest/analyzer@0.11.0`); no import-map or lockfile change was made.

### Commands (from repo root)

Canonical run (recorded run used exactly this):

```sh
deno task experiment:cem   # equals:
deno run --no-lock --node-modules-dir=none --allow-read --allow-write --allow-env \
  tools/experiments/cem/run.ts
# plus, to regenerate the machine-readable record:
deno run --no-lock --node-modules-dir=none --allow-read --allow-write --allow-env \
  tools/experiments/cem/run.ts \
  --out docs/evidence/2026-09-10-beta2-2-cem-experiment-results.json
```

Quality gates on the additions:

```sh
deno fmt --check tools/experiments/cem/   # clean
deno lint tools/experiments/cem/          # clean
deno run -A npm:markdownlint-cli2@0.23.2 "tools/experiments/cem/README.md" "docs/evidence/2026-09-10-beta2-2-cem-experiment.md"
```

Fresh-checkout behavior: proven by running the same command in a `git archive HEAD` extract (no
`node_modules/`, license-only `vendor/`): harness resolves the analyzer from Deno's global cache,
fetching from registry.npmjs.org on first run only. `--no-lock` keeps `deno.lock`/`vendor/`
untouched; `--node-modules-dir=none` is required because the root config sets
`nodeModulesDir: "manual"`, which rejects npm packages not preinstalled into the repo
`node_modules` (verified: without the flag the run fails with "Could not find a matching package").
`--allow-write` is used only for a fresh `$TMPDIR` directory (scanner probe) and the `--out` file.

### Negative control (gate teeth)

In the archive extract, one attribute (`href`) was deleted from `open-button`'s entry in
`packages/ui/src/generated-manifest.json`. The harness exited 1 with:

```text
FAIL A.open-button.attributes - manifest=[disabled,size,target,type,variant] upstream=[disabled,href,size,target,type,variant]
```

All other 89 checks passed; the failure set was exactly the poisoned comparison.

## Inputs

1. Authored OE sources: `packages/ui/src/open-*.tsx` (10 components, TSX classes with
   `@element`/`@property` decorators), read from the current tree.
2. Truth for parity: `packages/ui/src/generated-manifest.json` (version 0.44.0-beta.2.1, 10
   declarations), produced by `tools/generate-ui-manifest.ts` (task `generate:ui-manifest`).
3. Compiled form: `compileElementModule(open-button.tsx)` output produced in-memory at run time by
   the repo compiler (`packages/adapter-vite/src/internal/compiler/plugin.ts`).
4. Foreign corpus: `tests/fixtures/v044-interop/app/client/v044-interop-client.ts` (native, Lit,
   FAST, Stencil probes) plus `corpus.json` and the hand-written `compiler-output.cem.json`.
5. Consumer path under test: `packages/adapter-vite/src/internal/ssg/cem-scanner.ts` /
   `cem-compat.ts` driven against a synthetic `$TMPDIR` `node_modules`.

## Pass/fail criteria

- A: per component, upstream analyzer (+ bundled litPlugin + OE PoC plugin) must reproduce the
  manifest's `tagName`, attribute-name set, slot-name set, cssPart-name set; event names may differ
  only by the pinned known gap (`open-theme-toggle`'s `open:theme-change`).
- B: every declaration's `openElement.layer`/`hydrate` must equal `layerFromClass`/`hydrateFromClass`
  (the `POLICY_BY_CLASS` registry, tools/generate-ui-manifest.ts:64); no analyzer output may contain
  `ssr`/`dsd`/`hydrate`/`layer`/`openElement` keys anywhere.
- C: `parseCem` must reject OE's own generated manifest (`CEM_NO_MODULES`); a synthetic published CEM
  must classify `ssr-capable` only with the `openElement` block; upstream-analyzer CEM must yield
  zero components as-is and all-`client-only` after kind mapping (fail-closed, never SSR).
- D: bare upstream on the compiled form must extract zero attributes (documents the gap); upstream +
  OE PoC plugin must restore tag, 6 attributes with `reflect`/defaults, default slot, `control` part,
  and the `open-click` event.
- E: foreign-corpus extraction must match pinned expectations, including the FAST blind spot.

## Results (recorded run at the tested SHA: 90 checks, 0 failures, exit 0)

### A. Authored-source parity (10/10 components)

| Component         | tagName | attributes         | slots                      | cssParts                              | events                                                 |
| ----------------- | ------- | ------------------ | -------------------------- | ------------------------------------- | ------------------------------------------------------ |
| open-card         | PASS    | PASS [variant]     | PASS ['', footer, header]  | PASS [body, container]                | PASS []                                                |
| open-callout      | PASS    | PASS [label, type] | PASS []                    | PASS [container, content, icon]       | PASS []                                                |
| open-button       | PASS    | PASS [6]           | PASS ['']                  | PASS [control]                        | PASS [open-click]                                      |
| open-input        | PASS    | PASS [8]           | PASS []                    | PASS [control, error, label, wrapper] | PASS [4 events]                                        |
| open-theme-toggle | PASS    | PASS [theme]       | PASS []                    | PASS [3]                              | PASS (gap pinned: `open:theme-change` unseen upstream) |
| open-code-block   | PASS    | PASS []            | PASS []                    | PASS [copy]                           | PASS []                                                |
| open-badge        | PASS    | PASS [size, tone]  | PASS []                    | PASS [badge]                          | PASS []                                                |
| open-dialog       | PASS    | PASS [label, open] | PASS ['', footer, trigger] | PASS [5]                              | PASS [open-dialog-close]                               |
| open-dropdown     | PASS    | PASS []            | PASS ['', trigger]         | PASS [content, trigger]               | PASS []                                                |
| open-tabs         | PASS    | PASS []            | PASS [panel, tab]          | PASS []                               | PASS []                                                |

Informational notes (upstream is strictly more informative, not a parity break): upstream captures
real string defaults the OE generator drops (`variant='default'`, `size='md'`, `type='button'`,
`open-input.type='text'`, `open-callout.type='info'`, `badge tone='neutral'/size='md'`,
`theme='dark'`), a narrower union type for `open-theme-toggle.theme` (`'dark' | 'light'` vs flat
`string`), and `reflects: true` on members (OE's `OpenElementAttribute.reflects` field is defined
but never populated by the generator). OE-only strengths kept as notes: `CustomEvent<{ value:
unknown }>` detail-generic inference (`open-input`, `open-theme-toggle`) and the
`globalThis.dispatchEvent` event recall case.

### B. Policy locality

20/20 PASS: all 10 declarations' `layer`/`hydrate` equal the `POLICY_BY_CLASS` registry values and
carry `ssr: true, dsd: true, module: '@openelement/ui/<file>', export: <className>`; the recursive
scan found zero policy keys in all 13 analyzer outputs (`B.analyzer-output-policy-free` PASS).

### C. Two-CEM-path inventory + SSR orthogonality

- OE has **two distinct CEM paths**. Consumer: `cem-scanner.ts:16` walks `node_modules` for
  published `custom-elements.json` (never executes packages); `cem-compat.ts:96` parses
  fail-closed and `cem-compat.ts:243` classifies **only** from the `openElement` extension block;
  consumed at `packages/adapter-vite/src/plugin.ts:477` → `buildSsrAdmissionPlan`
  (entry-descriptor.ts). Producer: `tools/generate-ui-manifest.ts` extracts metadata from authored
  TSX into `generated-manifest.json`, consumed by `island-scanner.ts:127` (`buildPackageIslandDecls`)
  and `tools/generate-api-reference.ts:27`.
- `C.producer-manifest-not-consumer-format` PASS: `parseCem(generated-manifest.json)` →
  `CEM_NO_MODULES` (OE's producer manifest is deliberately not CEM-shaped,
  `packages/element/src/internal/protocol/manifest.ts:60`).
- `C.consumer-path-scans-published-cem` / `C.consumer-classification-openElement-only` PASS:
  synthetic published CEM classified `probe-ssr=ssr-capable` (with `openElement` block),
  `probe-plain=client-only` ("no openElement SSR declaration").
- `C.upstream-cem-invisible-without-mapping` PASS: upstream analyzer CEM fed to OE's classifier
  yields 0 components (upstream emits `kind: 'class'`; OE's classifier only sees
  `kind: 'custom-element'`).
- `C.upstream-cem-never-self-selects-ssr` PASS: after trivial kind mapping, every classification is
  `client-only`. **CEM extraction is confirmed orthogonal to SSR-provider selection and hydration
  compatibility**: generic CEM data carries no SSR/hydration facts, and OE's classifier derives
  tiers exclusively from the OE-authored `openElement` block (which the experiment's PoC does not
  synthesize — it remains in `POLICY_BY_CLASS`).

### D. Compiled form (compileElementModule output, ~64 KB pre-sourcemap-strip)

Bare upstream: 0 attributes, no tagName (`D.bare-upstream-gap` PASS — the compiled statics
(`__compiledProps`/`props`) and `__partProgram`/`__elementMetadata` JSON are opaque to upstream).
With the OE PoC plugin: full restoration — tag `open-button`; 6 attributes with types, real
defaults, `reflect: true`; default slot + `control` part walked from `__partProgram.template`;
`open-click` event survives compilation and is found by upstream's default pipeline. Note: the
analyzer's phase order required deferring metadata application to `moduleLinkPhase` (the metadata
consts precede the class in source order) — a real integration constraint, now encoded in the PoC.

### E. Foreign corpus (pinned expectations)

`tags=[v044-interop-child-host, v044-lit-probe, v044-native-probe, v044-stencil-probe]` in both
default and all-frameworks (lit+fast+stencil plugins) modes; native probe's `value` attribute found
without framework plugins; Lit probe's `value` found only with litPlugin; **FAST probe entirely
unseen** (`V044FastProbe.define({name, template})` static-call form is not the decorator style the
analyzer's fastPlugin recognizes); **no events anywhere** (parameterized `emit()` helper defeats
literal-name extraction — OE's `parseEvents` has the same limitation); no slots/cssParts (upstream
has no template/innerHTML scanning; slots/parts come from JSDoc `@slot`/`@csspart` conventions).
The fixture's hand-written `compiler-output.cem.json` (4 tags incl. slots/parts) shows the truth
upstream extraction cannot reach for these sources.

## Time and memory

| Measurement                                              | Value                                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Harness total (recorded run)                             | ~125 ms                                                                                                              |
| Phase A (10 authored components, analyzer+lit+OE plugin) | ~40 ms (~4 ms/file)                                                                                                  |
| Phase D (compile + 2 analyzer runs)                      | ~66 ms                                                                                                               |
| Phase E (2 analyzer runs over foreign corpus)            | ~12 ms                                                                                                               |
| Phase B / C                                              | sub-millisecond / few ms                                                                                             |
| Process RSS (Deno.memoryUsage)                           | ~184 MB warm; ~440 MB on the first (cold-cache) run; heapUsed ~48 MB                                                 |
| npm install footprint (Node-side measurement)            | 9.7 s warm npm cache (24.6 s cold, measured 2026-09-09); node_modules 47 MB, 82 lockfile packages, 45 top-level dirs |

These are single-host, fixed-corpus harness measurements — not production build-time claims.
Unavailable/not measured: per-phase allocator-precise memory (RSS deltas are process-global);
Bun/Cloudflare runtimes (NOT RUN); CPU beyond wall-clock.

## Known limitations (explicitly NOT tested)

- Analyzer CLI (`cem analyze`), watch mode, and `--dependencies` resolution mode (the harness uses
  the programmatic `create()` API; the npm `rs-module-lexer` postinstall was blocked by the local
  allow-scripts policy without affecting the API path).
- Multi-module inheritance resolution (`apply-inheritance`) — OE components are one class per file
  extending `OpenElement`.
- The other 9 components' compiled forms (only open-button compiled; the mechanism is uniform but
  unproven per-component).
- A production-grade OE plugin (the PoC covers tag/slots/parts/description/kebab/compiled-metadata;
  it does not implement `CustomEvent<detail>` inference or the `this.dispatchEvent` recall gap —
  both closable locally, mirroring `generate-ui-manifest.ts` `parseEvents`).
- Adoption mechanics: import-map/lockfile addition, consumer format migration (upstream emits
  standard CEM `modules[].declarations[]` with `kind: 'class'`; OE's manifest is non-CEM and its
  classifier expects `kind: 'custom-element'` — a mapping or consumer change is required and was
  deliberately not made here).
- bun, deno deploy, and CI execution of the harness (NOT RUN; the harness is wired as the root
  `experiment:cem` task, not into any gate).

## Decision

**PROCEED with conditions** for Alpha-stage evaluation of upstream CEM extraction with OE policy
retained locally — an Alpha INPUT, not Alpha admission, and not a completed production migration:

1. Scope of any replacement is only the generic extraction inside `tools/generate-ui-manifest.ts`
   (tag/attributes/events/slots/cssParts/description). `POLICY_BY_CLASS` and the `openElement`
   block authoring stay local; `cem-scanner`/`cem-compat` (consumer path) stay unchanged. This
   record does NOT justify deleting all local extraction logic.
2. Adoption must carry an OE plugin in the shape of `tools/experiments/cem/oe-plugin.ts` plus the
   analyzer's bundled litPlugin; the compiled-form path must read `__elementMetadata`/`__partProgram`
   (bare upstream extracts nothing there).
3. Pinned gaps must be closed or explicitly accepted: `globalThis.dispatchEvent` event recall,
   `CustomEvent<detail>` generic inference, kebab-cased attribute names (latent — no camelCase
   attribute-backed property exists today), FAST `.define()` sources (only relevant if OE ever
   synthesizes CEM for foreign packages; out of scope today).
4. A format decision (adapter mapping vs. migrating `generated-manifest.json` to standard CEM) is
   required before removal of the local extractor; this record demonstrates both shapes and the
   `kind` mismatch concretely.

This satisfies the Beta.2.2 exit criteria (reproducible commands/versions/results, explicit
decision) and does not claim alpha.1 admission.
