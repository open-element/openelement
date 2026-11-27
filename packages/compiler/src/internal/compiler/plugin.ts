/**
 * @openelement/element — open:compiled-element v1 plugin (#1160).
 *
 * Vite integration boundary for the generated Native Custom Element and
 * server function component lanes. Both are ADMISSION bridges with their own
 * predicate, so this transform asks each lane in turn and a module no lane
 * owns passes through untouched.
 *
 * The hook also ADOPTS this compiler's own emitted artifacts (a package's
 * shipped module): there is nothing left to compile, but the module's `.css`
 * imports are the same style edges the authored path registers, and the
 * style-asset intercept only answers registered edges. The artifact read
 * recovers exactly those edges (compiled-artifact-style-requests.ts) so the
 * packed and workspace-source forms of one package admit identically.
 *
 * Internal generated-lane pipeline: not part of the public adapter API.
 */

import type { Plugin } from 'vite';
import { CompiledElementError } from './semantic-core/compiler-diagnostics.ts';
import {
  compileServerComponentIfAdmitted,
  prepareServerComponentImports,
  type ResolvedServerComponentSource,
} from './semantic-core/server-component.ts';
import { compileGeneratedElementIfAdmitted } from './semantic-ir/generated-element/compile.ts';
import type { GeneratedElementSite } from './semantic-ir/generated-element/contract.ts';
import {
  diagnosticPluginError,
  recordCompilerDiagnostics,
} from './semantic-core/diagnostics/index.ts';
import { typeCheckEmittedModule } from './semantic-core/type-check.ts';
import { compiledArtifactClassCandidates } from './compiled-artifact-class-candidates.ts';
import { readCompiledArtifactStyles } from './compiled-artifact-style-requests.ts';
import { registerStyleRequest, styleRequestFile, styleRequestModuleId } from './style-requests.ts';
import { type ClassCandidateRegistry } from './tailwind-candidates.ts';

/**
 * Compile-time source identity for a module: absolute Vite ids are converted
 * to project-relative POSIX paths so Part Program `metadata.sourceFile` and
 * `sourceMap.file` never embed the build machine's path. Module resolution,
 * diagnostics, and HMR keys keep using the caller's own id.
 *
 * Anchors are explicit, never guessed from path substrings (a checkout living
 * under e.g. `/srv/www/` must not fool the cut): the Vite project root first,
 * then the workspace root when the caller knows it (a module outside the
 * project root is typically a linked workspace package). Callers that hand
 * the compiler a path outside every known root (synthetic ids, projects
 * without a Vite root) get the id back unchanged — there is no
 * correct relative form to invent, and the library boundary must not reject
 * paths it cannot anchor. This module stays runtime-neutral: resolving a
 * workspace root from disk is the caller's job.
 */
export function stableModuleId(
  file: string,
  root: string | undefined,
  workspaceRoot?: string,
): string {
  const clean = file.split('?', 1)[0];
  if (!clean.startsWith('/')) return clean;
  for (const base of [root, workspaceRoot]) {
    if (!base) continue;
    const prefix = base.endsWith('/') ? base : `${base}/`;
    if (clean.startsWith(prefix)) return clean.slice(prefix.length);
  }
  return clean;
}

/**
 * The SCOPE of a generated element's class candidates: a shadow descriptor root
 * needs the component stylesheet, a light (or absent) root does not.
 *
 * The site fact the transform received is the host's admission decision, and it
 * carries the root the shell will create. Reading it here — rather than assuming
 * light, the pre-P-1 default — is what keeps a shadow generated island's
 * utilities in the sheet that can actually reach them.
 */
function generatedSiteRootIsShadow(
  site: { readonly root?: 'light' | 'shadow' | 'closed' } | null | undefined,
): boolean {
  return site?.root === 'shadow';
}

export interface CompiledElementPluginOptions {
  /**
   * Workspace root used as the second identity anchor: Vite ids outside the
   * project root are typically linked workspace packages, and anchoring them
   * on the workspace keeps machine paths out of emitted source maps. Callers
   * that do not know a workspace root omit it and get ids passed through.
   */
  workspaceRoot?: string;
  /**
   * Type-check every module the compiler emits and fail the build when one
   * does not compile (#1386 item 2). Off by default: it runs a TypeScript
   * program per emitted module, which a dev-server transform must not pay.
   * A build or verification pass turns it on, so the emitted program is
   * checked against the declarations the consumer compiles against.
   */
  typeCheckEmitted?: boolean;
  /** Specifier → candidate files map used when `typeCheckEmitted` is on. */
  resolutionPaths?: Record<string, string[]>;
  /**
   * The class-candidate registry this plugin instance writes its compiled
   * modules' statically admitted class tokens into (alpha15 S lane). The
   * registry is OWNED by the host that created it — one per build, one per dev
   * server — so two live builds in one process never inherit each other's
   * facts (defect C). Omitted: this instance collects no candidates, which is
   * the right shape for a build that consumes none (e.g. the SSR half).
   */
  candidates?: ClassCandidateRegistry;
  /**
   * Host-supplied resolver for the server function component lane's nested
   * imports (`resolveModule` of {@link compileServerComponentModule}): given
   * a specifier and the importing module id, return that module's source so
   * a nested server function component composes by direct call. Omitting it
   * (or answering undefined) keeps nested composition a coded rejection.
   * The compiler itself never reads the filesystem — resolution stays the
   * host's job, so this option carries the host's capability rather than a
   * path convention. The third argument resolves a specifier in the active
   * Vite environment with the actual importing id.
   */
  resolveServerComponentModule?: (
    specifier: string,
    importer: string,
    resolve: (specifier: string) => Promise<{
      id: string;
      external?: boolean | 'absolute' | 'relative';
    } | null>,
  ) =>
    | string
    | ResolvedServerComponentSource
    | null
    | undefined
    | Promise<string | ResolvedServerComponentSource | null | undefined>;
  /**
   * The custom-element host tags the host build admitted as @element compiled
   * components: JSX children in a server function component ride
   * `__ssr(tag, props)` for those tags and an emitted-as-is tag otherwise.
   */
  compiledTags?: readonly string[];
  /**
   * Host-supplied site fact for the generated Native Custom Element lane
   * (M09-1b): return `{ tag }` for a module the host resolved as an island
   * whose registration tag is already decided, and null for every other
   * module. Returning null (or omitting the option) keeps the lane inert and
   * the module with the class/server/passthrough lanes.
   *
   * This is a host capability, never author syntax: the compiler transform
   * runs before the island transform, so the tag cannot be derived here. The
   * router supplies the one production closure
   * (`createGeneratedElementSiteResolver`); the lane itself still requires the
   * island sidecar and a local default-exported function component, and fails
   * closed on a props parameter or a required host binding.
   */
  generatedElementSite?: (moduleId: string) => GeneratedElementSite | null;
}

/**
 * Register one module's style edges (the registry's one write path, S-C1.4).
 *
 * The importing component's root scope is part of every edge it registers
 * (alpha15 S lane, S-C1.2): a light-root component's sheets leave the build
 * wrapped in `@scope (<tag>)`, so the tag travels to the intercept through the
 * registry key. A shipped artifact states the same fact in its Part Program
 * literal.
 *
 * The Vite transform is the caller for a module the bundler processes; a build
 * host that admits a module for its ADMISSION FACTS alone (a Page or Layout the
 * server renders and no island imports) calls the same step with the same
 * compiled program — no second writer, no second registry.
 */
export function registerStyleEdges(
  id: string,
  specifiers: readonly string[],
  scopeTag: string | undefined,
): void {
  for (const specifier of specifiers) {
    registerStyleRequest({
      moduleId: styleRequestModuleId(id, specifier, scopeTag),
      importer: id,
      specifier,
      file: styleRequestFile(id, specifier),
      ...(scopeTag === undefined ? {} : { scopeTag }),
    });
  }
}

/**
 * The `open:compiled-element` Vite plugin: runs at `enforce: 'pre'` so the
 * compiler sees authored TSX before Vite's own TS/JSX lowering, compiles every
 * module one of the two admission lanes owns, and leaves all other modules
 * untouched. `workspaceRoot` anchors generated source-map ids for linked
 * workspace packages.
 *
 * The generated-element site option is a host capability (M09-1b): hosts that
 * resolve islands before the compiler transform supply the tag fact; hosts
 * that do not (a plain standalone build) omit it and the lane stays inert.
 */
export function compiledElementPlugin(options: CompiledElementPluginOptions = {}): Plugin {
  return createCompiledElementPlugin(options);
}

function createCompiledElementPlugin(options: CompiledElementPluginOptions = {}): Plugin {
  let viteRoot: string | undefined;
  const workspaceRoot = options.workspaceRoot;
  return {
    name: 'open:compiled-element',
    configResolved(config) {
      viteRoot = config.root;
    },
    // The compiler owns the whole TSX module and must see the authored source:
    // enforce 'pre' so this hook runs before Vite's builtin TS/JSX lowering
    // (which would rewrite JSX into runtime _jsx() calls no lane admits).
    enforce: 'pre',

    async transform(code, id) {
      try {
        const moduleId = stableModuleId(id, viteRoot, workspaceRoot);
        // The generated Native Custom Element lane (M09-1) runs first: a
        // module it admits is a generated component, never a server component.
        // A host without a site fact (a standalone build) keeps this lane
        // inert; the router passes its island closure (M09-1b).
        const generated =
          options.generatedElementSite !== undefined
            ? compileGeneratedElementIfAdmitted(code, moduleId, {
                site: options.generatedElementSite(moduleId),
              })
            : null;
        const resolveServerModule = options.resolveServerComponentModule;
        const resolveModule =
          generated === null && resolveServerModule !== undefined
            ? await prepareServerComponentImports(
                code,
                moduleId,
                async (specifier) =>
                  (await resolveServerModule(specifier, moduleId, (target) =>
                    this.resolve(target, id),
                  )) ?? undefined,
              )
            : undefined;
        // The server function component lane (alpha15) answers for what the
        // generated lane declined: an exported JSX-returning function the
        // compiler lowers into __h/__t/__ssr constructors. The class
        // candidates a function module proves are LIGHT-root facts (no
        // element class, no shadow root). Style edges are honestly
        // SKIPPED: a function page owns no element to hang the DSD
        // `<link>` on, and a registered edge with no consumer would emit an
        // orphan CSS asset (the demand-shape discipline the style pipeline
        // documents).
        const serverCompiled =
          generated === null
            ? compileServerComponentIfAdmitted(code, moduleId, {
                ...(resolveModule === undefined ? {} : { resolveModule }),
                ...(options.compiledTags === undefined
                  ? {}
                  : { compiledTags: options.compiledTags }),
              })
            : null;
        // An ALREADY-compiled artifact (a package's shipped module) has no
        // authored grammar left to compile, but its `.css` imports are the
        // same style edges the authored path registers — recovered through the
        // artifact read (compiled-artifact-style-requests.ts) so the packed
        // form is admitted identically to the workspace-source form (#1558/
        // KR-10). This transform stays the registry's one writer.
        const artifact =
          generated || serverCompiled ? undefined : readCompiledArtifactStyles(code, id);
        // The adopted artifact's `.css` edges travel to the intercepting host
        // plugin through the style-edge registry — keyed by the id the
        // bundler's resolver lands on for the authored import. The compiler
        // never writes files or reads sheet bytes; the host build owns the
        // emitted artifacts from here.
        if (artifact !== undefined) {
          registerStyleEdges(id, artifact.requests, artifact.scopeTag);
        }
        // A component's statically admitted class tokens (alpha15 S lane)
        // travel through the candidate registry: the host build hands them to
        // the OFFICIAL Tailwind compiler as explicit candidates and emits the
        // generated CSS as an external stylesheet asset. The compiler attaches
        // no Tailwind semantics to them (opaque strings).
        //
        // The registration is AUTHORITATIVE for the module, including "none":
        // a module re-transformed to carry no static class token drops its
        // previous facts, so an edit that deleted every class cannot leave a
        // stale candidate in the next stylesheet (defect C).
        if (options.candidates !== undefined) {
          if (serverCompiled !== null) {
            // A server function component has no element class and no root —
            // its output is document DOM, so its classes are LIGHT facts.
            options.candidates.register(id, serverCompiled.classCandidates ?? [], {
              shadow: false,
            });
          } else if (generated !== null) {
            // A generated Native Custom Element (P-1, 2026-11-21). The lane now
            // collects its static class tokens, and the SCOPE is the descriptor
            // root: a shadow root's classes need the component stylesheet, a
            // light root's are document-DOM facts. Before P-1 this branch
            // registered "none" because the frontend carried no collector — that
            // is why a migrated shadow island painted unstyled.
            options.candidates.register(id, generated.classCandidates, {
              // The transform's site fact is optional (a host may not ask), and
              // "no fact" means the lane kept its pre-P-1 light assumption.
              shadow:
                options.generatedElementSite === undefined
                  ? false
                  : generatedSiteRootIsShadow(options.generatedElementSite(moduleId)),
            });
          } else {
            // An already-compiled artifact (a shipped package module): its
            // candidates were proven at pack time and travel in the module
            // (S5-B), so the same registry admits the packed form exactly as the
            // authored form — no second parser over the shipped markup.
            options.candidates.register(id, compiledArtifactClassCandidates(code, id) ?? [], {
              shadow: true,
            });
          }
        }
        // The generated lane owns the module: return its code and the leaf's
        // unchanged map. The appended tail has no authored source and no map
        // segments. The shell specifier resolves through the element package's
        // `./internal/compiled/generated-element/shell` export subpath, which
        // M09-1b adds to the packed manifest.
        if (generated !== null) {
          return { code: generated.code, map: generated.map };
        }
        if (serverCompiled !== null) {
          if (options.typeCheckEmitted) {
            const diagnostics = typeCheckEmittedModule(serverCompiled.code, moduleId, {
              paths: options.resolutionPaths,
            });
            const first = diagnostics[0];
            if (first) {
              this.error({
                id,
                loc: { file: id, line: first.line, column: first.character },
                message:
                  `[open:compiled-element] the server component lane emitted a module that does ` +
                  `not type-check (${diagnostics.length} diagnostic(s); TS${first.code}: ` +
                  `${first.message}). This is a compiler defect — report it with the authored ` +
                  'module that triggered it.',
              });
            }
          }
          // The lane emits no inline map comment (the artifact is standalone
          // TS without a map tail), so no strip is needed.
          return { code: serverCompiled.code, map: serverCompiled.map };
        }
        // The edge registration above is the whole job for an adopted
        // artifact: it ships as its own emitted module, nothing to compile or
        // type-check here.
        return null;
      } catch (error) {
        if (error instanceof CompiledElementError) {
          // #1413: hand the build the structured diagnostic record
          // ({id, loc, frame} plus the diagnostics array) instead of the
          // pre-joined display string — the overlay underlines the authored
          // line, and a programmatic consumer reads the location instead of
          // parsing a message back apart.
          // #1612: rolldown flattens the record off the THROWN error, so the
          // envelopes are recorded at this boundary and the build exit drains
          // them — the machine-readable aggregate keeps every OEC code.
          recordCompilerDiagnostics(error.diagnostics);
          this.error(diagnosticPluginError(error.diagnostics, code, id) ?? error.message);
        }
        throw error;
      }
    },
  };
}
