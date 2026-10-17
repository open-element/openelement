/** Discover compiled static components reachable from local route imports. */
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'pathe';
import type { RouteEntry } from '../../framework.ts';
import type { StaticComponentDecl } from '@openelement/protocol/ssg';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { analyzeModuleSemantics } from '@openelement/compiler';
import { ROUTER_MODULE_VOCABULARY } from '@openelement/protocol/module-vocabulary';
import { walkModuleGraph, type ModuleWalkResolver } from '../module-graph-walk.ts';

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
): Promise<StaticComponentDecl[]> {
  const root = resolve(options.root);
  const routeRoot = resolve(root, options.routesDir);
  const islandRoot = resolve(root, options.islandsDir);
  const seeds = options.routes
    .filter((route) => route.type === 'page' && !route.special)
    .map((route) => resolve(routeRoot, route.filePath));
  const walk = await walkModuleGraph(options.resolve, seeds);
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
    const tagName = collect ? semantics.defaultCompiledTag : undefined;
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

  return [...byTag.values()].sort(
    (a, b) => a.tagName.localeCompare(b.tagName) || a.modulePath.localeCompare(b.modulePath),
  );
}
