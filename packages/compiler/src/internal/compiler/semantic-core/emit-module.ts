/**
 * Generated-module emission for the compiled grammar (#1473 split): renders
 * the compiled module text with
 * verbatim copies, synthesized statics and forwarding handlers, each mapped
 * through a real Source Map v3 segment.
 */

import ts from 'typescript';
import { type AnalyzedModule } from './analyze-module.ts';
import {
  SYNTHESIZED_COMPUTED_LOCAL,
  type GeneratedHandler,
  type Lowering,
} from './lower-program.ts';
import { isCompileTimeOnlyImport } from './module-analysis.ts';
import { type CompiledElementSourceMap, SourceMapSegmentBuilder } from './source-map.ts';
import {
  COMPILED_MODULE_ABI_VERSION,
  PART_PROGRAM_VERSION,
  type PartProgramV1,
} from '@openelement/protocol/part-program';

/**
 * Copy one source import statement into the generated module. Compile-time-
 * only intrinsic bindings (element/property from '@openelement/element') are
 * stripped: the decorators they powered are erased by compilation and the
 * runtime package exports neither, so keeping them would emit an unresolvable
 * runtime import. A statement whose entire clause stripped away is dropped.
 */
function rewriteImportForGeneratedModule(
  sf: ts.SourceFile,
  statement: ts.ImportDeclaration,
): string | null {
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return statement.getText(sf);
  const module = statement.moduleSpecifier.text;
  const clause = statement.importClause;
  if (!clause) return statement.getText(sf);
  const bindings = clause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return statement.getText(sf);
  const kept = bindings.elements.filter(
    (element) => !isCompileTimeOnlyImport(module, element.propertyName?.text ?? element.name.text),
  );
  if (kept.length === bindings.elements.length) return statement.getText(sf);
  const parts: string[] = [];
  if (clause.name) parts.push(clause.name.text);
  if (kept.length > 0) {
    const specifiers = kept.map(
      (element) =>
        `${element.isTypeOnly ? 'type ' : ''}` +
        `${element.propertyName ? `${element.propertyName.text} as ` : ''}${element.name.text}`,
    );
    parts.push(`{ ${specifiers.join(', ')} }`);
  }
  if (parts.length === 0) return null;
  return `import ${clause.isTypeOnly ? 'type ' : ''}${parts.join(', ')} from '${module}';`;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The platform lifecycle callbacks whose authored bodies the compiler wraps
 * in the error-boundary capture contract. These are the callbacks the platform
 * invokes outside any application stack — a throw inside them would otherwise
 * escape straight to window.onerror with no boundary the way a render throw
 * in React reaches the nearest error boundary. Everything else (event
 * handlers, plain author methods) keeps the verbatim emission: those already
 * run inside caller stacks, and the runtime capture points (the facade
 * property setter, the kernel update sink) own their failure modes.
 */
const CAPTURE_WRAPPED_LIFECYCLE_CALLBACKS = new Set([
  'connectedCallback',
  'disconnectedCallback',
  'adoptedCallback',
  'attributeChangedCallback',
  'formAssociatedCallback',
  'formResetCallback',
  'formStateRestoreCallback',
]);

function generatedHandlerText(handler: GeneratedHandler): string {
  const action = handler.action;
  if (action.kind === 'method') return `  ${handler.name}(): void { this.${action.name}(); }`;
  if (action.kind === 'call') return `  ${handler.name}(): void { this.${action.name}(); }`;
  if (action.kind === 'increment') return `  ${handler.name}(): void { this.${action.signal}++; }`;
  if (action.kind === 'decrement') return `  ${handler.name}(): void { this.${action.signal}--; }`;
  if (action.kind === 'add') {
    return `  ${handler.name}(): void { this.${action.signal} += ${action.value}; }`;
  }
  if (action.kind === 'subtract') {
    return `  ${handler.name}(): void { this.${action.signal} -= ${action.value}; }`;
  }
  if (action.kind === 'assign') {
    return `  ${handler.name}(): void { this.${action.signal} = ${JSON.stringify(action.value)}; }`;
  }
  return `  ${handler.name}(): void {}`;
}

/** Inputs for the module-emission stage. */
export interface EmitModuleInput {
  sf: ts.SourceFile;
  /** The authored source (the emitted inline map's `sourcesContent`). */
  source: string;
  fileName: string;
  analyzed: AnalyzedModule;
  lowering: Lowering;
  program: PartProgramV1;
  programJson: string;
  propertiesJson: string;
  metadataJson: string;
  observedJson: string;
}

export interface EmitModuleResult {
  code: string;
  map: CompiledElementSourceMap;
}

/** Render the compiled module text and its inline Source Map v3. */
export function emitCompiledModule(input: EmitModuleInput): EmitModuleResult {
  const {
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
  } = input;
  const {
    fields,
    methods,
    render,
    stylesText,
    stylesNode,
    stylesTypeText,
    passthroughStatements,
    decorator,
    classNode,
    tag,
    className,
    isDefaultExport,
    openElementLocalName,
    delegatesFocus,
    formAssociated,
  } = analyzed;

  // Emission provenance (#1210): the semantic core owns both the
  // original source spans and where each copied/derived construct lands in the
  // generated module. Every such line records a real Source Map v3 segment
  // (VLQ line+column, names where known); pure scaffolding stays unmapped so
  // consumers fall through to the nearest real construct. The emitted module
  // text is unchanged by this bookkeeping.
  const segments = new SourceMapSegmentBuilder();
  const codeLines: string[] = [];
  const nodePosition = (node: ts.Node): { line: number; column: number } => {
    const position = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return { line: position.line + 1, column: position.character };
  };
  const mapLineAt = (
    generatedLine: number,
    generatedColumn: number,
    node: ts.Node,
    name?: string,
  ): void => {
    const position = nodePosition(node);
    segments.add({
      generatedLine,
      generatedColumn,
      sourceLine: position.line,
      sourceColumn: position.column,
      ...(name === undefined ? {} : { name }),
    });
  };
  /**
   * Continuation lines of a verbatim-copied block: text line i is authored
   * line (start + i) verbatim, so generated column (prefix + whitespace) maps
   * to authored column (whitespace) — the first non-whitespace character.
   */
  const mapContinuationLines = (
    text: string,
    firstGeneratedLine: number,
    node: ts.Node,
    prefix: number,
  ): void => {
    const position = nodePosition(node);
    const lines = text.split('\n');
    for (let index = 1; index < lines.length; index++) {
      const whitespace = /^\s*/.exec(lines[index])![0].length;
      segments.add({
        generatedLine: firstGeneratedLine + index,
        generatedColumn: prefix + whitespace,
        sourceLine: position.line + index,
        sourceColumn: whitespace,
      });
    }
  };
  /** Push a line or block: multiline text always splits so codeLines.length tracks emitted lines. */
  const push = (text: string): void => {
    for (const line of text.split('\n')) codeLines.push(line);
  };
  /** Push a verbatim copy of a node's text (optionally line-prefixed). */
  const pushVerbatim = (text: string, node: ts.Node, prefix = '', name?: string): void => {
    const firstGeneratedLine = codeLines.length + 1;
    push(
      text
        .split('\n')
        .map((line) => prefix + line)
        .join('\n'),
    );
    mapLineAt(firstGeneratedLine, prefix.length, node, name);
    mapContinuationLines(text, firstGeneratedLine, node, prefix.length);
  };
  /** Push one synthesized line embedding a verbatim value, mapping both. */
  const pushDerivedLine = (
    head: string,
    valueText: string,
    tail: string,
    nameNode: ts.Node,
    nameColumn: number,
    name: string,
    valueNode: ts.Node | undefined,
  ): void => {
    const generatedLine = codeLines.length + 1;
    push(`${head}${valueText}${tail}`);
    mapLineAt(generatedLine, nameColumn, nameNode, name);
    if (valueNode !== undefined) {
      mapLineAt(generatedLine, head.length, valueNode);
      mapContinuationLines(valueText, generatedLine, valueNode, 0);
    }
  };
  /** Push a synthesized block whose first line traces to `node`. */
  const pushDerivedBlock = (text: string, node: ts.Node, name?: string): void => {
    const firstGeneratedLine = codeLines.length + 1;
    push(text);
    mapLineAt(firstGeneratedLine, 0, node, name);
  };

  push(
    `// <auto-generated by open:compiled-element; part-program format ${PART_PROGRAM_VERSION} / module ABI ${COMPILED_MODULE_ABI_VERSION} - do not edit>`,
  );
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const rewritten = rewriteImportForGeneratedModule(sf, statement);
    // No OpenElement import injection (#1209): heritage provenance is required,
    // so the canonical binding (possibly aliased) always exists in the source
    // and is carried by the copied imports above.
    if (rewritten !== null) pushVerbatim(rewritten, statement);
  }
  // The consumer:packaged gate types the generated __computedFields through
  // ReadonlySignal: reuse the source's local binding (possibly aliased), or
  // add a type-only import when the source never bound it. The specifier is
  // fixed: computed factories already require the canonical element import.
  let readonlySignalLocal: string | null = null;
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@openelement/element'
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName?.text ?? element.name.text) === 'ReadonlySignal') {
        readonlySignalLocal = element.name.text;
      }
    }
  }
  const needsComputedTypes = fields.some((field) => field.computed);
  const signalType = readonlySignalLocal ?? 'ReadonlySignal';
  if (needsComputedTypes && readonlySignalLocal === null) {
    push(`import type { ReadonlySignal } from '@openelement/element';`);
  }
  // Synthesized conditional-class fields (#1556): when the authored module
  // never bound the canonical computed import, the generated module binds it
  // under the synthesized name the factories reference. Authored computeds
  // never need this — their provenance admission requires the import.
  if (lowering.synthesizedFields.length > 0 && !lowering.sourceBindsComputed) {
    push(`import { computed as ${SYNTHESIZED_COMPUTED_LOCAL} } from '@openelement/element';`);
  }
  push('');
  for (const statement of passthroughStatements) pushVerbatim(statement.getText(sf), statement);
  if (passthroughStatements.length > 0) push('');

  // The serialized program payload derives from the render() JSX.
  const programStartLine = codeLines.length + 1;
  pushDerivedBlock(`const __partProgram = ${programJson};`, render);
  const programJsonPosition = (offset: number): { line: number; column: number } => {
    const before = programJson.slice(0, offset);
    return {
      line: programStartLine + before.split('\n').length - 1,
      column: offset - (before.lastIndexOf('\n') + 1),
    };
  };
  const tagOffset = programJson.indexOf(`"tag": ${JSON.stringify(tag)}`);
  if (tagOffset >= 0) {
    // The compiled tag payload traces to the @element decorator application.
    const at = programJsonPosition(tagOffset);
    mapLineAt(at.line, at.column, decorator);
  }
  push('');
  pushDerivedBlock(`const __compiledProperties = ${propertiesJson};`, classNode.name!);
  push('');
  pushDerivedBlock(`const __elementMetadata = ${metadataJson};`, classNode.name!);
  push('');
  // Explicit string[]: an empty attribute list would otherwise infer an
  // evolving any[] that strict noImplicitAny rejects at staged-pack check.
  pushDerivedBlock(`const __observedAttributes: string[] = ${observedJson};`, classNode.name!);
  push('');

  pushDerivedBlock('const __compiledProps = {', classNode.name!);
  for (const field of fields) {
    if (field.computed) {
      const computedLine = codeLines.length + 1;
      push(
        `  ${field.name}: { type: Object, default: undefined, reflect: false, attribute: false },`,
      );
      mapLineAt(computedLine, 2, field.node.name, field.name);
      continue;
    }
    const attribute = field.attribute === null ? 'false' : JSON.stringify(field.attribute);
    pushDerivedLine(
      `  ${field.name}: { type: ${field.typeConstructor}, default: `,
      field.initializerText,
      `, reflect: ${field.reflect}, attribute: ${attribute} },`,
      field.node.name,
      2,
      field.name,
      field.node.initializer,
    );
  }
  push('};');
  push('');

  const classLine = `export ${
    isDefaultExport ? 'default ' : ''
  }class ${className} extends ${openElementLocalName} {`;
  push(classLine);
  mapLineAt(codeLines.length, classLine.indexOf(className), classNode.name!, className);
  // Consumer:packaged gate: every generated static carries an explicit type.
  // Module-local constants use typeof (exact, no API growth); synthesized
  // boolean flags use boolean with override (the base declares them); styles
  // keeps the authored annotation with override (the base declares styles).
  push(
    [
      '  static __partProgram: typeof __partProgram = __partProgram;',
      '  static __compiledProperties: typeof __compiledProperties = __compiledProperties;',
      '  static __elementMetadata: typeof __elementMetadata = __elementMetadata;',
      '  static props: typeof __compiledProps = __compiledProps;',
      '  static observedAttributes: typeof __observedAttributes = __observedAttributes;',
    ].join('\n'),
  );
  if (delegatesFocus) push('  static override delegatesFocus: boolean = true;');
  if (formAssociated) push('  static override formAssociated: boolean = true;');
  const computedFields = fields.filter((field) => field.computed);
  if (computedFields.length > 0) {
    // Derived-signal factories: each builds the field's read-only computed
    // over the instance's plain property signals (facade + renderDsd run the
    // same factories, so server output and client claim read one value set).
    // The outer annotation gives every factory an explicit function type
    // (consumer:packaged gate): the return is the authored field type, the
    // signal record is keyed per dependency with its own signal value type.
    // Inner factories stay textually unchanged and contextually typed.
    const plainFieldByName = new Map(
      fields.filter((field) => !field.computed).map((field) => [field.name, field]),
    );
    const signalValueType = (name: string): string => {
      const plain = plainFieldByName.get(name);
      const annotated = plain?.typeText.replace(/^:\s*/, '').trim() ?? '';
      if (annotated) return annotated;
      switch (plain?.typeConstructor) {
        case 'String':
          return 'string';
        case 'Number':
          return 'number';
        case 'Boolean':
          return 'boolean';
        case 'Array':
          return 'unknown[]';
        case 'Object':
          return 'Record<string, unknown>';
        default:
          return 'unknown';
      }
    };
    const computedReturnType = (field: (typeof computedFields)[number]): string => {
      const annotated = field.typeText.replace(/^:\s*/, '').trim();
      // Unannotated computed fields fall back to the contract-level signal
      // type (every computed() result is assignable to it); annotated fields
      // keep their precise authored type.
      return annotated || `${signalType}<unknown>`;
    };
    push('  static __computedFields: {');
    for (const field of computedFields) {
      const params = field
        .computed!.deps.map((dep) => `${dep}: ${signalType}<${signalValueType(dep)}>`)
        .join(', ');
      push(`    ${field.name}: (__s: { ${params} }) => ${computedReturnType(field)};`);
    }
    push('  } = {');
    for (const field of computedFields) {
      const factoryLine = codeLines.length + 1;
      push(`    ${field.name}: ${field.computed!.factoryText},`);
      mapLineAt(factoryLine, 4, field.node.name, field.name);
      mapLineAt(factoryLine, 4 + field.name.length + 2, field.node.initializer!);
      mapContinuationLines(field.computed!.factoryText, factoryLine, field.computed!.body, 0);
    }
    push('  };');
  }
  if (stylesText !== undefined && stylesNode !== undefined) {
    // Copied verbatim: the facade reads static styles into the compiled style
    // scope (adoptedStyleSheets on shadow roots, a document-head sink on light
    // roots); the serializer inlines them as the marked DSD <style> element.
    // The initializer's bindings are the authored `.css` imports (#1558) —
    // the build's style-asset plugin serves those edges as sheet adapters, so
    // the generated module never carries sheet bytes itself.
    const stylesHead = `  static override styles${stylesTypeText ?? ''} = `;
    const stylesLine = codeLines.length + 1;
    push(`${stylesHead}${stylesText};`);
    mapLineAt(stylesLine, stylesHead.length, stylesNode);
    mapContinuationLines(stylesText, stylesLine, stylesNode, 0);
  }
  for (const field of fields) {
    // Computed fields carry no initializer on the generated class: the
    // prototype accessor reads the derived signal, and an own data property
    // would shadow it.
    if (field.computed) continue;
    const accessibility = field.accessibility ? `${field.accessibility} ` : '';
    pushDerivedLine(
      `  ${accessibility}${field.name}${field.typeText} = `,
      field.initializerText,
      ';',
      field.node.name,
      2 + accessibility.length,
      field.name,
      field.node.initializer,
    );
  }
  /**
   * Emit one platform lifecycle callback with the boundary-capture wrapper
   * (P2: the wrapper is a compile-time cost; the runtime delta is one method
   * call on the failure path only). The body bytes and their columns are
   * emitted UNCHANGED from the verbatim copy — body line i keeps the authored
   * text at the authored column, so the continuation mapping stays
   * byte-identical to what `pushVerbatim` produced; the inserted `try {` and
   * `} catch` lines are pure scaffolding and stay unmapped (consumers fall
   * through to the nearest real construct, the method's own first-line
   * mapping). Prior art (P7): React error boundaries capture lifecycle and
   * render throws at runtime; the compiled difference is that this capture
   * point is materialized once, at compile time, around exactly the platform
   * entry points — `_captureError` on the base class then performs the same
   * nearest-boundary climb React's component stack does.
   */
  const pushLifecycleCapture = (method: ts.MethodDeclaration, name: string): void => {
    const body = method.body!;
    const methodText = method.getText(sf);
    // Header: everything the authored method carries before its body block —
    // accessibility/modifiers, name, type parameters, parameters, return type.
    const header = methodText.slice(0, body.getStart(sf) - method.getStart(sf));
    // Body text between the braces, minus the indentation-only line that
    // carried the method's own closing brace (the wrapper supplies its own).
    const bodyText = methodText
      .slice(header.length + 1, methodText.length - 1)
      .replace(/\n[ \t]*$/, '');
    const firstGeneratedLine = codeLines.length + 1;
    push(`  ${header}{`);
    mapLineAt(firstGeneratedLine, 2, method, name);
    push(`  try {${bodyText}`);
    // bodyText's line 0 is the remainder of the authored `{` line, so its
    // line 1 is authored line bodyStart+1 — exactly what the continuation
    // mapper computes with the body node and the `try {` line as line 0.
    mapContinuationLines(bodyText, firstGeneratedLine + 1, body, 0);
    push(`  } catch (error) { if (!this._captureError(error)) throw error; }`);
    push(`  }`);
  };
  for (const method of methods) {
    const name = (method.name as ts.Identifier).text;
    if (CAPTURE_WRAPPED_LIFECYCLE_CALLBACKS.has(name)) {
      pushLifecycleCapture(method, name);
      continue;
    }
    pushVerbatim(method.getText(sf), method, '  ', name);
  }
  for (const handler of lowering.generatedHandlers) {
    // Synthesized forwarding method; its whole line traces to the authored
    // arrow function, so identical handler bodies never collapse onto the
    // first matching source line.
    const handlerLine = codeLines.length + 1;
    push(generatedHandlerText(handler));
    mapLineAt(handlerLine, 2, handler.node);
  }
  push('  render(): never {');
  mapLineAt(codeLines.length, 2, render, 'render');
  push(
    '    throw new Error(\n' +
      `      '[open:compiled-element] ${tag} is compiled to a Part Program; ` +
      "the runtime JSX render path is not available.',\n" +
      '    );\n' +
      '  }',
  );
  push('}');
  push('');
  push('export { __partProgram, __elementMetadata };');

  // The one map story at this boundary: real v3 segments, with the Part
  // Program provenance records carried as supplementary metadata only.
  const map = segments.build(fileName, source, program.sourceMap);
  push(`//# sourceMappingURL=data:application/json;base64,${encodeBase64(JSON.stringify(map))}`);
  return { code: codeLines.join('\n') + '\n', map };
}
