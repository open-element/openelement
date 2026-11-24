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
 * Generated page hosts also need structural admission so the route can
 * render their compiler-emitted host producers, even without interaction
 * events. Side-effect dependencies reached from a page component keep the
 * delivery the scanner assigned to their generated hosts.
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
        component.pageComponentDependency === true ||
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
            : component.pageComponentDependency === true
              ? 'generated component imported by a page component'
              : 'generated page root (compiler-emitted host producer)',
    }));
}
