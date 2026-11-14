---
status: active
topic: M09 exit docket (prepared for signature; effective on signature)
summary: Collects what an M09 exit record must carry — fixed SHA, §13.6 provenance, the delivered slice set, the blocking set and the empty signature fields — so the remaining work is a signature and one scope decision rather than research. It records no status and claims no exit.
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

Six merged PRs, keyed to the squash SHA each landed as (`alpha16-18-progress.md`
§4.7 holds the same list with its later readings):

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
| B1 | **`M09-3` and `M09-4` have no definition.** The §3 row (`:125`) lists them as open, and `m09-generated-element-shell.md`:211 says they are "not started", but neither label is defined anywhere in `docs/`. `alpha16-18-execution-plan.md`:58 defines M09 as **one** milestone and names no sub-slices, and §14.4 (`:525-527`) states that no new slice label is introduced. The remaining-open set therefore cannot be evaluated: it is either two undefined capabilities, or two labels that should be retired. | Undecided | owner (scope decision) |
| B2 | **§14.2's three retained obligations** are OPEN. `16b-migration-note.md` is the tracked carrier for all three and records them as open rows; the CEM obligation has no bounded mechanism at all, while non-primitive conversion and form validity are bounded-LOCAL. | Not delivered | implementation |
| B3 | **Independent review.** Both M09-2d slice documents self-report `Status: bounded implemented — LOCAL review pending` (`m09-2d-forms.md`:9, `m09-2d-nonprimitive-properties.md`:9). A slice PR self-reporting "review pending" cannot be an exit input. | Pending | independent reviewer |
| B4 | **§13.5 P5 evidence.** The tracked capability inventory, the final-SHA matrix and the owner sign-off do not exist; §13.5: "A draft does not satisfy P5 … until then, P5 is not claimable and Alpha16 release qualification is not openable". | Absent | owner + author |
| B5 | **Evidence provenance limits.** The run is `LOCAL`, chromium-only, with no CI run/job identity and no Firefox/WebKit leg; the engine revision is not recorded. M13 is where three engines are qualified, and this docket does not pre-empt it. | Recorded limit | — (a limit, not a gap in the plan) |

B1 is the load-bearing one. It is a **decision**, not work: either M09-3/M09-4
are defined and delivered, or the §3 row's label set is corrected by a dated
amendment stating that M09 has no third and fourth slice. Until one of those
happens, no amount of evidence makes an M09 exit record true.

## 5. NOT claimed

- No M09 exit, and no change to the §4 verdict that Alpha16b has no exit
  evidence.
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

The record becomes effective only when all four are filled **and** B1 is closed
by a decision or B1–B2 are explicitly accepted as scope in a dated
§14-style amendment. Filling the four fields while B1 is undecided would record
an exit whose own scope is undefined.
