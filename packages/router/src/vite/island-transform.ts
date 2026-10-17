/**
 * @openelement/router — Island transform Vite plugin.
 *
 * Thin wrapper around @openelement/element/island-transform.
 * The core logic is a pure function with zero Vite dependency;
 * this file only adapts it to the Vite Plugin interface.
 */

import type { Plugin } from 'vite';
import type { IslandTransformOptions } from '@openelement/protocol/island';
import { normalizeSeparators, transformIslandSource } from '@openelement/element/build-utils';

/** Layout-convention admission for {@linkcode islandTransformPlugin}. */
export interface IslandTransformLayoutAdmission {
  /** Project-relative layout module path (e.g. "app/layout.tsx"). */
  path: string;
  /** Resolved layout tag (e.g. "app-layout"). */
  tagName: string;
}

/**
 * Derive the gate admission from the resolved framework options. Only a
 * project-relative layout module is admitted (package-specifier layouts
 * arrive prebuilt from their own package and never pass this source
 * transform); `false`/absent layouts admit nothing.
 */
export function layoutAdmissionFromOptions(
  layout: { tagName: string; import: string } | false | 'default' | undefined,
): IslandTransformLayoutAdmission | undefined {
  if (typeof layout !== 'object' || !layout) return undefined;
  if (!layout.import.startsWith('.')) return undefined;
  // Segment-wise normalization (linear, no backtracking quantifiers): strip
  // leading './' and '../' segments so the admission path compares against
  // the convention's own spelling.
  let path = layout.import;
  while (path.startsWith('./')) path = path.slice(2);
  while (path.startsWith('../')) path = path.slice(3);
  if (path === '') return undefined;
  return { path, tagName: layout.tagName };
}

/** Vite plugin that injects `__island` and `__tagName` markers into island components */
export function islandTransformPlugin(
  islandsDir: string,
  layout?: IslandTransformLayoutAdmission,
): Plugin {
  const normalizedDir = normalizeSeparators(islandsDir);

  return {
    name: 'open:island-transform',

    transform(code, id) {
      try {
        const options: IslandTransformOptions = {
          islandsDir: normalizedDir,
          filePath: normalizeSeparators(id),
        };
        if (layout) options.layout = layout;
        const result = transformIslandSource(code, options);

        if (result.islands.length === 0) return null;

        return result.code;
      } catch (e) {
        // Route errors through Vite's this.error() for proper build failure reporting
        this.error((e as Error).message);
      }
    },
  };
}
