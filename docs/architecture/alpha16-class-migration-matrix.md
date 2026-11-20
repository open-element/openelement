---
status: active
topic: Alpha16 class→function migration matrix
summary: The tracked per-file class→function migration matrix required by execution plan §2 item 3a and §15.1 — every class/Part Program consumer at cd7e9e065 (300 files), its measured shape, the ONE decision it needs, its target form and its state.
---

# Alpha16 class→function migration matrix

The tracked per-file inventory required by
[the execution plan](./alpha16-18-execution-plan.md) §2 item 3a and re-read by
[§15.1](./alpha16-18-execution-plan.md). §15.1 makes the class-retirement
capability inventory the **tracked** one: "a tracked capability inventory, the
final-SHA per-file class→function migration matrix, the migration note with its
row-for-row entries in `16b-MN`, and the owner sign-off". This document is the
second item; it is **not** a signature and creates no P5 evidence on its own
(§13.5 stays in force).

**Revision 2026-11-20 (L1 completion).** The first draft carried 241 lines: the
measurement, the decision register D-M1–D-M9 and the production narrative. This
revision (a) completes the matrix into a per-file matrix for the full 300-file
scan set (§5–§11), (b) records the owner's 2026-11-20 reversal of the
2026-11-18 "no `computed` in the generated lane" ruling by adding **D-M10** and
marking **D-M2 SUPERSEDED** with its original text kept, (c) labels the
owner-directed 16b expansions (**D-M5–D-M8**) with the ADR/plan amendment each
needs, (d) adds **D-M11**, a *measured owner question* surfaced while completing
the rows (streamed pages have no function-lane carrier), and (e) adds the
execution order with per-batch gates (§14) and the numeric corrections to the
first draft (§3.2). It creates no verdict, no exit and no release claim.

## 1. What this document is and is not

**Is:** one row per file that carries a class-lane authoring construct or reads
the Part Program ABI, with the measured shape, the design decision that file
needs, the target form and the state. The counts in each row are the scan's own
columns at the SHA in §2 — not copied from an earlier document — and the row set
is asserted to cover all 300 scanned files exactly once (§16.2).

**Is not:** a P5 sign-off, an exit record, a release claim, or a substitute for
the capability inventory. It also does not claim any file is migrated: a row's
`ready` state is a *disposition* (no design decision is outstanding), never
evidence. A row becomes "migrated" only when its PR names a command and its
result (§13.6 of the plan).

**Measured sizes are per-SHA.** A count here is that SHA's value; a later SHA
re-measures rather than inherits it.

## 2. Measurement record

### 2.1 The scan

| Field | Value |
| --- | --- |
| Commit | `cd7e9e065d74b30862f5d73edd4fd32d8044dd49` (`origin/main`, PR #1804 merge) |
| Worktree | clean at the time of the scan: `git status --porcelain` printed only pre-existing untracked `.artifacts/` content |
| Command | `node /tmp/scan-class.mjs` — `git grep -l -E 'extends OpenElement\|@element\('` over `www apps packages tests tools docs`, sorted, then the per-file regex counts listed in §2.3 |
| Export | `$SCAN` — the local scan export, 301 lines: one header line + **300 data rows**. Kept outside the checkout and never committed; regenerate it with §16.1. (The recorded run's absolute path is written as `$SCAN` because the repo's machine-path gate forbids that marker in a tracked doc — §16.3 records the gate run.) |
| Result | **300 files** touch the class lane or the Part Program ABI; the exact partition is §3.1 |
| Provenance | LOCAL. Not a CI record. No exit, gate or release claim rests on it |

The scan is deliberately coarse: it catches every file that mentions the class
lane, including documentation and tests, because §2 item 3a retires the
**authoring frontend and the protocol**, not just the files that ship. The area
split below is what makes that coarse set actionable.

### 2.2 Reproduction at the same SHA

The export is reproducible at this SHA. Re-run against the worktree HEAD:

```text
$ node /tmp/scan-class.mjs > /tmp/rescan.tsv     # from the worktree root
TOTAL FILES: 300                                 # stderr
$ wc -l /tmp/rescan.tsv
301 /tmp/rescan.tsv
$ diff /tmp/rescan.tsv "$SCAN"; echo $?
0
```

Result: the re-scan and the exported TSV are **byte-identical** (diff exit 0) at
`cd7e9e065`. The scan script is quoted in §16.1 so the record does not depend on
a `/tmp` file surviving; `$SCAN` is the export path the recorded run used.

### 2.3 What each column means, and where the coarse scan over-counts

The `Shape` column in §5–§11 is the scan's seven columns verbatim, written
`classes/computed/props/trustedHtml/innerHTML/@element/sidecar`. Counts are
regex counts over source text, not a semantic analysis; they size the work and do
not prove a resolved shape. Three caveats matter when reading a row:

1. **`classes` matches prefixes.** The scan's regex is `class X extends OpenElement`
   without a word boundary, so it also counts `extends OpenElementError`,
   `extends OpenElementBase` and `extends OpenElementConfiguration`. Re-measured
   with a boundary (`class\s+\w+\s+extends\s+OpenElement(?![A-Za-z0-9_])`), **9
   files** carry such a prefix hit and **11** declarations total. Seven of the
   nine are not class-lane authoring files at all — `compiler/src/.../diagnostics/index.ts`,
   `element/src/internal/compiled/each-key.ts`, `element/src/internal/compiled/generated-element/shell.ts`,
   `element/src/internal/compiled/runtime/hydrate.ts`, `element/src/internal/compiled/runtime/values.ts`,
   `element/src/internal/core/errors.ts`, `router/src/authoring.ts` — and the
   target cells in §9 say so; the remaining two are the class frontend's own base
   classes. Rows affected are marked `†`.
2. **`sidecar` means the island-config declaration**, `export const openElement =`;
   in this tree that is `defineIslandConfig(...)` and it is used by the class lane
   and the generated lane alike. It is **not** a "already migrated" signal; in
   `tests/fixtures` `sidecar=yes` identifies the island half of a fixture app.
3. **Generator and template rows count emitted template text.** For example
   `www/tools/generate-site-article-routes.ts` reports 2 props because the class
   it emits has 2; `www/content/**` reports 16 classes because the documentation
   *shows* 16 class examples. Neither is a live declaration.

## 3. Where the 300 files sit

The 300 files split by area as follows. This is the matrix's coverage map: every scanned file has exactly one row in the section named here (§16.2 asserts it), and the area table also corrects the first draft's overlapping numbers.

### 3.1 The exact 300-file partition

The first draft's area table was descriptive, not exhaustive, and its rows
overlapped. The partition below is the exact one; every row has a home in
§5–§11 and the sum is 300. Computed from the export's first column:

```text
$ awk -F'\t' 'NR>1{print $1}' "$SCAN" | cut -d/ -f1-2 | sort | uniq -c
  13 apps/saas
   3 docs/adr
   9 docs/architecture
   1 docs/release
  21 packages/compiler
   7 packages/create
  47 packages/element
  39 packages/router
   5 packages/ui
  81 tests/fixtures
   1 tools/lib
   7 tools/release
   2 www/__tests__
  34 www/app
  26 www/content
   4 www/tools
```

Mapped onto the matrix's areas (the `packages/*` numbers are split into
`src`/`__tests__`/`__fixtures__`/`__wtr__`/README by the same first column):

| Area | Files | Per-file rows |
| --- | --- | --- |
| `tests/fixtures/**` | 81 | §7 |
| `packages/element/__tests__` | 33 | §8.2 |
| `packages/router/__tests__` | 33 | §8.4 |
| `packages/compiler/__tests__` | 15 | §8.5 |
| `packages/element/__wtr__` | 3 | §8.3 |
| `packages/element/__fixtures__` | 2 | §8.1 |
| `packages/create/__tests__` | 1 | §8.6 |
| `packages/element/src` | 8 | §9.1 |
| `packages/router/src` | 5 | §9.2 |
| `packages/compiler/src` | 5 | §9.3 |
| package READMEs | 3 | §9.4 |
| `www/app/**` | 34 | §5.1 (5), §5.2 (27), §5.4 (2) |
| `www/tools` | 4 | §5.3 (2), §11.4 (2) |
| `www/__tests__` | 2 | §11.4 |
| `www/content/**` | 26 | §10.2 |
| `docs/**` | 13 | §10.1 |
| `apps/saas/**` | 13 | §6 |
| `packages/create/templates` | 6 | §11.1 |
| `tools/**` | 8 | §11.3 |
| `packages/ui/tools` | 5 | §11.2 |
| **Total** | **300** | |

`packages/protocol/src` appears in the scope list of the first draft but carries
**no row**: no file there spells `extends OpenElement` or `@element(`, so the scan
does not select it. Its retirement (`part-program.ts`, 1631 lines measured by
`wc -l`) is tracked as a source/target statement in §9.3, not as a scanned file.

### 3.2 Corrections to the first draft's numbers

The first draft stays as written (this document is a completion, not a rewrite of
its prose); the measurements that do not hold are corrected here.

| First draft says | Re-measured | Disposition |
| --- | --- | --- |
| §3 area table sums to 300 | its rows overlap (whole packages plus their `__tests__`) and sum to **376**; the exact non-overlapping partition is §3.1 (sum 300) | corrected by §3.1; the draft rows stay as a descriptive reading |
| `tests/fixtures` — 81 files across **17 fixture apps** | **9** fixture apps carry class-lane files: `router-base-path` 4, `router-native-framework` 14, `router-request-time` 31, `router-static-only` 2, `router-ui-dogfood` 10, `router-unocss-probe` 2, `site-light-probe` 6, `third-party-web-components` 10, `web-component-interop` 2. `tests/fixtures/` has 11 directories; `router-nitro` and `url-pattern-list-audit` carry no class-lane file | per-file rows in §7 |
| `packages/element/src` — 47 (18 in src, 29 test) | 47 total, split **8 `src` / 33 `__tests__` / 3 `__wtr__` / 2 `__fixtures__` / 1 README** | §8, §9.1 |
| `packages/compiler/src` — 21 | 21 total = 5 `src` + 15 `__tests__` + 1 README | §8.5, §9.3 |
| `packages/router/src` — 39 | 39 total = 5 `src` + 33 `__tests__` + 1 README | §8.4, §9.2 |
| `packages/create/templates` — 7 files | **6** template files; `packages/create` totals 7 with `__tests__/cli.test.ts` | §8.6, §11.1 |
| `www/app` — "32 class modules the site ships" | 34 files in the scan: 32 class modules (27 bindings + 4 `site-ui` + `layout.tsx`) plus the 2 already-function-lane islands | §5 |
| `www/app/components/article-routes` — 40 generated modules (from the 2026-11-18 doc) | **27** at this SHA | §5.2 |
| "classes" column is a class count | prefix match; 9 files / 11 declarations, seven of them not class-lane | §2.3, rows marked `†` |
| `www/app/layout.tsx` 448 lines, `apps/saas/app/layout.tsx` 23 lines | **both MIGRATED 2026-11-20** (layout-pair + nested-expansion slices) | `migrated` |

## 4. Decision register — every `D-Mx` this matrix references

Each row in §5–§11 names decisions from this register. Every decision here is
either recorded in the tree (with its carrier) or is a named owner direction that
must land before the row can move. **A row may not invent a decision that is not
in this table**; a row that needs one is `blocked (D-Mx)`.

| # | Decision | State | Carrier / authority |
| --- | --- | --- | --- |
| D-M1 | **Layout tag source.** The convention layout's tag is the router constant `CONVENTION_LAYOUT_TAG` (`app-layout`), not a decorator and not a path-derived tag. A function-component layout takes its tag from the same constant. | **Recorded** | `packages/router/src/config.ts:97` (`CONVENTION_LAYOUT_TAG`), `packages/router/src/vite/app-config.ts:428` (`tagName: CONVENTION_LAYOUT_TAG`), the `generated-element-site.ts` design note, and the `16b-MN` 2026-11-18 tag-source section |
| D-M2 | **No component-authored `computed` in the generated lane.** Derived values inline at their sink; a `computed` closed over the generated `props` record tracks no signal and would compute once and go permanently stale. (Original text kept as history — see D-M10.) | **SUPERSEDED by D-M10 (2026-11-20)** — no line deleted | `docs/architecture/16b-migration-note.md` "2026-11-18 ruling — no `computed` support in the generated lane; inline instead" |
| D-M3 | **`trustedHtml` body does not cross to the client.** The brand is `WeakSet` object identity and does not serialize; a transport would mint trust from bytes. The article body must stop being a runtime string, or the component stays class-lane. | **Recorded** | `16b-migration-note.md` "2026-11-18 ruling — no `trustedHtml` transport" (three arguments, measured); owner 2026-11-20 permanent exclusion (D7 of the 2026-11-20 owner amendment; its plan §19 entry is L5's) |
| D-M4 | **A class caller cannot render a generated child through the child's descriptor.** A class page's nested expansion applies its own attribute rules, so a generated light child loses `data-oe-light` and its JSON seed. | **Recorded (measured)** | `16b-migration-note.md` "Third boundary: a CLASS page's nested expansion bypasses the generated descriptor" |
| D-M5 | **Article body as a build-time structured body.** The body stops being a runtime string: the generator emits the article content as a non-runtime structure the generated lane can consume, removing both the `trustedHtml` row and its `innerHTML` sink. | **Owner-directed in Alpha16b (2026-11-20); design owed** | Owner direction 2026-11-20 ("all capabilities inside Alpha16; no patch-style deferral"); the *design* must land as its own ADR dated amendment before any row claims it. the article-body rows (§5.1 `open-article-view`, §5.2's 27 bindings, §5.3's generator and its test) stay `blocked (D-M5)` until then |
| D-M6 | **`16b-LC` depth ≥ 2, recipe/list placement, non-retained targets, pre-DOM timing, connection-scope helper parameters.** | **Owner-directed in Alpha16b (2026-11-20)** — replaces the earlier "Still owed" reading | Owner direction; the implementing slice amends ADR-0181 and flips the inventory's `PARTIAL` row. Until then the inventory row stands |
| D-M7 | **`useHost` and component `ref`.** | **Owner-directed in Alpha16b (2026-11-20)** — supersedes ADR-0182's 2026-11-20 "useHost is FUTURE/OWED" and D-18b-5 "component `ref` is FUTURE" | Owner direction. ADR-0182 needs a dated amendment before implementation; the "FUTURE" text stays as written (amend-never-rewrite). Class `ref` retires with the class lane (owner D4) |
| D-M8 | **`16b-EB` SSR fallback.** | **Owner-directed in Alpha16b (2026-11-20)** — reverses plan §18.3's Alpha17 carry | Owner direction. Requires the plan §18.3 reversal recorded in §19 plus the four satisfaction conditions §18.3 already enumerated |
| D-M9 | **Generated-lane `slot`/projection.** A page-local component that RECEIVES children needs the per-slot anchor discipline before it can migrate; a leaf-only component is unaffected. | **Recorded; mechanism partially delivered** | `16b-migration-note.md` "Second boundary" + `packages/element/src/internal/compiled/slot-anchors.ts`; the remaining gap is the class-*caller* half (D-M4) |
| D-M10 | **Generated-lane `computed` intrinsic (scheme B).** `const x = computed(() => expr)` is a compiler-erased intrinsic admitted at component-setup top level (binding provenance, the ADR-0180 pattern); the compiler lowers it to an instance-retained derived signal on the platform signals primitive already shipped in the runtime bundle; lazy recompute, `Object.is` non-propagation, read-only, disposed with the owner, fail-closed declaration order/cycles; SSR evaluates once per render. Model completeness beats minimum mechanism count. | **Owner-directed 2026-11-20; design recorded, implementation pending** — this is the ruling that **supersedes D-M2** | [`ADR-0183`](../adr/ADR-0183-one-reactive-contract.md) — Status **ACCEPTED** (owner direction 2026-11-20, in-session; the record names its implementation order: D-5 tracked props first, then D-4 the `computed` intrinsic) + execution-plan §19 entry (L5). Until that implementation ships, rows whose target form needs the intrinsic are `blocked (D-M10)` |
| D-M11 | **Streamed page authoring has no function-lane carrier.** A route declaring `renderIntent.stream` can only be a compiled `@element` class page today: `authoring.ts` rejects `stream` on a server function page, and the build refuses a *generated element page* that declares a stream manifest. Retiring the class lane therefore removes streamed-page authoring unless a carrier is added. | **OPEN owner question — measured, not ruled** | Measured at `packages/router/src/authoring.ts:633` ("renderIntent.stream is not supported on a server function page: streaming is a compiled-Part-Program channel"), `packages/router/src/vite/internal/ssg/page-classification.ts:616-625` (a generated element page declaring `renderIntent.stream` fails `GENERATED_ELEMENT_PAGE_UNSUPPORTED`; "generated element hosts are synchronous-SSR only"), and plan §18.1:746 ("the lane is synchronous-SSR only; streaming/deferred DSD stays outside it"). Blocked rows: 3 fixture page components, 3 package tests |

**Read this register first.** D-M5, D-M6, D-M7, D-M8 and D-M10 are owner-directed
obligations that **expand** Alpha16b; D-M11 is an owner question that blocks the
retirement itself. The matrix marks every row that depends on them as
`blocked (D-Mx)` so no row silently reads as unblocked work.

### 4.1 What each owner-directed row needs before it can move

The owner direction says *what* and *by when*; it does not itself deliver the
design. Each row below names what must land first, so the blocked rows have a
watch item rather than a vague "later".

| Decision | Must land first | Owning lane |
| --- | --- | --- |
| D-M5 | its own ADR dated amendment (the article-body structure, its non-runtime form and its byte attribution) + an execution-plan §19 entry recording it. **No lane in this wave was chartered to design it** — L2's ADR-0183 covers `computed` only | **unassigned; Lead/owner must assign** |
| D-M6 | ADR-0181 dated amendment (final placement set: depth ≥ 2, recipe/list, non-retained targets, pre-DOM timing, connection-scope helper parameters) + plan §19 entry + the inventory row flip | ADR-0181 amendment (not L2) + plan §19 (L5) |
| D-M7 | ADR-0182 dated amendment implementing `useHost` and component `ref` (it supersedes the 2026-11-20 "FUTURE/OWED" text without rewriting it) + plan §19 entry + a `16b-MN` amendment | ADR-0182 amendment (not L2) + plan §19 (L5) |
| D-M8 | the plan §18.3 reversal recorded as a dated amendment (§19) + the four §18.3 satisfaction conditions + inventory row flip | L5 (plan §19) |
| D-M10 | the ADR-0183 implementation order: **D-5** (tracked props record with the per-key write, counter/`bumpProps` deleted, seam row + consumer-form test) then **D-4** (the `computed` intrinsic: lowering, placement verdicts, SSR-once, equality cut, lifecycle release, negatives), each with its byte pins | ADR-0183 (L2, accepted) + the implementation lane |
| D-M11 | an owner ruling: record the streamed-page authoring capability as retired with the class lane, or give it a carrier inside Alpha16. Nothing else can move the six blocked rows | owner |

### 4.2 How to read a row

State vocabulary (the only values the `State` column uses):

| State | Meaning |
| --- | --- |
| `ready` | No design decision is outstanding; the row can move in its §14 batch. `ready` is a disposition, not evidence |
| `blocked (D-Mx)` | The row's target form needs the named decision; it must not be migrated before that decision lands |
| `retire-with-code` | Delete the file in the same change as the code it pins; keeping it would pin a deleted frontend, ABI or protocol |
| `pinned-negative` | KEEP the file after retirement as the fail-closed proof that the lane is gone |
| `doc-rewrite` | A documentation carrier is rewritten, or receives its dated amendment. For a dated ADR, `doc-rewrite` never means editing its lines (amend-never-rewrite): it is the appended amendment |

Counts of the 300 rows (asserted in §16.2): **ready 193**,
**doc-rewrite 42**, **blocked (D-M5) 30**, **retire-with-code 25**,
**blocked (D-M11) 6**, **blocked (D-M10) 2**, **pinned-negative 2**.
Decision references: **no design decision 258**, D-M5 29, D-M5+D-M10 1,
D-M1 2, D-M1+D-M10 1, D-M10+D-M4 1, D-M10 (non-blocking) 1, D-M9 1, D-M11 6.

One file carries a split disposition inside a single row:
`compiled-element-v2.test.ts` retires its positive class-transform coverage while
its negative arm becomes the pinned-negative test over `counter.tsx` (§8.2).

## 5. Production matrix — `www/app` (34 files)

Counts are per file at the §2 SHA. `computed` = `= computed(` sites;
`props` = `@property` declarations. The first draft's §5 prose stands, with the
one substantive change the owner's 2026-11-20 ruling forces: the inline-only
reading of D-M2 is replaced by D-M10's `computed` intrinsic, so the two rows
whose target form carries component-authored `computed` are `blocked (D-M10)`
until ADR-0183's implementation lands (D-5 then D-4; `open-article-view` also
carries 6 `computed`, but its primary blocker is D-M5). `open-standards-visual` is not one of them: its single
`computed` is a one-sink `> 0` branch and inlines under either reading, so it
stays in the clean batch.

### 5.1 The five hand-written site modules

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `www/app/layout.tsx` | 1/30/38/0/0/1/no | D-M1 + D-M10 | Function layout shell; the 30 `computed` become instance-retained derived signals (ADR-0183 scheme B); the tag stays `app-layout` from `CONVENTION_LAYOUT_TAG` | blocked (D-M10) |
| `www/app/site-ui/open-section-frame.tsx` | 1/0/0/0/0/1/no | D-M9 | Function component, light root, 3 named slots + default; leaf-free, no reactive surface | ready |
| `www/app/site-ui/open-standards-visual.tsx` | 1/1/5/0/0/1/no | **MIGRATED 2026-11-20** on the generated lane (ADR-0183 D-4) — the one computed is the lane's `computed` intrinsic, the four rows are the sidecar table, root stays `light` | Function component `OpenStandardsVisual(props)` + `defineIslandConfig({ root: 'light', tag, properties })` | `migrated` — evidence: `site:build` renders `<open-standards-visual variant="packages" emphasis="high" motion="auto" label="package graph" data-oe-light>` with the package matrix content; `www` 34 files / 304 tests pass; `site-ui.test.ts` asserts the derived node is a factory-created `computed`, not a property row |
| `www/app/site-ui/open-reading-shell.tsx` | 1/21/31/0/0/1/no | D-M10 + D-M4 | Function component with the 21 `computed` as derived signals; class-page callers migrate first or in the same change (D-M4) | blocked (D-M10) |
| `www/app/site-ui/open-article-view.tsx` | 1/6/8/1/1/1/no | D-M5 + D-M10 | Function component; body becomes the build-time structured body (D-M5); the 6 `computed` fold into the projected model; no `innerHTML`/`trustedHtml` sink crosses | blocked (D-M5) |

### 5.2 The generator-owned article-route bindings — 27 files

`www/app/components/article-routes/*.tsx`, all emitted by
`www/tools/generate-site-article-routes.ts` (§5.3). **Not a 27-file risk:** the
generator is their only writer (`--check` enforces byte equality), so the
migration is ONE template edit plus one regeneration, not 27 hand edits. They are
listed per file because the retirement needs the coverage statement, and each
row inherits D-M5 from the `open-article-view` target form.

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `www/app/components/article-routes/architecture-architecture.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/architecture-comparison.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/architecture-design-system.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/architecture-dsd.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/architecture-islands.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/architecture-web-component-admission.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-api.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-compiled-grammar.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-configuration.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-core-concepts.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-deploy-cloudflare.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-deployment.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-error-handling.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-getting-started.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-glossary.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-i18n.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-islands-and-ssr.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-mdx.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-recipe-form-actions.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-recipe-island-strategies.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-recipe-theming.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-routing-and-data.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-security.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-streaming.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-styling.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-testing.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |
| `www/app/components/article-routes/guide-tutorial.tsx` | 1/0/2/0/0/1/no | D-M5 | Function-component binding emitted by the generator (one template edit, not 27 edits) | blocked (D-M5) |

### 5.3 The generator and its golden test

The 27 bindings are mechanical only because the generator is the single writer;
the generator's `renderComponent()` template is the actual migration site, and
its golden test pins the emitted text. Both stay `blocked (D-M5)` with the rows
above — the target form of the binding is decided by the target form of
`open-article-view` (§5.1). The route-module template and the route table
(`www/app/data/_generated-article-routes.ts`) are unchanged by that migration.

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `www/tools/generate-site-article-routes.ts` | 0/0/2/0/0/1/no | D-M5 | One `renderComponent()` template edit (emit a function component); the route-module template and the route table are unchanged | blocked (D-M5) |
| `www/tools/generate-site-article-routes.test.ts` | 1/0/0/0/0/0/no | D-M5 | Re-pin the golden template text in the same edit | blocked (D-M5) |

### 5.4 The two site islands — already function-lane

Both appear in the coarse scan only because their doc comments name the retired
`@element(...)` declaration they replaced. Verified: `onConnect`/`onDispose`
imported from `@openelement/element/lifecycle`, `defineIslandConfig`, light root,
no `@element` class. **No migration action.**

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `www/app/islands/open-page-rail.tsx` | 0/0/0/0/0/0/yes | — | No action: already function-lane (`onConnect`/`onDispose`, light root, `defineIslandConfig`; no `@element` class) | ready |
| `www/app/islands/open-search.tsx` | 0/0/0/0/0/0/yes | — | No action: already function-lane (`onConnect`/`onDispose`, light root, `defineIslandConfig`; no `@element` class) | ready |

## 6. Production matrix — `apps/saas` (13 files)

All 13 are class pages/shell with **0 computed and 0 trustedHtml**; props range
0–12 (`page-notes` 12, `page-workspace-records` 7, `page-admin` 6). There is no
transport decision to make: `page-notes`'s 12 props are already
`attribute: false` rows carried by the JSON seed channel. This is the cleanest
production batch and the second half of the §14 clean batch.

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `apps/saas/app/components/page-admin.tsx` | 1/0/6/0/0/1/no | — | Function page component; route logic unchanged (`definePage(Page, { head, props, renderIntent })`) | ready |
| `apps/saas/app/components/page-auth-callback.tsx` | 1/0/1/0/0/1/no | — | Function page component; route logic unchanged (`definePage(Page, { head, props, renderIntent })`) | ready |
| `apps/saas/app/components/page-checkout.tsx` | 1/0/5/0/0/1/no | — | Function page component; route logic unchanged (`definePage(Page, { head, props, renderIntent })`) | ready |
| `apps/saas/app/components/page-home.tsx` | 1/0/0/0/0/1/no | — | Function page component; route logic unchanged (`definePage(Page, { head, props, renderIntent })`) | ready |
| `apps/saas/app/components/page-login.tsx` | 1/0/5/0/0/1/no | — | Function page component; route logic unchanged (`definePage(Page, { head, props, renderIntent })`) | ready |
| `apps/saas/app/components/page-magic-link.tsx` | 1/0/3/0/0/1/no | — | Function page component; route logic unchanged (`definePage(Page, { head, props, renderIntent })`) | ready |
| `apps/saas/app/components/page-notes.tsx` | 1/0/12/0/0/1/no | — | Function page component; route logic unchanged (`definePage(Page, { head, props, renderIntent })`) | ready |
| `apps/saas/app/components/page-recover.tsx` | 1/0/2/0/0/1/no | — | Function page component; route logic unchanged (`definePage(Page, { head, props, renderIntent })`) | ready |
| `apps/saas/app/components/page-reset-password.tsx` | 1/0/1/0/0/1/no | — | Function page component; route logic unchanged (`definePage(Page, { head, props, renderIntent })`) | ready |
| `apps/saas/app/components/page-signup.tsx` | 1/0/3/0/0/1/no | — | Function page component; route logic unchanged (`definePage(Page, { head, props, renderIntent })`) | ready |
| `apps/saas/app/components/page-upload.tsx` | 1/0/4/0/0/1/no | — | Function page component; route logic unchanged (`definePage(Page, { head, props, renderIntent })`) | ready |
| `apps/saas/app/components/page-workspace-records.tsx` | 1/0/7/0/0/1/no | — | Function page component; route logic unchanged (`definePage(Page, { head, props, renderIntent })`) | ready |
| `apps/saas/app/layout.tsx` | 1/0/0/0/0/1/no | **MIGRATED 2026-11-20** (layout-pair slice) — sidecar `tag: 'app-layout'`, `root: 'shadow'`; the entry now registers a generated layout through the host PAIR channel | Function layout shell under `CONVENTION_LAYOUT_TAG` | `migrated` — evidence: `@openelement/saas` build exit 0, built `/` carries `<app-layout><template shadowrootmode="open">…<slot></slot>…</template>` plus the page projected after it; saas 20 files / 150 tests |

**Correction to a stale record.** `alpha16-remaining-consumers.md`
(measured 2026-11-18 at `@87d83d095`) states under `## saas`: "No class islands
remain." That is true of *islands* and misleading for the app: **all 13 saas class
modules are still class-lane at the §2 SHA**. The sentence is not wrong about
islands, and it is not a claim this document overturns — it is a reading that a
later reader must not take as "saas needs no migration". The re-measure is
recorded in §13.

## 7. Per-file matrix — `tests/fixtures` (81 files, 9 fixture apps)

These are the class lane's **test inputs**. The first draft deferred per-file
dispositions to the retirement PR; this revision assigns them, because the matrix
is what the retirement PR executes. The rule applied, per file:

- **Migrate** — a fixture that exists to prove a *capability* (routing, streaming,
  actions, forms, DSD, light root, interop, style pipeline). 78 of the 81 rows;
  they keep their capability coverage on the surviving lane.
- **Blocked (D-M11)** — the three page components a streamed route renders
  (`subpage-live`, `page-stream-proof`, `page-stream-lit-proof`). A streamed page
  cannot be a function page today (§4, D-M11), so these are not "migration
  pending", they are an owner question.
- **Retire with the code / pinned negative** — no `tests/fixtures` app qualifies:
  all nine prove a capability. The one pinned negative is the compiler fixture
  `packages/element/__fixtures__/compiled-element-v2/counter.tsx` (§8.1), which
  is already the canonical class-authored input its tests read.

Target forms: a page/component becomes a **function page component** (the class
and `@element` decoration removed; `definePage`, the loader, head and the route
module unchanged); an island becomes a **generated function island** keeping its
`defineIslandConfig` sidecar. One fixture file (`router-request-time/app/routes/decoupled.tsx`)
carries no class construct at all — its scan hit is a comment naming the
retired API.

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `tests/fixtures/router-base-path/app/components/subpage-card.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-base-path/app/components/subpage-home.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-base-path/app/components/subpage-live.tsx` | 1/0/1/0/0/1/no | D-M11 | Function page component only after the streamed-page carrier is ruled (D-M11); today `definePage` refuses `renderIntent.stream` on a function page and the build refuses a streamed generated page | blocked (D-M11) |
| `tests/fixtures/router-base-path/app/components/subpage-note.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-native-framework/app/components/page-404.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-native-framework/app/components/page-boom.tsx` | 1/0/2/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-native-framework/app/components/page-home.tsx` | 1/0/1/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-native-framework/app/components/page-note-detail.tsx` | 1/0/7/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-native-framework/app/components/page-note-edit.tsx` | 1/0/3/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-native-framework/app/components/page-note-new.tsx` | 1/0/3/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-native-framework/app/components/page-notes-index.tsx` | 1/0/3/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-native-framework/app/components/page-playground.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-native-framework/app/components/page-stream-lit-proof.tsx` | 1/0/1/0/0/1/no | D-M11 | Function page component only after the streamed-page carrier is ruled (D-M11); today `definePage` refuses `renderIntent.stream` on a function page and the build refuses a streamed generated page | blocked (D-M11) |
| `tests/fixtures/router-native-framework/app/components/page-stream-proof-off.tsx` | 1/0/1/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-native-framework/app/components/page-stream-proof.tsx` | 1/0/1/0/0/1/no | D-M11 | Function page component only after the streamed-page carrier is ruled (D-M11); today `definePage` refuses `renderIntent.stream` on a function page and the build refuses a streamed generated page | blocked (D-M11) |
| `tests/fixtures/router-native-framework/app/components/page-tuple-probes.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-native-framework/app/islands/note-counter.tsx` | 1/0/1/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/router-native-framework/app/islands/stream-lit-probe.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/router-request-time/app/components/page-404.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-boom.tsx` | 1/0/3/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-combobox.tsx` | 1/0/1/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-decoupled.tsx` | 1/0/1/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-fail-unserializable.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-form.tsx` | 1/0/3/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-guestbook.tsx` | 1/0/3/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-home.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-item.tsx` | 1/0/4/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-items.tsx` | 1/0/2/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-live.tsx` | 1/0/2/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-panel-dynamic.tsx` | 1/0/1/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-panel-static.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-ping.tsx` | 1/0/2/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-regions.tsx` | 1/0/3/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-register.tsx` | 1/0/3/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-set-cookie.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-set-header.tsx` | 1/0/1/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-shared.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-styled.tsx` | 1/0/1/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-subscribe.tsx` | 1/0/3/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-unstable.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/components/page-visible-probe.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-request-time/app/islands/decoupled-view.tsx` | 1/0/1/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/router-request-time/app/islands/live-counter.tsx` | 1/0/1/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/router-request-time/app/islands/probe-panel.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/router-request-time/app/islands/styled-badge.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/router-request-time/app/islands/visible-probe.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/router-request-time/app/islands/zag-combobox-light.tsx` | 1/0/1/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/router-request-time/app/islands/zag-combobox.tsx` | 1/0/1/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/router-request-time/app/routes/decoupled.tsx` | 0/0/0/0/0/0/no | — | No change: no class-lane construct (the scan hit is a comment/string reference); its page component is the row that migrates | ready |
| `tests/fixtures/router-static-only/app/components/page-about.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-static-only/app/components/page-home.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-ui-dogfood/app/components/boundary-closed.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-ui-dogfood/app/components/boundary-light.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-ui-dogfood/app/components/page-boundaries.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-ui-dogfood/app/components/page-dialog.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-ui-dogfood/app/components/page-dropdown.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-ui-dogfood/app/components/page-form.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-ui-dogfood/app/components/page-home.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-ui-dogfood/app/components/page-tailwind-probe.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-ui-dogfood/app/components/shadow-tailwind-probe.tsx` | 1/0/1/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-ui-dogfood/app/islands/form-probe.tsx` | 1/0/1/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/router-unocss-probe/app/components/probe-page.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/router-unocss-probe/app/islands/probe-unocss-card.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/site-light-probe/app/components/page-light-probe.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/site-light-probe/app/islands/light-probe-card.tsx` | 1/0/1/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/site-light-probe/app/islands/light-probe-runtime-carrier.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/site-light-probe/app/islands/open-light-probe.tsx` | 1/0/2/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/site-light-probe/app/islands/probe-shadow-card.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/site-light-probe/app/islands/semantics-probe.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/third-party-web-components/app/components/page-third-party-wc.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/third-party-web-components/app/islands/wc-fixture.tsx` | 1/0/1/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/third-party-web-components/app/islands/wc-open-child.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/third-party-web-components/app/islands/wc-open-closed.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/third-party-web-components/app/islands/wc-open-fast.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/third-party-web-components/app/islands/wc-open-light.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/third-party-web-components/app/islands/wc-open-native.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/third-party-web-components/app/islands/wc-open-nested.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/third-party-web-components/app/islands/wc-open-stencil.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/third-party-web-components/app/islands/wc-unused-late.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |
| `tests/fixtures/web-component-interop/app/components/page-interop-home.tsx` | 1/0/0/0/0/1/no | — | Function page/component; `definePage`/loader/head unchanged; `@element` + class removed | ready |
| `tests/fixtures/web-component-interop/app/islands/interop-fixture.tsx` | 1/0/0/0/0/1/yes | — | Generated function island; the `defineIslandConfig` sidecar is retained | ready |

## 8. Per-file matrix — package tests (87 files)

This is the half of the 300 that decides *what the retirement deletes* versus
*what it keeps proving*. The buckets, applied per file and recorded in the
`target form` cell:

- **retire-with-code (20 rows in this section; 25 in the matrix)** — the test's
  subject is the class authoring frontend, the decorator/`@property` grammar, the
  compiled Part Program emitter/validator/serializer, the class runtime
  executor/kernel/facade, or the class error-boundary base. Keeping it would pin
  a deleted ABI.
- **ready (keep)** — the subject is a surviving capability: the generated
  function lane, the compiler's function frontend, the generated shell's
  claim/DSD/styles/pre-upgrade behaviour, the router build/SSR/style/island/
  classification surfaces, security policy, or lane-neutral tooling. Where the
  test's only input is class-authored source, the input is rewritten to a
  function source and the assertion is kept.
- **pinned-negative (1 test + 1 fixture)** — kept precisely as the proof the lane
  is gone: `counter.tsx` (a class-authored module the post-retirement compiler
  must reject with a located diagnostic) and the `trustedHtml` default-sink test
  (the permanent D-M3/D7 negative that no raw-markup channel crosses).
- **blocked (D-M11) (3 rows)** — the streamed-page channel tests.

The dispositions are first-pass, made from each file's declared subject line and
its imports; the retirement PR confirms them by running the suite, and a row may
move only by naming the rule or decision that moves it.

### 8.1 Element compiler fixtures (2)

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `packages/element/__fixtures__/compiled-element-v2/counter.tsx` | 1/0/3/0/0/1/no | — | KEPT BYTE-IDENTICAL as the pinned negative: the post-retirement compiler must reject a class-authored module with a located diagnostic | pinned-negative |
| `packages/element/__fixtures__/compiled-element-v2/unsupported-spread.tsx` | 1/0/0/0/0/1/no | — | Retire with the spread arm of `compiled-element-v2.test.ts`; the diagnostic it asserts no longer exists | retire-with-code |

### 8.2 `packages/element/__tests__` (33)

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `packages/element/__tests__/compile-decorators.test.ts` | 0/0/1/0/0/1/no | — | Retire with the decorator frontend (`compile-decorators.ts`, `@element`/`@property` dual-use contract) | retire-with-code |
| `packages/element/__tests__/compiled-element-v2.test.ts` | 40/6/0/4/11/0/yes | — | Retire the positive class-transform coverage; the negative arm becomes the pinned-negative test over `counter.tsx` (two rows for this file) | retire-with-code |
| `packages/element/__tests__/compiled-hydration/dsd-handoff.test.ts` | 0/0/0/0/0/0/no | — | Keep the capability, re-base on the generated shell: the DSD stylesheet claim-then-delete lifecycle is generated-lane | ready |
| `packages/element/__tests__/compiled-hydration/stream-facade.test.ts` | 0/0/0/0/0/0/no | D-M11 | The streamed claim/stream facade it pins belongs to the streamed-page channel under D-M11 | blocked (D-M11) |
| `packages/element/__tests__/compiled-hydration/version-mismatch-refusal.test.ts` | 3/0/0/0/0/0/no | — | Keep the refusal, re-anchor it on `COMPILED_MODULE_ABI_VERSION` (the retained build-identity check, plan §12) | ready |
| `packages/element/__tests__/compiled-runtime/conditional-class.test.ts` | 2/0/0/0/0/0/no | — | Retire with the compiled Part Program runtime (inline conditional class over a program) | retire-with-code |
| `packages/element/__tests__/compiled-runtime/error-boundary-capture.test.ts` | 0/0/0/0/0/0/no | — | Keep the capability, re-base on the `onError` intrinsic capture points (16b-EB) | ready |
| `packages/element/__tests__/compiled-runtime/facade-activation.test.ts` | 1/0/0/0/0/0/no | — | Retire with the public `OpenElement` class facade | retire-with-code |
| `packages/element/__tests__/compiled-runtime/facade.test.ts` | 5/0/0/0/0/0/no | — | Retire with the public `OpenElement` class facade | retire-with-code |
| `packages/element/__tests__/compiled-runtime/pre-upgrade-bounded.test.ts` | 1/0/0/0/0/0/no | — | Keep the capability, re-base on the generated shell pre-upgrade capture | ready |
| `packages/element/__tests__/compiled-runtime/shadow-replay.test.ts` | 2/0/0/0/0/0/no | — | Keep the capability, re-base on the generated shell pre-hydration replay | ready |
| `packages/element/__tests__/compiled-runtime/trusted-html-default.test.ts` | 2/0/0/7/1/0/no | — | Keep as the permanent D-M3 negative: `trustedHtml` is a server-side identity brand and no raw-markup channel crosses to the client | pinned-negative |
| `packages/element/__tests__/compiled-runtime/when-branch-sinks.test.ts` | 2/0/0/0/0/0/no | — | Keep the when-branch sink semantics, re-base on the generated frontend (M03 parity) | ready |
| `packages/element/__tests__/compiled-server/memory-sheet-policy.test.ts` | 0/0/0/0/0/0/no | — | Keep: URL-less memory sheet policy is server-side and lane-neutral | ready |
| `packages/element/__tests__/compiled-server/nested-light-style-delivery.test.ts` | 0/0/0/0/0/0/no | — | Keep: light-root style delivery is generated-lane | ready |
| `packages/element/__tests__/compiler-emitted-module-typecheck.test.ts` | 6/0/0/0/0/0/no | — | Retire with the emitted class-compiled module (`counter.tsx` input) | retire-with-code |
| `packages/element/__tests__/compiler-fail-closed-matrix.test.ts` | 1/9/13/0/2/1/no | — | Retire with the class grammar it pins fail-closed; the function frontend keeps its own fail-closed suite | retire-with-code |
| `packages/element/__tests__/compiler-intrinsic-provenance-alpha10-verifier.test.ts` | 5/0/0/0/0/0/no | — | Keep the binding-provenance rule, drop the decorator arm; the intrinsic rule is shared with ADR-0180 | ready |
| `packages/element/__tests__/compiler-intrinsic-provenance.test.ts` | 20/2/0/1/2/0/yes | — | Keep the binding-provenance rule over the function intrinsics; the 20 inline class sources become function sources | ready |
| `packages/element/__tests__/compiler-jsx-text-whitespace.test.ts` | 2/0/0/1/3/1/no | — | Keep: JSX text lowering is lane-neutral | ready |
| `packages/element/__tests__/compiler-lifecycle-capture-source-map.test.ts` | 0/0/1/0/0/1/no | — | Re-anchor the capture source map on the `onConnect`/`onDispose` intrinsics (ADR-0180) | ready |
| `packages/element/__tests__/compiler-plugin-diagnostics.test.ts` | 2/0/0/0/0/0/no | — | Keep: structured plugin diagnostics are lane-neutral | ready |
| `packages/element/__tests__/compiler-semantic-core-boundary.test.ts` | 1/0/1/0/0/1/no | — | Keep: the semantic-core boundary is the function frontend boundary | ready |
| `packages/element/__tests__/compiler-source-map-v3.test.ts` | 4/1/7/0/0/2/yes | — | Keep the source-map contract over the generated lane (M03-I-4b) | ready |
| `packages/element/__tests__/compiler-style-admission.test.ts` | 7/0/0/0/0/0/yes | — | Keep: sheet-import admission is the one style authoring form | ready |
| `packages/element/__tests__/light-dom-activation.test.ts` | 0/0/0/0/0/0/no | — | Retire with the compiled Part Program activation path; the generated shell owns light-root activation | retire-with-code |
| `packages/element/__tests__/module-analysis.test.ts` | 3/0/0/0/0/3/no | — | Retire with the decorator facts (`compiledElementDecorator`, `@element` detection) | retire-with-code |
| `packages/element/__tests__/no-dom-runtime.test.ts` | 2/0/0/0/0/0/no | — | Keep: the no-DOM import surface is the public package surface | ready |
| `packages/element/__tests__/open-element.test.ts` | 1/0/0/0/0/0/no | — | Retire with the compiled Part Program facade | retire-with-code |
| `packages/element/__tests__/part-program-validation-adversarial.test.ts` | 2/0/8/1/1/2/no | — | Retire with `validatePartProgram` / the serialized protocol | retire-with-code |
| `packages/element/__tests__/resume-lifecycle-hooks.test.ts` | 0/0/0/0/0/0/no | — | Re-base on the lifecycle intrinsics (the class lifecycle-override arm retires) | ready |
| `packages/element/__tests__/root-mode-contract.test.ts` | 1/0/0/0/0/1/no | — | Keep: the public root-mode contract is lane-neutral | ready |
| `packages/element/__tests__/v044-delivery/compiler-gate.test.ts` | 2/0/0/0/0/0/no | — | Retire with the v0.44 class compiler gate | retire-with-code |

### 8.3 `packages/element/__wtr__` (3)

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `packages/element/__wtr__/fixtures/wtr-field.tsx` | 1/0/3/0/0/1/no | — | Function component compiled by the WTR harness; the FACE conformance contract is unchanged | ready |
| `packages/element/__wtr__/fixtures/wtr-shadow-button.tsx` | 1/0/1/0/0/1/no | — | Function component compiled by the WTR harness; the shadow-event contract is unchanged | ready |
| `packages/element/__wtr__/tests/stream-hydrate-order.test.js` | 0/0/0/0/0/0/no | D-M11 | Keep if the streamed-page carrier survives (D-M11); retire with the streamed channel otherwise | blocked (D-M11) |

### 8.4 `packages/router/__tests__` (33)

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `packages/router/__tests__/app-config.test.ts` | 0/0/0/0/0/0/no | — | Keep: app-config/layout tag facts; D-M1 is recorded | ready |
| `packages/router/__tests__/authoring.test.ts` | 1/0/0/0/0/0/no | — | Keep `definePage`; the class arm becomes a negative (a class page is refused after retirement) | ready |
| `packages/router/__tests__/browser-entry-boundary.test.ts` | 2/0/1/0/0/2/yes | — | Keep: the client entry graph boundary is the P1 proof | ready |
| `packages/router/__tests__/browser-entry-graph.test.ts` | 2/0/1/0/0/2/yes | — | Keep: no production browser entry reaches the old executor (P1) | ready |
| `packages/router/__tests__/build-diagnostics.test.ts` | 1/0/0/0/0/0/no | — | Keep: diagnostics aggregation is lane-neutral | ready |
| `packages/router/__tests__/compiler-open-core-boundary.test.ts` | 3/0/0/0/0/0/no | — | Keep: the open-core boundary is unchanged | ready |
| `packages/router/__tests__/consumer-diagnostics.test.ts` | 1/0/0/0/0/0/no | — | Keep: consumer diagnostics are lane-neutral | ready |
| `packages/router/__tests__/derived-admission.test.ts` | 6/0/0/0/0/0/no | — | Keep: island auto-admission; the class-candidate arm retires | ready |
| `packages/router/__tests__/dev-authored-css.test.ts` | 3/0/2/0/0/3/yes | — | Keep: dev authored CSS is a style-asset capability | ready |
| `packages/router/__tests__/dev-nonroot-base.test.ts` | 3/0/2/0/0/3/yes | — | Keep: non-root base is a routing capability | ready |
| `packages/router/__tests__/dev-tailwind.test.ts` | 4/0/2/0/0/4/yes | — | Keep: Tailwind linking is lane-neutral | ready |
| `packages/router/__tests__/error-boundary-capture.test.ts` | 4/1/5/0/0/5/yes | — | Keep: real dev-server/browser capture; the class arm of its fixture pages migrates | ready |
| `packages/router/__tests__/error-qualification-matrix.test.ts` | 5/0/0/0/0/0/no | — | Keep: the error qualification matrix is lane-neutral | ready |
| `packages/router/__tests__/external-consumer-build.test.ts` | 4/0/0/0/0/0/yes | — | Keep: the packed/consumer build proof is lane-neutral | ready |
| `packages/router/__tests__/generated-host-vertical.test.ts` | 1/0/1/0/0/1/yes | — | Keep: M11 generated-host vertical is the surviving lane | ready |
| `packages/router/__tests__/island-blocks-scan.test.ts` | 5/0/0/0/0/0/no | — | Keep: the blocks axis is compiler-owned and lane-neutral | ready |
| `packages/router/__tests__/island-scanner.test.ts` | 0/0/0/2/0/0/yes | — | Keep: island sidecar metadata extraction | ready |
| `packages/router/__tests__/island-style-build.test.ts` | 2/0/0/0/0/0/yes | — | Keep: generated-island styles (ADR-0181 D-16c) | ready |
| `packages/router/__tests__/island-transform.test.ts` | 1/0/0/0/0/0/no | — | Keep: the island transform is the surviving lane | ready |
| `packages/router/__tests__/package-import-admission-probe.test.ts` | 2/0/0/0/0/0/no | — | Keep: package import admission is lane-neutral | ready |
| `packages/router/__tests__/page-classification.test.ts` | 1/0/0/0/0/0/no | — | Keep: the build-time page-kind classifier; the class arm becomes the pinned negative | ready |
| `packages/router/__tests__/page-route-tag-resolution.test.ts` | 0/0/0/0/0/0/no | — | Keep C08 behaviour: the decorated tag wins over the path-derived one; the runtime read is replaced by the build fact | ready |
| `packages/router/__tests__/plugin-mdx.test.ts` | 1/0/0/0/0/0/no | — | Keep: MDX still lowers to a page program at build time; only the emitted binding changes lane | ready |
| `packages/router/__tests__/shadow-candidate-collection.test.ts` | 0/0/0/0/0/0/no | — | Keep, smaller: the candidate input set shrinks to sidecar-declared tags | ready |
| `packages/router/__tests__/ssr-css-defects.test.ts` | 0/0/0/0/0/0/no | — | Keep: SSR inline-CSS behaviour is lane-neutral | ready |
| `packages/router/__tests__/static-component-scanner.test.ts` | 9/0/0/0/0/0/no | — | Keep the build-fact scanner; delete the decorator arm (C08 source) | ready |
| `packages/router/__tests__/stream-manifest.test.ts` | 3/3/3/1/1/3/no | D-M11 | The streamed-page manifest it pins has no function-lane carrier (D-M11) | blocked (D-M11) |
| `packages/router/__tests__/style-asset-build.test.ts` | 3/0/0/0/0/0/yes | — | Keep: the style-edge build is lane-neutral | ready |
| `packages/router/__tests__/style-only-build.test.ts` | 1/0/0/0/0/0/no | — | Keep: static-only style build | ready |
| `packages/router/__tests__/tailwind-component-discovery.test.ts` | 1/0/0/0/0/0/no | — | Keep: discovery is lane-neutral | ready |
| `packages/router/__tests__/tailwind-component-sheet-urls.test.ts` | 2/0/0/0/0/0/yes | — | Keep: the `url()` contract is lane-neutral | ready |
| `packages/router/__tests__/tailwind-css-only-build.test.ts` | 1/0/0/0/0/0/no | — | Keep: CSS-only build | ready |
| `packages/router/__tests__/v044-delivery/island-delivery.test.ts` | 3/0/0/0/0/0/yes | — | Keep: generated island delivery | ready |

### 8.5 `packages/compiler/__tests__` (15)

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `packages/compiler/__tests__/admission-prefilter-superset.test.ts` | 4/0/0/0/0/0/no | — | Retire: the cheap admission prefilter models the decorator-application shape | retire-with-code |
| `packages/compiler/__tests__/authoring-diagnostics.test.ts` | 1/0/0/0/0/0/no | — | Retire: class authoring diagnostics | retire-with-code |
| `packages/compiler/__tests__/compiled-artifact-style-requests.test.ts` | 2/0/0/0/0/0/no | — | Retire: the artifact-adoption read only has class-compiled artifacts to read today | retire-with-code |
| `packages/compiler/__tests__/compiler-diagnostics-envelope.test.ts` | 1/0/0/0/0/0/no | — | Keep: the envelope is the shared consumption surface | ready |
| `packages/compiler/__tests__/error-boundary-base-admission.test.ts` | 2/0/0/0/0/0/no | — | Retire: it admits the class `ErrorBoundary` authoring form | retire-with-code |
| `packages/compiler/__tests__/error-boundary-lifecycle-capture.test.ts` | 1/0/0/0/0/0/no | — | Retire: the class lifecycle capture wrapper | retire-with-code |
| `packages/compiler/__tests__/grammar-message-contracts.test.ts` | 7/3/9/3/2/7/yes | — | Retire: class-grammar message contracts | retire-with-code |
| `packages/compiler/__tests__/semantic-ir/function-frontend.test.ts` | 1/1/2/0/6/1/no | — | Keep: the function frontend is the surviving lane | ready |
| `packages/compiler/__tests__/semantic-ir/generated-element.delegates-focus.test.ts` | 0/0/0/0/0/0/yes | — | Keep: the island sidecar fact (M09-2a) | ready |
| `packages/compiler/__tests__/semantic-ir/m03-security-parity.test.ts` | 1/0/3/0/2/1/no | — | Keep the function half; retire the class half of the parity matrix | ready |
| `packages/compiler/__tests__/semantic-ir/m03-sourcemap-parity.test.ts` | 1/0/1/0/0/1/no | — | Keep the function half; retire the class half | ready |
| `packages/compiler/__tests__/server-component-dispatcher.test.ts` | 1/0/0/0/0/2/no | — | Keep: the server component lane | ready |
| `packages/compiler/__tests__/server-component-full-await.test.ts` | 1/0/1/0/0/1/no | — | Keep: M14 full-await | ready |
| `packages/compiler/__tests__/tailwind-candidates.test.ts` | 3/0/0/0/0/0/no | — | Keep: static Tailwind candidates; the class-candidates module retires | ready |
| `packages/compiler/__tests__/when-branch-trusted-html-attribution.test.ts` | 1/0/2/1/6/0/no | — | Retire: the class grammar attributes the trusted sink; the generated lane refuses `innerHTML` outright (OEC9044) | retire-with-code |

### 8.6 `packages/create/__tests__` (1)

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `packages/create/__tests__/cli.test.ts` | 0/0/0/0/0/0/no | — | Update the generated-starter assertions with the starter rewrite | ready |

## 9. Per-file matrix — package sources and READMEs (21 files)

The first draft's §7.4 said "`packages/element/src` — 8 class-bearing … the class
authoring frontend and the class runtime production path". The class column does
not support "8 class-bearing" as a list of class *frontend* files: re-measured
with a word boundary (§2.3), only three of the eight hold a class-lane authoring
class — `open-element-implementation.ts` (`OpenElement`), `open-element-configuration.ts`
(the configuration base) and `error-boundary.ts` (`ErrorBoundary`) — while
`shell.ts` is the generated-element shell and the rest carry `extends OpenElementError`
classes. §9.1 records that correction per file. `packages/protocol` has no scan
row (§3.1); its `part-program.ts` retirement is the protocol-level statement in
§12, not a per-file row of this set.

### 9.1 `packages/element/src` — 8 files

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `packages/element/src/error-boundary.ts` | 1/0/0/0/0/0/no | — | Retire with the class authoring frontend: `ErrorBoundary extends OpenElement` is the class contract; the generated lane boundary is the `onError` intrinsic (ADR-0182) | retire-with-code |
| `packages/element/src/internal/compiled/each-key.ts` | 1/0/0/0/0/0/no † | — | Retire with the Part Program executor (importers measured: `runtime/blocks.ts`, `runtime/hydrate.ts`, `compiled/server/index.ts`); a generated-lane importer moves the row to shared | retire-with-code |
| `packages/element/src/internal/compiled/generated-element/shell.ts` | 1/0/0/2/0/0/no † | — | Survives: the generated-element shell (ADR-0181); its 2 `trustedHtml` sites are the server-side default sink. The class count is `GeneratedElementShell extends OpenElementBase` | ready |
| `packages/element/src/internal/compiled/runtime/hydrate.ts` | 1/0/0/0/0/0/no † | — | Survives as a shared compiled-runtime hydration helper (importers `index.ts`, `no-blocks.ts`, `runtime-only-host-attributes.ts`); the program-hydration half retires with the executor. The class count is an error class | ready |
| `packages/element/src/internal/compiled/runtime/values.ts` | 1/0/0/0/0/0/no † | — | Survives: canonical compiled value semantics imported by `shell.ts`/`leaf-runtime.ts`/`server.ts`. The class count is an error class | ready |
| `packages/element/src/internal/core/errors.ts` | 2/0/0/0/0/0/no † | — | Survives: the package error facade. Both class counts are `extends OpenElementError` | ready |
| `packages/element/src/open-element-configuration.ts` | 1/0/0/0/0/0/no † | — | Retire with the class authoring frontend: `OpenElementConfiguration extends OpenElementBase` is the class configuration base | retire-with-code |
| `packages/element/src/open-element-implementation.ts` | 1/0/0/0/0/0/no † | — | Retire with the class authoring frontend: `OpenElement extends OpenElementConfiguration` is the authoring base class | retire-with-code |

### 9.2 `packages/router/src` (5)

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `packages/router/src/authoring.ts` | 2/0/0/3/0/0/yes † | — | Survives (`definePage`/`openElementPage`); delete the `isClass` arm. The class counts are the `OpenElementRedirect`/`OpenElementNotFound` error classes | ready |
| `packages/router/src/vite/internal/collect-shadow-candidates.ts` | 0/0/0/0/0/0/no | — | Survives, smaller: the class-candidate input set shrinks to sidecar-declared tags | ready |
| `packages/router/src/vite/internal/server-runtime/renderer-runtime.ts` | 0/0/0/0/0/0/no | — | Survives with C08: resolve the page tag from build-time facts, never `default.__partProgram.tag` | ready |
| `packages/router/src/vite/plugin-mdx-lower.ts` | 0/0/0/0/0/0/no | — | Survives: MDX lowering; the emitted binding changes lane with the page batch | ready |
| `packages/router/src/vite/plugin-mdx.ts` | 0/0/0/0/0/0/no | — | Survives: MDX plugin registration; no class-specific path | ready |

### 9.3 `packages/compiler/src` (5)

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `packages/compiler/src/internal/compiler/compiled-artifact-style-requests.ts` | 0/0/0/0/0/0/no | — | Survives, smaller: after retirement only function-lane artifacts are readable | ready |
| `packages/compiler/src/internal/compiler/plugin.ts` | 0/0/0/0/0/0/no | — | Survives: the Vite boundary; stop registering the decorator frontend transform | ready |
| `packages/compiler/src/internal/compiler/semantic-core/analyze-module.ts` | 0/0/0/1/0/0/yes | — | Retire the class-shape analysis (`@element` class + decorator options + render inventory); the function frontend analyses in `function-frontend.ts` | retire-with-code |
| `packages/compiler/src/internal/compiler/semantic-core/diagnostics/index.ts` | 1/0/0/0/0/0/no † | — | Survives: the diagnostics surface. The class count is `CompilerDiagnosticError extends OpenElementError` | ready |
| `packages/compiler/src/internal/compiler/semantic-core/module-analysis.ts` | 0/0/0/0/0/0/yes | — | Survives, smaller: delete the `compiledElementDecorator` fact and the decorator arm; keep the bundler-neutral specifier facts the generated lane consumes | ready |

The class-grammar retirement lands here and in `analyze-module.ts` /
`module-analysis.ts`; the Part Program v2 protocol itself lives in
`packages/protocol/src/part-program.ts` (1631 lines, `wc -l`) and retires with
the emitter — a tracked source statement, not a scanned row (§3.1).

### 9.4 Package READMEs (3)

The READMEs are the authoring front door: a new user copies from them. They ship
with the `16b-MN` rewrite (draft §7.1's "same PR as the note").

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `packages/compiler/README.md` | 0/0/0/0/0/0/no | — | Rewrite the `@element`/class examples to the function lane; the README is the authoring front door (ships with the 16b-MN rewrite) | doc-rewrite |
| `packages/element/README.md` | 1/0/1/0/0/1/no | — | Rewrite the `@element`/class examples to the function lane; the README is the authoring front door (ships with the 16b-MN rewrite) | doc-rewrite |
| `packages/router/README.md` | 1/0/1/0/0/1/no | — | Rewrite the `@element`/class examples to the function lane; the README is the authoring front door (ships with the 16b-MN rewrite) | doc-rewrite |

## 10. Per-file matrix — docs and site content (39 files)

Documentation and doc-examples. `16b-MN` is the release-facing carrier and must
be row-for-row (§13.2/§14.2 of the plan); the rest are rewritten alongside it.
No runtime effect — but `www/content` is not inert: `www/tools/check-content-examples.test.ts`
**compiles every example**, so the content rewrite and that test move in the
same batch, and the EN/ZH pair of each page moves together.

### 10.1 `docs/**` (13)

Dated ADRs get an **appended** dated amendment, never an in-line rewrite
(amend-never-rewrite). `alpha16-capability-inventory.md` is where D-M6/D-M7/D-M8's
inventory flips land; this matrix stays the final-SHA carrier (§15.1), not the
inventory.

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `docs/adr/ADR-0173-component-execution-and-composition.md` | 0/0/0/0/0/0/no | — | Append a dated amendment read-through: the execution/composition model for the surviving lane is ADR-0180/0182/0183. No line rewritten (amend-never-rewrite) | doc-rewrite |
| `docs/adr/ADR-0174-generated-code-runtime-and-compatibility.md` | 0/0/0/0/0/0/no | — | Append a dated amendment: Part Program v2 + `__partProgram` retired; `COMPILED_MODULE_ABI_VERSION` and the compatible-shape validation stay (plan §12) | doc-rewrite |
| `docs/adr/ADR-0182-function-component-capability-api.md` | 0/0/0/0/0/0/no | — | Append the remediation amendments: class `ref` retired (D4), component `ref` stays FUTURE (D5), `trustedHtml`/non-JSON seed crossing permanently excluded (D7), `useHost` implemented under D-M7 | doc-rewrite |
| `docs/architecture/alpha16-18-progress.md` | 0/0/0/0/0/0/no | — | Append the retirement batch row (ledger; no self-raised verdict) | doc-rewrite |
| `docs/architecture/alpha16-18-semantic-test-matrix.md` | 0/0/0/0/0/0/no | — | Mark the class rows retired; the generated-lane rows stay | doc-rewrite |
| `docs/architecture/alpha16-capability-inventory.md` | 1/0/0/0/0/0/no | — | Dated amendment: flip `16b-LC`/`16b-EB`/`useHost` per D-M6/D-M7/D-M8; add the class-retirement section; this matrix stays the final-SHA carrier (§15.1) | doc-rewrite |
| `docs/architecture/alpha16-m09-exit-docket.md` | 0/0/0/0/0/0/no | — | Append a later-reading note where it names the class lane; no exit claim changes | doc-rewrite |
| `docs/architecture/alpha16b-evidence-20261115.md` | 0/0/0/0/0/0/no | — | Append later-reading: the 2026-11-15 evidence predates D-M6/D-M7/D-M8; no number is reused as a retirement claim | doc-rewrite |
| `docs/architecture/compiler-native-architecture.md` | 1/0/0/0/0/0/no | — | Rewrite the class-grammar section to the generated lane; the Part Program v2 emitter is removed | doc-rewrite |
| `docs/architecture/m09-2a-delegates-focus.md` | 0/0/0/0/0/0/no | — | Keep the island sidecar fact; replace the class-arm examples | doc-rewrite |
| `docs/architecture/m10-preparation.md` | 0/0/0/0/0/0/no | — | Append: the class-retirement rows and the D-Mx register are the later reading | doc-rewrite |
| `docs/architecture/p1-applicability-record.md` | 0/0/0/0/0/0/no | — | Re-record at the retirement SHA; the class-lane rows leave the graph claim | doc-rewrite |
| `docs/release/late-host-island-activation-design.md` | 0/0/0/0/0/0/no | — | Remove the class-lane example path; the design is function-lane | doc-rewrite |

### 10.2 `www/content/**` (26)

`compiled-grammar.md` is the largest single rewrite (measured: 16 classes,
2 `computed`, 18 `props`, 4 `trustedHtml`, 3 `innerHTML`, 17 `@element` — its
`.zh.md` twin carries the same counts), and it is the page whose examples the
compiled-grammar contract is taught from. The blog posts are history: they get a
dated note rather than a rewrite.

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `www/content/blog/2026-10-31-alpha16-18-a-clearer-direction.md` | 1/0/1/0/0/1/no | — | Add a dated inline note over the class examples (posts are history; a dated note is the amend form) | doc-rewrite |
| `www/content/blog/2026-10-31-alpha16-18-a-clearer-direction.zh.md` | 1/0/1/0/0/1/no | — | Same dated note as the English post | doc-rewrite |
| `www/content/docs/guide/compiled-grammar.md` | 16/2/18/4/3/17/yes | — | Largest rewrite: class grammar → function/JSX grammar; the 4 `trustedHtml` examples move to the permanent-exclusion note (D-M3/D7); the 2 `computed` examples use the intrinsic if D-M10 lands (checked examples) | doc-rewrite |
| `www/content/docs/guide/compiled-grammar.zh.md` | 16/2/18/4/3/17/yes | — | Same rewrite as the English page (translation parity) | doc-rewrite |
| `www/content/docs/guide/configuration.md` | 1/0/2/1/1/1/no | — | Rewrite the class configuration examples; 1 `trustedHtml`/`innerHTML` example moves to the exclusion note | doc-rewrite |
| `www/content/docs/guide/configuration.zh.md` | 1/0/2/1/1/1/no | — | Same rewrite as the English page | doc-rewrite |
| `www/content/docs/guide/core-concepts.md` | 1/1/3/0/0/1/yes | — | Rewrite the class examples; the 1 `computed` example follows D-M10 | doc-rewrite |
| `www/content/docs/guide/core-concepts.zh.md` | 1/1/3/0/0/1/yes | — | Same rewrite as the English page | doc-rewrite |
| `www/content/docs/guide/error-handling.md` | 1/0/3/0/0/1/no | — | Rewrite the class examples to the function lane; `www/tools/check-content-examples.test.ts` recompiles every example in the same batch | doc-rewrite |
| `www/content/docs/guide/error-handling.zh.md` | 1/0/3/0/0/1/no | — | Rewrite the class examples to the function lane; `www/tools/check-content-examples.test.ts` recompiles every example in the same batch | doc-rewrite |
| `www/content/docs/guide/getting-started.md` | 3/0/1/0/0/3/no | — | Rewrite the class examples to the function lane; `www/tools/check-content-examples.test.ts` recompiles every example in the same batch | doc-rewrite |
| `www/content/docs/guide/getting-started.zh.md` | 3/0/1/0/0/3/no | — | Rewrite the class examples to the function lane; `www/tools/check-content-examples.test.ts` recompiles every example in the same batch | doc-rewrite |
| `www/content/docs/guide/i18n.md` | 1/1/3/0/0/1/no | — | Rewrite the class examples; the 1 `computed` example follows D-M10 | doc-rewrite |
| `www/content/docs/guide/i18n.zh.md` | 1/1/3/0/0/1/no | — | Same rewrite as the English page | doc-rewrite |
| `www/content/docs/guide/islands-and-ssr.md` | 0/0/0/0/0/0/yes | — | Rewrite the class examples to the function lane; `www/tools/check-content-examples.test.ts` recompiles every example in the same batch | doc-rewrite |
| `www/content/docs/guide/islands-and-ssr.zh.md` | 0/0/0/0/0/0/yes | — | Rewrite the class examples to the function lane; `www/tools/check-content-examples.test.ts` recompiles every example in the same batch | doc-rewrite |
| `www/content/docs/guide/recipe-form-actions.md` | 1/2/4/0/0/1/no | — | Rewrite the class examples; the 2 `computed` examples follow D-M10 | doc-rewrite |
| `www/content/docs/guide/recipe-form-actions.zh.md` | 1/2/4/0/0/1/no | — | Same rewrite as the English page | doc-rewrite |
| `www/content/docs/guide/routing-and-data.md` | 1/0/4/0/0/1/no | — | Rewrite the class examples to the function lane; `www/tools/check-content-examples.test.ts` recompiles every example in the same batch | doc-rewrite |
| `www/content/docs/guide/routing-and-data.zh.md` | 1/0/4/0/0/1/no | — | Rewrite the class examples to the function lane; `www/tools/check-content-examples.test.ts` recompiles every example in the same batch | doc-rewrite |
| `www/content/docs/guide/streaming.md` | 1/0/2/0/0/1/no | — | Rewrite; the streamed-page carrier is D-M11 — the page must not promise a class-only channel | doc-rewrite |
| `www/content/docs/guide/streaming.zh.md` | 1/0/2/0/0/1/no | — | Same rewrite as the English page | doc-rewrite |
| `www/content/docs/guide/styling.md` | 1/0/0/0/0/1/no | — | Rewrite the class examples to the function lane; `www/tools/check-content-examples.test.ts` recompiles every example in the same batch | doc-rewrite |
| `www/content/docs/guide/styling.zh.md` | 1/0/0/0/0/1/no | — | Rewrite the class examples to the function lane; `www/tools/check-content-examples.test.ts` recompiles every example in the same batch | doc-rewrite |
| `www/content/docs/guide/tutorial.md` | 4/0/4/0/0/4/yes | — | Rewrite the class examples to the function lane; `www/tools/check-content-examples.test.ts` recompiles every example in the same batch | doc-rewrite |
| `www/content/docs/guide/tutorial.zh.md` | 4/0/4/0/0/4/yes | — | Rewrite the class examples to the function lane; `www/tools/check-content-examples.test.ts` recompiles every example in the same batch | doc-rewrite |

## 11. Per-file matrix — starter, tools, ui, www harnesses (23 files)

### 11.1 `packages/create/templates` — the shipped starter (6)

The starter is the *product surface* — a new app must not be born on a retired
lane. It ships in the same PR as the `16b-MN` rewrite (draft §7.1). The 2 island
templates keep their `defineIslandConfig` sidecar.

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `packages/create/templates/app/components/page-404.tsx.tmpl` | 1/0/0/0/0/1/no | — | Function page component (path-derived tag stays the route convention) | ready |
| `packages/create/templates/app/components/page-about.tsx.tmpl` | 1/0/0/0/0/1/no | — | Function page component (static showcase page) | ready |
| `packages/create/templates/app/components/page-home.tsx.tmpl` | 1/0/0/0/0/1/no | — | Function page component (static landing page) | ready |
| `packages/create/templates/app/islands/live-timer.tsx.tmpl` | 1/0/2/0/0/1/yes | — | Generated function island; `defineIslandConfig` sidecar retained | ready |
| `packages/create/templates/app/islands/my-counter.tsx.tmpl` | 1/0/1/0/0/1/yes | — | Generated function island; `defineIslandConfig` sidecar retained | ready |
| `packages/create/templates/app/layout.tsx.tmpl` | 1/0/0/0/0/1/no | D-M1 | Function layout under `CONVENTION_LAYOUT_TAG` | ready |

### 11.2 `packages/ui/tools` (5)

The UI package's own components are already function-lane; what remains here is
the manifest/CEM producer's **class branch**, which reads authored `@element`
class sources that retirement removes. `generated-element-facts.ts` already
projects emitted native classes into the internal manifest vocabulary, so the
class branch is deleted rather than replaced.

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `packages/ui/tools/generate-cem.ts` | 0/0/0/0/0/0/no | — | CEM keeps projecting from the internal manifest; the class-fact branch dies once the manifest reads `generated-element-facts.ts` only (plan D8 item) | ready |
| `packages/ui/tools/generate-ui-manifest.generated-element.test.ts` | 1/0/0/0/0/0/no | — | Drop the class fixtures; keep the function-lane manifest assertions | ready |
| `packages/ui/tools/generate-ui-manifest.test.ts` | 1/0/0/0/0/0/no | — | Drop the class fixtures; keep the function-lane manifest assertions | ready |
| `packages/ui/tools/generate-ui-manifest.ts` | 0/0/0/0/0/0/no | — | Delete the class branch; read `generated-element-facts.ts` only (the ui sources are already function-lane) | ready |
| `packages/ui/tools/generated-element-facts.ts` | 0/0/0/0/0/0/no | — | Already the function-lane manifest producer; the scan hit is a comment naming the class facts | ready |

### 11.3 `tools/**` — release and packed-consumer harnesses (8)

These compile and pack class-lane consumers. Their *proofs* (packed consumer,
node-serve, workers) are release capabilities and stay; their *sources* are
rewritten to the function lane in the retirement batch.

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `tools/lib/compiled-pack-staging.test.ts` | 1/0/1/0/0/1/no | — | Update the compiled-artifact staging assertions with the class-free pack pipeline | ready |
| `tools/release/consumer-packaged-element.ts` | 1/0/1/0/0/1/yes | — | Rewrite the packed-consumer source to the function lane; the consumer proof is unchanged | ready |
| `tools/release/consumer-packaged-native.ts` | 6/0/13/0/0/6/yes | — | Rewrite the 6 class consumers (13 props) to function components; the consumer proof is unchanged | ready |
| `tools/release/consumer-packaged-node-serve.ts` | 2/0/1/0/0/2/no | — | Rewrite to the function lane; the node-serve proof is unchanged | ready |
| `tools/release/consumer-packaged-ui-app.ts` | 2/0/0/0/0/2/no | — | Rewrite to the function lane; the UI-app proof is unchanged | ready |
| `tools/release/consumer-packaged-unocss.ts` | 4/0/0/0/0/4/yes | — | Rewrite to the function lane; the unocss proof is unchanged | ready |
| `tools/release/packed-agent-round.test.ts` | 0/0/0/0/0/0/no | — | Follows the packed-consumer rewrite | ready |
| `tools/release/packed-agent-round.ts` | 2/0/0/0/0/2/no | — | Follows the packed-consumer rewrite; the round proof is unchanged | ready |

### 11.4 `www/tools` remainder and `www/__tests__` (4)

`generate-site-content-data.ts` embeds the two hand-written page-code examples
(`PAGE_CODE_SOURCES`) that the site renders, and emits
`www/app/data/_generated-page-code.ts` — the generated artifact is not in the
scan set (its HTML escapes the token) but is regenerated by the same edit.
`check-content-examples.test.ts` is the content batch's gate.

| File | Shape | Decision | Target form | State |
| --- | --- | --- | --- | --- |
| `www/tools/generate-site-content-data.ts` | 1/0/1/0/0/1/no | — | Rewrite the two `PAGE_CODE_SOURCES` snippets to the function lane; regenerate `www/app/data/_generated-page-code.ts` (`generate:content`, part of `site:build`) | ready |
| `www/tools/check-content-examples.test.ts` | 3/0/3/0/1/3/yes | — | It compiles every doc example — the doc batch gate; update in the same batch as `www/content` | ready |
| `www/__tests__/site-ui.test.ts` | 1/0/0/0/0/0/no | — | Update with the §5.1 batch (class fixtures inline in the test) | ready |
| `www/__tests__/article-pages.test.ts` | 0/0/0/0/0/0/no | — | No class-lane construct; keep (the scan hit is a comment) | ready |

## 12. C07–C11 — the ABI read sites this PR retires

Each row is a `__partProgram` read the router performs at **runtime** that must
become a build-time fact. The evidence column names the existing test that must
stay green, and the new test that must prove the build-time replacement.

| Row | Site | Current read | Replacement | Positive + negative test | State |
| --- | --- | --- | --- | --- | --- |
| **C07** | `packages/router/src/authoring.ts` `isElementPageClass`, `page-classification.ts` | was `component.__partProgram !== undefined` | **already a build fact** (M11-1/M11-2): `PageModuleFacts` + `PageKindCarrier`, `classifyPageRoute`, `pageKindOf` | `page-classification.test.ts` (build-fact sweep); `function-page.test.ts` (class-syntax arm) | **RETIRED** (M11-3 delivered); this PR records it, adds the negative |
| **C08** | `packages/router/src/vite/internal/server-runtime/renderer-runtime.ts:146` `resolveCompiledPageTag` | `default.__partProgram.tag` | **build-time decorated tag.** The static-component scan already computes `defaultCompiledTag` from the `@element(...)` decorator (`module-analysis.ts:720`), and `declared-element-tags.ts` reads a generated lane's sidecar tag. The entry descriptor must resolve a `definePage(ImportedClass)` route's tag from that scan instead of at module-evaluation time | + `page-route-tag-resolution.test.ts` keeps the *behaviour* (decorated tag wins over path-derived); − a route importing a class whose decorated tag differs from the file name must still register under the decorated tag, with **no** runtime read | open |
| **C09** | `route-dispatch.ts:23` `assertCompiledStreamRoute` / `readPartProgram` | `{version, tag}` from the program | compare the build-time manifest against the **build-time** route facts (decorated tag + `COMPILED_MODULE_ABI_VERSION`), not a runtime module read | + the existing stream route tests (mismatch still throws `STREAM_DECLARATION_MISMATCH`); − a route whose declaration disagrees with the manifest still fails closed, with the read removed | open |
| **C10** | `stream-runtime.ts:553-576` `createStreamPageShell` | `Cls.__partProgram.{tag,version}` vs manifest | the same build-time facts; the runtime guard keeps its *shape* (fail closed on skew) but reads the emitted identity static rather than the Part Program | + `server-runtime-stream-runtime.test.ts`; − skew rejection preserved (`ROUTE_PROGRAM_MISMATCH`) | open |
| **C11** | `types.ts:40-50` `PageRouteModule` | `__partProgram?: {version, tag}` | drop the field from the module type; the route module type keeps `openElementPage` and the default export | + `typecheck`; − the type must no longer admit a `__partProgram` read (a compile error is the negative) | open |

**Coverage note.** Only two of C08–C11's files are in the 300-file scan set
(`renderer-runtime.ts` and `authoring.ts`) because the others read the program
without spelling `@element(` or `extends OpenElement`. The scan set is the
class-lane *authoring consumer* set, not every ABI read site: C09/C10/C11's
`route-dispatch.ts`, `stream-runtime.ts` and `types.ts` are tracked here, not in
§7–§11. This is why §12 exists as a second list rather than being folded into the
per-file tables.

**Sequencing (m01 matrix:193-204).** C07+C11 are a blocking pair in *sequencing*:
C11's type must drop `__partProgram` in the same change that removes C08–C10's
reads, or the type and the code disagree. **C09+C10** read the same two fields and
move together.

**The one thing that must NOT be deleted with them:** `COMPILED_MODULE_ABI_VERSION`
and the compatible-shape validation. §12 approves "retire the old validator and
version **while keeping version compatibility checks**". The retention is the
build-identity check, not the serialized program.

## 13. Correction to `alpha16-remaining-consumers.md`

That document was measured **2026-11-18 at `@87d83d095`**. Re-measured at the §2
SHA, three of its statements no longer describe the tree:

| Its claim | Re-measured at `cd7e9e065` | Disposition |
| --- | --- | --- |
| "saas — No class islands remain" | true for islands; **13 saas class modules remain** (§6) | a later reading, not a rewrite: this document carries the correction |
| "www/app/site-ui — 4 modules remaining" | same 4 hand-written modules remain, with **different measured counts**: `open-reading-shell` 21 computed (matches), `open-article-view` 6 computed + 1 trustedHtml (matches), `layout.tsx` 30 computed / 38 props (not in that doc's scope), `open-standards-visual` 1 computed (matches) | counts still hold; the doc did not measure `layout.tsx` |
| "www/app/components/article-routes — 40 generated modules" | **27** at this SHA | per-SHA value; the generator is still the one writer |

The 2026-11-18 document stays as written (amend-never-rewrite); this section is
the later reading, and a future reader reconciles them here rather than by
editing that file.

## 14. Execution order — batches, gates, evidence

The order is chosen so that rows with no open decision move first, decision-gated
rows move when their decision lands, and the deletion batch carries the files
that only make sense next to it (fixtures, docs, starter). Each batch names the
gate that must be green and the record its PR must carry; §13.6 of the plan
applies to every claim (commit, worktree, command, result).

| Batch | Rows | What moves | Gate | Required record |
| --- | --- | --- | --- | --- |
| **B0** | this document | matrix tracked and reviewed; no code | `markdownlint-cli2 docs/architecture/alpha16-class-migration-matrix.md` → 0 issues; for THIS change `git status --porcelain` lists only the matrix (other lanes share the worktree until the Lead stages the batch) | Lead review; owner sign-off is §13.5, **not** this batch |
| **B1 — clean rows** | 15 (`open-section-frame`, `open-standards-visual`, 12 saas pages, saas layout) | migrate the rows whose state is `ready` and whose decision is `—` | `pnpm run typecheck`; `pnpm run saas:verify`; `pnpm test` (saas + www projects); `pnpm run site:build` | one `16b-MN` row per migrated group; the page's head/status/props parity named per row |
| **B2 — D-M10 unblocks** | 2 (`layout.tsx` 30 computed, `open-reading-shell` 21 computed) | migrate the two computed-bearing clean modules once ADR-0183's implementation lands (D-5 then D-4) | ADR-0183's evidence plan (dependent recompute, `Object.is` non-propagation, disposed release, SSR once-eval, mount→claim→update→reconnect consumer form) + `pnpm test` element/compiler/www + `pnpm run site:build` | ADR-0183's D-4/D-5 slices green; byte attribution pinned; the 21/30 behaviour equivalence per row |
| **B3 — D-M5 unblocks** | 30 (`open-article-view`, the generator, its test, 27 bindings) | structured article body + one generator template edit + one regeneration | `pnpm --filter @openelement/www run check:article-routes`; `pnpm run generate:all` then `git diff --exit-code`; `pnpm test` (www); `pnpm run site:verify` | D-M5's ADR amendment; the security negative (no raw-markup channel) |
| **B4 — retirement** | 247 = 178 `ready` (78 fixtures + 23 starter/tools/ui/www harnesses + 62 rebased package tests + 13 surviving package sources + 2 site islands) + 42 `doc-rewrite` + 25 `retire-with-code` + 2 `pinned-negative` kept | one approved change: delete the class frontend, the decorator grammar, the Part Program v2 emitter/validator/serializer, the class runtime path and C07–C11's runtime reads; migrate the fixtures/docs/starter/tools in the same change; keep `counter.tsx` and the `trustedHtml` test as the pinned negatives | `pnpm run verify`; `pnpm run check`; `pnpm run test:e2e`; `pnpm run site:verify`; `pnpm run release:check` (includes the fixture gates) | §13.5 inventory + owner sign-off (the matrix itself claims neither); P1 graph re-record; the fail-closed negative test |
| **B5 — D-M11** | 6 blocked rows | owner rules on streamed pages first | — | owner decision record; then either the batch that deletes `renderIntent.stream` with its tests, or a carrier design that joins B2/B3 |

The batches partition the 300 rows: **15 + 2 + 30 + 247 + 6 = 300**. B0 adds
none (it is this document), and B5's six rows move only after the owner rules.

Why this order:

1. The clean rows (§5.1's two, §6's thirteen) touch no decision and no
   serialized shape, so they prove the target form on the cheapest surface first.
2. `layout.tsx` and `open-reading-shell` are the two rows that *need* D-M10; they
   move together so one behaviour-equivalence record covers both computed families.
3. The generator is one writer: doing it once, after D-M5, avoids 27 hand edits
   and keeps `--check` byte equality meaningful.
4. The deletion batch is last and is one unit: fixtures, docs, starter and tools
   must stop being class-authored in the same change that stops compiling class
   sources, or the tree does not build. The matrix cannot move them earlier
   without leaving a period in which the lane is half-retired.
5. D-M11 is a gate on the deletion, not a later nicety: three fixture pages and
   three tests pin a channel that has no function-lane form.

## 15. What this matrix does not claim

- It is **not** a P5 sign-off and creates no §13.5 evidence. The owner sign-off
  and the tracked capability inventory are separate objects (§15.1).
- It claims **no** migration is complete. Every row's state is `ready`,
  `blocked (D-Mx)`, `retire-with-code`, `pinned-negative`, or `doc-rewrite`;
  none is "migrated". A row moves to migrated only when its PR names a command
  and a result.
- It decides the **disposition** of every scanned file, not every row's final
  code. `ready` means "no design decision outstanding", not "done".
- It does not decide D-M5's design, D-M6/D-M7/D-M8's implementations, D-M10's
  ADR, or D-M11's answer. Those are named as owed (§4, §4.1).
- It does not claim `renderIntent.stream` can be retired: D-M11 is a measured
  contradiction between "retire the class lane" and "streamed pages only exist
  as class pages", and it is flagged for the owner rather than papered over.
- It does not re-measure any other document; §13 corrects one document, and a
  different SHA needs its own scan (§2.1).
- The counts are regex counts (§2.3), including one known over-count family
  (prefix `classes`, rows marked `†`); they size the work and do not prove a
  resolved shape.

## 16. Appendix — the scan script and the coverage assertions

### 16.1 The scan script

`/tmp/scan-class.mjs`, quoted so the record does not depend on a temp file. Run
from the worktree root.

```js
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execSync("git grep -l -E 'extends OpenElement|@element\\(' -- www apps packages tests tools docs | sort", {maxBuffer:1e9})
  .toString().trim().split('\n').filter(Boolean);
const rows = [];
for (const f of files) {
  let src = '';
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  const computed = (src.match(/=\s*computed\(/g) || []).length;
  const props = (src.match(/^\s+@property/gm) || []).length;
  const trusted = (src.match(/trustedHtml\(/g) || []).length;
  const innerHTML = (src.match(/innerHTML=/g) || []).length;
  const decorators = (src.match(/^\s*@element\(/gm) || []).length;
  const sidecar = /export const openElement\s*=/.test(src);
  const cls = (src.match(/class\s+([A-Za-z0-9_]+)\s+extends\s+OpenElement/g) || []).map(m=>m);
  rows.push({f, cls: cls.length, computed, props, trusted, innerHTML, decorators, sidecar});
}
rows.sort((a,b)=>a.f.localeCompare(b.f));
console.log('file\tclasses\tcomputed\tprops\ttrusted\tinnerHTML\t@element\tsidecar');
for (const r of rows) console.log([r.f,r.cls,r.computed,r.props,r.trusted,r.innerHTML,r.decorators,r.sidecar?'yes':'no'].join('\t'));
console.error('TOTAL FILES: '+rows.length);
```

### 16.2 The coverage assertions

The row generator that produced §5–§11 reads the export and asserts, before
writing a line:

1. the export holds exactly **300** data rows;
2. every scanned path appears in **exactly one** table row (no omission, no
   duplicate);
3. every row's `State` that is `blocked (D-Mx)` carries `D-Mx` in its `Decision`
   cell;
4. the emitted row count equals the export's row count (**300**).

The tallies it prints:

| State | Rows |
| --- | --- |
| `ready` | 193 |
| `doc-rewrite` | 42 |
| `blocked (D-M5)` | 30 |
| `retire-with-code` | 25 |
| `blocked (D-M11)` | 6 |
| `blocked (D-M10)` | 2 |
| `pinned-negative` | 2 |
| **Total** | **300** |

| Decision reference | Rows |
| --- | --- |
| no design decision (`—`) | 258 |
| D-M5 | 29 |
| D-M11 | 6 |
| D-M1 | 2 |
| D-M5 + D-M10 | 1 |
| D-M1 + D-M10 | 1 |
| D-M10 + D-M4 | 1 |
| D-M10 (non-blocking) | 1 |
| D-M9 | 1 |
| **Total** | **300** |

### 16.3 The document check

```text
$ ./node_modules/.bin/markdownlint-cli2 docs/architecture/alpha16-class-migration-matrix.md
markdownlint-cli2 v0.23.2 (markdownlint v0.41.1)
Finding: docs/architecture/alpha16-class-migration-matrix.md
Linting: 1 file
Summary: 0 issues in 0 files
```

Result: **0 issues**.

The repo's machine-path gate must also stay green for a tracked `docs/` file:

```text
$ node www/tools/check-no-machine-paths.ts --source docs
machine-path check passed (128 text files scanned in 1 source path(s), 0 binary skipped).
```

This is why §2 names the scan export as `$SCAN` rather than the recorded run's
absolute path: `/private/tmp` is one of the gate's forbidden markers. The
document is tracked by the PR that carries this revision; it creates no gate,
exit or release claim on its own.

### Progress log (append-only)

**2026-11-20 — 10 saas pages migrated in one batch** (`b38c1147b` and the
follow-up commit): `page-recover`, `page-signup`, `page-magic-link`,
`page-reset-password`, `page-workspace-records`, `page-checkout`, `page-upload`,
`page-admin`, `page-auth-callback` moved into their route modules as the
function-page/local generated shape (§19.9 + §19.4), and their class modules are
deleted. Evidence: `@openelement/saas` build exit 0 with 12 pages / 11
request-time routes / 9 action routes, and 20 files / 150 tests green.

Two facts this batch established, both worth carrying into the remaining rows:

1. **The sidecar's root vocabulary is `light` | `shadow`**, not the class lane's
   `shadow-open`. `defineIslandConfig({ root: 'shadow-open' })` fails closed with
   `OE_ISLAND_DESCRIPTOR_SHAPE` at build time; the migrated rows therefore spell
   `root: 'shadow'` and keep the class's DSD default.
2. **A page class carries no island config of its own** (no `defineIslandConfig`
   in any `page-*.tsx`): the tag came from the class decorator. The migrated row
   must therefore add the sidecar `tag`/`root`/`properties` block, and only then
   does the module enter the generated lane.

Still class-lane in `apps/saas`: `page-notes` (needs the D-M5-style decision for
its form rows) and `app/layout.tsx` (D-M1 tag source). Both are tracked rows.

**2026-11-20 (same batch) — two rows measured and deliberately NOT migrated, and
one probe result worth keeping.**

1. **`packages/create/templates` keep the class lane for this slice.** Migrating
   `page-home.tsx.tmpl` was attempted and reverted: the template's page sheet
   rides `static styles`, and the generated lane's sidecar `styles` channel is
   explicitly refused on a LIGHT root until the Alpha17 document-level
   application slice (#1800, `packages/router/src/authoring.ts:796-806`). A
   rewrite that drops the sheet would ship an unstyled starter — a behaviour
   change, not a migration. The starter moves when #1800 lands or when the
   light-root document-sheet delivery is wired to the generated render path.
2. **`www/app/components/article-routes/*` (27 generated modules) stay
   generator-owned and class-lane in this slice.** The generator is the single
   writer (`renderComponent`), so the migration is one template change plus a
   regeneration — but the binding it emits carries `model: ArticlePageModel` and
   a `locale` field, i.e. exactly the `attribute: false` non-primitive rows whose
   server→client crossing is the D-M5/D-18c decision that is still open.
   Editing the template before that decision would ship a binding whose model
   never reaches the client.
3. **Probe result (kept because it un-blocks the next row):** a SHADOW-root
   function component with named slots (`<slot name="meta">`), a default slot and
   a props-derived `computed` compiles through `compileGeneratedElementIfAdmitted`
   (9660 bytes emitted, no diagnostic). So `open-reading-shell` (21 computed,
   shadow root, 4 slots) is mechanically admissible now; what it still needs is
   the D-M4 caller-order row (`blog`/`changelog`/`contributing`/`errors` render it
   from FUNCTION pages already, so the caller side is satisfied) — the remaining
   work is the mechanical 31-row port, not a capability.

**2026-11-20 — the `open-reading-shell` port found (and fixed) a lane defect.**

Porting the shell surfaced a genuine compiler gap, not a migration problem: the
generated-element lane classified only its own factory specifiers, so any other
module import stayed `unknown`, and a TRACKED slot (a `computed` body) reading
one was refused with `OEC9043 [OEIR_UNCLASSIFIED_BINDING]`. The shell's 21
derived nodes all read `readingChromeStrings`/`formatFreshnessDate` from
`./chrome-strings.ts`, so the whole row was unmigratable through no fault of its
own.

Fixed in `generated-element/contract.ts`: `classifyValue` now answers `plain`
for a non-factory named import (an ordinary module value carries no reactive
source, so nothing can go stale by reading it in a derived body), while the two
factory specifiers keep their factory classification and their result stays a
signal. Guard: `generated-element.local-import.test.ts` (both halves).

The shell port itself is **not** in this batch: it was reverted to keep the tree
green while the classifier fix landed. Re-running it needs one more thing this
batch did NOT establish — whether a setup-scope snapshot of a module import
(`const chrome = readingChromeStrings(props.locale)`) is admitted after the
classifier change, since a direct `props.locale` read inside each derived node is
the pre-classifier shape. That is the next measurable step, not a design gap.

**2026-11-20 — both blockers of the `open-reading-shell` port are now closed.**

The previous entry named one open question (is a setup-scope snapshot of a module
import admitted?) and this round answered it, twice:

- the resolver answered `unknown` for a snapshot call whose callee was
  module-bound but not a host factory — fixed: when the host classifies that
  callee as an ordinary value, the call's result is an ordinary value
  (`scope-resolution.ts`, `classifyInitializer`);
- the retained factory emitted all `signal`/`computed` resources before all setup
  locals, so the probe emitted the derived node ABOVE the local it captured (a
  TDZ no diagnostic catches) — fixed: both lists merge on the lane's authored
  line/column and emit in ONE order (`generate-leaf/generate.ts`).

Pinned by `generated-element.declaration-order.test.ts`. The shell port is
therefore mechanically unblocked; it is not in this batch, and the next one runs
it with these fixes in place.

**2026-11-20 — the shell port hit a THIRD blocker and was reverted again.**

With both earlier defects fixed, the port compiled and the descriptor rows came
out right (`rail`/`footer`/`meta` as `boolean` + `reflect: true` + `default:
false`), but `site:build` failed at SSG on the only dynamic route:

```
[openElement] renderRoute failed for /blog/:slug: CompiledProgramValidationError:
[compiled-program] hostAttributes: OEIR_LEAF_UNSEEDABLE_PROPERTY: rail is a
boolean whose false value cannot be expressed as an attribute while its declared
default renders as presence-true; the claim would re-read the default.
```

Reproduction: `vp run --no-cache --fail-if-no-match --filter @openelement/www build`
(or root `site:build`). The caller is `www/app/routes/blog/[slug].tsx:81`, which
writes the row as a BARE attribute (`<open-reading-shell meta rail footer …>`),
i.e. the wire value is presence-`true` while the row's declared default is
`false`.

What is established and what is not: the rule (`shell.ts:463-478`) compares
`convertToAttribute(seeded)` against `convertToAttribute(primitiveRowFallback)`
and fails closed when the seeded value has no presence form and diverges from the
default. A direct probe of the seeder with `{ rail: true }` and the pair
`['rail','']` returns `rail: true` and throws NOTHING, so the throwing path is
NOT the two-argument shape the probe exercises — the remaining difference is the
route's real argument shape (the emitted `<Name>__ssrHost` fold), which this round
did not isolate.

Decision: revert, keep the tree green (`site:build` exit 0, `www` 34/304), and
record the exact error + reproduction. Isolating the shape is the first task of
the next attempt — with the two compiler defects already fixed, the remaining work
is one argument-shape investigation, not a capability gap.

Also measured this round (kept): the rescan of the class-lane blocker itself is
unaffected — `open-reading-shell` still declares `rail`/`footer`/`meta` as bare
`reflect` booleans defaulting to `false`, so whichever lane it migrates to, the
presence-`true` wire must be admitted there.

**2026-11-20 — the third blocker is diagnosed and fixed (bare boolean attributes).**

The previous entry recorded the error and the reproduction but not the shape.
This round isolated it by probe, before touching code:

| supplied | result |
| --- | --- |
| `{ rail: '' }` (the real caller: `<open-reading-shell meta rail footer …>`) | **threw** `OEIR_LEAF_UNSEEDABLE_PROPERTY` |
| `{ rail: true }` | fine |
| attribute pair only (`['rail','']`) | fine |

So the defect was exactly the BARE-ATTRIBUTE JSX encoding, not the attribute
wire: the seeder's supplied-value path returned `''` verbatim, the row resolved
falsy while the projected canonical pair was presence-true, and the fold refused
the divergence. The class lane already spells this rule once
(`public-runtime.ts` `coerceServerProp`: an empty string on a boolean converter
means `true`); the generated lane's fold now applies the same rule. Guard: a row
in `generated-host-props-seeding.test.ts` pins all three encodings.

With the three defects now fixed (module-helper snapshot classification, authored
declaration order, bare-boolean seed), the `open-reading-shell` port has no known
blocker left. It is the first task of the next batch.

**2026-11-20 — `open-reading-shell` MIGRATED (21 derived nodes).**

The shell is off the class lane. Shape: function component + sidecar
(`tag: 'open-reading-shell'`, shadow root, 9 property rows including the two
`attribute: false` local mirrors), the 21 class `computed` fields became the
lane's `computed` intrinsic, and the shared chrome copy is resolved once in setup
scope and captured by them.

Two port-time findings, both real and both now understood:

1. **The SSR producer dropped a captured setup local.** The producer's local
   reachability walked only the JSX roots, so a local the derived nodes capture
   was declared in the retained factory but never in `__ssr` — a runtime
   `Cannot read properties of undefined (reading 'value')` at SSG. The closure is
   now seeded with the root's binding resources, so a local they read is
   reachable exactly like one the JSX reads.
2. **A derived node is a component-local const, not a prop.** Reads are
   `pageTitle.value`, not `props.pageTitle.value`. Getting this wrong is silent in
   the compiler and only surfaces as a broken build (`undefined.value`), so the
   mechanical port was corrected against the emitted factory rather than by eye.

Evidence: `site:build` exit 0 (6 steps) — the built pages carry the real pager
(`data-pager="true"` with `/blog/alpha16-18-a-clearer-direction.zh/` links) and
the named slots; `www` 34 files / 304 tests; `vp run check` 5/5 PASS.

**2026-11-20 — `app/layout.tsx` ported, measured, and REVERTED: a real capability gap.**

The layout was fully ported (30 `computed` → the lane's intrinsic, 7 property
rows, `CONVENTION_LAYOUT_TAG` kept as the tag source per D-M1) and it compiled
(337,775-byte module). `site:build` then failed a consumer assertion that the
compiler cannot see:

```
v0.27.0 regression: the layout shell is present and expanded
  Error: Expected >= 1 DSD template in docs page, got 0
```

Measured: with the class layout the `/docs` page carries one
`shadowrootmode="open"` subtree; with the generated layout it carries ZERO, while
the host tag itself still renders (`<app-layout current-path="/docs" …>` with the
JSON seed). `open-theme-toggle` / `open-search` are still emitted as tags, but
their shadow roots are no longer expanded server-side.

So this is **not** a migration problem and not a layout-specific bug: a generated
LIGHT-root host serializes its own content and does not run the nested composition
pass over the hosts inside it, so every materialized child island loses its DSD.
The layout is the site shell — it wraps every page — which makes it the widest
possible instance of that gap. Reverted: `site:build` exit 0, `www` 34/304.

What the next attempt needs (a capability slice, not an edit):

1. light-root generated host → nested generated/class host expansion in the
   serializer (the same `renderToStringAtDepth` walk the class path runs);
2. evidence: `/docs` regains its DSD subtree count, and `open-search` /
   `open-theme-toggle` keep their shadow roots;
3. then re-run this same port unchanged — the port itself is proven to compile.

The port is preserved as a patch for that slice to start from.

**2026-11-20 — nested light-root expansion, scoped to exact seam points.**

The layout gap (previous entry) and the `apps/saas/app/layout.tsx` port both hit
the same missing capability, and the reading is now complete enough to name the
sites instead of hunting them.

**Measurements**

| fact | value |
| --- | --- |
| `renderNestedElement` occurrences in the generated-leaf generator | **0** |
| the class lane's nested seam | `serializer/serialize-program.ts:389` (`if (node.tag.includes('-') && seams.renderNestedElement)`) |
| how a light-root generated host's content is finalized | `generated-element/shell.ts:647` — `lightSsrProducer` calls the emitted `__ssr(props, undefined)` and returns `{ content, hostAttributes, seedRows }` |
| how a nested host reaches the pair table | `public-runtime.ts:1201` `registeredGeneratedHostRenderer(nested.tag)` (nested) / `:1039` (root) |
| class-lane nested props | `public-runtime.ts:1255-1280`: the parent's `nested.properties` + boolean presence coercion |

**Diagnosis (one sentence).** A generated light-root host's `__ssr` is a STRING
BUILDER that never consults the render's nested-expansion seam, so every host
inside its markup stays an unexpanded tag; the class lane expands because its
serializer walks `renderNestedElement` for every `*-*` tag.

**The slice, in seam order** (each item is a distinct site, not a redesign):

1. **carry the seam into the producer call.** `lightSsrProducer`
   (`shell.ts:598-651`) calls `__ssr(props, undefined)`; it must call
   `__ssr(props, host)` with a host object exposing the render's nested
   expander, the same shape `public-runtime.ts:1039/1201` already builds. The
   host record is currently passed as literal `undefined` — that is the whole
   server-side reason no expansion can happen.
2. **emit one call per dash-tag element.** In `emitDynamicSsrNodes`'s
   `element` branch (`generate.ts:7327-7425`), a tag matching
   `/[a-z][a-z0-9]*-/` currently pushes literal `"<tag"`/`">"`/`"</tag>"`
   strings. It must instead route through the host's expander and fall back to
   the literal bytes when the expander answers `undefined` (exactly the class
   lane's own `rendered !== undefined ? rendered : open+content+close` fallback).
3. **keep the fallback byte-identical.** A tag that is not admitted, or a module
   rendered with no host, must produce today's bytes — this is the property that
   makes the slice safe to land: the expansion is additive, and a regression in
   admission shows up as "no DSD", never as wrong markup.
4. **close the static path too.** `staticSsrNode` (`generate.ts:6696`) returns
   `null` for any node it cannot render statically, which is what makes a
   component with a nested host fall to the dynamic producer — that part is
   already correct and needs no change.

**Acceptance for the slice**

- `open-theme-toggle` / `open-search` inside a generated light-root host regain
  `shadowrootmode` (the `/docs` DSD count returns to 1 with the ported layout);
- the `apps/saas` layout builds and renders its slot;
- `v0.27.0-regression` and `build-output` suites stay green;
- byte-identity: every existing generated-light-host page's output is unchanged
  (they contain no admitted dash-tag children, so the fallback path is the one
  taken).

Not started this round: it is a serializer-shape slice (compiler emitter + shell
seam + admission plumbing), and starting it half-way would leave a producer that
emits expander calls nothing answers. Recorded here so the next attempt opens on
seam 1 instead of re-deriving the map.

**2026-11-20 — `useHost` DELIVERED (the objective's `16b-REF` item).**

`useHost` was the one capability in the objective's list that was genuinely
absent (a grep for `useHost` in `packages/` returned nothing). It is now
implemented end to end:

| layer | change |
| --- | --- |
| element | `useHost()` stand-in in `compile-lifecycle.ts`, re-exported from the root entry and the `./lifecycle` subpath |
| frontend | recognized by BINDING PROVENANCE (named import from either canonical specifier); refusals: arguments, type arguments, a `let`/`var` binding |
| generator | ONE host-record field read (`__oe_host.__oe_hostElement`) in the retained setup — no channel, no allocation, no lifetime, no reactivity |
| forwarding | the module-wide `moduleUsesHostAccess` gate forwards `__oe_hostElement` exactly like the env-form lifecycle gate, so a depth-1 retained child can read it too |
| public delta | `useHost=value:{call:()=>HTMLElement}` on `.` and `./base`, plus the derived shape hash; no other symbol moved |

**Server side is fail-closed, and that is the recorded contract:** the server has
no bindings channel and no element (ADR-0181), so a component whose rendered
output depends on the host element fails loudly with
`OEIR_LEAF_MISSING_VALUE: host` rather than emitting an empty slot.

Guards: `generated-element.use-host.test.ts` (six rows — the lowering, the
forwarding gate, byte-identity for a module that never calls it, the three
refusals, a foreign same-named function staying a plain local, and the
server-side fail-closed row). ADR-0182 carries the required dated amendment
("`useHost` is IMPLEMENTED in Alpha16b", superseding the FUTURE/OWED text without
rewriting it) with the P5 retirement condition.

Verification: compiler 100 files / 1400 tests; element 133 / 1044; interface
snapshot matches (6 packages); `vp run check` 5/5 PASS.

**2026-11-20 — a generated LAYOUT can be registered: the layout-pair slice.**

Porting `apps/saas/app/layout.tsx` surfaced a gap that is not about nesting at
all: a convention layout had NO way to be a generated element. Layouts are
registered class-only (`__registerSsrComponent`), and a generated element carries
no Part Program, so every render of the layout failed `PROGRAM_MISSING` — i.e.
every page of the site. The measured failure was
`<app-layout> (GeneratedElementShell) has no compiled Part Program`.

The slice (four seams, one fact):

1. **the declared-tag scan carries the compiler's host export.**
   `scanDeclaredElementTags` already reads every candidate module's source and
   its sidecar tag; it now also resolves `resolveGeneratedElementHost` on that
   same source and returns `hostExports` (moduleId → `<Name>__ssrHost`). The name
   is the compiler's return value, never a convention (ADR-0182 forbids
   re-deriving it). A LIGHT root emits no host producer and so has no entry —
   absence is the law, not an error.
2. **the build context carries the map** (`declaredElementHostExports`), next to
   the tag map it belongs with.
3. **the descriptor attaches it to the layout plan** — `buildLayoutPlan` matches
   by the module's DECLARED TAG (never a path guess) and sets
   `LayoutDecl.generatedHostExport`. One optional protocol field; the regenerated
   public-interface snapshot's only delta is that field plus two derived hashes.
4. **the entry registers the PAIR** — a generated layout gets a static named
   import of its host export and `__registerSsrIsland(tag, default, hostExport)`;
   a class layout keeps `__registerSsrComponent` byte-identically.

One more fact the slice had to settle: a generated SHADOW-root layout distributes
the page through the PLATFORM (`<slot>` inside the DSD template plus light DOM
after it), while the class lane substituted the page INTO the template's slot. So
the layout runtime passes host children (branded) for a generated layout and the
projections map for a class/light one. Getting that wrong drops the page
silently: the first attempt rendered an empty `<app-layout>`.

Evidence: saas build exit 0 with the layout DSD AND the page projected;
`entry-descriptor-layout-generated-host.test.ts` (four rows: carrier, pair
registration, class byte-identity, light-root absence); router 167 files / 1880
tests; saas 20 / 150; `vp run check` 5/5.

**2026-11-20 — nested expansion lands; `www/app/layout.tsx` MIGRATED (the site shell).**

The slice the previous entry scoped is implemented, in the seam order it recorded.

1. **the seam reaches the producer.** `lightSsrProducer` takes a third argument —
   the render's nested-host expander — and forwards it on the host record the
   emitted `__ssr` already receives. Until now that record was a literal
   `undefined`, which is the whole server-side reason no expansion could happen.
2. **one call per dash tag.** In the emitter's dynamic element branch a dash tag's
   bytes are built into two buffers (open tag + attributes; children) and pushed
   through `nestedHost(host, { tag, attributes, open, children, fallback })`. The
   attribute pairs are recorded as they are serialized, so the expander's props
   and the serialized bytes are the SAME evaluation — no second getter read.
3. **the static path declines dash tags**, which is what makes a fully static
   nested host expand at all: the M08-1a producer is a compile-time string with no
   call site, so a static `<open-theme-toggle></open-theme-toggle>` would have
   stayed inert. Returning `null` there routes the component to the dynamic
   producer, whose fallback emits the identical bytes.
4. **the fallback is byte-identical.** `nestedHost` returns the caller's literal
   bytes for: no host record, a non-object host, a non-function expander, a
   declining expander, and a non-string answer. An admission regression can
   therefore only ever show up as "no DSD", never as wrong markup.

The expander itself lives in `public-runtime.ts` and reuses the **existing** nested
dispatch the class lane uses — registry pair → light-root class static → compiled
class — so a nested host expands identically from either parent lane. Its
admission set is the render's own `ssrRenderableTags`.

`www/app/layout.tsx` (448 lines, 30 `computed`) is now a function component: the
30 derivations are the lane's intrinsic, the shared chrome copy is resolved once
in setup scope and captured, and the two chrome micro-islands inside its markup are
dash tags that expand through the new channel.

Evidence: `site:build` exit 0 (6 steps); the built `index.html` carries **3** DSD
subtrees and `open-theme-toggle` keeps its `<template shadowrootmode>` — the same
count the class-lane layout produced (the earlier empty-DSD failure is gone);
`www` 34 files / 304 tests, `element` 134 / 1049, `compiler` 101 / 1404, `router`
167 / 1880; `vp run check` 5/5 PASS. New guards:
`generated-leaf.nested-host.test.ts` (4 rows — routing, the static-dash case,
intrinsic byte-identity, conditional import) and
`nested-host-expansion.test.ts` (5 rows — the full fallback matrix).
