/** Canonical browser-delivery inputs derived from compiler-owned semantics. */

import type { HydrationStrategy } from '../protocol/framework.ts';
import type { IslandDecl, StaticComponentDecl } from '../protocol/ssg.ts';

/**
 * A route-reachable compiled component needs browser delivery when the
 * compiler proved that its authored program contains interaction handlers.
 * Static components without such behavior remain SSR-only and add no client
 * entry. Explicit Island and third-party declarations are merged separately;
 * their imperative behavior is intentionally not guessed here.
 */
export function compilerBehaviorDeclarations(
  components: readonly StaticComponentDecl[],
  upgradeStrategy: HydrationStrategy = 'idle',
): IslandDecl[] {
  return components
    .filter((component) => component.compilerInteractionEvents.length > 0)
    .map((component) => ({
      tagName: component.tagName,
      modulePath: component.modulePath,
      hydrate: upgradeStrategy,
      ssr: true,
      dsd: true,
      authoring: 'basic-element',
      source: 'nested',
      reason: `compiler-proven interaction events: ${
        component.compilerInteractionEvents.join(', ')
      }`,
    }));
}
