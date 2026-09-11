/**
 * @openelement/router - openElement Build Context
 *
 * Shared mutable state for all openElement Vite plugins.
 * Replaces the closure-captured variables (scannedIslandTagNames, etc.)
 * with a single object that's explicitly passed around.
 *
 * Also replaces the .openElement/ temp directory as IPC between build phases:
 * - Phase 1 (open:build) writes metadata -> ctx fields
 * - Phase 2 (build-client) reads metadata -> ctx fields
 * - Phase 3 (build-ssg) reads metadata -> ctx fields
 * - Sub-plugins (openContent, openI18n) write their data -> ctx fields
 *
 * ctx is passed via explicit parameter - no globalThis or module-level discovery.
 * use openElement() from @openelement/router for the recommended unified entry.
 *
 * Fields are grouped by Phase to improve type safety and maintainability.
 */

import type { Alias, ResolvedConfig } from 'vite';
import type {
  CompatibilityClassification,
  FrameworkOptions,
  HydrationStrategy,
  OpenElementBlogOptions,
  OpenElementHeaderNavLink,
  OpenElementI18nContextOptions,
  OpenElementNavSection,
  OpenElementPackageManifest,
  RouteEntry,
} from './internal/protocol/framework.ts';
import type {
  BuildArtifacts,
  BuildPlan,
  IslandDecl,
  SsrAdmissionPlan,
  StaticComponentDecl,
} from './internal/protocol/ssg.ts';
import {
  DEFAULT_COMPONENTS_DIR,
  DEFAULT_ISLANDS_DIR,
  DEFAULT_OUT_DIR,
  DEFAULT_ROUTES_DIR,
} from './internal/paths.ts';

export type Phase = 1 | 2 | 3;

class Phase1Meta {
  /** Cached routes from buildStart() for virtual entry regeneration */
  cachedRoutes: RouteEntry[] = [];

  /** Compiled non-island components reachable from local page imports. */
  staticComponents: StaticComponentDecl[] = [];

  /** Exact compiler-proven components selected for browser delivery. */
  compilerBehaviorDecls: IslandDecl[] = [];

  /** Island tag names discovered during route scanning (local islands) */
  islandTagNames: string[] = [];

  /** Relative file paths for local islands */
  islandFiles: string[] = [];

  /** Local island metadata indexed by tag name. */
  islandMeta: Record<string, Partial<IslandDecl>> = {};

  /** Package manifests discovered from npm/JSR packages */
  packageManifests: OpenElementPackageManifest[] = [];

  /** Package island declarations extracted from manifests */
  packageIslandDecls: IslandDecl[] = [];

  /** SSR admission plan produced before SSR entry generation. */
  ssrAdmissionPlan: SsrAdmissionPlan | null = null;

  /** v0.18.0: CEM-derived compatibility classifications from the classifier. */
  cemClassifications: CompatibilityClassification[] = [];

  /**
   * #979 (0.43.0-alpha.2): foreign custom-element tags discovered in
   * page/island JSX (visibility-only admission entries; no behavior change).
   */
  foreignTags: string[] = [];

  /** SPA mode active (skips SSR entry generation + SSG rendering) */
  isSpa?: boolean;

  /** User-provided resolve.alias in its original format */
  userResolveAlias: Record<string, string> | Alias[] | null = null;
}

class Phase3Meta {
  /** Project root directory */
  root: string = '';

  /** Output directory (default: 'dist') */
  outDir: string = 'dist';

  /** Base URL path (default: '/') */
  base: string = '/';

  /** Middleware config from createOpenPlugin() options */
  middleware: FrameworkOptions['middleware'] | null = null;

  /** HTML document options from createOpenPlugin() options */
  html: { lang?: string; title?: string } | null = null;

  /** Island hydration strategy (default: 'idle') */
  upgradeStrategy: HydrationStrategy = 'idle';

  /** View Transitions enabled (default: true) */
  viewTransition: boolean = true;

  /** Speculation Rules config from createOpenPlugin() options */
  speculation: FrameworkOptions['speculation'] | null = null;

  /** Extra HTML to inject into <head> */
  headExtras: string = '';

  /** Build manifest budget thresholds in KB. */
  manifestBudget: NonNullable<FrameworkOptions['build']>['manifestBudget'] = undefined;

  /** Whether headExtras scripts were produced by structured injection APIs. */
  allowHeadExtrasScripts: boolean = false;

  /** Application shell rendered around routes. */
  appShell: FrameworkOptions['appShell'] = undefined;

  /** Named route layouts selected by route meta. */
  layouts: FrameworkOptions['layouts'] = undefined;

  /** SSR noExternal patterns. Accept strings or serialized RegExp objects.
   * Callers should use the plain-object form `{ __type: 'RegExp', source, flags }`
   * rather than passing RegExp instances directly. */
  ssrNoExternal: (string | { __type: 'RegExp'; source: string; flags: string })[] = [];

  /** Routes directory */
  routesDir: string = DEFAULT_ROUTES_DIR;

  /** Islands directory */
  islandsDir: string = DEFAULT_ISLANDS_DIR;

  /** Components directory */
  componentsDir: string = DEFAULT_COMPONENTS_DIR;
}

export class OpenElementBuildContext {
  /** Canonical production plan computed once after Phase 1 discovery. */
  buildPlan: BuildPlan | null = null;

  /** Canonical result consumed by release evidence and deployment adapters. */
  buildArtifacts: BuildArtifacts | null = null;
  /** Phase 1: Route scanning & build metadata */
  readonly phase1: Phase1Meta = new Phase1Meta();

  /** Phase 3: SSG rendering state */
  readonly phase3: Phase3Meta = new Phase3Meta();

  /** Plugin data from content/i18n sub-plugins */
  readonly plugins: {
    blogOptions: OpenElementBlogOptions | null;
    navSections: OpenElementNavSection[];
    headerNav: OpenElementHeaderNavLink[];
    sitemapOptions: Record<string, unknown> | null;
    i18nOptions: OpenElementI18nContextOptions | null;
  } = {
    blogOptions: null,
    navSections: [],
    headerNav: [],
    sitemapOptions: null,
    i18nOptions: null,
  };

  /** Resolved framework options with defaults applied (read-only after construction) */
  readonly options: FrameworkOptions;

  /** Tracks which build phases have completed. */
  private completed = new Set<Phase>();

  constructor(options: FrameworkOptions) {
    this.options = options;
  }

  /** Register plugin data by name. */
  registerPlugin<K extends keyof OpenElementBuildContext['plugins']>(
    name: K,
    instance: OpenElementBuildContext['plugins'][K],
  ): void {
    this.plugins[name] = instance;
  }

  /** Mark a phase as complete, enforcing ordering constraints. */
  markComplete(phase: Phase): void {
    // Phase 2 (client build) requires Phase 1 (route scanning) only.
    // Phase 2 runs after Phase 3 (SSG) per ADR 0023; it does NOT require Phase 3.
    if (phase === 2 && !this.completed.has(1)) {
      throw new Error('Phase 2 requires Phase 1 to be completed first');
    }
    if (phase === 3 && !this.completed.has(1)) {
      throw new Error('Phase 3 requires Phase 1 to be completed first');
    }
    this.completed.add(phase);
  }

  /** Check whether a phase has been completed. */
  isComplete(phase: Phase): boolean {
    return this.completed.has(phase);
  }

  /** Populate Phase 3 invariants from resolved Vite config and framework options. */
  populatePhase3(
    options: FrameworkOptions & { allowHeadExtrasScripts?: boolean },
    config: ResolvedConfig,
    ssrNoExternal: (string | { __type: 'RegExp'; source: string; flags: string })[],
  ): void {
    let base = config.base || '/';
    if (!base.endsWith('/')) base += '/';

    this.phase3.root = config.root;
    this.phase3.outDir = options.build?.outDir || DEFAULT_OUT_DIR;
    this.phase3.base = base;
    this.phase3.ssrNoExternal = ssrNoExternal;
    this.phase3.routesDir = options.routesDir || DEFAULT_ROUTES_DIR;
    this.phase3.islandsDir = options.islandsDir || DEFAULT_ISLANDS_DIR;
    this.phase3.componentsDir = options.componentsDir || DEFAULT_COMPONENTS_DIR;
    this.phase3.middleware = options.middleware || null;
    this.phase3.html = options.html || null;
    this.phase3.upgradeStrategy = options.island?.upgradeStrategy || 'idle';
    this.phase3.viewTransition = options.viewTransition ?? true;
    this.phase3.speculation = options.speculation ?? null;
    this.phase3.headExtras = options.headExtras || '';
    this.phase3.manifestBudget = options.build?.manifestBudget;
    this.phase3.allowHeadExtrasScripts = options.allowHeadExtrasScripts || false;
    this.phase3.appShell = options.appShell;
    this.phase3.layouts = options.layouts;
  }

  /** Reset all mutable state (for watch mode / testing) */
  reset(): void {
    this.completed.clear();
    this.buildPlan = null;
    this.buildArtifacts = null;

    const userResolveAlias = this.phase1.userResolveAlias;
    // NOTE: userResolveAlias is NOT reset - it's user configuration, not
    // build state. It's set in config()/configResolved() and must persist
    // through buildStart() for Phase 2 and 3 to use.
    Object.assign(this.phase1, new Phase1Meta(), { userResolveAlias });
    Object.assign(this.phase3, new Phase3Meta());
    Object.assign(this.plugins, {
      blogOptions: null,
      navSections: [],
      headerNav: [],
      sitemapOptions: null,
      i18nOptions: null,
    });
  }
}
