/**
 * The virtual modules of the open build plugin (issue #1473 extraction).
 *
 * `open:virtual-entry` resolves the three virtual ids the pipeline owns — the
 * SSR entry, the Rollup build trigger, and the dev SSR polyfill — and renders
 * each from the shared plugin state. Moved out of plugin.ts verbatim: hook
 * behavior and plugin names are unchanged, and plugin.ts only composes hooks.
 */

import type { Plugin } from 'vite';
import { generateCustomElementsPolyfill, renderEntry } from './internal/ssg/index.ts';
import { generateEntry } from './plugin-scanners.ts';
import type { OpenPluginState } from './plugin-config.ts';

export const VIRTUAL_ENTRY_ID = 'virtual:open-hono-entry';
export const RESOLVED_ENTRY_ID = '\0' + VIRTUAL_ENTRY_ID;
export const VIRTUAL_BUILD_TRIGGER_ID = 'virtual:open-build-trigger';
export const RESOLVED_BUILD_TRIGGER_ID = '\0' + VIRTUAL_BUILD_TRIGGER_ID;
// Dev SSR polyfill: route modules call customElements.define()
// at module top level, so the dev SSR entry imports the polyfill as its
// first module — ESM evaluates it before every other import. The build
// path ships the same stub as the Rollup banner (build-ssg.ts).
const VIRTUAL_POLYFILL_ID = 'virtual:open-ssr-polyfill';
const RESOLVED_POLYFILL_ID = '\0' + VIRTUAL_POLYFILL_ID;

/** Create the `open:virtual-entry` plugin over the shared plugin state. */
export function createVirtualEntryPlugin(state: OpenPluginState): Plugin {
  return {
    name: 'open:virtual-entry',

    resolveId(id) {
      if (id === VIRTUAL_ENTRY_ID) return RESOLVED_ENTRY_ID;
      if (id === VIRTUAL_BUILD_TRIGGER_ID) return RESOLVED_BUILD_TRIGGER_ID;
      if (id === VIRTUAL_POLYFILL_ID) return RESOLVED_POLYFILL_ID;
    },

    load(id) {
      if (id === RESOLVED_POLYFILL_ID) {
        if (state.resolvedOptions.renderer === 'lit') {
          // #1339: the lit SSR path needs the @lit-labs/ssr global DOM shim —
          // not the native Map-backed customElements stub — installed before
          // any route module evaluates (ESM evaluates this first import
          // before every other entry import).
          return `import '@lit-labs/ssr/lib/install-global-dom-shim.js';\n`;
        }
        return generateCustomElementsPolyfill();
      }
      if (id === RESOLVED_BUILD_TRIGGER_ID) {
        return 'export default null;';
      }
      if (id === RESOLVED_ENTRY_ID) {
        // Reuse the descriptor built in buildStart(): the emitted entry code
        // and ctx.phase1.ssrAdmissionPlan must come from one instantiation.
        // The descriptor does not depend on late-settled plugin data, so
        // regeneration is only a fallback for the pre-buildStart placeholder.
        const entryCode = state.entryDescriptor
          ? renderEntry(state.entryDescriptor)
          : generateEntry(
            state,
            state.ctx.phase1.cachedRoutes || [],
            state.ctx.phase1.islandTagNames,
            state.ctx.phase1.packageManifests,
            state.ctx.phase1.islandFiles,
          );
        return `import '${VIRTUAL_POLYFILL_ID}';\n` + entryCode;
      }
    },
  };
}
