---
status: active
topic: Evidence baseline and provenance
summary: The four-part evidence record every claim must carry — commit, clean status, exact command and result, with CI or worktree provenance — and why a checkout that merely differs from main is a provenance gap, not an evidence gap.
---

# Evidence baseline and provenance

Date: 2026-11-14 (amended; first recorded 2026-11-13). Status: **governance record; no capability, no gate, no release
claim.** This document records where evidence is taken from and how it is cited.
It creates no milestone evidence of its own.

## Why this exists

During the Alpha16a closeout the repository ended up with sixteen worktrees and a
main checkout parked on an older branch. Several reviews then disagreed about
whether a fact was "readable": one side cited the working tree (which lacked
merged commits), the other cited `origin/main` (which had them). Both were
describing the same repository, so the disagreement was not about the code — it
was about **which tree the claim came from**.

That failure mode is cheap to prevent and expensive to debug, because an
unattributed claim and a wrong claim look identical in a review document. The
rule below exists so that a reader can re-derive any cited result with two
commands.

## Evidence authority

Evidence is authoritative when it carries the complete record below at the cited
commit. Where the record was taken is **provenance**; it is not a validity
condition.

| Field | Requirement |
| --- | --- |
| commit | full 40-character SHA the claim is true at |
| status | `git status --porcelain` is empty for tracked files and for untracked files that are not git-ignored at that commit |
| command | the exact command, including project selection and any `--exclude`, with no paraphrase |
| result | the exact pass/fail counts or the exact error identity, never "tests pass" |
| provenance | one of: `CI <workflow run id>/<job>` at that SHA; `LOCAL <worktree path>`; or `advisory only` when the record is incomplete |

A **CI record** is authoritative by its run/job identity at the cited commit. It
does not need a local worktree, and no local path can invalidate it. A **LOCAL
record** is authoritative when it names the worktree it ran in, that worktree is at
the cited commit, and its status is clean. `LOCAL` and `CI` stay separate labels:
a green local run is never written into a CI column.

The **canonical worktree** is the default provenance anchor for Alpha16b rows and
the tree governance commits are re-pointed from:
`.artifacts/canonical-20261113/worktree` (repository-relative; not committed). It
is **not** the only admissible tree: any checkout or worktree at the cited commit
that satisfies the record above — including an independent or ad-hoc worktree — is
legitimate evidence for the claim it records.

Recorded anchor for this revision: HEAD
`fa6e5232dd54520d100108b202a73a1d70341f11` (`feat(element): bounded form
association on the generated element (M09-2d)`, the PR `#1790` squash),
re-pointed 2026-11-14 by the Alpha16 governance restart change set
(ADR-0176 / ADR-0177). The previous anchor
`7632ab36cc9ada49525775897a5eab6177360a75` (PR #1786) stays valid **provenance**
for records taken at that commit; this re-point does not re-adjudicate them.
The canonical worktree is detached at the recorded SHA. Dependencies are the
root `node_modules` plus each workspace package's `node_modules`, installed from
the locked dependency set. When `origin/main` moves, re-point this row in the
same pull request that cites the new SHA; re-pointing is bookkeeping for the
anchor, never a gate on evidence taken elsewhere.

## The four-part evidence record

Every claim that lands in a ledger, a matrix cell, a closeout record or a pull
request body must name the record in [Evidence authority](#evidence-authority):
**commit**, **clean status**, **command**, **result**, plus **provenance**
(a CI run/job identity, or a `LOCAL` worktree path). A record missing a field is a
note, not evidence. `LOCAL` and `CI` stay separate labels on top of that: a green
local run is never written into a CI column, and a CI run is identified by its run
or job identity.

## What a differing checkout does and does not mean

`git merge-base --is-ancestor <main-tip> HEAD` returning non-zero, a dirty
working tree, or an untracked test file proves **one** thing: the checkout does
not satisfy the record above for that claim. It does not prove the fact is
unverifiable. A merged commit is readable with `git show <sha>:<path>` from any
checkout in the repository, and a worktree created at that SHA makes it runnable;
any such checkout with clean status is legitimate evidence.

The situations must therefore be reported separately:

| Situation | Meaning | Handling |
| --- | --- | --- |
| The tree lags `origin/main` | provenance gap | cite `origin/main` or the cited commit; any checkout at that commit satisfies the record |
| The tree is dirty or carries non-ignored untracked files | the record is incomplete | re-run on a clean tree at the cited commit, or label the claim `advisory only` |
| The cited SHA is not on `origin/main` | the work is not landed | the claim is `advisory only` until the commit lands |

## The 2026-11-13 checkout state, recorded once

The main checkout was at `d0b961280` (branch `feat/m08-input-and-s2-evidence`)
with twenty-nine dirty entries at the freeze. Those entries were audited before
being left in place, and they are **fully superseded**, not unlanded work:

- of the six modified tracked files, four are byte-identical to `origin/main`
  and two (`generated-leaf/generate.ts`, `generated-element/shell.ts`) are
  *older* than `origin/main` — they are missing `originArgs` and
  `OpenElementBase` respectively;
- of the ten untracked source and test files, nine hash identical to
  `origin/main` and one is a pre-fix draft of a file that has since landed.

The backup of that state, with its `git status` listing, full tracked diff and
untracked file copies, lives outside the repository at
`.artifacts/canonical-freeze-20261113/backup/`. The checkout is deliberately
**left untouched**: no reset, no stash, no cleanup. It is not citable because it
is not at a recorded commit with a clean status — a status/commit fact, not a
canonical-path rule.

## Rules

1. Evidence cites the five-field record in [Evidence authority](#evidence-authority):
   commit, clean status, exact command, exact result and provenance. "The working
   tree" is never a citation; a record missing a field is a note, not evidence.
2. CI evidence is valid by run/job identity plus the cited commit; a LOCAL record
   is valid by worktree path plus the cited commit and clean status. Independent
   and ad-hoc worktrees are legitimate when they satisfy the record.
3. A pull request that cites a new `origin/main` SHA updates the recorded anchor
   above in the same pull request. Re-pointing the anchor is bookkeeping; it does
   not gate evidence taken at the same commit elsewhere.
4. A differing, older or dirty checkout is a provenance gap, not proof that the
   fact is unverifiable: re-derive it from the cited commit or a fresh worktree at
   that SHA. The pre-freeze main checkout stays excluded for the status/commit
   reason above, not because it is not the canonical path.
5. No policy or CI scanner is behaviour evidence by itself. A scanner's output
   proves the artifact it inspects (bytes, exports, file shape); a behaviour claim
   needs the command and result that exercise the behaviour, and a qualification
   claim needs the qualification run.
6. This record does not create, extend or retire any milestone obligation. It is
   a precondition for citing evidence, not evidence. It creates no P5 evidence and
   no gate record.
