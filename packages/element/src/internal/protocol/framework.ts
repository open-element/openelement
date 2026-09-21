/**
 * framework.ts - Framework, build, app-shell, routing, and plugin
 * metadata contracts.
 */

// --- Safe/Unsafe HTML Contract ------------------------------------

/** Branded type: a string that has been HTML-escaped (safe for text content) */
export type SafeHtml = string & { readonly __safeHtml: unique symbol };

/** Branded type: a string that is intentionally raw/untrusted HTML */
export type UnsafeHtml = string & { readonly __unsafeHtml: unique symbol };

// --- Component layer & hydration ----------------------------------

export type ComponentLayer = 'dsd-static' | 'dsd-interactive' | 'pure-island' | 'light-dom';

/** Runtime list of supported hydration strategies; the single source of truth
 * for the `HydrationStrategy` union. Consumed by island/registry validation and
 * re-exported from the element root for app and build adapters. */
export const HYDRATION_STRATEGIES = ['load', 'idle', 'visible', 'only'] as const;
/** Island hydration trigger: 'load' | 'idle' | 'visible' | 'only'. */
export type HydrationStrategy = typeof HYDRATION_STRATEGIES[number];
export type StrategySource = 'default' | 'manifest' | 'component' | 'route';

// --- Blog / Content / i18n build types ----------------------------

/** Blog options stored in the build context by @openelement/content. */
export interface OpenElementBlogOptions {
  contentDir?: string;
  basePath?: string;
}

/** Navigation section from @openelement/content. */
export interface OpenElementNavSection {
  section: string;
  items: Array<{ path: string; label: string; order?: number }>;
}

/** Header navigation link. */
export interface OpenElementHeaderNavLink {
  href: string;
  label: string;
}

/** i18n options stored in the build context by @openelement/i18n. */
export interface OpenElementI18nContextOptions {
  locales: string[];
  defaultLocale: string;
  [key: string]: unknown;
}

/** Minimal build context interface that sub-plugins can use. */
export interface OpenElementBuildContextLike {
  plugins: {
    blogOptions: OpenElementBlogOptions | null;
    navSections: OpenElementNavSection[];
    headerNav: OpenElementHeaderNavLink[];
    sitemapOptions: Record<string, unknown> | null;
    i18nOptions: OpenElementI18nContextOptions | null;
    [key: string]: unknown;
  };
  /** Register plugin data by name. Protocol level uses loose typing;
   * concrete implementations should tighten the generic constraint. */
  registerPlugin(name: string, instance: unknown): void;
}

// --- Routing types ------------------------------------------------

export type SpecialFileType = 'renderer' | 'middleware';

/** Locale-aware resolved path contract. */
export interface LocalePath {
  locale: string;
  path: string;
  localizedPath: string;
  isDefaultLocalePath: boolean;
}

export type AppShellConfig = false | 'default' | {
  tagName: string;
  import: string;
  props?: Record<string, unknown>;
};
type LayoutsConfig = Record<string, AppShellConfig | undefined>;

export interface RouteEntry {
  path: string;
  filePath: string;
  type: 'page' | 'api' | 'island' | 'special';
  varName: string;
  tagName?: string;
  /**
   * True when the route module's default export is a definePage() definition
   * (0.42.0-alpha.17, #960 — registration decoupling). The generated entry
   * registers the page class under the path-derived fallback tag and IGNORES
   * the tagName export for registration: on a definePage route the export
   * only names a content element. Plain element routes keep tagName as their
   * registration tag.
   */
  definePage?: boolean;
  /** Source text captured during scanning when includeSource is enabled. */
  source?: string;
  /**
   * True when the page route source carries data-open-enhance (0.42.0-alpha.5,
   * #569): the client entry must ship the form-enhancement layer even when the
   * app has zero islands.
   */
  hasEnhancedForms?: boolean;
  special?: SpecialFileType;
  params?: string[];
}

// --- Framework Options --------------------------------------------

/**
 * Fetch middleware contract (#858): WinterCG shape,
 * dialect-free — no Hono/h3 context object. Composed at the handler boundary
 * in onion order (`use[0]` is outermost: it sees the request first and the
 * response last), so it runs with identical semantics in the dev server, the
 * `start` CLI, the e2e fixture server, and the Nitro production entry.
 *
 * A middleware may short-circuit by returning a Response without calling
 * `next()`, or post-process the Response that `next()` returns.
 *
 * Module contract: a Middleware is the DEFAULT EXPORT of a module referenced
 * from `middleware.use` by path (e.g. './app/middleware/auth.ts'). The
 * generated server entry imports the module, so the middleware may close over
 * module scope and import local helpers and third-party packages — it is a
 * real module in the server module graph, never serialized source.
 */
export type Middleware = (request: Request, next: () => Promise<Response>) => Promise<Response>;

export interface FrameworkOptions {
  /**
   * Page renderer selection (Beta.2.2, #1339). EXPLICIT, never inferred:
   * 'native' (default) renders pages through the compiled Part Program
   * serializer (renderDsd); 'lit' renders LitElement pages through
   * @lit-labs/ssr and hydrates them with @lit-labs/ssr-client. Routing,
   * loaders, actions, form enhancement and morphing are shared; only page
   * rendering and the client claim layer fork. 'lit' currently requires
   * `appShell: false` (no compiled shell); the build fails closed otherwise.
   */
  renderer?: 'native' | 'lit';
  routesDir?: string;
  islandsDir?: string;
  componentsDir?: string;
  packageIslands?: string[];
  appShell?: AppShellConfig;
  layouts?: LayoutsConfig;
  /** Build mode. 'ssg' (default) generates static HTML. */
  mode?: 'ssg';
  /** @dangerous injected as-is, only use with controlled content */
  headExtras?: string;
  html?: {
    lang?: string;
    title?: string;
  };
  inject?: {
    stylesheets?: Array<
      | string
      | {
        href: string;
        integrity?: string;
        crossorigin?: 'anonymous' | 'use-credentials';
        attrs?: Record<string, string | number | boolean>;
      }
    >;
    scripts?: Array<
      | string
      | {
        src: string;
        type?: string;
        async?: boolean;
        defer?: boolean;
        integrity?: string;
        crossorigin?: 'anonymous' | 'use-credentials';
        attrs?: Record<string, string | number | boolean>;
      }
    >;
    /**
     * @dangerous fragments injected as-is. Trust boundary (same level as
     * `trustedHtml`): never concatenate user-controlled content into these
     * fragments; sanitize untrusted data at your own system boundary first.
     * The framework only enforces no-`<script>` and no-executable-`<style>`.
     */
    headFragments?: string[];
  };
  ssr?: {
    noExternal?: (string | RegExp)[];
  };
  island?: {
    upgradeStrategy?: HydrationStrategy;
  };
  build?: {
    outDir?: string;
    /**
     * Advisory only: exceeded budgets print build-manifest warnings and never
     * fail the build; enforce them in your own build-output test.
     */
    manifestBudget?: {
      islandKB?: number;
      totalJsKB?: number;
      pageKB?: number;
    };
  };
  viewTransition?: boolean;
  speculation?: boolean | {
    prerender?: string[];
    prefetch?: string[];
    exclude?: string[];
    eagerness?: 'immediate' | 'moderate' | 'conservative';
  };
  middleware?: {
    cors?: boolean;
    /**
     * Static CORS allowlist data, serialized into the generated entry as JSON.
     * Mutually exclusive with {@link FrameworkOptions.middleware.corsOriginModule}.
     */
    corsOrigin?: string | string[];
    /**
     * Path to a module that default-exports
     * `(origin: string) => string | undefined`. The generated entry imports
     * the module — the callback is never serialized — so it may close over
     * module scope and import dependencies. Resolved with the same idiom as
     * `appShell.import` (e.g. './app/cors-origin.ts'). Mutually exclusive
     * with `corsOrigin`.
     */
    corsOriginModule?: string;
    requestId?: boolean;
    logger?: boolean;
    securityHeaders?: boolean;
    csp?: {
      policy?: string;
      nonce?: boolean;
      reportOnly?: boolean;
    };
    /**
     * Fetch middleware chain (#858), composed around the
     * framework handler in onion order (`use[0]` outermost), outside all
     * built-in middleware above. Each entry is a MODULE PATH (same resolution
     * idiom as `appShell.import`, e.g. './app/middleware/auth.ts') whose
     * default export is a {@link Middleware}; the generated entry emits
     * `import * as __mw_N from '<path>'` and composes `__mw_N.default` in
     * configured order.
     */
    use?: string[];
  };
}

// --- Compatibility types ------------------------------------------

export type CompatibilityTier = 'ssr-capable' | 'client-only' | 'rejected' | 'experimental-dom';

export interface CompatibilityClassification {
  tagName: string;
  tier: CompatibilityTier;
  reason: string;
  source: 'local' | 'package' | 'nested';
  modulePath?: string;
  ssr?: boolean;
  dsd?: boolean;
  hydrate?: string;
}
