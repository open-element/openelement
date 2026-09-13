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

export function compiledElementPlugin(): Plugin {
  return {
    name: 'open:compiled-element',
    // The compiler owns the whole TSX module and must see the authored source:
    // enforce 'pre' so this hook runs before Vite's builtin TS/JSX lowering
    // (which would rewrite render() into runtime _jsx() calls the compiler
    // rightly rejects).
    enforce: 'pre',

    transform(code, id) {
      try {
        return compileElementModule(code, id)?.code ?? null;
      } catch (error) {
        if (error instanceof CompiledElementError) {
          this.error(error.message);
        }
        throw error;
      }
    },
  };
}
