# Router and server runtime

App owns pages, routes, loaders, actions, and request orchestration. The Vite adapter
owns compilation and build integration; Nitro owns the supported Node and Workers
server output path. Element-local rendering mechanics do not leak into App's public
contract.

## Precedents and deliberate differences

Island delivery. The `load`/`idle`/`visible`/`media`/`only` strategy vocabulary
deliberately follows Astro's `client:` directives — the scheduler's own comments
still read `client:load` and kin (`island-scheduler.ts`). The differences are
deliberate: an island is a standard Custom Element activated by the browser's
native upgrade mechanism, with no `<astro-island>` wrapper runtime; `visible`
locates islands with a deep, shadow-root-aware query because islands live inside
page-element DSD shadow roots (#562); and `media` gates delivery on a declarative
media-query match.

Speculation rules. The nearest precedents are Astro's `clientPrerender`, which
drives Speculation Rules from its runtime prefetch machinery, and Next.js's
automatic prefetch/prerender of linked routes. The deliberate difference: with no
explicit patterns configured, the rules are derived from the route table at build
time by path depth — depth ≤ 1 prerenders (`/` at moderate eagerness, other paths
conservative), deeper paths prefetch with their sub-paths covered (#798) — and
there is no runtime middleware.

Critical assets. The nearest precedents are the named critical-rendering-path
pattern: Critters-style critical-CSS inlining and next/font font optimization.
The deliberate difference: one build-time serializer emits ordinary HTML head
resources — inlining and sanitization guards in a single pass, external
render-blocking resources rejected by default because a CDN is an operational
dependency — and adds no second rendering or client-runtime path.
