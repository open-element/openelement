---
status: active
topic: Alpha16b migration note (16b-MN)
summary: The tracked carrier for the row-for-row 16b-MN obligations. It records what must migrate and what remains open; it is not the P5 capability inventory and creates no release evidence.
---

# 16b-MN — Alpha16 migration note (tracked carrier)

Date: 2026-11-14. Baseline: `origin/main` =
`fa6e5232dd54520d100108b202a73a1d70341f11` (PR #1790, M09-2d).

## Status and scope

`alpha16-18-execution-plan.md` §13.2 names five Alpha16b obligation slices
(`16b-LC`, `16b-EB`, `16b-CTX`, `16b-REF`, `16b-MN`). Before this change all five
were labels inside the plan only: no in-tree file, ledger row, named owner or
gate. This document is the **tracked carrier of `16b-MN`** — the minimum
migration guide that §13.2:395 requires to ship with Alpha16. It introduces no
new slice and no new milestone (§14.4:525-527).

**This document is not the P5 capability inventory.** §13.5:445-451 requires a
tracked capability inventory, a final-SHA matrix, `16b-MN` and the owner
sign-off; "A draft does not satisfy P5 … until then, P5 is not claimable and
Alpha16 release qualification is not openable". The untracked working draft
`alpha16-migration-capabilities.md` is none of those. **No owner sign-off is
recorded here and no gate was run.** Every row below is OPEN. An amendment of
2026-11-15 records the CEM input fixture-first slice in the verification
appendix; no row flips to closed and no milestone or P5 claim changes. A second
2026-11-15 amendment records `16b-LC` as PARTIAL (root lifecycle delivered;
nested/hostless hooks and connection-scope helpers OWED) and the generated-island
style channel as PARTIAL (declaration and build pipeline delivered for light
roots; document application and shadow adoption carried by GH issue #1800 /
M09-2e); no row flips to closed and no sign-off is recorded.

## Row-for-row obligations (§14.1 condition 6, §14.2:504)

| Capability | Corrected record | Carried by | Current state | Evidence still owed |
| --- | --- | --- | --- | --- |
| `custom-elements.json` (CEM) generation for generated elements | retained obligation (was: §13.3 exception) | M09 platform surface; M10 P3/P5; M12 packed qualification | **OPEN — fixture-first bounded mechanism only.** D-② phase 1 lands the input path: `packages/ui/tools/generated-element-facts.ts` runs the real generated-element lane on a fixture module, reads the emitted constructor identity from the emitted module's own export table (never the author function name), and projects the lane's resolved descriptor rows, JSX slot/part names and authored JSDoc summary into the internal manifest; `packages/ui/tools/generate-ui-manifest.ts` gains an injectable fixture root plus host site-fact dispatch, and `packages/ui/tools/generate-cem.ts` gains an in-memory projection entry that validates the result against the official CEM 2.1.0 schema (attributes/slots/cssParts preserved; no fabricated superclass or events). The tracked `packages/ui/src/generated-manifest.json` and `packages/ui/custom-elements.json` stay byte-identical — the live `packages/ui/src` tag source is not wired, so no shipped build or packed artifact declares a generated element. `m09-2b-primitive-properties.md`:348-352 "No CEM output" remains true of the shipped class-lane build, and the phase-1 implementation is uncommitted at the `0b07e7ecb` baseline with no PR or gate record. | live-input (`packages/ui/src`) generated CEM structure test; packed `@openelement/ui` metadata read back by the CEM scanner; `gate:release` and `gate:packed` green at the same SHA; the fixture-first runs are LOCAL dev feedback at dirty baseline `0b07e7ecb`, not clean-SHA evidence. The alternative owner-approved migration of the packed CEM artifact contract is recorded in the M09 exit docket (D-2, PR #1793). |
| array/object/`trustedHtml` property conversion | retained obligation (was: §13.3 exception) | M09 property/attribute conversion; M10 P5 | **OPEN — bounded mechanism only.** #1789 `f69dde8bf` lands property-only channels; the slice document self-describes "bounded implemented — LOCAL review pending", no server→client seed, "not the M09 exit". Its Chromium vertical and Node contract pass at `237e14bd2` (see the Verification appendix); the consumer round-trip tests remain outstanding. | property round-trip tests for the in-tree consumers (`notes-live`, `open-article-view`, `open-reading-shell`); packed ui-app/site build; the TSX rows that carry those components. |
| form validity policy (`setValidity` rules) | retained obligation (was: §13.3 exception) | M09 forms; M10 P5; `16b-MN` | **OPEN — bounded mechanism only.** #1790 `fa6e5232d` lands `formAssociated`, value / required / disabled and `required → valueMissing`; the slice document declares an explicit "Host access gap" non-claim, "not full OpenInput migration parity", Chromium LOCAL only. Its Chromium vertical and Node contract pass at `237e14bd2` (see the Verification appendix). | the existing form e2e contract re-run on the generated CE; form value / reset / restore tests on the generated path. Full constraint mirroring (type/email, minlength, …) may stay a **deferred sub-obligation listed in this row**, never an exception (§14.2:510). |
| Two `/internal/*` artifact-resolution export subpaths | named deviation, no exemption | ADR-0137 §1 remains in force; ADR-0177 owns the written retirement condition | **OPEN — deviation registered 2026-11-14**; `packages/element/package.json`:16-17 unchanged. | `graph:check` zero importers outside `packages/element`; `esm:boundary-check` no external resolution; snapshot zero `publicSymbols`; `gate:release` + `gate:packed` green at one SHA. Byte attribution in the full reachable page closure also remains owed (ADR-0174:42-50, :12-13). |

Before the 2026-11-15 amendments, none of the five `16b-*` slices had an
implementation slice. `16b-LC` (lifecycle) is now **PARTIAL**: the
generated-element ROOT author lifecycle hooks are delivered, while nested/hostless
hooks and the connection-scope helper channel are OWED (see the amendment
below). `16b-EB` (error boundary), `16b-CTX` (context, TSX-13) and `16b-REF`
(refs) still have no implementation slice and must be delivered inside Alpha16b;
they may not be deferred to Alpha17 (§13.2:385-387). None of them is claimed
here.

## Two non-exception items, unchanged (§13.3:427-435)

- Client style declaration for generated islands remains a **deferred
  obligation**, not an exception (a replacement path exists); M11 re-verifies it
  on a real build. The 2026-11-15 amendment below records the channel as
  PARTIAL: declaration plus the existing build pipeline are delivered for
  light-root generated islands, while document application and shadow adoption
  are carried by GH issue #1800 / M09-2e.
- Utility and theme CSS is outside the capability list entirely (build-side, no
  authoring model dependency); M11 re-verifies it.

## 2026-11-15 amendment — 16b-LC and the generated-island style channel are PARTIAL (working tree)

Status: **working-tree amendment — uncommitted, not a status flip, not a
capability-inventory row, no sign-off, no gate.** Date: 2026-11-15
(Asia/Shanghai). Base: `feat/alpha16-integration` @ `6bd3667d4`, plus the
uncommitted `16b-LC` lifecycle and generated-island style lanes (the tree also
carries other lanes' edits). This amendment records two PARTIAL states; no row
above flips to closed and no milestone, P5 or release claim changes. It is not
clean-SHA evidence.

### 16b-LC — PARTIAL: root author lifecycle delivered, the rest OWED

The generated-element lane now admits author `onConnect` / `onDispose` as
compiler-erased intrinsics in the generated element ROOT setup only (binding
provenance: a named import of `@openelement/element`, aliases followed; direct
top-level statements). The lowered callbacks ride the retained
`__oe_rootInstance` record; `onConnect` replays on the per-connection scope in
the mount/claim prologue with its optional cleanup registered there, and
`onDispose` registers on the element-lifetime instance owner. The intrinsics are
erased from the emitted module and fail closed with the existing
`JSX_OUTSIDE_COMPILER` identity outside the compiler; the emitted SSR producer
runs no hook. The seam is registered in the
[M09-0 shell record](./m09-generated-element-shell.md) and in
[`seams.md`](./seams.md).

Owed, and the reason this is PARTIAL, not delivered:

- nested/hostless component hooks — they keep the unchanged `OEC9041` statement
  refusal — and any cross-component reconciliation;
- the connection-scope helper channel (callback parameters) — a hook callback
  with a parameter is refused today, so there is no connection-scope context
  and no setup-once author API;
- the timing semantics an author may expect from "connected": the replay runs
  in the mount/claim prologue before the connection's DOM exists, so this record
  claims no ADR-0173 DOM/refs-ready timing;
- signal reads inside a hook remain a host-binding read and are refused by the
  unchanged `UNBOUND_BINDING` gate.

### Generated-island style channel — PARTIAL: declaration and build pipeline delivered, application OWED

`IslandConfig.styles` is now declared and validated on a LIGHT-root
generated-element (function) island and carried through the build into the SAME
router style plan the class lane uses: one specifier rule shared by the runtime
authoring face and the static island scan, a build-time declaration carrier,
registration into the existing compiler style-edge registry, one
content-addressed `.css` asset and the client asset manifest `styles` record.
There is no second style pipeline, hash or emitter. The seam is registered in
[`seams.md`](./seams.md).

Owed, and the reason this is PARTIAL, not delivered:

- document-level application of the emitted sheet on a light root (the class
  lane's head `<link>` is not wired to the generated-element render path);
- shadow-root adoption: no DSD style-link carrier until M09-2e, so a shadow-root
  declaration is refused at build with the coded
  `OE_ISLAND_STYLE_SHADOW_UNWIRED` diagnostic instead of being silently lost;
- a non-generated/class-lane module declaring `styles` is refused with
  `OE_ISLAND_STYLE_LANE_UNSUPPORTED`; its sheets belong to `static styles`.

The adoption surface is carried by GH issue #1800 (Alpha17) and the shadow
carrier by M09-2e; M11 still re-verifies the deferred client style declaration
obligation on a real build. The two lanes' test files are untracked in this
working tree and their LOCAL results are dirty-tree development feedback, not
clean-SHA evidence.

### What this amendment does not do

- It flips no row to closed, records no capability-inventory row, no final-SHA
  matrix, no gate result, no clean-SHA evidence and no sign-off.
- It does not claim `16b-LC`, `16b-LC-2`, §4.1d, M09 exit, M13 or any Alpha16
  exit / P5 item.
- It does not rewrite the execution plan, the progress ledger, the semantic test
  matrix, the public-interface snapshot or any `packages/*` source/export map.

## Retirement-condition form (P5 / P6 / P8)

Every shim, drift guard and derived pointer must carry a condition of the form:

```
RETIRE <object> WHEN <existing gate reports a recomputable predicate on a standard artifact> ;
VERIFY <gate> WITH gate:release AND gate:packed GREEN AT <one SHA> ;
RECORD <16b-MN row / shim-inventory detail / seams guard / package.json "//"> ;
OWNER <single owner>
```

The condition is an event, never a date or "next review". Its source is a standard
artifact (module graph, type checker, Playwright report, packed tarball,
`public-interface-snapshot.json`) — see `shim-inventory.md`:366-370 and
`tools/repo/check-shims.ts`:416-421. The compliant precedents are
`ADR-0155`:175-205 and `ADR-0166`:134-148. Explicitly forbidden as conditions:
"Re-verify at each audit. No action." (`alpha16-18-progress.md`:442), a
procedural "needs its own PR" (`:440`), or a reference to a removed document
(execution-plan §2:111-116, §12a:351 — see §15.1 of the execution plan for the
later reading).

## Verification appendix (LOCAL, advisory — not exit evidence)

A read-only check of the two bounded M09-2d slices on the Gate A commit, recorded
in the five-field form of `docs/architecture/evidence-baseline.md` §Evidence
authority. It is **not** a milestone exit, a gate record, a browser qualification
(M13), a P5 evidence item or a release claim.

| Field | Record |
| --- | --- |
| commit | `237e14bd2a3330618882af5ef02bfdf698c65eca` |
| status | `git status --porcelain` empty (clean worktree) at that commit |
| command | `node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-element.nonprimitive-properties.browser.test.ts packages/compiler/__tests__/semantic-ir/generated-element.forms.browser.test.ts packages/compiler/__tests__/semantic-ir/generated-element.forms.test.ts packages/compiler/__tests__/semantic-ir/generated-element.nonprimitive-properties.test.ts` (Node v24.18.0) |
| result | 4 files / 53 tests passed — browser 9/9 (non-primitive), 10/10 (forms); Node 28/28 (non-primitive), 6/6 (forms); no failures, no skips |
| provenance | `LOCAL .artifacts/alpha16-restart-20261114/worktree`, chromium only; no CI run/job identity, no Firefox/WebKit, and the engine revision was not recorded — one reason this stays advisory |

This resolves one factual question carried into the discussion: the #1789
Chromium vertical **is green at the current tip**. It does not resolve the
"LOCAL review pending" notes in #1789 / #1790, the CEM retained
obligation, the in-tree consumer round-trip tests, the full reachable page
closure byte attribution (ADR-0174:12-13), or any M09 exit. §13.5 stays in
force: P5 is not claimable and Alpha16 release qualification is not openable.

### CEM input fixture-first (D-② phase 1) — LOCAL, advisory

A second five-field record, kept separate from the Gate A row above because it
was taken on the dirty 2026-11-15 working tree. It records the fixture-first
input slice only: a real function-component fixture root reaches the internal
manifest and a schema-valid CEM class in memory. It is not a §13.6 record, a
gate record, packed-artifact evidence or any M09 exit / M10 / P5 item.

| Field | Record |
| --- | --- |
| commit | `0b07e7ecbe7dd797b88c858c530a000448f7b984` (`main` HEAD at the run) |
| status | dirty — the slice's own files and other lanes' uncommitted work are present; not a clean worktree |
| command | `node_modules/.bin/vitest run --root . --project ui packages/ui/tools/generated-element-facts.test.ts packages/ui/tools/generate-ui-manifest.generated-element.test.ts packages/ui/tools/generate-cem.fixture.test.ts` (Node v24.18.0); `node packages/ui/tools/generate-ui-manifest.ts --check`; `node packages/ui/tools/generate-cem.ts --check` |
| result | 3 files / 15 tests passed; `UI manifest check passed (6 declarations)`; `CEM check passed (6 modules)`; the tracked manifest and CEM are byte-identical to a fresh in-memory projection |
| provenance | `LOCAL` dirty checkout at `0b07e7ecb`; no CI run/job identity, no clean status, no packed run — advisory only |

The fixture-first tests are LOCAL dev feedback, not clean-SHA evidence. They
cannot close the `custom-elements.json` row: the live `packages/ui/src` scan has
no tag source yet (phase 2), no packed `@openelement/ui` artifact was read back,
and no `gate:release` / `gate:packed` pair ran at one SHA.

## What this note does not do

- It creates no P5 evidence, no final-SHA matrix, no capability inventory, no
  milestone exit, no sign-off, no gate result and no release claim.
- It does not rewrite the execution plan, the progress ledger, the semantic test
  matrix, the public-interface snapshot or any `packages/*` source/export map.
- It does not open Alpha16 release qualification. The owner sign-off of §13.5,
  the five §12a proofs, M13 and the publication authorization in
  `CONTRIBUTING.md`:197 remain separate, non-mergeable acts.
