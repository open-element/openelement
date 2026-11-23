/** Canonical browser-delivery inputs derived from compiler-owned semantics. */

import type { HydrationStrategy } from '../../framework.ts';
import type { IslandDecl, StaticComponentDecl } from '@openelement/protocol/ssg';

/**
 * A route-reachable compiled component needs browser delivery when the
 * compiler proved that its authored program contains interaction handlers.
 * Static components without such behavior remain SSR-only and add no client
 * entry. Explicit Island and third-party declarations are merged separately;
 * their imperative behavior is intentionally not guessed here.
 *
 * ONE exception, and it is not a guess: a GENERATED component that is a PAGE
 * ROOT (`generatedHostExport` + it is the route's page component) must be
 * SSR-renderable even with zero interaction events — its server artifact is the
 * compiler-emitted host producer, and without an admission entry the build
 * refuses the route with "not SSR-admitted". The caller marks those tags; this
 * function does not infer them.
 */
/**
 * The admission REASON texts that mark a PAGE ROOT: a route-level compiled
 * component delivered because its host producer renders the page (with or
 * without interaction events), not because it is an island.
 *
 * The distinction is load-bearing in the emitted client entry: a page root is
 * delivered and claimed, but its real content is the DSD shadow tree, so the
 * enhance morph must take the page-level DSD branch (in place) and must NOT be
 * in the island-survival tag list. In that list the morph either freezes an
 * "intact" island (light DOM only) or replaces a "changed" one — and a claimed
 * page host always looks changed once the claim has consumed its
 * `data-oe-prop-seed` transport attribute. Both paths drop user state on every
 * enhanced submit.
 */
export const PAGE_ROOT_ADMISSION_REASON = {
  pageComponent: 'page component (route renders its host producer)',
  generatedPageRoot: 'generated page root (compiler-emitted host producer)',
} as const;

/** True when an admission reason (protocol `ClientIslandEntry.reason`) is a page root. */
export function isPageRootAdmission(reason: string | undefined): boolean {
  return (
    reason === PAGE_ROOT_ADMISSION_REASON.pageComponent ||
    reason === PAGE_ROOT_ADMISSION_REASON.generatedPageRoot
  );
}

export function compilerBehaviorDeclarations(
  components: readonly StaticComponentDecl[],
  upgradeStrategy: HydrationStrategy = 'idle',
  /** Tags that must be SSR-admitted for a reason other than interaction. */
  structurallyRenderable: ReadonlySet<string> = new Set(),
): IslandDecl[] {
  return components
    .filter(
      (component) =>
        component.compilerInteractionEvents.length > 0 ||
        component.pageComponent === true ||
        structurallyRenderable.has(component.tagName),
    )
    .map((component) => ({
      tagName: component.tagName,
      modulePath: component.modulePath,
      hydrate: upgradeStrategy,
      ssr: true,
      dsd: true,
      authoring: 'basic-element',
      source: 'nested',
      reason:
        component.compilerInteractionEvents.length > 0
          ? `compiler-proven interaction events: ${component.compilerInteractionEvents.join(', ')}`
          : component.pageComponent === true
            ? PAGE_ROOT_ADMISSION_REASON.pageComponent
            : PAGE_ROOT_ADMISSION_REASON.generatedPageRoot,
    }));
}
