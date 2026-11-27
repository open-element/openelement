/**
 * M09-1a — the generated-element lane entry.
 *
 * Mirrors `compileServerComponentIfAdmitted`: returns null for a module the
 * lane does not own (no host site fact, non-JSX-bearing, or the class lane's decorator
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
  type FunctionModelNode,
} from '../../semantic-core/function-frontend.ts';
import { isJsxModuleId } from '../../semantic-core/jsx-module-id.ts';
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
  /**
   * The emitted host-wrapper export name (`<component>__ssrHost`), or null when
   * the emitter appended no host producer. It is the compiler-owned emitted
   * export identity (M11 review §4.1/S1), produced by the same emitter
   * `hostWrapper` decision that appends the function and returned here as
   * build metadata: `null` means "this module has no host producer" (a light or
   * absent root, a leaf without `<component>__ssr`, or a hostless/refused
   * module), not an error. `code` is byte-identical whether or not the field is
   * read; callers must not re-derive the name from the emitted text.
   */
  readonly ssrHostExport: string | null;
  /** Whether emission attached the light-root SSR producer to the constructor. */
  readonly lightSsr: boolean;
  /**
   * The module's admitted STATIC class tokens (deletion prerequisite P-1): the
   * component stylesheet's candidate set, collected from the same function model
   * the module was emitted from. Empty when every class channel is dynamic.
   */
  readonly classCandidates: readonly string[];
  /**
   * Whether this module's tree contains a `when`/`each` Block — the blocks axis of
   * the runtime-shape floor table (ADR-0166), which picks the `./no-blocks` entry
   * when no island in the app uses one.
   *
   * This replaces the class lane's `program.blocks`: the router's scan used to read
   * that Part Program field, and with the class lane gone it had no fact at all.
   * Answered from the SAME function model this compile already lowered, so it is a
   * fact of the compilation and not a second derivation.
   */
  readonly usesBlocks: boolean;
}

/**
 * Whether one lowered component's tree contains a `when` or `each` Block.
 *
 * The walk descends conditions and list templates because a Block nested inside one
 * still needs the block builders at runtime. Component references are NOT followed:
 * a child component's Blocks are its own module's business, and the router's scan
 * asks every island module separately — following them here would make one island's
 * answer depend on another's, which is exactly the coupling the per-module scan
 * avoids.
 */
function componentUsesBlocks(component: FunctionModelComponent): boolean {
  let found = false;
  const visit = (nodes: readonly FunctionModelNode[]): void => {
    for (const node of nodes) {
      if (found) return;
      if (node.kind === 'condition') {
        found = true;
        return;
      }
      if (node.kind === 'list') {
        found = true;
        return;
      }
      if (node.kind === 'element' || node.kind === 'fragment') visit(node.children);
    }
  };
  visit(component.roots);
  return found;
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
  // plain script id as JSX: the function grammar cannot appear in one.
  if (!isJsxModuleId(id)) return null;

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
    // `16b-LC`: the generated-element lane is the ONLY host that admits the
    // author lifecycle intrinsics, and it admits them module-wide here. The
    // generator owns the placement verdict: a hook is carried only by the root
    // setup or a depth-1 retained hostless child setup; every other placement
    // fails closed with the authored span. Every other function-lane caller
    // keeps today's statement grammar (the existing OEC9041 refusal).
    lifecycleAdmission: { admission: 'module' },
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
    // Unlike the lowered props name, this AST fact also detects destructuring.
    allowDirectShadowDriver: admission.propsParameter === null,
    // D-root-source (2026-11-13): the descriptor root is the value the lane
    // read from the authored sidecar, not a host fact; absent stays absent so
    // the shell applies `light`.
    ...(admission.root === undefined ? {} : { root: admission.root }),
    // D-delegatesFocus (2026-11-14): the same lane-read sidecar source as the
    // root. Omitted when false so the descriptor keeps its M09-1a shape.
    ...(admission.delegatesFocus ? { delegatesFocus: true } : {}),
    // M09-2d: the form fact is read from the same sidecar as root/focus; omitted
    // when false so the descriptor keeps its pre-forms bytes.
    ...(admission.formAssociated ? { formAssociated: true } : {}),
    // D-props (2026-11-14): the resolved rows of the cross-checked sidecar
    // table; empty keeps the M09-1a `properties: []` bytes.
    ...(admission.properties.length === 0 ? {} : { properties: admission.properties }),
    // M09-2e / #1803: the `styles` presence comes from the SAME authored sidecar
    // read above (root/focus/props), so the scan-time and transform-time
    // compiles of one module cannot disagree and no host boolean exists. Only a
    // shadow root has a DSD template to declare the link in; a light root's
    // declared sheet keeps the document channel (no emitted byte changes).
    ...(admission.declaresStyles && admission.root === 'shadow-open'
      ? { styleLinkPrefix: true }
      : {}),
    // 2026-11-20 client style adoption: the SAME sidecar read supplies the
    // client-only fact and the declared specifiers. A client-only island has no
    // DSD template to carry the marked link, so the emitter writes real
    // module-graph imports for these specifiers and the shell adopts the
    // resulting sheet objects into the root it creates. Both facts come from
    // one read, so the scan-time and transform-time compiles cannot disagree.
    // `clientOnly` and the declared specifiers both come from the ONE sidecar
    // read, but only the SPECIFIERS are conditional on `declaresStyles`: the
    // client-only fact stands on its own, and threading it only alongside a
    // style declaration left a styleless `ssr: false` island looking like an
    // SSR island to the emitter (F16 — the emitter now reads this fact directly).
    clientOnly: admission.clientOnly,
    ...(admission.declaresStyles ? { styles: admission.styles } : {}),
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
    // Additive build metadata from the emitter's one hostWrapper decision; the
    // module text and map above are unchanged by this field.
    ssrHostExport: emitted.ssrHostExport,
    lightSsr: emitted.lightSsr,
    classCandidates: emitted.classCandidates,
    usesBlocks: componentUsesBlocks(root),
  };
}
