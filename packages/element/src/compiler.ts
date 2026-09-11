/**
 * @openelement/element/compiler — Element compiler tooling entry (#1160).
 *
 * Host-side build tooling: the TSX-to-Part Program semantic core (compiler,
 * diagnostics, module analysis, program validation) plus the Vite integration
 * boundary (`compileElementModule` / `compiledElementPlugin`). This subpath is
 * NOT part of the browser/runtime graph — it imports the TypeScript compiler
 * API and (type-only) Vite, and must never be reached from the runtime entry
 * points.
 */
export {
  COMPILED_ELEMENT_MARKER,
  compiledElementPlugin,
  compileElementModule,
  hasElementDecoratorApplication,
  isCompiledElementModule,
  stripInlineSourceMapComment,
} from './internal/compiler/plugin.ts';
export {
  CompiledElementError,
  compileElementProgram,
  type CompileElementResult,
  type ElementCompilerDiagnostic,
} from './internal/compiler/semantic-core/compile.ts';
export {
  analyzeModuleSemantics,
  type ModuleSemanticFacts,
} from './internal/compiler/semantic-core/module-analysis.ts';
export { validatePartProgram } from './internal/compiler/semantic-core/program.ts';
