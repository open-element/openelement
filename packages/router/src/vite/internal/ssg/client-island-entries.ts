/**
 * client-island-entries.ts — build the ClientIslandEntry list for the island
 * client entry.
 *
 * Single source of truth (#951) shared by the production client build
 * (cli/build-client.ts) and the dev island client plugin
 * (dev-island-client.ts): both feed generateClientEntry() and must resolve
 * module paths, hydration strategies and ssr/dsd coercion identically.
 */

import { resolve } from 'node:path';

import type { HydrationStrategy } from '../protocol/framework.ts';
import type { IslandDecl } from '../protocol/ssg.ts';

import { fsPathToModuleSpecifier } from './module-specifier.ts';
import { resolveIslandHydrate, resolveIslandSsrDsd } from './island-scanner.ts';
import type { ClientIslandDeliveryEntry, IslandDeliveryStrategy } from './delivery.ts';

type ScannedIslandMeta = Partial<IslandDecl> & {
  hydrate?: IslandDeliveryStrategy;
  media?: string;
  tags?: readonly string[];
  tagNames?: readonly string[];
  exportNames?: Readonly<Record<string, string>>;
};

export function buildClientIslandEntries(options: {
  root: string;
  islandsDir: string;
  islandTagNames: string[];
  /** Relative file paths for local islands (preserves subdirectory structure). */
  islandFiles: string[];
  /** Local island metadata indexed by tag name. */
  islandMeta: Record<string, Partial<IslandDecl>>;
  packageIslandDecls: IslandDecl[];
  compilerBehaviorDecls?: IslandDecl[];
  upgradeStrategy?: HydrationStrategy;
}): ClientIslandDeliveryEntry[] {
  const {
    root,
    islandsDir,
    islandTagNames,
    islandFiles,
    islandMeta,
    packageIslandDecls,
    compilerBehaviorDecls = [],
    upgradeStrategy,
  } = options;

  return [
    ...islandTagNames.map((tagName: string, i: number) => {
      const meta = islandMeta[tagName] as ScannedIslandMeta | undefined;
      const strategy = resolveIslandHydrate(
        meta?.hydrate as IslandDeliveryStrategy | undefined,
        upgradeStrategy,
      ) as IslandDeliveryStrategy;
      return {
        tagName,
        // #460: resolve() emits drive-letter backslash paths on Windows; convert
        // to a Vite-resolvable specifier (root-relative or /@fs/).
        modulePath: fsPathToModuleSpecifier(
          resolve(
            root,
            islandFiles[i] ? `${islandsDir}/${islandFiles[i]}` : `${islandsDir}/${tagName}.ts`,
          ),
          root,
        ),
        isPackage: false,
        strategy,
        ...(strategy === 'media' && meta?.media !== undefined ? { media: meta.media } : {}),
        ...(meta?.tags !== undefined ? { tags: meta.tags } : {}),
        ...(meta?.tagNames !== undefined ? { tagNames: meta.tagNames } : {}),
        ...(meta?.exportNames !== undefined ? { exportNames: meta.exportNames } : {}),
        ...resolveIslandSsrDsd(meta ?? {}),
        reason: meta?.reason,
      };
    }),
    ...[...compilerBehaviorDecls, ...packageIslandDecls].map(
      (island) => {
        const delivery = island as IslandDecl & {
          media?: string;
          tags?: readonly string[];
          tagNames?: readonly string[];
          exportNames?: Readonly<Record<string, string>>;
        };
        const strategy = resolveIslandHydrate(
          (island as IslandDecl & { hydrate?: IslandDeliveryStrategy }).hydrate,
          upgradeStrategy,
        ) as IslandDeliveryStrategy;
        return ({
          tagName: island.tagName,
          modulePath: island.modulePath,
          isPackage: island.source === 'package' || island.isPackage === true,
          // #638: forward the named export so the client factory reads
          // mod[exportName] (UI package chunks dropped `export default`).
          exportName: island.exportName,
          strategy,
          ...(strategy === 'media' && delivery.media !== undefined
            ? { media: delivery.media }
            : {}),
          ...(delivery.tags !== undefined ? { tags: delivery.tags } : {}),
          ...(delivery.tagNames !== undefined ? { tagNames: delivery.tagNames } : {}),
          ...(delivery.exportNames !== undefined ? { exportNames: delivery.exportNames } : {}),
          ...resolveIslandSsrDsd(island),
          reason: island.reason,
        });
      },
    ),
  ];
}
