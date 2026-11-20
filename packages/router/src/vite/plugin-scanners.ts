/**
 * Route/island/manifest discovery and the shared entry descriptor of the
 * open build plugin (issue #1473 extraction).
 *
 * `buildStart` owns the one-shot scan pass that populates ctx.phase1; the
 * rescan entry points serve the dev watcher (plugin-watch.ts).
 */

import process from 'node:process';
import type { Plugin } from 'vite';
import type { OpenElementPackageManifest, RouteEntry } from './framework.ts';
import type { IslandDecl } from '@openelement/protocol/ssg';
import { createLogger, formatError, OpenElementError } from '@openelement/element';
import { join } from 'pathe';
import { DEFAULT_ISLANDS_DIR, DEFAULT_ROUTES_DIR } from './internal/paths.ts';
import {
  buildEntryDescriptor,
  detectAndClassifyCemPackages,
  fileToTagName,
  renderEntry,
  scanForeignTags,
  scanIslandMeta,
  scanIslands,
  scanPackageManifests,
  scanRoutes,
  scanStaticComponents,
  takeRouteScanDiagnostics,
} from './internal/ssg/index.ts';
import type {
  CemDetectionResult,
  EntryDescriptor,
  ForeignTagScanResult,
} from './internal/ssg/index.ts';
import {
  buildPackageIslandDecls,
  registerPackageIslandStyleDeclarations,
} from './internal/ssg/island-scanner.ts';
import { resolveIslandDeliveryTags } from './internal/ssg/delivery.ts';
import type { OpenPluginState } from './plugin-config.ts';
import type { ModuleWalkResolver } from './internal/module-graph-walk.ts';
import { collectShadowClassCandidates } from './internal/collect-shadow-candidates.ts';
import { serverComponentAdmissionTags } from './internal/server-component-host.ts';
import { scanDeclaredElementTags } from './internal/ssg/declared-element-tags.ts';
import {
  deriveAdmittedPackages,
  mergeAdmittedManifests,
} from './internal/ssg/derived-admission.ts';
import {
  buildError,
  describeError,
  errorCause,
  PackageAdmissionErrorCode,
  ScanSurfaceErrorCode,
} from '../internal/error-codes.ts';
import {
  formatDiagnosticLine,
  recordBuildDiagnostic,
  reportScanFatal,
} from './internal/build-diagnostics.ts';

const log = createLogger('router-vite');

function buildDescriptor(
  state: OpenPluginState,
  routes: RouteEntry[],
  islandTagNames: string[] = [],
  packageManifests: OpenElementPackageManifest[] = [],
  islandFiles: string[] = [],
): EntryDescriptor {
  return buildEntryDescriptor(routes, {
    routesDir: state.resolvedOptions.routesDir,
    islandsDir: state.resolvedOptions.islandsDir,
    middleware: state.resolvedOptions.middleware,
    renderer: state.resolvedOptions.renderer,
    islandTagNames,
    islandFiles,
    islandMeta: state.ctx.phase1.islandMeta,
    staticComponents: state.ctx.phase1.staticComponents,
    packageManifests,
    cemClassifications: state.ctx.phase1.cemClassifications,
    foreignTags: state.ctx.phase1.foreignTags,
    headExtras: state.headExtrasValue,
    allowHeadExtrasScripts: state.allowHeadExtrasValue,
    html: state.resolvedOptions.html,
    upgradeStrategy: state.resolvedOptions.island?.upgradeStrategy || 'idle',
    layout: state.resolvedOptions.layout,
    layouts: state.resolvedOptions.layouts,
    declaredElementTags: state.ctx.phase1.declaredElementTags,
    declaredElementHostExports: state.ctx.phase1.declaredElementHostExports,
    // #1411: the default-CORS production advisory belongs to a production
    // build. Repeating it on every dev first run trained users to ignore it,
    // so the dev server (command 'serve') generates the same entry without
    // the warning; `cli/build` keeps it.
    warnOnDefaultCors: state.produceMode !== 'serve',
    // Same source as the SSG descriptor: the dev/SSR entry must resolve
    // locales identically or dev and build disagree about `/zh/...` paths.
    i18n: state.ctx.plugins.i18nOptions ?? undefined,
  });
}

export function generateEntry(
  state: OpenPluginState,
  routes: RouteEntry[],
  islandTagNames: string[] = [],
  packageManifests: OpenElementPackageManifest[] = [],
  islandFiles: string[] = [],
): string {
  state.entryDescriptor = buildDescriptor(
    state,
    routes,
    islandTagNames,
    packageManifests,
    islandFiles,
  );
  return renderEntry(state.entryDescriptor);
}

/** Scan routes + static components into ctx; returns the route entries. */
async function scanRoutesAndStaticComponents(state: OpenPluginState): Promise<RouteEntry[]> {
  const routes = await scanRoutes(state.resolvedOptions.routesDir!, '', {
    root: state.viteRoot ?? process.cwd(),
    workspaceRoot: state.workspaceRoot,
  });
  // The route scan's Tier-2 degradation notes surface through the envelope
  // channel (#1612): reported, never silent, never fatal. Warnings print on
  // the build log; the advisory class (the normal no-tagName-export note)
  // stays at debug so a routine site is not told anything surprising.
  for (const diagnostic of takeRouteScanDiagnostics()) {
    const envelope = {
      code: diagnostic.code,
      severity: diagnostic.severity,
      phase: 'build',
      message: diagnostic.message,
      file: diagnostic.file,
    } as const;
    recordBuildDiagnostic(envelope);
    if (diagnostic.severity === 'info') log.debug(formatDiagnosticLine(envelope));
    else log.warn(formatDiagnosticLine(envelope));
  }
  const resolve = state.resolveModule;
  if (resolve === undefined) {
    // The scan's reachability is the BUNDLER's: without its resolver a component
    // reached through an alias or a `package.json` imports subpath would be
    // invisible here — the silent DSD loss defect B fixed. Fail closed instead
    // of falling back to a narrower walk of our own.
    throw new Error(
      '[openElement] static component discovery requires the build resolver ' +
        '(buildStart captures it); refusing to scan with relative imports only',
    );
  }
  const staticScan = await scanStaticComponents({
    root: process.cwd(),
    routesDir: state.resolvedOptions.routesDir!,
    islandsDir: state.resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR,
    routes,
    resolve,
  });
  state.ctx.phase1.staticComponents = staticScan.declarations;
  // The discovery walk's boundaries are NOT silent: a partial registry must
  // say so through the same envelope channel as every other scan degradation
  // (#1612) — the machine-readable exit replays it, the log carries the line.
  for (const diagnostic of staticScan.notes) {
    const envelope = {
      code: diagnostic.code,
      severity: 'warning',
      phase: 'build',
      message: diagnostic.message,
      ...(diagnostic.file !== undefined ? { file: diagnostic.file } : {}),
    } as const;
    recordBuildDiagnostic(envelope);
    log.warn(formatDiagnosticLine(envelope));
  }
  return routes;
}

/**
 * Scan the admitted packages' manifests into ctx.
 *
 * The ONE owner of "which packages are admitted, and what do their manifests
 * declare". The build/dev `buildStart` calls it, and so does the dev server
 * phase (`configureServer`), which Vite runs BEFORE `buildStart` — the Tailwind
 * dev channels must answer a declared compilation requirement in
 * their own `configureServer`, and the manifest scan is the only thing that
 * makes that requirement visible. Both callers run the same function over the
 * same package list, so running it twice is idempotent, not a second scanner.
 *
 * Under the AUTO admission default (the value omitted, 'auto', or an explicit
 * array) the scan first DERIVES the admitted set from the app's real module
 * graph — every package-owned element module the routes, islands, layouts and
 * components reach, attributed by its owner package (`deriveAdmittedPackages`).
 * Explicit entries merge on top and outrank a derived claim on a shared tag
 * (`mergeAdmittedManifests`); 'manual' turns the derivation off entirely.
 */
export async function scanPackageIslandsInto(
  state: OpenPluginState,
  routes: RouteEntry[],
  resolveModule?: ModuleWalkResolver,
): Promise<void> {
  const declared = state.resolvedOptions.packageIslands;
  const mode: 'auto' | 'manual' = declared === 'manual' ? 'manual' : 'auto';
  const explicit = Array.isArray(declared) ? [...new Set(declared)] : [];
  state.ctx.phase1.packageAdmissionMode = mode;

  // The explicit list keeps the manifest scan's fail-closed behavior verbatim
  // (a listed package claimed component-packageness: missing, absent or
  // malformed manifests are coded failures). Resolution anchors at the app
  // root, the same anchor the consumer's own node_modules defines.
  const explicitManifests =
    explicit.length > 0 ? await scanPackageManifests(explicit, process.cwd()) : [];

  // Derivation FIRST (so its facts precede every phase1 consumer): the
  // admitted set is the app's real render graph, not its dependency list.
  const resolve = resolveModule ?? state.resolveModule;
  const derived =
    mode === 'auto' && resolve !== undefined
      ? await deriveAdmittedPackages({
          root: process.cwd(),
          resolve,
          routes,
          routesDir: state.resolvedOptions.routesDir!,
          islandsDir: state.resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR,
          islandFiles: state.ctx.phase1.islandFiles,
          layout: state.resolvedOptions.layout,
          layouts: state.resolvedOptions.layouts,
        })
      : undefined;

  // The diagnostics land BEFORE auto's effective surface: what the derivation
  // could not admit is named, with the fix, before anything consumes the set.
  // The two fatal classes also print through the log first — the bundler's
  // buildStart error surface does not carry the thrown message to the CLI on
  // rolldown-vite 8 (pre-existing; verified on the alpha15 baseline), and a
  // coded diagnostic that never reaches the developer is not a diagnostic.
  // Each report class is FIRST an envelope record (#1612) — the machine-
  // readable exit replays it — and the human line is derived from the same
  // record, so the `[CODE]` token contract and the envelope cannot drift.
  for (const entry of derived?.manifestLess ?? []) {
    const warning = {
      code: PackageAdmissionErrorCode.MANIFEST_LESS,
      severity: 'warning',
      phase: 'build',
      message:
        `The component package "${entry.packageName}" is imported by this app (${entry.module}) ` +
        `but has no valid OpenElement manifest (${entry.reason}), so it can never deliver: ` +
        'its components render as unknown elements (no declarative shadow root, no stylesheet link).',
      file: entry.module,
      hint:
        "Ship a `manifest` export through the package's `./manifest` subpath, " +
        'or stop expecting component delivery from it.',
    } as const;
    recordBuildDiagnostic(warning);
    log.warn(formatDiagnosticLine(warning));
  }
  for (const entry of derived?.dynamicUnproven ?? []) {
    const warning = {
      code: PackageAdmissionErrorCode.DYNAMIC_UNPROVEN,
      severity: 'warning',
      phase: 'build',
      message:
        `"${entry.importer}" imports "${entry.specifier}" (package "${entry.packageName}") ` +
        'only through a dynamic import(), which the scan cannot prove statically, ' +
        'so the package is not admitted.',
      file: entry.importer,
      hint: `Declare "${entry.packageName}" in \`packageIslands\` in openelement.config.ts to admit it.`,
    } as const;
    recordBuildDiagnostic(warning);
    log.warn(formatDiagnosticLine(warning));
  }
  // The derivation's per-module exclusion notes (unreadable sources, refused
  // analyses, unresolvable dynamic imports): the same admission diagnostics
  // channel, non-fatal, each with its code and reason — reported, never
  // silent, exactly like the walk bound above.
  for (const note of derived?.notes ?? []) {
    const warning = {
      code: note.code,
      severity: 'warning',
      phase: 'build',
      message: note.message,
      ...(note.file !== undefined ? { file: note.file } : {}),
    } as const;
    recordBuildDiagnostic(warning);
    log.warn(formatDiagnosticLine(warning));
  }

  const merged = mergeAdmittedManifests({
    explicit: explicitManifests,
    derived: derived?.manifests ?? [],
  });
  const manifests = merged.manifests;
  state.ctx.phase1.packageManifests = manifests;
  if (manifests.length === 0) return;

  // Extract island declarations from manifests.
  state.ctx.phase1.packageIslandDecls = buildPackageIslandDecls(
    manifests,
    state.resolvedOptions.island?.upgradeStrategy,
  );
  log.info(
    `Package islands: ${state.ctx.phase1.packageIslandDecls.map((i) => i.tagName).join(', ')}`,
  );
  syncDerivedNoExternal(state, manifests);
  // A package component publishes its host root and authored sheets in the
  // manifest; register them in the build's style declaration carrier so they
  // travel the same plan a local island's `styles` declaration rides.
  registerPackageIslandStyleDeclarations(state.ctx.phase1.packageIslandDecls, manifests, {
    root: state.viteRoot ?? process.cwd(),
    workspaceRoot: state.workspaceRoot,
  });
}

/**
 * Append the scan-admitted packages to the SSR externalization list.
 *
 * The config loader derives `ssr.noExternal` from the EXPLICIT list at
 * config-resolution time; the derivation runs later (buildStart), so the
 * derived names are appended here — to `resolvedOptions` (the object the
 * Phase 2 client build reads) and to the live RESOLVED config (the list the
 * dev server's SSR environment externalizes by). Additive with dedup: a
 * caller's own entries are never displaced.
 */
function syncDerivedNoExternal(
  state: OpenPluginState,
  manifests: readonly { packageName: string }[],
): void {
  const names = manifests.map((manifest) => manifest.packageName);
  const options = state.resolvedOptions;
  const existing = options.ssr?.noExternal ?? [];
  const merged = [...new Set([...existing, ...names])];
  if (merged.length !== existing.length) {
    options.ssr = { ...options.ssr, noExternal: merged };
  }
  const resolvedSsr = state.resolvedConfig?.ssr as
    | { noExternal?: (string | RegExp)[] | true }
    | undefined;
  if (resolvedSsr === undefined) return;
  if (resolvedSsr.noExternal === true) return; // absorbing value; nothing to add
  const resolvedExisting = resolvedSsr.noExternal ?? [];
  const resolvedMerged = [...new Set([...resolvedExisting, ...names])];
  if (resolvedMerged.length !== resolvedExisting.length) {
    resolvedSsr.noExternal = resolvedMerged;
  }
}

/**
 * Read every reachable module's sidecar-declared tag into ctx (the
 * generated-element site resolver's second source).
 *
 * The seeds are the same three the package-admission derivation walks (page
 * routes, local islands, layout modules), so one reachability convention covers
 * the app's whole authored graph. A page-local component (`app/site-ui/…`) is
 * reached through its importing route, which is exactly the module the scan
 * needs to see. The walk's own boundaries ride the build-diagnostics envelope:
 * a partial map is a reported fact, never a silent one.
 */
async function scanDeclaredTagsInto(
  state: OpenPluginState,
  routes: readonly RouteEntry[],
): Promise<void> {
  const resolve = state.resolveModule;
  const root = state.viteRoot ?? process.cwd();
  const routesDir = state.resolvedOptions.routesDir!;
  const islandsDir = state.resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR;
  const seeds: string[] = [];
  for (const route of routes) {
    if (route.type !== 'page' || route.special) continue;
    seeds.push(join(root, routesDir, route.filePath));
  }
  for (const file of state.ctx.phase1.islandFiles) {
    seeds.push(join(root, islandsDir, file));
  }
  for (const shell of [
    state.resolvedOptions.layout,
    ...Object.values(state.resolvedOptions.layouts ?? {}),
  ]) {
    if (!shell || typeof shell !== 'object' || typeof shell.import !== 'string') continue;
    seeds.push(join(root, shell.import));
  }
  if (resolve === undefined) {
    // The scan is resolver-driven (alias/imports/package specifiers are the
    // bundler's answers). Rescan paths that never captured one keep the map
    // empty, which is the pre-slice behavior: the resolver falls through to
    // the path convention exactly as before.
    state.ctx.phase1.declaredElementTags = new Map();
    state.ctx.phase1.declaredElementHostExports = new Map();
    return;
  }
  const scanned = await scanDeclaredElementTags({
    root,
    workspaceRoot: state.workspaceRoot,
    resolve,
    seeds,
  });
  for (const note of scanned.notes) {
    const envelope = {
      code: note.code,
      severity: 'warning',
      phase: 'build',
      message: note.message,
      ...(note.file !== undefined ? { file: note.file } : {}),
    } as const;
    recordBuildDiagnostic(envelope);
    log.warn(formatDiagnosticLine(envelope));
  }
  state.ctx.phase1.declaredElementTags = scanned.tags;
  state.ctx.phase1.declaredElementHostExports = scanned.hostExports;
  if (scanned.tags.size > 0) {
    log.info(`Declared element tags: ${[...scanned.tags.values()].sort().join(', ')}`);
  }
}

/** Rescan the islands dir into ctx; returns the islands root for later reuse. */
async function scanIslandsIntoCtx(state: OpenPluginState): Promise<string> {
  const islandsRoot = join(process.cwd(), state.resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR);
  const islandFiles = await scanIslands(islandsRoot);
  state.ctx.phase1.islandTagNames = islandFiles.map((f) => fileToTagName(f));
  state.ctx.phase1.islandFiles = islandFiles;
  // The compiler identity anchor is the actual Vite root (configResolved's
  // `cfg.root`), not an assumption that the process cwd is the project root;
  // the cwd fallback only serves hosts that never resolved a Vite config.
  state.ctx.phase1.islandMeta = await scanIslandMeta(
    islandsRoot,
    islandFiles,
    state.viteRoot ?? process.cwd(),
  );
  // The island scan reset the style declaration carrier; re-register the
  // admitted packages' declared sheets (idempotent, and order-independent with
  // the package scan that may run before or after this one).
  registerPackageIslandStyleDeclarations(
    state.ctx.phase1.packageIslandDecls ?? [],
    state.ctx.phase1.packageManifests ?? [],
    { root: state.viteRoot ?? process.cwd(), workspaceRoot: state.workspaceRoot },
  );
  return islandsRoot;
}

/** Regenerate the entry descriptor from ctx and sync its SSR admission plan. */
function syncEntryDescriptor(state: OpenPluginState, routes: RouteEntry[]): void {
  generateEntry(
    state,
    routes,
    state.ctx.phase1.islandTagNames,
    state.ctx.phase1.packageManifests,
    state.ctx.phase1.islandFiles,
  );
  if (state.entryDescriptor) {
    state.ctx.phase1.ssrAdmissionPlan = state.entryDescriptor.ssrAdmissionPlan;
  }
}

/**
 * #1028: dev-only route rescan. buildStart() scans the routes dir once, so a
 * route file added/removed while the dev server runs never reached the
 * cached entryDescriptor and 404'd until restart. Re-scan, rebuild the
 * descriptor (virtualEntryPlugin.load() renders from it), and invalidate the
 * virtual entry module so the dev server re-evaluates it on the next pass.
 */
export async function rescanRoutes(state: OpenPluginState): Promise<void> {
  const routes = await scanRoutesAndStaticComponents(state);
  state.ctx.phase1.cachedRoutes = routes;
  syncEntryDescriptor(state, routes);
}

/**
 * #1062: dev-only island rescan — same mechanism as rescanRoutes (#1028).
 * buildStart() scans the islands dir once, so an island added/removed while
 * the dev server runs never reached the cached descriptor (SSR admission
 * plan) or the dev island client map: the page rendered DSD but the island
 * never hydrated, with no hint why. Re-scan, rebuild the descriptor
 * (virtualEntryPlugin.load() and devIslandClientPlugin.load() both render
 * from ctx.phase1), and let the configureServer watcher invalidate both
 * virtual entries and full-reload, exactly as for routes.
 */
export async function rescanIslands(state: OpenPluginState): Promise<void> {
  await scanIslandsIntoCtx(state);
  // A rescan re-reads the island sources, so the declared-tag provider must be
  // refreshed in the same pass: an edited sidecar `tag` (or a newly added
  // page-local component the route graph now reaches) has to replace the stale
  // map, exactly as `islandMeta` is replaced.
  await scanDeclaredTagsInto(state, state.ctx.phase1.cachedRoutes || []);
  syncEntryDescriptor(state, state.ctx.phase1.cachedRoutes || []);
}

/**
 * The injectable seam for the CEM detection scan (crash-injection tests and
 * hosts that scan a different tree). The production value is
 * {@linkcode detectAndClassifyCemPackages}.
 */
export type DetectCemPackages = (nodeModulesDir: string) => Promise<CemDetectionResult>;

/**
 * The injectable seam for the foreign-tag source scan (crash-injection
 * tests). The production value is {@linkcode scanForeignTags}.
 */
export type ForeignTagScanner = typeof scanForeignTags;

/**
 * CEM auto-detection - scan node_modules for custom-elements.json without
 * importing or executing any package code, into ctx. Runs BEFORE the entry
 * descriptor is built so the emitted entry and the SSR admission plan share
 * one descriptor instantiation.
 *
 * Two-tier semantics. Tier-1: the whole detection channel crashing (a
 * directory-walk I/O failure) fails the build closed with a coded error — a
 * half-read compatibility surface would silently mis-admit components, and
 * "best-effort" is not a licence for a silently half-empty scan. The fatal
 * reports first through `reportScanFatal` (the buildStart error surface does
 * not carry the thrown message to the CLI on rolldown-vite 8 — see the
 * reportScanFatal contract). Tier-2: one unparseable manifest is a per-item
 * degradation — its structured reason rides the envelope channel (#1612) and
 * the scan proceeds without that package's classifications.
 */
export async function scanCemClassificationsInto(
  state: OpenPluginState,
  detect: DetectCemPackages = detectAndClassifyCemPackages,
): Promise<void> {
  const nodeModulesDir = join(process.cwd(), 'node_modules');
  let detection: CemDetectionResult;
  try {
    detection = await detect(nodeModulesDir);
  } catch (err) {
    throw reportScanFatal(
      buildError(
        ScanSurfaceErrorCode.CEM_DETECTION_UNAVAILABLE,
        'CEM auto-detection failed, so the component compatibility surface cannot be ' +
          `proven: ${describeError(err)}`,
        { cause: errorCause(err) },
      ),
    );
  }
  // A skipped manifest leaves its package's capability unproven, so record one
  // synthetic `client-only` per DELIVERED tag (the same tag set
  // `expandIslandDeliveryDecl` hands the plan) unless real classification
  // evidence already exists; `openElement.ssr` is only a candidate signal
  // (ADR-0157), never proof.
  const classifiedTags = new Set(detection.classifications.map((entry) => entry.tagName));
  for (const entry of detection.skipped) {
    const skippedManifest = state.ctx.phase1.packageManifests.find(
      (pkg) => pkg.packageName === entry.packageName,
    );
    const downgradedTags: string[] = [];
    for (const declaration of skippedManifest?.declarations ?? []) {
      if (!declaration.openElement?.module) continue;
      const delivery = declaration as typeof declaration & {
        tags?: readonly string[];
        tagNames?: readonly string[];
      };
      const openElement = declaration.openElement as typeof declaration.openElement & {
        tags?: readonly string[];
        tagNames?: readonly string[];
      };
      const deliveredTags = resolveIslandDeliveryTags(
        declaration.tagName,
        delivery.tags ?? openElement.tags,
        delivery.tagNames ?? openElement.tagNames,
        declaration.tagName,
      );
      for (const tagName of deliveredTags) {
        if (classifiedTags.has(tagName)) continue;
        detection.classifications.push({
          tagName,
          tier: 'client-only',
          reason:
            `CEM manifest unparseable (${entry.reason}); the SSR capability is unproven, ` +
            'downgraded to client-only',
          source: 'package',
          ssr: false,
        });
        classifiedTags.add(tagName);
        downgradedTags.push(tagName);
      }
    }
    const warning = {
      code: ScanSurfaceErrorCode.CEM_MANIFEST_SKIPPED,
      severity: 'warning',
      phase: 'build',
      message:
        `The CEM manifest of package "${entry.packageName}" could not be parsed, so its ` +
        `components are not classified (${entry.reason}). ` +
        (downgradedTags.length > 0
          ? `${downgradedTags.length} delivered tag(s) are downgraded to client-only for this ` +
            "build: the manifest's openElement.ssr flag is a candidate signal (ADR-0157), not " +
            'proof, and no classifier ran.'
          : 'No delivered tag was downgraded: the package is not an admitted component package ' +
            'here, or every delivered tag already has real classification evidence.'),
      file: entry.packageName,
      hint:
        downgradedTags.length > 0
          ? "Fix or remove the package's custom-elements.json; the client-only fallback keeps the " +
            'site working but drops server rendering for these components.'
          : "Fix or remove the package's custom-elements.json; existing classifications were " +
            'preserved and no synthetic downgrade was applied.',
    } as const;
    recordBuildDiagnostic(warning);
    log.warn(formatDiagnosticLine(warning));
  }
  state.ctx.phase1.cemClassifications = detection.classifications;
  if (detection.classifications.length > 0) {
    log.info(
      `CEM auto-detection: classified ${detection.classifications.length} component(s) from node_modules`,
    );
  }
}

/**
 * #979: foreign-tag discovery — scan page route and island sources for
 * custom-element tags that are neither local islands, package-manifest
 * islands, nor openElement-authored elements, into ctx, so the admission
 * plan records them explicitly (client-only, visibility only) instead of
 * never seeing them.
 *
 * Two-tier semantics. Tier-1: the whole discovery channel crashing (the
 * known-tag assembly or the compiler-backed discovery pass) fails the build
 * closed with a coded error, reported first through `reportScanFatal`. A
 * single unreadable module is NOT a channel crash — it is the scan result's
 * own per-item degradation record (Tier-2), surfaced here through the
 * envelope channel (#1612) while the rest of the scan proceeds.
 */
export async function scanForeignTagsInto(
  state: OpenPluginState,
  routes: RouteEntry[],
  islandsRoot: string,
  islandFiles: string[],
  scan: ForeignTagScanner = scanForeignTags,
): Promise<void> {
  const knownTags = new Set<string>(state.ctx.phase1.islandTagNames);
  for (const [tagName, meta] of Object.entries(state.ctx.phase1.islandMeta)) {
    const delivery = meta as IslandDecl & {
      tags?: readonly string[];
      tagNames?: readonly string[];
    };
    for (const deliveredTag of resolveIslandDeliveryTags(
      tagName,
      delivery.tags,
      delivery.tagNames,
      tagName,
    ))
      knownTags.add(deliveredTag);
  }
  for (const pkg of state.ctx.phase1.packageManifests) {
    for (const decl of pkg.declarations) {
      const delivery = decl as typeof decl & {
        tags?: readonly string[];
        tagNames?: readonly string[];
      };
      const openElement = decl.openElement as typeof decl.openElement & {
        tags?: readonly string[];
        tagNames?: readonly string[];
      };
      for (const deliveredTag of resolveIslandDeliveryTags(
        decl.tagName,
        delivery.tags ?? openElement?.tags,
        delivery.tagNames ?? openElement?.tagNames,
        decl.tagName,
      ))
        knownTags.add(deliveredTag);
    }
  }
  const pageRoutes = routes.filter((r) => r.type === 'page' && !r.special);
  for (const route of pageRoutes) {
    knownTags.add(fileToTagName(route.filePath));
    if (route.tagName) knownTags.add(route.tagName);
  }
  const layoutConfigs = [
    state.resolvedOptions.layout,
    ...Object.values(state.resolvedOptions.layouts ?? {}),
  ];
  for (const shell of layoutConfigs) {
    if (shell && typeof shell === 'object' && shell.tagName) {
      knownTags.add(shell.tagName);
    }
  }

  let result: ForeignTagScanResult;
  try {
    result = await scan({
      routesDir: join(process.cwd(), state.resolvedOptions.routesDir || DEFAULT_ROUTES_DIR),
      islandsDir: islandsRoot,
      routeFiles: pageRoutes.map((r) => r.filePath),
      islandFiles,
      knownTags,
    });
  } catch (err) {
    throw reportScanFatal(
      buildError(
        ScanSurfaceErrorCode.FOREIGN_TAG_SCAN_UNAVAILABLE,
        'The foreign-tag scan failed, so the admission plan cannot record the third-party ' +
          `custom elements this app consumes: ${describeError(err)}`,
        { cause: errorCause(err) },
      ),
    );
  }
  state.ctx.phase1.foreignTags = result.foreignTags;
  for (const entry of result.unreadable) {
    const warning = {
      code: ScanSurfaceErrorCode.FOREIGN_TAG_MODULE_UNREADABLE,
      severity: 'warning',
      phase: 'build',
      message:
        `The foreign-tag scan could not read module ${entry.path}, so tags used only ` +
        `there are not recorded (${entry.reason}).`,
      file: entry.path,
      hint: 'Restore the module (or remove it) so the admission plan sees its tags.',
    } as const;
    recordBuildDiagnostic(warning);
    log.warn(formatDiagnosticLine(warning));
  }
  if (result.foreignTags.length > 0) {
    log.info(`Foreign WC tags consumed in JSX: ${result.foreignTags.join(', ')}`);
  }
}

/** Create the `buildStart` hook of `open:core` over the shared plugin state. */
export function createBuildStartHook(state: OpenPluginState): Pick<Plugin, 'buildStart'> {
  return {
    async buildStart() {
      state.ctx.reset();
      // This phase owns discovery, so it captures the plugin context's resolver
      // here: route/static-component reachability must be the BUNDLER's
      // (relative, `package.json` imports, alias — defect B), and a dev rescan
      // has no plugin context of its own to ask.
      state.resolveModule = {
        resolve: (specifier, importer) =>
          this.resolve(specifier, importer) as ReturnType<ModuleWalkResolver['resolve']>,
      };

      try {
        const routes = await scanRoutesAndStaticComponents(state);
        const islandsRoot = await scanIslandsIntoCtx(state);
        const islandFiles = state.ctx.phase1.islandFiles;

        // The declared-tag provider (the site resolver's second source). Runs
        // after the island scan so its seeds include the island files, and
        // before any transform can ask the resolver for a site fact.
        await scanDeclaredTagsInto(state, routes);

        // Auto admission derives the package set from the scanned graph, so
        // the admission scan runs on EVERY build now — the value may be an
        // explicit list, 'auto'/'manual', or omitted (auto default).
        await scanPackageIslandsInto(state, routes);

        // Cache routes for lazy load() regeneration.
        state.ctx.phase1.cachedRoutes = routes;

        // The DEV channel's class candidates must be complete before the first
        // document render: the component sheet's CONTENT is compiled from this
        // registry on every request, and the sheet itself is a stable URL the
        // first paint's DSD already declares — a first compile that ran while
        // the app's own modules had not been transformed yet would serve an
        // incomplete sheet under that same URL, and the shadow roots adopting
        // it would paint unstyled until the next compile. Registering the
        // Phase 1 scan's inventory up front closes that window; the
        // transform-time registrations keep it current afterwards (defect C's
        // ordering requirement; a process-global registry used to hide this by
        // leaking the previous server's facts). The inventory is the Phase 1
        // scan's own (bundler-resolved, defect B): the same discovery the build
        // runs, not a second scanner. Builds skip it — their client build
        // discovers its own graph and owns its own registry.
        if (state.produceMode === 'serve') {
          await collectShadowClassCandidates({
            root: process.cwd(),
            candidates: state.classCandidates,
            modules: [
              ...(state.ctx.phase1.staticComponents ?? []).map((decl) => ({
                path: decl.modulePath.replace(/^\/+/, ''),
              })),
              ...(state.ctx.phase1.islandFiles ?? []).map((file) => ({
                path: `${state.resolvedOptions.islandsDir || DEFAULT_ISLANDS_DIR}/${file}`,
              })),
              ...routes
                .filter((route) => route.type === 'page')
                .map((route) => ({ path: `${state.resolvedOptions.routesDir}/${route.filePath}` })),
              ...(state.ctx.phase1.packageIslandDecls ?? []).map((island) => ({
                path: island.modulePath,
                resolve: true,
              })),
            ],
            serverComponentTags: serverComponentAdmissionTags(
              state.ctx.phase1.staticComponents,
              state.ctx.phase1.ssrAdmissionPlan?.renderableTags,
            ),
          });
        }

        await scanCemClassificationsInto(state);

        await scanForeignTagsInto(state, routes, islandsRoot, islandFiles);

        // Single descriptor instantiation: the emitted entry code and the
        // admission plan come from the same object. The returned code string
        // is discarded — the call populates entryDescriptor, which
        // virtualEntryPlugin.load() renders from.
        syncEntryDescriptor(state, routes);
        const pageCount = routes.filter((r) => r.type === 'page' && !r.special).length;
        const apiCount = routes.filter((r) => r.type === 'api' && !r.special).length;
        const totalIslands =
          state.ctx.phase1.islandTagNames.length + state.ctx.phase1.packageIslandDecls.length;
        // A data line, not a banner: the counts are what a dev reading the
        // startup output acts on. A branding suffix here read as though the
        // site title had been concatenated onto the line, and it duplicated
        // the framework's own startup banner.
        log.info(
          `Routes: ${pageCount} page(s), ${apiCount} API route(s), ` + `${totalIslands} island(s)`,
        );
      } catch (err) {
        // The scan-phase fatal wrapper (#1616). Reported through the ONE
        // log-before-throw seam: on rolldown-vite 8 the buildStart error
        // surface does not carry the thrown message to the CLI (pre-existing;
        // verified on the alpha15 baseline), so a scan failure that only
        // throws leaves the operator with a misleading downstream error (an
        // empty scan fails SSG with OE_SSG_ROUTE_INFO_EMPTY, never the scan's
        // own verdict). The cause is preserved so the exit walk carries the
        // producer code underneath.
        throw reportScanFatal(
          new OpenElementError(`Route scan failed: ${formatError(err)}`, {
            code: 'ROUTE_SCAN_ERROR',
            statusCode: 500,
            recoverable: false,
            phase: 'build',
            ...(err instanceof Error ? { cause: err } : {}),
          }),
        );
      }
    },
  };
}
