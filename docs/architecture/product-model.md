# Product model

OpenElement has exactly two public core products: **Element** and **Router**.

| Product | Responsibility                                                                                                                 | Independent boundary                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Element | Compiled Custom Elements, reactivity, lifecycle, server serialization, fresh DOM, and existing-DOM claim/update                | Installs, builds, and runs without Router                              |
| Router  | Route selection, HTTP semantics, navigation, loaders/actions, Document resolution, and Native/Lit Framework Mode orchestration | Route Mode runs without Element; renderer integrations remain explicit |

A standard Custom Element is the durable component boundary. JSX is compiled input, not a public runtime virtual-DOM contract. Explicit and file-generated routes share one route authority; URLPattern owns pattern syntax while Router owns ordered winner selection, method dispatch, cancellation, and application outcomes.

The physical `app`, `adapter-vite`, and `create` packages are subordinate implementation/distribution boundaries. They have no separate product roadmap. UI, site, Reader/Mastodon, SaaS/reference applications, and examples are sibling consumers or private applications and are not owned by this core repository.

`1.0.0-alpha.1` establishes a new public baseline. Historic pre-1.0 APIs do not create compatibility obligations unless a durable external data, protocol, security, or explicitly promised contract requires one.
