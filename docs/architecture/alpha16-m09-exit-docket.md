---
status: historical
topic: M09 interoperability, manifest and qualification decisions
summary: The three scope decisions approved in November 2026 and their public qualification contracts.
---

# M09 qualification decisions

On 2026-11-14 the maintainer approved these decisions in
[PR #1793](https://github.com/open-element/openelement/pull/1793).

| Decision | Public contract |
| --- | --- |
| Third-party interoperability | Qualify generated custom elements in the existing Web Component interoperability corpus. Check connection lifetime, foreign-tag registration and server rendering at the consumer boundary. |
| Component manifests | Produce the standard Custom Elements Manifest from the generated component declarations. Retain the schema check and the packed-artifact consumer test. |
| Capability sign-off | Track the capabilities as they land. Sign off after production-equivalent replacements exist and the final-revision matrix is complete. |

The [capability inventory](./alpha16-capability-inventory.md) carries the
qualification requirements. The [closeout report](./alpha16-closeout-report.md)
records delivered capabilities and outstanding work. The
[original docket](https://github.com/open-element/openelement/blob/fc55986d7966da2c2e67cae253e536ca4b898e6e/docs/architecture/alpha16-m09-exit-docket.md) preserves the signed decisions and evidence at the time.
