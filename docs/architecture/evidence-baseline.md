---
status: active
topic: Evidence baseline and canonical worktree
summary: The one canonical worktree all Alpha16b evidence is taken from, the four-part evidence record every claim must carry, and why a checkout that merely differs from main is not an evidence gap but a provenance gap.
---

# Evidence baseline and the canonical worktree

Date: 2026-11-13. Status: **governance record; no capability, no gate, no release
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

## Canonical worktree

| Field | Value |
| --- | --- |
| Path | `.artifacts/canonical-20261113/worktree` (repository-relative; not committed) |
| HEAD | `48e81b9ca` (`docs(alpha16a): record the M08 exit and the Alpha16a exit check`, the PR `#1780` squash) |
| Branch | `docs/canonical-baseline` for governance commits; otherwise detached at the recorded SHA |
| Frozen | 2026-11-13 |
| Dependencies | root `node_modules` plus each workspace package's `node_modules`, installed from the locked dependency set |

The canonical worktree is the **only** tree an Alpha16b evidence row may cite.
It is re-pointed — not recreated — when `origin/main` moves: fetch, check out the
new tip, re-run the affected package tests, and update the HEAD row above in the
same pull request that cites the new SHA.

## The four-part evidence record

Every claim that lands in a ledger, a matrix cell, a closeout record or a pull
request body must name all four parts:

1. **commit** — the full or 7-character SHA the claim is true at;
2. **worktree** — the canonical path, or the words `advisory only` when the claim
   was observed somewhere else;
3. **command** — the exact command, including project selection and any
   `--exclude`, with no paraphrase;
4. **result** — the exact pass/fail counts or the exact error identity, not a
   summary such as "tests pass".

A row missing any of the four is not evidence; it is a note. `LOCAL` and `CI` stay
separate labels on top of that: a green local run is never written into a CI
column, and a CI run is identified by its run or job identity.

## What a differing checkout does and does not mean

`git merge-base --is-ancestor <main-tip> HEAD` returning non-zero, a dirty
working tree, or an untracked test file proves **one** thing: the tree is not the
recorded baseline. It does not prove the fact is unverifiable. A merged commit is
readable with `git show <sha>:<path>` from any checkout in the repository, and a
worktree created at that SHA makes it runnable.

The two situations must therefore be reported separately:

| Situation | Meaning | Handling |
| --- | --- | --- |
| The tree lags `origin/main` | provenance gap | cite `origin/main` or take the fact from the canonical worktree |
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
**left untouched**: no reset, no stash, no cleanup. It carries no evidence
obligation and must not be cited.

## Rules

1. Evidence cites the canonical worktree and a commit; never "the working tree".
2. A pull request that cites a new `origin/main` SHA updates the HEAD row above
   in the same pull request.
3. Ad-hoc worktrees, reviewer checkouts and the pre-freeze main checkout are
   `advisory only`. Their results may shape a question; they may not fill a cell.
4. This record does not create, extend or retire any milestone obligation. It is
   a precondition for citing evidence, not evidence.
