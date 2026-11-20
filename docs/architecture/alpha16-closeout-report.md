---
status: active
topic: Alpha16 closeout report (delivered / not delivered / Alpha17 boundary)
summary: What Alpha16 delivered with a four-part evidence record, what it did NOT deliver and the exact condition each open item waits on, the P1–P8 compliance table with its one deliberate deviation, and the Alpha17 boundary. Read the negative accounting before planning Alpha17.
---

# Alpha16 closeout report

This report is the Alpha16 closeout deliverable required by the owner's
2026-11-20 direction. It states what the line **delivered**, what it **did not**,
and the condition each undelivered item waits on. It is written to be read by
someone who was not in the session: every claim carries the four-part evidence
record defined in [`evidence-baseline.md`](./evidence-baseline.md) — commit,
clean status, exact command, exact result, provenance — or says plainly that it
carries none.

> **Read the negative sections first if you are planning Alpha17.** The
> retired-lane accounting is the part that decides what Alpha17 can start, and a
> closeout report that only lists wins is a marketing document.

## 1. Where the tree is

| field | value |
| --- | --- |
| branch | `feat/alpha16-retirement` |
| source version | `1.0.0-alpha.16` (bumped this line through the one-knob tool) |
| closeout commit | `b12d040301910a751b0bb40e75db635e472a9432` (the source/measurement commit; the evidence table below is taken there) |
| record anchor | the docs-only record commit(s) that follow that commit (this report's own updates); they change no source, so every measured row stands |
| `git status --porcelain` | empty |

Provenance for every record below: **`LOCAL`
`.agents/worktrees/alpha16-retirement`** at the cited commit. **No `CI` record
exists for this line** — no workflow run was dispatched for
`feat/alpha16-retirement`, so every green number in this document is a LOCAL
record and is labelled as one. That is a real limitation of the evidence, not a
formality: an independent runner has not reproduced these results.

## 2. The headline: the class lane left the product

The Alpha16 objective's core was to retire the class/Part Program authoring lane
in favour of the generated lane. That is true of **every product source root**:

| source root | authored `@element` classes |
| --- | --- |
| `www/app` | **0** |
| `apps/saas/app` | **0** |
| `packages/ui/src` | **0** |
| `packages/create/templates` | **0** |

Command (exact):
`grep -rn "^export default class .* extends OpenElement\|^class .* extends OpenElement\|^export class .* extends OpenElement" www/app apps/saas/app packages/ui/src packages/create/templates --include="*.ts" --include="*.tsx"`
→ **no output**. The same command with `^@element(` → **no output**.

What replaced it, and the tests that pin each:

| capability | carrier | guard |
| --- | --- | --- |
| derived state | `computed()` intrinsic (ADR-0183 D-4, option B) | `app/layout.tsx` carries 30; `generated-element.*` suites |
| host access | `useHost()` | `generated-element.use-host.test.ts` (6 rows) |
| refs | `ref(cb?)` over the existing `ref` channel | ADR-0182 amendment |
| lifecycle | `onConnect` / `onDispose` / `onPropertyChange` | generated-element suites |
| error boundary | `onError` (2 capture points) + newly the SSR fallback | `nested-host-expansion.test.ts` (+4 rows) |
| context | `provideContext` / `useContext` over the generated owner tree | `16b-CTX` slice |
| nested hosts | expansion to DSD through one runtime call per dash tag | `generated-leaf.nested-host.test.ts`, `nested-host-expansion.test.ts` |
| light-root CSS | declared sheets reach the render's document sink (#1800) | `generated-light-styles.test.ts` |
| shadow-root CSS | declared inside the DSD template via the typed `styleLinks` channel | `island-styles.test.ts` (admission row) |
| client-only shadow CSS | declared sheets emitted as real module-graph imports + adopted by the shell through the class lane's `CompiledStyleScope` (2026-11-20, the last open style capability) | `generated-element.client-styles.test.ts` (12 Node rows), `client-only-styles.test.js` (real-browser computed `:host` style + adoption lifecycle), starter e2e computed-style row |

Page authorship follows execution-plan §19.9 throughout: the page component is an
**exported server function component declared in its own route module**. That rule
was not cosmetic — the saas batch originally failed it, and the failure mode is
worth remembering (see §5).

## 3. Evidence record

All rows: provenance **`LOCAL .agents/worktrees/alpha16-retirement`**, commit
`b12d040301910a751b0bb40e75db635e472a9432`, status clean (`git status --porcelain`
empty), every commit pushed to the fork's `feat/alpha16-retirement`.

| # | command | result |
| --- | --- | --- |
| 1 | `vp run --no-cache --fail-if-no-match --filter @openelement/element test` | **1058 passed (1058)**, 136 files |
| 2 | `vp run --no-cache --fail-if-no-match --filter @openelement/compiler test` | **1418 passed (1418)**, 102 files |
| 3 | `vp run --no-cache --fail-if-no-match --filter @openelement/router test` | **1882 passed (1882)**, 167 files |
| 4 | `vp run --no-cache --fail-if-no-match --filter @openelement/www test` | **304 passed (304)**, 34 files |
| 5 | `vp run --no-cache --fail-if-no-match --filter @openelement/saas test` | **150 passed (150)**, 20 files |
| 6 | `vp run --no-cache --fail-if-no-match --filter @openelement/create test` | **68 passed (68)**, 3 files |
| 7 | `vp run --no-cache --fail-if-no-match --filter @openelement/ui test` | **80 passed (80)**, 12 files |
| 8 | `vitest run --project element-browser` after `pnpm --dir packages/element run browser:compile` | **40 passed (40)**, 8 files (chromium; includes the 7 client-only style rows) |
| 9 | `vp run --no-cache --fail-if-no-match check` | **`gate ok: 5 step(s)`** |
| 10 | `vp run --no-cache --fail-if-no-match site:build` | **`gate ok: 6 step(s)`** |
| 11 | `vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo interface:snapshot` | `Public interface snapshot matches (6 packages).` |
| 12 | `vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo docs-index:check` | `current view is generated, links resolve (46 active document(s), 9 historical record(s), 15 archive/removal entr(ies))` |
| 13 | `pnpm --dir tests/fixtures/site-light-probe run build` + `run e2e` | **25 passed**, on the CLASS version of the fixture (the generated port is reverted and its gap named in §5.1) |
| 14 | `pnpm --dir tests/e2e/starter-smoke run setup` + `run test` | packed starter build **exit 0**; Playwright **27 passed / 6 failed** — the six are the pre-hydration replay rows, recorded RED in §5.6; the client-only computed-style row passed on chromium, firefox and webkit |

`@openelement/protocol` has no `test` task (it declares no scripts); it is covered
by the compiler/router suites that consume it.

Rendered-output evidence (not a test count, because the claim is about bytes):
`www/dist/guide/api/index.html` carries the reading shell with **2673** characters
of real article prose, 3 `<h2>` elements and 2 highlighted code fences, and **no**
`<open-article-view>` tag. The retired sheet's rule is delivered by the linked
document sheet (`client-*.css` carries
`open-article-view,open-reading-shell{display:block}`), which is the §6 deviation
stated as such.

## 4. What was retired, per area (M10)

M10 asks for retirement evidence **per surface**. Three of five are retired; the
other two are recorded as negatives.

| surface | state | evidence |
| --- | --- | --- |
| Browser runtime | **RETIRED** | symbol probes over both shipped client bundles for `installAccessors`, `createFacadePropertyState`, `validatePartProgram`, `PART_PROGRAM_VERSION`, `createElementKernel` → **0** in saas and www |
| Server runtime | **NOT retired** | `validatePartProgram` ships **3** times in `apps/saas/dist/server/entry.js` because `public-runtime.ts` still holds the class render path beside the generated one |
| Build/SSG | **RETIRED** | the `@element` counts in §2 are zero, so the lane is dispatched and never selected in a product build; `site:build` completes without it |
| ABI/module contract | **STILL PROMISED** | `COMPILED_MODULE_ABI_VERSION = 2` still documents `__partProgram`; deliberate while third-party class modules are still accepted |
| Public API | **UNCHANGED** | `OpenElement` / `ErrorBoundary` are still exported; `onNestedFailure` is the line's one public addition |

The `interface:snapshot` write also carries ONE additive **internal-subpath**
shape from the 2026-11-20 client style slice: the generated-element shell's
`GeneratedElementDescriptor` gains optional `styles?: readonly StyleSheetLike[]`
(ADR-0181's 2026-11-20 delta). It is emitted-artifact ABI on ADR-0177's internal
subpath — no stability promise, no new export, omitted keeps the pre-slice shape —
so it does not change the "one public addition" statement.

## 5. What was NOT delivered, and the condition each waits on

This is the section Alpha17 planning should read first.

### 5.1 The class lane itself is still present

The **authoring surface is gone from the product**, but the lane's compiler, Part
Program artifact, validator and class render path are still in the tree because
two things still consume them:

1. `packages/*/__tests__` — **82 test files** author `@element` classes. They are
   the lane's own contract tests, so they must be deleted in the same commit that
   deletes the lane; deleting them first would remove the only thing pinning the
   behavior being removed.
2. `tests/fixtures` — **10 fixture apps** still author classes. Two are RETAINED
   deliberately (`third-party-web-components`, `web-component-interop`: a foreign
   class IS the subject under test). The other eight MIGRATE LATER, and one of
   them now has its blocker named rather than categorised: `site-light-probe` was
   PORTED, built and run, and produced a capability gap instead of a migration —
   the generated lane does not hoist a NESTED light root's sheet into an enclosing
   shadow template, so a generated light root cannot be nested inside a shadow
   tree today. The port is reverted, the fixture's e2e is green on the class
   version (25/25), and the gap is recorded with its both-builds measurement in
   the migration matrix.

**Condition:** lane deletion is one change set covering the compiler entry, the
Part Program artifact and its ABI record, the class render path in
`public-runtime.ts`, those 82 test files, the eight fixtures, and
`benchmarks/micro/oe-table.tsx` — that last one is a benchmark INPUT whose subject
IS the class compiler, so it retires with the lane instead of migrating (measured:
green, `pnpm run bench` 1 file / 2 tests). Until that happens, the server-runtime
and ABI rows of §4 stay open.

### 5.2 `16b-EB` — all four §19.2 conditions DELIVERED; the row stays PARTIAL by design

The report's first edition listed conditions 2–4 as open. They landed after it was
written, so this section is corrected rather than left to age:

| condition | state |
| --- | --- |
| 1 — the `__ssr` fallback contract | **delivered** (`9e494db63`) — boundary bytes, observability, no whole-render failure |
| 2 — the render path emits those bytes | **delivered** (`77b367233`) — consumer form over a real `renderToString` pass |
| 3 — the one-SHA bundle | **delivered** (`3801ec997`) — including claim parity made STRUCTURAL: the fallback bytes are byte-identical to no-expansion bytes, so the claim cannot tell them apart |
| 4 — the row-for-row move | **delivered** (`69e58b2b9`) — `16b-MN`, the capability inventory and ADR-0182 carry the same truth |

**Why the row is nevertheless still PARTIAL, stated so no one reads it as an
oversight:** a new IDENTITY for the fallback bytes is explicitly outside this
delivery. Parity holds precisely *because* the bytes are indistinguishable from
no-expansion bytes; giving them their own identity is a different decision with its
own record, and §19.2 condition 2 says "under the unchanged claim and identity
rules". **All four conditions hold and the row does not flip** — those two facts
are consistent, and the records name the reason in one sentence each.

### 5.3 `16b-LC` depth ≥ 2, recipe/list placement, non-retained targets, pre-DOM timing

Delivery today: root lifecycle, depth-1 nested/hostless hooks, and the
connection-scope `env = { host, signal }` helper. Still refused: the remaining
placements (`OEIR_LEAF_INVALID_ARTIFACT` / `OEC9041`).

**Condition:** extending the retention model, which ADR-0181 owns; the slice does
not have a design carrier for depth ≥ 2 yet.

### 5.4 M12 / M13 / M14 qualification

- **M12** (final packed-consumer qualification, the stateful list) — the harness
  exists (`tests/e2e/starter-smoke/setup.ts` + `quality.ts`, Playwright with
  chromium/firefox/webkit present on this machine) but was **not run** for this
  line. Running it packs the tarballs and installs a fresh consumer, which is a
  release-train action, not a closeout one.
- **M13** (browser + server qualification at an exact SHA) — same: needs the M12
  artifact set.
- **M14** (async server components, full-await) — the OEC9032 semantics work is in
  and the compiler suite covers it; the milestone row is not flipped here.

**Condition:** a dispatched release-train run. Every one of these is a `Q`-class
(qualification) milestone whose evidence must be a `CI` record by definition, and
this line has no CI run. **A LOCAL record cannot stand in for them**, so this
report does not claim them.

### 5.5 Shim retirements — two written conditions were MET by this line

`shim-inventory.md` records every load-bearing workaround with the condition under
which it must be deleted (`处置：条件到即删`). Two of those conditions were
satisfied by this line's work, so both are **retired with their action recorded**
rather than silently deleted:

| shim | written condition | how this line met it |
| --- | --- | --- |
| **#24** `OE_ISLAND_STYLE_SHADOW_UNWIRED` | "GH #1800 lands the shadow style link/adoption carrier, and a shadow-root generated island with `styles` builds and renders green" | the DSD style-link carrier landed: the compiler emits the typed `styleLinks` channel and the serializer writes the canonical marked `<link>` inside the template, so the scan ADMITS a `producer` island with root `shadow` |
| **#28** `registerOpenUi` published-API no-op | "delete with the next breaking alpha (experience-edition surface, no compat adapter needed)" | alpha.16 **is** that alpha; measured dead first (`extends OpenElement` in `packages/ui/src` = 0, empty body, four mentions total), then deleted with the interface snapshot and the smoke test updated |

Retiring #24 also corrected **three architecture records that still denied the
carrier** (ADR-0181 part C, the `16b-MN` style section, and the shim entry
itself). A shim inventory that is right while three records contradict it is the
same drift the constitution forbids, so the fix belonged with the retirement.

What deliberately did **not** retire: `OE_ISLAND_STYLE_SHADOW_UNWIRED` still fires
for a server-rendered shadow island whose leaf emitted **no producer** — that case
has no template to declare the sheet in, so accepting the declaration WOULD be the
silent loss the shim existed to prevent. The 2026-11-20 client style-adoption slice
narrowed it once more: a **client-only** island (`ssr: false` / `hydrate: 'only'`)
with no producer is now admitted, because the browser creates the root and the
compiler's emitted import plus the shell's adoption is a complete delivery. The
refusal therefore names exactly "server-rendered shadow root with no template",
which is the honest boundary. Reporters updated with it: `authoring.ts`,
`island-style-specifiers.ts`, `island-style-declarations.ts`, `style-assets.ts`,
the shim entry, ADR-0181 and the `16b-MN`.

### 5.6 Pre-hydration click replay does not cover generated islands (measured 2026-11-20)

The packed-starter smoke run for this record found a PRE-EXISTING gap in the
generated lane, newly measurable because the starter build completes again:
`replayPreUpgradeCaptures` has exactly one caller, the CLASS facade's claim path
(`open-element-implementation.ts`). A generated island claims through the shell,
which never calls it, so a click that lands before an idle island hydrates is
captured but never replayed. On the packed starter, `#942 click before idle
hydration is replayed` and `third-party pressure does not block idle replay` are
RED on chromium, firefox and webkit (count stays `0`): **27 passed / 6 failed**
for the whole harness, with every other row green (including the new
client-only computed-style row).

This is not a style-slice regression: the class facade is the only replayer, and
the generated shell deliberately imports no module from the old backend — the
replay primitive currently lives in
`internal/compiled/runtime/pre-upgrade-events.ts`, which the shell's P1
boundary forbids. Delivering it needs a neutral replay leaf plus shell wiring and
owner-scoped release. Recorded, not claimed; see the migration matrix's
2026-11-20 starter-smoke section for the exact rows and the layout fix that made
the build green.

### 5.7 P5 personal sign-off

The §13.5 P5 sign-off requires the owner's own signed line on a final-SHA matrix.
The §18.7 delegation explicitly does **not** satisfy it ("a record that requires
the owner's own line is not satisfied by it"). **Condition:** the owner signs.

## 6. P1–P8 compliance and comply-or-explain

| principle | how this line obeyed it |
| --- | --- |
| **P1** executor closure | the generated-lane runtime helpers are imported only from `@openelement/element/internal/compiled/leaf-runtime`, never the package root |
| **P2** runtime surface needs an ADR | `computed` (ADR-0183), `useHost`/`ref`/lifecycle/context (ADR-0182 amendments), the nested-host expansion and the EB fallback all ride existing seams; no new public surface was added except `onNestedFailure`, which is recorded in the interface snapshot and the plan |
| **P5** written retirement conditions | `compiledRootKindOf`'s Part Program arm carries its condition in the doc comment; this report carries §5's conditions |
| **P6** single source of truth | duplicate-fact defects were found and *fixed* rather than tolerated: the shadow-style refusal that contradicted the build, `useHost` recorded as FUTURE/OWED while implemented, and form participation recorded as PARTIAL while closed; the 2026-11-20 client-style slice added four more — the stale `authorship`/declaration/style-assets prose that still described the pre-M09-2e/OWED channel, the `computed` inventory row left at PARTIAL after D-4 landed, a lifecycle hook that read a root signal and was dropped SILENTLY (the artifact and the record disagreed), and the starter layout record whose shadow shape the packed build disproved |
| **P7** evidence before claim | §3 is a record table, §4–§5 are explicit negatives; nothing in this document says "tests pass" |
| **P8** single-owner seams + consumer-form tests | every new guard calls the shipped helper the way emitted code does (`nested-host-expansion.test.ts` calls `nestedHost`; `generated-light-styles.test.ts` drives the real channel) |

**The one deliberate deviation, with its reason.** `www/app/site-ui/
open-article-view.css` was retired and its single `:host{display:block}` rule moved
into the linked document sheet instead of staying an element sheet. A server
function page's nested styled host is emitted by `__h(tag, …)`, which never runs
the class serializer's nested style walk, so an element sheet would have been
silently dropped. The move keeps ONE owner for a LIGHT root's CSS — the same
resolution the starter's three page boxes got — and the mechanism was measured
before and after (the first attempt broke the A6 sheet row; the move fixed it
without an allowance).

## 7. Alpha17 boundary

Alpha17 owns, per plan §19.6 and this record:

1. the lane deletion of §5.1 (compiler entry, artifact, ABI record, render path,
   82 test files, 8 fixtures, and the benchmark input whose SUBJECT is the class
   compiler). Re-evaluated 2026-11-20 (migration matrix, same date): **no
   capability blocker remains** — the mechanical moves are enumerated, but the
   public-API removal (`OpenElement`/`ErrorBoundary` + the class render path),
   the third-party admission/ABI decision and the benchmark successor are
   owner/release decisions, so it can be PLANNED as one change set but not
   landed on this branch;
2. the generated lane's hoisting of a nested light root's sheet into the
   enclosing shadow template: the generated lane does **not** hoist it, so that
   nesting is impossible today and `site-light-probe` stays the only proof of the
   restriction (see the migration matrix's attempted-and-reverted record). The
   OTHER half this item used to name — the client-side shadow style adoption for
   `ssr: false` islands — **landed 2026-11-20** and is no longer an Alpha17
   carry. The disposition is a WRITTEN RULE (ADR-0181, 2026-11-20): a light root
   must not be nested inside a shadow template; `site-light-probe`'s e2e row is
   rewritten to assert it inside the lane-deletion change set. No capability is
   built or claimed;
3. a new IDENTITY for the `16b-EB` fallback bytes, if one is ever wanted — all four
   §19.2 conditions are delivered, and the row stays PARTIAL solely because this
   decision is out of scope;
4. the `16b-LC` depth ≥ 2 design carrier — the refusal site is
   `generated-leaf/generate.ts` and the retention model it needs is ADR-0181's,
   which is explicitly not wired past depth 1;
5. the M12/M13 qualification runs and the P5 sign-off;
6. the generated lane's pre-hydration click replay (§5.6): a neutral replay leaf
   outside the shell's forbidden old-backend set, the shell's claim-path call and
   its owner-scoped release, with the starter's `#942`/third-party rows as the
   acceptance form.

None of these is a patch Alpha16 could have absorbed: each needs either a design
carrier that does not exist yet, or a release-train/owner action outside a
retirement branch's authority.
