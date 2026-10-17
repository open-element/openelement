/**
 * The compiler hooks of the open build plugin (issue #1473 extraction).
 *
 * `transform` compiles @element modules during the build and adopts this
 * compiler's own emitted artifacts (a package's shipped module) for their
 * style edges; `handleHotUpdate` decides between ordinary module HMR and a
 * full reload by comparing Part Program shapes. The per-plugin-instance shape
 * map stays an instance-local closure, so no program can leak between Vite
 * builds.
 */

import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import {
  CompiledElementError,
  compiledArtifactClassCandidates,
  compileElementModule,
  compileServerComponentIfAdmitted,
  diagnosticPluginError,
  lightRootScopeTag,
  readCompiledArtifactStyles,
  recordCompilerDiagnostics,
  registerStyleRequest,
  stableModuleId,
  stripInlineSourceMapComment,
  styleEdgesForFile,
  styleRequestFile,
  styleRequestModuleId,
} from '@openelement/compiler';
import { ISLAND_ADMISSION } from '@openelement/protocol/island-admission';
import { styleAssetGraphId } from './internal/style-assets.ts';
import { devClientModulePath } from './internal/dev-client-path.ts';
import {
  createServerComponentSourceResolver,
  serverComponentAdmissionTags,
} from './internal/server-component-host.ts';
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
  // template/Part/Block shape changes.
  const compiledProgramShapes = new Map<string, string>();

  const programShape = (program: unknown): string => {
    const { sourceMap: _sourceMap, ...shape } = program as Record<string, unknown>;
    return JSON.stringify(shape);
  };

  return {
    transform(code, id) {
      try {
        const moduleId = stableModuleId(id, state.viteRoot, state.workspaceRoot);
        const result = compileElementModule(
          code,
          moduleId,
          // The island delivery policy statement is admitted only through
          // the injected descriptor; the dev style-asset plugin
          // (open:style-assets-dev) serves the `.css` edges the compile
          // registers.
          { staticSidecars: [ISLAND_ADMISSION] },
        );
        // The server function component lane (alpha15): when the class lane
        // declined, a route module carrying an exported JSX-returning
        // function compiles into `__h`/`__t`/`__ssr` constructors. Nested
        // composition resolves through the host resolver (the compiler never
        // reads the filesystem); the tags the render can expand — renderable
        // islands plus static compiled components — route nested hosts
        // through `__ssr`.
        const serverComponentResolver = createServerComponentSourceResolver({
          root: state.viteRoot ?? process.cwd(),
          workspaceRoot: state.workspaceRoot,
        });
        const serverResult =
          result === null
            ? compileServerComponentIfAdmitted(code, moduleId, {
                resolveModule: (specifier) =>
                  serverComponentResolver(specifier, moduleId) ?? undefined,
                compiledTags: serverComponentAdmissionTags(
                  state.ctx.phase1.staticComponents,
                  state.ctx.phase1.ssrAdmissionPlan?.renderableTags,
                ),
              })
            : null;
        // A shipped compiled artifact (a package's emitted module) has no
        // authored grammar left to compile, but its `.css` imports are the
        // same style edges — recovered through the artifact read so dev admits
        // the packed form exactly as the build does (#1558/KR-10).
        const artifact = result || serverResult ? undefined : readCompiledArtifactStyles(code, id);
        const styleRequests = result?.styleRequests ?? artifact?.requests;
        // the compiled-element transform is the style-edge
        // registry's one writer — this hook is that transform's dev host
        // binding (element's compiledElementPlugin is the build binding),
        // so the registration travels with it; the dev plugin's intercept
        // answers from this registry.
        if (styleRequests !== undefined) {
          // The component's root scope is part of every edge (alpha15 S lane,
          // S-C1.2): a light-root sheet leaves the build wrapped in
          // `@scope (<tag>)`, and dev scopes the served adapter identically.
          const scopeTag = result ? lightRootScopeTag(result.program) : artifact?.scopeTag;
          for (const specifier of styleRequests) {
            registerStyleRequest({
              moduleId: styleRequestModuleId(id, specifier, scopeTag),
              importer: id,
              specifier,
              file: styleRequestFile(id, specifier),
              ...(scopeTag === undefined ? {} : { scopeTag }),
            });
          }
        }
        // The class-candidate channel (alpha15 S lane) travels with the same
        // host binding: the compile's statically admitted class tokens are
        // registered exactly as the style edges are, so the build layer can
        // hand them to the official Tailwind compiler as explicit candidates.
        // The registration is authoritative for the module, including "none":
        // an edit that removed every class drops the previous facts instead of
        // leaving a stale candidate in the served sheet (defect C). The
        // registry belongs to this plugin instance (one dev server), so a
        // second project in the same process never inherits these facts.
        if (result !== null) {
          state.classCandidates.register(id, result.classCandidates ?? [], {
            // Only shadow-root classes need the component stylesheet; light
            // classes live in document DOM and the document entry covers them.
            shadow: result.program.root.kind !== 'light',
          });
        } else if (serverResult !== null) {
          // A server function component has no element class and no root —
          // its output is document DOM, so its classes are LIGHT facts.
          state.classCandidates.register(id, serverResult.classCandidates ?? [], {
            shadow: false,
          });
        } else {
          // A shipped artifact module carries its candidates (S5-B): the dev
          // binding registers the packed form exactly as the build binding.
          state.classCandidates.register(id, compiledArtifactClassCandidates(code, id) ?? [], {
            shadow: true,
          });
        }
        if (serverResult !== null) {
          return { code: serverResult.code, map: serverResult.map };
        }
        // The edge registration is the whole job for an adopted artifact:
        // it ships as its own module, nothing to compile or hand back.
        if (!result) return null;
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
        // The SAME projection the standalone compiler plugin reports through
        // (#1413): a structured `{id, loc, frame, diagnostics}` record, so the
        // dev overlay underlines the authored line and a programmatic consumer
        // reads the location instead of parsing it back out of a message. Both
        // hosts of one compiler must hand the build the same shape — this hook
        // used to pass `error.message`, which dropped the location, the frame
        // and the diagnostic code for every Router dev build.
        if (error instanceof CompiledElementError) {
          // #1612: the same boundary record the standalone plugin keeps — the
          // build exit drains it when the bundler flattens the thrown error.
          recordCompilerDiagnostics(error.diagnostics);
          this.error(diagnosticPluginError(error.diagnostics, code, id) ?? error.message);
        }
        throw error;
      }
    },

    async handleHotUpdate(hmr) {
      // A sheet file edit moves the RESOURCE's bytes; it does not change the
      // Part Program shape and must not reload the page (S-C1.3). The edge's
      // adapter is re-evaluated: its hot-accept refetches the dev resource and
      // `replace()`s the same live sheet object, so every root that holds it
      // re-renders. The server half is invalidated too, so the next document
      // render declares the same resource with the new bytes behind it.
      if (/\.css$/.test(hmr.file) && styleEdgesForFile(hmr.file).length > 0) {
        for (const edge of styleEdgesForFile(hmr.file)) {
          const graphId = styleAssetGraphId(edge.moduleId);
          for (const environment of Object.values(hmr.server.environments)) {
            const loaded = environment.moduleGraph.idToModuleMap.get(graphId);
            if (loaded === undefined) continue;
            const url = devClientModulePath(loaded);
            environment.moduleGraph.invalidateModule(loaded);
            // The client module is the one a browser holds: hand it the update
            // so its hot-accept refetches. Sending an update for a module the
            // client never loaded would make Vite fall back to a full reload,
            // which this lane must never be the cause of.
            if (environment.name === 'client' && url !== undefined) {
              environment.hot.send({
                type: 'update',
                updates: [
                  {
                    type: 'js-update',
                    path: url,
                    acceptedPath: url,
                    timestamp: Date.now(),
                  },
                ],
              });
            }
          }
        }
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
          // A changed static tree or Part/Block instruction cannot be safely
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
