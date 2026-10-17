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
  compiledElementPlugin,
  registerStyleEdges,
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
export { readCompiledArtifactStyles } from './internal/compiler/compiled-artifact-style-requests.ts';
export { compiledArtifactClassCandidates } from './internal/compiler/compiled-artifact-class-candidates.ts';
export {
  CompiledElementError,
  compileElementProgram,
  type CompileElementResult,
  type ElementCompilerDiagnostic,
} from './internal/compiler/semantic-core/compile.ts';
// The server-only TSX function component lane (alpha15): the admission and
// generative lowering entry — the same lowering walk as the @element class
// path, emitting `__h`/`__t`/`__ssr` constructor code instead of a Part
// Program. Discovery facts ride analyzeModuleSemantics
// (serverFunctionComponents); the host build calls this entry for the modules
// its graph walk finds. `compileServerComponentIfAdmitted` is the host-side
// admission bridge: class-lane modules and component-less modules answer
// null, everything else compiles through the lane.
export {
  compileServerComponentIfAdmitted,
  compileServerComponentModule,
  type CompileServerComponentResult,
  type ServerComponentCompileOptions,
} from './internal/compiler/semantic-core/server-component.ts';
// The ONE diagnostic projection every host of the compiler reports through
// (the standalone Vite plugin and the Router's `open:core` transform): a
// structured `{id, loc, frame, diagnostics}` record, so a consumer reads the
// authored location instead of parsing a pre-joined string back apart.
export {
  diagnosticPluginError,
  type PluginDiagnosticError,
} from './internal/compiler/semantic-core/diagnostics/index.ts';
// The unified machine-readable consumption surface (#1612): the compiler's
// already-structured OEC diagnostics projected onto the protocol envelope the
// build exit aggregates, plus the exit-side record — rolldown flattens the
// structured record off the thrown error, so the hosts of the projection
// record at the `this.error()` boundary and the exit drains.
export {
  clearCompilerDiagnostics,
  compilerDiagnosticsToEnvelopes,
  recordCompilerDiagnostics,
  takeCompilerDiagnostics,
} from './internal/compiler/semantic-core/diagnostics/index.ts';
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
  lightRootScopeTag,
  registerStyleRequest,
  type RegisteredStyleRequest,
  styleEdgesForFile,
  styleRequestsForImporter,
  styleRequestFile,
  styleRequestModuleId,
} from './internal/compiler/style-requests.ts';
// The statically admitted class-candidate channel (alpha15 S lane): opaque
// class tokens travel from the compiled-element transform to the host build,
// which forwards them to the official Tailwind compiler as explicit
// candidates. The compiler never interprets Tailwind's class grammar. The
// registry is created by its OWNER (one per build, one per dev server), so two
// live builds in one process never share facts (defect C).
export {
  type ClassCandidateRegistry,
  createClassCandidateRegistry,
} from './internal/compiler/tailwind-candidates.ts';
export {
  type EmittedModuleDiagnostic,
  type EmittedModuleTypeCheckOptions,
  emittedModuleTypeChecks,
  typeCheckEmittedModule,
} from './internal/compiler/semantic-core/type-check.ts';
export { validatePartProgram } from '@openelement/protocol/part-program';
