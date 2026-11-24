/** Build the entry descriptor and SSR admission plan from scanned project metadata. */
import type {
  ApiRouteDecl,
  LayoutPlan,
  CorsOriginConfig,
  DocumentConfig,
  EntryDescriptor,
  ImportDecl,
  IslandDecl,
  MiddlewareDecl,
  PageRouteDecl,
  RendererDecl,
  ResolvedLayout,
  SsrAdmissionPlan,
  StaticComponentDecl,
} from '@openelement/protocol/ssg';
import type {
  LayoutConfig,
  CompatibilityClassification,
  FrameworkOptions,
  HydrationStrategy,
  OpenElementPackageManifest,
} from '../../framework.ts';
import type { SsrAdmissionDecision } from '@openelement/element';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { DEFAULT_ISLANDS_DIR, DEFAULT_ROUTES_DIR } from '../paths.ts';
import { fileToTagName } from './route-scanner.ts';
import type { ScannedRouteEntry } from './route-scanner.ts';
import {
  attachPackageIslandHostIdentities,
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
import {
  type GeneratedElementHostCarrier,
  readGeneratedElementHost,
} from './generated-element-host-metadata.ts';
import { selectRendererAdapter } from './renderer-adapter.ts';
import {
  buildPageClassificationContext,
  classifyPageRoute,
  PageClassificationCode,
  pageKindOf,
  type GeneratedElementPageFact,
  type PageKindCarrier,
} from './page-classification.ts';
import type { RouteDocumentStyleLinks } from './entry-route-helpers.ts';
import { buildError, DescriptorErrorCode } from '../../../internal/error-codes.ts';

function normalizeLayoutImport(importPath: string): string {
  if (importPath.startsWith('./')) return `/${importPath.slice(2)}`;
  if (importPath.startsWith('../')) return importPath;
  return importPath;
}

function normalizeLayout(config: LayoutConfig | undefined): ResolvedLayout {
  if (config === false || config === undefined || config === 'default') return false;
  return {
    tagName: config.tagName,
    importPath: normalizeLayoutImport(config.import),
    props: config.props ?? {},
  };
}

function buildLayoutPlan(options: {
  layout?: FrameworkOptions['layout'];
  layouts?: FrameworkOptions['layouts'];
  /**
   * The declared-tag scan's compiler fact, keyed by stable module id. A
   * convention layout that is a GENERATED element is identified by its module's
   * declared tag; this is where its `ssrHostExport` comes from, so the entry can
   * register the generated host PAIR instead of a bare class.
   */
  declaredTags?: ReadonlyMap<string, string>;
  declaredHostExports?: ReadonlyMap<string, string>;
}): LayoutPlan {
  const defaultLayout = normalizeLayout(options.layouts?.default ?? options.layout);
  const layouts: Record<string, ResolvedLayout> = {};
  for (const [name, config] of Object.entries(options.layouts ?? {})) {
    if (name === 'default' || config === undefined) continue;
    layouts[name] = normalizeLayout(config);
  }
  // Attach the compiler fact to every layout that is a generated element. The
  // lookup is by DECLARED TAG (the module's own sidecar identity), never by a
  // path guess: a layout whose module declares no tag keeps the class path.
  const byTag = new Map<string, string>();
  for (const [moduleId, tag] of options.declaredTags ?? []) {
    const hostExport = options.declaredHostExports?.get(moduleId);
    if (hostExport !== undefined) byTag.set(tag, hostExport);
  }
  const withHost = (layout: ResolvedLayout): ResolvedLayout => {
    if (layout === false) return layout;
    const generatedHostExport = byTag.get(layout.tagName);
    return generatedHostExport === undefined ? layout : { ...layout, generatedHostExport };
  };
  const defaultResolved = withHost(defaultLayout);
  const resolvedLayouts: Record<string, ResolvedLayout> = {};
  for (const [name, layout] of Object.entries(layouts)) resolvedLayouts[name] = withHost(layout);
  return { default: defaultResolved, layouts: resolvedLayouts };
}

export function buildEntryDescriptor(
  routes: ScannedRouteEntry[],
  options: {
    routesDir?: string;
    islandsDir?: string;
    middleware?: FrameworkOptions['middleware'];
    ssg?: boolean;
    islandTagNames?: string[];
    /** Relative file paths for local islands (preserves subdirectory structure) */
    islandFiles?: string[];
    /**
     * Page renderer. Only 'native' (the default, compiled renderToString) is
     * supported; a retired 'lit' value fails closed in selectRendererAdapter.
     */
    renderer?: 'native';
    /** Local island metadata indexed by tag name. */
    islandMeta?: Record<string, Partial<IslandDecl>>;
    /** Compiled non-island components reachable from local page imports. */
    staticComponents?: StaticComponentDecl[];
    /** Package manifests discovered from npm packages */
    packageManifests?: OpenElementPackageManifest[];
    /** CEM-derived compatibility classifications (from compatibility classifier) */
    cemClassifications?: CompatibilityClassification[];
    /**
     * #979: foreign custom-element tags discovered by
     * scanForeignTags() in page/island JSX. Recorded in the admission plan as
     * explicit client-only entries (visibility only — no SSR behavior change).
     */
    foreignTags?: string[];
    /** @security Injected as raw HTML without sanitization */
    headExtras?: string;
    allowHeadExtrasScripts?: boolean;
    html?: { lang?: string; title?: string };
    upgradeStrategy?: HydrationStrategy;
    layout?: FrameworkOptions['layout'];
    layouts?: FrameworkOptions['layouts'];
    /**
     * The declared-tag scan's compiler facts (alpha16 layout-pair slice): the
     * module -> tag map and the module -> compiler-emitted host export map. A
     * convention layout that is a generated element needs them to be registered
     * through the host PAIR channel; absent maps keep every class layout's bytes.
     */
    declaredElementTags?: ReadonlyMap<string, string>;
    declaredElementHostExports?: ReadonlyMap<string, string>;
    /**
     * #1411: emit the default-CORS production advisory into the generated
     * entry. The dev server passes false so a first dev run is warning-free;
     * production builds keep the warning (default true).
     */
    warnOnDefaultCors?: boolean;
    /** Declared project locales; absent keeps the single-locale descriptor shape. */
    i18n?: { locales: string[]; defaultLocale: string };
    /**
     * Build-only route → document stylesheet facts (task12), obtained by the
     * build from the router's internal carrier getter. Rides the descriptor as
     * a build-only side channel (never the public protocol shape / PageRouteDecl).
     */
    routeDocumentStyleLinks?: RouteDocumentStyleLinks;
  } = {},
): EntryDescriptor {
  const routesDir = options.routesDir || DEFAULT_ROUTES_DIR;
  const islandsDir = options.islandsDir || DEFAULT_ISLANDS_DIR;
  const isSSG = options.ssg === true;
  const adapter = selectRendererAdapter(options.renderer);

  // --- Imports ---
  const imports: ImportDecl[] = [];

  // The generated-app factory (#1470 block e): the entry's
  // assembly — the WinterCG app, the composed handler exports, the
  // registry guard, and the page-render bindings — is the imported runtime;
  // the entry keeps imports + descriptor data + wiring. It replaces the
  // entry-emitted `new Hono()` and the bridge import.
  imports.push({ from: '@openelement/router/server-runtime', names: ['createGeneratedApp'] });
  imports.push(...adapter.serverImports());
  // #1326: page meaning is resolved through the one Document seam before
  // wrapInDocument serializes it.
  imports.push({
    from: '@openelement/router/document',
    names: ['resolvePageDocument'],
    alias: '__resolvePageDocument',
  });
  // The action protocol response-channel negotiation header (the Vary value
  // the POST preamble sets) — the wire constant from the runtime module,
  // never a literal in generated code (#743). The 405 fallback sets it inside
  // the typed dispatch module.
  imports.push({
    from: '@openelement/router/server-runtime',
    names: ['ACTION_FETCH_HEADER'],
    alias: '__actionFetchHeader',
  });
  // The response-header channel and CSP auto-nonce are runtime modules the
  // generated handlers call — the entry imports them instead of carrying
  // emitted function bodies. Needed only when a page handler exists (every
  // page/not-found handler merges the channel), plus the stream channel when
  // any page streams.
  if (routes.some((route) => route.type === 'page' && !route.special)) {
    imports.push({
      from: '@openelement/router/server-runtime',
      names: ['mergeChannelHeaders'],
      alias: '__mergeChannelHeaders',
    });
    // The server function page render seam (alpha15 server lane, M14
    // full-await): generated routes call the published awaited entry on
    // `@openelement/router/server-runtime`. It shares the sync seam's
    // boundary checks (render is a function; props never carry the
    // compiler-owned `children` channel) and waits for an async render
    // before the HTML string exists. Emitted only when a function-page
    // route exists, so a class-page-only entry stays byte-identical.
    // The render seam import is gated by the build-time page-kind fact (M11-1),
    // the same fact the emitted call sites branch on.
    if (routes.some((route) => pageKindOf(route) === 'function-page')) {
      imports.push({
        from: '@openelement/router/server-runtime',
        names: ['renderFunctionPageAwaited'],
        alias: '__renderFunctionPageAwaited',
      });
    }
    // The action POST protocol (CSRF floor, dispatch, classification,
    // problem+json, PRG, the 303 coercion and the 500 error mapping) is the
    // imported runtime module; the entry
    // keeps the call sites. The default body limit is bound inside the
    // generated-app factory to the canonical policy constant (#1470 block e).
    imports.push({
      from: '@openelement/router/server-runtime',
      names: ['runActionProtocol'],
      alias: '__runActionProtocol',
    });
    imports.push({
      from: '@openelement/router/server-runtime',
      names: ['actionRedirectResponse'],
      alias: '__actionRedirectResponse',
    });
    imports.push({
      from: '@openelement/router/server-runtime',
      names: ['actionErrorResponse'],
      alias: '__actionErrorResponse',
    });
    // The page-render seam: the
    // page-definition/route-meta/locale extractors are pure helpers the
    // emitted call sites reference; the runtime binding itself (renderer,
    // props projection, status pages, layout) happens inside the
    // generated-app factory per the renderer adapter (#1470 block e).
    // The class lane's startup stream guard and its program read retired
    // with the lane (C09, 2026-11-24): no emitted page kind carries a
    // stream manifest.
    imports.push(...adapter.runtimeSeam().imports);
  }

  // Conditional middleware imports (#1560): the built-ins are the
  // WinterCG middleware factories from the imported server runtime —
  // the entry imports no composition framework.
  const mw = options.middleware;
  if (mw?.requestId !== false) {
    imports.push({
      from: '@openelement/router/server-runtime',
      names: ['createRequestIdMiddleware'],
      alias: '__requestId',
    });
  }
  if (mw?.logger !== false) {
    imports.push({
      from: '@openelement/router/server-runtime',
      names: ['createLoggerMiddleware'],
      alias: '__logger',
    });
  }
  if (mw?.cors !== false) {
    imports.push({
      from: '@openelement/router/server-runtime',
      names: ['createCorsMiddleware'],
      alias: '__cors',
    });
  }
  if (mw?.securityHeaders !== false) {
    imports.push({
      from: '@openelement/router/server-runtime',
      names: ['createSecureHeadersMiddleware'],
      alias: '__secureHeaders',
    });
  }
  // The CSP auto-nonce is the same imported-runtime seam: the middleware
  // emission below only references __ssgPrerenderPass/__cspCreateNonce/
  // __cspApplyNonce, and the policy template stays generated data derived
  // from middleware.csp. The prerender-pass gate keeps per-request nonces
  // out of static bytes (the SSG nonce contract — SSG output carries none).
  if (mw?.csp?.nonce) {
    imports.push({
      from: '@openelement/router/server-runtime',
      names: ['isSsgPrerenderDispatch'],
      alias: '__ssgPrerenderPass',
    });
    imports.push({
      from: '@openelement/router/server-runtime',
      names: ['createCspNonce'],
      alias: '__cspCreateNonce',
    });
    imports.push({
      from: '@openelement/router/server-runtime',
      names: ['applyCspNonce'],
      alias: '__cspApplyNonce',
    });
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
      if (typeof mw.corsOrigin === 'function') {
        throw buildError(
          DescriptorErrorCode.CORS,
          '[openElement] middleware.corsOrigin no longer accepts a function ' +
            '(Alpha.1 breaking change: function config is never serialized into the generated entry). ' +
            'Move the origin callback into a module that default-exports ' +
            '(origin: string) => string | undefined and pass its path as middleware.corsOriginModule.',
        );
      }
      if (typeof mw.corsOrigin !== 'string' && !Array.isArray(mw.corsOrigin)) {
        throw buildError(
          DescriptorErrorCode.CORS,
          `[openElement] middleware.corsOrigin must be a string or an array of strings; got ${typeof mw.corsOrigin}.`,
        );
      }
      corsOrigin = mw.corsOrigin;
    }
    let corsOriginModule: string | undefined;
    if (mw?.corsOriginModule !== undefined) {
      if (typeof mw.corsOriginModule !== 'string') {
        throw buildError(
          DescriptorErrorCode.CORS,
          '[openElement] middleware.corsOriginModule must be a module path (string) to a module ' +
            `that default-exports (origin: string) => string | undefined; got ${typeof mw.corsOriginModule}.`,
        );
      }
      if (corsOrigin !== undefined) {
        throw buildError(
          DescriptorErrorCode.CORS,
          '[openElement] middleware.corsOrigin and middleware.corsOriginModule are mutually ' +
            'exclusive: pass static origin data via corsOrigin OR a callback module via ' +
            'corsOriginModule, not both.',
        );
      }
      corsOriginModule = normalizeLayoutImport(mw.corsOriginModule);
    }
    middleware.push({
      kind: 'cors',
      comment: '3. CORS - Web Standards (no process.env)',
      config: {
        corsOrigin,
        corsOriginModule,
        warnOnDefaultCors: options.warnOnDefaultCors !== false,
      },
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

  // --- Fetch middleware (#858) ---
  // Module contract (Alpha.1): each entry is a path to a module that
  // default-exports a Middleware. The generated entry imports the module, so
  // middleware can close over module scope and import dependencies — no
  // source serialization, no self-containment constraint.
  const fetchMiddleware = (mw?.use ?? []).map((entry, index) => {
    if (typeof entry !== 'string') {
      throw buildError(
        DescriptorErrorCode.MIDDLEWARE_USE,
        `[openElement] middleware.use[${index}] must be a module path (string) to a module that ` +
          `default-exports a Middleware (request: Request, next: () => Promise<Response>) => ` +
          `Promise<Response>; got ${typeof entry}. ` +
          'Function values are no longer supported (Alpha.1 breaking change: function config is ' +
          'never serialized into the generated entry). Move the middleware into its own module ' +
          "(e.g. './app/middleware/auth.ts') and pass the module path.",
      );
    }
    return normalizeLayoutImport(entry);
  });

  // Islands inputs are read here because the build-time page-kind
  // classification below needs the local island identities (see the block).
  const islandTagNames = options.islandTagNames || [];
  const islandFiles = options.islandFiles || [];
  const islandMeta = options.islandMeta || {};
  const packageManifests = options.packageManifests || [];

  // --- Build-time page-kind classification (M11-1) ---
  // The route scan recorded the compiler-owned page facts; this descriptor
  // build is the first point where the local island identities (the
  // generated-element lane's owner evidence) are all available, so the
  // classification runs here — at build time, from the recorded module facts,
  // never from a runtime module-shape read. The verdict rides each page
  // declaration as build-only metadata (`PageKindCarrier`); the public
  // `PageRouteDecl` protocol type is unchanged.
  // ONE page-classification context builder (shared with the client build's
  // generated-page island reachability seed; P6: no second islands mapping).
  const pageClassificationContext = buildPageClassificationContext({
    routesDir,
    islandsDir,
    islandTagNames,
    islandFiles,
    islandMeta,
    // P-4 fix: the declared-component map is the AUTHORED answer to "is this
    // module a component?", which the islands list can only answer by path. Both
    // are handed in; the classifier prefers the declaration and falls back to
    // the convention, so a module without a sidecar keeps its old verdict.
    ...(options.declaredElementTags === undefined
      ? {}
      : { declaredTags: options.declaredElementTags }),
    ...(options.declaredElementHostExports === undefined
      ? {}
      : { declaredHostExports: options.declaredElementHostExports }),
    resolveHostIdentity: (moduleId, tagName) => {
      const producer = options.declaredElementHostExports?.get(moduleId);
      // A recorded producer name is the only identity the scan keeps; a module
      // WITHOUT one is a lawful light lane, which classification refuses for a
      // page root (no host producer to render). Never guess a kind.
      return producer === undefined
        ? { kind: 'light-no-producer', component: tagName }
        : { kind: 'producer', component: tagName, ssrHostExport: producer };
    },
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
      // M11-2: the ONE build-time verdict (kind + generated-page host fact).
      // A generated page's tag IS the island scan's tag — the tag the compiler
      // emitted the class and host producer under — so every downstream
      // expression uses this build fact and never reads `__partProgram`.
      const classification = classifyPageRoute(r, pageClassificationContext);
      const generatedPage: GeneratedElementPageFact | undefined =
        classification.generatedElementPage;
      const pageTag = generatedPage === undefined ? undefined : generatedPage.tagName;
      const pageDecl: PageRouteDecl & PageKindCarrier = {
        kind: 'page' as const,
        path: r.path,
        varName: `$${r.varName}`,
        filePath: r.filePath,
        defaultTagName: pageTag ?? fallbackTagName,
        // #960 (registration decoupling, Option 2) + #1276 (B1.3-F1): a
        // definePage route's tagName export only names a content element and
        // never drives registration. For every page route the generated entry
        // resolves the SSR tag from the route module's compiled Part Program
        // at evaluation time (__resolvePageTag); the tag here is the
        // resolver's path-derived fallback, used only when the class carries
        // no compiled program.
        tagName:
          pageTag ?? (r.definePage === true ? fallbackTagName : r.tagName || fallbackTagName),
        importPath: `/${routesDir}/${r.filePath}`,
        isDynamic,
        paramNames,
        // alpha15 server lane: a server function page carries no element
        // class — the compiled component function is the render, and the
        // entry registers nothing for the route.
        ...(r.functionPage === undefined ? {} : { functionPage: r.functionPage }),
        ...(r.streamManifest ? { streamManifest: r.streamManifest } : {}),
        // Build-only page-kind fact (M11-1/M11-2): route/page generation
        // branches on this instead of a runtime module-shape check. The carrier
        // is cast-free metadata on the protocol declaration object; the public
        // protocol type stays unchanged.
        pageKind: classification.pageKind,
        ...(generatedPage === undefined ? {} : { generatedElementPage: generatedPage }),
      };
      return pageDecl;
    });

  // --- Special files: _renderer.ts / _middleware.ts ---
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
  // The streamed-page renderer/layout refusals retired with the class lane's
  // stream channel (2026-11-22): the scanner emits no stream manifest, so no
  // descriptor can carry one. Alpha18 owns the replacement carrier.

  const middlewareScopes = specialRoutes
    .filter((r) => r.special === 'middleware')
    .map((r) => ({
      varName: `$${r.varName}`,
      scope: r.path.replace(/\/?_middleware$/, '') || '/',
      importPath: `/${routesDir}/${r.filePath}`,
    }));

  // --- Islands ---
  // #460: islandsDir comes from user config and islandFiles from scanIslands;
  // both must be POSIX-normalized before they become module specifiers.
  const islandsSpecifierDir = normalizeSeparators(islandsDir);
  // M11 prerequisite consumer: the island scan resolves every local island's
  // compiler-owned generated-host identity onto `islandMeta`
  // (`LocalIslandMeta.generatedElementHost`); this descriptor is the existing
  // internal carrier, so the scan fact is re-attached here through the one
  // typed accessor instead of stopping at the scan. The public `IslandDecl`
  // protocol type stays unchanged: the identity rides the declaration object
  // as build-only metadata, and `expandIslandDeliveryDecl`'s spread below keeps
  // it on every delivery alias. Nothing consumes it yet — no admission verdict,
  // no registration and no entry codegen — so generated-entry bytes are
  // unchanged.
  const localIslands: Array<IslandDecl & GeneratedElementHostCarrier> = islandTagNames.map(
    (tagName, i) => {
      const meta = islandMeta[tagName];
      const deliveryMeta = (meta ?? {}) as Partial<IslandDecl> &
        IslandDeliveryMeta & {
          hydrate?: IslandDeliveryStrategy;
        };
      const hydrate = resolveIslandHydrate(
        deliveryMeta.hydrate as IslandDeliveryStrategy | undefined,
        options.upgradeStrategy,
      );
      const hasDeliveryTags =
        deliveryMeta.tags !== undefined || deliveryMeta.tagNames !== undefined;
      const deliveryTags = hasDeliveryTags
        ? resolveIslandDeliveryTags(tagName, deliveryMeta.tags, deliveryMeta.tagNames, tagName)
        : undefined;
      const exportNames = validateIslandDeliveryExportNames(
        deliveryMeta.exportNames,
        deliveryTags ?? [tagName],
        tagName,
      );
      const localIsland = {
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
      const generatedElementHost = readGeneratedElementHost(meta);
      return generatedElementHost === undefined
        ? localIsland
        : { ...localIsland, generatedElementHost };
    },
  );

  const packageIslandDecls: IslandDecl[] = attachPackageIslandHostIdentities(
    buildPackageIslandDecls(packageManifests, options.upgradeStrategy),
    packageManifests,
  );

  // A generated PAGE ROOT must be SSR-admitted even with zero interaction events:
  // its server artifact is the compiler-emitted host producer, and the route
  // cannot render without it. The classifier already proved the identity
  // (`generatedElementPage`), so this set is a FACT, not an inference.
  const generatedPageRootTags = new Set(
    pageRoutes
      .map(
        (route) =>
          (route as PageRouteDecl & PageKindCarrier).generatedElementPage?.tagName as
            | string
            | undefined,
      )
      .filter((tag): tag is string => tag !== undefined),
  );
  const compilerBehaviorIslands = compilerBehaviorDeclarations(
    options.staticComponents ?? [],
    options.upgradeStrategy,
    generatedPageRootTags,
  );
  // A generated PAGE ROOT that no earlier pass recorded still has to be SSR-admitted:
  // it renders through its compiler-emitted host producer, exactly like an island. An
  // `.mdx` route is that case — its module is VIRTUAL, so the island scan and the
  // static-component scan (both file-system walks) never see it, while the classifier
  // resolves it from the declared-tag scan that now lowers the source itself. The
  // classifier's verdict is the fact; this row turns it into the ONE declaration shape
  // the admission plan reads.
  const islandDeclarations: IslandDecl[] = [
    ...localIslands,
    ...compilerBehaviorIslands,
    ...packageIslandDecls,
  ];
  const recordedTags = new Set(islandDeclarations.map((island) => island.tagName));
  const pageRootIslands: IslandDecl[] = pageRoutes.flatMap((route) => {
    const generated = (route as PageRouteDecl & PageKindCarrier).generatedElementPage;
    if (generated === undefined || recordedTags.has(generated.tagName)) return [];
    return [
      {
        tagName: generated.tagName,
        modulePath: (route as { importPath?: string }).importPath ?? `/${route.filePath}`,
        hydrate: options.upgradeStrategy ?? 'idle',
        ssr: true,
        dsd: true,
        authoring: 'basic-element' as const,
        source: 'local' as const,
        reason: 'generated page root (no file-system walk records a virtual module)',
        generatedElementHost: generated.identity,
      } as IslandDecl,
    ];
  });
  islandDeclarations.push(...pageRootIslands);

  const islands: IslandDecl[] = islandDeclarations.flatMap(expandIslandDeliveryDecl);
  const cemClassifications = options.cemClassifications || [];
  const ssrAdmissionPlan = buildSsrAdmissionPlan(
    islandDeclarations,
    cemClassifications,
    options.foreignTags || [],
  );

  // M11-2 bounded admission (temporary boundary): ONE generated island per page
  // route. `definePage` attaches the page descriptor to the component class
  // object, so two routes importing the same generated island would overwrite
  // each other's page metadata (head/props/error/renderIntent) at module
  // evaluation. Reject at build with the existing coded refusal instead of
  // silently shipping whichever route evaluated last.
  {
    const generatedPageRoutes = new Map<string, string[]>();
    for (const route of pageRoutes) {
      const generated = (route as PageRouteDecl & PageKindCarrier).generatedElementPage;
      if (generated === undefined) continue;
      const paths = generatedPageRoutes.get(generated.tagName);
      if (paths === undefined) generatedPageRoutes.set(generated.tagName, [route.path]);
      else paths.push(route.path);
    }
    for (const [tag, paths] of generatedPageRoutes) {
      if (paths.length < 2) continue;
      throw buildError(
        PageClassificationCode.GENERATED_ELEMENT_PAGE_UNSUPPORTED,
        `[openElement] generated element <${tag}> is the page component of multiple routes ` +
          `(${paths.join(', ')}). A generated page's descriptor is attached to its class by ` +
          'definePage, so sharing one generated component across routes would make their page ' +
          'metadata overwrite each other. Temporary boundary: one route one generated component — ' +
          'give each page route its own generated island (each route imports its own generated ' +
          'function component).',
      );
    }
  }

  // M11-2 bounded admission: a generated page root renders through the
  // compiler-emitted host producer paired by the entry's island registration,
  // so the island must be SSR-admitted (producer identity was already proven by
  // the classifier) — a `ssr: false` / rejected island cannot serve a page root
  // and is refused explicitly instead of being silently downgraded.
  for (const route of pageRoutes) {
    const generated = (route as PageRouteDecl & PageKindCarrier).generatedElementPage;
    if (generated === undefined) continue;
    if (!ssrAdmissionPlan.renderableTags.includes(generated.tagName)) {
      throw buildError(
        DescriptorErrorCode.MODULE_IMPORT,
        `[openElement] generated page route ${route.path} (${route.filePath}) renders generated ` +
          `element <${generated.tagName}>, but that island is not SSR-admitted in this build ` +
          '(set openElement.ssr: true on the island). A page root needs the compiler-emitted ' +
          'host producer; disabling SSR would leave the page without its server render.',
      );
    }
  }

  // --- Document ---
  const document: DocumentConfig = {
    lang: options.html?.lang || 'en',
    title: options.html?.title || 'openElement',
    headExtras: options.headExtras || '',
    allowHeadExtrasScripts: options.allowHeadExtrasScripts || false,
  };
  const layout = buildLayoutPlan({
    layout: options.layout,
    layouts: options.layouts,
    declaredTags: options.declaredElementTags,
    declaredHostExports: options.declaredElementHostExports,
  });
  // Streaming boundary, project-level by construction: the generated streamed
  // document is flushed in parts and never passes through __renderLayout
  // (entry-codegen.ts emits __streamBody directly), so a resolved shell would
  // be silently dropped. The descriptor carries no per-route layout — the
  // scan records the manifest, not `route.layout` — so the check cannot be
  // narrowed to the routes that actually resolve a shell; it fails closed for
  // the whole project instead of admitting a descriptor that would only fail
  // at request time. The generated route guard (entry-codegen.ts) keeps the
  // route-level check for descriptors that reach the runtime by another path.
  const reservedTags = new Set([
    ...pageRoutes.map((route) => route.tagName),
    ...islands.map((island) => island.tagName),
    ...(layout.default ? [layout.default.tagName] : []),
    ...Object.values(layout.layouts).flatMap((shell) => (shell ? [shell.tagName] : [])),
  ]);
  // A PAGE COMPONENT is in BOTH lists by construction: its declaration provides
  // the SSR admission + host-producer identity, and the route names it as the
  // page. Filtering it out here left the entry with no `generatedHostExport` for
  // the tag it must pair — the page then rendered through the class path and
  // failed with PROGRAM_MISSING (measured on `router-ui-dogfood`'s /dialog).
  // The reserved set keeps suppressing a genuine duplicate (two modules claiming
  // one tag); a page component is not a duplicate of itself.
  const staticComponents = (options.staticComponents ?? []).filter(
    (component) => component.pageComponent === true || !reservedTags.has(component.tagName),
  );

  const descriptor: EntryDescriptor = {
    isSSG,
    imports,
    middleware,
    ...(fetchMiddleware.length > 0 ? { fetchMiddleware } : {}),
    apiRoutes,
    pageRoutes,
    staticComponents,
    islands,
    // #569: data-open-enhance forms need the client entry even with zero
    // islands; #951: the dev script injection keys on the same condition.
    hasEnhancedForms: routes.some(
      (route) => route.type === 'page' && route.hasEnhancedForms === true,
    ),
    ssrAdmissionPlan,
    cemClassifications,
    renderers,
    middlewareScopes,
    document,
    layout,
    upgradeStrategy: options.upgradeStrategy || 'idle',
    // Single-locale sites carry no i18n on the descriptor, so their generated
    // entry stays byte-identical to pre-i18n output.
    ...(options.i18n ? { i18n: options.i18n } : {}),
  };
  // Build-only side channel (task12): never part of the public protocol shape.
  const routeDocumentLinks = options.routeDocumentStyleLinks;
  if (routeDocumentLinks !== undefined && Object.keys(routeDocumentLinks).length > 0) {
    const sorted: Record<string, readonly string[]> = {};
    for (const route of Object.keys(routeDocumentLinks).sort()) {
      sorted[route] = Object.freeze([...(routeDocumentLinks[route] ?? [])]);
    }
    (
      descriptor as EntryDescriptor & { routeDocumentStyleLinks?: RouteDocumentStyleLinks }
    ).routeDocumentStyleLinks = Object.freeze(sorted);
  }
  return descriptor;
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

  // #979: record foreign custom-element tags discovered in
  // page/island JSX. Visibility only — the tags stay out of
  // renderableTags/clientOnlyTags/rejectedTags so SSR rendering and hydration
  // behavior are byte-identical to the pre-#979 plan; each tag gets an honest
  // source:'foreign' client-only decision instead of being absent. A foreign
  // tag that collides with an island declaration keeps the island decision.
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
