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
   * Named `hydrate` to match `defineIslandConfig()` in the Router package —
   * one option name across both packages.
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

/** Options for the build-time island source transform. */
export interface IslandTransformOptions {
  /** Directory containing island files (e.g. "app/islands") */
  islandsDir: string;
  /** Absolute or relative file path of the source being processed */
  filePath: string;
  /**
   * Layout-convention admission (alpha15 R batch 3): the resolved layout
   * module the router convention owns (`app/layout.tsx`, tag `app-layout`,
   * or a project-relative custom `layout: { import }` override). The gate
   * admits this one path with its resolved tag even though it lives outside
   * `islandsDir`. Absent when the project configures no layout module
   * (`layout: false`, or the deletable convention file is gone).
   */
  layout?: {
    /** Project-relative layout module path (e.g. "app/layout.tsx") */
    path: string;
    /** Resolved layout tag (e.g. "app-layout") */
    tagName: string;
  };
}

/** The island transform output: rewritten source plus extracted facts. */
export interface IslandTransformResult {
  /** Transformed source code with markers */
  code: string;
  /** Detected island entries */
  islands: Array<{ tagName: string; filePath: string }>;
  /** Optional source map */
  map?: string;
}
