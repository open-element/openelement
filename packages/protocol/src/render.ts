/**
 * ./render.ts — Render pipeline types.
 *
 * Types for the compiled server-render contract: the render error shape shared
 * with the error protocol, and the SSR admission decision recorded by the
 * adapter's island scanner. `renderToString()` returns the serialized DSD `html`
 * directly as a string (alpha15 R.0-3: the `{ html, errors, metrics,
 * hydrationHints }` shell is deleted; the two hardcoded-zero metrics that
 * motivated M-E5 go away with it).
 */

import type { ComponentLayer, HydrationStrategy } from './framework.ts';
import type { ErrorPhase } from './errors.ts';

/** One render failure record the SSR pipeline reports. */
export interface RenderError {
  code: string;
  severity: 'error' | 'warning';
  phase: ErrorPhase;
  tagName: string;
  message: string;
  recoverable: boolean;
}

/** The hydration delivery hint a component or route carries. */
export interface HydrationHint {
  tagName: string;
  layer: ComponentLayer;
  hydrate?: HydrationStrategy;
}

/**
 * The build's admission verdict for one discovered tag: where the declaration
 * lives (`modulePath`), how it was discovered (`source`), which render path it
 * is admitted to, and the reason recorded for the manifest.
 */
export interface SsrAdmissionDecision {
  tagName: string;
  /**
   * Module path of the island declaration. Empty for 'foreign' decisions:
   * a foreign tag is consumed in JSX but declares no module the build owns.
   */
  modulePath: string;
  /**
   * 'foreign' (#979): a third-party WC tag discovered by the
   * foreign-tag scanner in page/island JSX — recorded for visibility only;
   * SSR still treats it as an opaque passthrough (renderPath 'client-only').
   */
  source: 'local' | 'package' | 'nested' | 'foreign';
  renderPath: 'ssr+client' | 'client-only' | 'rejected';
  reason: string;
}
