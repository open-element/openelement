/**
 * Alpha16a M05 — generated leaf recipe (the first G1 slice).
 *
 * This is the smallest executable answer to "can the compiler emit
 * mount/update/dispose that runs?" (execution-plan.md §8, gate G1). It takes an
 * M02 `IrComponent` and emits **concrete DOM instructions**, not a serialized
 * program for a generic interpreter: no `__partProgram`, no JSON, no
 * switch-on-node-kind walker in the artifact.
 *
 * Conditions are supported with a static branch builder: the generated code
 * keeps an anchor, rebuilds only the selected branch when the test changes, and
 * inserts before the anchor. Dynamic nodes inside a branch are refused with a
 * coded diagnostic — that combination belongs to the next slice.
 *
 * Deliberately out of scope for this slice (each produces a coded diagnostic):
 * component refs, lists, recipes/insertion sites, children projection,
 * event/ref/key attribute channels, ownership/region identity, claim/SSR and
 * source maps. Expression evaluation is supplied by the host through `values`;
 * the authored expression source is preserved verbatim, so this slice proves
 * generation + execution shape, not the M03 expression-evaluation frontend.
 *
 * Compiler-private: nothing here is exported from a package entry point, and
 * `semantic-ir/` is excluded from the published compiler surface. The spike is
 * off by default and no production build path consumes it.
 */

import type {
  IrAttribute,
  IrComponent,
  IrCondition,
  IrDiagnostic,
  IrElement,
  IrNode,
  IrSpan,
  IrStaticAttribute,
  IrText,
} from '../types.ts';

/** The generated artifact. `body` is executable in a `new Function` scope. */
export interface LeafRecipe {
  /** Function declarations without `export`, safe to evaluate directly. */
  readonly body: string;
  /** The same declarations as an ESM module. */
  readonly module: string;
  /** IR ids of dynamic text nodes refreshed by `update`. */
  readonly trackedTextIds: readonly string[];
  /** IR ids of dynamic text nodes evaluated exactly once at mount. */
  readonly snapshotTextIds: readonly string[];
}

export interface LeafCodegenResult {
  readonly recipe: LeafRecipe | null;
  readonly diagnostics: readonly IrDiagnostic[];
}

interface EmitState {
  readonly mountLines: string[];
  readonly renderLines: string[];
  readonly disposeLines: string[];
  /** Multi-line inner function declarations, already indented for mount scope. */
  readonly helpers: string[];
  readonly topLevelVars: string[];
  readonly mountBindings: Set<string>;
  readonly renderBindings: Set<string>;
  readonly trackedTextIds: string[];
  readonly snapshotTextIds: string[];
  readonly diagnostics: IrDiagnostic[];
  /** Shared across branch sub-states so generated variable names stay unique. */
  readonly counter: { value: number };
  /** When set, top-level nodes are collected into this array instead of appended. */
  readonly topLevelSink: string | null;
  /** Branch builders admit static nodes only. */
  readonly staticOnly: boolean;
}

const TAG_PATTERN = /^[a-z][a-z0-9-]*$/;
const ATTRIBUTE_PATTERN = /^[A-Za-z_:][A-Za-z0-9_:.-]*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function error(code: string, message: string, span: IrSpan): IrDiagnostic {
  return { severity: 'error', code, message, span, origin: 'ir-object' };
}

function nextVar(state: EmitState, prefix: string): string {
  return `${prefix}${state.counter.value++}`;
}

/** Top-level nodes are appended to their parent, or collected by a branch builder. */
function appendStmt(
  state: EmitState,
  parentVar: string,
  variable: string,
  topLevel: boolean,
): string {
  return topLevel && state.topLevelSink !== null
    ? `${state.topLevelSink}.push(${variable});`
    : `${parentVar}.appendChild(${variable});`;
}

function collectBindings(
  reads: readonly { readonly name: string }[],
  target: Set<string>,
  span: IrSpan,
  state: EmitState,
): void {
  for (const read of reads) {
    if (!IDENTIFIER_PATTERN.test(read.name)) {
      state.diagnostics.push(
        error(
          'OEIR_LEAF_INVALID_BINDING',
          `expression reads '${read.name}', which is not a plain identifier; this slice only supports identifier reads`,
          span,
        ),
      );
      continue;
    }
    target.add(read.name);
  }
}

/** Authored expressions stay verbatim, but statement-level syntax is refused. */
function checkExpression(source: string, span: IrSpan, state: EmitState): string {
  if (source.length === 0 || /[;\n\r]/.test(source)) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_UNSAFE_EXPRESSION',
        `expression '${source}' is empty or contains statement-level syntax`,
        span,
      ),
    );
  }
  return source;
}

function emitStaticAttribute(
  attribute: IrStaticAttribute,
  elementVar: string,
  state: EmitState,
): void {
  if (!ATTRIBUTE_PATTERN.test(attribute.name)) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_INVALID_ATTRIBUTE',
        `attribute name '${attribute.name}' is not a plain attribute name`,
        attribute.span,
      ),
    );
    return;
  }
  state.mountLines.push(
    `    ${elementVar}.setAttribute(${JSON.stringify(attribute.name)}, ${JSON.stringify(attribute.value)});`,
  );
}

function emitDynamicAttribute(
  attribute: Extract<IrAttribute, { kind: 'dynamic-attribute' }>,
  elementVar: string,
  state: EmitState,
): void {
  if (state.staticOnly) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_BRANCH_DYNAMIC',
        `dynamic attribute '${attribute.name}' inside a condition branch is not generated by this slice`,
        attribute.span,
      ),
    );
    return;
  }
  if (attribute.channel === 'event' || attribute.channel === 'ref' || attribute.channel === 'key') {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_UNSUPPORTED_ATTRIBUTE',
        `dynamic attribute '${attribute.name}' via the '${attribute.channel}' channel is not generated by this slice`,
        attribute.span,
      ),
    );
    return;
  }
  if (!ATTRIBUTE_PATTERN.test(attribute.name)) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_INVALID_ATTRIBUTE',
        `attribute name '${attribute.name}' is not a plain attribute name`,
        attribute.span,
      ),
    );
    return;
  }
  const expression = checkExpression(attribute.expression.source, attribute.span, state);
  collectBindings(
    attribute.expression.reads,
    attribute.tracked ? state.renderBindings : state.mountBindings,
    attribute.span,
    state,
  );
  // Bracket notation keeps every attribute name syntactically safe, including
  // hyphenated names; `attribute` channels go through setAttribute instead.
  const assignment =
    attribute.channel === 'attribute'
      ? `${elementVar}.setAttribute(${JSON.stringify(attribute.name)}, String(${expression}));`
      : `${elementVar}[${JSON.stringify(attribute.name)}] = ${expression};`;
  if (attribute.tracked) state.renderLines.push(assignment);
  else state.mountLines.push(assignment);
}

function emitAttributes(
  attributes: readonly IrAttribute[],
  elementVar: string,
  state: EmitState,
): void {
  for (const attribute of attributes) {
    if (attribute.kind === 'static-attribute') emitStaticAttribute(attribute, elementVar, state);
    else emitDynamicAttribute(attribute, elementVar, state);
  }
}

function emitElement(
  element: IrElement,
  parentVar: string,
  state: EmitState,
  topLevel: boolean,
): void {
  if (!TAG_PATTERN.test(element.tag)) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_INVALID_TAG',
        `tag '${element.tag}' is not an intrinsic element name`,
        element.span,
      ),
    );
    return;
  }
  const variable = nextVar(state, 'e');
  state.mountLines.push(
    `    const ${variable} = document.createElement(${JSON.stringify(element.tag)});`,
  );
  emitAttributes(element.attributes, variable, state);
  state.mountLines.push(`    ${appendStmt(state, parentVar, variable, topLevel)}`);
  if (topLevel) state.topLevelVars.push(variable);
  for (const child of element.children) emitNode(child, variable, state, false);
}

function emitText(text: IrText, parentVar: string, state: EmitState, topLevel: boolean): void {
  const variable = nextVar(state, 't');
  state.mountLines.push(
    `    const ${variable} = document.createTextNode(${JSON.stringify(text.value)});`,
  );
  state.mountLines.push(`    ${appendStmt(state, parentVar, variable, topLevel)}`);
  if (topLevel) state.topLevelVars.push(variable);
}

function emitDynamicText(
  node: Extract<IrNode, { kind: 'dynamic-text' }>,
  parentVar: string,
  state: EmitState,
  topLevel: boolean,
): void {
  if (state.staticOnly) {
    state.diagnostics.push(
      error(
        'OEIR_LEAF_BRANCH_DYNAMIC',
        'dynamic text inside a condition branch is not generated by this slice',
        node.span,
      ),
    );
    return;
  }
  const expression = checkExpression(node.expression.source, node.span, state);
  const bindings = node.tracked ? state.renderBindings : state.mountBindings;
  collectBindings(node.expression.reads, bindings, node.span, state);

  const variable = nextVar(state, 't');
  state.mountLines.push(`    const ${variable} = document.createTextNode("");`);
  state.mountLines.push(`    ${appendStmt(state, parentVar, variable, topLevel)}`);
  if (topLevel) state.topLevelVars.push(variable);

  const assignment = `${variable}.nodeValue = String(${expression});`;
  if (node.tracked) {
    state.renderLines.push(assignment);
    state.trackedTextIds.push(node.id);
  } else {
    state.mountLines.push(`    ${assignment}`);
    state.snapshotTextIds.push(node.id);
  }
}

function branchState(parent: EmitState): EmitState {
  return {
    mountLines: [],
    renderLines: [],
    disposeLines: [],
    helpers: parent.helpers,
    topLevelVars: [],
    mountBindings: new Set(),
    renderBindings: new Set(),
    trackedTextIds: [],
    snapshotTextIds: [],
    diagnostics: parent.diagnostics,
    counter: parent.counter,
    topLevelSink: 'nodes',
    staticOnly: true,
  };
}

function indentLines(lines: readonly string[], indent: string): string[] {
  return lines.map((line) => `${indent}${line.trimStart()}`);
}

function emitCondition(node: IrCondition, parentVar: string, state: EmitState): void {
  const prefix = nextVar(state, 'c');
  const anchor = `${prefix}_anchor`;
  const branchVar = `${prefix}_branch`;
  const nodesVar = `${prefix}_nodes`;
  const buildFn = `${prefix}_build`;
  const selectFn = `${prefix}_select`;

  const test = checkExpression(node.test.source, node.test.span, state);
  const testBindings = new Set<string>();
  collectBindings(node.test.reads, testBindings, node.test.span, state);

  const consequent = branchState(state);
  for (const child of node.consequent) emitNode(child, parentVar, consequent, true);
  const alternate = branchState(state);
  if (node.alternate !== null) {
    for (const child of node.alternate) emitNode(child, parentVar, alternate, true);
  }

  state.mountLines.push(`    const ${anchor} = document.createTextNode("");`);
  state.mountLines.push(`    ${parentVar}.appendChild(${anchor});`);
  state.mountLines.push(`    let ${branchVar} = null;`);
  state.mountLines.push(`    let ${nodesVar} = [];`);

  const build = [
    `  function ${buildFn}(name) {`,
    '    const nodes = [];',
    '    if (name === "c") {',
    ...indentLines(consequent.mountLines, '      '),
    '    } else {',
    ...indentLines(alternate.mountLines, '      '),
    '    }',
    '    return nodes;',
    '  }',
  ].join('\n');
  const select = [
    `  function ${selectFn}() {`,
    ...destructuring(testBindings, '    '),
    `    const wanted = (${test}) ? "c" : "a";`,
    `    if (wanted !== ${branchVar}) {`,
    `      for (const node of ${nodesVar}) ${parentVar}.removeChild(node);`,
    `      ${nodesVar} = ${buildFn}(wanted);`,
    `      for (const node of ${nodesVar}) ${parentVar}.insertBefore(node, ${anchor});`,
    `      ${branchVar} = wanted;`,
    '    }',
    '  }',
  ].join('\n');
  state.helpers.push(build, select);

  state.renderLines.push(`${selectFn}();`);
  state.disposeLines.push(
    `for (const node of ${nodesVar}) ${parentVar}.removeChild(node);`,
    `${parentVar}.removeChild(${anchor});`,
  );
}

function emitNode(node: IrNode, parentVar: string, state: EmitState, topLevel: boolean): void {
  switch (node.kind) {
    case 'element':
      emitElement(node, parentVar, state, topLevel);
      return;
    case 'fragment':
      for (const child of node.children) emitNode(child, parentVar, state, topLevel);
      return;
    case 'text':
      emitText(node, parentVar, state, topLevel);
      return;
    case 'dynamic-text':
      emitDynamicText(node, parentVar, state, topLevel);
      return;
    case 'condition':
      if (state.staticOnly) {
        state.diagnostics.push(
          error(
            'OEIR_LEAF_BRANCH_DYNAMIC',
            'a nested condition inside a condition branch is not generated by this slice',
            node.span,
          ),
        );
        return;
      }
      emitCondition(node, parentVar, state);
      return;
    default:
      state.diagnostics.push(
        error(
          'OEIR_LEAF_UNSUPPORTED_NODE',
          `node kind '${node.kind}' is not generated by this slice`,
          node.span,
        ),
      );
  }
}

function destructuring(bindings: ReadonlySet<string>, indent: string): string[] {
  if (bindings.size === 0) return [];
  return [`${indent}const { ${[...bindings].sort().join(', ')} } = current;`];
}

/** Emit a leaf recipe for one M02 component. */
export function generateLeafRecipe(component: IrComponent): LeafCodegenResult {
  const state: EmitState = {
    mountLines: [],
    renderLines: [],
    disposeLines: [],
    helpers: [],
    topLevelVars: [],
    mountBindings: new Set(),
    renderBindings: new Set(),
    trackedTextIds: [],
    snapshotTextIds: [],
    diagnostics: [],
    counter: { value: 0 },
    topLevelSink: null,
    staticOnly: false,
  };

  if (component.roots.length === 0) {
    return {
      recipe: null,
      diagnostics: [
        error('OEIR_LEAF_EMPTY_OUTPUT', 'component has no roots to mount', component.span),
      ],
    };
  }
  for (const root of component.roots) emitNode(root, 'host', state, true);

  if (state.diagnostics.length > 0) {
    return { recipe: null, diagnostics: state.diagnostics };
  }

  const lines = [
    'function mount(host, values) {',
    '  let current = values;',
    '  let disposed = false;',
    ...destructuring(state.mountBindings, '  '),
    ...state.mountLines.map((line) => `  ${line.trimStart()}`),
    ...state.helpers,
    '  function renderDynamic() {',
    ...destructuring(state.renderBindings, '    '),
    ...state.renderLines.map((line) => `    ${line.trimStart()}`),
    '  }',
    '  renderDynamic();',
    '  function update(nextValues) {',
    '    if (disposed) return;',
    '    current = nextValues;',
    '    renderDynamic();',
    '  }',
    '  function dispose() {',
    '    if (disposed) return;',
    '    disposed = true;',
    ...state.disposeLines.map((line) => `    ${line.trimStart()}`),
    ...state.topLevelVars.map((variable) => `    host.removeChild(${variable});`),
    '  }',
    '  return { update, dispose };',
    '}',
  ];
  const body = lines.join('\n');
  const header = '// <generated by openElement semantic-ir leaf-codegen; do not edit>\n';

  return {
    recipe: {
      body,
      module: `${header}${body.replace(/^function mount\(/m, 'export function mount(')}`,
      trackedTextIds: state.trackedTextIds,
      snapshotTextIds: state.snapshotTextIds,
    },
    diagnostics: [],
  };
}
