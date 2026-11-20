/** Discover compiled static components reachable from local route imports. */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'pathe';
import type { RouteEntry } from '../../framework.ts';
import type { StaticComponentDecl } from '@openelement/protocol/ssg';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { analyzeModuleSemantics } from '@openelement/compiler';
import { ROUTER_MODULE_VOCABULARY } from '@openelement/protocol/module-vocabulary';
import { readIslandConfig } from './island-scanner.ts';
import type { IslandStyleDeclaration } from '../island-style-declarations.ts';
import { resolveGeneratedElementHost } from './generated-element-host-metadata.ts';
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
   * The page-local GENERATED components' declared sheets (P-2). The island scan
   * resets the build's style-declaration carrier — it owns that carrier's
   * authority for ISLANDS — so these records must be handed back to the caller
   * and re-registered after that reset, or a page-local component's sheet would
   * be dropped by an unrelated scan.
   */
  readonly styleDeclarations: IslandStyleDeclaration[];
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
/**
 * The compiler-owned host producer for a page-local GENERATED component, or
 * undefined when the lane emits none (a light/absent root, or a module the lane
 * declines).
 *
 * Read through the SAME `resolveGeneratedElementHost` the island scan uses, so a
 * page-local component and an island cannot disagree about which export is the
 * host. A refusal is not thrown here: this scanner must not abort route
 * discovery for the whole app, and the transform remains the authoritative
 * reporter of the authored diagnostic.
 */
function generatedHostExportFor(source: string, file: string, tagName: string): string | undefined {
  const identity = resolveGeneratedElementHost({
    source,
    moduleId: file,
    filePath: file,
    root: undefined,
    site: { tag: tagName },
  });
  return identity.kind === 'producer' ? identity.ssrHostExport : undefined;
}

/**
 * Register a page-local generated component's declared sheets with the build's
 * style-declaration carrier (P-2).
 *
 * The carrier is keyed by MODULE ID and consumed by the client build's style-edge
 * discovery, which is why a page-local component can use it exactly like an
 * island: the declaration is the demand fact, the emitted asset is the answer.
 * The declaration is skipped for a class component (whose sheets already travel
 * through `static styles` imports) and for a malformed sidecar (the transform is
 * the authoritative reporter of that diagnostic).
 */
function pageLocalStyleDeclaration(
  source: string,
  file: string,
  root: string,
  tagName: string,
  semantics: { readonly defaultCompiledTag?: string; readonly hasGeneratedElementSidecar: boolean },
): IslandStyleDeclaration | undefined {
  if (semantics.defaultCompiledTag !== undefined || !semantics.hasGeneratedElementSidecar) {
    return undefined;
  }
  let config: ReturnType<typeof readIslandConfig>;
  try {
    config = readIslandConfig(source);
  } catch {
    return;
  }
  if (config === null || config.styles === undefined || config.styles.length === 0) {
    return undefined;
  }
  return {
    tagName,
    root: config.root === 'shadow' ? 'shadow' : 'light',
    moduleId: file,
    // Not islands-relative: a page-local component has no islands-dir path. The
    // module id is the identity every consumer of this carrier reads.
    filePath: file,
    islandsDir: root,
    specifiers: config.styles,
  };
}

/**
 * The style declaration a PAGE module carries (P-2b), or undefined.
 *
 * A generated light page's sheet is a document resource, and the page has no
 * islands-dir entry and no static-component record — so its declaration is
 * registered here, keyed by the page's OWN tag, and the route's document link
 * fact resolves it from the route module rather than from a JSX reference.
 */
/**
 * The descriptor root a page-local GENERATED component declares, or undefined for
 * a class component.
 *
 * Read through the same sidecar reader the island scan uses; undefined keeps the
 * record a class one, where the root fact comes from the compiled program.
 */
function generatedSidecarRoot(
  source: string,
  semantics: { readonly defaultCompiledTag?: string; readonly hasGeneratedElementSidecar: boolean },
): 'light' | 'shadow' | undefined {
  if (semantics.defaultCompiledTag !== undefined || !semantics.hasGeneratedElementSidecar) {
    return undefined;
  }
  try {
    const config = readIslandConfig(source);
    if (config === null) return undefined;
    return config.root === 'shadow' ? 'shadow' : 'light';
  } catch {
    return undefined;
  }
}

function pageModuleStyleDeclaration(
  file: string,
  root: string,
): IslandStyleDeclaration | undefined {
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  if (!source.includes('defineIslandConfig')) return undefined;
  let config: ReturnType<typeof readIslandConfig>;
  try {
    config = readIslandConfig(source);
  } catch {
    return undefined;
  }
  if (config === null || config.styles === undefined || config.styles.length === 0)
    return undefined;
  // The page's tag: its sidecar's own `tag` when it pins one (a route module has
  // no islands-dir path to derive from), otherwise the scan's route tag.
  if (config.tag === undefined) return undefined;
  return {
    tagName: config.tag,
    root: 'light',
    // A PAGE owns no host element: its markup is the document content, so its
    // declared sheet is delivered UNSCOPED. Scoping it to a tag that never
    // appears would compile rules that match nothing.
    scopeTag: null,
    moduleId: file,
    filePath: file,
    islandsDir: root,
    specifiers: config.styles,
  };
}

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
  const styleDeclarations: IslandStyleDeclaration[] = [];

  for (const file of walk.files) {
    if (!inside(root, file)) continue;
    // A PAGE MODULE that declares its own sheets (P-2b, 2026-11-21). A generated
    // light page owns a root box rule exactly like a class page's `:host`, but
    // it is neither an island nor a static component, so nothing registered its
    // declaration and the sheet reached no document. The declaration rides the
    // same carrier keyed by the PAGE's own tag; the route link fact resolves it
    // (see `deriveRouteDocumentStyleLinks`).
    if (inside(routeRoot, file) && !inside(islandRoot, file)) {
      const pageDeclaration = pageModuleStyleDeclaration(file, root);
      if (pageDeclaration !== undefined) styleDeclarations.push(pageDeclaration);
      continue;
    }
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
      // A GENERATED static component's host producer (P-2, 2026-11-21): the same
      // compiler call the island orchestrator makes, so a page-local generated
      // component is registered as a host PAIR rather than a bare class. Without
      // it the render reaches the class path and fails with PROGRAM_MISSING —
      // measured: a migrated nested component rendered as an EMPTY host.
      const generatedHostExport =
        semantics.defaultCompiledTag === undefined
          ? generatedHostExportFor(source, file, tagName)
          : undefined;
      const generatedRoot = generatedSidecarRoot(source, semantics);
      byTag.set(tagName, {
        tagName,
        modulePath,
        compilerInteractionEvents: semantics.compilerInteractionEvents,
        ...(generatedHostExport === undefined ? {} : { generatedHostExport }),
        ...(generatedRoot === undefined ? {} : { root: generatedRoot }),
      });
      // A page-local GENERATED component's `styles` declaration (P-2, 2026-11-21)
      // rides the SAME build-time carrier an island's does: the declaration is the
      // demand fact the style-edge registry turns into a content-addressed asset,
      // and the SSG render reports a light root's sheet to the document sink while
      // a shadow root's rides its DSD template. Without it a migrated page-local
      // component ships its markup with no sheet at all.
      const styleDeclaration = pageLocalStyleDeclaration(source, file, root, tagName, semantics);
      if (styleDeclaration !== undefined) styleDeclarations.push(styleDeclaration);
    }
  }

  const declarations = [...byTag.values()].sort(
    (a, b) => a.tagName.localeCompare(b.tagName) || a.modulePath.localeCompare(b.modulePath),
  );
  return { declarations, styleDeclarations, notes };
}
