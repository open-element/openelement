/**
 * @openelement/adapter-vite - Unified openElement Vite plugin entry.
 *
 * Kept separate from the route authoring API so application routes can import
 * @openelement/router without loading Vite/build orchestration.
 */

import type { Plugin } from 'vite';
import type { FrameworkOptions } from './internal/protocol/framework.ts';
import type { SsgBehaviorOptions } from './internal/protocol/ssg.ts';
import type { OpenElementContentOptions } from './internal/content/types.ts';
import type { OpenElementI18nOptions } from '@openelement/router/i18n';

import { OpenElementBuildContext } from './build-context.ts';
import { createOpenPlugin } from './plugin.ts';
import { openContent } from './internal/content/vite.ts';
import { openI18n } from './i18n-plugin.ts';
import { createLogger } from '@openelement/element';
import {
  DEFAULT_COMPONENTS_DIR,
  DEFAULT_ISLANDS_DIR,
  DEFAULT_ROUTES_DIR,
} from './internal/paths.ts';

const log = createLogger('app');

/** Options for the openElement() unified Vite entry. */
export interface OpenElementOptions extends FrameworkOptions {
  /** Content module options (blog + nav + sitemap). Omit to disable. */
  content?: OpenElementContentOptions;
  /** i18n module options. Omit to disable. */
  i18n?: OpenElementI18nOptions;
  /** SSG build behavior switches (failure policies). */
  ssg?: SsgBehaviorOptions;
}

/** Create the full OpenElement Vite plugin set: pipeline, content collections, nav, i18n and sitemap. */
export function openElement(options: OpenElementOptions = {}): Plugin[] {
  const { content: contentOpts, i18n: i18nOpts, ...coreOpts } = options;
  const ctx = new OpenElementBuildContext({
    ...coreOpts,
    routesDir: coreOpts.routesDir || DEFAULT_ROUTES_DIR,
    islandsDir: coreOpts.islandsDir || DEFAULT_ISLANDS_DIR,
    componentsDir: coreOpts.componentsDir || DEFAULT_COMPONENTS_DIR,
  });

  const plugins: Plugin[] = [...createOpenPlugin(coreOpts, ctx)];

  if (i18nOpts) {
    plugins.push(openI18n({ ...i18nOpts, ctx }));
    log.info('i18n plugin loaded');
  }

  if (contentOpts) {
    plugins.push(...openContent({ ...contentOpts, ctx }));
    log.info('content plugin loaded');
  }

  return plugins;
}

export default openElement;
