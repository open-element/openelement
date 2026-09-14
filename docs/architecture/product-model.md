# Product model

OpenElement has exactly two public core products: **Element** and **Router**.

| Product | Responsibility                                                                                                                 | Independent boundary                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Element | Compiled Custom Elements, reactivity, lifecycle, server serialization, fresh DOM, and existing-DOM claim/update                | Installs, builds, and runs without Router                              |
| Router  | Route selection, HTTP semantics, navigation, loaders/actions, Document resolution, and Native/Lit Framework Mode orchestration | Route Mode runs without Element; renderer integrations remain explicit |

A standard Custom Element is the durable component boundary. JSX is compiled input, not a public runtime virtual-DOM contract. Explicit and file-generated routes share one route authority; URLPattern owns pattern syntax while Router owns ordered winner selection, method dispatch, cancellation, and application outcomes.

The `create` package is the supported creation entry for the two core products. `packages/ui` is an experimental product maintained in this repository outside the 1.0 stable promise. `apps/site` is the official product surface. `apps/saas` is an independent first-party application in this repository, governed separately from the Alpha repository candidate; it is not a core product, not a public package, and not part of the Alpha repository GO criteria. Neither Site nor SaaS extends the Element/Router stable API promise, but both are owned and maintained by this repository.

`1.0.0-alpha.1` establishes a new public baseline. Historic pre-1.0 APIs do not create compatibility obligations unless a durable external data, protocol, security, or explicitly promised contract requires one.
