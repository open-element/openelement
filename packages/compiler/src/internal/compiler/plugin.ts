/**
 * @openelement/element — open:compiled-element v1 plugin (#1160).
 *
 * Vite integration boundary for the TSX-to-Part Program compiler.
 * The hook activates for .tsx modules that opt into the compiled model
 * with a canonically bound `@element(...)` decorator application on a class
 * declaration (#1209: the decorator identifier must resolve to a runtime
 * named import of `element` from '@openelement/element'; a bare or same-name
 * spelling never admits the module); everything else passes through
 * untouched. Admission is two-staged: a cheap prefilter (a supported module id
 * whose source contains the decorator's '@' character) keeps plain modules off
 * the AST path, then the semantic core's binding analysis decides — a module
 * that merely mentions the marker inside a string literal or comment, or spells
 * it through a foreign binding, is not
 * compiled. The prefilter is a SUPERSET of what the core admits and of what it
 * rejects: a spelling the core would reject must reach it to fail closed.
 * A module whose decorator provenance is unsupported or ambiguous
 * (type-only import, namespace access, conflicting bindings, re-export) is
 * routed to the compiler so the build fails closed with a source-located
 * OEC9027 diagnostic; other unsupported grammar in a genuinely decorated
 * module fails through this.error() with a source-located OEC9xx diagnostic —
 * there is no runtime fallback.
 *
 * The hook also ADOPTS this compiler's own emitted artifacts (a package's
 * shipped module): there is nothing left to compile, but the module's `.css`
 * imports are the same style edges the authored path registers, and the
 * style-asset intercept only answers registered edges. The artifact read
 * recovers exactly those edges (compiled-artifact-style-requests.ts) so the
 * packed and workspace-source forms of one package admit identically.
 *
 * Internal Part Program v2 pipeline: not part of the public adapter API.
 */

import type { Plugin } from 'vite';
import {
  CompiledElementError,
  compileElementProgram,
  type CompileElementResult,
} from './semantic-core/compile.ts';
import {
  analyzeModuleSemantics,
  type SemanticCoreOptions,
  type StaticSidecarDescriptor,
} from './semantic-core/module-analysis.ts';
import { compileServerComponentIfAdmitted } from './semantic-core/server-component.ts';
import {
  diagnosticPluginError,
  recordCompilerDiagnostics,
} from './semantic-core/diagnostics/index.ts';
import { typeCheckEmittedModule } from './semantic-core/type-check.ts';
import { compiledArtifactClassCandidates } from './compiled-artifact-class-candidates.ts';
import { readCompiledArtifactStyles } from './compiled-artifact-style-requests.ts';
import {
  lightRootScopeTag,
  registerStyleRequest,
  styleRequestFile,
  styleRequestModuleId,
} from './style-requests.ts';
import { type ClassCandidateRegistry } from './tailwind-candidates.ts';

/**
 * The cheap first stage — NOT a recognizer.
 *
 * It answers one question: could this module be a compiled element module? The
 * one grammar-independent fact every authored form shares is the '@' character
 * of its decorator application. Every spelling of the authored form contains
 * it — `@element(...)`, an aliased binding (`import { element as
 * defineElement }` with `@defineElement(...)`), a Unicode alias
 * (`import { element as 元件 }` with `@元件(...)`) — and so does every spelling
 * the semantic layer REJECTS but must still see in order to fail closed with
 * its provenance diagnostic (the namespace form, OEC9027). JavaScript lexing
 * makes any finer shape un-modelable in a prefilter: identifiers are not ASCII
 * (Unicode aliases are legal), and the lexer skips comments, so a block comment
 * between the decorator name and its argument list is a legal decorator
 * application no identifier-shaped regex admits.
 *
 * The stages this replaced modeled the decorator-application SHAPE — a literal
 * `@element(` substring, then an ASCII-identifier-plus-whitespace regex — and
 * therefore answered "does this module spell the decorator this way?" instead
 * of "could this module be a compiled element module?", narrowing the CONTRACT
 * rather than the AST path: legal spellings the semantic core admits never
 * reached the layer that admits them. Admission has exactly one authority; a
 * prefilter may only decide whether a module is worth parsing. A false positive
 * here (any '@' in a string literal, comment, or import specifier) costs one
 * parse and nothing else; a false negative hides a legal module from its only
 * admission authority.
 */
const SUPPORTED_MODULE_ID = /\.tsx(?:\?|$)/;

/**
 * Cheap first stage only — NOT a recognizer. The match keeps plain modules off
 * the AST path and may false-positive (any '@' — inside a string literal,
 * comment, or import specifier — matches); binding provenance and admission
 * are decided exclusively by the semantic core.
 */
export function isCompiledElementModule(code: string, id: string): boolean {
  return SUPPORTED_MODULE_ID.test(id) && code.includes('@');
}

/**
 * Precise second stage behind the prefilter: a canonically bound
 * `@element(...)` decorator application on a class declaration (provenance
 * decided by the semantic core's intrinsic-binding model). Modules that only
 * mention the marker in a string literal or comment, or spell it through a
 * foreign/local binding, do not reach the compiler.
 */
export function hasElementDecoratorApplication(code: string, id: string): boolean {
  return analyzeModuleSemantics(code, id).compiledElementDecorator;
}

/**
 * Compile one opted-in module without binding the caller to Vite. The core
 * adapter hook and the inline SSR/client builds all use this same function,
 * which prevents duplicate compiler implementations from drifting. Returns
 * null for modules without a canonically bound @element decorator
 * application, so marker-mentioning and foreign-binding modules pass through
 * untouched. Modules whose @element spelling carries unsupported or ambiguous
 * provenance are compiled anyway so the compiler boundary fails closed with
 * the OEC9027 provenance diagnostic. `options.staticSidecars` admits
 * host-declared sidecar policy statements; the default core admits none.
 */
export function compileElementModule(
  code: string,
  id: string,
  options: SemanticCoreOptions = {},
): CompileElementResult | null {
  if (!isCompiledElementModule(code, id)) return null;
  const facts = analyzeModuleSemantics(code, id);
  if (!facts.compiledElementDecorator && facts.unsupportedElementDecorator === undefined) {
    return null;
  }
  return compileElementProgram(code, id, options);
}

/**
 * Strip the inline map comment from a compiled module at the Vite boundary.
 * The core artifact embeds its real Source Map v3 inline for standalone
 * consumers; the Vite transform returns that same map as its `map` output so
 * Vite composes it with the rest of the pipeline — leaving the comment in the
 * served code would create a second, conflicting map story (#1210).
 */
export function stripInlineSourceMapComment(code: string): string {
  return code.replace(/\n\/\/# sourceMappingURL=data:application\/json;base64,[^\n]*(?=\n?$)/, '');
}

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
   * Static-sidecar descriptors the host application admits into the compiled
   * module grammar (e.g. its island delivery policy factory). The default
   * core knows none: without an injected descriptor a module carrying a
   * sidecar policy statement fails closed with OEC9008.
   */
  staticSidecars?: readonly StaticSidecarDescriptor[];
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
   * a specifier and the importing module id, return that module's SOURCE so
   * a nested server function component composes by direct call. Omitting it
   * (or answering undefined) keeps nested composition a coded rejection.
   * The compiler itself never reads the filesystem — resolution stays the
   * host's job, so this option carries the host's capability rather than a
   * path convention.
   */
  resolveServerComponentModule?: (specifier: string, importer: string) => string | null;
  /**
   * The custom-element host tags the host build admitted as @element compiled
   * components: JSX children in a server function component ride
   * `__ssr(tag, props)` for those tags and an emitted-as-is tag otherwise.
   */
  compiledTags?: readonly string[];
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
 * module with a canonically bound `@element` decorator, and leaves all other
 * modules untouched. `workspaceRoot` anchors generated source-map ids for
 * linked workspace packages.
 */
export function compiledElementPlugin(options: CompiledElementPluginOptions = {}): Plugin {
  let viteRoot: string | undefined;
  const workspaceRoot = options.workspaceRoot;
  return {
    name: 'open:compiled-element',
    configResolved(config) {
      viteRoot = config.root;
    },
    // The compiler owns the whole TSX module and must see the authored source:
    // enforce 'pre' so this hook runs before Vite's builtin TS/JSX lowering
    // (which would rewrite render() into runtime _jsx() calls the compiler
    // rightly rejects).
    enforce: 'pre',

    transform(code, id) {
      try {
        const moduleId = stableModuleId(id, viteRoot, workspaceRoot);
        const compiled = compileElementModule(code, moduleId, {
          staticSidecars: options.staticSidecars,
        });
        // The server function component lane (alpha15): the class lane
        // declined (no compiled-element decorator), so the module may still
        // be a server function page/component — an exported JSX-returning
        // function the compiler lowers into __h/__t/__ssr constructors. The
        // class candidates a function module proves are LIGHT-root facts
        // (no element class, no shadow root). Style edges are honestly
        // SKIPPED: a function page owns no element class to hang the DSD
        // `<link>` on, and a registered edge with no consumer would emit an
        // orphan CSS asset (the demand-shape discipline the style pipeline
        // documents).
        const serverCompiled =
          compiled === null
            ? compileServerComponentIfAdmitted(code, moduleId, {
                ...(options.resolveServerComponentModule === undefined
                  ? {}
                  : {
                      resolveModule: (specifier: string) => {
                        const resolved = options.resolveServerComponentModule!(specifier, moduleId);
                        return resolved ?? undefined;
                      },
                    }),
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
          compiled || serverCompiled ? undefined : readCompiledArtifactStyles(code, id);
        const styleRequests = compiled?.styleRequests ?? artifact?.requests;
        // The compiled module's `.css` edges travel to the intercepting host
        // plugin through the style-edge registry — keyed by the id the
        // bundler's resolver lands on for the authored import. The compiler
        // never writes files or reads sheet bytes; the host build owns the
        // emitted artifacts from here.
        if (styleRequests !== undefined) {
          registerStyleEdges(
            id,
            styleRequests,
            compiled ? lightRootScopeTag(compiled.program) : artifact?.scopeTag,
          );
        }
        // The compiled component's statically admitted class tokens (alpha15 S
        // lane) travel through the candidate registry: the host build hands
        // them to the OFFICIAL Tailwind compiler as explicit candidates and
        // emits the generated CSS as an external stylesheet asset. The
        // compiler attaches no Tailwind semantics to them (opaque strings).
        //
        // The registration is AUTHORITATIVE for the module, including "none":
        // a module re-transformed to carry no static class token drops its
        // previous facts, so an edit that deleted every class cannot leave a
        // stale candidate in the next stylesheet (defect C).
        if (options.candidates !== undefined) {
          if (compiled !== null) {
            options.candidates.register(id, compiled.classCandidates ?? [], {
              // The root scope is part of the fact: only a shadow-root
              // component's classes need the component stylesheet — light-root
              // classes live in document DOM and the document entry covers them.
              shadow: compiled.program.root.kind !== 'light',
            });
          } else if (serverCompiled !== null) {
            // A server function component has no element class and no root —
            // its output is document DOM, so its classes are LIGHT facts.
            options.candidates.register(id, serverCompiled.classCandidates ?? [], {
              shadow: false,
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
        if (!compiled) return null;
        if (options.typeCheckEmitted) {
          const diagnostics = typeCheckEmittedModule(compiled.code, moduleId, {
            paths: options.resolutionPaths,
          });
          const first = diagnostics[0];
          if (first) {
            // The emitted module is the compiler's own output, so a diagnostic
            // here is a compiler defect rather than an authoring error. The
            // message says which it is, and the first diagnostic supplies the
            // location the build overlay underlines.
            this.error({
              id,
              // 1-based, the same base diagnosticPluginError reports — one loc shape.
              loc: { file: id, line: first.line, column: first.character },
              message:
                `[open:compiled-element] the compiler emitted a module that does not ` +
                `type-check (${diagnostics.length} diagnostic(s); TS${first.code}: ` +
                `${first.message}). This is a compiler defect — report it with the authored ` +
                'module that triggered it.',
            });
          }
        }
        return compiled.code;
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
