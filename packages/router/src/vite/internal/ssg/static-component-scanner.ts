/** Discover compiled static components reachable from local route imports. */
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'pathe';
import type { RouteEntry } from '../../framework.ts';
import type { StaticComponentDecl } from '@openelement/protocol/ssg';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { analyzeModuleSemantics } from '@openelement/compiler';
import { ROUTER_MODULE_VOCABULARY } from '@openelement/protocol/module-vocabulary';
import { readIslandConfig } from './island-scanner.ts';
import {
  walkModuleGraph,
  type ModuleWalkDiagnostic,
  type ModuleWalkResolver,
} from '../module-graph-walk.ts';

/**
 * Stable codes for what this scanner's walk could not do. The walk's own
 * boundaries (`truncated`, its per-module diagnostics) are REPORTED here, not
 * swallowed: a registry built from a truncated walk is a partial registry,
 * and the reason reaches the developer through the build-diagnostics envelope
 * channel (#1612) — reported, never silent.
 */
export const StaticScanDiagnosticCode = {
  /** The discovery walk stopped at its module bound; the registry is partial. */
  MODULE_BOUND_EXCEEDED: 'OE_STATIC_SCAN_MODULE_BOUND_EXCEEDED',
} as const;

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

export interface ScanStaticComponentsOptions {
  root: string;
  routesDir: string;
  islandsDir: string;
  routes: readonly RouteEntry[];
  /**
   * The BUNDLER's resolver (`this.resolve`), so reachability follows every
   * specifier form the bundler itself understands — a relative path, a
   * `package.json` `imports` subpath, a configured alias — exactly as the graph
   * walk in the client build does (defect B: a component reached only through
   * an alias was not inventoried here, so the server rendered its host tag with
   * no DSD template while the build reported success).
   */
  resolve: ModuleWalkResolver;
  /**
   * The discovery walk's module bound, forwarded to `walkModuleGraph`. The
   * production default is the walker's own; the explicit field exists so the
   * truncation behavior is testable without pathological fixtures.
   */
  maxModules?: number;
}

/** What one static-component scan produced, including what it could not. */
export interface StaticComponentScanResult {
  /** The compiled static components the walk reached, sorted by tag name. */
  readonly declarations: StaticComponentDecl[];
  /**
   * The walk's reported exclusions: its own per-module diagnostics, plus one
   * graph-level bound record when the walk stopped at `maxModules`.
   */
  readonly notes: ReadonlyArray<ModuleWalkDiagnostic>;
}

/**
 * Every compiled static component the page routes can reach, following the
 * BUNDLER-RESOLVED static import graph (`walkModuleGraph`, the same traversal
 * the build's other discovery passes use). The result is a deterministic
 * explicit registry input for the generated Vite SSR entry; modules outside
 * this project root (package imports, linked packages) stay opaque — a
 * package's components are admitted through its manifest, not through this
 * scan.
 */
export async function scanStaticComponents(
  options: ScanStaticComponentsOptions,
): Promise<StaticComponentScanResult> {
  const root = resolve(options.root);
  const routeRoot = resolve(root, options.routesDir);
  const islandRoot = resolve(root, options.islandsDir);
  const seeds = options.routes
    .filter((route) => route.type === 'page' && !route.special)
    .map((route) => resolve(routeRoot, route.filePath));
  const walk = await walkModuleGraph(options.resolve, seeds, {
    maxModules: options.maxModules,
  });
  // The walk's boundaries travel on the result — the bound stop leads, and
  // the walk's own per-module diagnostics follow — so every caller reports
  // them through its structured channel instead of a truncated registry
  // shipping silently.
  const notes: ModuleWalkDiagnostic[] = [];
  if (walk.truncated) {
    notes.push({
      code: StaticScanDiagnosticCode.MODULE_BOUND_EXCEEDED,
      message:
        'Static component discovery stopped at its module bound; some reachable components ' +
        'may be missing from the registry (reported, never silent).',
    });
  }
  notes.push(...walk.diagnostics);
  const byTag = new Map<string, StaticComponentDecl>();

  for (const file of walk.files) {
    if (!inside(root, file)) continue;
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const semantics = analyzeModuleSemantics(source, file, {
      vocabulary: ROUTER_MODULE_VOCABULARY,
    });
    const collect = !inside(routeRoot, file) && !inside(islandRoot, file);
    // A CLASS static component carries its tag in the `@element` decorator
    // (`defaultCompiledTag`). A GENERATED-lane page-local component carries it
    // in its sidecar (`openElement.tag`) — it has no decorator at all, so
    // without this second read the scanner reports zero components and the SSG
    // admission set never contains the tag: the page then renders the host as a
    // plain unknown element (`__h`) instead of the compiled output.
    // `readIslandConfig` THROWS on a malformed sidecar (it is the authoritative
    // reader the island scan uses). This scanner must not inherit that verdict:
    // a component whose sidecar is broken is the transform's diagnostic to
    // report, and one bad module here would abort route discovery for the whole
    // app. Swallow and let the module register as "no tag" — it is reported
    // nowhere here by design, exactly like an unparseable module in the class
    // path above.
    let declaredTag: string | undefined;
    if (
      collect &&
      semantics.defaultCompiledTag === undefined &&
      semantics.hasGeneratedElementSidecar
    ) {
      try {
        declaredTag = readIslandConfig(source)?.tag;
      } catch {
        declaredTag = undefined;
      }
    }
    const tagName = collect ? (semantics.defaultCompiledTag ?? declaredTag) : undefined;
    if (tagName) {
      const modulePath = `/${normalizeSeparators(relative(root, file))}`;
      const existing = byTag.get(tagName);
      if (existing && existing.modulePath !== modulePath) {
        throw new Error(
          `[openElement] Static component tag <${tagName}> is declared by both ` +
            `${existing.modulePath} and ${modulePath}.`,
        );
      }
      byTag.set(tagName, {
        tagName,
        modulePath,
        compilerInteractionEvents: semantics.compilerInteractionEvents,
      });
    }
  }

  const declarations = [...byTag.values()].sort(
    (a, b) => a.tagName.localeCompare(b.tagName) || a.modulePath.localeCompare(b.modulePath),
  );
  return { declarations, notes };
}
