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
  registerStyleRequest,
  stableModuleId,
  stripInlineSourceMapComment,
  styleEdgesForFile,
  styleRequestFile,
  styleRequestModuleId,
} from '@openelement/compiler';
import { ISLAND_ADMISSION } from '@openelement/protocol/island-admission';
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
          // The island delivery policy statement is admitted only through
          // the injected descriptor; the dev style-asset plugin
          // (open:style-assets-dev) serves the `.css` edges the compile
          // registers.
          { staticSidecars: [ISLAND_ADMISSION] },
        );
        if (!result) return null;
        // the compiled-element transform is the style-edge
        // registry's one writer — this hook is that transform's dev host
        // binding (element's compiledElementPlugin is the build binding),
        // so the registration travels with it; the dev plugin's intercept
        // answers from this registry.
        if (result.styleRequests !== undefined) {
          for (const specifier of result.styleRequests) {
            registerStyleRequest({
              moduleId: styleRequestModuleId(id, specifier),
              importer: id,
              specifier,
              file: styleRequestFile(id, specifier),
            });
          }
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
      // A sheet file edit changes the inline adapter's content, not the
      // Part Program shape — the dev module's bytes would go stale (the
      // virtual graph id is not a watched file). Full reload re-fetches
      // everything fresh; the registry re-registers on the next transform.
      if (/\.css$/.test(hmr.file) && styleEdgesForFile(hmr.file).length > 0) {
        hmr.server.ws.send({ type: 'full-reload' });
        return [];
      }
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
          // Same admission as the transform.
          { staticSidecars: [ISLAND_ADMISSION] },
        );
        if (!result) {
          compiledProgramShapes.delete(hmr.file);
          return;
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
