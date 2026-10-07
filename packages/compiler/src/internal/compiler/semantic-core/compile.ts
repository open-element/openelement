/**
 * @openelement/element — TSX-to-Part Program v1 compiler (#1161–#1163).
 *
 * The compiler accepts one deliberately bounded authoring grammar. It lowers
 * every accepted dynamic expression to a typed fixed Part or Region with a
 * stable compiler-owned location. Anything outside that grammar produces a
 * source-located diagnostic; no runtime discovery or fallback renderer is
 * emitted.
 *
 * Single-duty pipeline modules behind this facade (#1473): parse-module.ts
 * (the one TypeScript parse seam), analyze-module.ts (module/class shape),
 * lower-program.ts (JSX → Program tree), emit-program.ts (Part Program
 * assembly + validation), emit-module.ts (generated module text + Source Map
 * v3), compiler-diagnostics.ts (error dialect + source locations). This file
 * stays the internal entry: it wires the stages in order and re-exports the
 * boundary types the Vite plugin and the compiler tests import.
 */

import ts from 'typescript';
import { analyzeCompiledModule } from './analyze-module.ts';
import {
  CompiledElementError,
  type CompilerFail,
  failAt,
  parseDiagnostic,
} from './compiler-diagnostics.ts';
import { buildPartProgram } from './emit-program.ts';
import { emitCompiledModule } from './emit-module.ts';
import { Lowering } from './lower-program.ts';
import { typescriptParser } from './parse-module.ts';
import { createModuleIntrinsicBindings, type SemanticCoreOptions } from './module-analysis.ts';
import { type CompiledElementSourceMap } from './source-map.ts';
import { type PartProgramV1 } from '@openelement/protocol/part-program';

export { CompiledElementError, type ElementCompilerDiagnostic } from './compiler-diagnostics.ts';

/**
 * The authored module's canonical `computed` local binding (aliases
 * followed), or null when the module never binds it. Synthesized
 * conditional-class factories (#1556) reference the authored binding when it
 * exists; otherwise the emitter adds a module-local import under the
 * synthesized name. Same resolution discipline as the ReadonlySignal scan in
 * the emitter: the canonical specifier is fixed because computed factories
 * already require it.
 */
function canonicalComputedLocal(
  sf: ts.SourceFile,
  intrinsics: ReturnType<typeof createModuleIntrinsicBindings>,
): string | null {
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@openelement/element'
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (intrinsics.isRuntimeNamedImport(element.name.text, '@openelement/element', 'computed')) {
        return element.name.text;
      }
    }
  }
  return null;
}

/**
 * The compiled module the transform emits for one authored TSX source: the
 * generated `code`, its Source Map v3, the Part Program facts the runtime
 * consumes, and the ordered diagnostics that did not fail the compile.
 */
export interface CompileElementResult {
  code: string;
  /**
   * Real Source Map v3 for the emitted module (VLQ line+column segments
   * derived from the compiler's span records and emission provenance). The
   * same map is embedded as the module's inline map; the Vite shell returns it
   * as its `map` output for downstream composition (#1210).
   */
  map: CompiledElementSourceMap;
  program: PartProgramV1;
  /**
   * The module's style edges (#1558): the authored `.css` specifiers the
   * class's `static styles` arrays, in authored order. The host build's
   * style-asset plugin intercepts these edges — a build with no intercepting
   * plugin fails at import resolution, never by silently inlining.
   */
  styleRequests?: readonly string[];
}

/**
 * Compile one authored TSX module into the compiled Part Program module.
 * `fileName` is used for diagnostics and the emitted source map only —
 * filesystem resolution is the caller's job. Fails closed with a
 * {@link CompiledElementError} carrying the ordered OEC diagnostics.
 * `options.staticSidecars` admits host-declared sidecar policy statements
 * (e.g. an island delivery descriptor); the default core admits none.
 */
export function compileElementProgram(
  source: string,
  fileName: string,
  options: SemanticCoreOptions = {},
): CompileElementResult {
  const parsed = typescriptParser.parseModule(source, fileName);
  const sf = parsed.sourceFile;
  const syntaxDiagnostics = parsed.syntaxDiagnostics;
  if (syntaxDiagnostics.length > 0) {
    throw new CompiledElementError([parseDiagnostic(sf, syntaxDiagnostics[0])]);
  }

  // The explicit annotation keeps the never-return narrowing TS grants
  // explicit bindings — the original closure was a function declaration.
  const fail: CompilerFail = failAt(sf);

  // #1209: every intrinsic use site below (decorators, heritage, factories)
  // resolves through the one canonical binding model shared with module
  // analysis — no spelling-based recognizer survives in the compiler.
  const intrinsics = createModuleIntrinsicBindings(sf, options);

  const analyzed = analyzeCompiledModule(sf, intrinsics, fail);

  const methodNames = analyzed.methods.map((method) => (method.name as ts.Identifier).text);
  const lowering = new Lowering(sf, analyzed.fields, methodNames, {
    computedLocal: canonicalComputedLocal(sf, intrinsics),
  });
  const renderStatements = analyzed.render.body?.statements ?? [];
  if (
    renderStatements.length !== 1 ||
    !ts.isReturnStatement(renderStatements[0]) ||
    !renderStatements[0].expression
  ) {
    fail(analyzed.render, 'OEC9007', 'render() must be a single return of one JSX element');
  }
  const returned = renderStatements[0] as ts.ReturnStatement;
  const root = lowering.lowerRoot(returned.expression!);
  if (root.k !== 'el') {
    fail(analyzed.render, 'OEC9007', 'render() must return one intrinsic JSX element');
  }
  // Synthesized conditional-class fields (#1556) join the analyzed inventory
  // before assembly: metadata, __compiledProps and __computedFields treat
  // them exactly like authored computeds, in declaration order.
  analyzed.fields.push(...lowering.synthesizedFields);

  const { program, programJson, propertiesJson, metadataJson, observedJson } = buildPartProgram({
    sf,
    fileName,
    analyzed,
    root,
    lowering,
  });
  const { code, map } = emitCompiledModule({
    sf,
    source,
    fileName,
    analyzed,
    lowering,
    program,
    programJson,
    propertiesJson,
    metadataJson,
    observedJson,
  });
  const { styleRequests } = analyzed;
  return {
    code,
    map,
    program,
    ...(styleRequests.length === 0 ? {} : { styleRequests }),
  };
}
