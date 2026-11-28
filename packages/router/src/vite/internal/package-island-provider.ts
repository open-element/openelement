import { parseAst } from 'vite';

/**
 * Prove the module behind named constructor re-exports. A packed package can
 * expose an authoring façade and forward a constructor from its compiled
 * module. In direct activation Rollup may omit that façade entirely.
 */
export async function resolvePackageIslandProvider(
  facade: { id: string; code: string | null; importedIds: readonly string[] } | null,
  constructorExports: readonly string[],
  resolveTarget: (
    source: string,
    importer: string,
  ) => Promise<
    | {
        id: string;
        exports: readonly string[];
      }
    | undefined
  >,
): Promise<string | undefined> {
  if (!facade?.code) return undefined;

  const forwards = new Map<string, { source: string; name: string }>();
  for (const node of parseAst(facade.code).body) {
    if (node.type !== 'ExportNamedDeclaration' || !node.source) continue;
    for (const { exported, local } of node.specifiers) {
      const name = exported.type === 'Literal' ? exported.value : exported.name;
      const localName = local.type === 'Literal' ? local.value : local.name;
      if (forwards.has(name)) return undefined;
      forwards.set(name, { source: node.source.value, name: localName });
    }
  }

  const providers = new Set<string>();
  for (const name of constructorExports) {
    const forward = forwards.get(name);
    if (!forward) return undefined;
    const target = await resolveTarget(forward.source, facade.id);
    if (
      !target ||
      !facade.importedIds.includes(target.id) ||
      !target.exports.includes(forward.name)
    ) {
      return undefined;
    }
    providers.add(target.id);
  }

  return providers.size === 1 ? providers.values().next().value : undefined;
}
