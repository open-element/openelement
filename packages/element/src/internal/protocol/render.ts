/**
 * ./render.ts — Render pipeline types.
 *
 * Types for the compiled server-render contract: the render error shape shared
 * with the error protocol, the public renderDsd output, and the SSR admission
 * decision recorded by the adapter's island scanner.
 */

import type { ComponentLayer, HydrationStrategy } from './framework.ts';

export interface RenderError {
  code: string;
  severity: 'error' | 'warning';
  phase: string;
  tagName: string;
  message: string;
  recoverable: boolean;
}

export interface HydrationHint {
  tagName: string;
  layer: ComponentLayer;
  hydrate?: HydrationStrategy;
}

/**
 * The public result of one `renderDsd()` call: the serialized DSD `html`, the
 * render errors collected while composing it (empty on success), the render
 * metrics for the root component, and the hydration hints the client
 * scheduler reads to upgrade islands.
 */
export interface RenderOutput {
  html: string;
  errors: RenderError[];
  metrics: DsdRenderMetrics;
  hydrationHints: HydrationHint[];
}

export interface DsdRenderMetrics {
  tagName: string;
  renderTimeMs: number;
  templateSize: number;
  layer: ComponentLayer;
  hasError: boolean;
  nestingDepth: number;
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
   * 'foreign' (#979, 0.43.0-alpha.2): a third-party WC tag discovered by the
   * foreign-tag scanner in page/island JSX — recorded for visibility only;
   * SSR still treats it as an opaque passthrough (renderPath 'client-only').
   */
  source: 'local' | 'package' | 'nested' | 'foreign';
  renderPath: 'ssr+client' | 'client-only' | 'rejected';
  reason: string;
}
