# Security and release engineering

Generic checks are delegated directly to mature tools: gitleaks, CodeQL, dependency review, actionlint, zizmor, Deno formatting/lint/typechecking, and Markdown lint. OpenElement-specific tests remain only for Element/Router semantics, package artifacts, browser/server graphs, and release state.

A release is bound to one exact candidate SHA. Required CI, human review, a fresh independent verifier, Trusted Publishing/OIDC, package provenance, and explicit maintainer approval establish release trust. Git tags preserve pre-1.0 source history; GitHub Releases begin with `1.0.0-alpha.1` and release tooling must work with no older Release objects.
