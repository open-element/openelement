/**
 * @openelement/router/vite - Unified openElement Vite plugin entry.
 *
 * Kept separate from the route authoring API so application routes can import
 * @openelement/router without loading Vite/build orchestration.
 */

import type { Plugin } from 'vite';
import type { FrameworkOptions } from './internal/protocol/framework.ts';
import type { SsgBehaviorOptions } from './internal/protocol/ssg.ts';
import { OpenElementBuildContext } from './build-context.ts';
import { createOpenPlugin } from './plugin.ts';
import {
  DEFAULT_COMPONENTS_DIR,
  DEFAULT_ISLANDS_DIR,
  DEFAULT_ROUTES_DIR,
} from './internal/paths.ts';

/** Options for the openElement() unified Vite entry. */
export interface OpenElementOptions extends FrameworkOptions {
  /** SSG build behavior switches (failure policies). */
  ssg?: SsgBehaviorOptions;
}

/** Create the full OpenElement Vite plugin set: route pipeline, SSG and islands. */
export function openElement(options: OpenElementOptions = {}): Plugin[] {
  const ctx = new OpenElementBuildContext({
    ...options,
    routesDir: options.routesDir || DEFAULT_ROUTES_DIR,
    islandsDir: options.islandsDir || DEFAULT_ISLANDS_DIR,
    componentsDir: options.componentsDir || DEFAULT_COMPONENTS_DIR,
  });

  return [...createOpenPlugin(options, ctx)];
}

export default openElement;
