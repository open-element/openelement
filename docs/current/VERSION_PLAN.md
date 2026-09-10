# Active version plan: Beta.2.x convergence to 1.0 Alpha

OpenElement = Web Components-native fullstack application framework.

Current source package line: `v0.44.0-beta.2.1`
Current npm registry line: `v0.44.0-beta.2.1` (prerelease, dist-tag `beta`; npm `latest` remains the stable 0.43 line)
Latest landed train: `v0.44.0-beta.2.1`
Active release target: `v0.44.0-beta.2.1`
Active internal target: none — internal Alpha checkpoints closed at Alpha.10 (verifier PASS, #1150); the active line is Beta.2.x convergence before public 1.0 Alpha (ADR-0152)
Next planned public train: `v0.44.0-beta.2.2`

The existing five-package distribution follows [PACKAGE_SURFACE.md](./PACKAGE_SURFACE.md)
and ADR-0114; the shipped `nitro-mount` integration remains until its replacement
is qualified. These are baseline facts, not restrictions on ADR-0152's target.
Browser qualification covers Chromium, Firefox and WebKit.

Authority: [ADR-0152](../adr/ADR-0152-product-router-and-alpha-convergence.md).
Live train: [#1155](https://github.com/open-element/openelement/issues/1155).
Execution: [Project 3](https://github.com/orgs/open-element/projects/3).
Version anchors above remain synchronized projections required by existing tooling;
#1334 owns their generated-state consolidation. Actual version/publication state is in [release-state.json](../release/release-state.json)
and immutable release records; this plan describes intended work, not release proof.

## Objective and scope

Maintainer-approved refinement, 2026-09-08: Element and Router remain the two core
products; UI is dogfood/reference. Router offers explicit Route Mode and file-based
Framework Mode. Native and Lit are first-class Framework Mode targets, qualified
through separate rendering integrations and one application protocol. This is a
plan, not a claim that Lit Framework Mode already ships.

OpenElement directly maintains a public fork of Justin's URLPatternList. Generic
fixes are contributed upstream without blocking OE delivery. Returning to the
upstream package is optional, not a required exit. Product count does not mandate
package count. Existing implementation is reused only where its ownership fits.

## Tasks and checkpoints

Checkpoints are acceptance boundaries, replacing the former three-working-day
schedule. No elapsed deadline completes work, and no automatic Beta.2.4 exists.

| Checkpoint      | Scope                                                                                                               | Owners                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Beta.2 baseline | Preserve published evidence and identify inherited failures                                                         | #1155 / #1288                         |
| Beta.2.1        | Router correctness, independently maintained fork, SSG/navigation repair, standalone Element and prerelease tooling | #1320 / #1323 / #1324 / #1325 / #1338 |
| Beta.2.2        | Native/Lit application flow, minimal shared protocol, Document and public metadata                                  | #1321 / #1326 / #1327 / #1339         |
| Beta.2.3        | Dual-mode hardening, independent consumers, supported matrix, cleanup and Alpha admission                           | #1322 / #1328-#1334 / #1340           |

### Beta.2.1: routing and delivery foundation

- Fork `justinfagnani/url-pattern-list` into `open-element/url-pattern-list`, retaining
  history, MIT attribution and a compact divergence record. Verify the fork/package
  exists before claiming migration; package naming is an implementation decision.
- Independently test/build/release the fork; OE consumes an exact qualified package
  version with a lockfile. Delete the embedded production duplicate after migration.
- Preserve ordered first-match semantics. Explicit records keep registration order;
  file generation orders static, parameter and catch-all routes deterministically.
- Choose one URL record before method dispatch. Group methods on that record;
  unsupported methods return 405/Allow, HEAD fallback stays within the winner.
  Keep query/captures, base path, slash and full URL component policies explicit.
- SSG discovers eligible pages from canonical route metadata and renders through
  the real dispatcher, without recreating a Hono page matcher.
- Generic native navigation leaves POST forms to browser/server unless an explicit
  action protocol owns them. History/native fragment navigation and reload default
  to browser ownership; hash-router semantics remain distinct. Apply ownership
  checks before cancellation side effects. Each mount gets a fresh execution signal.
- Finish standalone Element tooling using the existing private compiler, packed
  plain-HTML consumers, source maps and separated browser/build/declaration graphs.
- Complete lossless multi-identifier prerelease comparison and release-tool consumers.
  Legacy oversized Number projection is P3 hardening, not a fabricated blocker.

### Beta.2.2: Native and Lit Framework Mode

Prove the same list/detail/form/validation/success/error application with Native and
Lit: file routes -> loader -> SSR -> client continuation -> navigation -> action ->
data refresh, including redirects, cancellation, back/forward and remount.

Extract shared protocol from both implementations rather than freezing a speculative
FrameworkAdapter API. Router owns route identity, data/action outcomes, errors,
redirects and cancellation; server Request context and browser context need not be
identical. Native owns compiled rendering/claim; Lit owns its SSR/hydration/update
integration. Neither integration introduces a second router or data scheduler.

Resolve Document metadata before serialization. Native reuses its existing serializer;
Lit uses its qualified rendering integration. Public sitemap/search consume eligible
route/catalog identity and metadata, never personalized request Documents. Remove
superseded post-build SEO mutation with equivalent metadata/output evidence (#1327).
Explicitly select the rendering integration; CEM classification is not automatic
SSR-provider detection. DSD alone is not hydration compatibility.

Use allowed fixtures or independent consumers; examples/** remains frozen (#1311).
Lit starts with an explicitly qualified reference server runtime; publish a truthful
runtime/feature matrix before first-class availability claims. Existing Native
runtime commitments are not silently reduced.

### Beta.2.3: product and release qualification

Qualify packed consumers for standalone Element, Router Route Mode without Element
runtime, Router Lit Framework Mode without Native compiler/runtime, and Native
Framework Mode. Split physical packages only if entry/graph boundaries require it.

Prove SSR/SSG, client continuation, JS-disabled pages/forms, HTTP semantics, resource
cleanup, navigation, fresh install, declarations, source maps and browser dependency
graphs. Measure build time, bundle size and matching memory/performance. Complete
support matrices, migration instructions and runnable documentation. No third
rendering framework is added in this checkpoint.

Cleanup accompanies every replacement; #1328-#1334, #1156, #1188/#1189 and #1192
retain their distinct obligations. Do not silently defer an existing acceptance
criterion or close an umbrella because one slice passed.

## Public 1.0 Alpha: validate the product contract

After #1340 admission, Alpha uses an independent real application (#1179) to test
whether product boundaries and APIs survive actual use. Alpha may revise architecture
and public interfaces with migration guidance; it is not an early RC freeze. Use one
substantial application in one mode and equivalent critical journeys in the other;
two complete SaaS implementations are not required.

#1234 identifies immutable artifacts/hashes/dependencies for each qualification round.
Fixes create new rounds and an evidence-impact assessment; invalidate affected results
and rerun required checks. Never combine different artifacts into a fictitious passing
candidate. Final RC admission evidence must cover the actual admission candidate.

- #1240 qualifies independent install/start/develop/build/deploy/upgrade and diagnostics
  for Element standalone, Router Route Mode, Native and Lit Framework Mode, building on
  Beta fixtures without substituting them for independent-repository evidence.
- #1241 owns mode-by-capability-by-runtime support; Native evidence does not qualify Lit.
- #1239/#1242 cover shared execution errors/cancellation and each renderer's long-running
  cleanup; retain leak bounds for DOM, listeners, effects, subscriptions and caches.
- #1235 is Element JFB evidence only; #1236 separates Router/application overhead from
  Native and Lit rendering/SSR/build costs. #1237 optimizes measured bottlenecks only.
- #1238 rechecks build/static-serving audit findings against current artifacts and
  preserves containment, concurrent-build integrity and predictable failure behavior.
- #1243 requires a fork maintenance exercise: generic regression -> fix -> fork package
  release -> OE dependency upgrade -> regression qualification. Upstream response is
  not a gate. #1187 binds release evidence to exact OE and dependency artifacts.

## RC and Stable: freeze and qualify the admitted contract

Dependency chain: #1340 -> #1179 and required #1234-#1242/#1187 -> #1243 RC admission
-> #1178 artifact freeze -> #1244 soak / #1245 install-security / #1246 triage
-> #1180 human GO -> #37 Stable closure. Alpha application validation never waits for RC.

#1178 freezes Element APIs/generated-artifact compatibility, Router/application protocol,
Native/Lit entry points, supported capability/runtime matrix, package hashes and the
qualified matching-fork/Lit dependency set. Independent dependency releases do not force
lockstep OE publication. Updating a candidate dependency creates a new artifact and
invalidates affected qualification. Architecture/public-contract changes return to Alpha.

Preserve at least fourteen days of RC soak with no unresolved P0/P1 regression, using
#1179's application on frozen RC artifacts and equivalent journeys in the other mode.
Record candidate changes and their effect on soak; no silent reuse of invalid evidence.
#1245 retains fresh install, promised stable/Beta/Alpha migrations, stable-to-compiled
rehearsal, exports/types/maps, production/static output, integrity/security/provenance.
#1246 classifies every RC issue; minor cleanup stays post-1.0, supported-mode blockers
cannot be waived because the other renderer passes.

#1180/#37 require human GO and consistent npm/tag/Release/provenance before closure.
The intended Stable target is 1.0.0 and the actually admitted package set, not legacy
0.44.0/five-package wording. Historical 0.41 exceptions and a seven-day post-release
watch do not substitute for current RC qualification. RC/Stable remain unscheduled.

## Non-goals

A third Framework Mode, automatic framework detection/plugin marketplace, another
public compiler API, full URLPattern grammar/parser, native/WASM acceleration,
complex incremental route mutation, UI expansion/replacement, generic RPC/ORM/cache/
queue infrastructure, mandatory package renaming or universal runtime SSR promises.

## Acceptance

- One production route authority across explicit/file records, browser, HTTP and SSG.
- Fork differential tests agree with the same-constructor ordered linear oracle;
  unsafe pruning uses conservative candidates merged in original sequence.
- Construction/hit/miss/memory baselines cover actual route distributions and the old
  implementation, not only linear scans. Record regressions as well as improvements.
- POST fallback, fragment/reload policy, dispose/remount and stale-result adversarial
  tests pass alongside full website and packed-consumer output checks.
- Native and Lit prove the shared flow before first-class support is advertised.
- Standalone product claims match installed artifacts and transitive runtime/types.
- All applicable final-SHA CI, fresh verifier and standing release GO requirements pass.

## Test matrix

Use focused tests for changes; exact-candidate PR CI is the full-matrix authority.
Chromium, Firefox and WebKit cover navigation and each admitted rendering integration.
Native retains Cloudflare-first, agreed Node/Deno qualification and Bun/Nitro smoke
scope. Lit runtime support is earned separately; unsupported/unverified cells remain
explicit. Real website, public-route IA, static output, JS-disabled forms and packed
consumers supplement unit tests. Missing evidence is not success.

## Release evidence requirements

`beta.2.1 -> beta.2.2 -> beta.2.3 -> 1.0.0-alpha.1 -> Alpha iterations -> RC -> Stable`.
Development may consume accepted contracts before intermediate npm publication.
Publication retains exact-SHA, provenance, protected promotion and release GO gates.
No automatic Beta.2.4; a failed checkpoint remains open. Public 1.0 Alpha uses `alpha`;
historic v0.44 alpha.0-alpha.10 remain unpublished workspace history. `latest` stays
stable until separately admitted Stable publication; RC/Stable remain unscheduled.

The [PR #1343 review failure](https://github.com/open-element/openelement/pull/1343#issuecomment-5579272257)
reports `APIError: Insufficient Balance`. Under the maintainer-approved 2026-09-09
policy, third-party AI review is supplemental and non-blocking. #1332 owns visible
provider/API error reporting; wrapper SUCCESS is never counted as completed review.
Provider failure contributes zero independent review evidence, but does not by itself
block merge. Required CI, the fresh verifier and human review remain actual merge
gates. Do not silently change model/provider or spend money to restore availability.
Recheck the final candidate; planning changes are not implementation or passing-CI proof.

## Infrastructure reduction proposal

The [source audit](../architecture/infrastructure-reduction.md) identifies deletion
candidates under #1156/#1333/#1332/#1334. WTR is the selected browser-conformance direction, qualified through a bounded
pilot, with Playwright E2E and Deno pure/runtime tests retained. Lit
upstream alignment helps browser reproductions; URLPatternList keeps its upstream
Node test conventions. This proposal does not claim a runner/backend migration has
passed or require Oxc/TS7 before current correctness fixes.

## Beta.2.x upstream-contribution priority (maintainer-approved)

Tool selection prioritizes a credible, repeatable path to useful upstream contributions,
not minimum local configuration, maximum speed or maximum deletion count. Additional
local integration effort is acceptable when it produces recipient-native reproductions
and maintainable generic patches. Correctness, supported behavior, provenance and release
requirements remain hard constraints. No PR-count target or upstream-response gate.

| Checkpoint | Upstream-oriented work                                                                                          | Ownership and acceptance                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beta.2.1   | Preserve source/history/test conventions in the matching fork; inventory generic infrastructure already adopted | #1324 keeps Node-native upstream tests and independent releases; #1156 separates generic tooling from OE rules. Current #1343 correctness gates remain; AI review follows the non-blocking policy above.                                                 |
| Beta.2.2   | WTR component conformance and Native/Lit integration reproductions                                              | #1333 pilots WTR with compiled ESM and all three browsers; #1339 separates generic Lit/WTR failures from Router integration defects. Oxc/TS7 executable migration preparation is scoped under #1156; production frontend replacement remains Alpha work. |
| Beta.2.3   | Consolidate browser fixtures/runner wrappers and retire replaced generic infrastructure                         | #1333/#1332 preserve coverage and fail-closed CI; #1156/#1330/#1331 retain thin OE rules only; #1327/#1334 remove duplicate writable truth before retiring checks.                                                                                       |

WTR is selected for alignment with Lit/Modern Web. Vitest is not an equal-default
alternative chosen merely for less glue; reconsider only if a concrete correctness,
distribution or sustainable-integration blocker is documented and the plan is revised.
Retain Playwright full-document E2E and Deno pure/runtime tests. Do not force WTR onto
URLPatternList's Node tests or Oxc's own harness. Reuse official compilation; no new
OE compiler API or permanent browser-runner abstraction.

Each migration identifies the recipient project, upstream source/version, generic
reproduction in its native harness, intended patch boundary and OE-only remainder.
Actual generic defects should be prepared for contribution under the repository's
contribution/authorization process. Do not invent defects or send cosmetic churn to
satisfy a gate. When no upstream defect exists, record why local cleanup is sufficient.
Upstream acceptance/timing never blocks OE release; sustained useful contributions,
not merged-PR totals, are the objective.

Oxc/TS7 work during Beta produces reproducible migration preparation: a representative
TSX-to-PartProgram experiment, differential corpus, CLI type/declaration and packed
consumer checks, source maps, Deno resolution and official build integration.
Full backend replacement remains separately evidence-gated in Alpha; it must not
expand #1343 or delay an existing correctness repair. No tool/fork is claimed installed
or qualified by this planning change.

## Approved maturation scope (2026-09-09)

Public 1.0 Alpha is an independently installable Web Platform-first framework with
compiled Web Components and a shared Native/Lit routing/application protocol. UI
remains reference/dogfood. Real application use begins at the public Alpha baseline
and continues through upgrades; Oxc and TS7 are implementation directions, not claims
of currently delivered product capability.

Beta.2.1 keeps its existing delivery/repair scope. Its inventory distinguishes already
adopted upstream infrastructure, duplicate local machinery and necessary OE semantics.
Beta.2.2 pairs WTR browser contracts with bounded Oxc/TS7 migration preparation (#1156)
and a platform audit in Native/Lit journeys (#1339). Beta.2.3 removes only qualified
replacements, verifies independent artifacts and hands off explicit adopt/defer/reject
results. Experimental success or full compiler migration is not a new alpha.1 gate;
existing correctness/security failures remain governed by existing release criteria.

Alpha actively pursues Oxc syntax-frontend and TS7 type/declaration adoption under
#1156, independently qualified rather than bundled into a mandatory rewrite. Existing
PartProgram, provenance/admission and Router semantics remain OE-owned. TypeChecker
consumers and Deno checking/packing are separate from the TS7 CLI. A temporary comparison
harness has an exit; no permanent dual production frontend or public generic AST API.
A documented blocker may defer adoption without automatically blocking RC. #1243
requires adopted changes to have one production owner and current artifact evidence.

The [maturation execution map](../architecture/alpha-maturation.md) defines concrete
experiments, platform tiers, deletion receipts, contribution boundaries and stop rules.
It refines #1156/#1333/#1339/#1330/#1331/#1332/#1327 and Alpha qualification issues.
No new alpha.2/alpha.3 numbering target or promise of a final large rewrite is made.
