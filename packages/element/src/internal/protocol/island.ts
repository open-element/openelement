/**
 * island.ts - Island contracts.
 */

import type { HydrationStrategy } from './framework.ts';

/** Per-island delivery options (hydration strategy, SSR/DSD participation). */
export interface IslandOptions {
  /** Hydration strategy:
   *   - 'load': load immediately when module is imported
   *   - 'idle': defer to requestIdleCallback (default)
   *   - 'visible': use IntersectionObserver to defer until element is visible
   *   - 'only': client-only render, no DSD/SSR output
   *
   * Named `hydrate` to match `defineIslandConfig()` in the app package
   * (`packages/router/src/authoring.ts`) — one option name across both
   * packages (ADR-0127).
   */
  hydrate?: HydrationStrategy;

  /**
   * Whether to use DSD for SSR rendering of this island.
   *
   * Honored by the build-side island scan (via `defineIslandConfig`), not by
   * `defineIsland()` itself: passing it in `IslandOptions` has no runtime
   * effect.
   * @default true
   */
  dsd?: boolean;

  /**
   * Whether this island may be admitted into server rendering.
   *
   * Like `dsd`, decided by the build-side island scan; inert when passed to
   * `defineIsland()`.
   */
  ssr?: boolean;
}

// --- Island transform types ---------------------------------------

export interface IslandTransformOptions {
  /** Directory containing island files (e.g. "app/islands") */
  islandsDir: string;
  /** Absolute or relative file path of the source being processed */
  filePath: string;
}

export interface IslandTransformResult {
  /** Transformed source code with markers */
  code: string;
  /** Detected island entries */
  islands: Array<{ tagName: string; filePath: string }>;
  /** Optional source map */
  map?: string;
}
