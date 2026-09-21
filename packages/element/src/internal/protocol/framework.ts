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

/**
 * The delivery layer a component belongs to: fully static DSD markup
 * ('dsd-static'), DSD markup with a client island ('dsd-interactive'), a
 * client-only island with no SSR output ('pure-island'), or a light-DOM
 * element ('light-dom'). Recorded per component in the build manifest and
 * consumed by the hydration scheduler.
 */
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

/** Special file kinds the route scanner recognizes by filename: `renderer` and `middleware`. */
export type SpecialFileType = 'renderer' | 'middleware';

/** Locale-aware resolved path contract. */
export interface LocalePath {
  locale: string;
  path: string;
  localizedPath: string;
  isDefaultLocalePath: boolean;
}

/**
 * Application shell declaration: `false` disables the shell entirely,
 * `'default'` uses the built-in shell, and the object form names a tag with the
 * module path that defines it (`import`, resolved like a
 * {@link FrameworkOptions.middleware.use} entry) plus the compiled shell
 * properties the router injects per route.
 */
export type AppShellConfig = false | 'default' | {
  tagName: string;
  import: string;
  props?: Record<string, unknown>;
};
type LayoutsConfig = Record<string, AppShellConfig | undefined>;

/**
 * One route admitted by the scanner: URL `path`, source `filePath`, the
 * route `type`, the generated variable name (`varName`) the entry binds it to,
 * and the optional registration tag. {@link RouteEntry.definePage} and
 * {@link RouteEntry.hasEnhancedForms} carry the two source-derived admission
 * facts the generated entries branch on.
 */
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

/**
 * The adapter-facing framework options: where routes, islands and components
 * live, which renderer serializes pages, the application shell and layout
 * declarations, the document `<html>`/head injection channels, and the
 * request-time middleware switches.
 *
 * Every field is optional; the adapter applies its documented default. This is
 * the type an application config file's default export is checked against, so
 * the rendered option table and the actual config surface cannot drift.
 */
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
  /** Directory the route scanner walks, relative to the Vite root. Defaults to `app/routes`. */
  routesDir?: string;
  /** Directory island modules are discovered in. Defaults to `app/islands`. */
  islandsDir?: string;
  /** Directory non-route components live in. Defaults to `app/components`. */
  componentsDir?: string;
  /** Extra package names whose island modules the build admits, e.g. `['@openelement/ui']`. */
  packageIslands?: string[];
  /** Application shell declaration; `false` disables the shell, `'default'` uses the built-in one. */
  appShell?: AppShellConfig;
  /** Per-layout shell declarations keyed by layout name. */
  layouts?: LayoutsConfig;
  /** Build mode. 'ssg' (default) generates static HTML. */
  mode?: 'ssg';
  /** @dangerous injected as-is, only use with controlled content */
  headExtras?: string;
  /** Document `<html>` attributes: the `lang` the document declares and the default `<title>`. */
  html?: {
    lang?: string;
    title?: string;
  };
  /** Document head/body injection channels: external stylesheets, scripts, and trusted raw head fragments. */
  inject?: {
    /** Stylesheets linked into the document head; each entry is an href or a link record with integrity/crossorigin/attrs. */
    stylesheets?: Array<
      | string
      | {
        href: string;
        integrity?: string;
        crossorigin?: 'anonymous' | 'use-credentials';
        attrs?: Record<string, string | number | boolean>;
      }
    >;
    /** Scripts emitted into the document; each entry is a src or a script record with type/async/defer/integrity/crossorigin/attrs. */
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
  /** SSR bundling switches; `noExternal` forces the named packages through the SSR bundle instead of an external import. */
  ssr?: {
    noExternal?: (string | RegExp)[];
  };
  /** Island defaults applied to every island the build discovers. */
  island?: {
    upgradeStrategy?: HydrationStrategy;
  };
  /** Build output switches: the output directory and the advisory manifest budgets. */
  build?: {
    /** Output directory for the build artifacts. Defaults to `dist`. */
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
  /** Enable the View Transitions API for client navigations. Defaults to true. */
  viewTransition?: boolean;
  /** Speculation Rules emission: `true` uses framework defaults, or pass prerender/prefetch URL lists, exclusions and an eagerness. */
  speculation?: boolean | {
    prerender?: string[];
    prefetch?: string[];
    exclude?: string[];
    eagerness?: 'immediate' | 'moderate' | 'conservative';
  };
  /** Request-time middleware switches, composed outside the framework handler. */
  middleware?: {
    /** Enable the built-in CORS middleware. */
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
    /** Emit and honor a per-request id header. */
    requestId?: boolean;
    /** Log each request through the built-in logger. */
    logger?: boolean;
    /** Attach the built-in security response headers. */
    securityHeaders?: boolean;
    /** Content-Security-Policy emission: the policy string, nonce generation, and report-only mode. */
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

/**
 * How far a discovered tag may participate in the build: 'ssr-capable' renders
 * and hydrates, 'client-only' ships to the browser without server output,
 * 'experimental-dom' is admitted with a downgraded guarantee, and 'rejected'
 * fails the build.
 */
export type CompatibilityTier = 'ssr-capable' | 'client-only' | 'rejected' | 'experimental-dom';

/**
 * The per-tag verdict the compatibility scanner records: the tier a discovered
 * tag was classified as, the human-readable `reason`, where the tag was found
 * (`source`), and the SSR/DSD/hydration facts the verdict was derived from.
 */
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
