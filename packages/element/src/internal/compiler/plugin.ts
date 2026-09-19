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

/**
 * Compile-time source identity for a module: absolute Vite ids are converted
 * to project-relative POSIX paths so Part Program `metadata.sourceFile` and
 * `sourceMap.file` never embed the build machine's path. Module resolution,
 * diagnostics, and HMR keys keep using the caller's own id.
 *
 * The anchor is the workspace root on disk — the nearest ancestor `deno.json`
 * that declares a `workspace` list — not a substring that merely looks like a
 * workspace directory (a checkout living under e.g. `/srv/www/` would fool
 * the old heuristic). When no root can be found the compiler fails closed
 * instead of emitting an absolute path.
 */
export function stableModuleId(file: string, root: string | undefined): string {
  const clean = file.split('?', 1)[0];
  if (!clean.startsWith('/')) return clean;
  // Prefer the caller's root (the Vite project root); a module outside it is
  // a linked workspace package, so fall back to the workspace root on disk.
  for (const base of [root, workspaceRootFor(clean)]) {
    if (!base) continue;
    const prefix = base.endsWith('/') ? base : `${base}/`;
    if (clean.startsWith(prefix)) return clean.slice(prefix.length);
  }
  throw new Error(
    `stableModuleId: no workspace root contains '${clean}' — refusing to emit a machine-specific source id`,
  );
}

/** Nearest ancestor of an absolute path whose deno.json declares `workspace`. */
const workspaceRootCache = new Map<string, string | undefined>();
function workspaceRootFor(file: string): string | undefined {
  let dir = file.slice(0, file.lastIndexOf('/')) || '/';
  const trail: string[] = [];
  for (;;) {
    if (workspaceRootCache.has(dir)) {
      const found = workspaceRootCache.get(dir);
      for (const visited of trail) workspaceRootCache.set(visited, found);
      return found;
    }
    trail.push(dir);
    const candidate = `${dir}/deno.json`;
    try {
      // Synchronous read keeps this usable from the synchronous compiler hook;
      // the file set is tiny and cached per directory.
      const parsed = JSON.parse(Deno.readTextFileSync(candidate)) as { workspace?: unknown };
      if (Array.isArray(parsed.workspace)) {
        for (const visited of trail) workspaceRootCache.set(visited, dir);
        return dir;
      }
    } catch {
      // No readable deno.json here; keep walking up.
    }
    if (dir === '/') {
      for (const visited of trail) workspaceRootCache.set(visited, undefined);
      return undefined;
    }
    dir = dir.slice(0, dir.lastIndexOf('/')) || '/';
  }
}

export function compiledElementPlugin(): Plugin {
  let viteRoot: string | undefined;
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
        return compileElementModule(code, stableModuleId(id, viteRoot))?.code ?? null;
      } catch (error) {
        if (error instanceof CompiledElementError) {
          this.error(error.message);
        }
        throw error;
      }
    },
  };
}
