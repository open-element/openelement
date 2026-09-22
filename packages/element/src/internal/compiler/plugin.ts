/**
 * @openelement/element — open:compiled-element v1 plugin (#1160).
 *
 * Vite integration boundary for the alpha.0 TSX-to-Part Program compiler.
 * The hook activates only for .tsx modules that opt into the compiled model
 * with a canonically bound `@element(...)` decorator application on a class
 * declaration (#1209: the decorator identifier must resolve to a runtime
 * named import of `element` from '@openelement/element'; a bare or same-name
 * spelling never admits the module); everything else passes through
 * untouched. Admission is two-staged: a cheap `@element(` substring prefilter
 * keeps plain modules off the AST path, then the semantic core's binding
 * analysis decides — a module that merely mentions the marker inside a string
 * literal or comment, or spells it through a foreign binding, is not
 * compiled. A module whose decorator provenance is unsupported or ambiguous
 * (type-only import, namespace access, conflicting bindings, re-export) is
 * routed to the compiler so the build fails closed with a source-located
 * OEC9027 diagnostic; other unsupported grammar in a genuinely decorated
 * module fails through this.error() with a source-located OEC9xx diagnostic —
 * there is no runtime fallback.
 *
 * Internal Part Program v1 pipeline: not part of the public adapter API.
 */

import type { Plugin } from 'vite';
import {
  CompiledElementError,
  compileElementProgram,
  type CompileElementResult,
} from './semantic-core/compile.ts';
import { analyzeModuleSemantics } from './semantic-core/module-analysis.ts';
import { diagnosticPluginError } from './semantic-core/diagnostics/index.ts';
import { typeCheckEmittedModule } from './semantic-core/type-check.ts';

/** The authored substring every compiled element module contains (`@element(`), used as the cheap prefilter. */
export const COMPILED_ELEMENT_MARKER = '@element(';

/**
 * Cheap first stage only — NOT a recognizer. The substring match exists to
 * keep plain modules off the AST path and may false-positive (string literals
 * and comments match); it may also false-negative on namespace-qualified
 * spellings (`@ns.element(...)`), which are unsupported by the grammar anyway
 * (#1209). Binding provenance and admission are decided exclusively by the
 * semantic core.
 */
export function isCompiledElementModule(code: string, id: string): boolean {
  return /\.tsx(?:\?|$)/.test(id) && code.includes(COMPILED_ELEMENT_MARKER);
}

/**
 * Precise second stage behind the substring prefilter: a canonically bound
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
 * the OEC9027 provenance diagnostic.
 */
export function compileElementModule(code: string, id: string): CompileElementResult | null {
  if (!isCompiledElementModule(code, id)) return null;
  const facts = analyzeModuleSemantics(code, id);
  if (!facts.compiledElementDecorator && facts.unsupportedElementDecorator === undefined) {
    return null;
  }
  return compileElementProgram(code, id);
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
 * the compiler a path outside every known root (synthetic ids, non-Deno
 * projects without a Vite root) get the id back unchanged — there is no
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
        const compiled = compileElementModule(code, moduleId);
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
              loc: { file: id, line: first.line - 1, column: first.character - 1 },
              message: `[open:compiled-element] the compiler emitted a module that does not ` +
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
          this.error(diagnosticPluginError(error.diagnostics, code, id) ?? error.message);
        }
        throw error;
      }
    },
  };
}
