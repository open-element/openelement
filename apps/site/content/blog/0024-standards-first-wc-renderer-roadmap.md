---
title: 'ADR 0024: Standards-first Web Components Renderer Roadmap'
date: '2026-05-14'
lang: 'en'
type: 'adr'
tags: ['architecture', 'roadmap', 'standards', 'web-components', 'dsd', 'ssg']
draft: false
---

# ADR 0024: Standards-first Web Components Renderer Roadmap

## Status

**ACCEPTED** - 2026-05-14 strategic reset.

**Updated** - 2026-05-16 to align the public roadmap with the WC SSR/SSG
renderer-kernel and registry-hub feasibility review.

## Context

LessJS has reached a point where the next roadmap cannot be a checklist of
external ecosystem ideas. The project already has its own strongest axis:

- Declarative Shadow DOM rendering through `renderDSD()` and nested custom
  element rendering.
- SSR bundle ownership through generated `renderRoute()`, `routeInfo`, and
  `getStaticPaths()`.
- A Vite-free SSG rendering path through `ssgRender()`.
- Package island discovery through `PackageIslandMeta`.
- Deno-first validation, self-hosted documentation, and Playwright browser
  verification.

The strategic risk is to dilute this position by chasing older Web Components
tooling. OpenWC remains valuable as ecosystem history and component-contract
experience, but LessJS should not adopt OpenWC's project template or legacy test
stack as its roadmap spine. Webpack and Rollup/OpenWC build presets are also not
aligned with the current LessJS direction: Vite is already narrowed to dev/client
bundling, and Phase 3 is moving toward Vite-free ESM SSG.

Open UI remains useful, but as a contract vocabulary: parts, states, events,
accessibility behavior, form behavior, and design tokens. It should inform how
LessJS describes components, not turn LessJS into an OpenWC clone.

The 2026-05-16 feasibility review clarifies one more boundary: "universal"
means protocol-universal, not automatic support for every Web Component package.
Arbitrary custom elements can depend on browser-only APIs, layout state, timers,
global side effects, or imperative `connectedCallback()` behavior that cannot be
reliably reproduced during SSR. The registry direction is therefore only
credible when packages self-describe and validation can prove which components
are SSR-renderable, DSD-safe, upgradeable, and hydratable.

## Decision

LessJS will position itself as a **Web Standards-first DSD/Web Components
application framework**.

The roadmap is organized around three workstreams:

1. **Engine** - productize the existing DSD renderer, SSR bundle, route
   rendering, and SSG pipeline into a reusable Web Components rendering kernel.
2. **Protocol** - define how component packages describe tags, modules,
   SSR renderability, upgrade strategy, parts, states, events, and tokens.
3. **Ecosystem** - improve discovery, docs indexing, benchmarks, interactive
   scaffolds, and npm reach before committing to a centralized registry hub.

The public product boundary is:

> LessJS is a Web Components SSR/SSG rendering kernel and package protocol. A
> registry hub is a discovery layer over manifests and validation artifacts, not
> a magic runtime for arbitrary npm packages.

### Version sequence

**v0.14.2: Standards & Safety Patch**

- Correct DSD template attributes against the WHATWG template element:
  `shadowrootmode`, `shadowrootdelegatesfocus`, `shadowrootslotassignment`,
  `shadowrootclonable`, `shadowrootserializable`, and boolean
  `shadowrootcustomelementregistry`.
- Tighten raw head injection boundaries:
  `headExtras` remains developer-controlled raw HTML, but scripts should use
  structured `inject.scripts`; `inject.headFragments` must not contain script
  tags.
- Fix dynamic SSG route parameter expansion so generated paths cannot escape the
  output directory or accidentally broaden route matching.
- Add real SSR bundle, i18n, content, and UI/docs output tests around the actual
  self-hosted site.

**v0.15: Renderer Kernel**

- Define a public Web Component render protocol around adapter inputs, outputs,
  errors, hydration hints, DSD constraints, metrics, and nested rendering.
- Keep Playwright as the browser-validation mainline. Do not introduce
  `@open-wc/testing`, `@open-wc/semantic-dom-diff`, or similar old presets as a
  framework dependency.
- Leave room for non-Lit adapters, but do not promise a large adapter matrix
  before the protocol is stable.

**v0.16: WC Package Protocol**

- Extend `PackageIslandMeta` into a component package manifest.
- Use Custom Elements Manifest-compatible metadata as the base for tag, module,
  export, attributes, properties, events, slots, CSS parts, CSS custom
  properties, custom states, and docs metadata.
- Add LessJS-specific fields for `ssr`, `dsd`, `hydrate`, `strategy`,
  diagnostics, validation status, and fallback behavior.
- Support a local registry index that can be scanned and indexed by the docs
  site.

**v0.17: Ecosystem Entry**

- Improve npm reach, docs search, benchmark visibility, interactive scaffolds,
  and a registry page prototype.
- Demonstrate component discoverability through local manifests and docs
  indexing. Do not promise a centralized marketplace yet.
- Add `less validate-manifest` before `less add`; install automation must reject
  packages that cannot explain their SSR, registration, and hydration behavior.
- Generate registration only from manifest data. Guard against duplicate
  `customElements.define()` calls, version conflicts, and packages that require
  browser-only side effects during SSR.

**v0.18-v1.0: API Freeze**

- Freeze `lessjs()` configuration, renderer protocol, adapter contract, package
  manifest, migration policy, and release gates.

**v1.0+ Bets**

- Edge SSR, ISR, compiler pipeline, WC registry hub, and multi-adapter support
  remain long-term bets. They should not become the main promise before the
  renderer/protocol layer is stable.

## Explicit Rejections

### No webpack

LessJS will not route its roadmap back through webpack or legacy bundler
presets. The project direction is ESM-first: Vite remains useful for dev mode and
client bundling, while SSG/rendering boundaries continue to be abstracted away
from bundler-specific assumptions.

### No OpenWC toolchain adoption

OpenWC can inform naming, testing ideas, and component-contract lessons, but
LessJS will not adopt the OpenWC project template, `@open-wc/testing`, or
semantic DOM diff tooling as its main path. LessJS already has a Deno-first test
stack, real SSG output, and Playwright browser verification.

### No generic full-stack promise before renderer protocol stability

LessJS should not present itself as a generic full-stack framework until the
DSD/WC rendering kernel and protocol are stable. API routes and RPC are useful,
but they are not the differentiating core.

### No centralized WC hub before manifest/protocol

A Web Components registry hub is worth exploring, but only after component
packages can self-describe, be locally scanned, be indexed by docs, and be
checked against security and governance rules.

### No automatic hydration without explicit metadata

Hydration is not guessed from DOM shape. A package must declare the relevant
strategy, selectors, events, cleanup rules, and fallback behavior before LessJS
can bind interactivity automatically.

## Consequences

### Positive

- The roadmap now follows LessJS's actual strengths instead of copying older
  Web Components ecosystems.
- Standards work becomes concrete: DSD attributes, package manifests, adapter
  contracts, and browser validation.
- Package discovery can start locally and incrementally before introducing
  centralized governance.
- The roadmap creates crisp release gates for v1.0 instead of broad product
  promises.
- The registry story is grounded in validation artifacts: manifests, SSR output,
  SSG output, bundle cost, accessibility notes, and Playwright checks.

### Negative

- Some ecosystem expectations are explicitly deferred. Users who expect OpenWC
  presets, webpack support, or a generic full-stack framework may need a
  different tool.
- v0.15-v0.16 require disciplined API design work before adding visible new
  features.
- A registry hub becomes a later governance problem, not a short-term marketing
  feature.
- One-click install and automatic rendering are intentionally limited to
  manifest-bearing packages, which makes the pitch less magical but much safer.

### Neutral

- Open UI remains relevant, but only as a component-contract reference.
- Vite remains useful, but as a dev/client bundling tool rather than the
  framework's identity.
- The current Lit adapter remains important, but the renderer protocol must not
  hard-code Lit concepts.
- FAST, Lit, and other authoring libraries remain adapter inputs. LessJS should
  not treat any one authoring model as the definition of Web Components.
- Scoped Custom Element Registries and CSS Houdini are tracked as standards
  adjacency. They can inform future conflict isolation and styling extension, but
  they are not required for the current stable path.

## Validation

Each version must ship with tests that prove the relevant boundary:

- v0.14.2: DSD attribute tests, head injection rejection tests, route parameter
  safety tests, actual docs SSR bundle test, and content/i18n/UI output checks.
- v0.15: adapter contract tests, DSD metrics/report tests, nested CE regression
  tests, and Playwright verification.
- v0.16: manifest schema validation, local registry index generation, and docs
  indexing tests.
- v0.17: manifest validation CLI, `less add` dry-run, scaffold smoke test,
  benchmark output shape, search/indexing checks, and registry page prototype
  tests.
- v0.18-v1.0: public API snapshot tests and migration policy checks.

## References

- [WHATWG HTML Living Standard](https://html.spec.whatwg.org/multipage/scripting.html#the-template-element):
  `template` element and declarative shadow root attributes.
- [MDN Shadow DOM guide](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM):
  server-rendered UI can use declarative shadow roots.
- [Custom Elements Manifest](https://custom-elements-manifest.open-wc.org/):
  metadata for tags, attributes, properties, slots, CSS parts, CSS custom
  properties, custom states, and events.
- [Open UI](https://open-ui.org/): component contracts for parts, states,
  behaviors, accessibility requirements, form behavior, and tokens.
- [OpenWC](https://open-wc.org/docs/): useful historical experience for testing,
  linting, demoing, building, and publishing, not the adopted LessJS toolchain.
- [Lit SSR](https://lit.dev/docs/v2/ssr/overview/): proof that Web Components SSR
  is useful, with important library-specific limitations.
- [FAST](https://fast.design/docs/getting-started/quick-start): example of a
  Web Components authoring model that should integrate through protocols rather
  than become a LessJS dependency.
- [Scoped Custom Element Registries proposal](https://wicg.github.io/webcomponents/proposals/Scoped-Custom-Element-Registries.html):
  relevant to future duplicate-tag and multi-version isolation.
- [CSS Houdini drafts](https://drafts.css-houdini.org/): future styling and
  worklet adjacency, not current core scope.
- Playwright: real-browser validation for DSD parsing, custom element upgrade,
  and layout behavior.
