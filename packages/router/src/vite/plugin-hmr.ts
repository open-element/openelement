/**
 * The compiler hooks of the open build plugin (issue #1473 extraction).
 *
 * `transform` runs the generated Native Custom Element lane and the server
 * function lane over the authored module, and adopts this compiler's own
 * emitted artifacts (a package's shipped module) for their style edges;
 * `handleHotUpdate` decides between ordinary module HMR and a full reload by
 * comparing the emitted generated-module text. The per-plugin-instance shape
 * map stays an instance-local closure, so no shape can leak between Vite
 * builds.
 */

import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import {
  CompiledElementError,
  compiledArtifactClassCandidates,
  compileGeneratedElementIfAdmitted,
  compileServerComponentIfAdmitted,
  diagnosticPluginError,
  isJsxModuleId,
  prepareServerComponentImports,
  readCompiledArtifactStyles,
  recordCompilerDiagnostics,
  registerStyleRequest,
  stableModuleId,
  styleEdgesForFile,
  styleRequestFile,
  styleRequestModuleId,
} from '@openelement/compiler';
import {
  collectPackageIslandModuleSites,
  createGeneratedElementSiteResolver,
} from './generated-element-site.ts';
import { styleAssetGraphId } from './internal/style-assets.ts';
import { devClientModulePath } from './internal/dev-client-path.ts';
import {
  resolveViteServerComponentSource,
  serverComponentAdmissionTags,
} from './internal/server-component-host.ts';
import type { OpenPluginState } from './plugin-config.ts';

/**
 * Create the `transform`/`handleHotUpdate` hooks of `open:core` over the
 * shared plugin state. The generated-module shape map is per-plugin-instance
 * state: it distinguishes an ordinary module HMR from a changed class
 * construction, and no module-global cache may leak a shape between Vite
 * builds.
 */
export function createCompilerHooks(
  state: OpenPluginState,
): Pick<Plugin, 'transform' | 'handleHotUpdate'> {
  // The emitted text is the shape: source maps and authored offsets shift on
  // ANY edit, so the map holds the module's generated text only.
  const generatedModuleShapes = new Map<string, string>();
  // One site closure per plugin instance (one dev server), built from the
  // resolved islands dir — the same invariant the island transform plugin
  // captures. The generated lane needs the tag the island pipeline will
  // register; the compiler transform runs before the island transform, so the
  // host supplies it (M09-1b).
  // Package islands ride the same site fact: the declaration list comes from
  // the phase-1 scan, and the dev host re-reads it lazily because a package
  // module can be transformed after the scan populated the context. The map is
  // cached by declaration-array identity (the scan replaces the array only when
  // it runs).
  let packageSiteDecls: unknown;
  let packageSites: ReadonlyMap<string, string> = new Map();
  const generatedElementSite = createGeneratedElementSiteResolver(
    state.resolvedOptions.islandsDir!,
    () => {
      const decls = state.ctx.phase1.packageIslandDecls;
      if (decls !== packageSiteDecls) {
        packageSiteDecls = decls;
        packageSites = collectPackageIslandModuleSites(decls, {
          root: state.viteRoot ?? process.cwd(),
          workspaceRoot: state.workspaceRoot,
        });
      }
      return packageSites;
    },
    // The declared-tag provider (alpha16 tag-source slice): the dev host reads
    // the Phase 1 scan's map lazily because the scan runs in `buildStart` while
    // this closure is built at plugin creation, and the island rescan replaces
    // the map — reading it per call keeps the dev transform on the current
    // facts instead of a snapshot taken before the first scan.
    () => state.ctx.phase1.declaredElementTags,
    // An .mdx route's tag derives from its route-relative path, so the dev host
    // needs the same directory the lowering gets.
    state.resolvedOptions.routesDir,
  );

  // A generated module's emitted text IS the shape: any edit re-evaluates the
  // class construction and the appended tail, and an already-upgraded element
  // keeps the constructor it was defined with, so a changed generated module
  // takes the bounded full-reload path (M09-1b).
  const generatedShape = (code: string): string => JSON.stringify({ generatedElement: code });

  return {
    async transform(code, id) {
      try {
        const moduleId = stableModuleId(id, state.viteRoot, state.workspaceRoot);
        // The generated Native Custom Element lane (M09-1b): when the host
        // resolved an island tag for this module, the lane emits the generated
        // class instead of leaving the island's function default export to throw
        // at `customElements.define`. The site closure is the host's admission
        // decision and the only one the lane has.
        const site = generatedElementSite(moduleId);
        const generatedResult =
          site === null ? null : compileGeneratedElementIfAdmitted(code, moduleId, { site });
        // The server function component lane (alpha15): when the generated lane
        // declined, a route module carrying an exported JSX-returning function
        // compiles into `__h`/`__t`/`__ssr` constructors. Nested composition
        // resolves through the host resolver (the compiler never reads the
        // filesystem); the tags the render can expand — renderable islands plus
        // static compiled components — route nested hosts through `__ssr`.
        const resolveModule =
          generatedResult === null
            ? await prepareServerComponentImports(code, moduleId, (specifier) =>
                resolveViteServerComponentSource(specifier, (target) => this.resolve(target, id)),
              )
            : undefined;
        const serverResult =
          generatedResult === null
            ? compileServerComponentIfAdmitted(code, moduleId, {
                ...(resolveModule === undefined ? {} : { resolveModule }),
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
        const artifact =
          generatedResult || serverResult ? undefined : readCompiledArtifactStyles(code, id);
        // This hook is the style-edge registry's dev writer (element's
        // compiledElementPlugin is the build binding), so the registration
        // travels with it; the dev plugin's intercept answers from this
        // registry. Generated and server function modules own no authored `.css`
        // import: a generated island's declared sheets are registered from its
        // island declaration (`devAuthoredIslandStyleUrls`), and a server
        // function page has no element class to hang a DSD `<link>` on.
        if (artifact !== undefined) {
          // The component's root scope is part of every edge (alpha15 S lane,
          // S-C1.2): a light-root sheet leaves the build wrapped in
          // `@scope (<tag>)`, and dev scopes the served adapter identically.
          const scopeTag = artifact.scopeTag;
          for (const specifier of artifact.requests) {
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
        if (generatedResult !== null) {
          // A generated Native Custom Element (P-1 / P-1c, 2026-11-21). The lane
          // collects its static class tokens and the host's site fact names the
          // descriptor root, so the scope is a real fact: a shadow root's classes
          // belong to the component stylesheet, a light root's to the document
          // sheet. Before this the dev host registered "none" — which is why a
          // migrated shadow island's dev sheet compiled empty while the build
          // stayed correct.
          state.classCandidates.register(id, generatedResult.classCandidates, {
            shadow: site?.root === 'shadow',
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
        if (generatedResult !== null) {
          // Same shape as the build host: the leaf's unchanged map, no authored
          // source for the appended tail, no inline map comment to strip.
          return { code: generatedResult.code, map: generatedResult.map };
        }
        if (serverResult !== null) {
          return { code: serverResult.code, map: serverResult.map };
        }
        // The edge registration is the whole job for an adopted artifact:
        // it ships as its own module, nothing to compile or hand back.
        return null;
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
      // A sheet file edit moves the RESOURCE's bytes; it does not change a
      // module's generated shape and must not reload the page (S-C1.3). The
      // edge's adapter is re-evaluated: its hot-accept refetches the dev
      // resource and `replace()`s the same live sheet object, so every root that
      // holds it re-renders. The server half is invalidated too, so the next
      // document render declares the same resource with the new bytes behind it.
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
      if (!isJsxModuleId(hmr.file)) return;
      let source: string;
      try {
        source = await readFile(hmr.file, 'utf8');
      } catch {
        generatedModuleShapes.delete(hmr.file);
        return;
      }
      try {
        const moduleId = stableModuleId(hmr.file, state.viteRoot, state.workspaceRoot);
        // The generated lane is part of the dev transform (M09-1b), so the HMR
        // comparison must see the same module: its emitted text is its shape,
        // because a changed class construction is unsafe to patch in place.
        const site = generatedElementSite(moduleId);
        const generatedResult =
          site === null ? null : compileGeneratedElementIfAdmitted(source, moduleId, { site });
        if (generatedResult === null) {
          generatedModuleShapes.delete(hmr.file);
          return;
        }
        const nextShape = generatedShape(generatedResult.code);
        const previousShape = generatedModuleShapes.get(hmr.file);
        generatedModuleShapes.set(hmr.file, nextShape);
        if (previousShape !== undefined && previousShape !== nextShape) {
          // Any changed generated class cannot be safely patched in place. Full
          // reload is the bounded fail-closed path; an edit inside the same
          // emitted text shape retains the element module's live state through
          // ordinary Vite HMR.
          hmr.server.ws.send({ type: 'full-reload' });
          return [];
        }
        return hmr.modules;
      } catch {
        // The next normal transform reports the source-located compiler error.
        // Do not keep a stale compiled module alive after an invalid edit.
        generatedModuleShapes.delete(hmr.file);
        hmr.server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  };
}
