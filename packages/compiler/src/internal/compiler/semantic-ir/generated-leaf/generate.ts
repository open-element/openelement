/**
 * M05 v2 — generated leaf mount/update/dispose (compiler-private).
 *
 * Consumes the merged M03 `FunctionModelModule` + `ExpressionRegistry` (never
 * re-derives resolution, lowering or erasure) and emits a real JavaScript
 * module whose `mount(scope)` builds detached DOM using the M04 runtime
 * primitives: one `createRecipe` per leaf component, `bindSignalWrites` for
 * tracked slots, and the canonical `displayValue`/`attributeValueOf`/
 * `assertSafeUrlAttribute` value semantics. The harness inserts generated
 * recipes through `insertRecipe` — the one insertion surface.
 *
 * S1 leaf scope: intrinsic elements, fragments, multi-root, empty output,
 * static text/attributes, dynamic text and `attribute`/`boolean`/`property`
 * channel attributes with signal/computed driven refresh, default + detach
 * disposal and throwing cleanups. Everything else fails closed with a coded
 * diagnostic: conditions, lists, component references, recipes/insertion
 * sites, children projection, and `class`/`style`/`innerHTML`/`event`/`ref`/
 * `key` attributes are M05b/M06 work.
 *
 * The emitted module imports from the compiler-private runtime entry
 * `@openelement/element/internal/compiled/runtime`. That entry is not a
 * published subpath yet (the narrow ABI is a later milestone); the browser
 * harness bundles the same M04 modules under the same names, so the artifact
 * under test uses the real primitives, not stubs.
 *
 * NOT claimed here: generated-module source map (M05b named gap: A2 expression
 * segments exist, placement composition is a separate evidence slice),
 * claim/SSR, production wiring, ABI/public API.
 */

import ts from 'typescript';
import { unsafeStreamFrameAttribute } from '@openelement/protocol/stream-frame-policy';
import type {
  FunctionExpressionRef,
  FunctionModelAttribute,
  FunctionModelComponent,
  FunctionModelModule,
  FunctionModelNode,
} from '../../semantic-core/function-frontend.ts';
import type { LoweredExpressionRecord } from '../../semantic-core/expression-registry.ts';
import type { BindingId } from '../../semantic-core/scope-resolution.ts';
import type { IrDiagnostic, IrSpan } from '../types.ts';

/** Compiler-private runtime entry the emitted module imports from. */
export const GENERATED_LEAF_RUNTIME_SPECIFIER = '@openelement/element/internal/compiled/runtime';

const RUNTIME_IMPORTS = [
  'assertSafeUrlAttribute',
  'attributeValueOf',
  'bindSignalWrites',
  'createRecipe',
  'displayValue',
] as const;

const INTERNAL_PREFIX = '__oe_';
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TAG_PATTERN = /^[a-z][a-z0-9-]*$/;
const ATTRIBUTE_PATTERN = /^[A-Za-z_:][A-Za-z0-9_:.-]*$/;
const ADMITTED_ATTRIBUTE_CHANNELS: ReadonlySet<string> = new Set([
  'attribute',
  'boolean',
  'property',
]);

export interface GeneratedLeafModule {
  /** Emitted ESM module; `null` when any diagnostic was emitted (fail closed). */
  readonly module: string | null;
  /** Host `bindings` names the module reads (signals/computeds/functions). */
  readonly requiredBindings: readonly string[];
  /** Host `props` names the module reads. */
  readonly requiredProps: readonly string[];
  /** True when the module subscribes to `host.propsChanged` (tracked props). */
  readonly requiresPropsChanged: boolean;
  readonly diagnostics: readonly IrDiagnostic[];
}

interface EmitState {
  readonly component: FunctionModelComponent;
  readonly lines: string[];
  indent: number;
  readonly diagnostics: IrDiagnostic[];
  readonly requiredBindings: Set<string>;
  readonly requiredProps: Set<string>;
  readonly hostBindings: Set<string>;
  readonly localResources: Set<string>;
  counter: { value: number };
  readonly propsName: string | null;
  requiresPropsChanged: boolean;
}

function diag(state: EmitState, code: string, message: string, span: IrSpan): void {
  state.diagnostics.push({ severity: 'error', code, message, span, origin: 'ir-object' });
}

function push(state: EmitState, text: string): void {
  state.lines.push(`${'  '.repeat(state.indent)}${text}`);
}

function nextName(state: EmitState, prefix: string): string {
  return `${INTERNAL_PREFIX}${prefix}${state.counter.value++}`;
}

function toIrSpan(ref: FunctionExpressionRef): IrSpan {
  return ref.span;
}

function bindingKey(id: BindingId): string {
  return `${id.scope.path}#${id.name}#${id.declarationOrder}`;
}

function recordFor(
  state: EmitState,
  ref: FunctionExpressionRef,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): LoweredExpressionRecord | null {
  const record = records.get(ref.id);
  if (record === undefined) {
    diag(state, 'OEIR_LEAF_MISSING_EXPRESSION', `expression ${ref.id} is not in the registry`, {
      file: '',
      start: 0,
      end: 0,
      line: 1,
      column: 1,
    });
  }
  return record ?? null;
}

/** Declare the host bindings an expression reads (prologue) and validate names. */
function declareReads(state: EmitState, record: LoweredExpressionRecord): boolean {
  for (const read of record.reads) {
    if (read.name === 'props' || read.binding.name === 'props') {
      if (state.propsName === null) {
        diag(
          state,
          'OEIR_LEAF_UNSUPPORTED_PROPS',
          'the leaf slice needs a named props parameter',
          toIrSpan({
            id: record.id,
            mode: record.mode,
            span: record.authoredSpan,
          }),
        );
        return false;
      }
      state.requiredProps.add(state.propsName);
      continue;
    }
    if (state.localResources.has(read.name) || state.hostBindings.has(read.name)) continue;
    if (!IDENTIFIER_PATTERN.test(read.name) || read.name.startsWith(INTERNAL_PREFIX)) {
      diag(
        state,
        'OEIR_LEAF_INVALID_BINDING',
        `binding '${read.name}' is not a usable identifier`,
        toIrSpan({
          id: record.id,
          mode: record.mode,
          span: record.authoredSpan,
        }),
      );
      return false;
    }
    const resource = state.component.resources.find((candidate) => candidate.name === read.name);
    if (resource !== undefined && resource.kind !== 'local') {
      state.hostBindings.add(read.name);
      state.requiredBindings.add(read.name);
      continue;
    }
    if (resource !== undefined && resource.kind === 'local') {
      state.localResources.add(read.name);
      continue;
    }
    // Builtin/global reads (undefined, Math, ...) are referenced directly; every
    // other name must come from the host binding record.
    if (
      read.value === 'plain' &&
      read.binding.name === read.name &&
      read.binding.scope.path === 'global'
    ) {
      continue;
    }
    state.hostBindings.add(read.name);
    state.requiredBindings.add(read.name);
  }
  return true;
}

interface Dependency {
  readonly name: string;
  /** Props reads refresh through the host `propsChanged` signal (see contract). */
  readonly fromProps: boolean;
}

function dependencyNames(
  state: EmitState,
  record: LoweredExpressionRecord,
): readonly Dependency[] | null {
  const byKey = new Map(record.reads.map((read) => [bindingKey(read.binding), read]));
  const names: Dependency[] = [];
  for (const id of record.dependencies) {
    const read = byKey.get(bindingKey(id));
    if (read === undefined) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_BINDING',
        `tracked expression ${record.id} has a dependency outside its reads`,
        toIrSpan({ id: record.id, mode: record.mode, span: record.authoredSpan }),
      );
      return null;
    }
    const fromProps = read.name === 'props';
    if (fromProps) {
      // Per-read props refresh: the leaf contract supplies a `propsChanged`
      // signal (the M04 tracked-props record's version channel analogue). The
      // per-read getter semantics are M06's contract; the leaf slice only
      // proves the refresh plumbing.
      state.requiresPropsChanged = true;
    } else if (!state.hostBindings.has(read.name)) {
      state.hostBindings.add(read.name);
      state.requiredBindings.add(read.name);
    }
    if (!names.some((entry) => entry.name === read.name))
      names.push({ name: read.name, fromProps });
  }
  return names;
}

function emitTextWrite(state: EmitState, targetVar: string, expression: string): void {
  push(state, `${targetVar}.nodeValue = displayValue((${expression}));`);
}

function emitAttributeWrite(
  state: EmitState,
  elementVar: string,
  name: string,
  channel: string,
  expression: string,
): void {
  const literal = JSON.stringify(name);
  if (channel === 'boolean') {
    push(state, `${elementVar}.toggleAttribute(${literal}, Boolean((${expression})));`);
    return;
  }
  if (channel === 'property') {
    if (!IDENTIFIER_PATTERN.test(name)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
        `property '${name}' is not a valid identifier`,
        { file: '', start: 0, end: 0, line: 1, column: 1 },
      );
      return;
    }
    push(state, `${elementVar}[${literal}] = (${expression});`);
    return;
  }
  const valueVar = nextName(state, 'value');
  push(state, `const ${valueVar} = attributeValueOf((${expression}));`);
  push(state, `if (${valueVar} === null) ${elementVar}.removeAttribute(${literal});`);
  push(state, `else {`);
  push(state, `  assertSafeUrlAttribute(${literal}, ${valueVar});`);
  push(state, `  ${elementVar}.setAttribute(${literal}, ${valueVar});`);
  push(state, `}`);
}

function attributeAdmitted(
  state: EmitState,
  attribute: FunctionModelAttribute,
  span: IrSpan,
): boolean {
  if (attribute.kind === 'static') {
    if (!ATTRIBUTE_PATTERN.test(attribute.name)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
        `attribute name '${attribute.name}' is invalid`,
        span,
      );
      return false;
    }
    return true;
  }
  if (!ADMITTED_ATTRIBUTE_CHANNELS.has(attribute.channel)) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
      `attribute channel '${attribute.channel}' is outside the leaf slice (M05b/M06 owns it)`,
      span,
    );
    return false;
  }
  return true;
}

function emitNode(
  state: EmitState,
  node: FunctionModelNode,
  sink: string[],
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): void {
  const span: IrSpan = node.span;
  if (node.kind === 'text') {
    const varName = nextName(state, 'text');
    push(state, `const ${varName} = document.createTextNode(${JSON.stringify(node.value)});`);
    sink.push(varName);
    return;
  }
  if (node.kind === 'fragment') {
    for (const child of node.children) emitNode(state, child, sink, records);
    return;
  }
  if (node.kind === 'element') {
    if (!TAG_PATTERN.test(node.tag)) {
      diag(
        state,
        'OEIR_LEAF_UNSUPPORTED_TAG',
        `tag '${node.tag}' is not a plain intrinsic element name`,
        span,
      );
      return;
    }
    const varName = nextName(state, 'el');
    push(state, `const ${varName} = document.createElement(${JSON.stringify(node.tag)});`);
    for (const attribute of node.attributes) {
      if (!attributeAdmitted(state, attribute, span)) continue;
      if (attribute.kind === 'static') {
        if (unsafeStreamFrameAttribute(attribute.name, attribute.value)) {
          diag(
            state,
            'OEIR_LEAF_UNSAFE_ATTRIBUTE',
            `static URL attribute '${attribute.name}' carries a script-bearing scheme`,
            span,
          );
          continue;
        }
        push(
          state,
          `${varName}.setAttribute(${JSON.stringify(attribute.name)}, ${JSON.stringify(attribute.value)});`,
        );
        continue;
      }
      const record = recordFor(state, attribute.expression, records);
      if (record === null || !declareReads(state, record)) continue;
      const expression = record.lowered.trim();
      const dependencies = dependencyNames(state, record);
      if (dependencies === null) continue;
      if (dependencies.length === 0) {
        emitAttributeWrite(state, varName, attribute.name, attribute.channel, expression);
        continue;
      }
      const refresh = nextName(state, 'refresh');
      push(state, `function ${refresh}() {`);
      state.indent += 1;
      emitAttributeWrite(state, varName, attribute.name, attribute.channel, expression);
      state.indent -= 1;
      push(state, `}`);
      push(state, `${refresh}();`);
      for (const dependency of dependencies) {
        const signal = dependency.fromProps ? `${INTERNAL_PREFIX}propsChanged` : dependency.name;
        push(
          state,
          `bindSignalWrites(${INTERNAL_PREFIX}scope, ${signal}, ${JSON.stringify(dependency.name)}, ${refresh});`,
        );
      }
    }
    for (const child of node.children) {
      const childSink: string[] = [];
      emitNode(state, child, childSink, records);
      for (const childVar of childSink) push(state, `${varName}.appendChild(${childVar});`);
    }
    sink.push(varName);
    return;
  }
  if (node.kind === 'dynamic-text') {
    const record = recordFor(state, node.expression, records);
    if (record === null || !declareReads(state, record)) return;
    const expression = record.lowered.trim();
    const dependencies = dependencyNames(state, record);
    if (dependencies === null) return;
    const textVar = nextName(state, 'text');
    push(state, `const ${textVar} = document.createTextNode("");`);
    sink.push(textVar);
    if (dependencies.length === 0) {
      emitTextWrite(state, textVar, expression);
      return;
    }
    const refresh = nextName(state, 'refresh');
    push(state, `function ${refresh}() {`);
    state.indent += 1;
    emitTextWrite(state, textVar, expression);
    state.indent -= 1;
    push(state, `}`);
    push(state, `${refresh}();`);
    for (const dependency of dependencies) {
      const signal = dependency.fromProps ? `${INTERNAL_PREFIX}propsChanged` : dependency.name;
      push(
        state,
        `bindSignalWrites(${INTERNAL_PREFIX}scope, ${signal}, ${JSON.stringify(dependency.name)}, ${refresh});`,
      );
    }
    return;
  }
  diag(
    state,
    'OEIR_LEAF_UNSUPPORTED_NODE',
    `node '${node.kind}' is outside the leaf slice (M05b/M06 owns it)`,
    span,
  );
}

interface EmittedComponent {
  readonly lines: string[];
  readonly diagnostics: readonly IrDiagnostic[];
  readonly requiredBindings: readonly string[];
  readonly requiredProps: readonly string[];
  readonly requiresPropsChanged: boolean;
}

function emitComponent(
  file: string,
  component: FunctionModelComponent,
  records: ReadonlyMap<string, LoweredExpressionRecord>,
): EmittedComponent {
  const propsName = component.propsParam;
  const state: EmitState = {
    component,
    lines: [],
    indent: 2,
    diagnostics: [],
    requiredBindings: new Set(),
    requiredProps: new Set(),
    hostBindings: new Set(),
    localResources: new Set(),
    counter: { value: 0 },
    propsName,
    requiresPropsChanged: false,
  };
  if (
    propsName !== null &&
    (!IDENTIFIER_PATTERN.test(propsName) || propsName.startsWith(INTERNAL_PREFIX))
  ) {
    diag(state, 'OEIR_LEAF_INVALID_BINDING', `props parameter '${propsName}' is not usable`, {
      file,
      start: 0,
      end: 0,
      line: 1,
      column: 1,
    });
  }
  // Resources: signal/computed names are host bindings; local snapshots are
  // evaluated inside the mount (setup mode), preserving M03 semantics.
  const localLines: string[] = [];
  for (const resource of component.resources) {
    if (!IDENTIFIER_PATTERN.test(resource.name) || resource.name.startsWith(INTERNAL_PREFIX)) {
      diag(
        state,
        'OEIR_LEAF_INVALID_BINDING',
        `resource '${resource.name}' is not usable`,
        resource.span,
      );
      continue;
    }
    if (resource.kind === 'local') {
      if (resource.expression === null) continue;
      const record = recordFor(state, resource.expression, records);
      if (record === null) continue;
      if (!declareReads(state, record)) continue;
      state.localResources.add(resource.name);
      localLines.push(`const ${resource.name} = (${record.lowered.trim()});`);
      continue;
    }
    state.hostBindings.add(resource.name);
    state.requiredBindings.add(resource.name);
  }
  if (state.diagnostics.length > 0) {
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
    };
  }
  if (component.recipes.length > 0) {
    diag(
      state,
      'OEIR_LEAF_UNSUPPORTED_RECIPE',
      'nested recipes/insertion sites are outside the leaf slice (M05b)',
      { file, start: 0, end: 0, line: 1, column: 1 },
    );
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
    };
  }
  if (!IDENTIFIER_PATTERN.test(component.name) || component.name.startsWith(INTERNAL_PREFIX)) {
    diag(
      state,
      'OEIR_LEAF_INVALID_COMPONENT',
      `component '${component.name}' is not usable`,
      component.span,
    );
    return {
      lines: [],
      diagnostics: state.diagnostics,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
    };
  }

  push(state, 'return createRecipe({');
  state.indent += 1;
  push(state, `definitionOwner: ${INTERNAL_PREFIX}owner,`);
  push(state, `source: ${JSON.stringify(`${file}#${component.name}`)},`);
  push(state, `mount(${INTERNAL_PREFIX}scope) {`);
  state.indent += 1;
  push(state, `const ${INTERNAL_PREFIX}nodes = [];`);
  for (const line of localLines) push(state, line);
  for (const root of component.roots) {
    const sink: string[] = [];
    emitNode(state, root, sink, records);
    for (const nodeVar of sink) push(state, `${INTERNAL_PREFIX}nodes.push(${nodeVar});`);
  }
  push(state, `return ${INTERNAL_PREFIX}nodes;`);
  state.indent -= 1;
  push(state, '},');
  state.indent -= 1;
  push(state, '});');

  const prologue: string[] = [];
  prologue.push(
    `export function create${component.name}Recipe(${INTERNAL_PREFIX}owner, ${INTERNAL_PREFIX}host) {`,
  );
  if (propsName !== null) {
    prologue.push(`  const ${propsName} = ${INTERNAL_PREFIX}host.props;`);
    state.requiredProps.add(propsName);
  }
  if (state.requiredBindings.size > 0 || state.requiresPropsChanged) {
    prologue.push(
      `  const ${INTERNAL_PREFIX}requireBinding = (name) => { const value = ${INTERNAL_PREFIX}host.bindings[name]; if (value === undefined) throw new Error("OEIR_LEAF_MISSING_VALUE: " + name); return value; };`,
    );
    for (const binding of [...state.requiredBindings].sort()) {
      prologue.push(
        `  const ${binding} = ${INTERNAL_PREFIX}requireBinding(${JSON.stringify(binding)});`,
      );
    }
    if (state.requiresPropsChanged) {
      prologue.push(
        `  const ${INTERNAL_PREFIX}propsChanged = ${INTERNAL_PREFIX}host.propsChanged; if (${INTERNAL_PREFIX}propsChanged === undefined) throw new Error("OEIR_LEAF_MISSING_VALUE: propsChanged");`,
      );
    }
  }
  return {
    lines: [...prologue, ...state.lines, '}', ''],
    diagnostics: state.diagnostics,
    requiredBindings: [...state.requiredBindings].sort(),
    requiredProps: [...state.requiredProps].sort(),
    requiresPropsChanged: state.requiresPropsChanged,
  };
}

/** Fail-closed parse check of the emitted module text (no execution). */
function parsesAsModule(text: string): boolean {
  const source = ts.createSourceFile(
    'generated-leaf.js',
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const parseDiagnostics = (source as unknown as { parseDiagnostics?: readonly unknown[] })
    .parseDiagnostics;
  return (parseDiagnostics ?? []).length === 0;
}

/**
 * Emit the generated leaf module for one M03 `FunctionModelModule`.
 * Deterministic for the same model/registry; unsupported shapes fail closed.
 */
export function generateLeafModule(module: FunctionModelModule): GeneratedLeafModule {
  const records = new Map(module.expressions.expressions.map((record) => [record.id, record]));
  if (module.components.length === 0) {
    return {
      module: null,
      requiredBindings: [],
      requiredProps: [],
      requiresPropsChanged: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'OEIR_LEAF_MISSING_COMPONENT',
          message: 'the module has no function component to generate',
          span: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
          origin: 'module',
        },
      ],
    };
  }
  const chunks: string[] = [];
  const diagnostics: IrDiagnostic[] = [];
  const requiredBindings = new Set<string>();
  const requiredProps = new Set<string>();
  let requiresPropsChanged = false;
  for (const component of module.components) {
    const emitted = emitComponent(module.file, component, records);
    diagnostics.push(...emitted.diagnostics);
    if (emitted.diagnostics.length > 0) continue;
    for (const name of emitted.requiredBindings) requiredBindings.add(name);
    for (const name of emitted.requiredProps) requiredProps.add(name);
    requiresPropsChanged ||= emitted.requiresPropsChanged;
    chunks.push(...emitted.lines);
  }
  if (diagnostics.length > 0) {
    return {
      module: null,
      requiredBindings: [...requiredBindings].sort(),
      requiredProps: [...requiredProps].sort(),
      requiresPropsChanged,
      diagnostics,
    };
  }
  const text = [
    '// <generated by openelement M05 leaf-codegen v2; do not edit>',
    `import { ${RUNTIME_IMPORTS.join(', ')} } from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)};`,
    '',
    ...chunks,
  ].join('\n');
  if (!parsesAsModule(text)) {
    return {
      module: null,
      requiredBindings: [...requiredBindings].sort(),
      requiredProps: [...requiredProps].sort(),
      requiresPropsChanged,
      diagnostics: [
        {
          severity: 'error',
          code: 'OEIR_LEAF_INVALID_ARTIFACT',
          message: 'the emitted module does not parse as JavaScript',
          span: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
          origin: 'module',
        },
      ],
    };
  }
  return {
    module: text,
    requiredBindings: [...requiredBindings].sort(),
    requiredProps: [...requiredProps].sort(),
    requiresPropsChanged,
    diagnostics: [],
  };
}
