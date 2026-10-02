# alpha7 design-principles review (post-graduation)

Status: RECORD OF REVIEW — run against `docs/architecture/design-principles.md`
after the alpha.7 graduation (`737a1cb7e`, train A0–A2.5). The four findings
below were dispositioned in the same pass; the fixes landed on the
`review/alpha7-design` branch. Verdicts cite what was read or measured at
review time, not what should be true.

## Findings and dispositions

### 1. [P2] The A0.2 wire increment had no comply-or-explain record — fixed as ADR-0160 Amendment 5

A0.2 (#1495, "catalog server-runtime and build-time errors with stable codes")
added the `code` field to the error records the framework serializes to
clients: the streaming timeout record (`record.error`) now carries
`OE_STREAM_DEFERRED_TIMEOUT`, and the request-time failure channel
(`serveError`) phases cataloged failures into the wire frames and the
problem+json responses. Adding a field to a client-visible record is runtime
surface; P2's litmus — "Does this add build-time surface or runtime surface?
Runtime surface needs an ADR." (design-principles.md:80-81) — therefore
applied, and the framing was missing: ADR-0160 Amendment 4 recorded the
cataloging's scope and bare-`Error` boundary but not the protocol layer.

Fixed: ADR-0160 Amendment 5 records the increment comply-or-explain under P2,
freezes the invariant (message text verbatim; `code` purely additive; renaming
a shipped code or editing a frozen message re-opens the amendment), and cites
#1495/#1496.

Measured at review time, because the train's own numbers needed separation:
the wire increment is the record field over Amendment 4's seven router tables
(26 conversions). The "25 OEC codes / 128 call sites" figure carried by the
alpha.7 CHANGELOG is a different, build-time surface — the element compiler's
`OEC9000`-series diagnostics (25 distinct codes; 128 quoted `OEC####` literals
across package sources, identical before #1495 and at HEAD — the compiler
catalog predates the train and #1495 changed zero OEC sites). Both numbers are
real; only the record field rides the wire. Amendment 5 records exactly that
attribution.

### 2. [P6] ROUTER_CLIENT_RUNTIME_ENTRIES was an ungated parallel list — fixed with a consumer-side drift guard

`tools/lib/vp-pack.ts:63-72` hand-lists the eight router client-runtime
modules the pack must deliver as explicit entries, because the consumer build
resolves them by file path (`runtimeModulePath`,
`packages/router/src/cli/build-client.ts:238`) and no package-internal import
edge keeps them reachable. That list is a second source of truth for a fact
the consumer side already knows — P6's exact case — and nothing failed when
they diverged.

Fixed: `tools/lib/vp-pack.test.ts` gains a drift guard that extracts the
path-consumed set from the consumer's own sources — the `runtimeModulePath`
literal roots in `build-client.ts` plus the transitive closure of their static
VALUE imports (type-only imports are erased at transpile and never execute a
module), parsed with the same TypeScript compiler the repo ships — and
asserts set equality with `ROUTER_CLIENT_RUNTIME_ENTRIES`, never reading the
list to build the extracted side. A ninth path-consumed module (a new
`runtimeModulePath` branch or a new value import from a root) that misses the
entries list turns the guard red; a non-literal `runtimeModulePath` argument
fails closed instead of being silently skipped; the stale-list direction is
asserted too. The red path itself is proven on synthetic fixtures in the same
file (a value-imported ninth module is captured; a type-only import is not) —
the real list was not mutated for the proof.

### 3. [P5] deno-pack era dead weight — swept where clear-cut, listed where not

The A1 swap (#1496) retired `deno pack` as the payload generator; the grep
sweep below is the residue classification. Only clear-cut dead weight moved:
present-tense claims that the retired generator is the current one, and
exported machinery whose only purpose was the retired generator's pipeline
and which has zero production callers. Historical, audit-trail, and
unverifiable-behavior references stayed.

Cleaned (clear-cut dead):

- `tools/lib/compiled-pack-staging.ts` — deleted `stageCompiledPackWorkspace`,
  `StagedPackWorkspace`, `DenoJsonShape` and the private `copyPackageDir`:
  the deno-pack staging workspace, superseded wholesale by `prepareVpStagingFiles`
  (production imports only `compilePackageElementModules` — publish-npm.ts:173).
  Header re-era'd; the test's strictly-typed-emission pins were retargeted
  onto the live compile function instead of the deleted staging copy.
- `tools/lib/declaration-closure.ts` — deleted the dropped-declaration warning
  classifier family (`classifyDroppedDeclarationWarnings`,
  `warnedDeclarationCandidates`, `DroppedDeclarationWarning`,
  `ClassifiedDeclarationWarnings`): it classified `deno pack`'s
  "Could not generate types" diagnostics, and the pipeline's only consumer
  (the pack-log classifier) was deleted in the A1 swap. `buildDeclarationClosure`,
  `declarationCandidates`, and `packageRootDeclarationIo` stay — the closure
  is the live structural declaration-integrity check (per the exception doc's
  "Retirement"). Header re-era'd; the closure-graph tests keep their
  reachability coverage.
- Present-tense generator attributions corrected in live files:
  `tools/release/pack-surface.ts:4`, `tools/lib/deterministic-tar.ts:4`
  ("`vp pack` produces/is the sole generator" — the swap is the recorded fact),
  `tools/release/npm-manifest.ts` (header ×2 and the repack-proof failure
  string, now generator-neutral), the two packed-world comments in
  `packages/router/src/cli/build-client.ts` and
  `packages/router/src/vite/dev-island-client.ts` (the payload's no-raw-TS
  property is generator-neutral and was verified against
  `assembleVpPackageTree`), and `tests/e2e/starter-smoke/setup.ts` (the
  no-`deno.json` mechanism holds under `vp pack`'s `STAGING_SYNTHESIZED`).
- `docs/maintainers/releasing.md` candidate step 2 now states the current
  reality: the generator is `vp pack`; the deno-pack diagnostic exception is
  retired with the A1 swap (audit trail retained) and every pack warning
  fails closed.

Listed, deliberately untouched (kept value or needs a maintainer decision):

- `docs/maintainers/deno-pack-diagnostic-exception.md` — marked RETIRED,
  kept as the audit trail with a written reintroduction condition, and
  load-bearing: `tools/repo/check-deno-floor.ts` reads it as required text.
  Its "现存价值" is exactly that: history plus the do-not-reintroduce rule.
- `tools/release/native-pack-check.ts` + the `pack:native-check` task — the
  native `deno pack --dry-run` proof is still wired into the live
  `gate:packed`; its header still says deno pack "is the sole" generator.
  Whether the native proof should stay in the gate under the vp regime (and
  what it then proves) is a release-design decision, not comment rot.
- `tools/release/published-consumer-qualification.ts:521-535` — the
  `--local` mode of `nodeEsmSmoke` still EXECUTES `deno pack --allow-dirty`
  to build a local element tarball. CI never passes `--local`
  (published-consumers.yml uses `--mode`/`--smoke`), so it is a manual-only
  path producing a payload shape nobody ships; repointing it at the vp
  pipeline (which packs the whole workspace) or retiring the flag is a
  tooling-behavior decision.
- `.github/workflows/autoflow-ci.yml:577-580` +
  `tools/repo/check-ci-contracts.test.ts:264` — the Windows exclusion's
  rationale cites the deno-pack-on-Windows types-condition defect. The
  exclusion itself is live policy pinned by the CI-contract test; whether
  Windows is admissible under vp pack is unverifiable without a Windows run,
  and workflow edits carry the zizmor ritual.
- `packages/router/src/internal/host-path.ts:9-11` — the no-`@std/*` rule
  stays (the `pathe` boundary is live); the stated reason is the deno-pack
  JSR→npm bridge mapping. Whether the vp staging derives the same mapping is
  unverified here.
- `packages/element/src/jsx-runtime.ts:15` / `jsx-dev-runtime.ts:12` — the
  inline JSX-namespace declaration stays; the "does not survive `deno pack`
  declaration emit" reason names the retired generator's dts behavior. The
  equivalent vp/tsdown claim is unverified without running a pack, and the
  live `consumer:packaged` gate catches a regression either way.
- Kept as accurate history: `docs/adr/ADR-0108` (its title is the era's
  decision), `docs/adr/ADR-0152:39`, the CHANGELOG, the A1-written mentions
  inside `tools/lib/vp-pack.ts` and `docs/maintainers/pack-post-processing.md`,
  `tools/release/publish-npm.ts:371` (explains the zero
  `knownUpstreamPrivateWarnings` field), and `tools/lib/npm-tarball.ts:4`
  (naming-convention provenance; the operative spec follows the colon).

### 4. Platform catch-up review: nil-return

The per-release platform catch-up review (design-principles.md:183-189) is
recorded as a nil-return for alpha7: the train introduced no framework code
the platform has newly made redundant and no new platform-duplicated code.
The review stays on record so the nil-return is a decision, not an omission.

## Positive verdicts

### A2.5 is the P7 textbook case (#1498)

The four-question gate's fourth question — "What is the nearest mature prior
art, and is our difference deliberate?" — has a model answer in the JSX text
whitespace fix. The prior art is named in the implementation itself:
`packages/element/src/internal/compiler/semantic-core/lower-program.ts:122`
declares "the facebook/jsx whitespace rules exactly as the React toolchain
implements them (Babel's `cleanJSXElementLiteralChild`, TypeScript's JSX
transformer)", and the three rules (node-boundary stripping, interior
newline-folding, sibling-delimiting-run removal) are a line-by-line port of
that contract, with the difference from the old collapse-everything behavior
articulated as the React semantics rather than a local preference. Nothing
was invented where the ecosystem had already answered; the port makes
React-family formatters safe on OpenElement JSX by construction.

### A0.3 executed P6 as written (#1495)

The island media-query bound is the small case of "single source, no parallel
mechanism" done right: two ingestion paths that must stay separate by design
(authoring-time `defineIslandConfig()` with `IslandErrorCode`; build-time
generated-artifact intake with `DeliveryErrorCode`) now agree through one
module — `packages/router/src/internal/island-media.ts` owns the length bound
and the combined bound-plus-control-characters predicate, "so the two paths
cannot drift". The validators keep their own error dialects (no forced
unification); only the shared fact moved to one source.

### declarationTypeEdges: two extractors, named defense

`tools/release/consumer-packaged-shared.ts:110` keeps two extractors over the
same declaration text with deliberately divergent semantics, and the
divergence is documented at the function rather than left as trap: the leak
scan must see every specifier, while the resolution walk follows type-bearing
edges only — because side-effect-only imports carry no consumer type surface,
"and the vp generator emits them faithfully into `.d.ts` where the previous
generator (deno pack) dropped them", so a packed declaration graph may now
reference an optional peer purely for module-order fidelity. This is not a
drift-prone copy; it is one fact class per consumer, each named. The P6
complaint would apply if the two sets agreed by coincidence with no written
reason; they do not.

## Case study: the JSX whitespace incident (A2 → A2.5)

The A2 reformat (#1497) — 570 files, one-time repo-wide reformat under the
new oxfmt engine — ran directly into a coupling the design principles exist
to prevent: the element compiler's JSX text lowering collapsed every
whitespace run to one space, so the multiline JSX layout oxfmt produces did
not serialize like the inline layout (`40⏎<span>4</span>` rendered `40 4`,
not `404`). The reformat had to work around the renderer's source-layout
sensitivity instead of the layout being rendering-inert — a formatter-versus-
renderer coupling where the product's output depended on how source happened
to be formatted.

The root-cause fix is A2.5 (#1498): re-base the JSX text lowering onto the
React contract (finding above) so formatted-source layout serializes
identically to inline layout. The lesson generalizes past this incident:
when a build-tooling change must bend around a product behavior, that
bend is the defect — pay the root cause (one semantics change in the
compiler), not the workaround (format-coupled ignores, which A2 still
carries for byte-audited fixtures and which can now be measured for
retirement against the fixed semantics).
