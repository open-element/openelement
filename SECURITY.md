# Security policy

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/open-element/openelement/security/advisories/new), not a public issue or discussion. Include the affected package and version, reproduction steps, impact, and any proposed mitigation.

Maintainers aim to acknowledge reports within five business days and provide a status update within ten business days. The latest stable release is supported; prerelease code may change before stable.

## Repository controls

- Dependency review and CodeQL run on repository changes.
- Gitleaks scans Git history for committed credentials; actionlint and zizmor validate workflow syntax and security.
- Secret names in workflows are not credentials. A real leaked value requires rotation or revocation first; deleting HEAD alone does not remove exposure.
- npm publication uses Trusted Publishing/OIDC. Long-lived publication tokens are not an authorized release path.
- Protected branches, human review, exact-SHA CI, artifact checks, and independent release verification are required boundaries.

Do not rewrite Git history during ordinary cleanup. Any history rewrite requires a separately authorized incident plan because it changes SHAs and affects collaborators and forks.
