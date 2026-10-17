# ADR-0167: Declared Tailwind compilation — package-owned theme sources, application-owned enablement

- Status: ACCEPTED (implemented in production: `packages/protocol/src/manifest.ts`,
  `packages/router/src/vite/tailwind.ts`, `packages/router/src/vite/internal/ssg/island-scanner.ts`)
- Decided: 2026-10-13 (owner decision: the corrected declaration-driven option ②)
- Origin: alpha15 S lane follow-up — the component stylesheet became a real
  delivery channel (ADR-0164, `tailwind.ts`), and component libraries started
  authoring utilities directly in TSX, which makes "is Tailwind required?"
  a PACKAGE fact that the application currently has to know by hand.
- Extends: `OpenElementPackageManifest` (the source-designated package protocol
  — explicitly NOT Custom Elements Manifest; the router's third-party CEM
  reader is a separate, unvalidated parser, `cem-compat.ts`).
- Extended by: [ADR-0168](ADR-0168-style-provider-port.md), which generalizes
  this ADR's rules onto a provider port and adds a second engine. Every
  decision below stands: demand is a package fact, the document reset is an
  application fact, and the framework owns no engine grammar.

## Context

Before this decision the only way to enable Tailwind was an application
declaration (`openelement.config.ts` → `tailwind: true | { theme: string[] }`),
and the only way a component library's `@theme` roles reached the compile was
for the application to repeat the library's source by path:

```ts
tailwind: { theme: ['@openelement/ui/theme.css'] }   // www/openelement.config.ts
```

Two consequences, both observed in the tree:

1. **Demand was invisible.** `packages/ui` authors utilities directly in TSX
   (`open-code-block`, `open-theme-toggle`, `open-dropdown` — the alpha15 UI
   migration). Without the entry those utilities are never compiled, and the
   component silently loses its presentation: the build succeeds and the shadow
   root simply has no rules. Nothing in the package communicated that
   requirement.
2. **Theme ownership leaked into the consumer.** The ui package owns
   `src/theme.css` (its `@theme` role table) and exports it, but every consumer
   had to name it again. A library cannot ship a new role sheet without editing
   every application.

The rejected alternative was inferring demand from class strings ("does this
module contain utility-looking tokens?"). That is guessing: `btn`, `trigger`
and friends are ordinary class names, a regex recognizer has no idea which
strings Tailwind would compile, and the framework is explicitly forbidden from
becoming a second Tailwind grammar (taste: never a regex recognizer; use the
official compiler for utility semantics).

## Decision

### 1. The declaration (package side)

`OpenElementExtensions` gains one optional block:

```ts
interface OpenElementTailwindDeclaration {
  /** Mandatory: without the compile this component is unstyled. */
  required?: boolean;
  /** Package-owned sources the entry compiles by default (package-relative). */
  sources?: string[];
}
// OpenElementDeclaration.openElement.tailwind?: OpenElementTailwindDeclaration
```

Distinctions the contract keeps sharp:

| Fact | Field | Meaning |
|---|---|---|
| mandatory compilation dependency | `required: true` | The component's presentation needs the compile. Disabling it fails the build. |
| default theme source | `sources` | The package's own sheet compiles by default; the application need not repeat it. |
| optional theme availability | no field | A sheet a consumer may `@import` themselves. It does not enable anything. |
| ordinary authored CSS | none of the above | A `.css` import edge in `static styles` — connected through the style-asset protocol, never a Tailwind requirement. |

### 2. Ownership and resolution

- **Owner**: the package that declares the source owns it. Sources are
  **package-relative** (`./theme.css`), resolved against the declaring package's
  own directory — derived from the resolved `${pkg}/manifest` module path at
  scan time, so a packed tarball, a pnpm link and a workspace link resolve
  identically. A source that is not package-relative fails with a coded
  diagnostic; there is no second spelling.
- **Tarball presence**: the resolved file must exist on disk (the build fails
  closed otherwise), which is exactly the condition a tarball must satisfy. The
  package's `files` list and its export map stay the package's own
  responsibility — the resolver reads the file the manifest names, never a
  package.json field of its own invention.
- **The theme source stays in its owning package.** This ADR makes discovery
  package-metadata-driven; it does not relocate theme ownership into Router.

### 3. Activation (which components make it active)

A declaration is active when its package is on the admitted scan list
(`packageIslands`), the declaration is admitted by the same facts that admit its
component, and the component is reached by the build. `packageIslands` is the
ONE admission channel; nothing else admits a package's declarations.

**Correction (alpha15 consolidation follow-up).** An earlier revision of this
ADR claimed that "ordinary package imports and nested components all ride the
same admission … for a component the application imports directly, when the
client build's resolver-driven discovery walks it". That is not what the
implementation does, and it is not what a real build delivers. The
resolver-driven discovery is real, but it produces **build facts** (the module's
authored `.css` edges and its statically admitted class candidates) — not
**admission**. Measured on a build of an app that imports
`@openelement/ui/open-button` with no `packageIslands`
(`packages/router/__tests__/package-import-admission-probe.test.ts`, both legs):

| Reached by | DSD for the component | Stylesheet `<link>` in its DSD | Component (utility) sheet | Authored sheet emitted | Declared Tailwind requirement honoured |
|---|---|---|---|---|---|
| `packageIslands` (admitted) | yes | yes | yes | yes | yes |
| ordinary import only | **no** | **no** | **no** | yes, but unreferenced | **no** |

So the support table is deliberately narrow, and each row is a supported
combination with the evidence named:

| Admission / delivery path | Supported | Evidence |
|---|---|---|
| `packageIslands` entry (package components: SSR, DSD, style link, declared sources, externalization) | yes | `package-import-admission-probe.test.ts` (admitted leg); `island-scanner-packages.test.ts`; `tools/release/consumer-packaged-ui-app.ts` |
| ordinary package import (module facts only: authored sheets travel the asset protocol, class candidates reach the registry) | yes, as **module facts** — never as component delivery | `package-import-admission-probe.test.ts` (unadmitted leg) |
| static components and `hydrate: 'none'` declarations inside the app | yes | `static-component-scanner.test.ts`, `tailwind-component-discovery.test.ts` |
| nested package components (a package component inside another package component) | yes | `tailwind-component-discovery.test.ts`, the packed appliance's six-component matrix |
| application-local components (document Light DOM / DSD shadow) | yes for the module facts and the document entry's own scan; utilities they author in a LIGHT root are compiled into the document sheet | `tools/release/consumer-packaged-ui-app.ts` (light-root `.p-4` in the document sheet) |
| Light DOM inside Shadow, nested shadow roots, CSR-created roots | yes — the one shared component sheet is adopted/declared per root | `shadow-tailwind.spec.ts`, `site-light-probe` |
| dev server | yes, same plan, same URL identity | `dev-tailwind.test.ts`, `dev-tailwind-components.ts` |
| SSG and request-time | yes — one `<link>` per root, from one emitted asset | `tailwind-css-only-build.test.ts`, `wiring` in `build-ssg.ts` |

When the discovery pass reaches a component package that is not admitted, the
build **warns** and names the package and the fix
(`style-assets.ts`, `reportUnadmittedComponentPackages`). It is a warning, not a
failure: importing a package module is legal in its own right, and only the
application knows whether it meant a component. What the framework will not do
is degrade in silence — the alternative was an unknown element, no DSD, no
style link, and an emitted-but-unreferenced CSS asset with no explanation.

### 4. Configuration semantics

`tailwind` stays `boolean | { theme: string[] }`, with one new meaning for
`undefined`:

| `tailwind` | Peer loaded | Compile invoked | Sources compiled | Document reset (preflight) |
|---|---|---|---|---|
| `undefined` + an active declared requirement | yes | yes | declared sources, deterministic order | **no** |
| `undefined` + no declaration | **no** | **no** | none — no entry, no resource, no payload | no |
| `true` | yes | yes | declared sources | yes |
| `{ theme: [...] }` | yes | yes | declared sources first, then the application's, order preserved | yes |
| `false` | no | no | none; an active `required: true` fails closed | no |

- **Deterministic order**: declared sources are ordered by package name, then
  declaration tag name, then declared array order — never by scan timing.
- **Deduplication by RESOLVED MODULE IDENTITY** (`isomorphic` to the S-lane's
  module-identity rule): the same file reached twice contributes one `@import`.
  A source reached from a package and from the application collapses onto the
  first (declared) occurrence, so "repeat the owner's path" is a no-op rather
  than a double compile.
- **Conflicting package themes**: two packages declaring conflicting role
  values is resolved by the same deterministic order (package name →
  declaration tag → declared order): the later source wins the cascade, exactly
  as two `@theme` blocks in one entry behave today. The application override
  policy is explicit and is the documented way to settle a conflict: an
  application source always compiles AFTER every declared source, so the
  application's roles win — and because of identity dedup, an application that
  already names the owner's source changes nothing.
- **Local application components** get no automatic entry from their class
  strings: an application declares `tailwind` for its own utilities, unless an
  admitted package declaration already enabled the pipeline.

### 5. What the entry is

Unchanged from the S lane — this ADR only decides *when* and *with which
sources* it exists. Both entry shapes are the official `@tailwindcss/vite`
pipeline over ordinary `@import` text:

| | Application-declared (`true` / `{ theme }`) | Automatic (`undefined` + an admitted declaration) |
|---|---|---|
| Document entry | `@import 'tailwindcss'` + resolved sources | **reduced**: `tailwindcss/theme.css` + resolved sources + `tailwindcss/utilities.css` |
| Component (shadow) entry | `tailwindcss/theme.css` + sources + `tailwindcss/utilities.css` + one `@source inline(…)` per compiler-admitted static candidate | same |
| Document reset / preflight | **included** — the application is styling its own document | **absent** |

- **The document reset belongs to the application.** An earlier revision of this
  ADR asserted both that the document entry carried "preflight included" and
  that automatic mode produced "no unwanted document-wide styling". Those cannot
  both hold: `@import 'tailwindcss'` carries preflight, so a package's
  compilation requirement silently restyled every consumer's `h1` margins, list
  markers and native form controls. The implementation now separates the fact:
  `ResolvedTailwindOptions.documentReset` is `true` only when the application
  declared the entry, and automatic mode renders the reduced entry above.
  Measured in all three engines by the packed appliance
  (`tools/release/consumer-packaged-ui-app.ts`, runtime-created document probes:
  heading size/weight/margin, native input border, list marker) and compiled at
  unit level in `packages/router/__tests__/tailwind-document-reset.test.ts`.
- **Utilities are not a second switch.** A light-root component's classes have
  no delivery channel other than the document sheet, so the utilities layer is
  present whenever the pipeline is on; the reset is the one fact the application
  owns. There is no new config key.
- **A declared source is compiled as written — the framework does not filter
  it.** The earlier justification ("no package can inject document rules,
  because a declaration names style SOURCES, never a stylesheet applied
  wholesale") was not sound: a source that authors a plain `body { … }` rule
  emits it, in both entry shapes. What the framework guarantees is narrower and
  true: automatic mode adds **no reset of its own**, and a source reaches the
  document only because the application admitted its package (or named it
  itself). A package that ships document-level presentation in a declared
  source is making a deliberate, reviewable choice, not slipping past a filter —
  and the seam is registered in `docs/architecture/seams.md`.
- **The component (shadow) entry is unreduced in one respect**: document
  preflight is deliberately absent there too — a reset inside a component's own
  shadow tree would change every existing component's rendering, and preflight's
  document-wide selectors have no business inside a shadow root.
- **Dark mode / forced-colors / required variables**: role seats are authored
  in the owning package's source (`:root[data-theme='dark'], :host([data-theme='dark'])`
  and the forced-colors tier). Custom properties inherit across shadow
  boundaries, so one compile feeds both the document and every shadow root; the
  component entry re-declares them inside the sheet that shadow roots adopt, so
  a shadow root is styled even when the document sheet is a separate resource.
  A role table whose consumers are **authored shadow sheets outside the compile**
  must declare `@theme static` — the engine otherwise emits only the roles some
  generated utility reads, and the rest compute to nothing
  (`packages/ui/src/theme.css`, guarded by `theme-delivery.test.ts`).
- **Dynamic class values** are never guessed: a `class={this.field}` binding
  contributes nothing. Completeness rides the author's explicit Tailwind
  mechanisms in the declared source (`@source inline(…)`, `@source` over files),
  which the official compiler consumes like any other CSS. The framework adds no
  recognizer.

### 6. Peers and diagnostics

- The peer requirement is unchanged and stays the application's: `tailwindcss`
  (and `@tailwindcss/vite`, which the router resolves from its own install) is
  an OPTIONAL peer, loaded lazily only when the pipeline is enabled. A disabled
  pipeline needs no peer installed.
- Diagnostics are coded and actionable:
  - `OE_PRESET_TAILWIND_UNRESOLVABLE` — the pipeline is enabled but
    `@tailwindcss/vite` is not resolvable: `install @tailwindcss/vite`.
  - `OE_PRESET_TAILWIND_REQUIRED_DISABLED` — `tailwind: false` while an admitted
    component declares `required: true`; names the package and tag.
  - `OE_PRESET_TAILWIND_SOURCE_UNRESOLVED` — a declared source is not
    package-relative, or does not exist in the installed package; names both.
  - `OE_PACKAGE_ISLAND_TAILWIND_SHAPE` — the declaration block itself is
    malformed (`required` not a boolean, `sources` not a string array).

### 7. Dev and build share one contract

One implementation resolves the pipeline — `resolveTailwindPlan()` in
`vite/tailwind.ts` — and both channels consume it: the dev channel's
`configResolved` and the client build's Phase 2. Consequently the dev server
serves the same compiled sources at the same URL identity, the DSD link and the
adapter agree (the S-C registry ordering fix), and "works in dev, unstyled in
prod" cannot happen for a declared requirement.

## Consequences

- A UI library that authors utilities can now ship them with its own role sheet
  and be styled in a consumer that declares nothing. This is the acceptance the
  packed consumer proves (all six `@openelement/ui` components, no `tailwind`
  key in the app).
- Applications keep the authority: `false` is an authoritative off switch with a
  fail-closed diagnostic when a mandatory dependency really exists, and an
  application source always overrides declared role values.
- `www` stops repeating `@openelement/ui/theme.css`.
- Retired here: nothing. The previous rule this replaces is the UI package's own
  "component internals carry no utility classes" contract, which the owner
  superseded for the S lane (utilities are the intended first-party authoring
  form); that package-level change is recorded in `packages/ui/CUSTOMIZATION.md`,
  not as a protocol decision.
