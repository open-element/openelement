# openElement AutoWorkflow

Current source package line `v0.44.0-beta.2.1`;
npm registry line `v0.44.0-beta.2.1` (prerelease, dist-tag `beta`).

> Status: Mandatory project workflow. Every human maintainer and AI assistant
> must read this document before planning, implementing, reviewing, or releasing
> work in this repository.

## Goal

AutoWorkflow turns project management into repository evidence. A change is not
complete because an issue, chat message, or SOP says it is complete. It is
complete only when the repository contains the decision, the execution package,
the implementation, and the gates that prove the claim.

Current execution direction is owned by
[VERSION_PLAN.md](../current/VERSION_PLAN.md) and
[ADR-0152](../adr/ADR-0152-product-router-and-alpha-convergence.md): Beta.2.x
convergence -> public 1.0 Alpha -> evidence-gated RC/Stable. Actual version and
publication facts remain in `docs/release/release-state.json`.

The core products are Element and Router. UI is dogfood and a reference implementation. Supporting packages are not additional
product lines. Cleanup is part of every replacement, beginning in Beta.2.1.
Historic v0.44 Alpha workspace instructions do not govern public 1.0 Alpha.

## Required Reading Order

Read these files before starting work:

1. `docs/governance/PROJECT_WORKFLOW.md`
2. `docs/status/STATUS.md`
3. `docs/roadmap/ROADMAP.md`
4. the active version plan under `docs/current/VERSION_PLAN.md`
5. relevant ADRs listed by the version plan

For v0.44 Alpha execution, read
`docs/governance/V044_ALPHA_WORKSPACE_SOP.md` and
`docs/current/v0.44.0-EXECUTION-PLAN.md`. The three-role
`docs/governance/V044_AGENT_LOOP_SOP.md` begins at Beta.1. Also read
`docs/governance/V044_ISSUE_SOP.md` before updating GitHub state. From Beta.1,
`docs/governance/GOVERNANCE_CONSTITUTION.md` freezes the semantic-ownership,
duplicate-justification and contribution rules that audits and reviews cite.

If these documents disagree, stop and fix the documents before changing product
code. The workflow is part of the product contract.

## Document Roles

| Layer       | Location                   | Purpose                                                                 |
| ----------- | -------------------------- | ----------------------------------------------------------------------- |
| Governance  | `docs/governance/`         | Mandatory process and release rules                                     |
| Status      | `docs/status/STATUS.md`    | Current truth, active line, and release gate order                      |
| Roadmap     | `docs/roadmap/`            | Version sequence and product direction                                  |
| ADR         | `docs/adr/`                | Architectural decisions and irreversible trade-offs                     |
| VersionPlan | `docs/current/`            | Active version contract: goals, tasks, verification                     |
| Changelog   | `CHANGELOG.md` (repo root) | Aggregated history only; not re-synchronized release by release         |
| Release     | `docs/release/`            | Authoritative per-release record after local and remote gates are green |

## Active Version Plan

Every minor version must have an approved active version plan before
implementation starts. ADR-0101 consolidates release planning into one current
plan under `docs/current/`.

Required sections:

- objective and scope;
- non-goals;
- tasks;
- acceptance;
- test matrix;
- release evidence requirements.

## Execution Rules

- Start from repository evidence, not memory or chat history.
- Keep one public contract for each surface.
- Keep one renderer pipeline and one metadata/source-of-truth.
- Remove duplicate or obsolete code instead of adding compatibility shims.
- Do not claim a version-plan item is complete without a code, docs, test, or
  gate proof.
- Under ADR-0147, each internal Alpha workspace has one end-to-end agent and
  alpha.8 is the sole integration workspace. Under ADR-0146, beginning at
  Beta.1, the thinker owns planning/review, the implementer owns implementation,
  and a fresh release verifier owns candidate closure. One Beta-or-later role
  may not silently assume another role's authority.
- Do not bump packages until local gates for the version pass.
- For v0.41.0 and later, npm publish is a release exit gate. See ADR-0108.
- AutoFlow may automate patch-level mechanical work only when ADR-0101 policy
  checks prove there is no public API, package topology, minor/major roadmap,
  runtime-default, security, auth, database, or release-policy impact.
- AutoFlow must not decide minor, major, or v1 scope. Those require human ADR
  and approved version-plan evidence.
- Do not merge `dev` to `main` until `dev` CI is green.
- Do not tag until `main` CI is green.

## Pull Request Workflow

Every PR must identify:

- target version and active version plan;
- ADRs added or changed;
- version-plan tasks completed;
- local commands run;
- CI status;
- release-document impact.

If the change is architectural, add or update an ADR. If the change affects a
planned version, update the active version plan in the same PR.

## Release Workflow

Use this order for a minor release:

1. complete implementation against an ADR-backed, human-approved version plan;
2. update current docs and website content;
3. run local gates in `docs/status/STATUS.md`;
4. bump all packages only after implementation gates pass;
5. write changelog and release note;
6. run release gates including publish dry-run;
7. push `dev`;
8. wait for all `dev` CI jobs;
9. promote the exact accepted SHA to `main` through the protected release workflow;
10. wait for all `main` CI jobs;
11. create and push the release tag;
12. publish the GitHub release note;
13. let the npm publish workflow run, or trigger local/CI publish manually;
14. close the version only after npm publish and post-publish npm consumer smoke
    evidence pass, unless a new ADR records an explicit exception.

For v0.41.0 and later, npm package visibility and post-publish npm consumer
smoke are release evidence, not telemetry. A version line is not closed until
the status, roadmap, release checklist, release note, and public README files
record the npm outcome truthfully.

Dist-tag policy (#607): prerelease publishes tag only their line
(`alpha`/`beta`/`rc`). **`latest` always tracks the last stable release** so
`npm install @openelement/*` never lands on alpha by default. Consumers who
want the alpha train use `@alpha` or an exact version. Stable publishes keep
npm's default `latest` tag. `tools/verify-npm-release.ts` asserts
`dist-tags.<prerelease>` for alphas and `dist-tags.latest` for stables.

## Automation Gates

`deno task workflow:check` verifies that the workflow itself remains visible and
that the active version plan has the required shape. AutoFlow3 is the single
gate and evidence control plane for hooks and CI.

Gate ownership (#1230): `tools/autoflow/policy.ts` is the machine-readable gate
registry — each gate names exactly one deno task, and each task names its owning
script. Generic toolchain concerns (format, lint, type graph, Markdown
structure, secret content, workflow lint/security) are owned by the pinned OSS
tools themselves and wired as plain CI steps and git-hook calls (ADR-0144), not
as AutoFlow gates. Registry integrity — every gate resolving to an existing
task, and no two gates sharing one command — is asserted in
`tools/autoflow/__tests__/policy.test.ts`, so this document deliberately does
not duplicate the gate list.

Dependency policy (#1233): pin style, lockfile discipline, update cadence and
the validation-library boundary are recorded in
`docs/governance/DEPENDENCY_POLICY.md`; its enforcement gates live in the
registry above like every other gate.
