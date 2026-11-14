# ADR-0177: Artifact-resolution subpaths under `internal/` (named deviation)

- Status: ACCEPTED
- Date: 2026-11-14
- Owner authorization: 2026-11-14 session ruling (all recommendations accepted;
  no alias, single source of truth, no JSR/Deno, full P1–P8 compliance).
  This ADR is the first written carrier of that ruling.
- Related: ADR-0137, ADR-0155, ADR-0166, ADR-0174, ADR-0176

## Context

`packages/element/package.json`:16-17 publishes two export subpaths:

```
"./internal/compiled/generated-element/shell": "./src/internal/compiled/generated-element/shell.ts",
"./internal/compiled/runtime": "./src/internal/compiled/runtime.ts",
```

They are **emitted-code import targets, not author API**. The compiler writes
these specifiers into a generated module so a packed consumer can resolve them
through standard package `exports`, with no build alias and no workspace alias.
`docs/architecture/m09-1-emitter.md`:246-249 records the reason — "without the
subpath no generated module can be built from the tarball" — and :251 states
"Both subpaths are public and their names say 'internal'".

`docs/adr/ADR-0137-public-package-ownership-boundaries.md`:8 says "Public package
entries expose deliberate facade modules and **never name an `internal/` module**".
Its `:3` is a plain `ACCEPTED`, the record contains no exemption, and `:20-24`
claims the package-surface / dependency-graph / declaration-graph /
package-artifact / public-interface snapshot gates enforce these boundaries.
That claim is not implemented for the naming rule:
`tools/repo/check-public-interface-snapshot.ts`:63-66,347-368 enumerates shape
and byte-diffs the snapshot; it has no `internal/` assertion. The snapshot
(`docs/release/public-interface-snapshot.json`:590-591,954,971) lists 11 and 79
`publicSymbols` behind the two subpaths and `gate:source` stays green.

`design-principles.md`:16-19 makes "comply or explain" the working rule: a
deviation must be **named in the commit message or ADR, citing the principle it
trades against**; "an unnamed deviation is a defect and is reverted". The
introducing change set `3d4992859` (PR #1782, M09-1b) contains explanatory text
at `:61-73` about the API-reference generator skipping `internal/` subpaths by
convention and carrying "no stability promise", but it does not cite ADR-0137 §1
or any P1–P8 principle, and it gives no written retirement condition. The
preceding shell slice `735749b1c`:72-75 says "This is a release boundary, not a
gate exemption or a runtime allowlist". The repository does use the naming
mechanism elsewhere (`1e1bcd759`, `ca4671c75` carry "NAMED DEVIATION (P7/P5/P8)"),
so the mechanism exists; it was not applied here.

## Decision

This record names the deviation. **No exemption is granted and §1 of ADR-0137
remains in force throughout.** ADR-0137's body is not edited, and
`packages/element/package.json`:16-17 (`exports`) is unchanged — the public
surface is neither widened nor renamed. This is a time-limited, evidence-gated
deviation, not a stability promise.

The deviation is traded against:

- **P1 / ADR-0137 §1** — a public entry names an `internal/` module. The reason is
  that the generated module is a *compiler artifact*: the consumer never writes
  this specifier, and the alternative (a build alias or a hand-maintained
  allowlist) would create a second resolution mechanism, which P6 forbids.
- **P2** — the new runtime surface still needs an ADR and byte attribution in the
  full reachable page closure (`ADR-0174`:42-50, :118-119, :127-128). That
  measurement is **not** delivered by this record; it remains an open obligation
  (`ADR-0174`:12-13 says size attribution is NOT RUN).
- **P5 / P6 / P8** — the deviation carries one written retirement condition,
  owned by this single record; `package.json`:5, `16b-MN` and any checker are
  derived pointers, not additional owners.

### Written retirement condition

Both `/internal/*` export subpaths retire — deleted from
`packages/element/package.json` `exports` and regenerated out of
`docs/release/public-interface-snapshot.json` in the same commit — when
`@openelement/tools-release#graph:check` reports zero importers outside
`packages/element`, `@openelement/tools-repo#esm:boundary-check` reports no
external resolution of either specifier, and the snapshot records zero
`publicSymbols` behind either subpath, with `gate:release` and `gate:packed`
green at that one SHA; §1 of ADR-0137 remains in force throughout and no fixed
version, date or exemption is granted.

The condition is a predicate on existing gate outputs at one reproducible SHA.
It deliberately does not cite ADR-0137:20-24's nominal gate list as a verdict:
the naming-boundary assertion does not exist there today.

### Gates to be verified when the condition is claimed

| Gate | What it proves |
| --- | --- |
| `@openelement/tools-repo#interface:snapshot` (`tools/repo/check-public-interface-snapshot.ts`) | only that `exports` and snapshot agree; at retirement, that `publicSymbols` behind both subpaths is zero. It cannot alone decide ADR-0137 §1 compliance. |
| `@openelement/tools-release#graph:check` (`tools/release/check-package-graph.ts`) + `@openelement/tools-repo#esm:boundary-check` + `export-files:check` | zero importers / zero external resolution in the packed tarball and module graph — the only decidable source of that predicate. |
| `@openelement/tools-release#package-artifacts:check:prepacked` + `gate:packed` + `@openelement/tools-repo#gate:release` | both green at the same SHA, per `alpha16-18-execution-plan.md`:508. A green CI run is not browser qualification (`docs/architecture/README.md`:96-98). |

Adding a naming-boundary assertion to `check-public-interface-snapshot.ts` would
be a **gate-policy change**, and this record does not make it. The risk register
leaves it unassigned rather than owner-ruled: R14 (`execution-plan`:283,
"documentation drift between canonical docs and ADRs") records
`Blocking gate = —` and `Owner decision? = No`, so the plan authorizes no
blocking assertion there and assigns the decision to no one. The gap is
therefore recorded as **unassigned**, not queued as an owner candidate — no one
is waiting on an owner ruling to close it, and saying otherwise would invent a
queue that does not exist.

## Consequences

- `packages/element/package.json`:5 `"//"` annotation gains a derived pointer to
  this record; the `exports` map is untouched. This follows the existing pattern
  for `./client-only` (ADR-0155:175-205) and `./no-blocks` / `./base`
  (ADR-0166:134-148), whose written retirement conditions are the compliant
  precedent. That annotation previously covered only those three subpaths.
- `docs/architecture/16b-migration-note.md` carries one derived row for this
  deviation (§14.1 condition 6 / §14.2:504). Neither is a second owner.
- `docs/adr/README.md` gains one entry; `adr-index:check` covers it in
  `gate:source`.
- This record creates no version, tag, publication, public API freeze or release
  claim, and no P5 evidence or milestone exit.
- P7 review gate: (1) platform = the package `exports` map and the module graph,
  not a new registry; (2) compile-time only, no product code; (3) no runtime or
  server-contract change; (4) precedent = ADR-0155 / ADR-0166 written retirement
  conditions, with the deliberate difference that these subpaths are
  emitted-code import targets rather than author-facing entry variants.
