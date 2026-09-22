# ADR-0156: Tree-SHA evidence reuse for the candidate gate

- Status: ACCEPTED (2026-09-22, alpha4 lane W — implements the owner-approved
  plan 1)
- Amends: none. Constrains the candidate evidence contract documented in
  `docs/maintainers/releasing.md`, which the aggregate and validator enforce.
- Tracking: [#1425](https://github.com/open-element/openelement/issues/1425)
  (the tree-identity observation this rests on),
  [#1436](https://github.com/open-element/openelement/pull/1436) (the lane that
  lands it).

## Context

The candidate gate proves a **commit** but measures a **tree**. Every job
record carries both (`sha`, `tree`); every log is bound to the tree by its
clean-proof line (`clean-proof PASS phase=… sha=… tree=…`); every tarball is
byte-hashed; the Site E2E sidecar is bound to the commit that ran the suite.
The identity audit requires all four job records to agree on one `sha` and one
`tree`, and the release workflow refuses to publish unless a green bundle for
the exact candidate SHA exists.

Two properties of the workflow make that contract stricter than the evidence it
protects:

1. **A squash sync, a rebase, or an amend that changes only the commit message
   produces a new SHA with the same tree.** The tree is what the suite
   measured; the commit is a label. GitHub's "up-to-date with base branch"
   rotation door makes this routine: every merge into `main` stales `dev`, and
   the sync commit that follows is content-identical to work already proven
   green.
2. **The suite is expensive.** Four lanes, ~1–2 hours of runner time, three
   browser engines, a real SSG build per packed consumer. Re-deriving proof for
   byte-identical content is the debt the alpha2/alpha3 sessions paid in CI
   queue time.

The gate is a proof obligation, not a ritual. If a package already proves tree
T, and the candidate's tree is T, the obligation for that tree is discharged.

## Decision

1. **The reuse key is the tree SHA, never the commit SHA.** This is the whole
   decision. Reuse is licensed by `git rev-parse HEAD^{tree}` equality, and by
   nothing about the commit graph: not ancestry, not the subject line, not the
   branch. A tree SHA covers exactly the tracked content the suite reads, so
   two commits that share it are the same input to every step.

2. **A single resolver decides once, for all four lanes.** The `reuse` job
   (`tools/repo/evidence-reuse.ts --resolve`) looks at this workflow's recent
   successful runs, newest first, and accepts one only when:
   - it is not the candidate commit itself (reusing our own run would skip the
     gate for the commit that is supposed to prove it);
   - it is inside the artifact retention window (a package GitHub has already
     expired cannot be downloaded, so it must not be reported as a source);
   - the API resolves its commit's tree through a **fresh lookup**, and that
     tree equals the candidate's;
   - it carries **every** lane's `evidence-*` artifact.

   One source run for all four lanes is required because the aggregate's
   identity check spans the bundle: splicing records from two runs would mean
   no single package ever proved the tree.

3. **Every failure resolves to "run the full gate".** No token, no `gh`, an API
   error, an unresolvable commit, a missing artifact, a run outside the
   window — the resolver reports `reused=false` and exits 0. The lanes then run
   their real gates. There is no partially-reused state: the lanes are gated on
   the decision as a whole, not per lane.

4. **The lane claims, and the claim refuses to lie.** After downloading the
   source artifact, `evidence-reuse.ts --claim` verifies that the record
   already binds **this** tree and the **resolved source commit**, and that its
   result is PASS. Only then does it add
   `reused: { runId, sha }` — and `sha` is the run that actually executed the
   gate, not the run that forwarded it (a re-reused package keeps its origin).
   A mismatch fails the lane rather than producing evidence the aggregate would
   have to reject.

5. **The aggregate re-derives the property it depends on.** It does not trust
   the resolver. For each job it still requires `tree == checked-out tree`, and
   it now:
   - audits the `reused` stamp's shape (`runId` positive integer, `sha` 40-hex,
     no extra fields);
   - refuses a stamp that names the candidate's own commit (that shape would
     let any lane skip its gate while claiming a real source);
   - refuses a stamp whose `sha` disagrees with the record's `sha`;
   - requires all reused jobs in the bundle to name **one** source run;
   - binds everything derived from a record's bytes — the clean-proof log
     lines, the argv, and the Site E2E `candidateSha` — to the record's own
     `sha`, which for a reused job is the source commit.

   The `tree` equality is what licenses the differing `sha`; the stamp is what
   explains it. Neither alone is accepted.

6. **The written evidence says what happened.** A bundle that replayed a
   package discloses it on the run (job summary) and in each replayed record's
   `reused` field; the aggregate's own artifact keeps proving the tree. A reader
   can always tell a replayed proof from a fresh one, and can follow the stamp
   to the run that produced it.

## Consequences

- **Warm-tree pushes stop re-deriving proof.** A sync, rebase, or message-only
  amend on a tree that already has a green package turns four lanes into a
  download, a verification, and a stamp. The saving is proportional to how
  often the tree is unchanged, which is exactly when a re-run teaches nothing.
- **A new failure surface exists and is fail-closed.** A bug in the resolver
  costs a full run (the wrong direction is cheap: the gate simply runs). A bug
  in the claim fails the lane. A bug in the aggregate would have to be
  simultaneous with a genuine tree-identity violation to matter, since the tree
  check is unchanged and still authoritative.
- **`gh` becomes a CI dependency of the PR layer.** The resolver needs
  `actions: read` and the `gh` CLI. It is fail-closed on its absence, so a
  token change costs CI time, never correctness.
- **The commit-level identity in the contract is now explicitly tree-level for
  replayed jobs.** The record keeps claiming the commit that ran; a reader who
  wants "which commit is this bundle for" reads the tree, and the bundle's
  top-level `sha` still names the candidate. This is a semantic narrowing of
  what `sha` means per job, recorded here because it is the one thing a future
  reader could misread as a regression.
- **Reuse does not lengthen the trust window.** The resolver's window is the
  artifact retention (14 days) and the validator's age check is unchanged: a
  stale package is still rejected on its own terms.
- **Ownership.** `tools/repo/evidence-reuse.ts` owns the resolver, the claim,
  and the stamp audit; `.github/actions/claim-reused-evidence` is the single
  wiring all four lanes share. The contract tests in
  `tools/repo/evidence-reuse.test.ts`, `tools/repo/candidate-evidence.test.ts`,
  and `tools/repo/check-ci-contracts.test.ts` pin the fail-closed branches, the
  aggregate's acceptance, the splice rejection, and the workflow structure, so
  a loosening fails a test instead of shipping.

## P7 four-question review

Per `docs/architecture/design-principles.md` P7, a change answers four
questions. This one is repository CI, not framework surface, so the answers are
about the gate rather than about application code — but they are answered the
same way, and question four is where the deviation (a new trust mechanism) has
to be named.

1. **Can the platform do this? (P1)** Yes, and the design is mostly platform:
   the reuse key is Git's own tree object, and the run→artifact mapping is
   GitHub's own artifact store, queried through `gh`. The tool contributes the
   comparison and the fail-closed branches; it does not maintain a registry of
   what ran. A checked-in `evidence-index.json` was considered and rejected
   precisely because it would be hand-maintained state beside a platform
   mechanism (P6).
2. **Can the cost be paid at compile/build time? (P2)** The decision is paid
   once per workflow run, in front of the lanes, and is a handful of API calls.
   Nothing moves into the application or the published packages: the packed
   artifacts, the runtime, and the public surface are untouched.
3. **If it must be runtime, does it read as platform code? (P3)** The gate's
   proof obligation is now stated in the terms the evidence actually uses
   (commits and trees), instead of a commit-only identity that demanded
   re-measurement of identical content. The resolver fails closed with an
   explicit reason on every path, which is the same contract the rest of
   `tools/repo` follows.
4. **Nearest prior art, and is our difference deliberate?** Build systems that
   key caching on content — Bazel/remote-execution action keys, Nix store
   paths, Turborepo/Nx content hashes, `actions/cache` keys — all establish the
   same property: **content-addressed inputs make a cached result valid for a
   different label.** The deliberate difference is scope and failure
   direction. This is a CI _proof_ cache, not a build cache: the artifact
   carries its own audit trail (per-step argv, log hashes, clean-proof lines,
   tarball hashes, the Site E2E sidecar), so the reused unit is verifiable
   rather than merely trusted, and the resolver refuses on any doubt instead of
   degrading to a partial hit. Prior art in this repository is the reverse
   direction taken knowingly: it already pins artifacts by SHA-256, so the tree
   key is the same discipline applied to the input side.

## Alternatives considered

- **Reuse keyed on a content hash of the changed paths.** Rejected: a tree SHA
  is exactly that hash, maintained by Git, and it covers the whole tracked
  tree — including files a path-filter would miss (root configs, lockfiles).
  Inventing a second key would add a way for the two to disagree.
- **Commit-message-scoped reuse (e.g. trust a `sync:` subject).** Rejected: it
  is a heuristic about intent, and the failure mode is skipping a gate on
  content that changed. The tree SHA is a fact about content.
- **Per-lane resolution.** Rejected: it makes a spliced bundle possible, and
  the aggregate's single-tree identity check would have to reject work the
  resolver declared reusable. One decision, one source run, no splice.
- **A checked-in `docs/release/evidence-index.json` mapping tree → run id.**
  Rejected as the primary mechanism: it is a second source of truth that a
  workflow must maintain (write, commit, resolve conflicts on every run), and
  its failure mode is a stale mapping pointing at expired artifacts. The `gh
  run` artifact chain already holds this mapping, maintained by the platform,
  and the resolver's freshness window makes a stale entry impossible.
- **Reuse at the aggregation step (accept a whole old bundle).** Rejected: the
  aggregate would then be publishing another run's artifact as this run's
  evidence without the lanes' participation, which hides the operation from the
  lane logs and puts the entire trust decision in one place with no independent
  claim.
