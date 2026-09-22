/**
 * @openelement/router/vite - Unified openElement Vite plugin entry.
 *
 * Kept separate from the route authoring API so application routes can import
 * @openelement/router without loading Vite/build orchestration.
 */

import type { Plugin } from 'vite';
import type { FrameworkOptions } from './internal/protocol/framework.ts';
import type { SsgBehaviorOptions } from './internal/protocol/ssg.ts';
import type { OpenElementHeadConfig } from '../config.ts';
import { OpenElementBuildContext } from './build-context.ts';
import { createOpenPlugin } from './plugin.ts';
import { assertNoRenamedInlineKeys } from './app-config.ts';
import { hasInlineFrameworkOptions } from '../config.ts';
import {
  DEFAULT_COMPONENTS_DIR,
  DEFAULT_ISLANDS_DIR,
  DEFAULT_ROUTES_DIR,
} from './internal/paths.ts';

/**
 * Options for the openElement() unified Vite entry.
 *
 * The framework-options face here is deliberately narrower than the internal
 * {@linkcode FrameworkOptions} transfer type:
 *
 *  - the document-head channel is spelled `head` (never `html`), the same
 *    spelling `openelement.config.ts` uses — passing `html` fails closed and
 *    names the replacement;
 *  - the source roots keep their explicit spellings (`routesDir`,
 *    `islandsDir`, `componentsDir`), while a config file's `dirs` block is the
 *    spelling that also moves the file conventions.
 */
export interface OpenElementOptions extends Omit<FrameworkOptions, 'html'> {
  /** Document head channel: document title/lang plus structured head entries. */
  head?: OpenElementHeadConfig;
  /** SSG build behavior switches (failure policies). */
  ssg?: SsgBehaviorOptions;
}

/** Create the full OpenElement Vite plugin set: route pipeline, SSG and islands. */
export function openElement(options: OpenElementOptions = {}): Plugin[] {
  // A renamed key fails closed before anything else reads the options: the old
  // inline spelling is not carried by this face, so it would otherwise be
  // silently ignored and the app would ship a default document head.
  assertNoRenamedInlineKeys(options as Record<string, unknown>);
  const ctx = new OpenElementBuildContext({
    ...options,
    routesDir: options.routesDir || DEFAULT_ROUTES_DIR,
    islandsDir: options.islandsDir || DEFAULT_ISLANDS_DIR,
    componentsDir: options.componentsDir || DEFAULT_COMPONENTS_DIR,
  });

  // #1411: options passed here are user input and must be stated as such, so
  // the plugin can fail closed when `openelement.config.ts` also carries
  // options. `options` is forwarded verbatim, so its own values answer it.
  return [
    ...createOpenPlugin(options, ctx, {
      inlineOptionsPresent: hasInlineFrameworkOptions(options as Record<string, unknown>),
    }),
  ];
}

export default openElement;
