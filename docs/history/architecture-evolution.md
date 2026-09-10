# Architecture evolution

OpenElement's current public core is Element and Router. Earlier architectures remain available in Git; this page is only a map, not a second source of current product truth.

- **Early runtime and Declarative Shadow DOM experiments** — renderer protocols, DOM simulation, and first real-browser rendering established the DSD direction. See tags through `v0.21.x`.
- **Full-stack expansion** — Hub, Ocean Island, ISR, application shell, content, and UI experiments broadened the repository. See `v0.23.x` through `v0.39.x`.
- **Consolidation** — package and pipeline reduction moved generic responsibilities to Web Platform primitives and established tools. See `v0.40.x`.
- **Stable application-loop experiments** — the 0.41-0.43 lines hardened routing, SSR, hydration, actions, and runtime delivery while retaining a larger monorepo. See `v0.41.0`, `v0.42.0`, and `v0.43.3`.
- **Compiled Element / Part Program transition** — v0.44 replaced the prior VNode-centered model with compiler/runtime contracts and explicit Native and Lit renderer paths. See `v0.44.0-beta.1` and later v0.44 tags.
- **Public 1.0 Alpha baseline** — Beta.2.3 resets repository ownership around Element and Router, disposable packed consumers, current architecture, and conventional CI. It is a new public baseline, not a compatibility migration from 0.x.
