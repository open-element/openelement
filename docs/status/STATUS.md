# OpenElement status

Repository package line: `v0.44.0-beta.2.1`
npm registry line: `v0.44.0-beta.2.1` (prerelease, dist-tag `beta`)
Active release target: `v0.44.0-beta.2.1`
Latest landed train: `v0.44.0-beta.2.1`
Next planned train: `v0.44.0-beta.2.2`
The npm `latest` dist-tag stays stable at `0.43.3`; Stable `1.0.0` is unscheduled.

Execution follows [PROJECT_WORKFLOW.md](../governance/PROJECT_WORKFLOW.md).

Current version and publication facts are owned by
[release-state.json](../release/release-state.json) and the corresponding immutable
release records. Package manifests own source package versions.

The accepted development direction is Beta.2.1 Router/core, Beta.2.2
Native/Lit Framework Mode and Beta.2.3 dual-mode hardening/cleanup closure, followed by public 1.0 Alpha.
See [VERSION_PLAN.md](../current/VERSION_PLAN.md),
[ADR-0152](../adr/ADR-0152-product-router-and-alpha-convergence.md) and
[Project 3](https://github.com/orgs/open-element/projects/3) for scope and live work.
This planning update is not an implementation-completion or publication claim.

Historical v0.44 internal Alpha workspaces are complete; their evidence stays in
issues and release history. Upcoming public 1.0 Alpha is a separate release phase.
Existing exact-SHA CI, provenance, protected promotion and release GO requirements
continue under [RELEASE_POLICY.md](../governance/RELEASE_POLICY.md).

Public Alpha permits application-driven API/architecture iteration against identified
qualification rounds. RC admission follows that evidence, then freezes exact public
contracts/dependencies and requires at least fourteen days of soak plus upgrade/security
qualification and human GO. See the active plan; no RC date or Stable readiness is claimed.

The 2026-09-09 refinement makes Beta.2.2 tooling preparation executable and puts
qualified replacement deletion in Beta.2.3. Public Alpha actively pursues Oxc/TS7
adoption alongside real application upgrades; neither migration is claimed complete.
See the [maturation map](../architecture/alpha-maturation.md). Beta.2.1 scope and
existing alpha.1 admission requirements remain unchanged.
