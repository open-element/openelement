# Package Surface Inventory

This is the current-line (0.41.x stable and later) five-package product truth. ADR-0113 authorizes the
breaking collapse from the earlier implementation graph.

<!-- 5-package -->

```text
OpenElement = Web Components-native, static-first application framework
authoring modes = Basic Element standalone + full application
```

## Current five-package surface

| Package                     | Responsibility                                                                 | Supported public interface                                          |
| --------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `@openelement/element`      | JSX, Custom Elements, DSD, hydration, signals and component runtime contracts  | root, `jsx-runtime`, `jsx-dev-runtime`, `build-utils`, `sanitize`   |
| `@openelement/app`          | Pages, routes, loaders, actions, islands and normalized request semantics      | root, `model`, `spa`, `preact`, `router`, `router/http`, `lit`      |
| `@openelement/adapter-vite` | Vite, content, SSG, generated data, Hono and Nitro build/deploy implementation | root, `element`, `nitro-mount`, `cli/build`, `cli/start`, `sitemap` |
| `@openelement/create`       | Version-coherent starter generation and consumer lifecycle                     | CLI binary (root)                                                   |
| `@openelement/ui`           | Optional, reusable and dogfood-proven Web Component primitives                 | root and retained primitive subpaths                                |

Responsibility wording follows [`STACK_CONTRACT.md`](./STACK_CONTRACT.md),
the source of truth for the five-package responsibility table.

Application authors should normally learn `element`, `app`, `adapter-vite`,
and `create`; `ui` is optional.

## Vocabulary

- **Hydration** — element-level: how and when a component's client JavaScript
  is loaded (`load`, `idle`, `visible`, `only`; see `HYDRATION_CONTRACT.md`).
- **Upgrade** — island-level: the moment a server-rendered custom element is
  defined and its instance takes over the existing markup.
- **Activation** — framework takeover: marker activation, event binding and
  state restoration performed by the runtime after upgrade.

The Element/App root surface exposes the compiled-class authoring model: the
`OpenElement` base class plus the `@element`/`@property` compile-time
decorator intrinsics (experimental, #1209 — see the v0.44 experimental table
below). The v0.43 functional element-authoring helper, its alpha-only layout
alias, and the signal control-flow list factory were removed in v0.44 with no
alias; the before/after mapping lives in
[`v0.44.0-MIGRATION.md`](./v0.44.0-MIGRATION.md). `Show` stays internal
(jsx-runtime) — open an issue if a public consumer surface is needed. Keyed
list reconciliation is compiler-owned in v0.44: the compiler emits list
Regions for keyed collections, with the v1 grammar boundaries recorded in the
migration guide (ADR-0124 Consequences, #915).

## Subpath inventory

The machine-readable map below is compared against each package's `exports`
field by `deno task package-surface:check`; any drift fails the gate. A second
machine-readable block (`package-export-classes`) in the Beta.1 stability
section below classifies every named export of every subpath; the same gate
compares it against source.
"Internal but importable" subpaths stay reachable for build adapters,
generated code and optional integrations, but they carry no compatibility
promise and are not application-authoring surface.

<!-- package-surface-map
{
  "@openelement/element": {
    "supported": [
      ".",
      "jsx-runtime",
      "jsx-dev-runtime",
      "build-utils",
      "sanitize"
    ],
    "internal": [
      "authoring",
      "html",
      "logger"
    ]
  },
  "@openelement/app": {
    "supported": [
      ".",
      "model",
      "spa",
      "preact",
      "router",
      "router/http",
      "lit"
    ],
    "internal": [
      "i18n",
      "document",
      "lit-ssr"
    ]
  },
  "@openelement/adapter-vite": {
    "supported": [
      ".",
      "nitro-mount",
      "cli/build",
      "cli/start",
      "sitemap",
      "element"
    ],
    "internal": []
  },
  "@openelement/create": {
    "supported": [
      "."
    ],
    "internal": []
  },
  "@openelement/ui": {
    "supported": [
      ".",
      "open-badge",
      "open-button",
      "open-callout",
      "open-card",
      "open-code-block",
      "open-dialog",
      "open-dropdown",
      "open-input",
      "open-props-tokens",
      "open-tabs",
      "open-theme-toggle"
    ],
    "internal": [
      "open-props-tokens.js"
    ]
  }
}
-->

- `@openelement/element/build-utils` (alpha.17): build-time helpers
  (`transformIslandSource`, `formatJson`,
  `pathToTagName`, `normalizeSeparators`, `insertBeforeBodyClose`,
  `SsrRenderError`,
  `createRuntimeAdapter`, `composeFetchMiddleware` and the runtime handler
  types) for build adapters.
  They were removed from the element root export; application code must not
  import them.
- The `open-element-render` and `open-element-hydration` modules are
  internal-only hydration implementation modules (see
  `HYDRATION_CONTRACT.md`); their subpath exports were removed in alpha.19.
  The module files remain inside the package for internal relative imports
  only.
- The branded types `SafeHtml` and `UnsafeHtml` and the internal
  `StyleSheetRule` type are no longer exported from the element root
  (alpha.18 release notes already claimed their removal; alpha.19 makes it
  true). Their declarations stay in the internal protocol files.
- The element root no longer carries `export type *` seams (alpha.19); the
  public type surface is an explicit export list in
  `packages/element/src/index.ts`.
- v0.43.1 ownership correction (ADR-0137, #1097): adapter-specific blog,
  navigation, i18n and build-context contracts are exported by
  `@openelement/adapter-vite`, not `@openelement/element`. Migrate imports of
  `OpenElementBlogOptions`, `OpenElementNavSection`,
  `OpenElementHeaderNavLink`, `OpenElementI18nContextOptions`, and
  `OpenElementBuildContextLike` to the adapter root. Package roots route
  supported implementations through named public modules and never name an
  `internal/` module specifier.
- `@openelement/app/i18n` is the optional locale-expansion integration point.
- `@openelement/app/lit` is the Lit renderer authoring entry (`defineLitPage`, experimental in Beta.2.2, #1339). `document` (the resolved-Document seam of #1326) and `lit-ssr` (the Lit SSR renderer) are internal subpaths consumed by generated entries; they carry no author-facing stability promise.
- `@openelement/app/router` exports pure Route Mode matching; `router/http` adds Hono execution. Private tree/parser details remain unexported. The browser router
  types (`RouteConfig`, `RouterInstance`, `RouterMode`) were removed from the
  app root export in alpha.17 — SPA consumers derive the instance from
  `ReturnType<typeof defineApp>` and the options from
  `Parameters<typeof defineApp>[0]`.
- `@openelement/adapter-vite` internal subpaths (`app-vite`, `build-context`,
  `head-injection`, `i18n-plugin`, `plugin`, `generated-data-resolver`,
  `plugin-mdx`, `route-manifest`, `cli/build-client`, `cli/build-ssg`) were
  pruned at the 0.41.0 freeze (ADR-0119): they had zero consumer specifiers —
  the build pipeline and generated code import only relatively or through the
  supported root, `nitro-mount`, `cli/build`, `cli/start` and
  `sitemap` subpaths. `cli/start` carries a `--mode=start|preview` flag
  (alpha.13, ADR-0123 item 4): the former standalone `cli/preview` subpath
  merged into it as preview mode. The module
  files remain inside the package for internal relative imports only.
- The adapter root owns the content-collection authoring surface:
  `CollectionOptions`, `CollectionSchema`, `createCollectionPlugin`,
  `loadCollectionData`, and `writeCollectionDataModule`. Normal applications
  configure named collections through `openElement({ content: { collections } })`;
  `content.blog` remains the compatible blog alias and emits the unchanged
  `_generated-blog-data.ts` module contract.
- `@openelement/ui` supported subpaths: `open-badge`, `open-button`,
  `open-callout`, `open-card`, `open-code-block`, `open-dialog`,
  `open-dropdown`, `open-input`, `open-props-tokens`, `open-tabs`,
  `open-theme-toggle`.
- `@openelement/ui/open-props-tokens.js` is a resolver-compatibility alias of
  `open-props-tokens`.

## Beta.1 export stability classes (ADR-0151, #1223)

Every named export of every published subpath carries exactly one stability
class. The machine-readable `package-export-classes` block below is compared
against the real export surface by `deno task package-surface:check`, which
enumerates exports through the same TypeScript module resolution as the
public-interface snapshot; an unclassified export, a stale classification or a
classified name missing from the prose fails the gate.

- **stable-candidate** — supported application-authoring, third-party
  component or deployment-integration contract intended to reach 1.0
  unchanged. Entries that are also frozen (ADR-0119, ADR-0122) still require
  a major-version ADR to change.
- **experimental** — admitted but explicitly unsettled; may change or move
  without a major-version bump while its tracking issue is open.
- **internal-importable** — reachable at a supported subpath because generated
  code, build adapters or sibling OpenElement packages import it; carries no
  application-authoring compatibility promise.
- **compatibility-only** — retained solely for backward compatibility; new
  code must not adopt it.
- **deprecated** — scheduled for removal. No export currently carries this
  class.

<!-- package-export-classes
{
  "@openelement/element": {
    ".": {
      "Action": "stable-candidate",
      "ACTION_FETCH_HEADER": "stable-candidate",
      "ActionContext": "stable-candidate",
      "ActionResult": "stable-candidate",
      "AppShellConfig": "internal-importable",
      "assertValidTagName": "internal-importable",
      "collectPublicProps": "internal-importable",
      "CompatibilityClassification": "internal-importable",
      "CompatibilityTier": "internal-importable",
      "ComponentLayer": "internal-importable",
      "computed": "stable-candidate",
      "consumeContext": "stable-candidate",
      "Context": "stable-candidate",
      "createContext": "stable-candidate",
      "createLogger": "internal-importable",
      "DANGEROUS_KEYS": "experimental",
      "deepGetElementById": "internal-importable",
      "effect": "stable-candidate",
      "element": "experimental",
      "ensureDeepFragmentNavigation": "internal-importable",
      "ensurePreHydrationClickCapture": "internal-importable",
      "ERROR_PREFIX": "stable-candidate",
      "ErrorBoundary": "stable-candidate",
      "ErrorTelemetryHook": "stable-candidate",
      "escapeAttr": "stable-candidate",
      "escapeHtml": "stable-candidate",
      "formatError": "internal-importable",
      "FrameworkOptions": "internal-importable",
      "HYDRATION_STRATEGIES": "stable-candidate",
      "HydrationStrategy": "stable-candidate",
      "injectPropsSafe": "experimental",
      "isDangerousKey": "experimental",
      "IslandOptions": "stable-candidate",
      "isSafeAttributeName": "stable-candidate",
      "isValidTagName": "internal-importable",
      "Loader": "stable-candidate",
      "LoaderContext": "stable-candidate",
      "LocalePath": "stable-candidate",
      "Middleware": "stable-candidate",
      "OpenElement": "stable-candidate",
      "OpenElementAttribute": "stable-candidate",
      "OpenElementCssPart": "stable-candidate",
      "OpenElementDeclaration": "stable-candidate",
      "OpenElementError": "stable-candidate",
      "OpenElementEvent": "stable-candidate",
      "OpenElementPackageManifest": "stable-candidate",
      "OpenElementRouteKind": "compatibility-only",
      "OpenElementRouteNode": "compatibility-only",
      "OpenElementSlot": "stable-candidate",
      "PROBLEM_JSON_MEDIA_TYPE": "stable-candidate",
      "ProblemDetails": "stable-candidate",
      "property": "experimental",
      "provideContext": "stable-candidate",
      "renderDsd": "internal-importable",
      "RenderDsdOptions": "internal-importable",
      "RenderError": "stable-candidate",
      "RenderOutput": "internal-importable",
      "reportError": "stable-candidate",
      "RouteEntry": "internal-importable",
      "ServerRouteContext": "stable-candidate",
      "ServerRouteMetadata": "stable-candidate",
      "setErrorTelemetryHook": "stable-candidate",
      "signal": "stable-candidate",
      "Signal": "stable-candidate",
      "SpaAction": "stable-candidate",
      "SpaActionContext": "stable-candidate",
      "SpaLoader": "stable-candidate",
      "SpaLoaderContext": "stable-candidate",
      "SpecialFileType": "internal-importable",
      "SsrAdmissionDecision": "internal-importable",
      "StyleSheet": "stable-candidate",
      "StyleSheetLike": "stable-candidate",
      "trustedHtml": "stable-candidate",
      "TrustedHtml": "stable-candidate",
      "wrapInDocument": "internal-importable"
    },
    "jsx-runtime": {
      "Fragment": "stable-candidate",
      "jsx": "stable-candidate",
      "JSX": "stable-candidate",
      "jsxs": "stable-candidate"
    },
    "jsx-dev-runtime": {
      "Fragment": "stable-candidate",
      "JSX": "stable-candidate",
      "jsxDEV": "stable-candidate"
    },
    "sanitize": {
      "isSafeUrl": "stable-candidate",
      "sanitizeHtml": "stable-candidate",
      "SanitizeOptions": "stable-candidate"
    },
    "build-utils": {
      "composeFetchMiddleware": "internal-importable",
      "createRuntimeAdapter": "internal-importable",
      "formatJson": "internal-importable",
      "insertBeforeBodyClose": "internal-importable",
      "normalizeSeparators": "internal-importable",
      "OpenElementRequestHandler": "internal-importable",
      "pathToTagName": "internal-importable",
      "RuntimeContext": "internal-importable",
      "SsrRenderError": "internal-importable",
      "transformIslandSource": "internal-importable"
    },
    "authoring": {
      "assertValidTagName": "internal-importable",
      "ACTION_FETCH_HEADER": "internal-importable",
      "DANGEROUS_KEYS": "internal-importable",
      "ERROR_PREFIX": "internal-importable",
      "HydrationStrategy": "internal-importable",
      "HYDRATION_STRATEGIES": "internal-importable",
      "injectPropsSafe": "internal-importable",
      "isDangerousKey": "internal-importable",
      "isValidTagName": "internal-importable",
      "OpenElementError": "internal-importable",
      "PROBLEM_JSON_MEDIA_TYPE": "internal-importable"
    },
    "html": {
      "escapeAttr": "internal-importable",
      "escapeAttrValue": "internal-importable",
      "escapeHtml": "internal-importable",
      "SafeHtml": "internal-importable",
      "trustedHtml": "internal-importable",
      "TrustedHtml": "internal-importable",
      "UnsafeHtml": "internal-importable",
      "wrapInDocument": "internal-importable"
    },
    "logger": {
      "createLogger": "internal-importable",
      "createWarnScope": "internal-importable",
      "Logger": "internal-importable",
      "warnOnce": "internal-importable",
      "WarnScope": "internal-importable"
    }
  },
  "@openelement/app": {
    ".": {
      "Action": "stable-candidate",
      "ACTION_FETCH_HEADER": "stable-candidate",
      "ActionContext": "stable-candidate",
      "ActionOutcome": "internal-importable",
      "ActionResult": "stable-candidate",
      "classifyActionResult": "internal-importable",
      "createRequestContext": "stable-candidate",
      "CreateRequestContextOptions": "stable-candidate",
      "defineApp": "stable-candidate",
      "defineIslandConfig": "stable-candidate",
      "definePage": "stable-candidate",
      "fail": "stable-candidate",
      "isActionFailure": "stable-candidate",
      "IslandConfig": "stable-candidate",
      "IslandDeliveryStrategy": "stable-candidate",
      "isOpenElementNotFound": "stable-candidate",
      "isOpenElementRedirect": "stable-candidate",
      "Loader": "stable-candidate",
      "LoaderContext": "stable-candidate",
      "notFound": "stable-candidate",
      "OpenElementActionFailure": "stable-candidate",
      "OpenElementNotFound": "stable-candidate",
      "OpenElementPageDescriptor": "stable-candidate",
      "OpenElementRedirect": "stable-candidate",
      "OpenElementRequestContext": "stable-candidate",
      "PageComponentConstructor": "stable-candidate",
      "PageErrorProjector": "stable-candidate",
      "PageHead": "stable-candidate",
      "PageHeadResolver": "stable-candidate",
      "PagePropsContext": "stable-candidate",
      "PagePropsProjector": "stable-candidate",
      "PROBLEM_JSON_MEDIA_TYPE": "stable-candidate",
      "ProblemDetails": "stable-candidate",
      "projectPageProps": "internal-importable",
      "redirect": "stable-candidate",
      "ServerRouteContext": "stable-candidate",
      "ServerRouteMetadata": "stable-candidate",
      "SpaAction": "stable-candidate",
      "SpaActionContext": "stable-candidate",
      "SpaAppInstance": "stable-candidate",
      "SpaLoader": "stable-candidate",
      "SpaLoaderContext": "stable-candidate"
    },
    "model": {
      "createRequestContext": "stable-candidate",
      "CreateRequestContextOptions": "stable-candidate",
      "OpenElementRequestContext": "stable-candidate"
    },
    "spa": {
      "defineApp": "stable-candidate",
      "SpaAppInstance": "stable-candidate"
    },
    "i18n": {
      "loadI18nData": "internal-importable",
      "LocalePath": "internal-importable",
      "normalizeLocalePath": "internal-importable",
      "OpenElementI18nOptions": "internal-importable"
    },
    "document": {
      "PageHeadAlternate": "internal-importable",
      "ResolvedDocument": "internal-importable",
      "ResolvedDocumentLink": "internal-importable",
      "resolvePageDocument": "internal-importable"
    },
    "lit": {
      "defineLitPage": "experimental",
      "LitPageConstructor": "experimental",
      "OpenElementPageDescriptor": "stable-candidate"
    },
    "lit-ssr": {
      "renderLitPageToHtml": "internal-importable"
    },
    "preact": {
      "definePreactIsland": "stable-candidate",
      "PreactIslandConstructor": "stable-candidate",
      "PreactIslandOptions": "stable-candidate"
    },
    "router": {
      "RouteTable": "experimental",
      "RouteRecord": "experimental",
      "RouteMatch": "experimental",
      "RouteResolution": "experimental",
      "RouteTableOptions": "experimental",
      "normalizeRoutePatternForURLPattern": "internal-importable"
    },
    "router/http": {
      "createRouteMiddleware": "experimental",
      "HttpRouteRecord": "experimental"
    }
  },
  "@openelement/adapter-vite": {
    ".": {
      "ArtifactInfo": "internal-importable",
      "buildApp": "stable-candidate",
      "buildHeadExtras": "stable-candidate",
      "buildIslandChunkMap": "internal-importable",
      "BuildManifest": "internal-importable",
      "buildSpeculationRulesJson": "internal-importable",
      "CollectionEntry": "stable-candidate",
      "CollectionFieldDefinition": "stable-candidate",
      "CollectionFieldType": "stable-candidate",
      "CollectionOptions": "stable-candidate",
      "CollectionSchema": "stable-candidate",
      "CollectionSchemaContext": "stable-candidate",
      "CollectionSchemaResult": "stable-candidate",
      "createCollectionPlugin": "stable-candidate",
      "default": "stable-candidate",
      "extractCustomElementTags": "internal-importable",
      "FrameworkOptions": "internal-importable",
      "generateIslandManifests": "internal-importable",
      "generateSitemap": "stable-candidate",
      "HeadExtrasResult": "stable-candidate",
      "injectClientScript": "internal-importable",
      "injectCspMeta": "internal-importable",
      "injectSpeculationRules": "internal-importable",
      "injectViewTransitionMeta": "internal-importable",
      "loadCollectionData": "stable-candidate",
      "mdxPlugin": "stable-candidate",
      "openElement": "stable-candidate",
      "OpenElementBlogOptions": "stable-candidate",
      "OpenElementBuildContext": "internal-importable",
      "OpenElementBuildContextLike": "stable-candidate",
      "OpenElementHeaderNavLink": "stable-candidate",
      "OpenElementI18nContextOptions": "stable-candidate",
      "OpenElementNavSection": "stable-candidate",
      "OpenElementOptions": "stable-candidate",
      "OpenMdxPluginOptions": "stable-candidate",
      "openPipeline": "stable-candidate",
      "OpenPipelineConfig": "stable-candidate",
      "printBuildManifest": "internal-importable",
      "scanClientBuild": "internal-importable",
      "scanSSGOutput": "internal-importable",
      "SpeculationRulesOptions": "internal-importable",
      "SsgBehaviorOptions": "internal-importable",
      "writeCollectionDataModule": "stable-candidate",
      "writeIslandManifests": "internal-importable"
    },
    "nitro-mount": {
      "createOpenElementNitroHandler": "stable-candidate",
      "NitroRequestEvent": "stable-candidate",
      "OpenElementNitroMountOptions": "stable-candidate"
    },
    "sitemap": {
      "generateSitemap": "stable-candidate",
      "SitemapOptions": "stable-candidate"
    },
    "cli/build": {},
    "cli/start": {
      "extractServeMode": "internal-importable"
    },
    "element": {
      "element": "experimental"
    }
  },
  "@openelement/create": {
    ".": {}
  },
  "@openelement/ui": {
    ".": {
      "manifest": "stable-candidate",
      "OpenBadge": "stable-candidate",
      "OpenButton": "stable-candidate",
      "OpenCallout": "stable-candidate",
      "OpenCard": "stable-candidate",
      "OpenCodeBlock": "stable-candidate",
      "OpenDialog": "stable-candidate",
      "OpenDropdown": "stable-candidate",
      "OpenInput": "stable-candidate",
      "openPropsRootSheet": "stable-candidate",
      "openPropsTokenSheet": "stable-candidate",
      "OpenTabs": "stable-candidate",
      "OpenThemeToggle": "stable-candidate",
      "registerOpenUi": "stable-candidate"
    },
    "open-badge": {
      "OpenBadge": "stable-candidate"
    },
    "open-button": {
      "OpenButton": "stable-candidate"
    },
    "open-callout": {
      "OpenCallout": "stable-candidate"
    },
    "open-card": {
      "OpenCard": "stable-candidate"
    },
    "open-code-block": {
      "OpenCodeBlock": "stable-candidate"
    },
    "open-dialog": {
      "OpenDialog": "stable-candidate"
    },
    "open-dropdown": {
      "OpenDropdown": "stable-candidate"
    },
    "open-input": {
      "OpenInput": "stable-candidate"
    },
    "open-tabs": {
      "OpenTabs": "stable-candidate"
    },
    "open-theme-toggle": {
      "OpenThemeToggle": "stable-candidate"
    },
    "open-props-tokens": {
      "openPropsRootSheet": "stable-candidate",
      "openPropsTokenSheet": "stable-candidate"
    },
    "open-props-tokens.js": {
      "openPropsRootSheet": "compatibility-only",
      "openPropsTokenSheet": "compatibility-only"
    }
  }
}
-->

### `@openelement/element`

| Subpath           | Class               | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root              | compatibility-only  | `OpenElementRouteKind`, `OpenElementRouteNode`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
|                   | experimental        | `DANGEROUS_KEYS`, `element`, `injectPropsSafe`, `isDangerousKey`, `property`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
|                   | internal-importable | `AppShellConfig`, `assertValidTagName`, `collectPublicProps`, `CompatibilityClassification`, `CompatibilityTier`, `ComponentLayer`, `createLogger`, `deepGetElementById`, `ensureDeepFragmentNavigation`, `ensurePreHydrationClickCapture`, `formatError`, `FrameworkOptions`, `isValidTagName`, `renderDsd`, `RenderDsdOptions`, `RenderOutput`, `RouteEntry`, `SpecialFileType`, `SsrAdmissionDecision`, `wrapInDocument`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
|                   | stable-candidate    | `Action`, `ACTION_FETCH_HEADER`, `ActionContext`, `ActionResult`, `computed`, `consumeContext`, `Context`, `createContext`, `effect`, `ERROR_PREFIX`, `ErrorBoundary`, `ErrorTelemetryHook`, `escapeAttr`, `escapeHtml`, `HYDRATION_STRATEGIES`, `HydrationStrategy`, `IslandOptions`, `isSafeAttributeName`, `Loader`, `LoaderContext`, `LocalePath`, `Middleware`, `OpenElement`, `OpenElementAttribute`, `OpenElementCssPart`, `OpenElementDeclaration`, `OpenElementError`, `OpenElementEvent`, `OpenElementPackageManifest`, `OpenElementSlot`, `PROBLEM_JSON_MEDIA_TYPE`, `ProblemDetails`, `provideContext`, `RenderError`, `reportError`, `ServerRouteContext`, `ServerRouteMetadata`, `setErrorTelemetryHook`, `signal`, `Signal`, `SpaAction`, `SpaActionContext`, `SpaLoader`, `SpaLoaderContext`, `StyleSheet`, `StyleSheetLike`, `trustedHtml`, `TrustedHtml` |
| `jsx-runtime`     | stable-candidate    | `Fragment`, `jsx`, `JSX`, `jsxs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `jsx-dev-runtime` | stable-candidate    | `Fragment`, `JSX`, `jsxDEV`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `sanitize`        | stable-candidate    | `isSafeUrl`, `sanitizeHtml`, `SanitizeOptions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `build-utils`     | internal-importable | `composeFetchMiddleware`, `createRuntimeAdapter`, `formatJson`, `insertBeforeBodyClose`, `normalizeSeparators`, `OpenElementRequestHandler`, `pathToTagName`, `RuntimeContext`, `SsrRenderError`, `transformIslandSource`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `authoring`       | internal-importable | `assertValidTagName`, `DANGEROUS_KEYS`, `ERROR_PREFIX`, `HydrationStrategy`, `HYDRATION_STRATEGIES`, `isDangerousKey`, `isValidTagName`, `OpenElementError`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

| `authoring` (Beta.2.2 additions) | internal-importable | `ACTION_FETCH_HEADER`, `injectPropsSafe`, `PROBLEM_JSON_MEDIA_TYPE` |
| `html` | internal-importable | `escapeAttr`, `escapeAttrValue`, `escapeHtml`, `SafeHtml`, `trustedHtml`, `TrustedHtml`, `UnsafeHtml`, `wrapInDocument` |
| `logger` | internal-importable | `createLogger`, `createWarnScope`, `Logger`, `warnOnce`, `WarnScope` |

### `@openelement/app`

| Subpath    | Class               | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| root       | internal-importable | `ActionOutcome`, `classifyActionResult`, `projectPageProps`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
|            | stable-candidate    | `Action`, `ACTION_FETCH_HEADER`, `ActionContext`, `ActionResult`, `createRequestContext`, `CreateRequestContextOptions`, `defineApp`, `defineIslandConfig`, `definePage`, `fail`, `isActionFailure`, `IslandConfig`, `IslandDeliveryStrategy`, `isOpenElementNotFound`, `isOpenElementRedirect`, `Loader`, `LoaderContext`, `notFound`, `OpenElementActionFailure`, `OpenElementNotFound`, `OpenElementPageDescriptor`, `OpenElementRedirect`, `OpenElementRequestContext`, `PageComponentConstructor`, `PageErrorProjector`, `PageHead`, `PageHeadResolver`, `PagePropsContext`, `PagePropsProjector`, `PROBLEM_JSON_MEDIA_TYPE`, `ProblemDetails`, `redirect`, `ServerRouteContext`, `ServerRouteMetadata`, `SpaAction`, `SpaActionContext`, `SpaAppInstance`, `SpaLoader`, `SpaLoaderContext` |
| `model`    | stable-candidate    | `createRequestContext`, `CreateRequestContextOptions`, `OpenElementRequestContext`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `spa`      | stable-candidate    | `defineApp`, `SpaAppInstance`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `i18n`     | internal-importable | `loadI18nData`, `LocalePath`, `normalizeLocalePath`, `OpenElementI18nOptions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `lit`      | experimental        | `defineLitPage`, `LitPageConstructor`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
|            | stable-candidate    | `OpenElementPageDescriptor` (the root descriptor type, re-exported)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `document` | internal-importable | `PageHeadAlternate`, `ResolvedDocument`, `ResolvedDocumentLink`, `resolvePageDocument`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `lit-ssr`  | internal-importable | `renderLitPageToHtml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `preact`   | stable-candidate    | `definePreactIsland`, `PreactIslandConstructor`, `PreactIslandOptions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### `@openelement/adapter-vite`

| Subpath       | Class               | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| root          | internal-importable | `ArtifactInfo`, `buildIslandChunkMap`, `BuildManifest`, `buildSpeculationRulesJson`, `extractCustomElementTags`, `FrameworkOptions`, `generateIslandManifests`, `injectClientScript`, `injectCspMeta`, `injectSpeculationRules`, `injectViewTransitionMeta`, `OpenElementBuildContext`, `printBuildManifest`, `scanClientBuild`, `scanSSGOutput`, `SpeculationRulesOptions`, `SsgBehaviorOptions`, `writeIslandManifests`                                                                                                                                                                        |
|               | stable-candidate    | `buildApp`, `buildHeadExtras`, `CollectionEntry`, `CollectionFieldDefinition`, `CollectionFieldType`, `CollectionOptions`, `CollectionSchema`, `CollectionSchemaContext`, `CollectionSchemaResult`, `createCollectionPlugin`, `default`, `generateSitemap`, `HeadExtrasResult`, `loadCollectionData`, `mdxPlugin`, `openElement`, `OpenElementBlogOptions`, `OpenElementBuildContextLike`, `OpenElementHeaderNavLink`, `OpenElementI18nContextOptions`, `OpenElementNavSection`, `OpenElementOptions`, `OpenMdxPluginOptions`, `openPipeline`, `OpenPipelineConfig`, `writeCollectionDataModule` |
| `nitro-mount` | stable-candidate    | `createOpenElementNitroHandler`, `NitroRequestEvent`, `OpenElementNitroMountOptions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `sitemap`     | stable-candidate    | `generateSitemap`, `SitemapOptions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `cli/build`   | —                   | CLI entry module; no importable exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `cli/start`   | internal-importable | `extractServeMode`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### `@openelement/create`

| Subpath | Class | Exports                                 |
| ------- | ----- | --------------------------------------- |
| root    | —     | CLI entry module; no importable exports |

### `@openelement/ui`

| Subpath                                                                      | Class              | Exports                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root                                                                         | stable-candidate   | `manifest`, `OpenBadge`, `OpenButton`, `OpenCallout`, `OpenCard`, `OpenCodeBlock`, `OpenDialog`, `OpenDropdown`, `OpenInput`, `openPropsRootSheet`, `openPropsTokenSheet`, `OpenTabs`, `OpenThemeToggle`, `registerOpenUi` |
| `open-badge`                                                                 | stable-candidate   | `OpenBadge`                                                                                                                                                                                                                |
| `open-button`                                                                | stable-candidate   | `OpenButton`                                                                                                                                                                                                               |
| `open-callout`                                                               | stable-candidate   | `OpenCallout`                                                                                                                                                                                                              |
| `open-card`                                                                  | stable-candidate   | `OpenCard`                                                                                                                                                                                                                 |
| `open-code-block`                                                            | stable-candidate   | `OpenCodeBlock`                                                                                                                                                                                                            |
| `open-dialog`                                                                | stable-candidate   | `OpenDialog`                                                                                                                                                                                                               |
| `open-dropdown`                                                              | stable-candidate   | `OpenDropdown`                                                                                                                                                                                                             |
| `open-input`                                                                 | stable-candidate   | `OpenInput`                                                                                                                                                                                                                |
| `open-tabs`                                                                  | stable-candidate   | `OpenTabs`                                                                                                                                                                                                                 |
| `open-theme-toggle`                                                          | stable-candidate   | `OpenThemeToggle`                                                                                                                                                                                                          |
| `open-props-tokens`                                                          | stable-candidate   | `openPropsRootSheet`, `openPropsTokenSheet`                                                                                                                                                                                |
| `open-props-tokens.js`                                                       | compatibility-only | `openPropsRootSheet`, `openPropsTokenSheet`                                                                                                                                                                                |
| The adapter root `default` export is the `openPipeline` alias. `cli/build`,  |                    |                                                                                                                                                                                                                            |
| `cli/start` and the `create` root are CLI entry modules: `cli/start` exports |                    |                                                                                                                                                                                                                            |
| `extractServeMode` for CLI tests only, and the other two export nothing      |                    |                                                                                                                                                                                                                            |
| importable. `@openelement/app/i18n` stays the optional locale-expansion      |                    |                                                                                                                                                                                                                            |
| integration point with no compatibility promise.                             |                    |                                                                                                                                                                                                                            |

### Semantic owner vs physical source

Where physical source lives in a different package than the canonical semantic
owner (registry of record:
[`SEMANTIC_OWNERSHIP.md`](./SEMANTIC_OWNERSHIP.md)), the tables above classify
the export at its physical location. The split entries, each with its
compatibility reason and removal condition (migration is deliberately deferred
because the physical declarations sit on ADR-0122 frozen paths):

| Export group                                                                                                                                                                                                                                                                    | Semantic owner                                         | Physical source                                                                       | Compatibility reason                                                                                                                                                                                                                                  | Removal condition                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Action/loader protocol: `Action`, `ActionContext`, `ActionResult`, `Loader`, `LoaderContext`, `ProblemDetails`, `ServerRouteContext`, `ServerRouteMetadata`, `SpaAction`, `SpaActionContext`, `SpaLoader`, `SpaLoaderContext`, `ACTION_FETCH_HEADER`, `PROBLEM_JSON_MEDIA_TYPE` | App (loader/action/outcome authoring semantics, #1206) | `@openelement/element` root; declarations in element `internal/protocol/data.ts`      | The retired protocol package collapse placed the declarations in element; the 0.42 freeze (ADR-0122) froze both the element-root re-export and the file. The app root re-exports the same names so application authors import from the semantic owner | Physical move to App requires a major-version ADR amending ADR-0122         |
| Build/framework contract types: `FrameworkOptions`, `RouteEntry`, `AppShellConfig`, `CompatibilityClassification`, `CompatibilityTier`, `ComponentLayer`, `SpecialFileType`                                                                                                     | Adapter Vite (build and deploy contracts)              | `@openelement/element` root; declarations in element `internal/protocol/framework.ts` | Same protocol collapse; consumed only by the adapter, generated code and sibling packages, hence classified internal-importable                                                                                                                       | Physical move to the adapter requires a major-version ADR amending ADR-0122 |
| Route-tree metadata: `OpenElementRouteKind`, `OpenElementRouteNode`                                                                                                                                                                                                             | App route model                                        | `@openelement/element` root; declarations in element `internal/protocol/app-model.ts` | Frozen protocol metadata retained on the element root with zero in-repo consumers, hence compatibility-only                                                                                                                                           | Removable at the next major version under the ADR-0122 amendment gate       |

## 0.41.0 interface freeze boundary (ADR-0119)

Frozen at 0.41.0: the element authoring helper, `definePage`, `buildApp`, the five-package
graph, the supported subpaths above, and the static/SPA semantics of
`defineApp` as shipped — file routes, `tagName` route elements, island
configuration (`ssr`/`dsd`/`hydrate`), DSD output, and the SPA-mode
loader/action chain.

The 0.41 freeze did not cover request-time data, forms, sessions, cache
semantics, the `@openelement/ui` stable scope, or anything marked internal in
the map above. Request-time data and form semantics were later frozen by
ADR-0122; framework session/cache capabilities remain unassigned. Any
post-freeze change to a frozen surface requires a major-version ADR.

Frozen-surface change on the alpha line (ADR-0127, #920): element's
`IslandOptions.strategy` was renamed to `hydrate` in 0.42.0-alpha.16,
matching the app-side `defineIslandConfig({ hydrate })` name; the old name
was deleted with no alias. Migration: rename the option at each
island-definition call site (`strategy` → `hydrate`).

Frozen wording narrowed on the alpha line (ADR-0128, #960): "`tagName` route
elements" now means two distinct things by route kind. On a route whose
default export is `definePage(...)`, the `tagName` export names the content
element only — the page class always registers under the route-path-derived
fallback tag (0.42.0-alpha.17). Plain element routes (no definePage) are
unaffected: their `tagName` export remains the registration tag.

### 0.42 line additions (frozen at 0.42.0 under ADR-0122)

- `definePage({ renderIntent: { mode } })`: `'static'` (default, prerendered) / `'dynamic'` (per-request; the `'auto'` alias was removed in alpha.13, #609)
  rendering modes; `'dynamic'` routes render per request through the
  generated `dist/server/index.js` (0.42.0-alpha.1). The former
  `renderIntent.revalidate` field and all ISR semantics were removed in v0.44
  (issue #1217): no ISR manifest is emitted and no route-level cache
  revalidation exists. Any future ISR capability must be re-earned from real
  evidence (#1221).
- Route-module `loader`/`action`/`actions` exports with the ADR-0120
  protocol: `fail(status, data)` 422 re-render, 303 PRG, named actions via
  `formaction='?/name'` (0.42.0-alpha.2).
- `isActionFailure(value)` type guard and the `OpenElementActionFailure<T>`
  class (app root): the structured failure carrier constructed by `fail()`
  and recognized on both the request-time and SPA action chains.
- `ActionResult` / `ACTION_FETCH_HEADER` wire types and the
  `data-open-enhance` / `data-open-preserve` / `data-open-region`
  enhancement attributes with morph-based continuity (0.42.0-alpha.3).
  Fetch-channel **error** outcomes are RFC 9457 `ProblemDetails` answered as
  `application/problem+json` (`PROBLEM_JSON_MEDIA_TYPE`) since
  0.42.0-alpha.13 (#863, ADR-0123 addendum item 13).

- alpha.13 additions (ADR-0123 train): `Middleware` (element root) and
  `composeFetchMiddleware` (`./build-utils`) — the
  WinterCG-shaped `(request, next) => Response` middleware contract wired
  through `middleware.use` (#858); `cli/preview` merged into
  `cli/start --mode=preview` (#859); `PageRenderingMode` narrowed to
  `'static' | 'dynamic'` (#609).

### v0.44 experimental additions (unfrozen)

| Export (element root)                                 | Class                | Purpose                                                                                                                                                                                                                                                                                                                                 | Removal/move condition                                                                                    |
| ----------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `isDangerousKey`, `injectPropsSafe`, `DANGEROUS_KEYS` | experimental (#1214) | The one canonical prototype-pollution guard shared by page projection (SPA bootstrap, `projectPageProps`) and adapter codegen, which serializes `DANGEROUS_KEYS` into generated server runtimes at build time                                                                                                                           | Kept at the element root at the B1.2 freeze (#1223); may move to a dedicated security subpath before 1.0  |
| `element`, `property`                                 | experimental (#1209) | Compile-time-only decorator intrinsics: the compiler admits them by binding provenance (a runtime named import from `@openelement/element`) and erases them from generated code; evaluated without the compiler (unit tests, config evaluation) they are inert no-ops, carrying no runtime semantics and acting as no second recognizer | Kept at the element root at the B1.2 freeze (#1223); may move to a dedicated authoring subpath before 1.0 |

v0.44 (ADR-0143) also re-shapes existing entries without adding names:
`definePage` takes the compiled page element class as its first argument
(`definePage(CompiledPageClass, { route?, head?, renderIntent?, props?, error? })`)
— the object-descriptor form with a `render` function field is removed, and
the render-scope loader/action data hooks with it; island authoring is a
single-module compiled class plus the scanned `defineIslandConfig` export.
The full mapping is in [`v0.44.0-MIGRATION.md`](./v0.44.0-MIGRATION.md).

## Removed from current graph

The following alpha implementation packages are absorbed and are not supported
consumer imports: `@openelement/core`, `@openelement/signal`,
`@openelement/router`, `@openelement/protocol`, `@openelement/content`, and
`@openelement/ssg`.

Earlier removed product experiments and adapters remain historical only:
`@openelement/i18n`, `@openelement/rpc`, `@openelement/hub`, `@openelement/cem`,
`@openelement/compat-check`, `@openelement/adapter-lit`,
`@openelement/adapter-react`, `@openelement/adapter-vanilla`,
`@openelement/runtime`, and `@openelement/style-sheet`.

## Ownership and runtime rules

- Element owns the browser/runtime implementation and runtime contracts.
- `@preact/signals-core` is Element's internal signal engine, not a consumer
  OpenElement package surface.
- App owns routing and application semantics; its pure router and HTTP integration have separate entry points.
- Adapter Vite owns content, static generation, deployment and build contracts.
- Create templates and current docs may import only retained product packages.
- Runtime-free packages (`element`, `app`, `ui`) contain no Deno or Node host API
  in their public execution paths (gated by `deno task deno-api:check`).
- Build packages (`adapter-vite`, `create`) run on the Deno host and may use
  host APIs behind their public build interfaces (#966: the CLI and template
  builder use `Deno.*` directly — that is in-contract; the scaffolding entry
  is `deno run`). What must stay host-agnostic is their _output_: generated
  artifacts (`dist/server`, `serve.mjs`, the client entries) run on
  Node/Deno/Bun and may use only Web/ES globals plus `node:` builtins.
- Alpha internal packages and subpaths have no compatibility promise.

The package export map, generated resolver table, subpath inventory and
export stability classification above are checked together by
`deno task package-surface:check`. Historical
ADR and release evidence retain their original package names; they are not
current usage documentation.

## Beta.2.1 entry migration (ADR-0152)

`@openelement/app/router` owns records, ordered resolution, separate pathname
captures and `URLSearchParams`. Its dependency graph excludes Element/Hono/Vite.
`@openelement/app/router/http` provides `createRouteMiddleware`, mounted after
host middleware/API routes; URL winner precedes method dispatch. Records group
method handlers, explicit HEAD wins, implicit HEAD uses GET, 405 lists only the
selected record's methods (sorted uppercase, with implicit HEAD). Missing URLs
continue to the host. `methods` defaults to GET in the pure table.

The Element build-utils route normalizer moves to App/router. Generated SPA
manifests now export ordered `routeRecords` (id/path/methods/load), replacing the
path-keyed `routeManifest`. File identity is its normalized relative source path;
file routes sort static, parameter, catch-all, then code-point path/file order.
`definePage().route.path` is removed: filenames own Framework URLs. SPA loaders
and actions receive `searchParams` separately; params no longer project query
values onto a component.

`@openelement/adapter-vite/element` exports `element()` for standalone authoring.
Use that plugin with Vite's normal library build, and register the exported class
in a separate ordinary JS entry. Compiler/runtime communicate through existing
versioned Part Programs; the semantic compiler remains private and is delivered
inside the tooling package. Router is an optional peer of adapter-vite; Framework
applications must install App themselves. Standalone authors install Element,
adapter-vite and Vite; bundled plain-HTML consumers need only the resulting JS.
The packed consumer proof checks registration, event updates, source maps and
browser JS/declaration graphs; this is not full Beta.2.2 qualification.

Navigation API is used where present; history fallback remains for hosts without
it and file:// hash mode retains its demonstrated existing use. Matching is the
same RouteTable in every driver. Chromium 147, Firefox 148 and WebKit 26.4 are the
local test environments, not a newly promised minimum browser version.

| Subpath           | Classification      | Named exports                                                                     |
| ----------------- | ------------------- | --------------------------------------------------------------------------------- |
| App `router`      | experimental        | `RouteTable`, `RouteRecord`, `RouteMatch`, `RouteResolution`, `RouteTableOptions` |
| App `router`      | internal-importable | `normalizeRoutePatternForURLPattern`                                              |
| App `router/http` | experimental        | `createRouteMiddleware`, `HttpRouteRecord`                                        |
| Adapter `element` | experimental        | `element`                                                                         |
