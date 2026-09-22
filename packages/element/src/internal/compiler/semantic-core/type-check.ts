/**
 * Build-time type check for the emitted compiled module (#1386 item 2).
 *
 * The compiler emits the compiled module as TypeScript text and hands it to the
 * bundler, which lowers it. Until this module existed, nothing type-checked
 * that text: a compiler change could emit a program that fails `deno check`,
 * `tsc`, or a consumer's `tsgo` run, and the first evidence was a consumer's
 * build — the reason the "strict emission" corpus in
 * `__tests__/compiled-element-v1.test.ts` had to pin individual `static`
 * annotations by string match.
 *
 * The check compiles the emitted text as a real TypeScript program and returns
 * the diagnostics a type checker produces for it. It is a pure function of its
 * inputs — the emitted text plus explicit compiler options and module
 * resolution paths — because ADR-0148 gives the semantic core no ambient state:
 * it reads no clock, touches no network, and mutates no global. Callers own the
 * environment (a Vite adapter passes its resolved paths; a test passes the
 * workspace map).
 *
 * Scope: this is a verification boundary, not a second compiler. It never
 * rewrites, downlevels, or evaluates the module; it answers exactly one
 * question — does the program this compiler emits type-check? — so the answer
 * can gate a build instead of surfacing in production.
 */

import ts from 'typescript';
// The single error dialect (#1386 item 3): this module's own refusals carry
// codes like every other failure in the package. The error contract is an
// import-free protocol base owner, so the semantic core stays bundler-neutral.
import { CompilerErrorCode, frameworkError } from '../../protocol/errors.ts';

/**
 * One diagnostic the type checker produced for the emitted module. `file` is
 * the virtual module id the check was given; the remaining fields locate the
 * range inside the EMITTED text.
 */
export interface EmittedModuleDiagnostic {
  code: number;
  message: string;
  file: string;
  line: number;
  character: number;
}

/** How the emitted module's imports resolve, and any virtual files to add. */
export interface EmittedModuleTypeCheckOptions {
  /**
   * Module resolution map for the specifiers the emitted module imports, in
   * TypeScript `paths` form (specifier → candidate files). A caller that
   * resolves `@openelement/element` through the workspace passes that map;
   * omitting it means imported specifiers resolve through `node_modules`, which
   * is what a packed consumer has instead.
   */
  paths?: Record<string, string[]>;
  /** Extra compiler options, merged over the defaults below. */
  compilerOptions?: ts.CompilerOptions;
  /**
   * Support files the emitted module imports, supplied as text for ids that do
   * not exist on disk (a bundler's other virtual modules). The emitted module
   * itself is added under `fileName`.
   */
  extraFiles?: Readonly<Record<string, string>>;
}

/**
 * The compiler options the emitted module is checked under. They describe the
 * language level the compiled module targets and, deliberately, keep the check
 * strict: the emitted text declares its own statics with explicit types, so a
 * program that only type-checks under `strict: false` is a defect this gate is
 * meant to catch.
 */
const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  noEmit: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
};

/**
 * Type-check one emitted compiled module. Returns `[]` when the module
 * type-checks; otherwise every diagnostic the checker reported, in emission
 * order, so a build can print all of them instead of only the first.
 *
 * The `fileName` should be the module's real (virtual) id, not a placeholder:
 * module resolution and `paths` matching both key off it, and the diagnostics
 * quote it back.
 */
export function typeCheckEmittedModule(
  code: string,
  fileName: string,
  options: EmittedModuleTypeCheckOptions = {},
): EmittedModuleDiagnostic[] {
  const compilerOptions: ts.CompilerOptions = {
    ...DEFAULT_COMPILER_OPTIONS,
    ...options.compilerOptions,
  };
  if (options.paths && Object.keys(options.paths).length > 0) {
    compilerOptions.paths = { ...options.paths };
    // `paths` is inert without a baseUrl (or a paths-only resolution root);
    // the repository root is the workspace convention every caller shares.
    compilerOptions.baseUrl ??= '.';
  }

  const virtualFiles = new Map<string, string>([[fileName, code]]);
  for (const [id, text] of Object.entries(options.extraFiles ?? {})) {
    virtualFiles.set(id, text);
  }

  // The published declaration files are the interface a consumer compiles
  // against. They are read through a host rather than by the program's own
  // file system walk, so an unknown id is a virtual file and nothing else is
  // ever requested from disk.
  const baseHost = ts.createCompilerHost(compilerOptions, true);
  const host: ts.CompilerHost = {
    ...baseHost,
    readFile: (requested) => virtualFiles.get(requested) ?? baseHost.readFile(requested),
    fileExists: (requested) => virtualFiles.has(requested) || baseHost.fileExists(requested),
    getSourceFile: (requested, languageVersion, onError, shouldCreate) => {
      const virtual = virtualFiles.get(requested);
      if (virtual === undefined) {
        return baseHost.getSourceFile(requested, languageVersion, onError, shouldCreate);
      }
      return ts.createSourceFile(
        requested,
        virtual,
        languageVersion,
        true,
        requested.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
    },
    // `noEmit` is set, so a write request is a defect; failing loudly beats
    // silently reporting a clean check for a program that tried to emit.
    writeFile: () => {
      throw frameworkError(
        CompilerErrorCode.INVALID_SOURCE,
        'typeCheckEmittedModule never emits',
        { phase: 'build' },
      );
    },
  };

  const program = ts.createProgram({
    rootNames: [...virtualFiles.keys()],
    options: compilerOptions,
    host,
  });
  return ts.getPreEmitDiagnostics(program)
    // A clean compile of the emitted module is the whole question, so only
    // diagnostics that belong to the emitted files are reported. Ancillary
    // complaints about the CALLER's resolution (a missing package the caller
    // chose not to map) would otherwise be indistinguishable from an emitted
    // module that does not type-check.
    .filter((diagnostic) => {
      return diagnostic.file !== undefined && virtualFiles.has(diagnostic.file.fileName);
    })
    .map((diagnostic) => {
      const file = diagnostic.file as ts.SourceFile;
      const position = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      return {
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        file: file.fileName,
        line: position.line + 1,
        character: position.character + 1,
      };
    });
}

/**
 * `true` when the emitted module type-checks. The boolean form exists so a
 * caller that only needs a verdict does not destructure an empty array; the
 * diagnostics form is for callers that must report what failed.
 */
export function emittedModuleTypeChecks(
  code: string,
  fileName: string,
  options: EmittedModuleTypeCheckOptions = {},
): boolean {
  return typeCheckEmittedModule(code, fileName, options).length === 0;
}
