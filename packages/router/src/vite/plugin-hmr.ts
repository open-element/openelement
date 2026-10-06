/**
 * The compiler hooks of the open build plugin (issue #1473 extraction).
 *
 * `transform` compiles @element modules during the build; `handleHotUpdate`
 * decides between ordinary module HMR and a full reload by comparing Part
 * Program shapes. The per-plugin-instance shape map stays an instance-local
 * closure, so no program can leak between Vite builds.
 */

import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import {
  compileElementModule,
  getStyleRequest,
  registerStyleRequest,
  stableModuleId,
  stripInlineSourceMapComment,
  styleRequestModuleId,
} from '@openelement/element/compiler';
import { ISLAND_ADMISSION } from './internal/protocol/island-admission.ts';
import type { OpenPluginState } from './plugin-config.ts';

/**
 * Create the `transform`/`handleHotUpdate` hooks of `open:core` over the
 * shared plugin state. The compiled-program shape map is per-plugin-instance
 * state: it distinguishes a compatible behavior edit from a Part Program
 * shape edit during HMR, and no module-global cache may leak a program
 * between Vite builds.
 */
export function createCompilerHooks(
  state: OpenPluginState,
): Pick<Plugin, 'transform' | 'handleHotUpdate'> {
  // The shape excludes the program sourceMap: source offsets shift on ANY
  // edit (including behavior-only method-body edits), so comparing them
  // would force a full reload for every keystroke instead of only for
  // template/Part/Region shape changes.
  const compiledProgramShapes = new Map<string, string>();

  const programShape = (program: unknown): string => {
    const { sourceMap: _sourceMap, ...shape } = program as Record<string, unknown>;
    return JSON.stringify(shape);
  };

  return {
    transform(code, id) {
      try {
        const result = compileElementModule(
          code,
          stableModuleId(id, state.viteRoot, state.workspaceRoot),
          // ADR-0164: dev activates the protocol so authored islands (whose
          // same-module style constants the legacy grammar rejects with
          // OEC9008) compile identically to the production builds; the dev
          // style-asset plugin (open:style-assets-dev) serves the adapters.
          { staticSidecars: [ISLAND_ADMISSION], styleAssetProtocol: true },
        );
        if (!result) return null;
        // ADR-0164: the compiled-element transform is the style-request
        // registry's one writer — this hook is that transform's dev host
        // binding (element's compiledElementPlugin is the build binding),
        // so the registration travels with it; the dev plugin's intercept
        // answers from this registry.
        if (result.styleRequest) {
          registerStyleRequest({
            ...result.styleRequest,
            moduleId: styleRequestModuleId(id, result.styleRequest.specifier),
            importer: id,
          });
        }
        const key = id.split('?', 1)[0];
        compiledProgramShapes.set(key, programShape(result.program));
        // The semantic core emits the real Source Map v3 (#1210): return it as
        // this hook's `map` output so Vite composes it downstream, and strip
        // the inline comment the standalone artifact carries so the served
        // module has exactly one map story.
        return {
          code: stripInlineSourceMapComment(result.code),
          map: result.map,
        };
      } catch (error) {
        if (error instanceof Error) this.error(error.message);
        throw error;
      }
    },

    async handleHotUpdate(hmr) {
      if (!/\.tsx$/.test(hmr.file)) return;
      let source: string;
      try {
        source = await readFile(hmr.file, 'utf8');
      } catch {
        compiledProgramShapes.delete(hmr.file);
        return;
      }
      try {
        const result = compileElementModule(
          source,
          stableModuleId(hmr.file, state.viteRoot, state.workspaceRoot),
          // Same activation as the transform (ADR-0164): dev islands compile
          // under the protocol's grammar.
          { staticSidecars: [ISLAND_ADMISSION], styleAssetProtocol: true },
        );
        if (!result) {
          compiledProgramShapes.delete(hmr.file);
          return;
        }
        // ADR-0164: a sheet edit changes the style request's payload, not the
        // Part Program shape — the adapter module's content would go stale in
        // the dev module graph. Full reload re-fetches everything fresh; the
        // registry is re-registered by the transform that follows.
        if (result.styleRequest) {
          const registered = getStyleRequest(
            styleRequestModuleId(hmr.file, result.styleRequest.specifier),
          );
          if (registered && registered.css !== result.styleRequest.css) {
            hmr.server.ws.send({ type: 'full-reload' });
            return [];
          }
        }
        const nextShape = programShape(result.program);
        const previousShape = compiledProgramShapes.get(hmr.file);
        compiledProgramShapes.set(hmr.file, nextShape);
        if (previousShape !== undefined && previousShape !== nextShape) {
          // A changed static tree or Part/Region instruction cannot be safely
          // patched in place. Full reload is the bounded fail-closed path;
          // same-program method/initializer edits retain the element module's
          // live state through ordinary Vite HMR.
          hmr.server.ws.send({ type: 'full-reload' });
          return [];
        }
        return hmr.modules;
      } catch {
        // The next normal transform reports the source-located compiler error.
        // Do not keep a stale compiled module alive after an invalid edit.
        compiledProgramShapes.delete(hmr.file);
        hmr.server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  };
}
