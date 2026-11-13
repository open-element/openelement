/**
 * @openelement/router — the generated Native Custom Element site fact (M09-1b).
 *
 * The compiler transform runs at `enforce: 'pre'`, before this package's island
 * transform (`island-transform.ts`), so the compiler cannot see `__tagName` and
 * cannot derive a tag. The host therefore supplies the one site fact the
 * generated-element lane needs: the tag the island pipeline will register.
 *
 * This module is the ONE producer of that fact. It reuses the island
 * transform's own path admission and tag derivation (`transformIslandSource`,
 * which uses `normalizeSeparators` + `pathToTagName`) instead of re-deriving a
 * second tag source, so an emitted element and its client entry can never
 * disagree about the tag. The layout admission is deliberately NOT included:
 * the layout tag is the router constant `CONVENTION_LAYOUT_TAG`, not a
 * `pathToTagName` derivation, and the layout is outside the M09-1 site
 * (design §2.4).
 *
 * The site fact only admits a module to the lane. The lane itself still
 * requires the island sidecar (`export const openElement = defineIslandConfig({…})`),
 * a local default-exported function component, and fails closed on a props
 * parameter or a required host binding; those gates live in the compiler's
 * generated-element site admission, not here.
 *
 * Call-site map — exactly three real sites, do not add a fourth:
 *
 * 1. `cli/build-client.ts` — the inline client build's `compiledElementPlugin`.
 * 2. `cli/build-ssg.ts` — the inline SSG build's `compiledElementPlugin`.
 * 3. `vite/plugin-hmr.ts` — the dev transform (`createCompilerHooks`) and its
 *    HMR shape comparison; the dev host calls the lane entry directly because
 *    it is not the Vite plugin.
 *
 * The two scanners that compile modules only to read class facts
 * (`internal/collect-shadow-candidates.ts`, `internal/style-assets.ts`)
 * intentionally do not run the generated lane: the function lane's CE output
 * carries no class program to scan.
 */

import { normalizeSeparators, transformIslandSource } from '@openelement/element/build-utils';
import type { GeneratedElementSite } from '@openelement/compiler';

/** One island module's registration site, or null when the module is not one. */
export type GeneratedElementSiteResolver = (moduleId: string) => GeneratedElementSite | null;

/**
 * Build the site closure once per host (one build, one dev server), over the
 * resolved `islandsDir`.
 *
 * `moduleId` is the host's stable module id — the same id the compiler plugin
 * derives with `stableModuleId` — so a project-relative path like
 * `app/islands/profile-card.tsx` answers `{ tag: 'profile-card' }`. An absolute
 * id is admitted only when it still carries the `islandsDir` segment, exactly
 * as the island transform would admit it.
 *
 * The production root is `light`: a shadow root cannot be authored until
 * M09-2a accepts the `root` key in the static island scan (design R8). Tests
 * pass a shadow mode directly to the compiler lane instead.
 */
export function createGeneratedElementSiteResolver(
  islandsDir: string,
): GeneratedElementSiteResolver {
  const normalizedIslandsDir = normalizeSeparators(islandsDir);
  return (moduleId: string) => {
    // The island transform is the authority for admission AND tag: it strips
    // query/hash, rejects non-script paths, anchors the islands segment on its
    // last occurrence and derives the tag with `pathToTagName`. Calling it with
    // empty source keeps the derivation identical while producing no marker
    // text (the returned code is intentionally ignored).
    const { islands } = transformIslandSource('', {
      islandsDir: normalizedIslandsDir,
      filePath: moduleId,
    });
    const island = islands[0];
    return island === undefined ? null : { tag: island.tagName, root: 'light' };
  };
}
