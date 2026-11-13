/**
 * M09-1a — the generated-element lane entry.
 *
 * Mirrors `compileServerComponentIfAdmitted`: returns null for a module the
 * lane does not own (no host site fact, non-TSX, or the class lane's decorator
 * grammar) and fails closed with the single compiler error dialect when it does
 * own a module it must refuse. The host calls it between the class lane and the
 * server function lane in `compiledElementPlugin.transform`.
 *
 * The lane is inert in a real build: no production host passes a
 * `generatedElementSite` option in M09-1a, so every real module returns null at
 * the first gate. The router wiring that supplies a site is M09-1b.
 */

import {
  CompiledElementError,
  type ElementCompilerDiagnostic,
} from '../../semantic-core/compiler-diagnostics.ts';
import {
  compileFunctionModule,
  type FunctionModelComponent,
} from '../../semantic-core/function-frontend.ts';
import { analyzeModuleSemantics } from '../../semantic-core/module-analysis.ts';
import { typescriptParser } from '../../semantic-core/parse-module.ts';
import type { CompiledElementSourceMap } from '../../semantic-core/source-map.ts';
import type { IrDiagnostic } from '../types.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  type GeneratedElementSite,
} from './contract.ts';
import { generateElementModule } from './emit.ts';
import {
  admitGeneratedElementSite,
  gateGeneratedElementBindings,
  gateGeneratedElementRootProps,
} from './site.ts';

/** Host-supplied inputs for one generated-element compile. */
export interface CompileGeneratedElementOptions {
  /** The host's site fact; null keeps the lane inert. */
  readonly site: GeneratedElementSite | null;
  /** The authored source for the emitted module's source map. */
  readonly authoredSource?: string;
}

/** The compiled generated-element module (text plus the leaf's unchanged map). */
export interface CompiledGeneratedElement {
  readonly code: string;
  /** The leaf source map, unchanged; the appended CE tail has no segments. */
  readonly map: CompiledElementSourceMap | null;
  readonly tag: string;
  readonly component: string;
}

function toCompilerDiagnostic(diagnostic: IrDiagnostic): ElementCompilerDiagnostic {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    file: diagnostic.span.file,
    line: diagnostic.span.line,
    character: diagnostic.span.column,
    start: diagnostic.span.start,
    end: diagnostic.span.end,
  };
}

function notAComponent(componentName: string, moduleFile: string): IrDiagnostic {
  return {
    severity: 'error',
    code: GENERATED_ELEMENT_DIAGNOSTIC.NOT_A_COMPONENT,
    message:
      `the default export "${componentName}" is a function, but the function frontend did not ` +
      'admit it as a component (a component returns JSX); M09-1 will not ship a non-constructor ' +
      'default export for an island',
    span: { file: moduleFile, start: 0, end: 0, line: 1, column: 1 },
    origin: 'module',
  };
}

/**
 * Compile one module through the generated native element lane when — and only
 * when — the host supplied a site fact for it.
 *
 * Admission order (design §4.2): site fact → class-lane ownership → syntactic
 * default-export/sidecar admission (the root and focus facts and the property
 * table included: the lane reads them from the sidecar, D-root-source /
 * D-delegatesFocus / D-props) → props parameter/type cross-check → leaf
 * generation → bindings requirement. The final emitter step is append-only over the leaf text, so
 * every refusal happens before a half-built module can be returned.
 */
export function compileGeneratedElementIfAdmitted(
  code: string,
  id: string,
  options: CompileGeneratedElementOptions,
): CompiledGeneratedElement | null {
  if (options.site === null) return null;
  // The site predicate is a host decision, but the lane never parses a
  // non-TSX id as JSX: the function grammar cannot appear in one.
  if (!/\.tsx(?:\?|$)/.test(id)) return null;

  const classFacts = analyzeModuleSemantics(code, id);
  if (classFacts.compiledElementDecorator || classFacts.unsupportedElementDecorator !== undefined) {
    // The class lane owns (or fails closed on) the module; never shadow it.
    return null;
  }

  const parsed = typescriptParser.parseModule(code, id);
  if (parsed.syntaxDiagnostics.length > 0) {
    // The host reports the syntax error; a lane that invents a second parse
    // dialect here would hide the authored location.
    return null;
  }
  const siteAdmission = admitGeneratedElementSite(parsed.sourceFile, options.site);
  if (siteAdmission.kind === 'declined') return null;
  if (siteAdmission.kind === 'refused') {
    throw new CompiledElementError(siteAdmission.diagnostics.map(toCompilerDiagnostic));
  }
  const admission = siteAdmission.admission;

  const frontend = compileFunctionModule(code, id, {
    importClassifier: GENERATED_ELEMENT_IMPORT_CLASSIFIER,
  });
  if (frontend.module === null) {
    // Authored diagnostics from the real frontend keep their OEC codes and
    // source locations; the lane must not re-label them.
    throw new CompiledElementError([...frontend.diagnostics]);
  }
  const root: FunctionModelComponent | undefined = frontend.module.components.find(
    (component) => component.name === admission.componentName,
  );
  if (root === undefined) {
    throw new CompiledElementError([
      toCompilerDiagnostic(notAComponent(admission.componentName, id)),
    ]);
  }

  const propsDiagnostics = gateGeneratedElementRootProps(admission, root);
  if (propsDiagnostics.length > 0) {
    throw new CompiledElementError(propsDiagnostics.map(toCompilerDiagnostic));
  }

  const emitted = generateElementModule(frontend.module, options.site, {
    rootComponent: root.name,
    // D-root-source (2026-11-13): the descriptor root is the value the lane
    // read from the authored sidecar, not a host fact; absent stays absent so
    // the shell applies `light`.
    ...(admission.root === undefined ? {} : { root: admission.root }),
    // D-delegatesFocus (2026-11-14): the same lane-read sidecar source as the
    // root. Omitted when false so the descriptor keeps its M09-1a shape.
    ...(admission.delegatesFocus ? { delegatesFocus: true } : {}),
    // D-props (2026-11-14): the resolved rows of the cross-checked sidecar
    // table; empty keeps the M09-1a `properties: []` bytes.
    ...(admission.properties.length === 0 ? {} : { properties: admission.properties }),
    ...(options.authoredSource === undefined ? {} : { authoredSource: options.authoredSource }),
  });
  if (emitted.diagnostics.length > 0) {
    throw new CompiledElementError(emitted.diagnostics.map(toCompilerDiagnostic));
  }
  const bindingDiagnostics = gateGeneratedElementBindings(id, emitted);
  if (bindingDiagnostics.length > 0) {
    throw new CompiledElementError(bindingDiagnostics.map(toCompilerDiagnostic));
  }
  if (emitted.module === null) {
    // Defensive: the emitter returns a module whenever its diagnostics are
    // empty. Keeping the closure explicit makes that invariant a coded failure
    // rather than a null dereference.
    throw new CompiledElementError([
      toCompilerDiagnostic(notAComponent(admission.componentName, id)),
    ]);
  }
  return {
    code: emitted.module,
    map: emitted.sourceMap,
    tag: options.site.tag,
    component: root.name,
  };
}
