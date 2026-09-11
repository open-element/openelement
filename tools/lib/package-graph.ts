/**
 * Shared package graph utilities for openElement workspace tooling.
 *
 * Reads packages/<name>/deno.json, builds an internal dependency graph, and provides
 * topological sorting / cycle detection used by graph:check and release tasks.
 */

import { join, toFileUrl } from '@std/path';
import { walkSync } from '@std/fs/walk';
import { formatError } from '@openelement/element';
import { extractStaticModuleSpecifiers } from './typescript-ast.ts';

export interface PackageInfo {
  name: string;
  version: string;
  dir: string;
  deps: string[];
  exports: unknown;
  importKeys: Set<string>;
  importValues: Record<string, string>;
}

/**
 * Normalize an @openelement/* specifier to its package base, or null when the
 * specifier is not internal (or points at the package itself).
 */
export function normalizeInternalDep(specifier: string, self: string): string | null {
  const prefix = '@openelement/';
  if (!specifier.startsWith(prefix)) return null;
  const rest = specifier.slice(prefix.length);
  const slashIndex = rest.indexOf('/');
  const base = slashIndex === -1 ? specifier : prefix + rest.slice(0, slashIndex);
  return base === self ? null : base;
}

/**
 * Normalize a dependency specifier to its @openelement/* package base.
 * Non-internal specifiers pass through unchanged; only self-references
 * normalize to null. Deliberately NOT the same contract as
 * normalizeInternalDep: check-package-graph scans arbitrary specifiers and
 * needs the pass-through form.
 */
export function normalizeDep(dep: string, self: string): string | null {
  if (!dep.startsWith('@openelement/')) return dep;
  return normalizeInternalDep(dep, self);
}

export function extractOpenImports(source: string): string[] {
  return [
    ...new Set(
      extractStaticModuleSpecifiers(source)
        .map(({ value }) => value)
        .filter((value) => value.startsWith('@openelement/')),
    ),
  ];
}

function collectInternalDeps(dir: string, exports: unknown, self: string): string[] {
  const deps = new Set<string>();
  const srcDir = `${dir}/src`;

  function scanFile(relativePath: string): void {
    const cleanPath = relativePath.replace(/^\.\//, '');
    try {
      const text = Deno.readTextFileSync(`${dir}/${cleanPath}`);
      for (const specifier of extractOpenImports(text)) {
        const base = normalizeInternalDep(specifier, self);
        if (base) deps.add(base);
      }
    } catch {
      // Ignore missing export targets.
    }
  }

  // Scan src/ if present.
  try {
    for (
      const entry of walkSync(srcDir, {
        includeDirs: false,
        skip: [/^node_modules$/, /^dist$/],
      })
    ) {
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      const text = Deno.readTextFileSync(entry.path);
      for (const specifier of extractOpenImports(text)) {
        const base = normalizeInternalDep(specifier, self);
        if (base) deps.add(base);
      }
    }
  } catch {
    // Packages without src are allowed.
  }

  // Scan declared export entry points (e.g. packages/create/cli.ts).
  if (typeof exports === 'string') {
    scanFile(exports);
  } else if (exports && typeof exports === 'object') {
    for (const value of Object.values(exports as Record<string, unknown>)) {
      if (typeof value === 'string') scanFile(value);
    }
  }

  return [...deps];
}

export async function readPackage(dir: string): Promise<PackageInfo | null> {
  const path = `${dir}/deno.json`;
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
  let json: {
    name?: string;
    version?: string;
    imports?: Record<string, string>;
    exports?: unknown;
  };
  try {
    json = JSON.parse(raw);
  } catch (error) {
    // Fail loud (#753): a silently skipped package vanishes from every gate
    // that derives from readPackages() (interface snapshot, graph:check,
    // publish order) while those gates stay green.
    throw new Error(
      `${path} is not valid JSON; refusing to silently drop the package: ${formatError(error)}`,
    );
  }
  const name = json.name;
  if (!name) return null;
  const imports: Record<string, string> = json.imports ?? {};
  const declaredDeps = Object.keys(imports)
    .map((specifier) => normalizeInternalDep(specifier, name))
    .filter((specifier): specifier is string => specifier !== null);
  const sourceDeps = collectInternalDeps(dir, json.exports, name);
  const deps = [...new Set([...declaredDeps, ...sourceDeps])];
  return {
    name,
    version: json.version ?? '',
    dir,
    deps,
    exports: json.exports,
    importKeys: new Set(Object.keys(imports)),
    importValues: imports,
  };
}

export async function readPackages(): Promise<PackageInfo[]> {
  const packages: PackageInfo[] = [];
  for await (const entry of Deno.readDir('packages')) {
    if (!entry.isDirectory) continue;
    const info = await readPackage(`packages/${entry.name}`);
    if (info) packages.push(info);
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildDependencyGraph(packages: PackageInfo[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const pkg of packages) {
    const normalized = pkg.deps
      .map((dep) => normalizeInternalDep(dep, pkg.name))
      .filter((dep): dep is string => dep !== null);
    graph.set(pkg.name, [...new Set(normalized)]);
  }
  return graph;
}

export function detectCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    for (const neighbor of graph.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path]);
      } else if (recStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart !== -1) {
          const cycle = path.slice(cycleStart);
          cycle.push(neighbor);
          cycles.push(cycle);
        }
      }
    }

    recStack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) dfs(node, []);
  }

  return cycles;
}

export function topologicalSort(graph: Map<string, string[]>): string[] {
  const inDegree = new Map<string, number>();
  const allNodes = [...graph.keys()];
  const nodeSet = new Set(allNodes);
  const dependents = new Map<string, string[]>();

  for (const node of allNodes) {
    inDegree.set(node, 0);
    dependents.set(node, []);
  }

  for (const [node, deps] of graph) {
    for (const dep of deps) {
      if (nodeSet.has(dep)) {
        inDegree.set(node, (inDegree.get(node) ?? 0) + 1);
        dependents.get(dep)!.push(node);
      }
    }
  }

  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) queue.push(node);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    queue.sort();
    const node = queue.shift()!;
    sorted.push(node);

    for (const neighbor of dependents.get(node) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== allNodes.length) {
    const remaining = allNodes.filter((node) => !sorted.includes(node));
    throw new Error(
      `Graph has a cycle involving: ${remaining.join(', ')}. ` +
        `Sorted ${sorted.length}/${allNodes.length} nodes.`,
    );
  }

  return sorted;
}

export function sortPackages(packages: PackageInfo[]): PackageInfo[] {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const order = topologicalSort(buildDependencyGraph(packages));
  return order.map((name) => byName.get(name)!);
}

/**
 * Group workspace packages by version (#849). The single-release-line checks
 * in check-package-graph.ts and publish-npm.ts both aggregate this map; a
 * size > 1 means the workspace is not on one release line.
 */
export function packagesByVersion(packages: PackageInfo[]): Map<string, string[]> {
  const versions = new Map<string, string[]>();
  for (const pkg of packages) {
    const list = versions.get(pkg.version) ?? [];
    list.push(pkg.name);
    versions.set(pkg.version, list);
  }
  return versions;
}

export function releasePublishOrder(packages: PackageInfo[]): PackageInfo[] {
  // Publish-priority ranking of the canonical retained package line
  // (the package roster in docs/release/release-state.json), dependency-lean
  // packages first. The order is a deliberate permutation, not derivable
  // from the canonical list's ordering; a new retained package must be
  // inserted here by rank — unranked packages publish last, and the
  // dependency check below still throws if that puts a dependent before
  // its dependency (#828).
  const releasePriority = [
    '@openelement/element',
    '@openelement/router',
    '@openelement/create',
  ];
  const topological = sortPackages(packages);
  const rank = new Map(releasePriority.map((name, index) => [name, index]));
  const ordered = [...topological].sort((a, b) =>
    (rank.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
    (rank.get(b.name) ?? Number.MAX_SAFE_INTEGER)
  );
  const position = new Map(ordered.map((pkg, index) => [pkg.name, index]));

  for (const pkg of ordered) {
    for (const dep of pkg.deps) {
      const base = normalizeInternalDep(dep, pkg.name);
      if (!base) continue;
      const depIndex = position.get(base);
      if (depIndex === undefined) continue;
      const pkgIndex = position.get(pkg.name)!;
      if (depIndex > pkgIndex) {
        throw new Error(
          `Package publish order is invalid: ${pkg.name} appears before dependency ${base}.`,
        );
      }
    }
  }

  return ordered;
}

/**
 * Returns a Map of specifier → file URL for all local package entries
 * derived from each package's deno.json exports. Used by smoke tests to
 * resolve @openelement/* imports to local source.
 *
 * Entries are ordered by key length descending so that Vite alias resolution
 * matches the most specific specifier first.
 */
export function allPackageAliases(repoRoot: string): Map<string, string> {
  const entries: Array<[string, string]> = [];

  for (const entry of Deno.readDirSync(join(repoRoot, 'packages'))) {
    if (!entry.isDirectory) continue;
    const pkgDir = join(repoRoot, 'packages', entry.name);
    let denoJson: { name?: string; exports?: unknown };
    try {
      denoJson = JSON.parse(Deno.readTextFileSync(join(pkgDir, 'deno.json')));
    } catch {
      continue;
    }
    const { name: packageName, exports: exportsField } = denoJson;
    if (!packageName) continue;

    if (typeof exportsField === 'string') {
      entries.push([packageName, toFileUrl(join(pkgDir, exportsField)).href]);
    } else if (exportsField && typeof exportsField === 'object') {
      for (
        const [subpath, target] of Object.entries(
          exportsField as Record<string, string>,
        )
      ) {
        const specifier = subpath === '.' ? packageName : `${packageName}${subpath.slice(1)}`;
        entries.push([specifier, toFileUrl(join(pkgDir, target)).href]);
      }
    }
  }

  entries.sort((a, b) => b[0].length - a[0].length);
  return new Map(entries);
}
