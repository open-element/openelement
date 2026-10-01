/**
 * Module/class-shape analysis for the compiled grammar (#1473 split — the
 * analyze stage of the former compile facade): the admitted statement shapes,
 * the one `@element` class with its decorator options and canonical heritage,
 * and the `@property` field/method/render inventory the later lowering and
 * emission stages consume.
 */

import ts from 'typescript';
import { type CompilerFail } from './compiler-diagnostics.ts';
import { type ModuleIntrinsicBindings } from './module-analysis.ts';
import { type PropertyValueType, type SerializableValue } from '../../protocol/part-program.ts';
import { forbiddenSinkReason } from '../../protocol/forbidden-sinks.ts';

export interface CompiledField {
  name: string;
  reflect: boolean;
  attribute: string | null;
  type: PropertyValueType;
  converter: PropertyValueType;
  typeConstructor: 'String' | 'Number' | 'Boolean' | 'Array' | 'Object';
  accessibility: 'public' | 'protected' | 'private' | '';
  typeText: string;
  initializerText: string;
  defaultValue: SerializableValue;
  node: ts.PropertyDeclaration;
  /**
   * Computed field (alpha.8): the source initializer is
   * `computed(() => <expr>)` (optionally behind a type assertion). The
   * compiled accessor returns the derived value. The compiler records the
   * source-signal dependencies and emits a `__computedFields` factory over the
   * instance's signal record; no field initializer runs on the generated class.
   */
  computed?: { deps: string[]; factoryText: string; body: ts.Expression };
}

function camelToKebab(value: string): string {
  return value.replace(/([A-Z])/g, '-$1').toLowerCase();
}

export function isSafeAttributeName(value: string): boolean {
  return (
    /^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(value) &&
    !/^on/i.test(value) &&
    forbiddenSinkReason('attr', value) === null
  );
}

export function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Return a JSON-safe literal, or undefined when the expression is not literal. */
export function literalValue(
  expr: ts.Expression,
  sf: ts.SourceFile,
): SerializableValue | undefined {
  const value = unwrapExpression(expr);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  if (ts.isNumericLiteral(value)) {
    const number = Number(value.text);
    return Number.isFinite(number) ? number : undefined;
  }
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (value.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken) {
    if (!ts.isNumericLiteral(value.operand)) return undefined;
    const number = -Number(value.operand.text);
    return Number.isFinite(number) ? number : undefined;
  }
  if (ts.isArrayLiteralExpression(value)) {
    const entries: SerializableValue[] = [];
    for (const element of value.elements) {
      if (ts.isSpreadElement(element)) return undefined;
      const entry = literalValue(element, sf);
      if (entry === undefined) return undefined;
      entries.push(entry);
    }
    return entries;
  }
  if (ts.isObjectLiteralExpression(value)) {
    const object: { [key: string]: SerializableValue } = {};
    for (const property of value.properties) {
      if (!ts.isPropertyAssignment(property)) return undefined;
      const name = property.name;
      const key =
        ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
          ? name.text
          : undefined;
      if (key === undefined || key === '__proto__') return undefined;
      const entry = literalValue(property.initializer, sf);
      if (entry === undefined) return undefined;
      object[key] = entry;
    }
    return object;
  }
  return undefined;
}

/**
 * The one non-serializable field default admitted by the compiled grammar.
 * The wrapper is the runtime capability; limiting the argument to a literal
 * keeps compiled metadata deterministic and prevents arbitrary initializer
 * execution from entering the property schema. Provenance (#1209): the callee
 * must bind the canonical `trustedHtml` import; a same-name spelling bound to
 * anything else fails closed (OEC9026) instead of being silently admitted.
 */
function isTrustedHtmlInitializer(
  expr: ts.Expression,
  intrinsics: ModuleIntrinsicBindings,
  fail: CompilerFail,
): boolean {
  const value = unwrapExpression(expr);
  if (!ts.isCallExpression(value)) return false;
  const resolution = intrinsics.resolveIntrinsic(value.expression, 'trustedHtml');
  if (!resolution.canonical) {
    if (
      resolution.unsupported ||
      (ts.isIdentifier(value.expression) && value.expression.text === 'trustedHtml')
    ) {
      fail(
        value,
        'OEC9026',
        'trustedHtml field defaults require the canonical trustedHtml import: a runtime named ' +
          "import of trustedHtml from '@openelement/element'" +
          (resolution.unsupported ? ` (${resolution.unsupported})` : ''),
      );
    }
    return false;
  }
  if (value.arguments.length !== 1) return false;
  const html = unwrapExpression(value.arguments[0]);
  return ts.isStringLiteral(html) || ts.isNoSubstitutionTemplateLiteral(html);
}

export function primitiveText(value: SerializableValue): string | null {
  if (value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function propertyTypeFromConstructor(
  expr: ts.Expression,
  sf: ts.SourceFile,
  node: ts.Node,
  fail: CompilerFail,
): { label: PropertyValueType; constructorName: CompiledField['typeConstructor'] } {
  const name = expr.getText(sf);
  if (
    name !== 'String' &&
    name !== 'Number' &&
    name !== 'Boolean' &&
    name !== 'Array' &&
    name !== 'Object'
  ) {
    return fail(
      node,
      'OEC9021',
      'property type/converter must be one of String, Number, Boolean, Array or Object',
    );
  }
  return { label: name.toLowerCase() as PropertyValueType, constructorName: name };
}

/**
 * Parse a computed field initializer (alpha.8): `computed(() => ...)`
 * behind optional `as`-casts, where the callee binds the canonical `computed`
 * import (#1209 — a same-name spelling bound to anything else fails closed
 * with OEC9025). The arrow body may read `this.<field>` of any NON-computed
 * declared field (rewritten to the signal-record read) and use any
 * module-scope values; `this` in any other position, reads of computed
 * fields, and nested non-arrow functions fail closed (OEC9024). Returns null
 * for non-computed initializers.
 */
function parseComputedInitializer(
  initializer: ts.Expression,
  sf: ts.SourceFile,
  intrinsics: ModuleIntrinsicBindings,
  plainFieldNames: ReadonlySet<string>,
  computedFieldNames: ReadonlySet<string>,
  fail: CompilerFail,
): { deps: string[]; factoryText: string; body: ts.Expression } | null {
  const value = unwrapExpression(initializer);
  if (!ts.isCallExpression(value)) return null;
  const resolution = intrinsics.resolveIntrinsic(value.expression, 'computed');
  if (!resolution.canonical) {
    if (
      resolution.unsupported ||
      (ts.isIdentifier(value.expression) && value.expression.text === 'computed')
    ) {
      fail(
        value,
        'OEC9025',
        'computed fields require the canonical computed import: a runtime named import of ' +
          "computed from '@openelement/element'" +
          (resolution.unsupported ? ` (${resolution.unsupported})` : ''),
      );
    }
    return null;
  }
  if (value.arguments.length !== 1 || !ts.isArrowFunction(value.arguments[0])) {
    fail(value, 'OEC9024', 'computed fields take exactly one zero-argument arrow function');
  }
  const arrow = value.arguments[0] as ts.ArrowFunction;
  if (arrow.parameters.length > 0) {
    fail(arrow, 'OEC9024', 'computed field arrows may not declare parameters');
  }
  if (!ts.isBlock(arrow.body)) {
    // expression body — the supported form
  } else if (
    arrow.body.statements.length === 1 &&
    ts.isReturnStatement(arrow.body.statements[0]) &&
    arrow.body.statements[0].expression
  ) {
    fail(
      arrow.body,
      'OEC9024',
      'computed field arrows use an expression body, not a block (keep derived values atomic)',
    );
  } else {
    fail(arrow.body, 'OEC9024', 'computed field arrows use an expression body, not a block');
  }
  const body = arrow.body as ts.Expression;
  const deps: string[] = [];
  const replacements: Array<{ start: number; end: number; name: string }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      fail(node, 'OEC9024', 'computed field arrows may not nest non-arrow functions');
    }
    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const name = node.name.text;
      if (computedFieldNames.has(name)) {
        fail(node, 'OEC9024', `computed field may not read computed field "${name}"`);
      }
      if (!plainFieldNames.has(name)) {
        fail(
          node,
          'OEC9024',
          `computed fields may only read this.<declared property> (found this.${name})`,
        );
      }
      if (!deps.includes(name)) deps.push(name);
      replacements.push({ start: node.getStart(sf), end: node.getEnd(), name });
      return;
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) {
      fail(node, 'OEC9024', 'computed field arrows may only reference this.<property>');
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  let bodyText = body.getText(sf);
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    const offset = body.getStart(sf);
    bodyText =
      bodyText.slice(0, replacement.start - offset) +
      `__s.${replacement.name}.value` +
      bodyText.slice(replacement.end - offset);
  }
  return { deps, factoryText: `(__s) => ${resolution.localName}(() => ${bodyText})`, body };
}

function inferPropertyType(
  member: ts.PropertyDeclaration,
  defaultValue: SerializableValue,
  sf: ts.SourceFile,
): { label: PropertyValueType; constructorName: CompiledField['typeConstructor'] } {
  const typeText = member.type?.getText(sf).replace(/[\s?]/g, '') ?? '';
  if (typeText === 'string' || typeText === 'String') {
    return { label: 'string', constructorName: 'String' };
  }
  if (typeText === 'number' || typeText === 'Number') {
    return { label: 'number', constructorName: 'Number' };
  }
  if (typeText === 'boolean' || typeText === 'Boolean') {
    return { label: 'boolean', constructorName: 'Boolean' };
  }
  if (/^(Array|ReadonlyArray|Set)</.test(typeText) || typeText.endsWith('[]')) {
    return { label: 'array', constructorName: 'Array' };
  }
  if (/^(Record|Map|Object)</.test(typeText)) return { label: 'object', constructorName: 'Object' };
  if (Array.isArray(defaultValue)) return { label: 'array', constructorName: 'Array' };
  if (defaultValue !== null && typeof defaultValue === 'object') {
    return { label: 'object', constructorName: 'Object' };
  }
  if (typeof defaultValue === 'number') return { label: 'number', constructorName: 'Number' };
  if (typeof defaultValue === 'boolean') return { label: 'boolean', constructorName: 'Boolean' };
  return { label: 'string', constructorName: 'String' };
}

function propertyFields(
  sf: ts.SourceFile,
  classNode: ts.ClassDeclaration,
  intrinsics: ModuleIntrinsicBindings,
  fail: CompilerFail,
): {
  fields: CompiledField[];
  methods: ts.MethodDeclaration[];
  render: ts.MethodDeclaration;
  stylesText?: string;
  stylesNode?: ts.Expression;
  /** Authored `static styles` type annotation (e.g. `: StyleSheetLike[]`), preserved verbatim. */
  stylesTypeText?: string;
} {
  const fields: CompiledField[] = [];
  const methods: ts.MethodDeclaration[] = [];
  let render: ts.MethodDeclaration | null = null;
  let stylesText: string | undefined;
  let stylesNode: ts.Expression | undefined;
  let stylesTypeText: string | undefined;
  const names = new Set<string>();
  const propertyAttributeNames = new Set<string>();
  for (const member of classNode.members) {
    if (ts.isPropertyDeclaration(member)) {
      const modifiers = ts.getModifiers(member) ?? [];
      // alpha.8: `static styles = <expr>` is the one static member a compiled
      // class may carry — the facade's compiled style scope consumes it
      // (adoptedStyleSheets for shadow roots, a document-head sink for light
      // roots). The initializer is copied verbatim; it typically references a
      // StyleSheet built in a non-compiled module (compiled modules ban
      // runtime top-level statements). Raw-text <style>/<script> elements are
      // rejected from templates by the shared forbidden-sink rule (lowerElement
      // fails with OEC9010), so styles never inline.
      if (
        modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) &&
        ts.isIdentifier(member.name) &&
        member.name.text === 'styles' &&
        (ts.getDecorators(member) ?? []).length === 0
      ) {
        if (!member.initializer) {
          fail(member, 'OEC9005', 'static styles requires an initializer');
        }
        if (stylesText !== undefined) {
          fail(member, 'OEC9005', 'compiled classes may declare static styles only once');
        }
        stylesText = member.initializer.getText(sf);
        stylesNode = member.initializer;
        // Preserve the authored annotation (native pack fast-check requires
        // an explicit static styles type; the generated class must not drop
        // it). Unannotated styles keep the legacy bare emission.
        stylesTypeText = member.type ? `: ${member.type.getText(sf)}` : undefined;
        continue;
      }
      const accessibilityModifiers = modifiers.filter(
        (modifier) =>
          modifier.kind === ts.SyntaxKind.PublicKeyword ||
          modifier.kind === ts.SyntaxKind.ProtectedKeyword ||
          modifier.kind === ts.SyntaxKind.PrivateKeyword,
      );
      const hasUnsupportedModifier = modifiers.some(
        (modifier) =>
          modifier.kind !== ts.SyntaxKind.PublicKeyword &&
          modifier.kind !== ts.SyntaxKind.ProtectedKeyword &&
          modifier.kind !== ts.SyntaxKind.PrivateKeyword,
      );
      if (
        hasUnsupportedModifier ||
        accessibilityModifiers.length > 1 ||
        member.questionToken ||
        member.exclamationToken
      ) {
        fail(
          member,
          'OEC9005',
          'compiled @property fields must be ordinary initialized instance fields',
        );
      }
      const decorators = ts.getDecorators(member) ?? [];
      if (decorators.length !== 1) {
        fail(member, 'OEC9005', 'compiled fields must carry exactly one @property decorator');
      }
      const decorator = decorators[0];
      const call = decorator.expression;
      if (!ts.isCallExpression(call)) {
        fail(
          decorator,
          'OEC9004',
          'unknown decorator on an OpenElement member; use only @property',
        );
      }
      const decoratorResolution = intrinsics.resolveIntrinsic(call.expression, 'property');
      if (!decoratorResolution.canonical) {
        if (decoratorResolution.unsupported) {
          fail(
            decorator,
            'OEC9027',
            `unsupported @property provenance: ${decoratorResolution.unsupported}`,
          );
        }
        fail(
          decorator,
          'OEC9004',
          'unknown decorator on an OpenElement member; use only @property imported from ' +
            "'@openelement/element'",
        );
      }
      if (!ts.isIdentifier(member.name)) {
        fail(member, 'OEC9005', 'property names must be identifiers');
      }
      if (names.has(member.name.text)) {
        fail(member, 'OEC9005', `duplicate property "${member.name.text}"`);
      }
      names.add(member.name.text);
      if (!member.initializer) {
        fail(member, 'OEC9005', 'compiled fields require a literal initializer');
      }
      // alpha.8: computed fields derive their signal from other properties.
      // They never carry attributes, never reflect, and hold no serialized
      // default (metadata default is null; the value comes from the factory).
      const computedFieldNames = new Set(fields.filter((f) => f.computed).map((f) => f.name));
      const computedInit = parseComputedInitializer(
        member.initializer,
        sf,
        intrinsics,
        new Set(fields.filter((f) => !f.computed).map((f) => f.name)),
        computedFieldNames,
        fail,
      );
      const trustedHtmlInit =
        !computedInit && isTrustedHtmlInitializer(member.initializer, intrinsics, fail);
      const defaultValue =
        computedInit || trustedHtmlInit ? null : literalValue(member.initializer, sf);
      if (defaultValue === undefined) {
        fail(member.initializer, 'OEC9020', 'property defaults must be serializable literals');
      }
      const options = call.arguments.length === 1 ? call.arguments[0] : undefined;
      if (!options || !ts.isObjectLiteralExpression(options)) {
        fail(decorator, 'OEC9005', '@property requires one options object literal');
      }
      let reflect = false;
      let attribute: string | null | undefined;
      let explicitType:
        | { label: PropertyValueType; constructorName: CompiledField['typeConstructor'] }
        | undefined;
      let explicitConverter: PropertyValueType | undefined;
      const optionNames = new Set<string>();
      for (const entry of options.properties) {
        if (!ts.isPropertyAssignment(entry) || entry.name.getText(sf).length === 0) {
          fail(entry, 'OEC9022', '@property options must be named literal assignments');
        }
        const optionName = entry.name.getText(sf);
        if (optionNames.has(optionName)) {
          fail(entry, 'OEC9022', `@property option "${optionName}" may appear only once`);
        }
        optionNames.add(optionName);
        if (optionName === 'reflect') {
          if (
            entry.initializer.kind !== ts.SyntaxKind.TrueKeyword &&
            entry.initializer.kind !== ts.SyntaxKind.FalseKeyword
          ) {
            fail(entry, 'OEC9005', '@property reflect must be a boolean literal');
          }
          reflect = entry.initializer.kind === ts.SyntaxKind.TrueKeyword;
          continue;
        }
        if (optionName === 'attribute') {
          if (entry.initializer.kind === ts.SyntaxKind.FalseKeyword) {
            attribute = null;
          } else if (ts.isStringLiteral(entry.initializer)) {
            attribute = camelToKebab(entry.initializer.text);
            if (!isSafeAttributeName(attribute)) {
              fail(entry, 'OEC9023', 'property attribute name is unsafe');
            }
          } else {
            fail(entry, 'OEC9023', 'property attribute must be a string literal or false');
          }
          continue;
        }
        if (optionName === 'type' || optionName === 'converter') {
          const type = propertyTypeFromConstructor(entry.initializer, sf, entry, fail);
          if (optionName === 'type') explicitType = type;
          else explicitConverter = type.label;
          continue;
        }
        fail(entry, 'OEC9022', `unsupported @property option "${optionName}"`);
      }
      const inferred = explicitType ?? inferPropertyType(member, defaultValue, sf);
      const converter = explicitConverter ?? inferred.label;
      if (attribute === undefined) attribute = camelToKebab(member.name.text);
      if (trustedHtmlInit) {
        if (inferred.label !== 'object' || attribute !== null || reflect) {
          fail(
            member,
            'OEC9026',
            'trustedHtml field defaults require type: Object, reflect: false, and attribute: false',
          );
        }
      }
      if (computedInit) {
        if (attribute !== null || reflect) {
          fail(
            member,
            'OEC9025',
            'computed fields require @property({ reflect: false, attribute: false }) — ' +
              'derived signals have no attribute channel',
          );
        }
      }
      if (attribute !== null) {
        const attributeKey = attribute.toLowerCase();
        if (propertyAttributeNames.has(attributeKey)) {
          fail(member, 'OEC9023', `duplicate property attribute "${attribute}"`);
        }
        propertyAttributeNames.add(attributeKey);
      }
      if (attribute === null && reflect) {
        fail(member, 'OEC9023', 'a property with attribute: false cannot reflect');
      }
      fields.push({
        name: member.name.text,
        reflect,
        attribute,
        type: inferred.label,
        converter,
        typeConstructor: inferred.constructorName,
        accessibility:
          accessibilityModifiers.length === 0
            ? ''
            : accessibilityModifiers[0].kind === ts.SyntaxKind.PublicKeyword
              ? 'public'
              : accessibilityModifiers[0].kind === ts.SyntaxKind.ProtectedKeyword
                ? 'protected'
                : 'private',
        typeText: member.type ? `: ${member.type.getText(sf)}` : '',
        initializerText: member.initializer.getText(sf),
        defaultValue,
        node: member,
        ...(computedInit ? { computed: computedInit } : {}),
      });
      continue;
    }
    if (ts.isMethodDeclaration(member)) {
      const modifiers = ts.getModifiers(member) ?? [];
      if (
        modifiers.some(
          (modifier) =>
            modifier.kind === ts.SyntaxKind.StaticKeyword ||
            modifier.kind === ts.SyntaxKind.AbstractKeyword ||
            modifier.kind === ts.SyntaxKind.DeclareKeyword ||
            modifier.kind === ts.SyntaxKind.AccessorKeyword,
        ) ||
        !member.body
      ) {
        fail(member, 'OEC9006', 'compiled methods must be concrete instance methods');
      }
      if ((ts.getDecorators(member) ?? []).length > 0) {
        fail(member, 'OEC9004', 'methods may not carry decorators in the compiler grammar');
      }
      if (member.parameters.some((parameter) => (ts.getDecorators(parameter) ?? []).length > 0)) {
        fail(
          member,
          'OEC9004',
          'method parameters may not carry decorators in the compiler grammar',
        );
      }
      if (!ts.isIdentifier(member.name)) {
        fail(member, 'OEC9006', 'method names must be identifiers');
      }
      if (member.name.text === 'render') {
        if (render) {
          fail(member, 'OEC9007', 'compiled classes may declare only one render() method');
        }
        if (
          member.parameters.length !== 0 ||
          modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
        ) {
          fail(member, 'OEC9007', 'render() must be a synchronous zero-argument method');
        }
        render = member;
      } else {
        methods.push(member);
      }
      continue;
    }
    fail(
      member,
      'OEC9006',
      'constructors, accessors and undecorated fields are outside the compiler grammar',
    );
  }
  if (!render) fail(classNode, 'OEC9007', 'compiled classes must declare render()');
  return { fields, methods, render, stylesText, stylesNode, stylesTypeText };
}

function isDeclareStatement(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword,
    )
  );
}

/**
 * The one extra runtime statement a compiled module may carry: the island
 * delivery policy colocated with the class
 * (`export const openElement = defineIslandConfig({ ... })`). The callee must
 * bind a static-sidecar descriptor the host injected through the compile
 * options (#1209); the default core knows none, so an unconfigured compiler
 * rejects the statement as OEC9008. A same-name spelling bound to anything
 * else is not the policy statement and falls through to the same rejection.
 * The statement is validated here and copied verbatim into the generated
 * module; the runtime factory validates the descriptor itself at module
 * evaluation. Anything else stays outside the compiled module grammar
 * (OEC9008).
 */
function isIslandConfigStatement(
  statement: ts.Statement,
  intrinsics: ModuleIntrinsicBindings,
): boolean {
  if (!ts.isVariableStatement(statement)) return false;
  const modifiers = ts.getModifiers(statement) ?? [];
  if (modifiers.length !== 1 || modifiers[0].kind !== ts.SyntaxKind.ExportKeyword) {
    return false;
  }
  const declarations = statement.declarationList.declarations;
  if (declarations.length !== 1) return false;
  const declaration = declarations[0];
  if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'openElement') {
    return false;
  }
  const initializer = declaration.initializer;
  if (!initializer || !ts.isCallExpression(initializer)) return false;
  if (!intrinsics.isStaticSidecarCallee(initializer.expression)) return false;
  if (
    initializer.arguments.length !== 1 ||
    !ts.isObjectLiteralExpression(initializer.arguments[0])
  ) {
    return false;
  }
  return true;
}

/** The `@element` root ownership mode (alpha.8). */
export type ElementRootKind = 'light' | 'shadow-open' | 'shadow-closed';

/** Everything the lowering and emission stages consume from one authored module. */
export interface AnalyzedModule {
  /** Runtime statements admitted as verbatim passthrough (the island policy). */
  passthroughStatements: ts.Statement[];
  /** The one decorated class. */
  classNode: ts.ClassDeclaration;
  /** The class's `@element(...)` decorator application. */
  decorator: ts.Decorator;
  /** The custom-element tag from the decorator's first argument. */
  tag: string;
  rootKind: ElementRootKind;
  delegatesFocus: boolean;
  formAssociated: boolean;
  /** True when the class is `export default class`. */
  isDefaultExport: boolean;
  /** The local name the canonical `OpenElement` base binding carries. */
  openElementLocalName: string;
  className: string;
  fields: CompiledField[];
  methods: ts.MethodDeclaration[];
  render: ts.MethodDeclaration;
  stylesText?: string;
  stylesNode?: ts.Expression;
  stylesTypeText?: string;
}

/**
 * Admit one parsed module to the compiled grammar and lift its shape
 * (#1473 split — moved verbatim from the compile facade): the top-level
 * statement admission (OEC9008 fail-closed, island policy passthrough), the
 * exactly-one-`@element`-class rule with its decorator options and canonical
 * heritage provenance, and the {@link propertyFields} inventory.
 */
export function analyzeCompiledModule(
  sf: ts.SourceFile,
  intrinsics: ModuleIntrinsicBindings,
  fail: CompilerFail,
): AnalyzedModule {
  const passthroughStatements: ts.Statement[] = [];
  for (const statement of sf.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isModuleDeclaration(statement) ||
      isDeclareStatement(statement)
    )
      continue;
    // alpha.8: the island delivery policy is the one runtime statement a
    // compiled module may carry; it is validated and copied verbatim below.
    if (isIslandConfigStatement(statement, intrinsics)) {
      passthroughStatements.push(statement);
      continue;
    }
    fail(
      statement,
      'OEC9008',
      'runtime top-level statements are outside the compiled module grammar',
    );
  }

  const classes = sf.statements.filter(ts.isClassDeclaration);
  const decorated = classes.filter((node) =>
    (ts.getDecorators(node) ?? []).some((decorator) => {
      const expr = decorator.expression;
      return (
        ts.isCallExpression(expr) &&
        intrinsics.resolveIntrinsic(expr.expression, 'element').canonical
      );
    }),
  );
  if (classes.length !== 1 || decorated.length !== 1) {
    // Unsupported/ambiguous provenance on an @element-spelled decorator fails
    // closed with its own diagnostic instead of the generic shape error.
    for (const node of classes) {
      for (const decorator of ts.getDecorators(node) ?? []) {
        const expr = decorator.expression;
        if (!ts.isCallExpression(expr)) continue;
        const resolution = intrinsics.resolveIntrinsic(expr.expression, 'element');
        if (resolution.unsupported) {
          fail(decorator, 'OEC9027', `unsupported @element provenance: ${resolution.unsupported}`);
        }
      }
    }
    fail(
      sf,
      'OEC9001',
      'expected exactly one @element(...) class per compiled module (the decorator must bind ' +
        "the canonical element import from '@openelement/element')",
    );
  }
  const classNode = decorated[0];
  const classDecorators = ts.getDecorators(classNode) ?? [];
  if (classDecorators.length !== 1) {
    fail(
      classNode,
      'OEC9004',
      'compiled OpenElement classes must carry exactly one @element decorator',
    );
  }
  const classModifiers = ts.getModifiers(classNode) ?? [];
  // alpha.8: the canonical route/island module default-exports its compiled
  // class, so `export default class` is admitted alongside `export class`.
  const isDefaultExport = classModifiers.some(
    (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
  );
  const modifiersValid = isDefaultExport
    ? classModifiers.length === 2 &&
      classModifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    : classModifiers.length === 1 && classModifiers[0].kind === ts.SyntaxKind.ExportKeyword;
  if (!modifiersValid) {
    fail(
      classNode,
      'OEC9006',
      'compiled @element classes must be exported (optionally as the default export) without other class modifiers',
    );
  }
  let tag = '';
  const decorator = classDecorators[0];
  const expr = decorator.expression;
  if (
    !ts.isCallExpression(expr) ||
    !intrinsics.resolveIntrinsic(expr.expression, 'element').canonical
  ) {
    fail(decorator, 'OEC9004', 'unknown decorator on an OpenElement class; use only @element');
  }
  if (
    expr.arguments.length < 1 ||
    expr.arguments.length > 2 ||
    !ts.isStringLiteral(expr.arguments[0])
  ) {
    fail(
      decorator,
      'OEC9002',
      '@element requires a string tag name plus an optional options object',
    );
  }
  tag = expr.arguments[0].text;
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(tag)) {
    fail(decorator, 'OEC9002', `@element tag "${tag}" is not a custom-element name`);
  }
  // alpha.8: `@element(tag, { root: 'light' | 'shadow-open' | 'shadow-closed' })`
  // selects the program root ownership mode (light content vs DSD). Pages and
  // DSD islands compile with a shadow root; the default stays light.
  // `delegatesFocus`/`formAssociated` boolean literals emit the matching class
  // statics the facade kernel consumes (shadow attach options and
  // ElementInternals association).
  let rootKind: ElementRootKind = 'light';
  let delegatesFocus = false;
  let formAssociated = false;
  if (expr.arguments.length === 2) {
    const options = expr.arguments[1];
    if (!ts.isObjectLiteralExpression(options)) {
      fail(decorator, 'OEC9002', '@element options must be an object literal');
    }
    const seenOptions = new Set<string>();
    for (const entry of options.properties) {
      if (!ts.isPropertyAssignment(entry)) {
        fail(entry, 'OEC9002', '@element options must be named literal assignments');
      }
      const optionName = entry.name.getText(sf);
      if (seenOptions.has(optionName)) {
        fail(entry, 'OEC9002', `@element option "${optionName}" may appear only once`);
      }
      seenOptions.add(optionName);
      if (optionName === 'root') {
        if (!ts.isStringLiteral(entry.initializer)) {
          fail(entry, 'OEC9002', '@element root must be a string literal');
        }
        const mode = entry.initializer.text;
        if (mode !== 'light' && mode !== 'shadow-open' && mode !== 'shadow-closed') {
          fail(
            entry,
            'OEC9002',
            `@element root "${mode}" is unsupported; use "light", "shadow-open" or "shadow-closed"`,
          );
        }
        rootKind = mode;
        continue;
      }
      if (optionName === 'delegatesFocus' || optionName === 'formAssociated') {
        if (
          entry.initializer.kind !== ts.SyntaxKind.TrueKeyword &&
          entry.initializer.kind !== ts.SyntaxKind.FalseKeyword
        ) {
          fail(entry, 'OEC9002', `@element ${optionName} must be a boolean literal`);
        }
        const value = entry.initializer.kind === ts.SyntaxKind.TrueKeyword;
        if (optionName === 'delegatesFocus') delegatesFocus = value;
        else formAssociated = value;
        continue;
      }
      fail(
        entry,
        'OEC9002',
        '@element options support only root, delegatesFocus and formAssociated',
      );
    }
  }
  const heritage = classNode.heritageClauses?.find(
    (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
  );
  // Provenance (#1209): the base class must bind the canonical OpenElement
  // import (aliases followed); a same-name local class, a foreign import or a
  // namespace-qualified reference never enters the grammar.
  const heritageExpression =
    heritage?.types.length === 1 ? unwrapExpression(heritage.types[0].expression) : undefined;
  const heritageResolution = heritageExpression
    ? intrinsics.resolveIntrinsic(heritageExpression, 'OpenElement')
    : undefined;
  if (!heritageResolution?.canonical) {
    fail(
      classNode.name ?? classNode,
      'OEC9003',
      `compiled classes must extend the canonical OpenElement import from '@openelement/element' ` +
        `(found ${heritage?.types[0]?.expression.getText(sf) ?? 'no base class'}` +
        (heritageResolution?.unsupported ? `; ${heritageResolution.unsupported}` : '') +
        ')',
    );
  }
  const openElementLocalName = heritageResolution.localName!;
  if (!classNode.name) fail(classNode, 'OEC9003', 'compiled classes must be named');
  const className = classNode.name.text;
  const { fields, methods, render, stylesText, stylesNode, stylesTypeText } = propertyFields(
    sf,
    classNode,
    intrinsics,
    fail,
  );
  return {
    passthroughStatements,
    classNode,
    decorator,
    tag,
    rootKind,
    delegatesFocus,
    formAssociated,
    isDefaultExport,
    openElementLocalName,
    className,
    fields,
    methods,
    render,
    stylesText,
    stylesNode,
    stylesTypeText,
  };
}
