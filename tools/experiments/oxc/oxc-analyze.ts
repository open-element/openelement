// tools/experiments/oxc/oxc-analyze.ts
//
// Minimal oxc-parser (ESTree) frontend for the OE compiled-element grammar — a
// feasibility probe for issue #1156, NOT a compiler port. It answers, per
// sample module, the same questions the TS-frontend semantic core answers:
//   - accept/reject with OEC9xxx-category diagnostics at UTF-16 spans
//   - the intrinsic-binding provenance facts (module-analysis equivalence)
//   - on accept: the same Part identity skeleton (parts/regions/locations/
//     source records/property metadata) the semantic core produces.
//
// Coordinate contract: oxc-parser 0.149.0 emits UTF-16 code-unit offsets only
// (no loc). Line/character are derived here with the SAME line-break table the
// TypeScript scanner uses (\n, \r\n, \r, ‹U+2028, U+2029), so coordinates are
// directly comparable to ts.SourceFile.getLineAndCharacterOfPosition.

import { parseSync } from 'npm:oxc-parser@0.149.0';

/** Loose structural view over the ESTree AST (all nodes carry type/start/end). */
export interface OxcNode {
  type: string;
  start: number;
  end: number;
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

export interface MiniDiagnostic {
  code: string;
  message: string;
  file: string;
  line: number;
  character: number;
  start: number;
  end: number;
}

export class MiniCompileError extends Error {
  readonly diagnostics: MiniDiagnostic[];
  constructor(diagnostic: MiniDiagnostic) {
    super(
      `${diagnostic.file}:${diagnostic.line}:${diagnostic.character} - error ` +
        `${diagnostic.code}: ${diagnostic.message}`,
    );
    this.name = 'CompiledElementError';
    this.diagnostics = [diagnostic];
  }
}

export interface SourceSpan {
  file: string;
  start: { offset: number; line: number; column: number };
  end: { offset: number; line: number; column: number };
}

export interface MiniProgram {
  tag: string;
  root: { id: string; kind: string; nodes: string[] };
  template: unknown[];
  parts: unknown[];
  regions: unknown[];
  dependencies: unknown[];
  locations: unknown[];
  sourceRecords: Array<{ id: string; kind: string; source: SourceSpan }>;
  properties: unknown[];
  observedAttributes: string[];
}

export interface MiniModuleFacts {
  compiledElementDecorator: boolean;
  unsupportedElementDecorator?: string;
  definedCustomElementTags: string[];
}

const INTRINSIC_MODULES: Record<string, string[]> = {
  element: ['@openelement/element'],
  property: ['@openelement/element'],
  OpenElement: ['@openelement/element'],
  computed: ['@openelement/element'],
  trustedHtml: ['@openelement/element'],
  defineIslandConfig: ['@openelement/app'],
};

const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'formnovalidate',
  'hidden',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
]);

const DOM_PROPERTY_NAMES = new Set([
  'checked',
  'files',
  'indeterminate',
  'readOnly',
  'scrollLeft',
  'scrollTop',
  'selected',
  'value',
]);

function camelToKebab(value: string): string {
  return value.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function isSafeAttributeName(value: string): boolean {
  return /^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(value) && !/^on/i.test(value);
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

// TS isLineBreak: \n, \r\n (one break), \r, U+2028, U+2029.
function computeLineStarts(text: string): number[] {
  const starts = [0];
  let i = 0;
  while (i < text.length) {
    const ch = text.charCodeAt(i);
    if (ch === 13) {
      if (text.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    } else if (ch === 10 || ch === 0x2028 || ch === 0x2029) {
      starts.push(i + 1);
    }
    i++;
  }
  return starts;
}

function lineAndChar(lineStarts: number[], pos: number): { line: number; character: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: pos - lineStarts[lo] };
}

/** ESTree wraps exported declarations; TS AST attaches modifiers instead. */
function exportedDeclaration(stmt: OxcNode): OxcNode | null {
  if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
    return (stmt.declaration as OxcNode | null) ?? null;
  }
  return stmt;
}

interface ImportBinding {
  form: 'named' | 'namespace' | 'default';
  module: string;
  imported: string;
  typeOnly: boolean;
}

interface IntrinsicResolution {
  canonical: boolean;
  localName?: string;
  unsupported?: string;
}

function describeBinding(binding: ImportBinding): string {
  if (binding.form === 'namespace') return `namespace import of '${binding.module}'`;
  if (binding.form === 'default') return `default import of '${binding.module}'`;
  return `import of ${binding.imported} from '${binding.module}'`;
}

/** Port of createModuleIntrinsicBindings (module-analysis.ts) onto the ESTree AST. */
function buildIntrinsics(body: OxcNode[]) {
  const imports = new Map<string, ImportBinding[]>();
  const locals = new Set<string>();
  const add = (local: string, binding: ImportBinding): void => {
    const list = imports.get(local) ?? [];
    list.push(binding);
    imports.set(local, list);
  };
  for (const stmt of body) {
    if (stmt.type === 'ImportDeclaration') {
      const module = String(stmt.source.value);
      const clauseTypeOnly = stmt.importKind === 'type';
      for (const spec of stmt.specifiers as OxcNode[]) {
        const local = String((spec.local as OxcNode).name);
        if (spec.type === 'ImportDefaultSpecifier') {
          add(local, { form: 'default', module, imported: 'default', typeOnly: clauseTypeOnly });
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          add(local, { form: 'namespace', module, imported: '*', typeOnly: clauseTypeOnly });
        } else if (spec.type === 'ImportSpecifier') {
          const imported = (spec.imported as OxcNode).name ?? (spec.imported as OxcNode).value;
          add(local, {
            form: 'named',
            module,
            imported: String(imported),
            typeOnly: clauseTypeOnly || spec.importKind === 'type',
          });
        }
      }
      continue;
    }
    const decl = exportedDeclaration(stmt);
    if (!decl) continue;
    const isValueDecl = decl.type === 'FunctionDeclaration' ||
      decl.type === 'ClassDeclaration' || decl.type === 'TSEnumDeclaration';
    if (isValueDecl && decl.id) {
      locals.add(String((decl.id as OxcNode).name));
      continue;
    }
    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations as OxcNode[]) {
        if ((d.id as OxcNode).type === 'Identifier') locals.add(String((d.id as OxcNode).name));
      }
    }
  }
  const resolveIdentifier = (name: string, intrinsic: string): IntrinsicResolution => {
    const modules = INTRINSIC_MODULES[intrinsic];
    if (locals.has(name)) return { canonical: false };
    const bindings = imports.get(name) ?? [];
    if (bindings.length === 0) return { canonical: false };
    if (bindings.length > 1) {
      const detail = bindings.map(describeBinding).join('; ');
      return {
        canonical: false,
        unsupported: `conflicting module-scope bindings for "${name}" (${detail}); ` +
          `import ${intrinsic} once from its canonical module '${modules.join("' or '")}'`,
      };
    }
    const binding = bindings[0];
    if (binding.form !== 'named') {
      if (modules.includes(binding.module)) {
        return {
          canonical: false,
          unsupported: `"${name}" is a ${
            describeBinding(binding)
          }; ${intrinsic} requires a runtime named import`,
        };
      }
      return { canonical: false };
    }
    if (modules.includes(binding.module)) {
      if (binding.imported !== intrinsic) return { canonical: false };
      if (binding.typeOnly) {
        return {
          canonical: false,
          unsupported:
            `"${name}" is a type-only import of ${intrinsic} from '${binding.module}'; ` +
            'intrinsics are runtime named imports',
        };
      }
      return { canonical: true, localName: name };
    }
    if (binding.imported === intrinsic && binding.module.startsWith('.')) {
      return {
        canonical: false,
        unsupported: `"${name}" imports ${intrinsic} from '${binding.module}'; re-export ` +
          'provenance is not resolved across modules — import ' +
          `${intrinsic} from its canonical module '${modules.join("' or '")}'`,
      };
    }
    return { canonical: false };
  };
  const resolveIntrinsic = (expr: OxcNode, intrinsic: string): IntrinsicResolution => {
    if (expr.type === 'Identifier') return resolveIdentifier(String(expr.name), intrinsic);
    const object = expr.object as OxcNode | undefined;
    const property = expr.property as OxcNode | undefined;
    const isQualified = expr.type === 'MemberExpression' && !expr.computed &&
      object?.type === 'Identifier' && property?.type === 'Identifier' &&
      String(property.name) === intrinsic;
    if (isQualified && object) {
      const namespace = String(object.name);
      const bindings = imports.get(namespace) ?? [];
      const sole = bindings.length === 1 ? bindings[0] : undefined;
      if (
        !locals.has(namespace) && sole?.form === 'namespace' &&
        INTRINSIC_MODULES[intrinsic].includes(sole.module)
      ) {
        return {
          canonical: false,
          unsupported:
            `namespace-qualified intrinsic "${namespace}.${intrinsic}" is unsupported; ` +
            `import ${intrinsic} from '${sole.module}' by name`,
        };
      }
    }
    return { canonical: false };
  };
  return { resolveIntrinsic, imports, locals };
}

/** Subset of analyzeModuleSemantics: @element admission facts only. */
export function oxcModuleFacts(source: string, fileName: string): MiniModuleFacts {
  const result = parseSync(fileName, source, { sourceType: 'module' });
  const program = result.program as unknown as OxcNode;
  const body = program.body as OxcNode[];
  const { resolveIntrinsic } = buildIntrinsics(body);
  let compiledElementDecorator = false;
  let unsupportedElementDecorator: string | undefined;
  const defined: string[] = [];
  for (const stmt of body) {
    const decl = exportedDeclaration(stmt);
    if (!decl || decl.type !== 'ClassDeclaration') continue;
    for (const decorator of (decl.decorators ?? []) as OxcNode[]) {
      const expr = decorator.expression as OxcNode;
      if (expr.type !== 'CallExpression') continue;
      // Mirror module-analysis.ts: the provenance sentence comes from resolveIntrinsic.
      const resolution = resolveIntrinsic(expr.callee as OxcNode, 'element');
      if (!resolution.canonical) {
        if (resolution.unsupported && unsupportedElementDecorator === undefined) {
          unsupportedElementDecorator = resolution.unsupported;
        }
        continue;
      }
      compiledElementDecorator = true;
      const arg = (expr.arguments as OxcNode[])[0];
      if (
        arg?.type === 'Literal' && typeof arg.value === 'string' &&
        /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(arg.value)
      ) {
        defined.push(arg.value);
      }
    }
  }
  return {
    compiledElementDecorator,
    ...(unsupportedElementDecorator === undefined ? {} : { unsupportedElementDecorator }),
    definedCustomElementTags: defined.sort(),
  };
}

/** Minimal compile: accept/reject + Part skeleton, mirroring compileElementProgram. */
export function oxcAnalyze(source: string, fileName: string): MiniProgram {
  const result = parseSync(fileName, source, { sourceType: 'module' });
  const lineStarts = computeLineStarts(source);
  const lc = (pos: number) => lineAndChar(lineStarts, pos);
  const diagnosticAt = (
    node: { start: number; end: number },
    code: string,
    message: string,
  ): MiniDiagnostic => ({
    code,
    message,
    file: fileName,
    line: lc(node.start).line + 1,
    character: lc(node.start).character + 1,
    start: node.start,
    end: node.end,
  });
  const fail = (node: { start: number; end: number }, code: string, message: string): never => {
    throw new MiniCompileError(diagnosticAt(node, code, message));
  };
  const text = (node: { start: number; end: number }): string => source.slice(node.start, node.end);
  const sourceRange = (node: { start: number; end: number }): SourceSpan => ({
    file: fileName,
    start: {
      offset: node.start,
      line: lc(node.start).line + 1,
      column: lc(node.start).character + 1,
    },
    end: {
      offset: node.end,
      line: lc(node.end).line + 1,
      column: lc(node.end).character + 1,
    },
  });

  // Syntax gate ~ ts.transpileModule diagnostics → OEC9000 (first error, first label).
  if (result.errors.length > 0) {
    const first = result.errors[0];
    const label = first.labels[0] ?? { start: 0, end: 0 };
    throw new MiniCompileError({
      code: 'OEC9000',
      message: first.message,
      file: fileName,
      line: lc(label.start).line + 1,
      character: lc(label.start).character + 1,
      start: label.start,
      end: label.end,
    });
  }

  const program = result.program as unknown as OxcNode;
  const body = program.body as OxcNode[];
  const { resolveIntrinsic } = buildIntrinsics(body);

  const unwrap = (expr: OxcNode): OxcNode => {
    let current = expr;
    while (
      current.type === 'ParenthesizedExpression' || current.type === 'TSAsExpression' ||
      current.type === 'TSTypeAssertion'
    ) {
      current = current.expression as OxcNode;
    }
    return current;
  };
  type Lit = string | number | boolean | null | Lit[] | { [key: string]: Lit };
  const literalValue = (expr: OxcNode): Lit | undefined => {
    const value = unwrap(expr);
    if (value.type === 'Literal') {
      const v = value.value as string | number | boolean | null;
      if (typeof v === 'string' || typeof v === 'boolean' || v === null) return v;
      if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
      return undefined;
    }
    if (
      value.type === 'TemplateLiteral' && (value.expressions as unknown[]).length === 0 &&
      (value.quasis as OxcNode[]).length === 1
    ) {
      return String((value.quasis as OxcNode[])[0].value.cooked);
    }
    if (value.type === 'UnaryExpression' && value.operator === '-' && value.prefix) {
      const operand = value.argument as OxcNode;
      if (operand.type === 'Literal' && typeof operand.value === 'number') {
        const n = -operand.value;
        return Number.isFinite(n) ? n : undefined;
      }
      return undefined;
    }
    if (value.type === 'ArrayExpression') {
      const entries: Lit[] = [];
      for (const element of value.elements as (OxcNode | null)[]) {
        if (!element || element.type === 'SpreadElement') return undefined;
        const entry = literalValue(element);
        if (entry === undefined) return undefined;
        entries.push(entry);
      }
      return entries;
    }
    if (value.type === 'ObjectExpression') {
      const object: { [key: string]: Lit } = {};
      for (const property of value.properties as OxcNode[]) {
        if (property.type !== 'Property' || property.computed || property.kind !== 'init') {
          return undefined;
        }
        const keyNode = property.key as OxcNode;
        const isKey = keyNode.type === 'Identifier' ||
          (keyNode.type === 'Literal' &&
            (typeof keyNode.value === 'string' || typeof keyNode.value === 'number'));
        const key = isKey ? String(keyNode.name ?? keyNode.value) : undefined;
        if (key === undefined || key === '__proto__') return undefined;
        const entry = literalValue(property.value as OxcNode);
        if (entry === undefined) return undefined;
        object[key] = entry;
      }
      return object;
    }
    return undefined;
  };
  const primitiveText = (value: Lit): string | null => {
    if (value === null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return null;
  };

  // ---- module-level admission (OEC9008) ----
  const classes: Array<{ node: OxcNode; wrapper: OxcNode }> = [];
  for (const stmt of body) {
    const decl = exportedDeclaration(stmt);
    if (!decl) {
      fail(stmt, 'OEC9008', 'runtime top-level statements are outside the compiled module grammar');
    }
    if (decl.type === 'ClassDeclaration') {
      classes.push({ node: decl, wrapper: stmt });
      continue;
    }
    const admitted = decl.type === 'ImportDeclaration' || decl.type === 'TSInterfaceDeclaration' ||
      decl.type === 'TSTypeAliasDeclaration' || decl.type === 'TSModuleDeclaration' ||
      decl.declare === true;
    if (admitted) continue;
    fail(stmt, 'OEC9008', 'runtime top-level statements are outside the compiled module grammar');
  }

  const decoratorsOf = (node: OxcNode): OxcNode[] => (node.decorators ?? []) as OxcNode[];
  const decorated = classes.filter(({ node }) =>
    decoratorsOf(node).some((decorator) => {
      const expr = decorator.expression as OxcNode;
      return expr.type === 'CallExpression' &&
        resolveIntrinsic(expr.callee as OxcNode, 'element').canonical;
    })
  );
  if (classes.length !== 1 || decorated.length !== 1) {
    for (const { node } of classes) {
      for (const decorator of decoratorsOf(node)) {
        const expr = decorator.expression as OxcNode;
        if (expr.type !== 'CallExpression') continue;
        const resolution = resolveIntrinsic(expr.callee as OxcNode, 'element');
        if (resolution.unsupported) {
          fail(decorator, 'OEC9027', `unsupported @element provenance: ${resolution.unsupported}`);
        }
      }
    }
    fail(
      { start: program.start, end: program.end },
      'OEC9001',
      'expected exactly one @element(...) class per compiled module (the decorator must bind ' +
        "the canonical element import from '@openelement/element')",
    );
  }
  const { node: classNode, wrapper } = decorated[0];
  const classDecorators = decoratorsOf(classNode);
  if (classDecorators.length !== 1) {
    fail(
      classNode,
      'OEC9004',
      'compiled OpenElement classes must carry exactly one @element decorator',
    );
  }
  // TS requires exactly [export] or [export, default]; ESTree encodes via the wrapper.
  const exportOk = wrapper.type === 'ExportNamedDeclaration' ||
    wrapper.type === 'ExportDefaultDeclaration';
  if (!exportOk || classNode.abstract) {
    fail(
      classNode,
      'OEC9006',
      'compiled @element classes must be exported (optionally as the default export) ' +
        'without other class modifiers',
    );
  }
  const decorator = classDecorators[0];
  const dexpr = decorator.expression as OxcNode;
  if (
    dexpr.type !== 'CallExpression' ||
    !resolveIntrinsic(dexpr.callee as OxcNode, 'element').canonical
  ) {
    fail(decorator, 'OEC9004', 'unknown decorator on an OpenElement class; use only @element');
  }
  const dargs = dexpr.arguments as OxcNode[];
  if (
    dargs.length < 1 || dargs.length > 2 || dargs[0].type !== 'Literal' ||
    typeof dargs[0].value !== 'string'
  ) {
    fail(
      decorator,
      'OEC9002',
      '@element requires a string tag name plus an optional options object',
    );
  }
  const tag = String(dargs[0].value);
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(tag)) {
    fail(decorator, 'OEC9002', `@element tag "${tag}" is not a custom-element name`);
  }
  if (dargs.length === 2) {
    const options = dargs[1];
    if (options.type !== 'ObjectExpression') {
      fail(decorator, 'OEC9002', '@element options must be an object literal');
    }
    for (const entry of options.properties as OxcNode[]) {
      if (entry.type !== 'Property') {
        fail(entry, 'OEC9002', '@element options must be named literal assignments');
      }
      const keyNode = entry.key as OxcNode;
      const name = keyNode.type === 'Identifier' ? String(keyNode.name) : String(keyNode.value);
      if (name === 'root') {
        if (entry.value.type !== 'Literal' || typeof entry.value.value !== 'string') {
          fail(entry, 'OEC9002', '@element root must be a string literal');
        }
        if (!['light', 'shadow-open', 'shadow-closed'].includes(String(entry.value.value))) {
          fail(
            entry,
            'OEC9002',
            `@element root "${entry.value.value}" is unsupported; ` +
              'use "light", "shadow-open" or "shadow-closed"',
          );
        }
      } else if (name === 'delegatesFocus' || name === 'formAssociated') {
        if (entry.value.type !== 'Literal' || typeof entry.value.value !== 'boolean') {
          fail(entry, 'OEC9002', `@element ${name} must be a boolean literal`);
        }
      } else {
        fail(
          entry,
          'OEC9002',
          '@element options support only root, delegatesFocus and formAssociated',
        );
      }
    }
  }
  // Heritage: superClass must bind the canonical OpenElement import.
  const heritage = classNode.superClass ? unwrap(classNode.superClass as OxcNode) : undefined;
  const heritageResolution = heritage ? resolveIntrinsic(heritage, 'OpenElement') : undefined;
  if (!heritageResolution?.canonical) {
    const found = heritage ? text(classNode.superClass as OxcNode) : 'no base class';
    const suffix = heritageResolution?.unsupported ? `; ${heritageResolution.unsupported}` : '';
    fail(
      (classNode.id ?? classNode) as OxcNode,
      'OEC9003',
      `compiled classes must extend the canonical OpenElement import from '@openelement/element' ` +
        `(found ${found}${suffix})`,
    );
  }
  if (!classNode.id) fail(classNode, 'OEC9003', 'compiled classes must be named');

  // ---- fields & methods (subset of propertyFields) ----
  interface Field {
    name: string;
    reflect: boolean;
    attribute: string | null;
    type: string;
    converter: string;
    defaultValue: Lit;
    node: OxcNode;
  }
  const fields: Field[] = [];
  const methods: OxcNode[] = [];
  let render: OxcNode | null = null;
  const names = new Set<string>();
  const propertyAttributeNames = new Set<string>();
  for (const member of classNode.body.body as OxcNode[]) {
    if (member.type === 'PropertyDefinition' || member.type === 'AccessorProperty') {
      const isStaticStyles = member.static === true &&
        (member.key as OxcNode).type === 'Identifier' &&
        String((member.key as OxcNode).name) === 'styles' && decoratorsOf(member).length === 0 &&
        member.type === 'PropertyDefinition';
      if (isStaticStyles) {
        if (!member.value) fail(member, 'OEC9005', 'static styles requires an initializer');
        continue;
      }
      const unsupportedMember = member.declare || member.override || member.readonly ||
        member.type === 'AccessorProperty' || member.optional || member.definite;
      if (unsupportedMember) {
        fail(
          member,
          'OEC9005',
          'compiled @property fields must be ordinary initialized instance fields',
        );
      }
      const decorators = decoratorsOf(member);
      if (decorators.length !== 1) {
        fail(member, 'OEC9005', 'compiled fields must carry exactly one @property decorator');
      }
      const dec = decorators[0];
      const call = dec.expression as OxcNode;
      if (call.type !== 'CallExpression') {
        fail(dec, 'OEC9004', 'unknown decorator on an OpenElement member; use only @property');
      }
      const decResolution = resolveIntrinsic(call.callee as OxcNode, 'property');
      if (!decResolution.canonical) {
        if (decResolution.unsupported) {
          fail(dec, 'OEC9027', `unsupported @property provenance: ${decResolution.unsupported}`);
        }
        fail(
          dec,
          'OEC9004',
          'unknown decorator on an OpenElement member; use only @property imported from ' +
            "'@openelement/element'",
        );
      }
      if ((member.key as OxcNode).type !== 'Identifier' || member.computed) {
        fail(member, 'OEC9005', 'property names must be identifiers');
      }
      const fieldName = String((member.key as OxcNode).name);
      if (names.has(fieldName)) fail(member, 'OEC9005', `duplicate property "${fieldName}"`);
      names.add(fieldName);
      if (!member.value) fail(member, 'OEC9005', 'compiled fields require a literal initializer');
      const defaultValue = literalValue(member.value as OxcNode);
      if (defaultValue === undefined) {
        fail(member.value as OxcNode, 'OEC9020', 'property defaults must be serializable literals');
      }
      const callArgs = call.arguments as OxcNode[];
      const options = callArgs.length === 1 ? callArgs[0] : undefined;
      if (!options || options.type !== 'ObjectExpression') {
        fail(dec, 'OEC9005', '@property requires one options object literal');
      }
      let reflect = false;
      let attribute: string | null | undefined;
      let explicitType: string | undefined;
      const optionNames = new Set<string>();
      for (const entry of options.properties as OxcNode[]) {
        if (entry.type !== 'Property' || entry.computed) {
          fail(entry, 'OEC9022', '@property options must be named literal assignments');
        }
        const entryKey = entry.key as OxcNode;
        const optionName = entryKey.type === 'Identifier' ? String(entryKey.name) : text(entryKey);
        if (optionName.length === 0) {
          fail(entry, 'OEC9022', '@property options must be named literal assignments');
        }
        if (optionNames.has(optionName)) {
          fail(entry, 'OEC9022', `@property option "${optionName}" may appear only once`);
        }
        optionNames.add(optionName);
        if (optionName === 'reflect') {
          if (entry.value.type !== 'Literal' || typeof entry.value.value !== 'boolean') {
            fail(entry, 'OEC9005', '@property reflect must be a boolean literal');
          }
          reflect = Boolean(entry.value.value);
          continue;
        }
        if (optionName === 'attribute') {
          if (entry.value.type === 'Literal' && entry.value.value === false) {
            attribute = null;
          } else if (entry.value.type === 'Literal' && typeof entry.value.value === 'string') {
            attribute = camelToKebab(String(entry.value.value));
            if (!isSafeAttributeName(attribute)) {
              fail(entry, 'OEC9023', 'property attribute name is unsafe');
            }
          } else {
            fail(entry, 'OEC9023', 'property attribute must be a string literal or false');
          }
          continue;
        }
        if (optionName === 'type' || optionName === 'converter') {
          const ctor = unwrap(entry.value as OxcNode);
          const ctorName = ctor.type === 'Identifier'
            ? String(ctor.name)
            : text(entry.value as OxcNode);
          if (!['String', 'Number', 'Boolean', 'Array', 'Object'].includes(ctorName)) {
            fail(
              entry,
              'OEC9021',
              'property type/converter must be one of String, Number, Boolean, Array or Object',
            );
          }
          if (optionName === 'type') explicitType = ctorName;
          continue;
        }
        fail(entry, 'OEC9022', `unsupported @property option "${optionName}"`);
      }
      let typeLabel: string;
      if (explicitType) {
        typeLabel = explicitType.toLowerCase();
      } else {
        const annotation = member.typeAnnotation?.typeAnnotation as OxcNode | undefined;
        const typeText = (annotation ? text(annotation) : '').replace(/[\s?]/g, '');
        if (typeText === 'string' || typeText === 'String') {
          typeLabel = 'string';
        } else if (typeText === 'number' || typeText === 'Number') {
          typeLabel = 'number';
        } else if (typeText === 'boolean' || typeText === 'Boolean') {
          typeLabel = 'boolean';
        } else if (/^(Array|ReadonlyArray|Set)</.test(typeText) || typeText.endsWith('[]')) {
          typeLabel = 'array';
        } else if (/^(Record|Map|Object)</.test(typeText)) {
          typeLabel = 'object';
        } else if (Array.isArray(defaultValue)) {
          typeLabel = 'array';
        } else if (defaultValue !== null && typeof defaultValue === 'object') {
          typeLabel = 'object';
        } else if (typeof defaultValue === 'number') {
          typeLabel = 'number';
        } else if (typeof defaultValue === 'boolean') {
          typeLabel = 'boolean';
        } else {
          typeLabel = 'string';
        }
      }
      if (attribute === undefined) attribute = camelToKebab(fieldName);
      if (attribute !== null) {
        const key = attribute.toLowerCase();
        if (propertyAttributeNames.has(key)) {
          fail(member, 'OEC9023', `duplicate property attribute "${attribute}"`);
        }
        propertyAttributeNames.add(key);
      }
      if (attribute === null && reflect) {
        fail(member, 'OEC9023', 'a property with attribute: false cannot reflect');
      }
      fields.push({
        name: fieldName,
        reflect,
        attribute,
        type: typeLabel,
        converter: typeLabel,
        defaultValue,
        node: member,
      });
      continue;
    }
    if (member.type === 'MethodDefinition') {
      const badModifier = member.static || member.kind === 'get' || member.kind === 'set';
      if (badModifier || !(member.value as OxcNode).body) {
        fail(member, 'OEC9006', 'compiled methods must be concrete instance methods');
      }
      if (decoratorsOf(member).length > 0) {
        fail(member, 'OEC9004', 'methods may not carry decorators in the compiler grammar');
      }
      if ((member.key as OxcNode).type !== 'Identifier') {
        fail(member, 'OEC9006', 'method names must be identifiers');
      }
      if (String((member.key as OxcNode).name) === 'render') {
        if (render) {
          fail(member, 'OEC9007', 'compiled classes may declare only one render() method');
        }
        if ((member.value as OxcNode).params.length !== 0 || (member.value as OxcNode).async) {
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

  const fieldNames = new Set(fields.map((field) => field.name));
  const methodNames = new Set(methods.map((method) => String((method.key as OxcNode).name)));

  // ---- lowering ----
  const parts: unknown[] = [];
  const regions: unknown[] = [];
  const dependencies: unknown[] = [];
  const locations: unknown[] = [];
  const sourceRecords: MiniProgram['sourceRecords'] = [];
  let elementSerial = 0;
  const addSource = (id: string, kind: string, node: OxcNode): void => {
    if (sourceRecords.some((record) => record.id === id)) return;
    sourceRecords.push({ id, kind, source: sourceRange(node) });
  };
  const addPart = (
    part: Record<string, unknown> & { k: string },
    pathArr: number[],
    node: OxcNode,
    targetNode?: string,
  ): number => {
    const index = parts.length;
    const isAnchor = part.k === 'text' || part.k === 'when' || part.k === 'each';
    const location = {
      id: `p${index}`,
      kind: isAnchor ? 'anchor' : 'sink',
      path: [...pathArr],
      ...(targetNode ? { node: targetNode } : {}),
    };
    parts.push({ ...part, index, location });
    if (isAnchor) {
      locations.push({ id: `p${index}`, kind: 'anchor', part: index, path: [...pathArr] });
    } else {
      locations.push({
        id: `p${index}`,
        kind: 'sink',
        part: index,
        node: targetNode,
        path: [...pathArr],
      });
    }
    addSource(`p${index}`, part.k === 'when' || part.k === 'each' ? 'region' : 'part', node);
    if (part.k === 'when' || part.k === 'each') {
      regions.push({
        id: `r${index}`,
        index,
        kind: part.k,
        anchor: `p${index}`,
        end: `p${index}:end`,
        source: `p${index}`,
      });
      addSource(`r${index}`, 'region', node);
    }
    const carriesSignal = ['text', 'prop', 'attr', 'bool', 'class', 'style', 'html', 'when', 'each']
      .includes(part.k);
    if (carriesSignal) {
      dependencies.push({
        signal: part.signal,
        owner: { kind: part.k === 'when' || part.k === 'each' ? 'region' : 'part', index },
        location: `p${index}`,
      });
    }
    return index;
  };
  const thisAccess = (expr: OxcNode, names: Set<string>): string | null => {
    const value = unwrap(expr);
    const object = value.object as OxcNode | undefined;
    const property = value.property as OxcNode | undefined;
    const matches = value.type === 'MemberExpression' && !value.computed &&
      object?.type === 'ThisExpression' && property?.type === 'Identifier' &&
      names.has(String(property.name));
    return matches ? String(property!.name) : null;
  };
  const fieldAccess = (expr: OxcNode): string | null => thisAccess(expr, fieldNames);
  const methodAccess = (expr: OxcNode): string | null => thisAccess(expr, methodNames);
  const jsxName = (node: OxcNode): string => {
    return node.type === 'JSXIdentifier' ? String(node.name) : text(node);
  };

  const generatedHandlers: Array<{ name: string; action: unknown; node: OxcNode }> = [];
  const parseEventMutation = (expr: OxcNode, near: OxcNode): Record<string, unknown> => {
    const value = unwrap(expr);
    if (value.type === 'UpdateExpression') {
      const signal = fieldAccess(value.argument as OxcNode);
      if (!signal || (value.operator !== '++' && value.operator !== '--')) {
        fail(near, 'OEC9016', 'event mutations support only this.<number>++ or --');
      }
      return { kind: value.operator === '++' ? 'increment' : 'decrement', signal };
    }
    if (value.type === 'AssignmentExpression') {
      const signal = fieldAccess(value.left as OxcNode);
      const literal = literalValue(value.right as OxcNode);
      if (!signal || literal === undefined) {
        fail(near, 'OEC9016', 'event assignment values must be serializable literals');
      }
      if (value.operator === '=') return { kind: 'assign', signal, value: literal };
      if ((value.operator === '+=' || value.operator === '-=') && typeof literal === 'number') {
        return { kind: value.operator === '+=' ? 'add' : 'subtract', signal, value: literal };
      }
      fail(near, 'OEC9016', 'event arithmetic supports only numeric += or -= literals');
    }
    if (value.type === 'CallExpression' && (value.arguments as unknown[]).length === 0) {
      const method = methodAccess(value.callee as OxcNode);
      if (method) return { kind: 'call', name: method };
    }
    fail(
      near,
      'OEC9016',
      'unsupported event action; use this.<field>++, assignment or this.<method>()',
    );
  };
  const eventAction = (
    expr: OxcNode,
    sourceNode: OxcNode,
  ): { handler: string; action: unknown } => {
    const method = methodAccess(expr);
    if (method) return { handler: method, action: { kind: 'method', name: method } };
    if (expr.type !== 'ArrowFunctionExpression' || (expr.params as OxcNode[]).length > 1) {
      fail(sourceNode, 'OEC9016', 'event handlers must be this.<method> or a single-action arrow');
    }
    const arrowBody = expr.body as OxcNode;
    let expression: OxcNode | undefined;
    if (arrowBody.type === 'BlockStatement') {
      const blockStatements = arrowBody.body as OxcNode[];
      if (blockStatements.length === 1 && blockStatements[0].type === 'ExpressionStatement') {
        expression = blockStatements[0].expression as OxcNode;
      }
    } else {
      expression = arrowBody;
    }
    if (!expression) {
      fail(sourceNode, 'OEC9016', 'event arrow handlers must contain exactly one supported action');
    }
    const action = parseEventMutation(expression, sourceNode);
    let name = `__compiledEvent${generatedHandlers.length}`;
    while (methodNames.has(name) || fieldNames.has(name)) name = `_${name}`;
    methodNames.add(name);
    generatedHandlers.push({ name, action, node: expr });
    addSource(`handler:${name}`, 'handler', expr);
    return { handler: name, action };
  };
  const lowerEvent = (
    attributeName: string,
    expr: OxcNode,
    pathArr: number[],
    sourceNode: OxcNode,
    elementId: string,
  ): number => {
    const action = eventAction(expr, sourceNode);
    return addPart(
      {
        k: 'event',
        event: attributeName.slice(2).toLowerCase(),
        handler: action.handler,
        action: action.action,
        path: pathArr,
      },
      pathArr,
      sourceNode,
      elementId,
    );
  };
  const lowerDynamicAttribute = (
    name: string,
    signal: string,
    tagName: string,
    pathArr: number[],
    sourceNode: OxcNode,
    elementId: string,
  ): unknown => {
    const lowerName = name.toLowerCase();
    if (name === 'class') {
      return addPart({ k: 'class', signal, path: pathArr }, pathArr, sourceNode, elementId);
    }
    if (name === 'style') {
      return addPart({ k: 'style', signal, path: pathArr }, pathArr, sourceNode, elementId);
    }
    if (BOOLEAN_ATTRIBUTES.has(lowerName)) {
      return addPart({ k: 'bool', signal, name, path: pathArr }, pathArr, sourceNode, elementId);
    }
    if (
      name === 'value' || DOM_PROPERTY_NAMES.has(name) || (tagName === 'input' && name === 'value')
    ) {
      return addPart({ k: 'prop', signal, name, path: pathArr }, pathArr, sourceNode, elementId);
    }
    return addPart({ k: 'attr', signal, name, path: pathArr }, pathArr, sourceNode, elementId);
  };

  // Item field access: <param>.<field> with an identifier field.
  const itemAccess = (expr: OxcNode, param: string): string | null => {
    const object = expr.object as OxcNode | undefined;
    const property = expr.property as OxcNode | undefined;
    const matches = expr.type === 'MemberExpression' && !expr.computed &&
      object?.type === 'Identifier' && String(object.name) === param &&
      property?.type === 'Identifier' && isIdentifier(String(property.name));
    return matches ? String(property!.name) : null;
  };

  const lowerExpressionChild = (
    child: OxcNode,
    staticOnly: boolean,
    pathArr: number[],
  ): Record<string, unknown> | null => {
    if ((child.expression as OxcNode).type === 'JSXEmptyExpression') return null;
    const expr = unwrap(child.expression as OxcNode);
    const field = fieldAccess(expr);
    if (field) {
      if (staticOnly) fail(child, 'OEC9012', 'Region branches must be fully static');
      const index = addPart({ k: 'text', signal: field }, pathArr, child);
      return { k: 'part', id: `p${index}`, index };
    }
    const literal = literalValue(expr);
    if (literal !== undefined) {
      const txt = primitiveText(literal);
      if (txt === null) fail(child, 'OEC9013', 'dynamic child literals must be primitive values');
      if (txt === '') return null;
      return { k: 'text', value: txt ?? '' };
    }
    if (expr.type === 'ConditionalExpression') {
      if (staticOnly) fail(child, 'OEC9012', 'nested Regions are outside the compiler grammar');
      const test = parseCondition(expr.test as OxcNode, child);
      const on = lowerStaticBranch(expr.consequent as OxcNode, child);
      const off = lowerStaticBranch(expr.alternate as OxcNode, child);
      const index = addPart(
        { k: 'when', signal: test.signal, test, on: [on], off: [off] },
        pathArr,
        child,
      );
      return { k: 'part', id: `p${index}`, index };
    }
    if (expr.type === 'CallExpression') {
      if (staticOnly) fail(child, 'OEC9012', 'nested Regions are outside the compiler grammar');
      return lowerEach(expr, child, pathArr);
    }
    fail(
      child,
      'OEC9013',
      'unsupported dynamic expression; use this.<property>, a supported condition, or this.<array>.map(...)',
    );
  };
  const parseCondition = (
    expr: OxcNode,
    near: OxcNode,
  ): { signal: string; op: string; value: number } => {
    const condition = unwrap(expr);
    if (condition.type === 'BinaryExpression') {
      const signal = fieldAccess(condition.left as OxcNode);
      const value = literalValue(condition.right as OxcNode);
      const supported = signal && typeof value === 'number' && Number.isFinite(value) &&
        condition.operator === '>';
      if (supported) return { signal, op: 'greater-than', value };
    }
    fail(
      near,
      'OEC9013',
      'conditional Regions support only this.<property> > a finite numeric literal',
    );
  };
  const lowerStaticBranch = (expr: OxcNode, near: OxcNode): Record<string, unknown> => {
    const branch = unwrap(expr);
    if (branch.type === 'JSXElement') return lowerElement(branch, [], true);
    fail(near, 'OEC9012', 'conditional Region branches must be single static JSX elements');
  };
  const lowerEach = (expr: OxcNode, near: OxcNode, pathArr: number[]): Record<string, unknown> => {
    const callee = expr.callee as OxcNode;
    const calleeProperty = callee.property as OxcNode | undefined;
    const isMapCall = callee.type === 'MemberExpression' && !callee.computed &&
      calleeProperty?.type === 'Identifier' && String(calleeProperty.name) === 'map' &&
      (expr.arguments as OxcNode[]).length === 1;
    if (!isMapCall) fail(near, 'OEC9013', 'list Regions support exactly this.<property>.map(...)');
    const signal = fieldAccess(callee.object as OxcNode);
    if (!signal) fail(near, 'OEC9013', 'list Regions must map over this.<property>');
    const arrow = (expr.arguments as OxcNode[])[0];
    const arrowParams = arrow.params as OxcNode[];
    if (
      arrow.type !== 'ArrowFunctionExpression' || arrowParams.length !== 1 ||
      arrowParams[0].type !== 'Identifier'
    ) {
      fail(near, 'OEC9013', 'list Region mapper must be a single-parameter arrow function');
    }
    if ((arrow.body as OxcNode).type === 'BlockStatement') {
      fail(near, 'OEC9013', 'list Region mapper must return one JSX element');
    }
    const bodyEl = unwrap(arrow.body as OxcNode);
    if (bodyEl.type !== 'JSXElement') {
      fail(near, 'OEC9013', 'list Region mapper must return one JSX element');
    }
    const param = String(arrowParams[0].name);
    let key: string | null = null;
    for (const prop of (bodyEl.openingElement as OxcNode).attributes as OxcNode[]) {
      if (prop.type !== 'JSXAttribute') {
        fail(prop, 'OEC9011', 'list Region items do not support spread attributes');
      }
      if (jsxName(prop.name as OxcNode) !== 'key') continue;
      if (key !== null) fail(prop, 'OEC9014', 'list Region items may declare key only once');
      if (!prop.value || (prop.value as OxcNode).type !== 'JSXExpressionContainer') {
        fail(prop, 'OEC9014', 'key must be key={<item>.<field>}');
      }
      const keyExpr = unwrap((prop.value as OxcNode).expression as OxcNode);
      const keyField = itemAccess(keyExpr, param);
      if (keyField) key = keyField;
      else fail(prop, 'OEC9014', `key must reference ${param}.<field>`);
    }
    if (!key) fail(bodyEl, 'OEC9014', 'list Region items require key={<item>.<field>}');
    const itemFields: string[] = [];
    const item = lowerItemElement(bodyEl, param, itemFields, [], true);
    const uniqueFields = [...new Set(itemFields)];
    if (uniqueFields.length === 0) {
      fail(
        bodyEl,
        'OEC9013',
        'list Region items must bind at least one {<item>.<field>} value or attribute slot',
      );
    }
    const index = addPart(
      {
        k: 'each',
        signal,
        key,
        ...(uniqueFields.length === 1 ? { field: uniqueFields[0] } : {}),
        item: [item],
      },
      pathArr,
      near,
    );
    return { k: 'part', id: `p${index}`, index };
  };

  const lowerItemElement = (
    element: OxcNode,
    param: string,
    itemFields: string[],
    pathArr: number[],
    allowKey = false,
  ): Record<string, unknown> => {
    const opening = element.openingElement as OxcNode;
    const tagName = jsxName(opening.name as OxcNode);
    const isCustomHost = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(tagName);
    if (!/^[a-z][a-z0-9]*$/.test(tagName) && !isCustomHost) {
      fail(
        opening.name as OxcNode,
        'OEC9010',
        'list Region item must be an intrinsic lowercase element',
      );
    }
    const id = `e${elementSerial++}`;
    locations.push({ id, kind: 'element', tag: tagName, path: [...pathArr] });
    addSource(id, 'element', element);
    const attrs: Array<[string, string]> = [];
    const iattrs: Array<[string, string]> = [];
    const attributeNames = new Set<string>();
    for (const prop of opening.attributes as OxcNode[]) {
      if (prop.type !== 'JSXAttribute') {
        fail(prop, 'OEC9011', 'spread attributes are not supported in item templates');
      }
      const rawName = jsxName(prop.name as OxcNode);
      const name = rawName === 'className' ? 'class' : rawName;
      if (name === 'key') {
        if (!allowKey) fail(prop, 'OEC9011', 'key is only supported on the list Region item root');
        continue;
      }
      if (!isSafeAttributeName(name)) fail(prop, 'OEC9011', `attribute name "${name}" is unsafe`);
      const attributeKey = name.toLowerCase();
      if (attributeNames.has(attributeKey)) {
        fail(prop, 'OEC9011', `duplicate attribute "${name}" is unsupported`);
      }
      attributeNames.add(attributeKey);
      if (!prop.value) {
        attrs.push([name, '']);
        continue;
      }
      const propValue = prop.value as OxcNode;
      if (propValue.type === 'Literal' && typeof propValue.value === 'string') {
        attrs.push([name, String(propValue.value)]);
        continue;
      }
      if (propValue.type !== 'JSXExpressionContainer') {
        fail(prop, 'OEC9011', 'item template attributes must be static literals');
      }
      const attrExpr = unwrap(propValue.expression as OxcNode);
      const attrField = itemAccess(attrExpr, param);
      if (attrField) {
        itemFields.push(attrField);
        iattrs.push([name, attrField]);
        continue;
      }
      const literal = literalValue(propValue.expression as OxcNode);
      if (literal === undefined) {
        fail(
          prop,
          'OEC9011',
          `item template attribute "${name}" must be a static literal or {${param}.<field>}`,
        );
      }
      const txt = primitiveText(literal);
      if (txt === null) {
        fail(prop, 'OEC9011', 'item template attributes must use primitive literals');
      }
      if (literal === false || literal === null) continue;
      attrs.push([name, literal === true ? '' : txt ?? '']);
    }
    const children: unknown[] = [];
    for (const child of element.children as OxcNode[]) {
      if (child.type === 'JSXText') {
        const value = source.slice(child.start, child.end).replace(/\s+/g, ' ');
        if (value.trim()) children.push({ k: 'text', value });
        continue;
      }
      if (
        child.type === 'JSXExpressionContainer' &&
        (child.expression as OxcNode).type !== 'JSXEmptyExpression'
      ) {
        const expr = unwrap(child.expression as OxcNode);
        const childField = itemAccess(expr, param);
        if (childField) {
          itemFields.push(childField);
          children.push({ k: 'ival', field: childField });
          continue;
        }
        fail(child, 'OEC9013', `item child must be {${param}.<field>}`);
      }
      if (child.type === 'JSXElement') {
        children.push(lowerItemElement(child, param, itemFields, [...pathArr, children.length]));
        continue;
      }
      fail(
        child,
        'OEC9013',
        'item templates support static text, item values and intrinsic elements',
      );
    }
    return { k: 'el', id, tag: tagName, attrs, ...(iattrs.length > 0 ? { iattrs } : {}), children };
  };
  const lowerElement = (
    el: OxcNode,
    pathArr: number[],
    staticOnly = false,
  ): Record<string, unknown> => {
    const opening = el.openingElement as OxcNode;
    const tagName = jsxName(opening.name as OxcNode);
    const isCustomHost = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(tagName);
    if (!/^[a-z][a-z0-9]*$/.test(tagName) && !isCustomHost) {
      fail(
        opening.name as OxcNode,
        'OEC9010',
        `component tag <${tagName}> is outside the compiler grammar ` +
          '(intrinsic lowercase elements and custom-element hosts only)',
      );
    }
    const attrs: Array<[string, string]> = [];
    const id = `e${elementSerial++}`;
    locations.push({ id, kind: 'element', tag: tagName, path: [...pathArr] });
    addSource(id, 'element', el);
    const attributeNames = new Set<string>();
    for (const prop of opening.attributes as OxcNode[]) {
      if (prop.type === 'JSXSpreadAttribute') {
        fail(prop, 'OEC9011', 'spread attributes are not supported by the compiler grammar');
      }
      const rawName = jsxName(prop.name as OxcNode);
      const name = rawName === 'className' ? 'class' : rawName;
      const init = prop.value as OxcNode | null;
      const isDynamicEvent = /^on[A-Z]/.test(name) && init !== null &&
        init.type === 'JSXExpressionContainer' &&
        (init.expression as OxcNode).type !== 'JSXEmptyExpression';
      if (isCustomHost && (isDynamicEvent || /^on[A-Z]/.test(name))) {
        fail(prop, 'OEC9017', `custom-element host <${tagName}> may not carry event handlers`);
      }
      if (!isSafeAttributeName(name) && !isDynamicEvent) {
        fail(prop, 'OEC9011', `attribute name "${name}" is unsafe`);
      }
      const attributeKey = name.toLowerCase();
      if (attributeNames.has(attributeKey)) {
        fail(prop, 'OEC9011', `duplicate attribute "${name}" is unsupported`);
      }
      attributeNames.add(attributeKey);
      if (!init) {
        attrs.push([name, '']);
        continue;
      }
      if (init.type === 'Literal' && typeof init.value === 'string') {
        attrs.push([name, String(init.value)]);
        continue;
      }
      if (
        init.type !== 'JSXExpressionContainer' ||
        (init.expression as OxcNode).type === 'JSXEmptyExpression'
      ) {
        fail(prop, 'OEC9011', `attribute "${name}" must be a literal or a supported expression`);
      }
      const expr = unwrap(init.expression as OxcNode);
      if (/^on[A-Z]/.test(name)) {
        if (staticOnly) fail(prop, 'OEC9012', 'Region branches must be fully static');
        lowerEvent(name, expr, pathArr, prop, id);
        continue;
      }
      if (name === 'ref') {
        fail(prop, 'OEC9011', 'ref must reference this.<field>');
      }
      const field = fieldAccess(expr);
      if (field) {
        if (staticOnly) fail(prop, 'OEC9012', 'Region branches must be fully static');
        if (isCustomHost) {
          addPart({ k: 'prop', signal: field, name, path: pathArr }, pathArr, prop, id);
          continue;
        }
        lowerDynamicAttribute(name, field, tagName, pathArr, prop, id);
        continue;
      }
      const literal = literalValue(expr);
      if (literal === undefined) {
        fail(
          prop,
          'OEC9011',
          `attribute "${name}" must be a literal, this.<property>, or a supported expression`,
        );
      }
      const txt = primitiveText(literal);
      if (txt === null) {
        fail(prop, 'OEC9011', `attribute "${name}" only accepts primitive literal values`);
      }
      if (literal === false || literal === null) continue;
      attrs.push([name, literal === true ? '' : txt ?? '']);
    }
    const lowered: unknown[] = [];
    for (const child of el.children as OxcNode[]) {
      const childPath = [...pathArr, lowered.length];
      if (child.type === 'JSXText') {
        const value = source.slice(child.start, child.end).replace(/\s+/g, ' ');
        if (value.trim().length === 0) continue;
        lowered.push({ k: 'text', value });
        continue;
      }
      if (child.type === 'JSXExpressionContainer') {
        const loweredChild = lowerExpressionChild(child, staticOnly, childPath);
        if (loweredChild) lowered.push(loweredChild);
        continue;
      }
      if (child.type === 'JSXElement') {
        lowered.push(lowerElement(child, childPath, staticOnly));
        continue;
      }
      fail(child, 'OEC9013', 'JSX fragments and spreads are outside the compiler grammar');
    }
    return { k: 'el', id, tag: tagName, attrs, children: lowered };
  };

  // render body: single return of one JSX element
  const renderNode = render as OxcNode;
  const statements = (((renderNode.value as OxcNode).body as OxcNode | null)?.body ??
    []) as OxcNode[];
  if (
    statements.length !== 1 || statements[0].type !== 'ReturnStatement' || !statements[0].argument
  ) {
    fail(renderNode, 'OEC9007', 'render() must be a single return of one JSX element');
  }
  const returned = unwrap(statements[0].argument as OxcNode);
  if (returned.type !== 'JSXElement') {
    fail(returned, 'OEC9007', 'render() must return a single JSX element');
  }
  const root = lowerElement(returned, [0]);

  const sourceRecordsAll: MiniProgram['sourceRecords'] = [
    { id: 'root', kind: 'root', source: sourceRange(renderNode) },
    ...fields.map((field) => ({
      id: `property:${field.name}`,
      kind: 'property',
      source: sourceRange(field.node),
    })),
    ...sourceRecords,
  ];
  return {
    tag,
    root: { id: 'root', kind: 'light', nodes: [String((root as { id: string }).id)] },
    template: [root],
    parts,
    regions,
    dependencies,
    locations,
    sourceRecords: sourceRecordsAll,
    properties: fields.map((field) => ({
      name: field.name,
      attribute: field.attribute,
      type: field.type,
      converter: field.converter,
      reflect: field.reflect,
      default: field.defaultValue,
    })),
    observedAttributes: fields.flatMap((
      field,
    ) => (field.attribute === null ? [] : [field.attribute])),
  };
}
