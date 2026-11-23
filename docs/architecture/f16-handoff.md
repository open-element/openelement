---
status: active
topic: F16 handoff
summary: Where Alpha16 closeout stands, what remains, the traps that cost the most time, and how to verify.
---

# F16 handoff — Alpha16 closeout

Written 2026-11-23 for a fresh session. Read this before touching anything.

## 1. Where things are

| item | value |
| --- | --- |
| worktree | `.agents/worktrees/alpha16-retirement` |
| branch | `feat/alpha16-retirement` |
| HEAD | `b8085974d` |
| remote | `fork` = `SisyphusZheng/openelement`, **in sync** |
| PR | [open-element/openelement#1805](https://github.com/open-element/openelement/pull/1805) — `OPEN`, `MERGEABLE`, 100 commits, **+22,452 / −35,763 across 536 files** |
| worktree state | clean |

`origin` is `open-element/openelement` (upstream). The fork's DEFAULT branch is
`alpha15`, not `main` — a PR must target upstream `main`, which is what #1805 does.

## 2. What is DONE

The class component lane is deleted as one change set. **No file in the repo imports
the class compiler.**

Removed with no shim: `semantic-core/compile.ts` (`compileElementProgram`),
`emit-module.ts`, `emit-program.ts`, `style-imports.ts`, the class-shape half of
`analyze-module.ts`, the `open:core` transform's class branch, every barrel re-export,
`COMPILED_MODULE_ABI_VERSION`, the whole `__partProgram` serialization in
`public-runtime.ts`, six class modules (`open-element*`, `error-boundary`,
`facade-host`), `OpenElement` / `ErrorBoundary`, and the inert `element` / `property`
decorators.

`PART_PROGRAM_VERSION` **stays** — the runtime still validates the wire format on
revive. That is a different thing from the authoring lane.

Fixtures migrated: `router-base-path`, `router-ui-dogfood`, `router-request-time`,
`router-native-framework`, `site-light-probe`, both foreign-WC fixtures.

Breaking removals, recorded not softened:
- **`ErrorBoundary`'s cross-element containment is gone.** `onError` is
  element-scoped, two capture points, both update-phase.
- **`renderIntent.stream` retired** with the artifact it deferred against.

## 3. Measured state (read the caveat first)

**CAVEAT — THE ENVIRONMENT LOSES PLAYWRIGHT PERIODICALLY.** The
`~/Library/Caches/ms-playwright` directory has been wiped **twice** during this work
(installed once, gone ~11h later). When it is missing, ~13 router rows fail with
`browserType.launch: Executable doesn't exist` and the total jumps by that much. **Check
`ls ~/Library/Caches/ms-playwright` before believing any router number**, and never
attribute that error to a code change — I did once, and reverted a correct change
because of it.

| suite | result |
| --- | --- |
| element | **600 passed / 5 skipped** — green |
| compiler | **1314 passed / 2 failed** — both `browserType.launch` |
| saas | 150 — green |
| benchmarks | 4 — green |
| `check` | **5/5** |
| `www` site build | exit 0 |
| router | **41 failed / 1795 passed**, but **13 of the 41 are the missing browser**, so the code-level count is **~28** |

## 4. What REMAINS

### 4.1 Chinese doc mirrors — 5 files, 19 examples — LOW RISK, DO FIRST

`node www/tools/check-content-examples.ts` lists them:

```
streaming.zh.md (4)   routing-and-data.zh.md (4)   recipe-form-actions.zh.md (4)
error-handling.zh.md (4)   styling.zh.md (3)
```

Their **English twins are already clean** — rewrite each `.zh.md` against its `.md`:
same code blocks (translate only prose comments), same technical claims, Chinese prose.
This is translation sync, not design. Five files were already done this way
(`compiled-grammar.zh.md` alone was 51 examples and is now clean).

### 4.2 Dev style channel — 27 router rows — HARD, AND I FAILED AT IT FOUR TIMES

`dev-authored-css` 16, `dev-tailwind` 7, `dev-nonroot-base` 4.

**The runtime half EXISTS and is inert.** What is missing is the dev entry's injection.

- `GeneratedElementDescriptor.devLiveStyles` — `shell.ts:826`, normalized at `:966`,
  threaded at `:1513`.
- `adoptClientStyles` reads it off the CONSTRUCTOR (`shell.ts:2631`), *not* the
  descriptor, because the descriptor is a module-local constant the dev entry cannot
  reach. It adopts even into an adopted DSD root — that is the whole point.
- **Nothing writes `__oeDevLiveStyles` onto a registered class.** That is the missing
  piece.

**The trap that cost four rounds.** `styleAssetGraphId(registryKey)`
(`style-assets.ts:136`) produces `\0oe-style-asset:<b64>.js`. Generating
`import x from '<that id>'` into the dev style-links module 404s even after `resolveId`
was taught to answer the id — which is EVIDENCE that the request reaches the BROWSER's
module graph, so the answer must come from **dev-server middleware**, not a plugin hook.
**Start there.** Do not repeat the plugin-hook attempt.

Also open in this block and separable: the dev derivation of `routeDocumentStyleLinks`
does not join a PAGE MODULE's own sheet (P-2b) to its route. Adding that took
`dev-tailwind` from 7 to 6 but also added links to documents whose assertions count
them — it needs a measurement pass, not a guess.

### 4.3 The 13 browser rows

`stream-browser` 7, `router-browser` 4, `error-boundary-capture` 2. Reinstall Playwright
(`./node_modules/.bin/playwright install chromium`) and re-measure before concluding
anything.

### 4.4 Three class-authored fixtures — need NEW capabilities, not migration

- `router-request-time/app/islands/zag-combobox{,-light}.tsx` — their specs call
  **authored instance methods** (`demoSetControlledValue`, `demoSnapshot`) on the
  element. ADR-0182:405 states the generated lane has no authored-method capability.
- `router-native-framework/app/components/page-note-edit.tsx` — `<textarea>{body}</textarea>`.
  RCDATA makes a comment literal, so the claim anchor cannot be placed. The refusal is
  `OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT`, raised from
  `generated-leaf/generate.ts:3888` (`assertTextBoundaryContext`). **I tried four times
  and reverted four times.** The honest options are: (a) withhold the CLAIM and keep the
  SSR producer — but the mount path is gated on the same flag, which is where it broke;
  (b) record it as a breaking removal.
- `router-request-time/app/routes/{styled/[id],decoupled}.tsx` contain only
  COMMENT references to the old API — no action needed.

### 4.5 `gate:packed`

Passes its first six steps (packed sources, pack surface, typecheck of every packed
package). Stops at `consumer:packaged` because `@openelement/ui` depends on
`@openelement/*@1.0.0-alpha.16`, which is **not published**. Verified, not assumed: the
protocol tarball alone installs in 211 ms; the ui tarball alone fails with `notarget`.
**Not a source problem.** Needs a published alpha.16 or a local-registry override.

## 5. Traps that cost the most, in order

1. **P-5 was never a capability gap.** The first port omitted `root: 'shadow'`, the
   island became a light root, and the morph client correctly replaced it. Same root
   restored 114/114 and 342/342 across three engines. A "morph continuity contract"
   would have been built for a bug that does not exist.
2. **A nested light child's sheets DO hoist.** The failure was an ordering bug: a
   producer is a STRING BUILDER, so its `styleLinks` are read while the template is
   written and cannot be amended afterwards. Three attempts "proved the map has the
   URLs" and still shipped no link. Pre-fill the sink at expander CONSTRUCTION.
3. **MDX was four bugs wearing one label** — lowering shape, classification owner,
   page-root admission for a virtual module, and site-resolver spelling of the virtual
   id. Each hid the next. It is now DONE; do not re-open it.
4. **`emitted.lines` vs `stateLines`**: when debugging the leaf generator, the
   component-level gate and the chunk assembly are different places; a probe at the
   wrong one reads 0 and sends you chasing the wrong file.
5. **A stale generated manifest ships a subpath the artifact does not declare.**
   `generated-export-files.ts` is generated FROM the package exports map; the pre-push
   gate catches drift. Run `node tools/repo/generate-openelement-export-files.ts` after
   touching any package's `exports`.

## 6. Verify

```bash
./node_modules/.bin/vp run --no-cache --fail-if-no-match check          # 5/5
./node_modules/.bin/vitest run --project element                        # expect green
./node_modules/.bin/vitest run --project compiler                        # expect 2 browser rows only
node www/tools/check-content-examples.ts                                 # expect no output
ls ~/Library/Caches/ms-playwright                                        # BEFORE trusting router
./node_modules/.bin/vitest run --project router --reporter=dot
```

Gates that must pass before a push (the pre-push hook runs them and its output is
truncated by git — capture with `> /tmp/push.log 2>&1` or you will see only
`error: failed to push`).

## 7. How to run the remaining work

Adversarial acceptance is the point: the lead verifies, agents implement, and **no agent
may report success without a command and its output.** Partition by file ownership so
two agents never touch one file.

Suggested split:
- **Agent A** — the five `.zh.md` files. Gate: `check-content-examples` prints nothing.
- **Agent B** — dev-server middleware answer for the graph id (read §4.2 first).
- **Agent C** — the `<textarea>` decision: implement the claim/SSR split, or write the
  breaking-removal record. **Report before writing.**
- **Lead** — reinstall Playwright, re-measure the browser rows, and adversarially verify
  every claim: re-run the gate yourself, never accept "the agent said it passes".

Rules this work learned the hard way: push after every substantive commit (41 commits
once sat unpushed for 38 hours); state local-vs-remote sync in every report; and when
the same approach fails twice, change the approach instead of trying it a third time.

## 8. Closeout log (2026-11-23 session)

Pushed on `feat/alpha16-retirement` (all pre-push gates passed each time):

| commit | what |
| --- | --- |
| `bd6662693` | six stale zh mirrors + the alpha16-18 dispatch fence synced; `check-content-examples` zero diagnostics, exit 0 |
| `5fa9b8384` | dev live-sheet channel: the graph-id arm on the DEV style plugin (not middleware), client-entry imports and the constructor attach; dev-authored-css 21/21, dev-nonroot-base 5/5 |
| `d669f2ce5` | dev component-sheet linking for a class-only shadow island + page-module route links; dev-tailwind 12/12 |

Measured after `d669f2ce5`: browser rows 13/13 on chromium, firefox and webkit;
dev-authored-css 21/21, dev-nonroot-base 5/5, dev-tailwind 12/12. The "~27"
in §4.2 counted 12 rows that were only a missing-browser launch; the real
code-level count was 14, all green now. §4.2's middleware premise was wrong:
the 404 was an SSR module failing an unresolvable import, and the `/@id/` 200
came from the transform pipeline — the fix belongs in the dev plugin's
resolve/load hooks.

`<textarea>` RCDATA (§4.4) is recorded as an explicit breaking removal, not
implemented: `m08-text-boundary.md` §4 amendment + capability inventory. The
fixture's edit page migrated to the `value` property channel.

**Page-root prop seed — DONE (owner-approved 2026-11-23).** The discovery that
blocked the fixture gate was that a client-claimed page root silently wiped its
SSR content: `attribute: false` primitives had no SSR→claim wire (ADR-0181 A5),
so `#build-count` went `build-count=2`→`0`, `#note-title` was cleared and the
422 error branch disappeared. The owner approved extending the existing
`data-oe-prop-seed` JSON channel (which already carried non-primitives) to
supplied property-only primitives; ADR-0181 carries the dated A5 amendment and
`generated-host-props-seeding.test.ts` pins the new contract. The
`router-native-framework` fixture's four typed `definePage<Data>(…)` routes are
now admitted with a bare call (the loader/props/head annotations keep the
typing), and the edit route's projector names the declared rows
(`titleText`/`bodyText`). Measured: fixture typecheck PASS, build PASS, e2e
**132/132** (was 108/132 with the build red), edit page `/notes/:id/edit`
prefilled on all three engines with JavaScript on (`#title` "Seed note one",
`#body` "The first seeded note body.") and textarea-empty with JavaScript off —
the no-JS RCDATA prefill removal stands.

**Fixture e2e — GREEN, 132/132 on chromium, firefox and webkit.** The 7 rows
that remained after the seed fix were morph preservation rows, and the cause was
the admission itself: the morph client's island-survival tag list is emitted from
every admitted island, so a page root landed in it. A page root's real content is
its DSD shadow tree, so that branch either freezes it (light DOM only) or replaces
it — and it always looks "changed" once the claim has consumed the
`data-oe-prop-seed` transport attribute. The fix is two-part and pinned by unit
tests: the client entry emits a separate `__morphTags` list without page roots
(`PAGE_ROOT_ADMISSION_REASON` in `client-admission.ts`; the pre-hydration capture
still gets every tag), and `syncAttrs` never writes a consumed seed attribute back
onto the live host. An entry with no page root keeps its previous bytes (ABI pin
passes).

## 9. Second closeout pass (2026-11-23, later)

Pushed on `feat/alpha16-retirement` (`52a868883`, `6cb71bc23`).

**Two compiler rows and one router row — fixed, stale premises not regressions.**
`generated-element.shell.test.ts` had a row importing the deleted
`facade-host.ts` (removed with the class lane in `5ff82e101`) and a row whose
fixture had been claimable since `d97a85c5a`, so it measured a claim mismatch
instead of the fail-closed contract; the latter now uses a real mount-only
component (a condition nested in a branch) and pins 3 connects / 3
`OE_RUNTIME_LEAF_CLAIM_UNAVAILABLE` throws so it cannot go vacuous again.
`island-styles.test.ts` had the same `d97a85c5a` staleness; its fixture is
replaced with a proven `missing-producer` shape (nested condition) and keeps the
same coded refusal. Compiler **1316/1316**, island-styles **37/37**.

**`router-request-time` is off the class lane entirely.** Both zag islands are
generated function components with `defineIslandConfig` sidecars; the retired
authored methods (`demoSetControlledValue` / `demoSnapshot`) become declared
rows (`controlledValue` write-to-drive, `machineSnapshot` written back), so the
spec asserts the same machine facts through the property API. The four typed
`definePage<Data>` calls are bare, `page-items` declares its props table (it was
blocking `/items`), and three specs carry the generated lane's measured wire
forms instead of the class lane's. tsc PASS, build PASS,
`request-time-parity` **29/29** (it could not even run before).

**fixture e2e is NOT green: 308 passed / 34 failed, 12 unique rows** (all three
engines unless noted), all on subjects this session did not migrate — they were
unobservable before because the fixture could not build. Measured with nothing
else running: the fixture's `dist` is shared with `request-time-parity.test.ts`,
which rebuilds it, so a concurrent router-suite run contaminates this number
(measured once as 35/307 that way).

| rows | mechanism (measured) |
| --- | --- |
| `zag-combobox.spec.ts:349` (3 engines) | **real regression vs the class lane**: a SAME-TURN disconnect/reconnect cannot re-claim a retained region whose markup is a PURE STATIC directory. The M07b static-sibling-range consumer keeps a permanent per-parent ordinal tombstone (`static-sibling-ranges.ts:505,546`, set `:585-587`; `rollbackProvisional` only rolls back an incomplete attempt) while the shell re-claims on reconnect (`shell.ts: regionState === 'present'`). The class lane had no tombstone. Fixing it changes a pinned contract: `a completed directory claim stays consumed after dispose` (+ `F: dispose modes stay first-wins`) assert permanence, including after `dispose(false)`. **Needs an owner decision.** |
| `generated-page.spec.ts:96`, `:120` (2 engines) | **real defect**: a generated shadow host's DSD template carries the UNION of every island sheet (measured 7 `data-oe-static-styles` links inside `generated-page-card`'s template), not its own 1. The build's per-tag map is correct (`dist/server/entry.js` maps the tag to one href), so the union is assembled on the render side (`__documentStyles.links` is the document accumulator handed to every `__ssr` as `styleLinks`). |
| `kr2-diagnostic.spec.ts` 8 rows (24 instances) | the spec asserts the RETIRED class-lane style adapter/diagnostics (a held `fetch` adapter, `STYLE_SHEET_READY`, class-runtime error prose); the generated lane delivers sheets as `<link>` and reports `OEIR_*` identities. Re-authoring, not a code fix. |
| `live.spec.ts:185` (chromium only) | a 422 morph adds one extra increment to the live counter (`count=3` → `4` after the morph); pre-existing morph/replay behaviour, reproduced standalone. |

`router-request-time`'s typed-`definePage` defect is now fixed.

## 10. Third closeout pass (2026-11-23, evening)

Pushed: `ab80a3c20`, `31a86c009`, `e808871ec`, `a5937f9d4`, `21a9c92ca`.

**Four more pre-existing defects fixed, each with its own pinned test.**

1. **A directory claim's tombstones now release on a retained-DOM dispose**
   (`static-sibling-ranges.ts`). A same-turn disconnect/reconnect of a
   pure-static-directory generated island could not re-claim: the shell
   re-claims on reconnect while M07b kept a permanent per-parent ordinal
   tombstone, so the class lane was green here and the generated lane was not.
   The tombstone still guards two LIVE owners; a detached dispose keeps it. The
   claim handle is bypassed in production (the shell disposes the projection
   owner and the ranges are released by scope cascade), so the claim also
   registers a scope cleanup that releases only while its start marker is still
   attached — measured as necessary.
2. **A shadow host's DSD template links only its own sheets**
   (`public-runtime.ts`). The nested-host expander pre-filled its style sink from
   the app-wide admitted-tag set, so every shadow template declared every styled
   island's sheet (measured: 7 links inside one card whose per-tag map is 1). The
   sink is now live and starts from the host's own links; a nested LIGHT child
   appends as it is actually expanded, a nested SHADOW child keeps its own.
3. **Pre-upgrade replay runs on the first activation only** (`shell.ts`). A 422
   morph moves an intact island (remove+insert), and the shell replayed on every
   connect while the registry pins its cutoff on the first pass: an island whose
   activation won the race against the element-runtime load had its already
   handled click dispatched a second time (3 increments → 4; measured ~37% on
   chromium, i.e. a flake, not a deterministic red). The gate is the class
   facade's own `!activation.resumed` rule.
4. **A nested generated host is a claim boundary** (`claim-invariants.ts`,
   `leaf-runtime.ts`, `generate.ts`). Two every-load claim errors: `/decoupled`
   compared a nested host's authored attribute seed while the live tag also
   carries `data-oe-light` and the child's own interior ("static attribute seed
   count is 1, declared 0"); `/combobox`'s page directory claim bracketed a
   nested light island and rejected its own `oe:r:` markers
   (`OE_RUNTIME_STATIC_RANGE_MISMATCH`). Dash tags are no longer static
   directory content at any depth, and a dash tag's seed/opaque interior is
   asserted host-aware while authored statics stay exact.

**Measured state.** element 618/618, compiler 1330/1330, router 1873/1873, tsc
clean in all three packages.

**`router-request-time` e2e: 339 passed / 342, and NOT stably green.** The
kr2 harness was re-authored to the generated lane (six rows; two kept honestly
red until the claim fixes above landed). The last reds are two rows —
`kr2-diagnostic.spec.ts:996` (Q1-D) and `:1434` (Q1-B/B1) — that fail
INTERMITTENTLY on a rotating engine (measured: one full run 3 failed, standalone
re-runs 36/36, 35/36, 36/36, 35/36, 35/36). Root cause of the residual flake:
both rows mutate the page root's claimed shadow tree (remove / re-append a
nested light island) and can race the page root's idle claim; the claim then
legitimately reports the position it expected
(`OEIR_LEAF_CLAIM_MISMATCH: expected element 'zag-combobox-light' at /0/2/0`).
Waiting for the page claim before the mutation was tried and reverted: it turned
the flake into a different one (the wait signal does not hold on every row's
page). Not papered over with retries.

`live.spec.ts` flake (`:605`, and `:460` under full-suite load) is pre-existing
and passes standalone.

## 11. Fourth closeout pass — the fixture is green

**`tests/fixtures/router-request-time` e2e: 342/342 on chromium, firefox and
webkit.** The section-10 flake is fixed, correctly this time: the rows were
mutating (or typing into) a page root whose idle claim had not finished, so the
claim either restored the server state over the typed value or reported the
position it expected. Each mutating row now waits for its own page root's claim
first — the signal is the claim's own transport (the SSR host carries
`data-oe-prop-seed`; the claim consumes it), applied only to the rows that
mutate, with no assertion changed. Measured: the three kr2 rows 8/8 consecutive
runs, the two live rows 5/5, then the full suite 342/342.

**A nested light island's sheets now reach the page template.** The emitter
forwarded the runtime `styleLinks` channel only when the page module itself
declared styles, so a page that declares none dropped the links the runtime had
already lifted from a nested LIGHT child — and a document-head sheet cannot cross
a shadow boundary, so the island rendered unstyled. The wrapper now forwards the
channel unconditionally (the declared case keeps its fail-closed guard; a module
with no links emits the same bytes), and the claim skips the leading canonical
marked-`<link data-oe-static-styles>` run as a TEMPLATE fact (the M07b directory
consumer skips it only under a ShadowRoot, so its fast path survives). Measured
on /combobox: the page template carries exactly the child's sheet, one request
per resource, and the nested input is styled (padding 8px 12px, radius 6px).

**Final measured state.** element 618/618, compiler 1335/1335, router 1873/1873,
fixture typecheck + build PASS, `request-time-parity` 29/29, fixture e2e
342/342. The kr2 harness now asserts a clean error surface in every row (the
GAP-2 filter is retired), so a claim regression cannot be swallowed.

## 12. Fifth closeout pass — the element-browser suite is green

`browser:test` was still red on the deleted class lane: six suites failed to
import. The seventh red row (`overlay-contract`'s pointer light-dismiss) was a
contaminated false red — the `<vite-error-overlay>` from those import failures
intercepted the pointer; it passes clean once the imports resolve and needed no
change.

**One suite is retired with its subject.** `stream-hydrate-order.test.js` pinned
the client-side ordering of an early stream frame against pre-upgrade property
writes through `internal/compiled/stream-state.ts`, a file that went with the
class kernel (`5275a66b2`). Streamed-page authoring itself was removed with the
class lane by owner direction 2026-11-21 (capability inventory; Alpha18 owns the
replacement carrier), so the file is deleted. Its two rows are not replaced: the
generated lane has no stream-claim channel to order.

**Five suites now import the generated artifacts' HOST CLASS export**
(`ProgramCounterElement`, `WtrShadowButtonElement`, `WtrFieldElement`) — the
authoring function names they imported never existed in the generated lane. Every
row is kept except where the class lane's own mechanics were the subject:

- `form-platform` row 7 asserted that the class lane's inherited
  `formStateRestoreCallback` was a no-op (a kernel hook this component never
  registered). The generated shell implements the channel itself, so the row pins
  the measured contract instead: a string state restores the declared `value` row
  (prop sink included, validity re-synced), a null/File/FormData state is
  ignored, and `formResetCallback` still restores the default.
- `compiled-lifecycle` row 3 (keyed distant swap) pins the generated `each`
  reconciler's measured mechanics: entry node identity is preserved and the
  nested probe's lifecycle stays balanced (exactly one disconnect and one
  reconnect), but the backward reconciler re-inserts every entry between the swap
  point and the end anchor (measured: 1994 `insertBefore` calls, 997 of 1000
  entries), so a stationary entry's subtree is detached and re-attached — focus
  inside the list does not survive a distant swap. The class lane moved only the
  two swapped entries. Recorded as a measured difference, not papered over: a
  focus-preserving reconcile is a runtime change.
  **FIXED (2026-11-24, dated amendment): the runtime change landed.** The
  emitted `__oe_eachSync` tail now hands placement to ONE leaf-runtime helper
  (`reconcileEachEntries`, `runtime/each-reconcile.ts`), whose
  longest-increasing-subsequence rule leaves the stable chain untouched: a
  distant swap places exactly the two swapped entries (bench self-check
  `swapInsertions` 2, matching the retained Part-Program runtime's own #1455
  pin of 2), same-order is zero operations, and a detached stable entry is
  still placed. The browser row's class-lane assertions (focus preserved, one
  connection, zero disconnections) are restored and green; the helper's unit
  rows pin the contract on the counting DOM.

**Measured.** `browser:test` 7 files / 38 tests green, 0 failed suites, no
`vite-error-overlay` in the log; `browser:compile` exit 0; `check` 5/5.
`browser:negative` is **5/6 and needs an out-of-scope fix**: the `launch-sentinel`
proof's collection matcher (`output.includes('sentinel.test.js')`) can no longer
pass — vitest 5.0.5's default reporter omits the path line for a passing file
when stdout is piped (reproduced standalone against a scratch suite, with and
without `NO_COLOR`/`CI`; the tool spawns piped by construction). The other five
proofs, including `browser-launch-failure`, pass. `--reporter=verbose` prints the
file line and test name, so adding it to that one case's args fixes the proof;
`__wtr__/tools/negative-proofs.ts` was outside this pass's write scope.

## 13. Acceptance batch E — web-component-interop unit rows

The fixture's three unit files were re-authored against the surviving generated
lane (`compileGeneratedElementIfAdmitted`). No row was retired: every subject
still exists, and no fixture source, vitest config or runtime package changed.

Five rows pinned stale premises, not deleted capabilities. The host producer's
current ABI is `(props, lightChildren, attributes, styleLinks, nestedHost)` — the
trailing `nestedHost` is the nested light-child composition seam. A styleless
`ssr: false` island is now explicitly PRODUCERLESS (`ssrHostExport === null`, no
`__ssrHost` wrapper), so the two client-only rows pin that absence instead of a
producer the entry never pairs. `page-interop-home.tsx` is a generated function
page since `1cd7ba7b5`, so its compile row drives the generated lane and pins the
literal host attributes and light child as the emitted nested-host attribute
pairs and kid pushes. The non-primitive probe keeps its property-only rows: their
descriptor attribute is still `null`, and only the absence of a PER-ROW channel
is asserted — array/object values still travel on the runtime's one shared
`data-oe-prop-seed` JSON document (ADR-0181 A5 amendment / D-18c), and
`trustedHtml` stays unseeded.

**Measured.** `vitest run --project tests` 4 files / 12 tests green; the fixture's
own `typecheck` (`tsc --noEmit -p tsconfig.json`) exit 0; `check` 5/5.

## 14. Acceptance batch F — the packed consumer's dev cell exposed the marked peer

`gate:packed`'s starter leg reached its DEV cell for the first time (installs
now pass; every earlier session died at the unpublished-version `notarget`
before this cell could run). The packed consumer's dev server failed at config
load: `Cannot find package 'marked' imported from
@openelement/router/src/vite/plugin-mdx-lower.js`.

That broke plugin-mdx.ts's OWN contract — `marked` is an OPTIONAL peer, and
consumers without MDX pages never resolve it. The breaker was the declared-tag
scan's STATIC import of the lowering module (declared-element-tags.ts:46), one
edge away from plugin-scanners.ts, which the vite plugin loads at config time.
Every consumer — a marked-less scaffold included — resolved the peer.

The scan now goes through plugin-mdx.ts's exported single-flight `loadLower()`
and awaits it ONLY inside its existing `.mdx` branch, so a graph with no MDX
route never resolves the lowering module at all; an MDX route without `marked`
still fails closed with the coded `MdxErrorCode.OPTIONAL_PEER_MISSING`
diagnostic. A source-scan guard (`mdx-lower-optional-peer-guard.test.ts`) pins
the class: no non-test module under src may name plugin-mdx-lower.ts in a
static import/export form (type-only included), and plugin-mdx.ts keeps the
one dynamic loader. The starter template gains no `marked` dependency — a
marked-less scaffold is the contract.

**Amendment (2026-11-24, later the same night): the slot, not the export.**
The exported `loadLower` carried its own defect: the scan's static plugin-mdx
import was the FIRST edge into that module from the bundled ./vite graph, and
rolldown materialized its chunk-loading runtime into the packed artifact
(`src/_virtual/_rolldown/runtime.js` — the artifact check fails closed on its
`node:*` import; the bisect pack against the pre-change sources is clean).
The scan now consumes the ONE slot the open:mdx plugin publishes at factory
time (`plugin-mdx-scan-hook.ts`, the pre-upgrade-replay-hook shape: a
zero-import registry whose functions ARE the registry's); `loadLower` stays
private to plugin-mdx's graph with the coded OPTIONAL_PEER_MISSING diagnostic;
a build composing no open:mdx plugin gets its `.mdx` rows reported
(OE_DECLARED_TAG_MDX_PLUGIN_NOT_COMPOSED), never lowered by a silent import.
Measured: the pack probe is clean again and router is 1876/1876 with the
guard at three rows.

## 15. Fifth closeout pass — the packed gate runs its never-run cells (F16)

**gate:packed's original blocker is gone.** The unpublished-version `notarget`
died with the npm resolution seal: both bare-install legs (starter, ui-app) now
write a scratch manifest whose dependencies AND overrides pin every retained
@openelement/* name to its own file: tarball (the pnpm cells already sealed
via consumerPnpmOverridesYaml; the npm cells had no carrier — the specs ride
the manifest because npm rejects an override for a directly-installed argv
name, EOVERRIDE). The install budgets grew for real networks (a hermetic
cold-cache tree measured 5–20+ minutes at 75–250KB/s registry throughput on
2026-11-24; budget 5→20 min, per-fetch 30s→300s) and the scratch caches share
one content-addressed root (`openelement-packed-consumer-npm-cache-v1`), the
shape CI uses.

**Measured at HEAD f44f912b2** — the gate's first five steps pass (generate,
typecheck, pack, publint+attw artifacts, pack-surface), and the starter leg
runs its FULL consumer lifecycle for the first time in this PR's history:
install → scaffold → typecheck → test → dev server → SSG build → start →
**browser matrix chromium+firefox+webkit** → router bin fail-closed guidance,
all green. Getting there surfaced and fixed one real product defect and one
harness defect:

1. **`marked` is an optional peer, again** — the declared-tag scan's STATIC
   import of the mdx lowering made every consumer resolve `marked` at config
   load; the packed starter's dev cell measured it. The scan now consumes the
   slot the open:mdx plugin publishes (plugin-mdx-scan-hook.ts, the
   pre-upgrade-replay-hook shape; see §14's amendment for the rolldown
   runtime materialization that the first fix shape caused in the pack).
2. **The agent-round cell is stale, not the artifact** — the round breaks the
   app with a class-authored component (`@element` + `extends OpenElement` +
   an inline sheet string in `static styles`) and expects `OEC9029`, the
   class compiler's #1558 refusal. Both the grammar and the diagnostic died
   with the class lane this PR deletes; the packed build now answers with two
   UNKNOWN-coded vite-level resolution errors for the nonexistent export. The
   round needs the same re-authoring the kr2 harness got: a break authored in
   the generated lane (a refused sidecar style shape) against an existing
   coded refusal, with the repair recipe the current docs page resolves.
   `consumer:packaged` therefore still stops at 6/13 steps — by
   characterization, not by mystery: everything downstream (ui-app leg,
   app/router/element/ui/unocss legs, fixture smoke) has NEVER executed in
   any session and may hold more of the same.

**Also measured this pass:** a stale-tarball freshness race (batch E's commit
landed mid-gate; the guard refused correctly — never commit during a gate
run), and one flaky pack-pipeline leak reproducible on demand (the F16
static-edge shape; the bisect pack against reverted sources is clean).
