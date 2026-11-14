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
- **No write outside this document, the existing generated-element seam row in the [seams registry](./seams.md), and the generated architecture index.**

This working-tree addendum (§3.1) records the source facts — the compiler-owned
host-export metadata and its two build-time consumers (the island scan and the
internal entry descriptor) — and updates the existing generated-element seam row
in the [seams registry](./seams.md) (P8); it
adds no front-matter change or generated-index write and flips no status or
verdict.

## 1. Inputs and provenance

Authorities: [execution plan](./alpha16-18-execution-plan.md) §13–§15, [M09 exit docket](./alpha16-m09-exit-docket.md), [16b-MN](./16b-migration-note.md), [M01 matrix](./m01-consumer-migration-matrix.md), [evidence baseline](./evidence-baseline.md), [compiler IR and ABI boundary](./compiler-ir-and-abi-boundary.md), [ADR-0174](../adr/ADR-0174-generated-code-runtime-and-compatibility.md). An external working draft informed this note; it is not authority and is not linked here. Every fact is re-derived at the baseline SHA.

Provenance is **advisory**: read-only inspection at the cited commit (Appendix A) for the baseline facts, plus a source read of the entry-graph observer/checker added by this revision (§5), and in the §3.1 working-tree addendum a source read of the M11-prerequisite host-export metadata, its build-scan carrier and its entry-descriptor carrier plus LOCAL compiler and router test runs of their guards; no build/gate/browser/packed run; counts are source-shape counts, not a compiled graph; no machine-specific path is recorded. Not a §13.6 gate record.

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
| SERVER | SSR/stream | `renderToString` reads program; request-time `__ssr` reads `__compiledProperties`/`__partProgram.metadata.properties` (`packages/element/src/server.ts:260-316`) | `__ssr` leaf producers + `__ssrHost` for shadow hosts (`generated-element/emit.ts:425-451`), and the same emitter decision returns the emitted host-export name as build-only metadata (`ssrHostExport`, §3.1) | `__ssrHost` has no production caller and the new build metadata has no request-time render consumer — only the build-time island scan carries it (§3.1); `renderToString` fails closed without a program (`public-runtime.ts:765-802`); local island default `ssr+client` (`entry-descriptor.ts:690-712`) would fail at build. P2 NOT MET |
| ABI | Module contract/protocol | six ABI v2 statics; protocol `./part-program` export, versions 2/2 (`protocol/package.json:29`); runtime reads `__partProgram` (`public-runtime.ts:769-802`, `route-dispatch.ts:60-75`) | generated tail is the narrow ABI (descriptor + `createRecipe` + tag); shell subpath `./internal/compiled/generated-element/shell` (`element/package.json:16`, ADR-0177 deviation) | 64 production modules still compile to `__partProgram`; narrow ABI has 0 production modules; no protocol-export retirement; snapshot unchanged. P4 NOT MET |
| BUILD | Build/SSG | text readers: blocks scan `__partProgram` + `"blocks":[` (`island-blocks-scan.ts:117`), CSS/scope recovery parses `__partProgram` (`compiled-artifact-style-requests.ts:35-50,190-205`), class candidates read `__oeClassCandidates` (`compiled-artifact-class-candidates.ts:32`) | generated lane wired at the three build hosts; registration is constructor-based (`entry-client-codegen.ts:33-56,125-162`) | CSS recovery, blocks detection and route classification still read the old artifact. P3 NOT MET; M01 C12/C13 unchanged |
| ROUTER | Page/route contract | `isElementPageClass` reads runtime `__partProgram` (`router/src/authoring.ts:445-448`); page tag from `__partProgram.tag` (`renderer-runtime.ts:141-155`); stream identity `{version,tag}` (`route-dispatch.ts:60-75`, `stream-runtime.ts:555-580`, `types.ts:36-56`); build-time `functionPage` fact (`route-scanner.ts:265-295,355-372`) | island registration accepts any constructor; build-time page facts exist for function pages | no build-time classification for class pages and no page-tag/stream facts for generated pages. M01 C07–C11 unchanged; P1/M11-3 not done |

### 3.1 M11 prerequisite — compiler-owned host-export metadata (producer, build-scan carrier and entry-descriptor carrier)

Working-tree addendum, 2026-11-15: on top of `bc99cdee1` (which commits the
SSR-metadata producer read here) plus the uncommitted build-scan and
entry-descriptor carrier lane (the tree also carries other lanes' edits; this
addendum reads only the host-export metadata surface, its build-scan and
entry-descriptor carriers and their guards). It is
not a baseline-`e7aad2f1f` fact and not a §13.6 record.

The generated-element emitter already owns the one decision that appends the DSD
host producer; that decision is now readable as build metadata instead of being
re-inferred from the emitted text.

- **One producer, the same decision.** `generateElementModule`
  (`packages/compiler/src/internal/compiler/semantic-ir/generated-element/emit.ts`)
  computes `hostWrapper` once (a shadow descriptor root plus a leaf-emitted
  `<Name>__ssr`, the same decision that appends
  `export function <Name>__ssrHost`) and returns the appended export name as
  `ssrHostExport` on the same result. `compileGeneratedElementIfAdmitted`
  (`.../generated-element/compile.ts`) copies it onto `CompiledGeneratedElement`.
  That entry is already exported from the compiler's public entry
  (`packages/compiler/src/compiler.ts`), so the field rides the existing public
  return shape: no new export, subpath, runtime class static or module-shape
  convention is added, but the already-public return shape gained one field —
  the interface snapshot's shape delta is recorded in
  `docs/release/public-interface-snapshot.json`, regenerated at `bc99cdee1` with
  `@openelement/tools-repo#interface:snapshot:write`; this working-tree
  addendum neither writes nor re-verifies it.
- **Build-only, return-only.** The field adds no emitted byte, map segment or
  tail line: the module stays the leaf prefix plus the unchanged tail, the
  source map and placements stay the leaf's, and the field name never enters the
  module text. The identity is the compiler's own emitted export name; a scan of
  the module namespace or a re-derived `__ssrHost` suffix is a second naming
  protocol (lossy, false-positive-prone and not bundler-rename safe) and is
  rejected, so a consumer reads the metadata instead of guessing a name.
- **`null` means no producer, not an error.** A hostless emitter call (no site
  fact), a light or absent descriptor root, and a shadow root whose leaf emitted
  no `<Name>__ssr` all answer `null`; a module the lane does not admit or
  refuses still returns no result at all. Whether an SSR-admitted shadow island
  may answer `null` is an owner policy decision and is not implemented here:
  `null` is metadata, never an admission verdict.
- **Two build-time consumers — the island scan and the internal entry descriptor — and nothing at request time.**
  `scanIslandMeta` (`packages/router/src/vite/internal/ssg/island-scanner.ts`)
  already reads every island source for its static sidecar facts; in the same
  pass it resolves each scanned `.tsx` island through
  `resolveGeneratedElementHost`
  (`packages/router/src/vite/internal/ssg/generated-element-host-metadata.ts`)
  and attaches the result to the scanned record as
  `LocalIslandMeta.generatedElementHost` (a typed carrier; the public
  `IslandDecl`/`EntryDescriptor` shapes are unchanged). The resolver calls the
  same public `compileGeneratedElementIfAdmitted` on the source the scan already
  read and the same `createGeneratedElementSiteResolver`
  (`packages/router/src/vite/generated-element-site.ts`) site fact the transform
  hosts use, so the scan's admission and tag cannot diverge from the transform's;
  the recorded name is the compiler's returned `ssrHostExport`, never a
  namespace/suffix scan or a class static. The resolver hands the compiler a
  project-anchored module id (`stableModuleId(fullPath, projectRoot)`, the same
  anchoring `island-blocks-scan` uses); `scanIslandMeta` takes that project root
  as its third argument (the Vite plugin's resolved root, the SSG build root, or
  the cwd fallback), so a carried refusal diagnostic stays project-relative
  instead of naming a machine path.
  That carrier's one downstream consumer is the internal entry descriptor in the
  same build stage: `buildEntryDescriptor`
  (`packages/router/src/vite/internal/ssg/entry-descriptor.ts`) re-reads each
  local island's `generatedElementHost` through the one typed accessor
  `readGeneratedElementHost` and re-attaches it to the declaration it emits
  (delivery aliases included), where the approved registration/renderer slice
  will pair it with the class registration. The public
  `IslandDecl`/`EntryDescriptor` protocol types are unchanged (the identity is
  build-only runtime metadata on the declaration object), and the re-attachment
  changes no generated-entry bytes — no generated host import, no registration
  argument and no render invocation — and adds no policy, coded error or
  admission status.
- **Five distinct kinds, an admission-independent record.** The carrier is a
  discriminated union: `producer` (host export present, with the compiler's
  emitted name), `missing-producer` (a shadow root that was admitted but whose
  leaf emitted no `<Name>__ssr`), `light-no-producer` (a light or absent root,
  where the emitter appends no host by design), `lane-declined` (`non-tsx`,
  `site-not-admitted`, or the lane's structural opt-out such as a class-owned
  module) and `lane-refused` (the compiler refused; its authoritative
  source-located, project-relative diagnostics ride the carrier). A refusal is
  data here: the scan does not throw a second, source-less copy, and the
  transform stays the build-failure reporter; only the compiler error dialect is
  converted, while any other error propagates instead of being recorded as a
  refusal. `ssr:false` and `hydrate: 'only'` islands are
  classified the same way — the carrier records what the compiler did and the
  existing admission record and consumer still decide delivery, so the
  `ssr:false` admission path is unchanged.
- **One producer for build and dev, at a bounded cost.** The build's
  `buildStart` scan and the dev island rescan (`rescanIslands` →
  `scanIslandsIntoCtx`) both run the same `scanIslandMeta`; the dev rescan
  replaces `phase1.islandMeta` with the fresh result, so an edited source
  re-derives the carrier and a removed or changed sidecar cannot leave a stale
  host identity behind. Cost: one extra `compileGeneratedElementIfAdmitted` call
  for each `.tsx` island the scan records (a canonical sidecar is required) on
  every scan — the build scan plus each dev rescan — including `ssr:false`
  islands; there is no second filesystem read (the scan
  reuses the source it already read) and no cache. The carrier adds no
  fail-closed admission, no new coded diagnostic or policy and no admission
  status change.
- **No request-time consumer; M11 and P2 are not advanced.** The scan records the
  identity and the internal entry descriptor re-attaches it; both sit in the
  build stage. Nothing request-time reads it: `renderEntry`/generated-entry
  codegen emits no generated host import, no registration argument and no render
  invocation, the static host registration in `entry-client-codegen.ts`, the
  registration seam and the SSR render path are unchanged, `__ssrHost` still has
  no production caller, and the generated-host fixture stays client-only. No
  entry wiring, SSR registration, host-attribute normalization, packed or
  browser record is added. **M11 is not started and P2 remains NOT MET**; §7 is
  unchanged.
- **Guard (producer).** `packages/compiler/__tests__/semantic-ir/generated-element.ssr-host-export.test.ts`
  — 8 Node tests: the shadow producer's `ssrHostExport` is the named export its
  own emitted AST declares; `null` for a hostless emitter call, a light/absent
  root and a shadow root whose leaf has no `<Name>__ssr`; the compile result
  adds exactly the one field over the pre-M11 keys with byte-identical
  code/map/tail; non-admitted modules and the fixed-name-collision refusal still
  return no result. LOCAL run on this dirty tree at this revision —
  `node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-element.ssr-host-export.test.ts`
  → 8 passed; development feedback, not clean-SHA evidence.
- **Guard (build-scan consumer).**
  `packages/router/__tests__/island-scanner-generated-host.test.ts` — 12 Node
  tests: the carrier reports the compiler's own returned `ssrHostExport` for the
  same project-anchored module id, never a name re-derived by the router, and
  the string is an export the emitted module declares; `missing-producer` for an
  admitted shadow module whose leaf emits no `<Name>__ssr`; `light-no-producer`
  versus `lane-declined` for a light generated island versus class-owned light
  and shadow islands; a `non-tsx` decline; a `lane-refused` whose diagnostics
  equal the authoritative compiler call's and carry project-relative file ids,
  including an explicit project-root run where the cwd is not the project root;
  `ssr:false` still classified (both the missing-producer and the real-producer
  shapes) with its existing admission record; an absent carrier reading as
  undefined; a dev `rescanIslands` re-deriving the carrier from the edited
  source with no stale identity; and a mocked non-compiler crash propagating
  instead of being recorded as a refusal. LOCAL run on this dirty tree at this
  revision —
  `node_modules/.bin/vitest run --project router packages/router/__tests__/island-scanner-generated-host.test.ts`
  → 12 passed; development feedback, not clean-SHA evidence.
- **Guard (entry-descriptor carrier).**
  `packages/router/__tests__/entry-descriptor-generated-host.test.ts` — 7 Node
  tests: `buildEntryDescriptor` re-attaches the scanner-resolved identity
  through the one typed accessor `readGeneratedElementHost` for every local
  island and every delivery alias; every identity kind is carried verbatim,
  including `lane-declined` and `lane-refused`; an `ssr:false` island keeps the
  identity while its admission plan stays client-only; generated-entry bytes
  are unchanged by the carrier — no generated host import, no registration
  argument and no render invocation; non-local and carrier-less declarations
  expose no identity; an absent carrier reads as `undefined`. LOCAL run on this
  dirty tree at this revision —
  `node_modules/.bin/vitest run --project router packages/router/__tests__/entry-descriptor-generated-host.test.ts`
  → 7 passed; development feedback, not clean-SHA evidence. The existing
  Generated Native Custom Element seam row in the [seams registry](./seams.md)
  carries the producer contract, the build-scan and entry-descriptor carriers
  and all three guards (P8); no duplicate row is added, and the request-time
  host-build/render consumer guard and registration remain owed by M11 and are
  not claimed here.

## 4. Replacement reachability

Replacement mechanisms exist in the tree; **none is reached from an actual
production entry graph** at the baseline: the generated CE client lane has 0
production modules, the generated-CE SSR host has no production caller (the
compiler can now name the emitted host export as build metadata and the
build-time island scan carries it, but no request-time render or registration
path reads it, §3.1), the CEM input path is fixture-only (no live tag
source), non-primitive seed and form policy do not exist, the author
lifecycle/error/context/ref APIs are OPEN, and the narrow ABI has 0 production
modules. The production-equivalent replacement count is not claimed (§Status).

## 5. P1 graph observer and checker over the emitted browser entry graph

P1: no production browser entry **loads** the generic Part Program executor
(plan §12a; ADR-0174). The observed surface is the plan's existing one —
**every applicable production browser entry graph** — not a selectable or
narrowable set; this design adds no owner-signature input and no new gate.

The instrument is an observer/checker pair, read from the source added by this
revision (read-only; no build or artifact run is recorded by this note):

- **Writer.** `packages/router/src/vite/internal/browser-entry-graph.ts` is the
  one observer: the `open:browser-entry-graph` plugin, mounted only by the
  router client build (`packages/router/src/cli/build-client.ts`), with one
  `moduleParsed` hook and one `generateBundle` hook. It has no
  `resolveId`/`load`/`transform` hook and never calls `this.error`/`this.warn`:
  a build must not fail because its evidence instrumentation had a bad day. A
  capture it cannot complete is still emitted as `status: "incomplete"` with
  internal reason/diagnostic codes only (no paths, no bundler messages).
- **Artifact path.** One deterministic JSON document at
  `<clientOutDir>/.vite/oe-browser-entry-graph.json` (for `www`:
  `www/dist/client/.vite/oe-browser-entry-graph.json`), the same trust class as
  Vite's own `.vite/manifest.json`: Git-ignored build output under `dist/`,
  never a tracked generated surface. The schema, the id normalization and the
  evaluator are owned by
  `packages/router/src/vite/internal/browser-entry-graph-artifact.ts`.
- **Complete artifact.** `schemaVersion: 1`,
  `kind: "open-browser-entry-graph"`; `producer` (package + version; no
  timestamp),
  `app` (workspace-relative root, client outDir, base), `element` (packageRoot +
  version), `entry` (moduleId + chunkFile), `islands` (tag, specifier,
  moduleId, strategy, chunkFile), `chunks` (file, entry flags, facade,
  static/dynamic/implicit edges, rendered modules and byte contribution) and
  `parsedModuleIds` (pre-tree-shake), plus the writer's `predicate` summary.
  The checker recomputes that summary from the chunk facts and compares it for
  self-consistency only; it never trusts it.
- **Determinism and privacy.** No timestamps; sorted arrays and stable JSON, so
  two builds of the same input emit byte-identical artifacts. Module ids are
  normalized, machine-independent spellings: query suffixes stripped; an
  absolute id becomes workspace-relative; a `node_modules` id keeps only the
  installed package spelling (the pnpm store collapsed); an outside-package id
  becomes `pkg:<name>/<path>`; the style-asset `\0` virtual id (base64url of an
  absolute sheet path) is decoded and re-anchored instead of published opaque.
  An unknown virtual id, an unnormalizable id, two raw ids landing on one
  emitted spelling, a module in two chunks, or an ambiguous entry makes the
  capture `incomplete`, never an artifact carrying a machine path.
- **Checker.** `tools/repo/check-browser-entry-graph.ts` (task
  `@openelement/tools-repo#browser-graph:check`) is the one reader: it takes
  one or more artifact paths and judges exactly those — there is no embedded
  app list, no `--all`, no baseline, allowlist or update flag. Verdicts are
  the evaluator's `MET`, `VIOLATED`, `UNPROVEN`; the process exits 0 when every
  supplied artifact is MET, 1 when at least one is VIOLATED (a proven
  violation dominates mixed inputs), and 2 when no VIOLATED artifact exists but
  one is UNPROVEN (including a missing or unreadable file) or the CLI usage is
  wrong. `--json` emits the deterministic
  `openelement.browser-entry-graph-check/1` document with the same per-artifact
  verdicts. The checker is a standalone report tool, not a gate step: no step
  is added to `gate:source` or `gate:release`.
- **Fail-closed.** A missing, unreadable, non-JSON, foreign/older-schema,
  `incomplete`, malformed, structurally untrustworthy (dangling or unreachable
  chunk, ambiguous module/chunk attribution, unparsed facade), drifted
  gate-list or self-inconsistent-summary artifact is `UNPROVEN` — never `MET`,
  never silently skipped. The gate is six executor **entry** modules matched by
  exact identity (the resolved element package root plus the package-relative
  path), never by suffix, substring or implementation closure; the frozen
  table's `sha256` digest is recorded in the artifact, so a checker from another
  revision refuses to judge rather than applying a different claim.
- **Report-only.** Executor support modules, server-private
  serializer/resources, the class-authoring surface, the generated-leaf/neutral
  surface (including `@openelement/protocol`'s `part-program.ts`) and
  parsed-only executor residues are reported for the evidence record and never
  change the verdict. A protocol/service residue is a P4/P2 input, not a P1
  hit.
- **Trust boundary.** The artifact is **trusted build output, not
  authenticated JSON**. Recomputing the predicate catches writer bugs,
  truncated/partial captures, structural forgery and accidental exact-match
  bypasses; it cannot authenticate provenance — an actor who can write the
  artifact can write a coherent MET document. Trust is the provenance of the
  evidence record: exact commit, clean tree, exact command, and the artifact
  `sha256` recorded there. A green checker run is not an app-completeness
  claim; which applications are covered is the evidence record's claim, not the
  tool's.

The consumer tests pin the instrument, not the tree: the router suite
(`packages/router/__tests__/browser-entry-graph.test.ts`) drives real router CLI
and direct Vite builds (a class-island build evaluates VIOLATED; the generated
shell/neutral build MET; forged, missing, malformed and incomplete artifacts
UNPROVEN; observer purity and byte-determinism; the decoded style-asset id; no
machine path), and the checker suite
(`tools/repo/check-browser-entry-graph.test.ts`) pins the failure directions and
the CLI contract. They are tool proof — they neither flip P1 nor certify a
production app. The seam is registered in the
[seams registry](./seams.md) with these consumer-form guards (P8).

At this baseline no **qualifying** artifact run is recorded, so P1 remains
**UNPROVEN and NOT MET**. A qualifying run owes a clean-SHA, clean-tree build
that emits the artifact, the checker's `MET` verdict with the report-only
categories and the gate-list digest recorded, and the artifact `sha256` in the
evidence form.

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
| P1 browser runtime | **NOT MET** | production islands are class modules with `__partProgram`; the default element entry installs the compiled hydration executor (`packages/element/src/index.ts` imports `runtime/hydrate-install.ts`); 0 production generated-lane modules; no qualifying entry-graph artifact run is recorded (the local Git-ignored build output is not evidence) | a clean-SHA, clean-tree build emitting `<clientOutDir>/.vite/oe-browser-entry-graph.json`, the `@openelement/tools-repo#browser-graph:check` `MET` verdict with the report-only categories and gate-list digest recorded, and the artifact `sha256` in the evidence form (§5) |
| P2 server runtime | **NOT MET** | request-time `__ssr` reads `__compiledProperties`/`__partProgram`; `renderToString` fails closed without a program; `__ssrHost` has no production caller and its compiler-owned build identity (`ssrHostExport`, §3.1) has only the build-time island scan as a carrier consumer, no request-time render or registration consumer; the generated-host fixture is client-only | M11 server wiring + a generated-CE SSR path at one SHA |
| P3 build/SSG | **NOT MET** | blocks scan, CSS recovery, class candidates and route classification read the emitted markers/runtime property | emitted build facts replacing the readers, at one SHA |
| P4 ABI/module contract | **NOT MET** | 64 production modules compile to the six ABI v2 statics; narrow ABI 0 production modules; `./part-program` still public; snapshot unchanged | narrow ABI on every production module, no `__partProgram` in production output |
| P5 public API | **NOT MET** | public surface still exports `OpenElement`, `ErrorBoundary`, `element`/`property`, context API, `StyleSheet` (`public-surface.ts:19-21,62-70,146-155`); `16b-MN` rows OPEN; no signed inventory, final-SHA matrix or owner sign-off | this inventory signed, final-SHA matrix, `16b-MN` evidence, owner sign-off |

## 8. Sign-off

`sign-off: none`. No M10-0 inventory sign-off, no §13.5/P5 sign-off and no P1–P5
verdict signature is recorded or requested. §13.5 stays in force: a draft does
not satisfy P5.

## 9. Remaining gaps and unverified items

1. **Final-SHA matrix absent.** §6 is a method table, not the §13.6-recorded per-file matrix P5 requires.
2. **P1 unverified.** No qualifying entry-graph artifact run (clean SHA, clean tree, exact command, artifact `sha256`) is recorded by this preparation; the observer/checker source is read only, and P1 is UNPROVEN.
3. **`16b-MN` evidence absent.** Per-capability rows and the `16b-LC`/`EB`/`CTX`/`REF` acceptance matrices are not delivered.
4. **CEM live input absent (D-② phase 2).** Live `packages/ui/src` tag source, packed read-back and a one-SHA `gate:release`/`gate:packed` pair are missing.
5. **Retained obligations open.** Non-primitive property seed (§14.2), forms policy (§14.2), deferred generated-island style declaration (§13.3/§14), and the author API questions behind the four `16b-*` slices.
6. **Evidence limits.** No test/build/gate/browser/packed run backs this note except the §3.1 LOCAL compiler and router guard runs (dirty-tree development feedback, not clean-SHA evidence); counts are source-shape, not a compiled graph; the local Git-ignored `www/dist` is unrecorded build output and is not evidence.
7. **M11 start gate unmet.** Tracking M10-0 preparation does not satisfy it; the §3.1 host-export metadata has only the build-time island-scan carrier and no request-time M11 render/registration consumer exists; P1–P5 remain NOT MET.

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
ls www/dist/client/.vite/ 2>/dev/null   # Git-ignored build output; a local artifact is not evidence (no recorded run)
git show e7aad2f1f:packages/element/src/open-element-implementation.ts | sed -n '286,306p'   # anchor form
```

## Appendix B. Anchors

Every `path:line` anchor is a baseline-tree anchor, readable with
`git show e7aad2f1f:<path> | sed -n '<from>,<to>p'`; ranges name the symbol, not
necessarily the minimal range. The Git-ignored `www/dist` in this checkout is
build output, not evidence: no exact-SHA, clean-tree, command or artifact-hash
record backs any artifact a local build leaves there.
