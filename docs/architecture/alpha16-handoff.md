---
status: active
topic: Alpha16 handoff — where the retirement line stands and what to do next
summary: Self-contained handoff for a fresh session taking over the OpenElement Alpha16 closeout. Branch state, what is verified done, what is open with the exact blocker of each, and the next three-step task with its three verified premises. Read §5 before planning anything else.
---

# Alpha16 handoff

> **2026-11-20 status update (read before §1).** §5's task — the `ssr: false`
> client style gap — **landed at `b12d0403`** in the session that took over this
> handoff, and the starter's `live-timer` is migrated and proven in a real
> browser. Two measured negatives are recorded, not claimed: the packed
> starter's pre-hydration replay rows are RED (the class facade is the only
> replay caller; Alpha17 owns the neutral leaf), and the starter layout had to
> become a LIGHT root because a shadow app-local tag has no `styleLinks` /
> utility-sheet carrier. The final-state document is
> [`alpha16-closeout-report.md`](./alpha16-closeout-report.md); this handoff is
> kept as the design record for §5/§6 and as the historical snapshot of §1–§5.
> §5's three steps and its failure closure are implemented as written (with one
> measured addition: `hydrate: 'only'` is the other client-only spelling, and the
> scan's `missing-producer` admission is now client-only-aware). The prerequisite
> lifecycle silent-drop fix is recorded in the migration matrix and `16b-MN`.
> §6's nesting disposition is now a WRITTEN RULE (ADR-0181, 2026-11-20) and §7's
> lane deletion is re-evaluated there and in the matrix: no capability blocker
> remains, but the public-API/ABI/benchmark decisions are owner/release items.

Written at the end of a long session on `feat/alpha16-retirement` so a fresh
session can continue **without re-deriving anything**. Everything below is either
measured or explicitly marked as not measured.

## 1. Where you are

| field | value |
| --- | --- |
| worktree | `<repo>/.agents/worktrees/alpha16-retirement` |
| branch | `feat/alpha16-retirement` (55 commits off the base) |
| HEAD | `935047caf` (`fix(router): register the island style declarations in the SSR build too`) |
| pushed | yes — `fork/feat/alpha16-retirement` |
| `git status --porcelain` | empty |
| source version | **`1.0.0-alpha.16`** (already bumped; do not re-bump) |

Verify with: `git -C <worktree> log --oneline -1 && git -C <worktree> status --porcelain`
(both must match the table before you trust any number below).

## 2. What is VERIFIED done

Every claim here was measured this session; the guards named exist in the tree.

**The class lane left every product source root.** Authored `@element` /
`extends OpenElement` count is **0** across `www/app`, `apps/saas/app`,
`packages/ui/src`, `packages/create/templates`. Exact grep:
`grep -rn "^export default class .* extends OpenElement\|^class .* extends OpenElement\|^export class .* extends OpenElement" <roots> --include="*.ts" --include="*.tsx"`
→ no output; same with `^@element(`.

**Generated-lane capabilities delivered:** `computed` (ADR-0183 option B),
`useHost`, `ref`, lifecycle (`onConnect`/`onDispose`/`onPropertyChange`),
context (`provideContext`/`useContext`), nested-host DSD expansion,
LIGHT-root document style delivery (#1800), SHADOW-root DSD style-link carrier.

**`16b-EB` §19.2 conditions 1–4 all delivered** (`9e494db63`, `77b367233`,
`3801ec997`, `69e58b2b9`). Rows still say PARTIAL **by design**: a new identity
for the fallback bytes is out of scope and §19.2 condition 2 says "under the
unchanged claim and identity rules". Do not "fix" that PARTIAL.

**Re-adjudicated (plan §19.3):** CEM for generated elements = delivered for the
shipped package; form participation = delivered (`required → valueMissing` plus
the full `ElementInternals` seam; a shell-side type/email mirror is REJECTED as a
second validation model).

**Two shims retired** with their written conditions met: #24
`OE_ISLAND_STYLE_SHADOW_UNWIRED` (carrier landed; only `missing-producer` still
refuses) and #28 `registerOpenUi` (alpha.16 is the breaking alpha it named).

**Release engineering:** version line, CHANGELOG entry, refreshed
`docs/release/public-interface-snapshot.json` (the line's one public addition is
`RenderToStringOptions.onNestedFailure`).

**Closeout report:** `docs/architecture/alpha16-closeout-report.md`, numbers
re-taken at `5b3246cf3`; **re-take them again at whatever HEAD you finish on.**

Test baseline at `935047caf`:
element **1058** · compiler **1404** · router **1881** · www **304** ·
saas **150** · create **68** · ui **80**; `vp run check` **5/5**;
`site:build` **6/6**; `interface:snapshot` matches 6 packages.

## 3. Gates you must use (exact task names — several guesses are WRONG)

```bash
./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter <pkg> test
./node_modules/.bin/vp run --no-cache --fail-if-no-match check          # 5 steps
./node_modules/.bin/vp run --no-cache --fail-if-no-match site:build     # 6 steps; REQUIRED before www build-output suites
./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo interface:snapshot
./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo docs-index:write   # never hand-edit the index block
./node_modules/.bin/vp run --no-cache --fail-if-no-match --filter @openelement/tools-repo generate:all
```

`interface:snapshot:check` **does not exist**. `@openelement/protocol` has **no
`test` task** (no scripts). Generated trees must be format-clean on their own —
the generator emits formatter-shaped output, so `oxfmt` never rewrites it.

## 4. Evidence discipline (non-negotiable in this repo)

Every claim needs the four-part record from
[`evidence-baseline.md`](./evidence-baseline.md): **full 40-char commit, empty
`git status --porcelain`, the exact command, the exact result**, plus provenance
`LOCAL <worktree>` or `CI <run>/<job>`. **This line has no CI run**, so every green
number is LOCAL-only and must be labelled so. `M12`/`M13`/`M14` are Q-class
milestones whose evidence **must** be CI — a LOCAL record cannot stand in, so do
not claim them. The P5 sign-off needs the owner's own line; the §18.7 delegation
explicitly does not satisfy it.

## 5. THE NEXT TASK — the `ssr: false` client style gap

Read this before anything else; it is the one open capability with a fully
verified design and it blocks the last class-lane fixtures.

### Root cause (measured)

The generated lane replaced the class lane's `import sheet from './x.css'` +
`static styles = [sheet]` with a sidecar STRING LIST `styles: ['./x.css']`. That
list is a build-time declaration: the island scan turns it into an emitted asset
plus (for SSR) a DSD `<link>`, and it produces **no module-graph edge**. An
emitted island module therefore carries **no css import**, `styleLinks` is
server-only, and there is **no descriptor `styles` key**. Consequence: an
`ssr: false` shadow island gets NO style delivery at all — no DSD template
exists, and the client creates the root with nothing to adopt.

### Three verified premises (do not re-derive)

1. **The intercept's gate is already open.** A sidecar-declared island IS a
   registered style importer with a resolvable edge — `hasStyleImporter(island)`
   and `getStyleRequest(styleRequestModuleId(...))` both return truthy, because
   `registerDeclaredIslandStyleEdges()` registers `declaration.moduleId`. So a
   real `.css` import in the emitted module is intercepted and yields the
   fetch-adapter sheet object (with `STYLE_SHEET_URL` + `STYLE_SHEET_READY`).
2. **No duplicate asset.** `emitStyleAsset` dedups by content-hash filename
   (`emitted.get(fileName)`), so the same specifier emits ONE asset regardless of
   which path registered it.
3. **No double application.** `sheetDeliveredByLink()` already skips adoption
   when the target's own markup declares the same URL through a marked `<link>` —
   that is what keeps DSD islands byte-identical.

End-to-end probe (reverted): with the import present, the client chunk carried a
real `CSSStyleSheet` **and** the bundler-rewritten `assets/<hash>.css` URL, with
exactly **one** emitted asset.

### The three steps

1. **`packages/compiler/src/internal/compiler/semantic-ir/generated-element/site.ts`**
   — read `ssr: false` from the sidecar as a `clientOnly` fact and thread it into
   `IslandMetadataRead` + the admission object. Only the explicit literal
   `ssr: false` matters; `true` and absent are the same case.
2. **`.../generated-element/emit.ts`** — for a `clientOnly` island with declared
   `styles`, emit `import <sheetN> from '<specifier>';` per specifier and add a
   descriptor row `styles: [<sheetN>, ...]`. Add the new identifiers to the
   `collisionNames` list (the tail validates every module-scope name it writes).
3. **`packages/element/src/internal/compiled/generated-element/shell.ts`** —
   accept `styles` on `GeneratedElementDescriptor`, carry it on
   `NormalizedDescriptor`, and when `rootCreatedByShell` is true (or the root is
   light and `getRootNode()` can adopt) call `CompiledStyleScope.connect(root,
   styles)` from `packages/element/src/open-element-styles.ts`; dispose it with the
   rest of the element lifetime.

### Failure behaviour to preserve

If an island declares `styles` and is client-only but no sheet object arrives,
**fail closed at build time** (a silent unstyled render is what shim #24 existed
to prevent).

### Verify with

`live-timer` in `packages/create/templates` (`ssr: false`, shadow, one
`:host{display:inline-block}` rule). Migrate it, then prove the computed style in a
browser. Do NOT re-attempt `site-light-probe` until §6's gap is closed.

## 6. Two gaps that are NOT the same thing

| gap | meaningful? | other frameworks? | plan |
| --- | --- | --- | --- |
| **client-created shadow root gets no styles** (§5) | **yes — this is the standard web-component lifecycle** | yes (Lit does it for every component) | **fix** |
| **a light root nested inside a shadow TEMPLATE** | **no — contradictory composition** | **no** (Lit cannot either; document stylesheets never cross shadow boundaries) | **write a rule, do not build** |

For the second: the class lane "solved" it by hoisting the child's link into the
parent's DSD template; the generated lane does not, and that is defensible. Product
code has **0** instances. Rule to write down: *a light root must not be nested
inside another component's shadow template — use a `<slot>` (slotted content stays
in the light DOM) or make the child a shadow root.* Then `site-light-probe`'s e2e
row can be rewritten to test the rule, and the fixture can migrate.

## 7. What is deliberately NOT done, and why that is not laziness

1. **Class-lane deletion.** Needs ONE change set spanning the compiler entry, the
   Part Program artifact, the ABI record, the class render path in
   `public-runtime.ts`, **82** class-lane contract test files, **8** migratable
   fixtures, and `benchmarks/micro/oe-table.tsx` (its subject IS the class
   compiler). Splitting it removes the only thing pinning the behaviour being
   removed. Wait until §5 lands and the fixtures can migrate.
2. **`16b-LC` depth ≥ 2.** No design carrier — the retention model is ADR-0181's
   and it is explicitly not wired past depth 1. A refusal site exists in
   `generated-leaf/generate.ts`; do not widen it without an ADR change.
3. **M12/M13/M14 + P5.** Need CI dispatch and the owner's signature respectively.
   Not achievable from this branch.
4. **The benchmark fixture.** RETAINED deliberately: it measures the class
   compiler's cost, so migrating it would silently change what the benchmark
   reports. It retires with the lane, and the generated lane then needs its own
   baseline.

## 8. Traps this session already paid for

- **Two faces reading one fact** is the recurring defect class here. Found and
  fixed three times: the shadow-style refusal that contradicted the build,
  `useHost` recorded FUTURE/OWED while implemented, form participation recorded
  PARTIAL while closed. **When you touch a fact, grep for every record that states
  it** — ADRs, `alpha16-capability-inventory.md`, `16b-migration-note.md`,
  `shim-inventory.md`, `seams.md`, the closeout.
- **A runtime ABI that "looks internal" is still an ABI** when the emitted code is
  the caller: widening the producer's host record to `{nestedHost, reporter}`
  type-checked, passed its unit rows, and produced **0 DSD templates** on the docs
  page. Caught only by `site:build`.
- **request-time pages have no build-time render**, so "the build is green" is not
  evidence a page works. Every migrated page row needs a RENDER.
- **The generated-element function body is a single JSX return**; setup statements
  belong to the server-component lane. A ported component with a leading `const`
  fails with `OEC9032`.
- **Generated routes must be format-clean from the generator** — emit the
  formatter's shape (wrapped forms past `printWidth` 100) rather than running the
  formatter afterwards, or the next `fmt:check` rewrites the tree.
- **`?url` CSS imports are rejected** for style delivery: they build everywhere but
  emit a SECOND asset (measured 649 vs 650 bytes, identical rules).

## 9. Where the truth lives

| document | what it owns |
| --- | --- |
| `alpha16-closeout-report.md` | the deliverable: delivered / not delivered / Alpha17 boundary |
| `alpha16-class-migration-matrix.md` | the per-file record and this session's measured negatives |
| `alpha16-capability-inventory.md` | the authoritative capability rows |
| `16b-migration-note.md` | the 16b slice records |
| `shim-inventory.md` | every load-bearing workaround and its deletion condition |
| `seams.md` | single-owner seam contracts |
| `evidence-baseline.md` | the four-part record format |

Update **all** of them that a change touches; the docs index is generated
(`docs-index:write`) and a hand edit fails the pre-push hook.
