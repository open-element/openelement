---
status: active
topic: M10-0 preparation (unsigned)
summary: Unsigned M10-0 preparation: current-source capability inventory, replacement reachability gaps, an observer over the emitted browser entry graph and per-file migration methods; P1–P5 NOT MET, no sign-off.
---

# M10-0 preparation — unsigned capability inventory and migration method

Date: 2026-11-15. Baseline: `e7aad2f1f2d96447bfd8f73e421563ea9e4c3855`
(`feat(alpha16): qualify generated host interop and prepare CEM input migration`),
branch `feat/alpha16-integration`, clean working tree before this change.

## Status and non-claims

M10-0 is a document-local label (§13.1): not a milestone, gate or rename of
M10a. This is the first half of D-③ — a tracked inventory carrying
`sign-off: none` — not an exit record and not P5 evidence.

- **Owner sign-off: none.** No §13.5 sign-off is requested, recorded or implied.
- **Production-equivalent replacement count: not claimed.** No number is asserted, including zero; it is the §13.5/§15.1 P5 metric.
- **P1–P5 are independently NOT MET.** None is inferred from another; P1 and M11-3 remain two verdicts of one joint integration (§13.1).
- **No milestone/gate status.** No M09 exit, M10 progress, M11 start gate, gate/test/build/browser/packed record or release claim.
- **No owner decision created or changed.** D-①/②/③ stand as docketed; D-② is the recorded input-migration method, D-③ the two-step tracking instruction. No new signature or scope selection is introduced.
- **No status flip.** M10 stays "Not started", `16b-MN` rows stay OPEN, the docket blocking set is unchanged; facts landed by the baseline commit are recorded as facts only.
- **No write outside this document and the generated architecture index.**

## 1. Inputs and provenance

Authorities: [execution plan](./alpha16-18-execution-plan.md) §13–§15, [M09 exit docket](./alpha16-m09-exit-docket.md), [16b-MN](./16b-migration-note.md), [M01 matrix](./m01-consumer-migration-matrix.md), [evidence baseline](./evidence-baseline.md), [compiler IR and ABI boundary](./compiler-ir-and-abi-boundary.md), [ADR-0174](../adr/ADR-0174-generated-code-runtime-and-compatibility.md). An external working draft informed this note; it is not authority and is not linked here. Every fact is re-derived at the baseline SHA.

Provenance is **advisory**: read-only inspection at the cited commit (Appendix A); no test/build/gate/browser/packed run; counts are source-shape counts, not a compiled graph; no machine-specific path is recorded. Not a §13.6 gate record.

## 2. Authoring lanes at the baseline

| Lane | Contract | Production use at the baseline |
| --- | --- | --- |
| Class/decorator (retirement target) | `compileElementProgram` (`packages/compiler/src/internal/compiler/semantic-core/compile.ts:109`) → `buildPartProgram` (`emit-program.ts:105`) → `emit-module.ts`; emits Part Program v2 plus ABI v2 statics `__partProgram`, `__compiledProperties`, `__elementMetadata`, `__observedAttributes`, `__computedFields` (`emit-module.ts:295,354-360,528`; versions `packages/protocol/src/part-program.ts:22,37`) | **64** class modules: www 38, `apps/saas` 14, `packages/ui` 6, `packages/create` templates 6; plus **80** `tests/fixtures` modules |
| Server function page (alpha15) | `compileServerComponentIfAdmitted` (`semantic-core/server-component.ts:631`); emitted code calls `__h`/`__t`/`__ssr` from `@openelement/element/server` (`:97-101,887-892`) | **10** www page routes |
| Generated Native Custom Element (M09 candidate) | `compileGeneratedElementIfAdmitted` (`semantic-ir/generated-element/compile.ts:92`); leaf + narrow descriptor + generated class + optional `__ssrHost` (`emit.ts:401-451`), **no `__partProgram`**; wired at exactly three build hosts (`cli/build-client.ts:1007`, `cli/build-ssg.ts:519`, `vite/plugin-hmr.ts:61,94`) | **0** production; 1 fixture module (`tests/fixtures/web-component-interop/app/islands/interop-generated-host.tsx`, `ssr: false`) |

Route surface: **49** page route modules (www 37, `apps/saas` 12), of which
**39** import a class page component and **10** (all www) use the server
function page form. Counts are re-derived at this SHA; no draft count is copied.

## 3. Capability inventory

C = current class-lane capability; R = replacement in the tree; G = gap / owning
obligation. Every row is NOT production-equivalent; none is closed.

| # | Capability | C (source anchor) | R (source anchor) | G |
| --- | --- | --- | --- | --- |
| LC | Lifecycle | `connectedCallback`/`disconnectedCallback`, hooks `onDsdHydrated`/`onCsrRendered`/`clientActivate`, auto-cancelled `_setTimeout`/`_requestAnimationFrame` (`packages/element/src/open-element-implementation.ts:286-306,424-445`) | shell owns connect/disconnect, **no author callbacks**; `createBindings` is allocation-only (`generated-element/shell.ts:60-78,218-248`) | no author setup/cleanup API or effect ownership. `16b-LC` OPEN |
| EB | Error boundary | `ErrorBoundary` + kernel service; lifecycle bodies wrapped `try/catch → _captureError` (`emit-module.ts:475-510`); SSR boundary retry (`public-runtime.ts:960-975`) | none; generated shell/leaf catch only to dispose then rethrow | boundary API, capture points and SSR fallback absent. `16b-EB` OPEN |
| CTX | Context | `create/provide/consume/releaseConsumedContext` (`public-surface.ts:62-70`); runtime service `runtime/context.ts` | none in function frontend or generated lane | authoring + generated wiring absent. `16b-CTX` OPEN (TSX-13) |
| REF | Refs | class ref grammar (`semantic-core/lower-program.ts:785-808`) but public facade passes `refs: {}` (`open-element-implementation.ts:147`) → `HOST_REF_MISSING` (`runtime/hydrate.ts:795-805`, `runtime/parts.ts:359-363`) | intrinsic ref only, client-only; element → cleanup → null (`generated-leaf/generate.ts:459-487,1705-1755`) | host/component refs, lifetime and class-ref disposition undecided. `16b-REF` OPEN |
| STYLE | Component styles | `static styles` from `.css` (`semantic-core/style-imports.ts:110-170`); style-edge registry, light `@scope(tag)`, shadow `adoptedStyleSheets`, SSR links | none: descriptor/shell/emit carry no style field; an island `.css` import has no registered edge | generated-island style declaration + shadow delivery; §13.3/§14 **deferred obligation** (replacement path exists); M11 re-verifies |
| PROPS | Declared props | `@property` String/Number/Boolean/Array/Object/`trustedHtml`, `reflect`, `attribute:false`, computed (`semantic-core/analyze-module.ts:548-640`); non-primitive consumers `open-article-view`, `open-reading-shell`, `notes-live` | generated `properties` table + fresh-literal factories (`generated-element/site.ts:498-565`, `emit.ts:238-281`); shell conversion | no SSR property seed; `resolveGeneratedElementProps` (`shell.ts:725`) only inside `__ssrHost`, no production caller. §14.2 row; round-trip tests OPEN |
| FORMS | Form association/validity | `formAssociated`; `ElementFormController` `setFormValue`/`setValidity`/`onReset`/`onRestore` (`open-element-form.ts:60-97`); protected `_internals` (`open-element-implementation.ts:313-317`) | generated `formAssociated`; shell owns internals, value/required/disabled, required→`valueMissing`, reset/restore (`shell.ts:635-677,1025-1145`) | no author validity-policy channel or full constraint mirroring; no form e2e re-run on a generated CE. §14.2 row + `16b-MN` OPEN |
| CEM | Manifest chain | class-branch input reads `@element`/`extends OpenElement` (`packages/ui/tools/generate-ui-manifest.ts:344,389-444`); CEM 2.1.0 `generate-cem.ts`; tracked manifest/CEM; gates `ui-manifest:check`, `ui-cem:check`, packed-copy equality (`tools/release/check-package-artifacts.ts:318-330`) | D-② input migration, fixture-first committed at the baseline: `generated-element-facts.ts` reads the emitted constructor identity, `generate-ui-manifest.ts` gains injectable root/site-fact dispatch, `generate-cem.ts` an in-memory projection | live `packages/ui/src` tag source not wired; no packed read-back; no one-SHA gate pair. `16b-MN` CEM row OPEN |
| SERVER | SSR/stream | `renderToString` reads program; request-time `__ssr` reads `__compiledProperties`/`__partProgram.metadata.properties` (`packages/element/src/server.ts:260-316`) | `__ssr` leaf producers + `__ssrHost` for shadow hosts (`generated-element/emit.ts:425-451`) | `__ssrHost` has no production caller; `renderToString` fails closed without a program (`public-runtime.ts:765-802`); local island default `ssr+client` (`entry-descriptor.ts:690-712`) would fail at build. P2 NOT MET |
| ABI | Module contract/protocol | six ABI v2 statics; protocol `./part-program` export, versions 2/2 (`protocol/package.json:29`); runtime reads `__partProgram` (`public-runtime.ts:769-802`, `route-dispatch.ts:60-75`) | generated tail is the narrow ABI (descriptor + `createRecipe` + tag); shell subpath `./internal/compiled/generated-element/shell` (`element/package.json:16`, ADR-0177 deviation) | 64 production modules still compile to `__partProgram`; narrow ABI has 0 production modules; no protocol-export retirement; snapshot unchanged. P4 NOT MET |
| BUILD | Build/SSG | text readers: blocks scan `__partProgram` + `"blocks":[` (`island-blocks-scan.ts:117`), CSS/scope recovery parses `__partProgram` (`compiled-artifact-style-requests.ts:35-50,190-205`), class candidates read `__oeClassCandidates` (`compiled-artifact-class-candidates.ts:32`) | generated lane wired at the three build hosts; registration is constructor-based (`entry-client-codegen.ts:33-56,125-162`) | CSS recovery, blocks detection and route classification still read the old artifact. P3 NOT MET; M01 C12/C13 unchanged |
| ROUTER | Page/route contract | `isElementPageClass` reads runtime `__partProgram` (`router/src/authoring.ts:445-448`); page tag from `__partProgram.tag` (`renderer-runtime.ts:141-155`); stream identity `{version,tag}` (`route-dispatch.ts:60-75`, `stream-runtime.ts:555-580`, `types.ts:36-56`); build-time `functionPage` fact (`route-scanner.ts:265-295,355-372`) | island registration accepts any constructor; build-time page facts exist for function pages | no build-time classification for class pages and no page-tag/stream facts for generated pages. M01 C07–C11 unchanged; P1/M11-3 not done |

## 4. Replacement reachability

Replacement mechanisms exist in the tree; **none is reached from an actual
production entry graph** at the baseline: the generated CE client lane has 0
production modules, the generated-CE SSR host has no production caller, the CEM
input path is fixture-only (no live tag source), non-primitive seed and form
policy do not exist, the author lifecycle/error/context/ref APIs are OPEN, and
the narrow ABI has 0 production modules. The production-equivalent replacement
count is not claimed (§Status).

## 5. P1 graph observer over the emitted browser entry graph

P1: no production browser entry loads the generic executor or the old protocol
(§12a; ADR-0174). Scope is the plan's existing one — **every applicable
production browser entry graph** — not a selectable or narrowable set; this
design adds no owner-signature input and no new gate.

Input is the client build's actual artifact,
`dist/client/.vite/oe-browser-entry-graph` (emitted by the client-build lane;
schema owned there), read with `dist/client/.vite/manifest.json`,
`dist/island-manifests/*.json` and `dist/.openelement/ssg-pages.json`.

The observer is a report, not a gate:

1. Read each emitted entry record as-is: its **actual chunk closure** and
   **rendered modules**. No graph is re-derived from source, package manifests
   or chunk file names.
2. Parse the artifact's diagnostics and report them verbatim; a parse failure,
   missing artifact or incomplete entry/closure is **UNPROVEN** — never pass,
   never silently skipped.
3. Intersect each entry's rendered modules and chunk closure with the artifact
   classifier's **actual generic-executor identities** (owned by
   `oe-browser-entry-graph`; this note re-lists none). Only those identities
   feed `legacyHits` and the P1 verdict. A protocol/service residue that also
   appears (the `./part-program` module or another old service module) is
   **report-only**, never folded into P1.
4. Emit a deterministic report `{entries, chunkClosure, renderedModules,
   legacyHits, reportOnlyResidues, diagnostics, verdict: "hits" | "clean" |
   "UNPROVEN"}`; empty input is UNPROVEN, not clean.

P1 owes a clean-SHA build that emits the artifact, an observer run with parsed
diagnostics recorded and zero `legacyHits`, and that observation in the evidence
form. No qualifying artifact run is recorded by this preparation (the
client-build lane is in progress) and this note runs nothing: **P1 is UNPROVEN
and NOT MET**. Protocol/service residues reported alongside are P4/P2 evidence
inputs, not P1 hits.

## 6. Per-file class→function migration method

Method per class module; this is not the final-SHA matrix P5 requires, and the
page form (server function page vs generated-element page) is an M11 design
question, not decided here.

| Code | Method | Blocking gaps (tracked) |
| --- | --- | --- |
| D1 | Declarative page (props + render): function page form; route/page facts migrate with C07/C08/C11 | route classification/page identity; P1/M11-3 |
| D2 | Declarative component (props/slots/computed): generated lane conversion | non-primitive seed if needed; style declaration if `static styles`; CEM live input if published |
| D3 | Imperative component (hooks/timers/effects/`ElementInternals`): author API decisions first | `16b-LC`/`EB`/`REF`; §14.2 forms row; author API unanswered |
| D4 | Class island: generated-CE function island through the M09 lane | `16b-LC`; M11 SSR host; style declaration; non-primitive props where present |
| D5 | Starter template: current class authoring shipped to users | Alpha17 owns Starter migration (§13.4) |
| D6 | Page layout shell: D1 plus the router layout contract | route/page facts; M11 layout contract |

| File | Capability dependencies (source) | Method |
| --- | --- | --- |
| `apps/saas/app/components/page-admin.tsx` | props, array-prop | D1 |
| `apps/saas/app/components/page-auth-callback.tsx` | props | D1 |
| `apps/saas/app/components/page-checkout.tsx` | props, array-prop | D1 |
| `apps/saas/app/components/page-home.tsx` | render/slots | D1 |
| `apps/saas/app/components/page-login.tsx` | props | D1 |
| `apps/saas/app/components/page-magic-link.tsx` | props | D1 |
| `apps/saas/app/components/page-notes.tsx` | props, array-prop | D1 |
| `apps/saas/app/components/page-recover.tsx` | props | D1 |
| `apps/saas/app/components/page-reset-password.tsx` | props | D1 |
| `apps/saas/app/components/page-signup.tsx` | props | D1 |
| `apps/saas/app/components/page-upload.tsx` | props, array-prop | D1 |
| `apps/saas/app/components/page-workspace-records.tsx` | props, array-prop | D1 |
| `apps/saas/app/islands/notes-live.tsx` | lifecycle, island, props, array-prop | D4 |
| `apps/saas/app/shell.tsx` | styles | D6 |
| `packages/create/templates/app/components/page-404.tsx.tmpl` | styles | D5 |
| `packages/create/templates/app/components/page-about.tsx.tmpl` | styles | D5 |
| `packages/create/templates/app/components/page-home.tsx.tmpl` | styles | D5 |
| `packages/create/templates/app/islands/live-timer.tsx.tmpl` | styles, lifecycle, island, props | D5 |
| `packages/create/templates/app/islands/my-counter.tsx.tmpl` | styles, island, props | D5 |
| `packages/create/templates/app/layout.tsx.tmpl` | styles | D5 |
| `packages/ui/src/open-button.tsx` | styles, hooks, computed, internals, focus, props | D3 |
| `packages/ui/src/open-code-block.tsx` | styles, timers, internals, props | D3 |
| `packages/ui/src/open-dialog.tsx` | styles, lifecycle, hooks, internals, effect, focus, props | D3 |
| `packages/ui/src/open-dropdown.tsx` | styles, hooks, computed, props | D3 |
| `packages/ui/src/open-input.tsx` | styles, hooks, computed, internals, focus, props | D3 |
| `packages/ui/src/open-theme-toggle.tsx` | styles, lifecycle, hooks, timers, focus, props | D3 |
| `www/app/components/article-routes/architecture-architecture.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/architecture-comparison.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/architecture-design-system.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/architecture-dsd.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/architecture-islands.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/architecture-web-component-admission.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-api.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-compiled-grammar.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-configuration.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-core-concepts.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-deploy-cloudflare.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-deployment.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-error-handling.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-getting-started.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-glossary.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-i18n.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-islands-and-ssr.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-mdx.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-recipe-form-actions.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-recipe-island-strategies.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-recipe-theming.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-routing-and-data.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-security.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-streaming.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-styling.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-testing.tsx` | props, object-prop | D1 |
| `www/app/components/article-routes/guide-tutorial.tsx` | props, object-prop | D1 |
| `www/app/islands/open-cinematic-scroll.tsx` | lifecycle, island | D4 |
| `www/app/islands/open-dragon-live-gaze.tsx` | lifecycle, island | D4 |
| `www/app/islands/open-hero-polish.tsx` | styles, lifecycle, island | D4 |
| `www/app/islands/open-search.tsx` | lifecycle, computed, island, props, array-prop | D4 |
| `www/app/layout.tsx` | computed, props | D6 |
| `www/app/site-ui/open-article-view.tsx` | styles, computed, props, array-prop, object-prop, trustedHtml | D2 |
| `www/app/site-ui/open-artifact-panel.tsx` | render/slots | D2 |
| `www/app/site-ui/open-page-rail.tsx` | lifecycle, computed, props, array-prop | D4 |
| `www/app/site-ui/open-reading-shell.tsx` | computed, props, array-prop, object-prop | D2 |
| `www/app/site-ui/open-section-frame.tsx` | render/slots | D2 |
| `www/app/site-ui/open-standards-visual.tsx` | computed, props | D2 |

The 10 server function page routes are already function form (not class modules;
their build-time page fact exists at `route-scanner.ts:265-295,355-372`). The 49
route modules are descriptors; 39 import the components above. `www/app/islands/open-page-rail.tsx`
is a re-export shim, so the class module appears once under `site-ui/`.

## 7. P1–P5

| Proof | Verdict | Current-source reason | Evidence owed |
| --- | --- | --- | --- |
| P1 browser runtime | **NOT MET** | production islands are class modules with `__partProgram`; the default element entry installs the compiled hydration executor (`packages/element/src/index.ts` imports `runtime/hydrate-install.ts`); 0 production generated-lane modules; no emitted entry-graph artifact in this checkout | clean-SHA `oe-browser-entry-graph` + observer run with parsed diagnostics and zero legacy hits (§5) |
| P2 server runtime | **NOT MET** | request-time `__ssr` reads `__compiledProperties`/`__partProgram`; `renderToString` fails closed without a program; `__ssrHost` has no production caller; the generated-host fixture is client-only | M11 server wiring + a generated-CE SSR path at one SHA |
| P3 build/SSG | **NOT MET** | blocks scan, CSS recovery, class candidates and route classification read the emitted markers/runtime property | emitted build facts replacing the readers, at one SHA |
| P4 ABI/module contract | **NOT MET** | 64 production modules compile to the six ABI v2 statics; narrow ABI 0 production modules; `./part-program` still public; snapshot unchanged | narrow ABI on every production module, no `__partProgram` in production output |
| P5 public API | **NOT MET** | public surface still exports `OpenElement`, `ErrorBoundary`, `element`/`property`, context API, `StyleSheet` (`public-surface.ts:19-21,62-70,146-155`); `16b-MN` rows OPEN; no signed inventory, final-SHA matrix or owner sign-off | this inventory signed, final-SHA matrix, `16b-MN` evidence, owner sign-off |

## 8. Sign-off

`sign-off: none`. No M10-0 inventory sign-off, no §13.5/P5 sign-off and no P1–P5
verdict signature is recorded or requested. §13.5 stays in force: a draft does
not satisfy P5.

## 9. Remaining gaps and unverified items

1. **Final-SHA matrix absent.** §6 is a method table, not the §13.6-recorded per-file matrix P5 requires.
2. **P1 unverified.** No qualifying `oe-browser-entry-graph` observer run is recorded by this preparation; P1 is UNPROVEN.
3. **`16b-MN` evidence absent.** Per-capability rows and the `16b-LC`/`EB`/`CTX`/`REF` acceptance matrices are not delivered.
4. **CEM live input absent (D-② phase 2).** Live `packages/ui/src` tag source, packed read-back and a one-SHA `gate:release`/`gate:packed` pair are missing.
5. **Retained obligations open.** Non-primitive property seed (§14.2), forms policy (§14.2), deferred generated-island style declaration (§13.3/§14), and the author API questions behind the four `16b-*` slices.
6. **Evidence limits.** No test/build/gate/browser/packed run backs this note; counts are source-shape, not a compiled graph; the local `www/dist` predates the entry-graph artifact and is not evidence.
7. **M11 start gate unmet.** Tracking M10-0 preparation does not satisfy it; P1–P5 remain NOT MET.

## Appendix A. Commands

Read-only, at `e7aad2f1f2d96447bfd8f73e421563ea9e4c3855`.

```sh
git rev-parse HEAD && git status --porcelain
git grep -l "extends OpenElement" -- 'www/**/*.tsx' | wc -l                    # 38
git grep -l "extends OpenElement" -- 'apps/saas/**/*.tsx' | wc -l              # 14
git grep -l "extends OpenElement" -- 'packages/ui/src/*.tsx' | wc -l           # 6
git grep -l "extends OpenElement" -- 'packages/create/templates/**/*.tsx.tmpl' | wc -l  # 6
git grep -l "extends OpenElement" -- 'tests/fixtures/**/*.tsx' | wc -l         # 80
git ls-files 'www/app/routes/**/*.tsx' 'www/app/routes/*.tsx' | wc -l          # 37
git ls-files 'apps/saas/app/routes/**/*.tsx' 'apps/saas/app/routes/*.tsx' | grep -v 'app/routes/api/' | wc -l  # 12
for f in $(git ls-files 'www/app/routes/**/*.tsx' 'www/app/routes/*.tsx' 'apps/saas/app/routes/**/*.tsx' 'apps/saas/app/routes/*.tsx' | grep -v 'app/routes/api/'); do
  grep -qE "^import [A-Za-z0-9_]+ from '.*components/" "$f" && echo "$f"       # 39 rows
done
for f in $(git grep -l "defineIslandConfig" -- 'www/**/*.tsx' 'apps/**/*.tsx' 'tests/fixtures/**/*.tsx'); do
  grep -q "export default function" "$f" && ! grep -q "@element(" "$f" && echo "$f"   # 1: interop-generated-host
done
ls www/dist/client/.vite/ 2>/dev/null   # at this SHA: manifest.json only; no qualifying artifact run recorded
git show e7aad2f1f:packages/element/src/open-element-implementation.ts | sed -n '286,306p'   # anchor form
```

## Appendix B. Anchors

Every `path:line` anchor is a baseline-tree anchor, readable with
`git show e7aad2f1f:<path> | sed -n '<from>,<to>p'`; ranges name the symbol, not
necessarily the minimal range. The Git-ignored `www/dist` in this checkout is a
stale build with no `oe-browser-entry-graph`; it is not evidence for this note.
