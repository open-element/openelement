/** Discover compiled static components reachable from local route imports. */
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { RouteEntry } from '../protocol/framework.ts';
import type { StaticComponentDecl } from '../protocol/ssg.ts';
import { normalizeSeparators } from '@openelement/element/build-utils';
import { analyzeModuleSemantics } from '@openelement/element/compiler';

const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'] as const;

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

async function sourceFile(candidate: string): Promise<string | undefined> {
  try {
    const stat = await Deno.stat(candidate);
    return stat.isFile ? candidate : undefined;
  } catch {
    return undefined;
  }
}

async function resolveLocalImport(from: string, specifier: string): Promise<string | undefined> {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(from), specifier);
  const candidates = extname(base) ? [base] : [
    ...SOURCE_EXTENSIONS.map((extension) => base + extension),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    const found = await sourceFile(candidate);
    if (found) return found;
  }
  return undefined;
}

export interface ScanStaticComponentsOptions {
  root: string;
  routesDir: string;
  islandsDir: string;
  routes: readonly RouteEntry[];
}

/**
 * Follow only project-local static imports from page routes. The result is a
 * deterministic explicit registry input for the generated Vite SSR entry;
 * package imports and files outside root remain opaque.
 */
export async function scanStaticComponents(
  options: ScanStaticComponentsOptions,
): Promise<StaticComponentDecl[]> {
  const root = resolve(options.root);
  const routeRoot = resolve(root, options.routesDir);
  const islandRoot = resolve(root, options.islandsDir);
  const pending = options.routes
    .filter((route) => route.type === 'page' && !route.special)
    .map((route) => resolve(routeRoot, route.filePath));
  const seen = new Set<string>();
  const byTag = new Map<string, StaticComponentDecl>();

  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file) || !inside(root, file)) continue;
    seen.add(file);
    let source: string;
    try {
      source = await Deno.readTextFile(file);
    } catch {
      continue;
    }
    const semantics = analyzeModuleSemantics(source, file);
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
    for (const specifier of semantics.relativeImports) {
      const imported = await resolveLocalImport(file, specifier);
      if (imported && inside(root, imported) && !seen.has(imported)) pending.push(imported);
    }
  }

  return [...byTag.values()].sort((a, b) =>
    a.tagName.localeCompare(b.tagName) || a.modulePath.localeCompare(b.modulePath)
  );
}
