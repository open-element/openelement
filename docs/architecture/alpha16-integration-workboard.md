# Alpha16 integration workboard

Status: **coordination record**. It is not milestone evidence, not an
acceptance change, and not a private-contract candidate. It does not amend the
execution plan, the progress ledger, the semantic test matrix, any ADR, source,
tests, or CI. Division of labour below is scheduling, not an exit record.

Stage authority remains the
[execution plan](./alpha16-18-execution-plan.md). Where that plan's table,
prose, and ASCII spine disagree, every constraint is kept. This file does not
pick a winner.

## 1. Read

`origin/main` fetched 2026-11-09 17:52:25 +0800 (2026-11-09T09:52:25Z):

[`c70dc8d0a3d620fbfcb7d10485f6de0a6900cd91`](https://github.com/open-element/openelement/commit/c70dc8d0a3d620fbfcb7d10485f6de0a6900cd91)

Subject: `test(compiler): Alpha16a M06b2b — children-projection + unkeyed evidence; M06 complete (#1744)`.
This SHA was fetched for this revision. The progress ledger's header still
names `5649d9770`; that header is not this read.

M07a head, re-read at the same instant, unchanged:
[`94a87a3691e5fafe4ed9c4f697c3523919467cf1`](https://github.com/open-element/openelement/commit/94a87a3691e5fafe4ed9c4f697c3523919467cf1)
on `cursor/m07a-leaf-claim-21d0`, PR
[#1745](https://github.com/open-element/openelement/pull/1745).
State OPEN, MERGEABLE, merge state BLOCKED, `updatedAt` `2026-11-09T09:28:06Z`.
Checks at the re-read: `test` FAILURE; lint, e2e, pack, CodeQL, and sha-guard
SUCCESS. The cited architecture files in §3 have an empty diff against
`c70dc8d0`. `lifetime-scope.ts`, `error-dialect.test.ts`, and
`runtime-disposal.test.ts` also have an empty diff between the two SHAs.

The ledger at `c70dc8d0` records M01–M06 met, G1/G2 signed on 2026-11-09, and
M07–M14 not started. Its closing sentence is that the Alpha16a exit is not
achieved. This file does not re-run those suites and does not re-judge those
rows.

Ledger drift kept as drift:

- Header baseline `5649d9770` is older than the body and older than this read.
- The M06b2b cell cites evidence head
  `241c1eef702c83bfe298e1fdaa93503042f127e6` and says the squash SHA is pinned
  by the next slice. GitHub has that commit (2026-11-09T06:09:50Z). PR #1744's
  merge commit is `c70dc8d0`; its pre-merge head is
  `05652b48285b538984f84be03f755505ce24f7c5`. This file does not retarget the
  ledger.

## 2. Adjudications already made

These readings apply the existing contract. They do not add a gate, a matrix
cell, or a dispose mode. Development owns the source repair. This document
does not edit it.

### 2.1 Bare `Error` on the M07a head — must fix, existing dialect

[`recipe.ts` L278](https://github.com/open-element/openelement/blob/94a87a3691e5fafe4ed9c4f697c3523919467cf1/packages/element/src/internal/compiled/runtime/recipe.ts#L278)
is `throw new Error(...)` for `OEIR_LEAF_CLAIM_UNAVAILABLE`. That line is absent
from `recipe.ts` at `c70dc8d0`.

[`error-dialect.test.ts` L85–L96](https://github.com/open-element/openelement/blob/c70dc8d0a3d620fbfcb7d10485f6de0a6900cd91/packages/element/__tests__/error-dialect.test.ts#L85-L96)
already requires every throw under element `src/` to construct an
`OpenElementError` with a catalogued code. The test file is unchanged at
`94a87a36`. The standard stays.

QA report, not re-run here: Node 24.22.1, element 1 failed / 760 passed. CI on
the same SHA under Node 24.18.0 has the same failure. The previously observed
job is
[run 42593654180 / job 129081052095](https://github.com/open-element/openelement/actions/runs/42593654180/job/129081052095).
The 17:52 re-read still shows `test` FAILURE and the same head. Development
repairs this on the M07a line. This docs change does not.

Generated `throw new Error` text inside the compiler's emitted claim strings is
outside that AST scan. Diagnostic identity for those strings stays with the
private-contract candidate in §3. It is not folded into this must-fix.

### 2.2 Claim failure — two phases, not whole-claim byte rollback

Existing mount failure and M07a claim failure are different obligations.

Mount, already required. [§4.1b](./jsx-value-and-children-model.md) disposes a
failed setup with detach so a partial created range does not survive. At
`94a87a36`,
[`rollbackProjection`](https://github.com/open-element/openelement/blob/94a87a3691e5fafe4ed9c4f697c3523919467cf1/packages/element/src/internal/compiled/runtime/recipe.ts#L173-L175)
calls `dispose(true)`. That rule is about nodes the setup created. It is not a
rule that a claim must restore every byte on a borrowed server node.

Claim, as distinguished for M07a:

| Phase | Obligation already used for review | Not an obligation |
| --- | --- | --- |
| Validate | Zero DOM writes and zero subscriptions before activation | — |
| Activate failure | Roll back resources (subscriptions). Do not delete borrowed nodes | Restoring dynamic writes that already landed |

The generator at `94a87a36` emits the structural walk before dynamic writes
([`emitClaimFunction`](https://github.com/open-element/openelement/blob/94a87a3691e5fafe4ed9c4f697c3523919467cf1/packages/compiler/src/internal/compiler/semantic-ir/generated-leaf/generate.ts#L2104-L2123)).
[`emitClaimSlot` L1945–L1963](https://github.com/open-element/openelement/blob/94a87a3691e5fafe4ed9c4f697c3523919467cf1/packages/compiler/src/internal/compiler/semantic-ir/generated-leaf/generate.ts#L1945-L1963)
writes, then subscribes.
[`rollbackClaim` L254–L259](https://github.com/open-element/openelement/blob/94a87a3691e5fafe4ed9c4f697c3523919467cf1/packages/element/src/internal/compiled/runtime/recipe.ts#L254-L259)
calls `dispose(false)`.
[L291–L298](https://github.com/open-element/openelement/blob/94a87a3691e5fafe4ed9c4f697c3523919467cf1/packages/element/src/internal/compiled/runtime/recipe.ts#L291-L298)
registers the range cleanup only after `recipe.claim` returns. PR #1745's text
pairs "pre-existing DOM stays" with "cannot delete the pre-existing nodes".

TSX-18's written failure negative is "a failed claim must not double-subscribe".
Bounded recovery is named. Whole-claim byte restoration is not. Promoting that
restoration into a gate would be a public semantic change and is not adopted
here. QA's partial-write observations (an unsafe href rejected before a later
`data-n` write; a subscribe throw after an earlier dynamic write) match
resource rollback. They are not a miss against a byte-atomic gate.

### 2.3 Dispose mode — first call wins

[`LifetimeScope.dispose` L100–L123](https://github.com/open-element/openelement/blob/c70dc8d0a3d620fbfcb7d10485f6de0a6900cd91/packages/element/src/internal/compiled/lifetime-scope.ts#L100-L123)
returns immediately once `#disposed` is set, and runs range cleanups only for
the flag on that first call. The same text is at `94a87a36`.

[TSX-27](./tsx-author-candidate-contract.md) says a second dispose is a no-op,
and that children inherit detach or non-detach from the parent call that
disposes them. [§4.1a](./jsx-value-and-children-model.md) says the default
`dispose()` behaviour is not changed to make an example work.

G2 already pins the observable, at `c70dc8d0` and therefore at `94a87a36`:

- [`runtime-disposal.test.ts` L63–L75](https://github.com/open-element/openelement/blob/c70dc8d0a3d620fbfcb7d10485f6de0a6900cd91/packages/element/__tests__/compiled-runtime/runtime-disposal.test.ts#L63-L75):
  `dispose()` then `dispose(true)` does not remove the region.
- [L78–L104](https://github.com/open-element/openelement/blob/c70dc8d0a3d620fbfcb7d10485f6de0a6900cd91/packages/element/__tests__/compiled-runtime/runtime-disposal.test.ts#L78-L104):
  a direct `dispose(true)` removes it.
- [L154–L156](https://github.com/open-element/openelement/blob/c70dc8d0a3d620fbfcb7d10485f6de0a6900cd91/packages/element/__tests__/compiled-runtime/runtime-disposal.test.ts#L154-L156):
  parent `dispose(true)` removes children that are still live.

A later `true` that does not upgrade a completed `false` is the current
contract, not a defect. A parent `true` does not upgrade a child that already
finished `dispose(false)`, because that child's dispose has already returned.
Changing this to an upgrade would change TSX-27 and G2. That change is not
adopted.

## 3. M07/M08 private-contract candidate — pending review

The marker/order protocol is still OPEN in the authority text. Checked at
`94a87a36`, empty diff against `c70dc8d0`:

| Citation | What the text does |
| --- | --- |
| [`m02-semantic-ir-feasibility.md` L183](https://github.com/open-element/openelement/blob/94a87a3691e5fafe4ed9c4f697c3523919467cf1/docs/architecture/m02-semantic-ir-feasibility.md#L183) | OPEN-4. Ordered-insertion marker protocol remains OPEN. The marker/key/seed/recovery chain is M07 (leaf) and M08 (stateful SSR→claim). |
| [`compiler-ir-and-abi-boundary.md` L371–L381](https://github.com/open-element/openelement/blob/94a87a3691e5fafe4ed9c4f697c3523919467cf1/docs/architecture/compiler-ir-and-abi-boundary.md#L371-L381) | Example 11.5 names markers, permitted seed, and build identity. L381 leaves the repeated-insertion marker protocol Open. |
| [`jsx-value-and-children-model.md` L553–L568](https://github.com/open-element/openelement/blob/94a87a3691e5fafe4ed9c4f697c3523919467cf1/docs/architecture/jsx-value-and-children-model.md#L553-L568) | The mode table is one possible shape, not a mandate. The marker protocol does not exist yet. |
| [`execution plan` L267](https://github.com/open-element/openelement/blob/94a87a3691e5fafe4ed9c4f697c3523919467cf1/docs/architecture/alpha16-18-execution-plan.md#L267) | R4 says to design that protocol in M07/M08. The "Owner decision?" cell stays `No`. This file does not edit it. |

The same OPEN statement is repeated in execution-plan §1a criterion 3, the TSX
contract §5 item 3, compiler-ir §15 items 2 and 4, current-reality O-3, and the
semantic-matrix claim-chain paragraph. Repetition is not a specification.

The withdrawn conditional M07b allowance (implement from "existing"
marker/order plus static seed, with failure having no side effects) does not
take effect. M07b is not an approved implementation slice.

What is in progress is a **joint M07/M08 private-contract candidate**.
Development is drafting it. QA has already given development the
counterexamples. Status of that candidate: **pending review**. It is not
approved and not implemented. This docs PR does not write the candidate and
does not choose encodings, field names, or diagnostic codes.

The candidate is the place where the team recommends the ordinary internal
format and where technical lead and QA review that recommendation. The items
the draft has to cover are:

- marker start, end, and order identity;
- seed fields, and which differences are permitted;
- diagnostic identity and source location for mismatch;
- the agreement between the SSR producer and the Claim consumer;
- the §2.2 split, already adjudicated: validate writes nothing and subscribes
  to nothing; activate failure rolls resources back and does not delete
  borrowed nodes.

Review accepts or returns that recommendation. It does not wait for the user
to invent each internal field, and it does not treat an empty list as the
contract. A proposal that would change an already recorded public behaviour is
reported separately and is not slipped into the internal format. The behaviours
already closed in §2 are in that class: whole-claim byte restoration as a new
gate, and upgrading a completed `dispose(false)` to `dispose(true)`.

M07c (key, dynamic structure, duplicate subscription, cleanup) and M07d
(property, focus, bounded recovery, TSX-18/30) remain developer labels. They
are not an approved design. The execution plan still places key alignment,
permitted seed, bounded recovery, and duplicate-subscription accounting on the
one M07 leaf chain, and the same chain on the stateful list on M08. Those names
are not new milestones, and they are not a licence to implement ahead of the
reviewed candidate.

## 4. Who writes what

Reported ownership. QA writes no repository file, so QA does not countersign
paths.

| Role | Writes | Does not write |
| --- | --- | --- |
| Technical lead | this file | execution plan, ledger, matrix, ADRs, source, tests, CI, the private-contract candidate |
| Development | `packages/compiler/src/internal/compiler/semantic-ir/generated-leaf/**` and the co-located compiler tests; `packages/element/src/internal/compiled/runtime/recipe.ts`, the internal barrels that export it, and compiled-runtime tests; SSR-generation internal files only when a reviewed contract requires them; the private-contract candidate now being drafted; progress ledger and semantic matrix when a slice lands evidence. Implementation branches, including the §2.1 repair. | this workboard; an unreviewed encoding presented as accepted |
| QA | no repository path. Fixed-HEAD read-only review and temporary adversarial tests. Raw output stays in artifacts. | source, tests, docs, CI config |

## 5. Branch integration

| Branch | Rule |
| --- | --- |
| `cursor/m07a-leaf-claim-21d0` @ `94a87a36` | Stays for QA. Do not move this head to absorb a fix or a later slice. The §2.1 repair lands on a development branch that development owns. |
| A later M07/M08 implementation branch | A new branch. If it continues from the M07a acceptance point, it names `94a87a36` as its base. It does not rewrite the QA branch. It does not start M07b implementation before the §3 candidate is reviewed. |
| This docs branch | One new file, `docs/architecture/alpha16-integration-workboard.md`, based on `c70dc8d0`. No other path. Not merged and not published by this record. |
| `main` | Not a commit target for this work. |

Ledger and matrix updates ride with the evidence-bearing slice, not with this
docs PR. Alpha17 and Alpha18 are outside this workboard.

## 6. Evidence grades

A grade describes what a result may support. It does not close a row by itself.

| Grade | Meaning | May support | May not support |
| --- | --- | --- | --- |
| Exit | Plan exit evidence at a recorded SHA, with command and result, per the ledger rules | an M-row the plan's exit text names | a later head, a different milestone |
| Independent QA | Fixed-HEAD read-only review. Node `>=24.2` (root `package.json` on `c70dc8d0`). Artifacts outside the repo | the checks that review names, at that SHA | a repository edit, an M-row flip |
| CI | A named job at a named SHA | that job's conclusion | browser qualification, M13, an M-row exit |
| Local self-test | Development's own run | a defect report or a repair iteration | independent pass |
| This file | Coordination | scheduling and the §2 readings | any M-row, G1/G2, or release claim |

Recorded self-tests, not independent passes: Node 24.18.0, 5 + 93 passed, at
`94a87a36`; the PR body's earlier 98 on Node v22.23.4. QA's 1-failed / 760-passed
element run is an independent fail of §2.1, not an M07 exit.

## 7. Dependencies

Checked against execution plan §1. The ASCII spine is retained beside the
table in §8.

| ID | Depends on | Exit the plan names | Sign-off now |
| --- | --- | --- | --- |
| Alpha16a exit | M01–M08 with G1 and G2 recorded | no public version, tag, or publication | not met: M07 and M08 are open |
| M07 | M05 | leaf claim fidelity on one chain: marker/order, key alignment, permitted seed, bounded recovery, duplicate-subscription accounting. TSX-18 and TSX-30 are the ledger rows | not met. §2.1 blocks #1745. §3 candidate is pending review |
| M08 | M06 and M07 | the same stateful list across SSR → claim → update → dispose | not met. Does not absorb the leaf chain, and does not gain an SSR format from this file |
| M09 | M05 only | generated Native Custom Element boundary. Not a class adapter. Hostless components stay hostless | not started. **May be prepared beside M07.** Does not gate 16a. Starting it is not signing it |
| M10 | M05–M09, five proofs | browser runtime, server runtime, build/SSG, ABI/module, public API | not started. A checklist is not completion |
| M10a | M05 | early packed smoke, non-gating | not S3 and not question 4 |
| M11 | M08 and M10 | generated-path Router integration; Framework Mode unchanged | waits on both predecessors |
| M12 | M06, M08, and M11 | packed full slice, no aliases, no library TSX | final gate. M10a is not this gate. The ASCII M10→M12 edge is kept as well |
| M13 | M09–M12 and M14 | three engines and server qualification at an exact SHA | final gate. Server suite and command are unnamed in §9 |
| M14 | M02 | async server components, full-await. Not Alpha18 defer | **May be prepared beside M05–M11.** Does not gate 16a. Does feed M13 |

## 8. Contradictions kept on purpose

| Topic | Constraint A | Constraint B | Scheduling consequence |
| --- | --- | --- | --- |
| M10 start | Table and prose: not before M05–M09 | ASCII draws M10 off M05 | Do not start M10. Preparation of the five proofs is not a start |
| M11 inputs | Table: M08 and M10 | ASCII draws M08 → M11 without M10 | Wait for both named predecessors |
| M12 inputs | Table: M06, M08, M11 | ASCII draws M10 → M12 | Keep both edges. M10a does not sign M12 |
| Spine membership | Prose spine omits M03 | Next sentence puts M03 on the spine because M05 needs it | M03 stays recorded met. This file does not reopen it |
| Consumer timing | ADR-0174: start the consumer slice once the list foundation exists | Plan: M10a may use a smaller artifact after M05; S3/M12 need the stateful list after M11 | Smoke may be prepared. It is not question 4 and not S3 |
| Claim parity | Plan: M07 proves the leaf chain; M08 proves the list | Model L561–L564: the missing marker protocol is not claimed until the same list passes three modes | Leaf notes do not close the protocol or M08 |
| R4 | "Owner decision?" is `No` | Internal format is a team recommendation under review; a public behaviour change is reported separately | Do not edit R4. Do not choose the encoding here |
| Next work | Ledger: next planned work is M07 → M08 | Plan: M09 and M10a are parallel after M05 and do not gate 16a; M14 is parallel after M02 | M09 and M14 preparation may proceed. That is not an exit |

## 9. Still unnamed — this file does not invent them

1. **Per-row M07 versus M08 matrix cells.** The matrix marks phases for TSX-18
   and TSX-30. Acceptance areas 13–15 name milestones. No document assigns each
   `R` cell to M07 or to M08.
2. **Identity of "the same stateful list".** S2, S3, M08, and M12 require one
   list. No fixture path or SHA is named as that list. M06's recorded scenarios
   are not promoted into it.
3. **M13 server-matrix suite and command.** Area 20 says "cross-engine column
   plus server matrix". No Alpha16 document names the suite or the command.
   Current-reality's `packages/element#browser:gate:full` is the present
   release-train browser gate. It is not adopted as the M13 server matrix.

The marker/seed/diagnostic/producer items are not in this unnamed list. They
belong to the §3 candidate, which development is drafting for review.

## 10. Order of the claim work

1. Leave `94a87a36` available for QA. The §2.1 failure is a must-fix on the
   development line. Local 5+93 and the earlier 98 are not an independent pass
   and not an M07 exit.
2. Development continues the §3 candidate. Technical lead and QA review it
   when it arrives. This file is not that review.
3. M07b implementation stays unscheduled until that review accepts a candidate.
   M07c and M07d are not approved slices.
4. The M07 plan exit remains the whole leaf chain. Steps 1–3 do not meet it.
5. M08 stays dependent on M06 and on an M07 exit. It is the stateful
   SSR → claim → update → dispose proof. Its list identity is §9 item 2.

Beside that order, M09 may be prepared from M05, and M14 may be prepared from
M02. Neither preparation signs its exit, and neither signs Alpha16a.

## 11. Stop points

Stop rather than inventing a path when:

- an implementation needs an encoding the §3 candidate has not had reviewed;
- M07b, M07c, or M07d is treated as already approved;
- a change would add whole-claim byte restoration or dispose-mode upgrade as a
  gate;
- SSR and claim of the same list diverge, once that list has an identity;
- a child has more than one live owner;
- props evaluation moves off the approved per-read contract;
- a packed consumer needs source or a workspace alias;
- two runtime copies appear across an ownership boundary;
- a safety fixture fails;
- M10 unreachability would require weakening a guarantee;
- this file, a local test count, or a green CI job is offered as an M-row exit.

Rollback boundaries in the plan stay in force: reverting a future claim
implementation reverts claim only and is not a Part Program decision; no
version, tag, or publication exists before M13.

## 12. Not verified here

- No suite was re-run. The 5+93 and 98 counts were not reproduced.
- QA's element fail is recorded as QA's report. The 17:52 check re-read confirms
  `test` FAILURE at the same head; the job log was not downloaded again.
- M01–M06 and G1/G2 were read from the ledger. They were not re-executed.
- Ancestry of `241c1eef7` inside `c70dc8d0` was not established locally.
- The §3 candidate had not arrived, so it was not reviewed.
- No source, test, ledger, matrix, or CI file was edited.
