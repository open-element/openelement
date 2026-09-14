# Maintainers

## Ownership sources

Review ownership has exactly two sources, one owner per path. Neither may
defer to the other:

- **Repository-side (version-controlled):** [`.github/CODEOWNERS`](./.github/CODEOWNERS)
  routes review requests for the product packages, release tooling, CI
  workflows, and the SaaS security/payment/auth surfaces. Ownership changes
  land as CODEOWNERS changes in the same pull request.
- **External (not version-controlled):** GitHub repository rulesets and branch
  protection enforce required reviewers, required status checks, and
  exact-SHA CI. These settings live in GitHub and cannot be reviewed in a
  diff, so they must mirror CODEOWNERS.

The GitHub ruleset must name the same handle(s) as CODEOWNERS. If they
diverge, CODEOWNERS is the source of truth to fix first, then the ruleset.

## External pending

- **Conduct reporting channel:** the dedicated private conduct channel is not
  yet configured. The concrete private address or GitHub team must come from
  the maintainers and is the single external pending identity item.
  [SECURITY.md](./SECURITY.md) vulnerability reporting is security-only and
  must never be used for conduct reports.
- **Ruleset mirror:** GitHub-side required reviewers and checks are configured
  outside the repository; keep them aligned with CODEOWNERS.

Operational authority is exercised through protected branches and the
[release procedure](./docs/maintainers/releasing.md), not through committed
agent prompts or copied evidence.
