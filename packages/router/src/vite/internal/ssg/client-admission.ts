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
            ? 'page component (route renders its host producer)'
            : 'generated page root (compiler-emitted host producer)',
    }));
}
