/**
 * Server-only TSX function components (alpha15 server lane): the admission
 * and generative lowering entry.
 *
 * A server function component is an exported function whose body is a single
 * return of JSX — the compiled render() grammar's own subset (one semantic
 * authority: the SAME `Lowering` walk the @element class path runs, with the
 * props parameter as the field accessor; the same attribute-name safety, sink
 * denial, trustedHtml boundary and OEC diagnostics — no parallel checker
 * exists). What differs is only the OUTPUT: instead of a Part Program, the
 * admitted JSX lowers to a plain exported TS function whose body composes the
 * element server runtime's constructor helpers:
 *
 *   __h("article", { class: "card" }, [__h("h2", {}, [__t(props.name)])])
 *
 * - dynamic text rides `__t` (the ONE DSD-serializer escapeText);
 * - attribute values cross `__h`'s one `escapeAttr` + shared URL screen;
 * - a build-admitted @element compiled host rides `__ssr(tag, props)` — the
 *   component path's literal runtime function;
 * - an island or foreign custom host emits its tag as-is (the existing island
 *   admission pipeline owns it);
 * - a nested server function component composes by DIRECT function call to
 *   the imported binding, resolved from the authored imports at compile time
 *   (deterministic — the host hands the compiler the imported sources).
 *
 * The artifact is generated TS — not an IR, not an interpreter, no Part
 * Program, no element class, no client graph edge.
 *
 * Discovery is compiler-exclusive: `analyzeModuleSemantics` reports the
 * module's exported JSX functions (the cheap fact a graph walker reads); THIS
 * entry is the admission authority the host build calls for the modules it
 * finds reachable from its page modules. Route-side wiring is a later lane.
 */

import ts from 'typescript';
import {
  CompiledElementError,
  type CompilerFail,
  type ElementCompilerDiagnostic,
  failAt,
} from './compiler-diagnostics.ts';
import {
  analyzeModuleSemantics,
  createModuleIntrinsicBindings,
  isExportedServerComponentDeclaration,
  serverComponentName,
} from './module-analysis.ts';
import { Lowering } from './lower-program.ts';
import { type CompiledElementSourceMap, SourceMapSegmentBuilder } from './source-map.ts';
import { typescriptParser } from './parse-module.ts';
import { type CompiledField } from './analyze-module.ts';
import {
  type ProgramCondition,
  type ProgramPart,
  type ProgramTreeNode,
  type PropertyValueType,
} from '@openelement/protocol/part-program';

/** Host-supplied inputs for the server function component compile. */
export interface ServerComponentCompileOptions {
  /**
   * Resolve one authored import specifier to that module's SOURCE, so a
   * nested server function component composes by direct call to the imported
   * binding (compile-time resolved, deterministic). Absent or returning
   * undefined: importing components from that specifier is a coded rejection.
   * Resolution of specifiers to files stays the host's job — the compiler
   * never reads the filesystem.
   */
  readonly resolveModule?: (specifier: string) => string | undefined;
  /**
   * The custom-element host tags the host build admitted as @element
   * compiled components: those JSX children ride `__ssr(tag, props)`.
   * Unadmitted hosts (islands, foreign tags) emit their tag as-is.
   */
  readonly compiledTags?: readonly string[];
}

/** The compiled server function component module. */
export interface CompileServerComponentResult {
  /** The generated TS module: verbatim authored content + constructor functions. */
  code: string;
  /** Real Source Map v3 for the generated component functions. */
  map: CompiledElementSourceMap;
  /** The compiled component names, sorted. */
  components: string[];
  /**
   * The statically admitted class tokens (alpha15 S lane), unioned over the
   * compiled components — the host build forwards them to the official
   * Tailwind compiler as explicit candidates.
   */
  classCandidates?: string[];
}

/** The helper names the generated module binds from '@openelement/element/server'. */
const SERVER_HELPERS = ['__h', '__t', '__ssr'] as const;
const SERVER_HELPER_SPECIFIER = '@openelement/element/server';

interface AdmittedComponent {
  readonly statement: ts.Statement;
  readonly name: string;
  /** The declared props parameter name, when the component takes one. */
  readonly parameter: string | null;
  readonly fields: CompiledField[];
  /** The returned JSX expression (the single return's expression). */
  readonly returned: ts.Expression;
  /** True for `export const X = (props) => jsx` (vs `export function X`). */
  readonly isArrow: boolean;
}

/** Map one inline props-type member annotation to the walk's property-type labels. */
function propsTypeOf(type: ts.TypeNode | undefined): PropertyValueType {
  if (type === undefined) return 'string';
  const text = type.getText().replace(/\s/g, '');
  if (text === 'string' || text === 'String') return 'string';
  if (text === 'number' || text === 'Number') return 'number';
  if (text === 'boolean' || text === 'Boolean') return 'boolean';
  if (text.includes('TrustedHtml')) return 'object';
  if (/^(Array|ReadonlyArray|Set)</.test(text) || text.endsWith('[]')) return 'array';
  if (/^(Record|Map|Object)</.test(text)) return 'object';
  // Unknown annotations are ordinary data: the label only gates the
  // trustedHtml sink (which a TrustedHtml annotation satisfies).
  return 'string';
}

/** Build the synthetic field table one props type literal admits. */
function fieldsOfPropsType(typeNode: ts.TypeNode | undefined, fail: CompilerFail): CompiledField[] {
  if (typeNode === undefined) return [];
  let literal: ts.TypeNode = typeNode;
  while (ts.isParenthesizedTypeNode(literal)) literal = literal.type;
  if (!ts.isTypeLiteralNode(literal)) {
    fail(
      typeNode,
      'OEC9032',
      'the props parameter must be annotated inline as an object type literal ' +
        '(props: { name: string }) — type aliases and interfaces are outside the server ' +
        'function grammar',
    );
  }
  const fields: CompiledField[] = [];
  for (const member of literal.members) {
    if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) {
      fail(member, 'OEC9032', 'the props type admits property signatures only');
    }
    const label = propsTypeOf(member.type);
    fields.push({
      name: member.name.text,
      reflect: false,
      attribute: null,
      type: label,
      converter: label,
      typeConstructor: 'String',
      accessibility: '',
      typeText: member.type ? `: ${member.type.getText()}` : '',
      initializerText: '',
      defaultValue: null,
      // The synthetic table only feeds the walk's name/type lookups.
      node: member as unknown as ts.PropertyDeclaration,
    });
  }
  return fields;
}

/** One component's admitted shape, with the diagnostics every other shape rejects. */
function admitComponent(statement: ts.Statement, fail: CompilerFail): AdmittedComponent {
  const name = serverComponentName(statement);
  if (ts.isFunctionDeclaration(statement)) {
    const modifiers = ts.getModifiers(statement) ?? [];
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
      fail(
        statement,
        'OEC9032',
        `server function component ${name} may not be async — a component returns its HTML ` +
          'synchronously; async data belongs in the route loader',
      );
    }
    if (statement.typeParameters?.length) {
      fail(
        statement,
        'OEC9032',
        `server function component ${name} may not declare type parameters`,
      );
    }
    if (statement.body === undefined || !ts.isBlock(statement.body)) {
      fail(statement, 'OEC9032', `server function component ${name} must have a body`);
    }
    const returns = statement.body!.statements.filter(ts.isReturnStatement);
    if (statement.body!.statements.length !== 1 || returns.length !== 1 || !returns[0].expression) {
      fail(
        statement.body ?? statement,
        'OEC9007',
        'a server function component must be a single return of one JSX element',
      );
    }
    const parameters = statement.parameters;
    if (parameters.length > 1) {
      fail(
        parameters[1],
        'OEC9032',
        `server function component ${name} takes at most one props parameter`,
      );
    }
    let parameter: string | null = null;
    let fields: CompiledField[] = [];
    if (parameters.length === 1) {
      if (!ts.isIdentifier(parameters[0].name)) {
        fail(parameters[0], 'OEC9032', 'the props parameter must be a plain identifier');
      }
      parameter = parameters[0].name.text;
      fields = fieldsOfPropsType(parameters[0].type, fail);
    }
    return { statement, name, parameter, fields, returned: returns[0].expression!, isArrow: false };
  }
  // export const Name = (props) => jsx
  const declaration = (statement as ts.VariableStatement).declarationList.declarations[0];
  const arrow = declaration.initializer as ts.ArrowFunction;
  if (arrow.parameters.length > 1) {
    fail(arrow.parameters[1], 'OEC9032', `${name} takes at most one props parameter`);
  }
  let parameter: string | null = null;
  let fields: CompiledField[] = [];
  if (arrow.parameters.length === 1) {
    if (!ts.isIdentifier(arrow.parameters[0].name)) {
      fail(arrow.parameters[0], 'OEC9032', 'the props parameter must be a plain identifier');
    }
    parameter = arrow.parameters[0].name.text;
    fields = fieldsOfPropsType(arrow.parameters[0].type, fail);
  }
  return {
    statement,
    name,
    parameter,
    fields,
    returned: arrow.body as ts.Expression,
    isArrow: true,
  };
}

/** True when the component body touches `this` — a class-path-only binding. */
function assertNoThisReads(fn: ts.FunctionLikeDeclaration, fail: CompilerFail): void {
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) {
      fail(
        node,
        'OEC9032',
        'a server function component has no this — read the props parameter (props.<field>) ' +
          'instead; `this` belongs to the @element class path',
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body!);
}

/** The authored props parameter text, verbatim (annotation included). */
function parameterTextOf(component: AdmittedComponent): string {
  if (component.parameter === null) return '';
  const fn = component.isArrow
    ? ((component.statement as ts.VariableStatement).declarationList.declarations[0]
        .initializer as ts.ArrowFunction)
    : (component.statement as ts.FunctionDeclaration);
  const found = fn.parameters.find(
    (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === component.parameter,
  );
  return found ? found.getText() : (component.parameter ?? '');
}

/** The exported server function component names of one (host-resolved) module source. */
function exportedServerComponentNames(source: string, fileName: string): Set<string> {
  const parsed = typescriptParser.parseModule(source, fileName);
  const names = new Set<string>();
  if (parsed.syntaxDiagnostics.length === 0) {
    for (const statement of parsed.sourceFile.statements) {
      if (isExportedServerComponentDeclaration(statement))
        names.add(serverComponentName(statement));
    }
  }
  return names;
}

/**
 * Compile one authored TSX module's server function components into the
 * generative constructor module. Returns null for modules with no exported
 * JSX-returning function (nothing to admit). Fails closed with a
 * {@link CompiledElementError} carrying the ordered OEC diagnostics.
 */
export function compileServerComponentModule(
  source: string,
  fileName: string,
  options: ServerComponentCompileOptions = {},
): CompileServerComponentResult | null {
  const parsed = typescriptParser.parseModule(source, fileName);
  const sf = parsed.sourceFile;
  if (parsed.syntaxDiagnostics.length > 0) {
    throw new CompiledElementError(
      parsed.syntaxDiagnostics.map((diagnostic) => {
        const start = diagnostic.start ?? 0;
        const position = sf.getLineAndCharacterOfPosition(start);
        return {
          code: 'OEC9000',
          message: String(diagnostic.messageText),
          file: fileName,
          line: position.line + 1,
          character: position.character + 1,
          start,
          end: start + (diagnostic.length ?? 0),
        } satisfies ElementCompilerDiagnostic;
      }),
    );
  }
  const fail: CompilerFail = failAt(sf);

  const candidates = sf.statements.filter(isExportedServerComponentDeclaration);

  // Fail closed over near-misses: an exported function in a server-component
  // module whose body contains JSX but is not an admitted shape would
  // otherwise ship as RUNTIME JSX — and the server lane has no JSX
  // interpreter. Refuse it with the code; never lower half a module.
  const containsJsx = (node: ts.Node): boolean => {
    let found = false;
    const visit = (child: ts.Node): void => {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
        found = true;
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
  };
  for (const statement of sf.statements) {
    if (candidates.includes(statement)) continue;
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      // Default exports are page/route surface, not composed components.
      continue;
    }
    let body: ts.Node | undefined;
    if (ts.isFunctionDeclaration(statement)) body = statement.body;
    else if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.length === 1 &&
      statement.declarationList.declarations[0].initializer !== undefined &&
      ts.isArrowFunction(statement.declarationList.declarations[0].initializer!)
    ) {
      body = statement.declarationList.declarations[0].initializer;
    }
    if (body !== undefined && containsJsx(body)) {
      fail(
        statement,
        'OEC9032',
        'this exported function renders JSX but is not an admitted server function component ' +
          '(a component is a single return of one JSX element) — runtime JSX has no interpreter ' +
          'in the server lane; fix the shape or move it out of the module',
      );
    }
  }
  if (candidates.length === 0) return null;

  // The generated module binds the helper names; a module that already binds
  // them would collide at evaluation.
  const intrinsics = createModuleIntrinsicBindings(sf);
  for (const helper of SERVER_HELPERS) {
    if (intrinsics.hasModuleScopeBinding(helper)) {
      fail(
        sf,
        'OEC9032',
        `"${helper}" is reserved for the generated constructor imports ` +
          `(${SERVER_HELPER_SPECIFIER}) — remove or rename the module-scope binding`,
      );
    }
  }

  // Nested composition: resolve the authored imports that name server
  // function components of other modules (compile-time, deterministic; the
  // host supplies the imported sources).
  const componentBindings = new Map<string, string>();
  if (options.resolveModule !== undefined) {
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const specifier = statement.moduleSpecifier.text;
      if (specifier === SERVER_HELPER_SPECIFIER) continue;
      const importedSource = options.resolveModule(specifier);
      if (importedSource === undefined) continue;
      const importedNames = exportedServerComponentNames(
        importedSource,
        `${fileName}→${specifier}`,
      );
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (importedNames.has(imported))
          componentBindings.set(element.name.text, element.name.text);
      }
    }
  }

  const serverBinding = {
    parameter: 'props',
    components: componentBindings,
    compiledTags: new Set(options.compiledTags ?? []),
  };

  // Pass 1: admit and lower every component; keep its generated pieces and
  // the authored nodes the source map points at.
  interface GeneratedComponent {
    statement: ts.Statement;
    name: string;
    /** Single line for arrows; three pieces for function declarations. */
    single?: string;
    signature?: string;
    bodyLine?: string;
    closing?: string;
    signatureNode: ts.Node;
    bodyNode: ts.Node;
  }
  const generatedByStatement = new Map<ts.Statement, GeneratedComponent>();
  const classCandidates = new Set<string>();
  for (const statement of candidates) {
    const component = admitComponent(statement, fail);
    assertNoThisReads(
      component.isArrow
        ? ((statement as ts.VariableStatement).declarationList.declarations[0]
            .initializer as ts.ArrowFunction)
        : (statement as ts.FunctionDeclaration),
      fail,
    );
    // THE semantic authority: the same walk the @element render body takes.
    const lowering = new Lowering(sf, component.fields, [], {
      computedLocal: null,
      server: serverBinding,
    });
    const root = lowering.lowerRoot(component.returned);
    if (root.k !== 'el') {
      fail(component.returned, 'OEC9007', 'a server function component must return one element');
    }
    for (const token of lowering.classCandidates) classCandidates.add(token);
    const body = new ConstructorEmitter(sf, lowering, serverBinding.parameter, fail).emit(root);
    const parameterText = parameterTextOf(component);
    const piece: GeneratedComponent = {
      statement,
      name: component.name,
      signatureNode: statement,
      bodyNode: component.returned,
    };
    if (component.isArrow) {
      piece.single = `export const ${component.name} = (${parameterText}) => ${body};`;
    } else {
      piece.signature = `export function ${component.name}(${parameterText}) {`;
      piece.bodyLine = `  return ${body};`;
      piece.closing = '}';
    }
    generatedByStatement.set(statement, piece);
  }

  // Pass 2: assemble the module (helper imports first — only the helpers the
  // artifact uses — then the authored statements with the components
  // replaced), recording one real source-map segment per generated line.
  const used = new Set<string>();
  for (const piece of generatedByStatement.values()) {
    const text = piece.single ?? `${piece.signature}\n${piece.bodyLine}\n${piece.closing}`;
    for (const helper of SERVER_HELPERS) {
      if (text.includes(`${helper}(`)) used.add(helper);
    }
  }
  const segments = new SourceMapSegmentBuilder();
  const positionOf = (node: ts.Node): { line: number; column: number } => {
    const position = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return { line: position.line + 1, column: position.character };
  };
  const mapLine = (generatedLine: number, node: ts.Node, name?: string): void => {
    const source = positionOf(node);
    segments.add({
      generatedLine,
      generatedColumn: 0,
      sourceLine: source.line,
      sourceColumn: source.column,
      ...(name === undefined ? {} : { name }),
    });
  };
  const codeLines: string[] = [
    '/**',
    ` * Generated by @openelement/compiler — the server function components of ${fileName}.`,
    ' * The admitted JSX lowered to the element server constructor helpers',
    ` * (${SERVER_HELPER_SPECIFIER}); pure server output — no Part Program, no`,
    ' * element registration, no client graph edge.',
    ' */',
  ];
  if (used.size > 0) {
    codeLines.push(`import { ${[...used].sort().join(', ')} } from '${SERVER_HELPER_SPECIFIER}';`);
  }
  for (const statement of sf.statements) {
    const piece = generatedByStatement.get(statement);
    if (piece === undefined) {
      codeLines.push(statement.getText(sf));
      continue;
    }
    if (piece.single !== undefined) {
      mapLine(codeLines.length + 1, piece.signatureNode, piece.name);
      codeLines.push(piece.single);
      continue;
    }
    mapLine(codeLines.length + 1, piece.signatureNode, piece.name);
    codeLines.push(piece.signature!);
    mapLine(codeLines.length + 1, piece.bodyNode);
    codeLines.push(piece.bodyLine!);
    codeLines.push(piece.closing!);
  }
  const code = `${codeLines.join('\n')}\n`;
  return {
    code,
    map: segments.build(fileName, source),
    components: candidates.map(serverComponentName).sort(),
    ...(classCandidates.size === 0 ? {} : { classCandidates: [...classCandidates].sort() }),
  };
}

/**
 * The host-build admission bridge: compile `code` through the server function
 * component lane when — and only when — this module belongs to it.
 *
 * - a module carrying a compiled-element decorator (or an unsupported
 *   decorator spelling, which the class lane compiles so it fails closed with
 *   OEC9027) belongs to the class lane: null;
 * - a module with no discovered server function component has nothing to
 *   admit: null;
 * - a non-`.tsx` id can never carry the JSX grammar: null;
 * - the cheap `export` + `<` prefilter (the same conservative superset idea
 *   the class lane's prefilter uses) keeps plainly inert modules off the
 *   parse.
 *
 * Everything else goes through {@link compileServerComponentModule}, whose
 * diagnostics fail the build closed.
 */
export function compileServerComponentIfAdmitted(
  code: string,
  id: string,
  options: ServerComponentCompileOptions = {},
): CompileServerComponentResult | null {
  if (!/\.tsx(?:\?|$)/.test(id)) return null;
  if (!code.includes('export') || !code.includes('<')) return null;
  const facts = analyzeModuleSemantics(code, id);
  if (facts.compiledElementDecorator || facts.unsupportedElementDecorator !== undefined)
    return null;
  if (facts.serverFunctionComponents.length === 0) return null;
  return compileServerComponentModule(code, id, options);
}

/**
 * The generated-constructor expression builder: one walk over the lowered
 * tree that turns admitted nodes into `__h`/`__t`/`__ssr`/direct-call code.
 * Static attribute values are compile-time literals; every dynamic value
 * enters through a helper boundary.
 */
class ConstructorEmitter {
  // Plain field declarations, not parameter properties: the compiler's
  // shipped source runs under Node's strip-only transform inside packed
  // consumers, which rejects the parameter-property syntax.
  private readonly sf: ts.SourceFile;
  private readonly lowering: Lowering;
  private readonly parameter: string;
  private readonly fail: CompilerFail;

  constructor(sf: ts.SourceFile, lowering: Lowering, parameter: string, fail: CompilerFail) {
    this.sf = sf;
    this.lowering = lowering;
    this.parameter = parameter;
    this.fail = fail;
  }

  emit(root: ProgramTreeNode): string {
    return this.node(root);
  }

  private sinksOf(elementId: string): ProgramPart[] {
    return this.lowering.parts.filter((part) => part.location?.node === elementId);
  }

  /**
   * The slot-name expression for one child of a `__ssr` host: the child's
   * static `slot` attribute as a literal, else its dynamic attr sink named
   * `slot` (the same props read the emitted attribute takes), else `''` — the
   * default slot. Text and Part children are always default-slot: the class
   * path's own `slotNameOf` reads exactly these sources.
   */
  private slotNameExpressionOf(child: ProgramTreeNode): string {
    if (child.k !== 'el') return "''";
    const staticSlot = child.attrs.find(([name]) => name === 'slot')?.[1];
    if (staticSlot !== undefined) return JSON.stringify(staticSlot);
    for (const sink of this.sinksOf(child.id)) {
      if (sink.k === 'attr' && (sink as { name?: string }).name === 'slot') {
        return `${this.parameter}.${(sink as { signal: string }).signal}`;
      }
    }
    return "''";
  }

  private conditionText(test: ProgramCondition): string {
    const ref = `${this.parameter}.${test.signal}`;
    switch (test.op) {
      case 'truthy':
        return test.value ? ref : `!${ref}`;
      case 'equals':
        return `${ref} === ${JSON.stringify(test.value)}`;
      case 'not-equals':
        return `${ref} !== ${JSON.stringify(test.value)}`;
      case 'greater-than':
        return `${ref} > ${String(test.value)}`;
      case 'greater-or-equal':
        return `${ref} >= ${String(test.value)}`;
      case 'less-than':
        return `${ref} < ${String(test.value)}`;
      case 'less-or-equal':
        return `${ref} <= ${String(test.value)}`;
    }
    return this.fail(this.sf, 'OEC9013', `unsupported condition ${String(test.op)}`);
  }

  private node(node: ProgramTreeNode): string {
    if (node.k === 'text') {
      // Static text rides the SAME runtime text boundary as dynamic text —
      // one channel, no second escaper anywhere in the pipeline.
      return `__t(${JSON.stringify(node.value)})`;
    }
    if (node.k === 'ival') {
      return `__t(item.${node.field ?? 'item'})`;
    }
    if (node.k === 'part') {
      const part = this.lowering.parts[node.index];
      if (part.k === 'text') {
        // The composition channel: `children` is compiler-produced HTML from
        // the caller's own compiled markup (the same trust level as an
        // `__ssr` result) and crosses raw; every other signal is escaped text.
        if (part.signal === 'children') return `(${this.parameter}.children ?? '')`;
        return `__t(${this.parameter}.${part.signal})`;
      }
      if (part.k === 'when') {
        const on = this.node(part.on[0]);
        const off = this.node(part.off[0]);
        return `(${this.conditionText(part.test)} ? ${on} : ${off})`;
      }
      if (part.k === 'each') {
        return `${this.parameter}.${part.signal}.map((item) => ${this.node(part.item[0])}).join('')`;
      }
      return this.fail(
        this.sf,
        'OEC9013',
        `sink ${part.k} cannot anchor in server function output`,
      );
    }
    // Element node.
    const componentCall = this.lowering.componentCalls.get(node.id);
    if (componentCall !== undefined) {
      const entries = componentCall.propsEntries.map(
        ([name, value]) => `${JSON.stringify(name)}: ${value}`,
      );
      if (componentCall.children.length > 0) {
        entries.push(
          `${JSON.stringify('children')}: [${componentCall.children
            .map((child) => this.node(child))
            .join(', ')}].join('')`,
        );
      }
      return `${componentCall.component}({ ${entries.join(', ')} })`;
    }
    const sinks = this.sinksOf(node.id);
    const isSsr = this.lowering.ssrCalls.has(node.id);
    const attrEntries: string[] = [];
    for (const [name, value] of node.attrs) {
      attrEntries.push(`${JSON.stringify(name)}: ${JSON.stringify(value)}`);
    }
    for (const part of sinks) {
      if (part.k === 'event' || part.k === 'ref') {
        // Unreachable: the walk refuses both in server mode.
        continue;
      }
      if (part.k === 'html') {
        if (isSsr) {
          this.fail(
            this.sf,
            'OEC9032',
            'a trustedHtml sink cannot cross a __ssr host — pass the trusted value as the ' +
              "component's own property instead",
          );
        }
        attrEntries.push(`${JSON.stringify('innerHTML')}: ${this.parameter}.${part.signal}`);
        continue;
      }
      if (part.k === 'class') {
        const synthesized = this.lowering.synthesizedFields.find(
          (field) => field.name === part.signal,
        );
        const value = synthesized
          ? `(${synthesized.computed!.body.getText(this.sf)})`
          : `${this.parameter}.${part.signal}`;
        attrEntries.push(`${JSON.stringify('class')}: ${value}`);
        continue;
      }
      // attr / bool / prop / style: the raw prop value crosses (attributes
      // for tags, props for __ssr hosts); __h escapes at the wire. class and
      // style Parts carry no attribute name of their own.
      if (part.k === 'style') {
        attrEntries.push(`${JSON.stringify('style')}: ${this.parameter}.${part.signal}`);
        continue;
      }
      attrEntries.push(
        `${JSON.stringify((part as { name: string }).name)}: ${this.parameter}.${part.signal}`,
      );
    }
    // Per-item attribute slots ([name, itemField]) resolve from the enclosing
    // each template's own `item` parameter — the same binding the `ival` text
    // slots read. They ride as props (this is the __ssr/host channel) and
    // `__h` re-applies the value semantics the class serializer's
    // itemAttributeEmission owns: `true` emits a bare attribute,
    // false/null/undefined omit, anything else serializes with String().
    for (const [name, field] of node.iattrs ?? []) {
      attrEntries.push(`${JSON.stringify(name)}: item.${field}`);
    }
    const attrsText = `{ ${attrEntries.join(', ')}${attrEntries.length > 0 ? ' ' : ''}}`;
    if (isSsr) {
      // A __ssr host keeps its children: the compiled children channel hands
      // them over as the composition record — authored-order [slotName, html]
      // pairs (the child's static `slot` attribute; '' is the default slot).
      // The runtime delivers the form the host's own root mode takes (light:
      // slot projections; shadow: light DOM after the DSD template), exactly
      // like the class path's nested expansion. A childless host keeps the
      // two-argument call — byte-identical to the pre-composition lane.
      const childNodes = node.children;
      if (childNodes.length === 0) {
        return `__ssr(${JSON.stringify(node.tag)}, ${attrsText})`;
      }
      const groupEntries = childNodes.map(
        (child) => `[${this.slotNameExpressionOf(child)}, ${this.node(child)}]`,
      );
      return `__ssr(${JSON.stringify(node.tag)}, ${attrsText}, undefined, { groups: [${groupEntries.join(', ')}] })`;
    }
    const children = node.children.map((child) => this.node(child));
    return `__h(${JSON.stringify(node.tag)}, ${attrsText}, [${children.join(', ')}])`;
  }
}
