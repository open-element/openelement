/**
 * @openelement/compiler — Element compiler tooling entry (#1160, #1557).
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
  stableModuleId,
  stripInlineSourceMapComment,
} from './internal/compiler/plugin.ts';
// The artifact adoption read (#1558/KR-10): the style edges of a shipped
// compiled module. Host builds whose compiled-element binding is not
// `compiledElementPlugin` (the router dev transform, plugin-hmr.ts) register
// these the same way the plugin does.
export { compiledArtifactStyleRequests } from './internal/compiler/compiled-artifact-style-requests.ts';
export {
  CompiledElementError,
  compileElementProgram,
  type CompileElementResult,
  type ElementCompilerDiagnostic,
} from './internal/compiler/semantic-core/compile.ts';
export {
  analyzeModuleSemantics,
  type ModuleSemanticFacts,
  type ModuleSemanticsOptions,
  type ModuleVocabularyDescriptor,
  type SemanticCoreOptions,
  type StaticSidecarDescriptor,
} from './internal/compiler/semantic-core/module-analysis.ts';
export {
  clearStyleRequests,
  getStyleRequest,
  hasStyleImporter,
  registerStyleRequest,
  type RegisteredStyleRequest,
  styleEdgesForFile,
  styleRequestFile,
  styleRequestModuleId,
} from './internal/compiler/style-requests.ts';
export {
  type EmittedModuleDiagnostic,
  type EmittedModuleTypeCheckOptions,
  emittedModuleTypeChecks,
  typeCheckEmittedModule,
} from './internal/compiler/semantic-core/type-check.ts';
export { validatePartProgram } from '@openelement/protocol/part-program';
