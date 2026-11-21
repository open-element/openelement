/** Discover compiled static components reachable from local route imports. */
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'pathe';
import type { RouteEntry } from '../../framework.ts';
import type { StaticComponentDecl } from '@openelement/protocol/ssg';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { analyzeModuleSemantics } from '@openelement/compiler';
import { ROUTER_MODULE_VOCABULARY } from '@openelement/protocol/module-vocabulary';
import { readComponentDeclaration, type ComponentDeclaration } from '../component-declaration.ts';
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
 * A page-local GENERATED component's declaration: the ONE read this scanner
 * needs, and the two facts it feeds.
 *
 * A page-local component is neither an island (no islands-dir path) nor a route
 * (its host is a nested tag), so its sidecar is its whole identity. The root
 * decides where its class candidates belong; the specifiers are what the build's
 * style carrier serves.
 */
interface PageLocalDeclaration {
  readonly declaration: ComponentDeclaration;
  readonly styleDeclaration: IslandStyleDeclaration | undefined;
  readonly root: 'light' | 'shadow';
}

/**
 * Read a page-local generated component's declaration, or undefined when the
 * module is a class component (its sheets already travel through `static styles`
 * imports, and its root fact comes from the compiled program).
 *
 * A malformed sidecar reads as undefined here: the transform is the authoritative
 * reporter of that diagnostic, and one bad module must not abort route discovery
 * for the whole app.
 */
function pageLocalDeclaration(
  source: string,
  file: string,
  islandsRoot: string,
  tagName: string,
  semantics: { readonly defaultCompiledTag?: string; readonly hasGeneratedElementSidecar: boolean },
): PageLocalDeclaration | undefined {
  if (semantics.defaultCompiledTag !== undefined || !semantics.hasGeneratedElementSidecar) {
    return undefined;
  }
  const reading = readComponentDeclaration(source, tagName);
  if (reading.kind !== 'declared') return undefined;
  const declaration = reading.declaration;
  const root: 'light' | 'shadow' = declaration.root ?? 'light';
  return {
    declaration,
    root,
    styleDeclaration:
      declaration.styles.length === 0
        ? undefined
        : {
            tagName: declaration.tag ?? tagName,
            root,
            moduleId: file,
            // Not islands-relative: a page-local component has no islands-dir
            // path. The module id is the identity every consumer reads.
            filePath: file,
            islandsDir: islandsRoot,
            specifiers: declaration.styles,
          },
  };
}

/**
 * The style declaration a PAGE MODULE carries, or undefined.
 *
 * A generated light page's sheet is a document resource, and the page has no
 * islands-dir entry and no static-component record — so its declaration is
 * registered here, keyed by the page's OWN tag, and the route's document link
 * fact resolves it from the route module rather than from a JSX reference.
 */
function pageModuleStyleDeclaration(
  file: string,
  islandsRoot: string,
): IslandStyleDeclaration | undefined {
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const reading = readComponentDeclaration(source);
  if (reading.kind !== 'declared') return undefined;
  const declaration = reading.declaration;
  // A page module must pin its own tag: it has no islands-dir path to derive one.
  if (declaration.tag === undefined || declaration.styles.length === 0) return undefined;
  return {
    tagName: declaration.tag,
    root: 'light',
    // A PAGE owns no host element: its markup is the document content, so its
    // declared sheet is delivered UNSCOPED. Scoping it to a tag that never
    // appears would compile rules that match nothing.
    scopeTag: null,
    moduleId: file,
    filePath: file,
    islandsDir: islandsRoot,
    specifiers: declaration.styles,
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
 * The component specifier one page route names in its `definePage(...)` call, or
 * undefined when the route's page definition does not name a local module.
 *
 * Deliberately minimal: this asks for the FIRST argument's import specifier and
 * nothing else. Whether the module is a generated component is decided later by
 * the same declaration reader every other pass uses; classification owns the
 * verdict, this scan only makes sure the module is walked.
 */
function readPageComponentSpecifier(routeFile: string): { readonly specifier: string } | undefined {
  let source: string;
  try {
    source = readFileSync(routeFile, 'utf8');
  } catch {
    return undefined;
  }
  const match = /definePage\(\s*([A-Za-z_$][\w$]*)/.exec(source);
  if (match === null) return undefined;
  const name = match[1]!;
  const importMatch = new RegExp(`import\\s+${name}\\s+from\\s+['"]([^'"]+)['"]`).exec(source);
  return importMatch === null ? undefined : { specifier: importMatch[1]! };
}

/** Resolve a relative specifier against its importing module, with extension probing. */
function resolveFrom(specifier: string, importer: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(importer), specifier);
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
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

  // The PAGE COMPONENTS themselves are components too (P-4): a route that imports
  // its page component passes it to `definePage`, so the module is neither a JSX
  // reference nor an island — nothing else in this walk would record it, and a
  // generated page root then has no host-producer fact for the entry to pair.
  // Reading them here keeps ONE record shape for "a component the server renders".
  const pageComponentFiles = new Set<string>();
  for (const route of options.routes) {
    if (route.type !== 'page' || route.special) continue;
    const routeFile = resolve(routeRoot, route.filePath);
    const pageFacts = readPageComponentSpecifier(routeFile);
    if (pageFacts === undefined) continue;
    const resolved = resolveFrom(pageFacts.specifier, routeFile);
    // A route that passes a LOCAL FUNCTION it declares itself is a server
    // function page, not an imported component: its module is the route module,
    // and re-recording it here would make every such page a static component.
    if (resolved === undefined || resolved === routeFile) continue;
    pageComponentFiles.add(resolved);
  }
  for (const file of [...walk.files, ...pageComponentFiles]) {
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
    // (`defaultCompiledTag`); a GENERATED-lane page-local component carries it in
    // its sidecar. ONE reader answers both the tag and the rest of the
    // declaration (component-declaration.ts), so this scanner cannot disagree
    // with the island scan, the declared-tag scan or the style walk about whether
    // a module is a component.
    //
    // A malformed sidecar reads as "not a component" here: the transform is the
    // authoritative reporter of that diagnostic, and one bad module must not
    // abort route discovery for the whole app.
    const pageLocal = collect ? pageLocalDeclaration(source, file, root, '', semantics) : undefined;
    const tagName: string | undefined = collect
      ? (semantics.defaultCompiledTag ?? pageLocal?.declaration.tag)
      : undefined;
    if (tagName) {
      const modulePath = `/${normalizeSeparators(relative(root, file))}`;
      const existing = byTag.get(tagName);
      if (existing && existing.modulePath !== modulePath) {
        throw new Error(
          `[openElement] Static component tag <${tagName}> is declared by both ` +
            `${existing.modulePath} and ${modulePath}.`,
        );
      }
      // A GENERATED static component's host producer (P-2): the same compiler
      // call the island orchestrator makes, so a page-local generated component
      // is registered as a host PAIR rather than a bare class. Without it the
      // render reaches the class path and fails with PROGRAM_MISSING — measured:
      // a migrated nested component rendered as an EMPTY host.
      const generatedHostExport =
        semantics.defaultCompiledTag === undefined
          ? generatedHostExportFor(source, file, tagName)
          : undefined;
      byTag.set(tagName, {
        tagName,
        modulePath,
        compilerInteractionEvents: semantics.compilerInteractionEvents,
        ...(generatedHostExport === undefined ? {} : { generatedHostExport }),
        ...(pageLocal === undefined ? {} : { root: pageLocal.root }),
        // A PAGE COMPONENT marker is only meaningful for a GENERATED page: the
        // entry must register its host pair because the route renders that host.
        // A class page needs no pairing (its compiled program is registered
        // through the page tag), and marking it would add an island-attribution
        // input that the class lane never had.
        ...(pageComponentFiles.has(file) && generatedHostExport !== undefined
          ? { pageComponent: true }
          : {}),
      });
      // A page-local GENERATED component's `styles` declaration rides the SAME
      // build-time carrier an island's does: the declaration is the demand fact
      // the style-edge registry turns into a content-addressed asset, the SSG
      // render reports a light root's sheet to the document sink and a shadow
      // root's rides its DSD template.
      if (pageLocal?.styleDeclaration !== undefined) {
        styleDeclarations.push({
          ...pageLocal.styleDeclaration,
          tagName,
        });
      }
    }
  }

  const declarations = [...byTag.values()].sort(
    (a, b) => a.tagName.localeCompare(b.tagName) || a.modulePath.localeCompare(b.modulePath),
  );
  return { declarations, styleDeclarations, notes };
}
