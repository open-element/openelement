import type { ClientIslandAsset } from '@openelement/protocol/client-assets';

export const ISLAND_ACTIVATION_PREFIX = 'virtual:open-island-activation:';
export const ISLAND_CATALOGUE_SCRIPT_TYPE = 'application/open-islands+json';

export type IslandCatalogueEntry = readonly [
  tag: string,
  strategy: Exclude<ClientIslandAsset['strategy'], 'none'>,
  activation: string,
  media?: string,
];

/** Use all build-admitted activations if an executing host has an opaque closure. */
export function resolveDocumentIslandCatalogue(
  islands: Readonly<Record<string, ClientIslandAsset>>,
  observed: ReadonlySet<string>,
  opaque: boolean,
): IslandCatalogueEntry[] {
  const selected = new Set(observed);
  for (const tag of selected) {
    const activation = islands[tag]?.activation;
    if (!activation) continue;
    if (!activation.children) {
      opaque = true;
      break;
    }
    for (const child of activation.children) selected.add(child);
  }

  const rows: IslandCatalogueEntry[] = [];
  for (const [tag, asset] of Object.entries(islands)) {
    if ((opaque || selected.has(tag)) && asset.activation && asset.strategy !== 'none') {
      const { file, media } = asset.activation;
      rows.push(
        media === undefined ? [tag, asset.strategy, file] : [tag, asset.strategy, file, media],
      );
    }
  }
  return rows;
}
