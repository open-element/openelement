---
status: active
topic: M09 exit docket (decisions recorded; effective on signature)
summary: M09 exit docket for signature: fixed SHA, §13.6 provenance, delivered slices, blocking set, empty signature fields, plus the three owner decisions of 2026-11-14 (M09-3/4 scope, CEM contract migration, two-step P5). Records no status and claims no exit.
---

# M09 exit docket

Prepared: 2026-11-14. **Status: DRAFT — this is not an exit record and not a
status statement.**

`docs/architecture/alpha16-18-progress.md` §3 (M09 row) and §4 are the status
records; nothing here changes them, and §4's verdict "Alpha16b (M09–M14) has no
exit evidence" (`:179-181`) stays in force. This file is pointer-style: it
collects the material an exit record must carry and cites the authority for
each item instead of restating it.

The point of collecting it is narrow. When M09 exit evidence exists it is
recorded **once**, by a consolidation PR naming the fixed SHA and carrying its
own evidence (`alpha16-18-progress.md`:286-289, the adopted Closeout form), never
as a by-product of a slice PR. This file is what that PR would contain minus the
signatures.

## Owner decisions of record (2026-11-14)

The three items this docket was blocked on were put to the owner on 2026-11-14
and answered. They are recorded here so the next reader does not re-litigate
them; each row names what it changed in this file.

| # | Question | Answer | Effect on this docket |
| --- | --- | --- | --- |
| D-① | `M09-3` / `M09-4`: define and deliver, or retire the labels? | **Define and deliver.** `M09-4` is the closeout bookkeeping itself (matrix TSX-14/TSX-20 plus the §3 row), so the exit record performs it rather than a slice doing so; `M09-3` is delivered as one bounded slice. | B1 turns from an undefined scope into one bounded slice with a named, pre-existing harness. No label is retired. |
| D-② | CEM retained obligation: generate CEM, or migrate the packed CEM artifact contract? | **Migrate the contract** — §14.2's second branch, owner-approved here. The format stays standard CEM 2.1.0 validated against the official `custom-elements-manifest` schema; the change is confined to the *input* of the manifest chain. | B2's CEM row acquires a bounded mechanism; the other two rows are unchanged. |
| D-③ | §13.5 P5 inventory: track as-is, complete-then-sign, or narrow the claim? | **Complete, in two steps.** Track the inventory now as a progress table with `sign-off: none`; take the §13.5 owner sign-off only when the count of production-equivalent replacements is no longer zero and the final-SHA matrix is filled. The claim is **not** narrowed. | B3 stays open, but its first half (a tracked inventory) becomes deliverable without pretending to be P5 evidence. |

These three decisions are recorded here as the first written carrier of the
owner's 2026-11-14 direction. No earlier record is cited because none exists:
the docket is where the ruling is written down. They settle scope and method
only and supply no evidence.

### What D-① resolves, exactly

`M09-3` and `M09-4` were never plan labels: `alpha16-18-execution-plan.md`:58
defines M09 as one milestone, and §14.4 (`:525-527`) states that no slice label
is introduced. Their definitions exist only in the pre-slice working design
(`review-deliverables/alpha16-execution-20261112/M09-0-design.md`:142-145 and
`remaining-work-graph.md`:61-62), which is an input, not authority. As decided:

- **M09-3 — third-party Web Component / foreign-framework interoperability
  qualification.** The generated CE joins the `tests/fixtures/web-component-interop`
  corpus, and the foreign-tag rules (no auto-registration, no SSR assumption)
  are asserted on it. The harness pre-exists and is already gated:
  `tests/fixtures/web-component-interop/{corpus.json,qualify.ts}` and
  `@openelement/fixture-web-component-interop#test` inside `gate:release`.
- **M09-4 — the matrix and ledger row set** (TSX-14 CE connection lifetime,
  TSX-20 native CE / third-party WC, and the §3 M09 row). This is the closeout
  bookkeeping the consolidation PR performs, not a separate deliverable.

D-② is likewise narrower than "build CEM". `packages/ui/tools/generate-cem.ts`
already projects onto CEM 2.1.0 and validates against the official schema
shipped by `custom-elements-manifest`, `packages/ui/custom-elements.json` is
tracked and shipped, and `ui-cem:check` plus the packed-copy check in
`tools/release/check-package-artifacts.ts` are already in `gate:release`. The
break is upstream: `packages/ui/tools/generate-ui-manifest.ts` requires an
`@element('tag')` decorator (`:164-165`) and `extends OpenElement` (`:171`,
`:349`), so the chain loses its input — not its format — when components become
function components. The migration therefore changes the manifest chain's input
and leaves the CEM format, the schema validation and every gate untouched.

## 1. Fixed SHA

| Field | Value |
| --- | --- |
| Commit | `fa6e5232dd54520d100108b202a73a1d70341f11` |
| What it is | `origin/main`: PR #1790 squash, `feat(element): bounded form association on the generated element (M09-2d)` |
| Why this SHA | it is the last M09 change to reach `main`; every M09 slice is an ancestor of it |

## 2. Evidence, in the §13.6 four-part form

| Field | Value |
| --- | --- |
| commit | `237e14bd2a3330618882af5ef02bfdf698c65eca` — the tree the commands actually ran on |
| worktree | `LOCAL .artifacts/alpha16-restart-20261114/worktree` (advisory checkout; the canonical worktree is named in `evidence-baseline.md`) |
| command | `node_modules/.bin/vitest run --project compiler` over the four M09-2d suites — `generated-element.nonprimitive`, `generated-element.nonprimitive.browser`, `generated-element.forms`, `generated-element.forms.browser` — on Node v24.18.0 |
| result | 4 files / 53 tests passed: non-primitive 9/9 (browser) + 28/28 (Node), forms 10/10 (browser) + 6/6 (Node) |

**Bridge to the fixed SHA.** The commands ran on `237e14bd2`, not on
`fa6e5232`. `git diff --name-only fa6e5232 237e14bd2` returns eight `docs/`
files plus one line of `packages/element/package.json` — the `"//"` annotation
string only; the `exports` map, `version`, `sideEffects` and `files` are
untouched, so no code path and no resolution behaviour differs. Re-executing the
four suites at `fa6e5232` itself is an open reviewer action, not a delivered
one.

## 3. What is delivered

Nine merged PRs (seven rows), keyed to the squash SHA each landed as
(`alpha16-18-progress.md` §4.7 holds the same list with its later readings):

| PR | Squash SHA | Slice |
| --- | --- | --- |
| #1768 | `735749b1c` | M09-0 generated-element runtime shell |
| #1772 | `873435ae0` | M09-shadow root, DSD and claim parent |
| #1778 | `8ae4646d8` | M09-1a generated Native Custom Element tail and site admission |
| #1782 | `3d4992859` | M09-1b registration site and packaging |
| #1785 / #1787 | `d0ea3824b` / `089ace0a8` | M09-2a core shadow island and platform metadata |
| #1788 | `7581fbf60` | M09-2c intrinsic event/ref channels |
| #1789 / #1790 | `f69dde8bf` / `fa6e5232d` | M09-2d non-primitive properties, bounded form association |

## 4. Blocking set — why this is not signable today

| | Blocker | State | Who can close it |
| --- | --- | --- | --- |
| B1 | **`M09-3` is defined but not delivered** (D-①): the generated CE is not yet in the third-party interoperability corpus. `M09-4` is the closeout bookkeeping this record performs and is no longer counted as a gap. | Defined, not delivered | implementation — one bounded slice |
| B2 | **§14.2's three retained obligations** are OPEN. `16b-migration-note.md` is the tracked carrier for all three and records them as open rows; the CEM obligation has no bounded mechanism at all, while non-primitive conversion and form validity are bounded-LOCAL. | Not delivered | implementation |
| B3 | **§13.5 P5 evidence.** The tracked capability inventory, the final-SHA matrix and the owner sign-off do not exist; §13.5: "A draft does not satisfy P5 … until then, P5 is not claimable and Alpha16 release qualification is not openable". | Absent | owner + author |
| B4 | **Evidence provenance limits.** The run is `LOCAL`, chromium-only, with no CI run/job identity and no Firefox/WebKit leg; the engine revision is not recorded. M13 is where three engines are qualified, and this docket does not pre-empt it. | Recorded limit | — (a limit, not a gap in the plan) |

B1 is no longer a scope question — D-① closes it — but a delivery one: a single
bounded slice whose fixture and gate already exist. Until it lands, no amount of
evidence makes an M09 exit record true. `M09-4` does not appear in this table
because the record that closes M09 is the action that satisfies it.

## 5. NOT claimed

- No M09 exit. D-①–D-③ settle scope and method only: they supply no evidence,
  close no obligation and authorize no release.
- No change to the §4 verdict that Alpha16b has no exit evidence.
- No status flip of the §3 M09 row; that row is a historical single-writer
  record.
- No P5 evidence, no §13.5 inventory, no owner sign-off.
- No generated-product entry, packaging/registration, or public API.
- No three-engine (M13) qualification; the browser leg here is chromium-only.
- No version, tag, publication or release-train change. The published surface
  stays `v1.0.0-alpha.15` (2026-10-19).
- No M10 progress: M10 P1–P5 are separate proofs and none of them is met or
  moved by this file.

## 6. Signature block

An M09 exit record needs four separate signatures and they are **not
interchangeable**:

| # | Signature | Holder | State |
| --- | --- | --- | --- |
| ① | D2 gate-record sign-off (the G1/G2 gate record that precedes any §4 row flip) | architect (G1) | _empty_ |
| ② | Milestone exit / Closeout form, by consolidation PR (`alpha16-18-progress.md`:286-289) | milestone owner | _empty_ |
| ③ | §13.5 capability-inventory owner sign-off | owner | _empty_ |
| ④ | Explicit maintainer approval (`CONTRIBUTING.md`:197) | maintainer | _empty_ |

A signature here authorizes recording an M09 exit. It is **not** a release
authorization (`CONTRIBUTING.md`:197), and it does not admit a publication: S4
is the only step that ships `1.0.0-alpha.16`, and it is gated separately.

D-③ does not move signature ③ earlier. The §13.5 sign-off stays unavailable
while the inventory's count of production-equivalent replacements is zero, and
"tracked" is not "signed".

The record becomes effective only when all four are filled **and** B1 is closed
by a decision or B1–B2 are explicitly accepted as scope in a dated
§14-style amendment. Filling the four fields while B1 is undecided would record
an exit whose own scope is undefined.
