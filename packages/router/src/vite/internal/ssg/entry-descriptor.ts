/** Build the entry descriptor and SSR admission plan from scanned project metadata. */
import type {
  ApiRouteDecl,
  AppShellPlan,
  CorsOriginConfig,
  DocumentConfig,
  EntryDescriptor,
  ImportDecl,
  IslandDecl,
  MiddlewareDecl,
  PageRouteDecl,
  RendererDecl,
  ResolvedAppShell,
  SsrAdmissionPlan,
  StaticComponentDecl,
} from '../protocol/ssg.ts';
import type {
  AppShellConfig,
  CompatibilityClassification,
  FrameworkOptions,
  HydrationStrategy,
  OpenElementPackageManifest,
  RouteEntry,
} from '../protocol/framework.ts';
import type { SsrAdmissionDecision } from '@openelement/element';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { DEFAULT_ISLANDS_DIR, DEFAULT_ROUTES_DIR } from '../paths.ts';
import { fileToTagName } from './route-scanner.ts';
import {
  buildPackageIslandDecls,
  expandIslandDeliveryDecl,
  resolveIslandHydrate,
  resolveIslandSsrDsd,
} from './island-scanner.ts';
import {
  type IslandDeliveryMeta,
  type IslandDeliveryStrategy,
  resolveIslandDeliveryTags,
  validateIslandDeliveryExportNames,
} from './delivery.ts';
import { compilerBehaviorDeclarations } from './client-admission.ts';

function normalizeAppShellImport(importPath: string): string {
  if (importPath.startsWith('./')) return `/${importPath.slice(2)}`;
  if (importPath.startsWith('../')) return importPath;
  return importPath;
}

function normalizeAppShell(config: AppShellConfig | undefined): ResolvedAppShell {
  if (config === false || config === undefined || config === 'default') return false;
  return {
    tagName: config.tagName,
    importPath: normalizeAppShellImport(config.import),
    props: config.props ?? {},
  };
}

function buildAppShellPlan(options: {
  appShell?: FrameworkOptions['appShell'];
  layouts?: FrameworkOptions['layouts'];
}): AppShellPlan {
  const defaultShell = normalizeAppShell(options.layouts?.default ?? options.appShell);
  const layouts: Record<string, ResolvedAppShell> = {};
  for (const [name, config] of Object.entries(options.layouts ?? {})) {
    if (name === 'default' || config === undefined) continue;
    layouts[name] = normalizeAppShell(config);
  }
  return { default: defaultShell, layouts };
}

export function buildEntryDescriptor(
  routes: RouteEntry[],
  options: {
    routesDir?: string;
    islandsDir?: string;
    middleware?: FrameworkOptions['middleware'];
    ssg?: boolean;
    islandTagNames?: string[];
    /** Relative file paths for local islands (preserves subdirectory structure) */
    islandFiles?: string[];
    /**
     * Page renderer (Beta.2.2, #1339). 'native' (default) renders pages via
     * renderDsd; 'lit' renders LitElement pages via @openelement/router/lit-ssr.
     * Explicit config only — never inferred from route sources.
     */
    renderer?: 'native' | 'lit';
    /** Local island metadata indexed by tag name. */
    islandMeta?: Record<string, Partial<IslandDecl>>;
    /** Compiled non-island components reachable from local page imports. */
    staticComponents?: StaticComponentDecl[];
    /** Package manifests discovered from npm/JSR packages */
    packageManifests?: OpenElementPackageManifest[];
    /** CEM-derived compatibility classifications (from compatibility classifier) */
    cemClassifications?: CompatibilityClassification[];
    /**
     * #979 (0.43.0-alpha.2): foreign custom-element tags discovered by
     * scanForeignTags() in page/island JSX. Recorded in the admission plan as
     * explicit client-only entries (visibility only — no SSR behavior change).
     */
    foreignTags?: string[];
    /** @security Injected as raw HTML without sanitization */
    headExtras?: string;
    allowHeadExtrasScripts?: boolean;
    html?: { lang?: string; title?: string };
    upgradeStrategy?: HydrationStrategy;
    appShell?: FrameworkOptions['appShell'];
    layouts?: FrameworkOptions['layouts'];
    /** Declared project locales; absent keeps the single-locale descriptor shape. */
    i18n?: { locales: string[]; defaultLocale: string };
  } = {},
): EntryDescriptor {
  const routesDir = options.routesDir || DEFAULT_ROUTES_DIR;
  const islandsDir = options.islandsDir || DEFAULT_ISLANDS_DIR;
  const isSSG = options.ssg === true;
  const renderer = options.renderer ?? 'native';
  if (renderer !== 'native' && renderer !== 'lit') {
    throw new Error(
      `[openElement] renderer must be 'native' or 'lit' (got ${
        JSON.stringify(String(renderer))
      }). ` +
        'Renderer selection is explicit openElement({ renderer }) config and is never inferred.',
    );
  }

  // --- Imports ---
  const imports: ImportDecl[] = [];

  // Always needed
  imports.push({ from: 'hono', names: ['Hono'] });
  // ADR-0121 (#568): default body limit on action POST routes.
  imports.push({ from: 'hono/body-limit', names: ['bodyLimit'], alias: '__bodyLimit' });
  if (renderer === 'lit') {
    // #1339: the lit path never imports the compiled serializer (renderDsd /
    // Part Program kernel) NOR the package root barrel that re-exports it —
    // the pure HTML utilities come from the @openelement/element/html leaf
    // (single implementation source, no runtime kernel in its module graph).
    // Page SSR goes through renderLitPageToHtml from @openelement/router/lit-ssr;
    // trustedHtml is only reached by the (rejected for lit) app-shell path.
    imports.push({
      from: '@openelement/element/html',
      names: ['trustedHtml', 'escapeHtml', 'wrapInDocument'],
    });
    imports.push({
      from: '@openelement/router/lit-ssr',
      names: ['renderLitPageToHtml'],
      alias: '__renderLitPageToHtml',
    });
  } else {
    imports.push({
      from: '@openelement/element',
      names: ['renderDsd', 'trustedHtml', 'escapeHtml', 'wrapInDocument'],
    });
  }
  // #1326: both renderers resolve page meaning through the one Document seam
  // before wrapInDocument serializes it.
  imports.push({
    from: '@openelement/router/document',
    names: ['resolvePageDocument'],
    alias: '__resolvePageDocument',
  });

  // Conditional middleware imports
  const mw = options.middleware;
  if (mw?.requestId !== false) {
    imports.push({ from: 'hono/request-id', names: ['requestId'] });
  }
  if (mw?.logger !== false) {
    imports.push({ from: 'hono/logger', names: ['logger'], alias: 'honoLogger' });
  }
  if (mw?.cors !== false) {
    imports.push({ from: 'hono/cors', names: ['cors'] });
  }
  if (mw?.securityHeaders !== false) {
    imports.push({ from: 'hono/secure-headers', names: ['secureHeaders'] });
  }

  // --- Middleware ---
  const middleware: MiddlewareDecl[] = [];

  if (mw?.requestId !== false) {
    middleware.push({
      kind: 'requestId',
      comment: '1. Request ID - base for logging and error tracking',
    });
  }
  if (mw?.logger !== false) {
    middleware.push({
      kind: 'logger',
      comment: '2. Logger - structured request logging',
    });
  }
  if (mw?.cors !== false) {
    let corsOrigin: CorsOriginConfig | undefined;
    if (mw?.corsOrigin !== undefined) {
      if (typeof mw.corsOrigin === 'string') {
        corsOrigin = mw.corsOrigin;
      } else if (Array.isArray(mw.corsOrigin)) {
        corsOrigin = mw.corsOrigin;
      } else {
        corsOrigin = { type: 'function', body: mw.corsOrigin.toString() };
      }
    }
    middleware.push({
      kind: 'cors',
      comment: '3. CORS - Web Standards (no process.env)',
      config: { corsOrigin },
    });
  }
  if (mw?.securityHeaders !== false) {
    middleware.push({
      kind: 'securityHeaders',
      comment: '4. Security headers',
    });
  }
  if (mw?.csp) {
    middleware.push({
      kind: 'csp',
      comment: '5. Content Security Policy',
      config: { csp: mw.csp },
    });
  }

  // --- Fetch middleware (ADR-0123 item 2, #858) ---
  // Serialized like a function-valued middleware.corsOrigin: the source is
  // inlined into the generated entry, so each middleware must be
  // self-contained (no closures over vite.config.ts scope).
  const fetchMiddleware = (mw?.use ?? []).map((fn, index) => {
    if (typeof fn !== 'function') {
      throw new Error(
        `[openElement] middleware.use[${index}] must be a function ` +
          `(request: Request, next: () => Promise<Response>) => Promise<Response>; got ${typeof fn}.`,
      );
    }
    return fn.toString();
  });

  // --- Routes ---
  const apiRoutes: ApiRouteDecl[] = routes
    .filter((r) => r.type === 'api' && !r.special)
    .map((r) => ({
      kind: 'api' as const,
      path: r.path,
      varName: `$${r.varName}`,
      filePath: r.filePath,
      importPath: `/${routesDir}/${r.filePath}`,
    }));

  const pageRoutes: PageRouteDecl[] = routes
    .filter((r) => r.type === 'page' && !r.special)
    .map((r) => {
      const isDynamic = r.path.includes(':');
      // Param names come from the scanner's filename derivation
      // (RouteEntry.params): re-deriving them from the path pattern turns a
      // catch-all segment `:path{.+}` into the bogus name 'path{.+}' (#1022).
      // The fallback (hand-built descriptors in tests) strips regex bodies.
      const paramNames = isDynamic
        ? (r.params ?? [...r.path.matchAll(/:([^/{]+)(?:\{[^}]*\})?/g)].map((m) => m[1]))
        : [];
      const fallbackTagName = fileToTagName(r.filePath);
      return {
        kind: 'page' as const,
        path: r.path,
        varName: `$${r.varName}`,
        filePath: r.filePath,
        defaultTagName: fallbackTagName,
        // #960 (registration decoupling, Option 2) + #1276 (B1.3-F1): a
        // definePage route's tagName export only names a content element and
        // never drives registration. For every page route the generated entry
        // resolves the SSR tag from the route module's compiled Part Program
        // at evaluation time (__resolvePageTag); the tag here is the
        // resolver's path-derived fallback, used only when the class carries
        // no compiled program.
        tagName: r.definePage === true ? fallbackTagName : (r.tagName || fallbackTagName),
        importPath: `/${routesDir}/${r.filePath}`,
        isDynamic,
        paramNames,
      };
    });

  // --- Special files: _renderer.ts / _middleware.ts (v0.3.0) ---
  const specialRoutes = routes.filter((r) => r.type === 'special');

  const renderers: RendererDecl[] = specialRoutes
    .filter((r) => r.special === 'renderer')
    .map((r) => {
      const scope = r.path.replace(/\/?_renderer$/, '') || '/';
      const depth = scope === '/' ? 0 : scope.split('/').filter(Boolean).length;
      return {
        varName: `$${r.varName}`,
        scope,
        importPath: `/${routesDir}/${r.filePath}`,
        depth,
      };
    })
    .sort((a, b) => b.depth - a.depth);

  const middlewareScopes = specialRoutes
    .filter((r) => r.special === 'middleware')
    .map((r) => ({
      varName: `$${r.varName}`,
      scope: r.path.replace(/\/?_middleware$/, '') || '/',
      importPath: `/${routesDir}/${r.filePath}`,
    }));

  // --- Islands ---
  const islandTagNames = options.islandTagNames || [];
  const islandFiles = options.islandFiles || [];
  const islandMeta = options.islandMeta || {};
  const packageManifests = options.packageManifests || [];

  // #460: islandsDir comes from user config and islandFiles from scanIslands;
  // both must be POSIX-normalized before they become module specifiers.
  const islandsSpecifierDir = normalizeSeparators(islandsDir);
  const localIslands: IslandDecl[] = islandTagNames.map((tagName, i) => {
    const meta = islandMeta[tagName];
    const deliveryMeta = (meta ?? {}) as Partial<IslandDecl> & IslandDeliveryMeta & {
      hydrate?: IslandDeliveryStrategy;
    };
    const hydrate = resolveIslandHydrate(
      deliveryMeta.hydrate as IslandDeliveryStrategy | undefined,
      options.upgradeStrategy,
    );
    const hasDeliveryTags = deliveryMeta.tags !== undefined || deliveryMeta.tagNames !== undefined;
    const deliveryTags = hasDeliveryTags
      ? resolveIslandDeliveryTags(
        tagName,
        deliveryMeta.tags,
        deliveryMeta.tagNames,
        tagName,
      )
      : undefined;
    const exportNames = validateIslandDeliveryExportNames(
      deliveryMeta.exportNames,
      deliveryTags ?? [tagName],
      tagName,
    );
    return {
      tagName,
      modulePath: islandFiles[i]
        ? `/${islandsSpecifierDir}/${normalizeSeparators(islandFiles[i])}`
        : `/${islandsSpecifierDir}/${tagName}.ts`,
      source: 'local',
      ...resolveIslandSsrDsd(deliveryMeta),
      hydrate,
      ...(hydrate === 'media' && deliveryMeta.media !== undefined
        ? { media: deliveryMeta.media }
        : {}),
      ...(deliveryTags === undefined ? {} : { tags: deliveryTags }),
      ...(exportNames === undefined ? {} : { exportNames }),
      reason: meta?.reason,
    } as IslandDecl;
  });

  const packageIslandDecls: IslandDecl[] = buildPackageIslandDecls(
    packageManifests,
    options.upgradeStrategy,
  );

  const compilerBehaviorIslands = compilerBehaviorDeclarations(
    options.staticComponents ?? [],
    options.upgradeStrategy,
  );
  const islandDeclarations: IslandDecl[] = [
    ...localIslands,
    ...compilerBehaviorIslands,
    ...packageIslandDecls,
  ];
  const islands: IslandDecl[] = islandDeclarations.flatMap(expandIslandDeliveryDecl);
  const cemClassifications = options.cemClassifications || [];
  const ssrAdmissionPlan = buildSsrAdmissionPlan(
    islandDeclarations,
    cemClassifications,
    options.foreignTags || [],
  );

  // --- Document ---
  const document: DocumentConfig = {
    lang: options.html?.lang || 'en',
    title: options.html?.title || 'openElement',
    headExtras: options.headExtras || '',
    allowHeadExtrasScripts: options.allowHeadExtrasScripts || false,
  };
  const appShell = buildAppShellPlan({
    appShell: options.appShell,
    layouts: options.layouts,
  });
  if (
    renderer === 'lit' &&
    (appShell.default !== false || Object.values(appShell.layouts).some((shell) => shell !== false))
  ) {
    // #1339 boundary: the lit renderer supports appShell: false only — the
    // shell composition renders through the compiled serializer, which the
    // lit path deliberately never imports. Fail the build loudly instead of
    // silently emitting a shell-less page.
    throw new Error(
      `[openElement] renderer: 'lit' does not support a compiled appShell/layouts yet. ` +
        `Set openElement({ renderer: 'lit', appShell: false }) and drop the layouts config.`,
    );
  }
  const reservedTags = new Set([
    ...pageRoutes.map((route) => route.tagName),
    ...islands.map((island) => island.tagName),
    ...(appShell.default ? [appShell.default.tagName] : []),
    ...Object.values(appShell.layouts).flatMap((shell) => shell ? [shell.tagName] : []),
  ]);
  const staticComponents = (options.staticComponents ?? []).filter((component) =>
    !reservedTags.has(component.tagName)
  );

  return {
    isSSG,
    // #1339: only non-default renderers land on the descriptor, keeping the
    // native descriptor shape byte-identical for existing consumers/tests.
    ...(renderer === 'native' ? {} : { renderer }),
    imports,
    middleware,
    ...(fetchMiddleware.length > 0 ? { fetchMiddleware } : {}),
    apiRoutes,
    pageRoutes,
    staticComponents,
    islands,
    // #569: data-open-enhance forms need the client entry even with zero
    // islands; #951: the dev script injection keys on the same condition.
    hasEnhancedForms: routes.some((route) =>
      route.type === 'page' && route.hasEnhancedForms === true
    ),
    ssrAdmissionPlan,
    cemClassifications,
    renderers,
    middlewareScopes,
    document,
    appShell,
    upgradeStrategy: options.upgradeStrategy || 'idle',
    // Single-locale sites carry no i18n on the descriptor, so their generated
    // entry stays byte-identical to pre-i18n output.
    ...(options.i18n ? { i18n: options.i18n } : {}),
  };
}

export function buildSsrAdmissionPlan(
  islands: IslandDecl[],
  cemClassifications: CompatibilityClassification[] = [],
  foreignTags: string[] = [],
): SsrAdmissionPlan {
  const expandedIslands = islands.flatMap(expandIslandDeliveryDecl);
  const renderableTags: string[] = [];
  const mergedClientOnlyTags: string[] = [];
  const rejectedTags: string[] = [];
  const reasons: Record<string, string> = {};
  const decisions: SsrAdmissionDecision[] = [];
  const seen = new Set<string>();
  const admittedTags = new Set<string>();

  const cemMap = new Map<string, CompatibilityClassification>();
  for (const classification of cemClassifications) {
    cemMap.set(classification.tagName, classification);
  }

  for (const island of expandedIslands) {
    const source = island.source || (island.isPackage ? 'package' : 'local');

    if (seen.has(island.tagName)) {
      const reason = 'duplicate custom element tag';
      rejectedTags.push(island.tagName);
      reasons[island.tagName] = reason;

      if (admittedTags.has(island.tagName)) {
        const rIdx = renderableTags.indexOf(island.tagName);
        if (rIdx !== -1) renderableTags.splice(rIdx, 1);
        const cIdx = mergedClientOnlyTags.indexOf(island.tagName);
        if (cIdx !== -1) mergedClientOnlyTags.splice(cIdx, 1);
        admittedTags.delete(island.tagName);
      }

      decisions.push({
        tagName: island.tagName,
        modulePath: island.modulePath,
        source,
        renderPath: 'rejected',
        reason,
      });
      continue;
    }
    seen.add(island.tagName);

    let renderPath: SsrAdmissionDecision['renderPath'];
    let reason: string;

    const cemClassification = cemMap.get(island.tagName);

    if (cemClassification) {
      const TIER_RENDER_PATH: Record<string, string> = {
        'ssr-capable': 'ssr+client',
        'client-only': 'client-only',
        'experimental-dom': 'client-only',
        rejected: 'rejected',
      };

      const knownTier = cemClassification.tier in TIER_RENDER_PATH;
      renderPath = (TIER_RENDER_PATH[cemClassification.tier] ?? 'client-only') as typeof renderPath;
      reason = knownTier
        ? `CEM ${cemClassification.tier}: ${cemClassification.reason}`
        : `Unknown CEM tier (${cemClassification.tier}) - conservative default to client-only`;
    } else if (island.hydrate === 'only') {
      renderPath = 'client-only';
      reason = island.reason || 'client:only island is excluded from SSR';
    } else if (island.ssr === false) {
      renderPath = 'client-only';
      reason = island.reason || 'openElement.ssr is false';
    } else if (source === 'package') {
      if (island.ssr === true) {
        renderPath = 'ssr+client';
        reason = 'package island with openElement.ssr=true';
      } else {
        renderPath = 'client-only';
        reason =
          'third-party WC package island has no validated SSR capability (explicit client-only interop)';
      }
    } else {
      renderPath = 'ssr+client';
      reason = island.ssr === true ? 'openElement.ssr is true' : 'local island default SSR path';
    }

    if (renderPath === 'ssr+client') {
      renderableTags.push(island.tagName);
      admittedTags.add(island.tagName);
    }
    if (renderPath === 'client-only') {
      mergedClientOnlyTags.push(island.tagName);
      admittedTags.add(island.tagName);
    }
    if (renderPath === 'rejected') {
      rejectedTags.push(island.tagName);
      admittedTags.delete(island.tagName);
    }

    reasons[island.tagName] = reason;
    decisions.push({
      tagName: island.tagName,
      modulePath: island.modulePath,
      source,
      renderPath,
      reason,
    });
  }

  // #979 (0.43.0-alpha.2): record foreign custom-element tags discovered in
  // page/island JSX. Visibility only — the tags stay out of
  // renderableTags/clientOnlyTags/rejectedTags so SSR rendering and hydration
  // behavior are byte-identical to the pre-#979 plan; each tag gets an honest
  // source:'foreign' client-only decision instead of being absent ('unscanned'
  // in the alpha.1 corpus). A foreign tag that collides with an island
  // declaration keeps the island decision.
  const recordedForeignTags: string[] = [];
  for (const tagName of foreignTags) {
    if (seen.has(tagName)) continue;
    seen.add(tagName);

    const cemClassification = cemMap.get(tagName);
    const reason = cemClassification
      ? `CEM ${cemClassification.tier}: ${cemClassification.reason}`
      : 'unscanned-foreign-tag';

    recordedForeignTags.push(tagName);
    reasons[tagName] = reason;
    decisions.push({
      tagName,
      modulePath: '',
      source: 'foreign',
      renderPath: 'client-only',
      reason,
    });
  }

  return {
    renderableTags,
    clientOnlyTags: mergedClientOnlyTags,
    rejectedTags,
    reasons,
    decisions,
    cemClassifications,
    ...(recordedForeignTags.length > 0 ? { foreignTags: recordedForeignTags } : {}),
  };
}
