/**
 * ssg.ts - SSG engine contracts.
 *
 * Runtime-free data contracts consumed by the SSG engine and build adapters.
 * These types keep the SSG engine adapter-agnostic.
 */

import type {
  CompatibilityClassification,
  HydrationStrategy,
  RenderError,
  SsrAdmissionDecision,
} from './framework.ts';

/** Adapter-owned browser delivery strategy, including media-query admission. */
export type IslandDeliveryStrategy = HydrationStrategy | 'media';

// ─── SSG render pipeline options ─────────────────────────────

/** Options passed to the shared SSG render pipeline. */
export interface SsgRenderOptions {
  root: string;
  outDir: string;
  base?: string;
  headExtras?: string;
  html?: { lang?: string; title?: string };
  middleware?: {
    csp?: { policy?: string; reportOnly?: boolean; nonce?: boolean };
  };
  upgradeStrategy?: string;
  viewTransition?: boolean;
  speculation?: boolean | Record<string, unknown>;
  islandTagNames?: string[];
  routesDir?: string;
  /**
   * Policy for dynamic-route render failures (HTTP status >= 500, non-empty
   * render errors, or a renderRoute throw) during SSG.
   * - 'fail' (default): abort the build - a failed page must never ship as a
   *   normal 200 page.
   * - 'warn': log the failure and skip the page (the page is not written and
   *   is not registered in the ISR manifest).
   * @default 'fail'
   */
  dynamicRouteFailure?: 'fail' | 'warn';
}

/** User-facing SSG build behavior switches (OpenElementOptions['ssg']). */
export interface SsgBehaviorOptions {
  /**
   * Policy for dynamic-route render failures during SSG.
   * See {@link SsgRenderOptions.dynamicRouteFailure}.
   */
  dynamicRouteFailure?: 'fail' | 'warn';
}

/** Summary of an SSG render run, returned by ssgRender(). */
export interface SsgRenderSummary {
  /**
   * Static routes whose handler returned a non-200 status. hono/ssg drops
   * these responses (defaultPlugin), so they are not written to disk; they
   * are listed here and in the build log instead of disappearing silently.
   */
  staticNon200: Array<{ path: string; status: number }>;
  /**
   * Non-fatal warnings collected during the SSG run (sitemap generation
   * failures, etc.). Surfaced here so the build summary / release evidence
   * carries them instead of letting them disappear silently.
   */
  warnings: string[];
}

// ─── Entry generator types ───────────────────────────────────

/** Client island entry shape passed to entry generator. */
export interface ClientIslandEntry {
  tagName: string;
  modulePath: string;
  isPackage?: boolean;
  /**
   * Optional named export to register as the custom element constructor.
   * When set (package islands whose chunk dropped `export default` per #638),
   * the client island factory reads `mod[exportName]` instead of `mod.default`.
   * When absent, the factory falls back to `mod.default` (local/route islands).
   */
  exportName?: string;
  strategy: IslandDeliveryStrategy;
  strategySource?: 'default' | 'manifest' | 'component' | 'route';
  ssr?: boolean;
  dsd?: boolean;
  reason?: string;
}

// ─── Route contracts (from routes.ts) ─────────────────────────

export interface ImportDecl {
  from: string;
  names: string[];
  alias?: string;
}

export type CorsOriginConfig = string | string[] | { type: 'function'; body: string };

export interface CspConfig {
  policy?: string;
  nonce?: boolean;
  reportOnly?: boolean;
}

export interface MiddlewareDecl {
  kind: 'requestId' | 'logger' | 'cors' | 'securityHeaders' | 'csp';
  comment?: string;
  config?: {
    corsOrigin?: CorsOriginConfig;
    csp?: CspConfig;
  };
}

export interface ApiRouteDecl {
  kind: 'api';
  path: string;
  varName: string;
  filePath: string;
  importPath: string;
}

export interface PageRouteDecl {
  kind: 'page';
  path: string;
  varName: string;
  filePath: string;
  defaultTagName: string;
  tagName: string;
  importPath: string;
  isDynamic?: boolean;
  paramNames?: string[];
}

export interface IslandDecl {
  tagName: string;
  modulePath: string;
  isPackage?: boolean;
  /**
   * Optional named export to register as the custom element constructor.
   * Set for package islands from the manifest declaration's `className`
   * (the CEM-derived export class name), so the client island factory can
   * read `mod[exportName]` after #638 removed `export default` from UI
   * component chunks. Absent for local/route islands (which use default).
   */
  exportName?: string;
  hydrate?: IslandDeliveryStrategy;
  ssr?: boolean;
  dsd?: boolean;
  authoring?: 'basic-element' | 'third-party-wc';
  source?: 'local' | 'package' | 'nested';
  reason?: string;
}

/**
 * Build-host-only compiled component reached through a route's local import
 * graph. These components participate in recursive SSR/SSG expansion but are
 * not client islands and therefore add no hydration or browser entry.
 */
export interface StaticComponentDecl {
  tagName: string;
  modulePath: string;
  /** Compiler-owned interaction events; empty means no inferred browser entry. */
  compilerInteractionEvents: string[];
}

export interface SsrAdmissionPlan {
  renderableTags: string[];
  clientOnlyTags: string[];
  rejectedTags: string[];
  reasons: Record<string, string>;
  decisions: SsrAdmissionDecision[];
  cemClassifications?: CompatibilityClassification[];
  /**
   * #979 (0.43.0-alpha.2): foreign custom-element tags discovered in page /
   * island JSX that are neither local islands, package-manifest islands, nor
   * openElement-authored elements. Visibility only — each tag also carries a
   * source:'foreign' decision (renderPath 'client-only') and the SSR/behavior
   * is unchanged (opaque passthrough).
   */
  foreignTags?: string[];
}

export interface RendererDecl {
  varName: string;
  scope: string;
  importPath: string;
  depth: number;
}

export interface MiddlewareScopeDecl {
  varName: string;
  scope: string;
  importPath: string;
}

export interface DocumentConfig {
  lang: string;
  title: string;
  headExtras: string;
  allowHeadExtrasScripts: boolean;
}

export interface AppShellDecl {
  tagName: string;
  importPath: string;
  props: Record<string, unknown>;
}

export type ResolvedAppShell = false | AppShellDecl;

export interface AppShellPlan {
  default: ResolvedAppShell;
  layouts: Record<string, ResolvedAppShell>;
}

export interface EntryDescriptor {
  isSSG: boolean;
  /**
   * Page renderer selection (Beta.2.2, #1339). Absent/'native' keeps the
   * compiled renderDsd page path byte-identical; 'lit' forks page tag
   * resolution, page SSR and the client entry onto @lit-labs/ssr.
   * Loader/action/protocol codegen never forks.
   */
  renderer?: 'native' | 'lit';
  imports: ImportDecl[];
  middleware: MiddlewareDecl[];
  /**
   * Serialized `middleware.use` fetch middleware sources (ADR-0123 item 2,
   * #858), in user-configured order. The entry renderer inlines them into the
   * generated entry and composes them around the exported handler in onion
   * order. Absent/empty when the app configures no fetch middleware, keeping
   * the generated entry byte-identical to pre-#858 output.
   */
  fetchMiddleware?: string[];
  apiRoutes: ApiRouteDecl[];
  pageRoutes: PageRouteDecl[];
  staticComponents: StaticComponentDecl[];
  islands: IslandDecl[];
  /**
   * True when any page route carries data-open-enhance forms (#569). Drives
   * the dev island client script injection (#951): an island-free app with
   * enhanced forms still needs the client entry in dev HTML.
   */
  hasEnhancedForms?: boolean;
  ssrAdmissionPlan: SsrAdmissionPlan;
  cemClassifications?: CompatibilityClassification[];
  renderers: RendererDecl[];
  middlewareScopes: MiddlewareScopeDecl[];
  document: DocumentConfig;
  appShell: AppShellPlan;
  upgradeStrategy?: HydrationStrategy;
}

// ─── SSG render pipeline types (from ssg-render.ts) ──────────────

/** Per-page render diagnostics returned by renderRoute() */
export interface SsgPageOutput {
  /** Rendered HTML string */
  html: string;
  /**
   * HTTP status for the rendered page. Undefined on the success path;
   * set for redirect (3xx), not-found (404) and render-failure (500) results.
   */
  status?: number;
  /**
   * Redirect outcome (3xx). When set, `html` holds an interim status page and
   * the result must not be persisted as a normal 200 page.
   */
  redirect?: { location: string; status: number };
  /** True when the route signalled not-found (404). */
  notFound?: boolean;
  /** Render errors collected during rendering */
  errors: RenderError[];
  /** Number of DSD components rendered on this page */
  componentCount: number;
  /** Total render time for all components on this page (ms) */
  renderTimeMs: number;
}

/**
 * A single route metadata entry emitted as `routeInfo` by the generated SSG
 * entry module (see entry-render-ssg.ts).
 */
export interface RouteInfoEntry {
  path: string;
  /**
   * Route module file path. Read by the render pipeline: ssg-render.ts copies
   * it into server-manifest.json for request-time (renderIntent 'dynamic')
   * routes.
   */
  filePath?: string;
  tagName: string;
  /** The route module namespace object (typed per-module at codegen time). */
  module?: unknown;
  isDynamic: boolean;
  paramNames: string[];
  /** Rendering mode declared via renderIntent.mode ("static" when unset; the former "auto" alias was removed in alpha.13, #609). */
  rendering?: string;
  /** True when the route module exports an action (request-time form POST). */
  hasAction?: boolean;
  params?: Record<string, string>;
}

export interface SsrBundle {
  default: unknown;
  routeInfo?: RouteInfoEntry[];
  renderRoute?: (
    path: string,
    opts?: Record<string, unknown>,
  ) => Promise<SsgPageOutput>;
  getStaticPaths?: (path: string) => Promise<Array<Record<string, string>>>;
  [key: string]: unknown;
}

export interface SsgRenderEvidence {
  i18nOptions?: {
    locales: string[];
    defaultLocale?: string;
    [key: string]: unknown;
  } | null;
  /** SSR admission decisions from the plan that rendered the pages. */
  admissionDecisions?: SsrAdmissionDecision[];
  onPrintBuildManifest?: (input: {
    root: string;
    outDir: string;
    phase: 3;
    headExtras?: string;
  }) => void | Promise<void>;
}

// ─── Post-processing types (from postprocess.ts) ─────────────────

/** Speculation Rules configuration for SSG post-processing */
export interface SpeculationRulesOptions {
  /**
   * URL patterns to prerender (fully render in background before navigation).
   */
  prerender?: string[];

  /**
   * URL patterns to prefetch (fetch HTML + resources without rendering).
   */
  prefetch?: string[];

  /**
   * URL patterns to exclude from both prefetch and prerender.
   */
  exclude?: string[];

  /**
   * Eagerness level for prerender rules.
   * @default 'moderate'
   */
  eagerness?: 'immediate' | 'moderate' | 'conservative';
}

// ─── BuildPlan / BuildArtifacts contracts (alpha.5 T2) ───────────

/** A single route input to the build pipeline. */
export interface BuildRouteInput {
  /** Route kind: page or API. */
  kind: 'page' | 'api';
  /** Route path (e.g. '/about', '/blog/:slug'). */
  path: string;
  /** Absolute or relative file path of the route module. */
  filePath: string;
  /** Import specifier used by generated entry code. */
  importPath: string;
  /** Resolved tag name for page routes. */
  tagName?: string;
  /** Dynamic segment names. */
  paramNames?: string[];
  /** Static generation params produced by getStaticPaths(). */
  staticParams?: Array<Record<string, string>>;
}

/** A single island input to the build pipeline. */
export interface BuildIslandInput {
  tagName: string;
  modulePath: string;
  isPackage?: boolean;
  hydrate?: IslandDeliveryStrategy;
  ssr?: boolean;
  dsd?: boolean;
  source?: 'local' | 'package' | 'nested';
  reason?: string;
}

/** Output configuration for the build pipeline. */
export interface BuildOutputOptions {
  /** Project root directory. */
  root?: string;
  /** Output directory relative to root. */
  outDir?: string;
  /** Base URL path. */
  base?: string;
  /** If true, emit a client-only SPA bundle instead of SSG. */
  spa?: boolean;
}

/** i18n configuration for the build pipeline. */
export interface BuildI18nOptions {
  locales: string[];
  defaultLocale?: string;
}

/** Package island configuration for the build pipeline. */
export interface BuildPackageIslandOptions {
  /** Package names that may expose island declarations. */
  packages?: string[];
}

/** Framework-agnostic plan consumed by the OpenElement build pipeline. */
export interface BuildPlan {
  /** User-facing framework options. */
  options: import('./framework.ts').FrameworkOptions;
  /** Discovered page and API routes. */
  routes: BuildRouteInput[];
  /** Discovered local and package islands. */
  islands: BuildIslandInput[];
  /** Output configuration. */
  output: BuildOutputOptions;
  /** i18n expansion options. */
  i18n?: BuildI18nOptions;
  /** Package island discovery options. */
  packageIslands?: BuildPackageIslandOptions;
}

/** A single generated HTML page artifact. */
export interface BuildPageArtifact {
  path: string;
  html: string;
  /** Errors collected while rendering this page. */
  errors: Array<{ message: string; route?: string }>;
}

/** Manifest produced by the build pipeline. */
export interface BuildManifestArtifact {
  routes: Array<{ kind: 'page' | 'api'; path: string; tagName?: string; isDynamic: boolean }>;
  islands: BuildIslandInput[];
  /**
   * Paths served at request time (renderIntent mode 'dynamic', 0.42.0-alpha.1
   * / ADR-0120). Absent for pure-static builds.
   */
  requestTimeRoutes?: string[];
}

/** A single client asset emitted by the build pipeline. */
export interface BuildClientAsset {
  fileName: string;
  source: string | Uint8Array;
  sizeBytes: number;
}

/** Result returned by the OpenElement build pipeline. */
export interface BuildArtifacts {
  /** Generated HTML pages. */
  pages: BuildPageArtifact[];
  /** Build manifest. */
  manifest: BuildManifestArtifact;
  /** Client-side assets (island bundles, CSS, etc). */
  clientAssets: BuildClientAsset[];
  /** Non-fatal warnings. */
  warnings: string[];
  /** Fatal errors. */
  errors: string[];
  /** Whether the build succeeded. */
  success: boolean;
}
