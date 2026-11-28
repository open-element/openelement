# ADR-0184: Alpha17 retires the emitted-runtime entry variants and their public subpaths

- Status: ACCEPTED
- Date: 2026-11-28
- Owner authorization: 2026-11-28 session ruling — the repository owner directed
  the three-PR Alpha17 delivery. The first PR (#1824, this change set) retires
  the emitted Part Program runtime; this record is the written carrier for the
  public-surface half of that direction. It creates no release, tag,
  publication, ABI freeze or milestone claim of its own.
- Amends: nothing directly. It is the later record that
  [ADR-0155](./ADR-0155-client-only-entry-subpath.md),
  [ADR-0166](./ADR-0166-regions-axis-entry-subpaths.md) and
  [ADR-0177](./ADR-0177-internal-artifact-resolution-subpaths.md) name in their
  2026-11-28 amendments. Those records keep their own decisions; their
  2026-11-28 amendments record what happened to the written retirement
  condition each one carried. Decision 4 states the qualification: the removals
  are owner-ratified under the operative readings those amendments record (or,
  for ADR-0177, with none of its gate predicate claimed), not literal
  satisfaction of any written clause.
- Related: ADR-0154 (Alpha breaking-removal baseline), ADR-0160 and ADR-0174
  (the Alpha17 executor retirements these entries specialised), ADR-0137 (the
  public-package naming boundary ADR-0177 deviates from), ADR-0182 (the
  surviving public facade subpaths), the
  [design constitution](../architecture/design-principles.md), the
  [evidence baseline](../architecture/evidence-baseline.md) and the
  [public interface snapshot](../release/public-interface-snapshot.json).

## Context

Before Alpha17 the compiler emitted a serialized **Part Program**, and the
browser interpreted that program with a generic runtime executor: claim,
hydration, revive, and the `when`/`each` Block builders. Four public export
entries of `@openelement/element` existed only to let a bundle choose which
slice of that executor it linked:

| Entry | Target module | Authorising record |
| --- | --- | --- |
| `./client-only` | `packages/element/src/client-only.ts` | [ADR-0155](./ADR-0155-client-only-entry-subpath.md) |
| `./no-blocks` | `packages/element/src/no-blocks.ts` | [ADR-0166](./ADR-0166-regions-axis-entry-subpaths.md) |
| `./base` | `packages/element/src/base.ts` | [ADR-0166](./ADR-0166-regions-axis-entry-subpaths.md) |
| `./internal/compiled/runtime` | `packages/element/src/internal/compiled/runtime.ts` | [ADR-0177](./ADR-0177-internal-artifact-resolution-subpaths.md) |

Each record carried a written retirement condition (P5). Each deletion unit was
specified in advance, and the deletion was specified as one unit with no
compatibility alias and no deprecated-alias period (Alpha permits breaking
cleanup; ADR-0154).

Alpha17 replaced the architecture that made those entries meaningful. The
compiler now lowers each admitted component at build time into a generated
module that carries its own mount, claim and server-rendering functions; the
`packages/element` generated-element shell owns the element lifecycle; the
browser adopts a server-rendered shadow root through the platform's declarative
Shadow DOM (DSD) parser, and the generated claim code binds to the adopted
nodes. Registration is the generated entry's call, not a runtime executor's
lookup. The emitted modules import the closed internal helper sets from the
surviving internal subpaths (`./internal/compiled/generated-element/shell`,
`./internal/compiled/leaf-runtime`) rather than a `Part Program` facade.

The executor half ships in commit `681b5e3ce` ("Retire the generic Part Program
executor", 2026-11-28); the serialized schema/validator half ships in
`34a28b5dc` and the hydrator-installer remainder in `060de3b41`. The snapshot
refreshes for those retirements are their own commits.

When the generic executor is deleted, an entry whose whole job was to select a
subset of it has nothing left to select. That is the event this record names.

## Decision

1. **The four export entries retire together, as a deliberate breaking removal.**
   `packages/element/package.json` no longer publishes `./client-only`,
   `./no-blocks`, `./base` or `./internal/compiled/runtime`, and their target
   modules are deleted with the executor they carried. No alias, re-export or
   deprecated period is added: a stale import now fails standard package
   resolution instead of silently reaching a second runtime shape.

2. **The runtime-shape entry selection retires with them.** Router's generated
   client entry no longer chooses among entry shims: `pageCanHydrateServerDom`
   and the `ssg/element-services-{full,client-only,base}.ts` re-export
   pass-throughs are deleted, so the entry uses the one default Element runtime
   plus the surviving facade subpaths exactly as ADR-0182 owns them
   (`@openelement/element/document-services` for the document bootstrap). The
   package's installer `sideEffects` array also retires and the package now
   declares `sideEffects: false`, because no entry imports an installer for its
   side effect. This follows from the same fact as decision 1 — there is no
   executor install edge left to keep alive.

3. **The public-surface delta is enumerated, not summarised.** The four removed
   entries carried **370** `publicSymbols`; the whole tracked surface moved from
   **1,319 to 871 (−448)** in this change set. The per-entry table is §
   [Enumerated public-surface delta](#enumerated-public-surface-delta). This
   record is the **single written owner** of the four-entry removal. The three
   original records are amended to point here; they are not rewritten, and the
   removal is not attributed to a record that did not decide it.

4. **Which written condition each removal resolves, and on what authority.**
   The authority for the four removals is the repository owner's 2026-11-28
   direction stated above. The written retirement conditions are **not** claimed
   as literally satisfied; each is discharged only under the operative reading
   that its owning record's 2026-11-28 amendment records, recorded as an
   owner-ratified replacement, or — for ADR-0177 — not claimed through that
   record's gate predicate at all. This record states the qualification
   alongside the outcome so that a later reader cannot cite it as proof that a
   literal condition clause was met.
   - `./client-only` — [ADR-0155](./ADR-0155-client-only-entry-subpath.md)
     retirement condition 2 ("the Part Program reaches full static lowering (no
     claim need)") is met **only under that amendment's operative reading**: the
     component's DOM program is lowered at build time into its generated module
     and the generic claim executor, its seam and its installer are gone, so the
     full entry is what the subpath was. The literal clause "no connected
     element ever has pre-existing content it must adopt" is **not claimed** and
     does not hold verbatim — server-rendered DSD markup still exists and
     generated claim code binds to it (ADR-0155, 2026-11-28 amendment).
     Condition 1 (bundler-native per-page conditional exports) is **not** met
     and is not used.
   - `./no-blocks` / `./base` —
     [ADR-0166](./ADR-0166-regions-axis-entry-subpaths.md) retirement condition
     2 ("the Part Program grammar retires dynamic Regions") is **not formally
     satisfied**: its antecedent, that `when`/`each` lowering is replaced by
     static or platform-native constructs, is not claimed literally and emitted
     generated-leaf code still performs runtime marker-based condition/list
     reconciliation. What authorizes this removal is the recorded
     **owner-ratified replacement** in that amendment — the Block builders, their
     seam and installer no longer exist, and every emitted component carries its
     own condition/list code — not literal satisfaction of the written
     condition. Condition 1 is again not met and not used.
   - `./internal/compiled/runtime` —
     [ADR-0177](./ADR-0177-internal-artifact-resolution-subpaths.md): the
     subpath retires with its **target module**, which is deleted with the
     executor. The record's multi-clause gate predicate is not presented as the
     authority that retired it (see that record's 2026-11-28 amendment); the
     two surviving internal subpaths remain covered by that record's one
     written condition.

5. **Later readers must not read this record as a stability promise for the
   survivors.** `./lifecycle` and `./document-services` are owned by ADR-0182;
   the two internal artifact-resolution subpaths are owned by ADR-0177; the
   remaining root/helper subpaths are owned by their own records. This record
   may be cited only for the four removals and the delta they carry. If a
   future axis needs a runtime-shape entry again, it starts from a new decision
   record — the deleted names are not revived by pointing this record at them.

### P7 review gate (short form)

1. **Platform.** The package `exports` map and the module graph — the same
   platform as the three amended records, not a new registry or resolution
   path.
2. **Compile-time cost.** None: the change removes surface and installs. The
   only edit sites are the package manifest, the deleted modules and their
   consumers.
3. **Runtime / server contract.** No server contract change. The client runtime
   shrinks; the breaking part is the package surface, which Alpha permits
   (ADR-0154) and the three amended records pre-authorized in writing.
4. **Prior art and deliberate difference.** Precedent = the written retirement
   conditions of ADR-0155/ADR-0166/ADR-0177. The deliberate difference is that
   the conditions are addressed together — under the Decision 4 qualification —
   by one architecture retirement rather than one axis at a time, so this record
   carries the combined enumeration instead of three separate removal records.

## Enumerated public-surface delta

Comparison point: `25815d9b79df270947d02ba85dd9268da84550b7` (the change set's
base) versus this worktree's tracked `docs/release/public-interface-snapshot.json`
at `a0e685cad4df660389217c6ae443445ab86759b8`. `publicSymbols` are counted per
package export entry; the file is not modified by this record.

### Entries decided by this record

| Entry removed | Target module | Base | Head | Delta |
| --- | --- | --- | --- | --- |
| `@openelement/element` `./client-only` | `./src/client-only.ts` | 93 | absent | −93 |
| `@openelement/element` `./no-blocks` | `./src/no-blocks.ts` | 93 | absent | −93 |
| `@openelement/element` `./base` | `./src/base.ts` | 93 | absent | −93 |
| `@openelement/element` `./internal/compiled/runtime` | `./src/internal/compiled/runtime.ts` | 91 | absent | −91 |
| **Subtotal** | | **370** | **0** | **−370** |

### Entries changed by the same change set, not decided here

Listed only so the total is auditable. These belong to the same PR's serialized
Part Program schema/validator/wire and stream-executor retirements recorded by
[ADR-0160](./ADR-0160-architecture-debt-repayment.md) and
[ADR-0174](./ADR-0174-generated-code-runtime-and-compatibility.md); this record
does not decide them.

| Entry | Base | Head | Delta |
| --- | --- | --- | --- |
| `@openelement/protocol` `.` | 215 | 189 | −26 |
| `@openelement/protocol` `./part-program` | 49 | 29 | −20 |
| `@openelement/router` `./server-runtime` | 76 | 63 | −13 |
| `@openelement/protocol` `./policy` | 8 | 3 | −5 |
| `@openelement/element` `.` | 93 | 88 | −5 |
| `@openelement/element` `./authoring` | 22 | 17 | −5 |
| `@openelement/compiler` `.` | 45 | 42 | −3 |
| `@openelement/protocol` `./ssg` | 38 | 37 | −1 |
| **Subtotal** | **546** | **468** | **−78** |

Total across the tracked surface: **1,319 → 871, −448** (370 + 78; entries
unchanged by the change set account for the remaining 403 in both columns).

## What this record does not prove

- **No cross-module ABI freeze.** The generated-module ABI version and the
  precompiled-distribution contract stay open; `ADR-0174` and
  `compiler-ir-and-abi-boundary.md`'s "Cross-module ABI freeze — Alpha17" row
  remain the target, and the later PRs of the delivery own the freeze. This
  record decides a removal, not a stable contract.
- **No precompiled package distribution qualification.** Precompiled tarball
  consumption (TSX-21) is Alpha17 direction, not an outcome of this change set.
  The removed entries are not replaced by a slower compatibility path; the
  surviving internal subpaths ship the helper sets only.
- **No mixed-artifact compatibility window.** Old emitted artifacts that import
  the removed specifiers cannot resolve against this package. Alpha permits
  the break (ADR-0154), but this record claims no compatibility check and no
  deprecation window; a consumer that needs one is on a release lane, not here.
- **No gate or release record.** This document is the decision carrier, not
  gate evidence. The retirement's evidence in this change set is the deleted
  export targets plus the snapshot arithmetic in §Enumerated public-surface
  delta; the read-only verification below is advisory under the evidence
  baseline because the worktree is shared and dirty during the delivery.
- **No literal satisfaction of a written retirement condition.** The removal is
  authorized by the owner's 2026-11-28 direction and by each owning record's
  amendment (an operative reading, or a recorded owner-ratified replacement —
  Decision 4). The literal ADR-0155 clause "no connected element ever has
  pre-existing content it must adopt" and the literal ADR-0166 antecedent
  (static or platform-native replacement of the `when`/`each` lowering) are
  **not** claimed; this record must not be cited as evidence that they hold.
- **No milestone exit.** M11/P2 and every other milestone claim are unchanged
  by this record.
- **No ADR-0137 §1 amendment.** ADR-0177 remains the named-deviation record for
  the surviving internal subpaths; this retirement narrows that deviation, it
  does not grant an exemption.
- **Not a rewriter of older change-set histories.** Older records name the
  retired entries as facts of their own change set (e.g. ADR-0180:20,
  ADR-0181:147/256/328, ADR-0182:805-806/1226). Those sentences are not
  current-surface claims and are deliberately not rewritten here; the current
  surface authority is this record plus the 2026-11-28 amendments to
  ADR-0155/ADR-0166/ADR-0177.

## Consequences

- **Breaking change, deliberately clean.** Any hand-written bundle importing one
  of the four subpaths gets a standard package-resolution failure. There is no
  alias graveyard and no second executor shape to keep consistent.
- **One fewer mechanism to keep honest.** The executor commit deletes ~6,000
  lines of runtime (claim, hydrate, revive, Block builders, program kernel,
  program serializer, server executor and their seams/installers); the recurring
  hazard of the public-shape duplicates shrinks with them. Base-snapshot facts:
  `.`, `./base`, `./client-only` and `./no-blocks` all carried public shape
  `855f1bfce5977bd2…`; three of those four duplicates retire here (`.` remains),
  while `./internal/compiled/runtime` was pinned to a different shape
  (`806bfbb37a692df5…`) and was never part of the one-hash hazard.
- **Governance trail.** The three owning records gain append-only 2026-11-28
  amendments; `docs/adr/README.md` annotates them `AMENDED` and lists this
  record; `adr-index:check` and `docs-index:check` stay green.
- **Derived pointers were removed with the surface.**
  `packages/element/package.json` no longer carries the `//` governance
  annotation (the ADR-0155 / ADR-0166 / ADR-0177 pointer) or the
  `//sideEffects` annotation, because the exports and install edges they
  described are gone. They were derived pointers, not owners. Consequence
  recorded for a later change: the two surviving internal subpaths now have no
  in-package pointer annotation, and ADR-0177 stays their single owner either
  way.
- **Seams registry row corrected.** The M09-1b emitted-import note in
  [seams.md](../architecture/seams.md) named the removed
  `@openelement/element/internal/compiled/runtime` specifier; it now names the
  surviving `./internal/compiled/leaf-runtime` specifier the compiler actually
  emits (a documentation correction; no product change).

## Verification

Read-only, in worktree `.codex-alpha17/integration` at
`a0e685cad4df660389217c6ae443445ab86759b8`. The worktree is shared with parallel
edits during the delivery, so this is an **advisory** record under the evidence
baseline, not gate evidence.

| Check | Command | Result |
| --- | --- | --- |
| Snapshot arithmetic | `git show 25815d9b7:docs/release/public-interface-snapshot.json` then count `declarations[*].publicSymbols` in both snapshots | 1,319 → 871, −448; the four entries 370 → 0 |
| Entries removed from the package | `git show HEAD:packages/element/package.json` | 14 exports, none of the four removed names; `sideEffects: false` |
| ADR index | `pnpm --filter @openelement/tools-repo adr-index:check` | `40 record(s), 40/40 entr(ies) resolved, 12 annotated` |
| Docs current view | `pnpm --filter @openelement/tools-repo docs-index:check` | `links resolve (27 active document(s), 0 historical record(s), 64 archive/removal entr(ies))` |
| Markdown lint | `pnpm exec markdownlint-cli2 "docs/adr/*.md" "docs/architecture/seams.md"` | `Linting: 42 files; Summary: 0 issues in 0 files` |
| Machine paths | `pnpm --filter @openelement/www check:public-docs` | `machine-path check passed (79 text files scanned in 1 source path(s))` |
| Root check | `pnpm check` | `gate ok: 5 step(s)` — fmt, lint, typecheck, markdownlint (158 files, 0 issues), machine paths |
