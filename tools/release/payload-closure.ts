import type { Manifest } from 'vite';

interface ImportEdges {
  static: string[];
  dynamic: string[];
}

export const clientChunkUrl = (file: string): string => `/client/${file}`;

/** Resolve Vite manifest keys to deployed client URLs before traversing imports. */
export function clientImportGraph(manifest: Manifest): ReadonlyMap<string, ImportEdges> {
  function resolveImports(owner: string, imports: readonly string[] = []): string[] {
    return imports.map((key) => {
      const target = manifest[key]?.file;
      if (!target) throw new Error(`Client manifest import target missing: ${owner} -> ${key}`);
      return clientChunkUrl(target);
    });
  }
  return new Map(
    Object.entries(manifest).map(([key, entry]) => [
      clientChunkUrl(entry.file),
      {
        static: resolveImports(key, entry.imports),
        dynamic: resolveImports(key, entry.dynamicImports),
      },
    ]),
  );
}

/** Walk static imports by default. Consumers can select additional dynamic edges. */
export function payloadClosure(
  graph: ReadonlyMap<string, ImportEdges>,
  seeds: Iterable<string>,
  includeDynamic: (from: string, target: string) => boolean = () => false,
): Set<string> {
  const visited = new Set(seeds);
  const queue = [...visited];
  while (queue.length > 0) {
    const url = queue.pop()!;
    const edges = graph.get(url);
    if (!edges) throw new Error(`Client manifest has no chunk for ${url}`);
    for (const target of [
      ...edges.static,
      ...edges.dynamic.filter((to) => includeDynamic(url, to)),
    ]) {
      if (visited.has(target)) continue;
      visited.add(target);
      queue.push(target);
    }
  }
  return visited;
}
