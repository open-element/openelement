# ADR-0110: Element and Router product doctrine

- Status: ACCEPTED (reconciled for `1.0.0-alpha.1` on 2026-09-11)
- Supersedes: earlier product-count and UI-as-product descriptions

## Decision

OpenElement has exactly two public core products:

- **Element** owns compiled Web Component authoring, Part Programs, server serialization,
  browser creation, DOM claim, updates, lifecycle, and interoperability.
- **Router** owns explicit Route Mode and file-based Framework Mode, including request/data/form,
  document, navigation, SSR/SSG, and Native or Lit rendering integration.

`@openelement/router` is the public Router package. `@openelement/adapter-vite` remains a temporary
support package while its Element compiler and Router application responsibilities move to their
owners. `@openelement/create` remains the independent bootstrap package.

UI systems, showcase applications, hosted sites, Reader/Mastodon applications, SaaS reference
applications, deployment control planes, and repository automation are not public core products.
They may live in independent repositories and consume published artifacts.

## Consequences

- Public documentation and package metadata name Element and Router first.
- A support package needs a concrete build, distribution, or onboarding owner.
- Product qualification uses isolated packed consumers, not in-workspace showcase code.
- Historic product matrices remain available through Git history and the decision index only.
