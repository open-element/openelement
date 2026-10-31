# OSPS Baseline Level 1 self-assessment

This document records OpenElement's self-assessment against the OpenSSF Open Source Project Security (OSPS) Baseline, version `v2026.08.28`, at Maturity Level 1 (`maturity-1`). It covers the active Level 1 assessment requirements with a status and evidence path for each. It is a maintainer self-assessment for downstream consumers, not a certification, an audit, or a claim of compliance; `Partial` rows identify controls whose evidence depends on settings outside the repository. Assessment date: 2026-10-29, against repository commit `5a170a5`.

## Source and scope

- Upstream catalog: [`ossf/security-baseline`](https://github.com/ossf/security-baseline), tag [`v2026.08.28`](https://github.com/ossf/security-baseline/releases/tag/v2026.08.28), commit `a26a7963f6fd098c1e82829322ec9e1196a4f294`.
- The repository path `ossf/osps-baseline` returns HTTP 404; the canonical repository is `ossf/security-baseline`. `raw.githubusercontent.com` was unreachable from the review environment, so the eight `baseline/OSPS-*.yaml` files were read through the GitHub REST API at the tag above.
- The tag contains 25 Level 1 assessment requirements. `OSPS-BR-01.02` carries `state: Retired` upstream and is excluded; the 24 active requirements are assessed below.
- Only controls actually retrieved are listed. No control ID or requirement text below was invented.

Status values: **Met** means evidence exists in the repository or was verified through the public GitHub API; **Partial** means some evidence exists but the control depends on repository or organization settings not visible in the tree; **Gap** means no evidence was found; **Not applicable** means the control's precondition does not hold for this project.

## Level 1 controls

| Control ID | Requirement (paraphrase) | Status | Evidence | Gap / next step |
| --- | --- | --- | --- | --- |
| OSPS-AC-01.01 | Require MFA for sensitive repository actions | Partial | No in-tree MFA evidence; [SECURITY.md](../../SECURITY.md) line 17 covers branch protection only, and MFA is an organization setting | Not verifiable from the repo; confirm and record org MFA enforcement |
| OSPS-AC-02.01 | Lowest-privilege default for new collaborators | Partial | No repository permission setting in the tree; GitHub defaults new collaborators to read | Not verifiable from the repo; record the organization base permission |
| OSPS-AC-03.01 | Block direct commits to the primary branch | Partial | [SECURITY.md](../../SECURITY.md) line 17 names protected branches as a required boundary | Declared in SECURITY.md, not verifiable from the repo; export the ruleset as evidence |
| OSPS-AC-03.02 | Require explicit confirmation to delete the primary branch | Partial | [SECURITY.md](../../SECURITY.md) line 17; deletion protection is a ruleset setting | Declared in SECURITY.md, not verifiable from the repo; export the ruleset as evidence |
| OSPS-BR-01.01 | Sanitize untrusted CI metadata before use | Met | [autoflow-release.yml](../../.github/workflows/autoflow-release.yml) lines 653-659 pass dispatch inputs through `env`; no PR title, body, or branch-name interpolation; actionlint runs in CI ([autoflow-ci.yml](../../.github/workflows/autoflow-ci.yml) lines 150-156) | None |
| OSPS-BR-01.03 | Untrusted code cannot reach privileged CI credentials | Met | PR jobs use `permissions: contents: read` ([autoflow-ci.yml](../../.github/workflows/autoflow-ci.yml) lines 67-68, 114-115); no `pull_request_target`; no `secrets.` anywhere under `.github`; CodeQL adds only `security-events: write` for SARIF upload ([codeql.yml](../../.github/workflows/codeql.yml) lines 28-31); publish requires `workflow_dispatch` plus the `openelement-release` environment ([autoflow-release.yml](../../.github/workflows/autoflow-release.yml) line 276) | None |
| OSPS-BR-03.01 | Official channels use encrypted transport | Met | README links and badge URLs are HTTPS; npm publishing sets `registry-url: https://registry.npmjs.org` ([autoflow-release.yml](../../.github/workflows/autoflow-release.yml) line 300) | None |
| OSPS-BR-03.02 | Distribution channel is authenticated against interception | Met | npm Trusted Publishing/OIDC ([SECURITY.md](../../SECURITY.md) line 16); `--provenance` on publish ([npm-publisher.ts](../../tools/release/npm-publisher.ts) lines 57-60) | None |
| OSPS-BR-07.01 | Prevent unencrypted secrets in version control | Met | gitleaks history scan in CI ([autoflow-ci.yml](../../.github/workflows/autoflow-ci.yml) lines 163-169); [.gitleaks.toml](../../.gitleaks.toml) | None |
| OSPS-DO-01.01 | User guides for basic functionality | Met | [getting-started.md](../../www/content/docs/guide/getting-started.md); README Quick Start | None |
| OSPS-DO-02.01 | Guide for reporting defects | Partial | [bug.yml](../../.github/ISSUE_TEMPLATE/bug.yml) issue form and [config.yml](../../.github/ISSUE_TEMPLATE/config.yml); no prose guide | Add a "Reporting a defect" section to [CONTRIBUTING.md](../../CONTRIBUTING.md) |
| OSPS-GV-02.01 | Public mechanism for proposed changes and usage obstacles | Met | Public GitHub Issues with issue forms under [.github/ISSUE_TEMPLATE](../../.github/ISSUE_TEMPLATE); GitHub Discussions enabled (verified through the GitHub API) | None |
| OSPS-GV-03.01 | Document the contribution process | Met | [CONTRIBUTING.md](../../CONTRIBUTING.md) covers workflow, gates, DCO, and release work | None |
| OSPS-LE-02.01 | Source license meets OSI or FSF definition | Met | [LICENSE](../../LICENSE) is MIT, an OSI-approved license | None |
| OSPS-LE-02.02 | Released-asset license meets OSI or FSF definition | Met | MIT; LICENSE present in every `packages/*/LICENSE` | None |
| OSPS-LE-03.01 | License in a well-known repository location | Met | [LICENSE](../../LICENSE) at the repository root | None |
| OSPS-LE-03.02 | License included with released assets | Met | `packages/*/LICENSE`; the package-graph gate requires `LICENSE` in each publish allowlist and on disk ([check-package-graph.ts](../../tools/release/check-package-graph.ts) lines 304, 395-408) | None |
| OSPS-QA-01.01 | Source repository publicly readable at a static URL | Met | `github.com/open-element/openelement` is public with default branch `main` (verified through the GitHub API) | None |
| OSPS-QA-01.02 | Publicly readable change history | Met | Public Git history on `main`; [CHANGELOG.md](../../CHANGELOG.md) aggregates user-visible changes | None |
| OSPS-QA-02.01 | Repository lists direct dependencies | Met | [package.json](../../package.json), [pnpm-lock.yaml](../../pnpm-lock.yaml), [pnpm-workspace.yaml](../../pnpm-workspace.yaml) | None |
| OSPS-QA-04.01 | Multi-repository projects list their codebases | Not applicable | Single repository; a pnpm monorepo with six published packages under `packages/` | None |
| OSPS-QA-05.01 | No generated executable artifacts in version control | Met | `git ls-files` shows no executables or compiled build output; build directories are ignored ([.gitignore](../../.gitignore) lines 31-33) | None |
| OSPS-QA-05.02 | No unreviewable binary artifacts in version control | Met | Four tracked binaries only: three test fixtures and one site image; provenance is recorded in [manifest.json](../../www/public/assets/manifest.json) | None |
| OSPS-VM-02.01 | Security contacts in project documentation | Partial | [SECURITY.md](../../SECURITY.md) line 7 gives private vulnerability reporting and response targets (line 9); no named contact or email | Add a maintainer handle or security email to SECURITY.md |

Tally: 17 Met, 6 Partial, 0 Gap, 1 Not applicable (24 controls).

## Known gaps

- `OSPS-AC-01.01`, `OSPS-AC-02.01`, `OSPS-AC-03.01`, and `OSPS-AC-03.02` depend on organization and repository settings that are not stored in the tree. [SECURITY.md](../../SECURITY.md) line 17 declares protected branches, but no MFA, permission-default, or deletion rule is in-tree; an owner with admin access should export the ruleset or record the settings so these rows can move to Met.
- `OSPS-VM-02.01` has a reporting channel and response targets but no named security contact. [.github/CODEOWNERS](../../.github/CODEOWNERS) refers to `MAINTAINERS.md`, which does not exist.
- `OSPS-DO-02.01` relies on the issue form alone; there is no prose description of how to report a defect.
- Four published packages (`create`, `element`, `router`, `ui`) omit the `license` field in `package.json`. LICENSE files ship, so `OSPS-LE-03.02` is met, but the npm metadata is inconsistent.

## How to re-run this review

1. Pin the upstream tag and commit (`v2026.08.28`, `a26a7963f6fd098c1e82829322ec9e1196a4f294`) and read the eight `baseline/OSPS-*.yaml` files at that ref. If `raw.githubusercontent.com` is blocked, use the GitHub REST API.
2. Select assessment requirements whose `applicability` includes `maturity-1` and whose `state` is not `Retired`. Do not carry statuses forward across tags; re-check each evidence path.
3. Re-run the Markdown lint check used by the repository:

From the repository root:

```sh
./node_modules/.bin/markdownlint-cli2 docs/security/osps-baseline-l1.md
```

Upstream control text can change between releases; record the tag, commit, and assessment date whenever this document is refreshed.
