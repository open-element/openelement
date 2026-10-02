/**
 * JSX → Part Program lowering for the compiled grammar (#1473 split — the
 * lower stage of the former compile facade): the {@link Lowering} walk turns
 * the analyzed render() tree into fixed Parts, Regions, locations and source
 * records with stable compiler-owned paths.
 */

import ts from 'typescript';
import { CompiledElementError, sourceRange } from './compiler-diagnostics.ts';
import { diagnosticAt } from './diagnostics/index.ts';
import {
  type CompiledField,
  isSafeAttributeName,
  literalValue,
  primitiveText,
  unwrapExpression,
} from './analyze-module.ts';
import {
  conditionLiteralAllowed,
  type ConditionOperator,
  type ProgramCondition,
  type ProgramDependencyRecord,
  type ProgramEventAction,
  type ProgramLocation,
  type ProgramLocationRecord,
  type ProgramPart,
  type ProgramRegionRecord,
  type ProgramSourceRecord,
  type ProgramTreeNode,
  type PropertyValueType,
  VOID_TAGS,
} from '../../protocol/part-program.ts';
import { forbiddenSinkReason } from '../../protocol/forbidden-sinks.ts';

export interface GeneratedHandler {
  name: string;
  action: ProgramEventAction;
  node: ts.ArrowFunction;
}

/** Distributive input union for addPart (Omit<union> collapses; do not use). */
type ProgramPartInput =
  | { k: 'text'; signal: string }
  | { k: 'prop'; signal: string; name: string; path: number[] }
  | { k: 'attr'; signal: string; name: string; path: number[] }
  | { k: 'bool'; signal: string; name: string; path: number[] }
  | { k: 'class'; signal: string; path: number[] }
  | { k: 'style'; signal: string; path: number[] }
  | { k: 'html'; signal: string; path: number[] }
  | { k: 'ref'; ref: string; path: number[] }
  | {
      k: 'event';
      event: string;
      handler: string;
      action: ProgramEventAction;
      path: number[];
    }
  | {
      k: 'when';
      signal: string;
      test: ProgramCondition;
      on: ProgramTreeNode[];
      off: ProgramTreeNode[];
    }
  | { k: 'each'; signal: string; key: string; field?: string; item: ProgramTreeNode[] };

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

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

/**
 * Token→operator map for when-Region conditions (#1372). Only strict
 * equality tokens are admitted; `==`/`!=` fail closed with OEC9013 so the
 * coercion difference cannot ride in unnoticed.
 */
const CONDITION_TOKEN_OPS: Partial<Record<ts.SyntaxKind, ConditionOperator>> = {
  [ts.SyntaxKind.GreaterThanToken]: 'greater-than',
  [ts.SyntaxKind.GreaterThanEqualsToken]: 'greater-or-equal',
  [ts.SyntaxKind.LessThanToken]: 'less-than',
  [ts.SyntaxKind.LessThanEqualsToken]: 'less-or-equal',
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: 'equals',
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: 'not-equals',
};

/**
 * React-contract JSX text cleaning (owner ruling 2026-10-02): the facebook/jsx
 * whitespace rules exactly as the React toolchain implements them (Babel's
 * `cleanJSXElementLiteralChild`, TypeScript's JSX transformer). Applied per
 * JSXText node, three rules fall out:
 *   R1 (node boundaries) — a leading/trailing whitespace run touching a
 *     newline is stripped; a whitespace-only node containing a newline cleans
 *     to '' (the caller drops it);
 *   R2 (node interior) — a whitespace run containing a newline folds to a
 *     single space; a run of spaces/tabs not touching a newline is preserved
 *     verbatim;
 *   R3 (between elements) — a sibling-delimiting whitespace run with a
 *     newline cleans to '' (removed); a run without a newline survives
 *     verbatim (the one-space form oxfmt/Prettier emit between inline
 *     siblings renders as a single space).
 * This makes React-family formatters (oxfmt included) safe on OE JSX: the
 * multiline layout they produce serializes identically to the inline layout
 * under React semantics (`40⏎<span>4</span>` renders `404`, not `40 4`).
 *
 * The input must be the parser's canonical `JsxText.text` — NOT
 * `getText(sourceFile)`, which drops the leading whitespace of a run abutting
 * a tag (node pos vs start gap) and would silently narrow the run before the
 * rules apply. The TypeScript JSX transformer cleans this same value.
 */
function cleanJsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmptyLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/[^ \t]/.test(lines[i])) lastNonEmptyLine = i;
  }
  let text = '';
  for (let i = 0; i < lines.length; i++) {
    const isFirstLine = i === 0;
    const isLastLine = i === lines.length - 1;
    const isLastNonEmptyLine = i === lastNonEmptyLine;
    let line = lines[i].replace(/\t/g, ' ');
    if (!isFirstLine) line = line.replace(/^ +/, '');
    if (!isLastLine) line = line.replace(/ +$/, '');
    if (line) {
      if (!isLastNonEmptyLine) line += ' ';
      text += line;
    }
  }
  return text;
}

/** Meaningful under the same React contract the emission applies. */
function hasMeaningfulJsxChild(sf: ts.SourceFile, child: ts.JsxChild): boolean {
  if (ts.isJsxText(child)) return cleanJsxText(child.text).length > 0;
  if (ts.isJsxExpression(child)) {
    if (!child.expression) return false;
    const literal = literalValue(child.expression, sf);
    if (literal !== undefined) return primitiveText(literal) !== '';
  }
  return true;
}

export class Lowering {
  readonly parts: ProgramPart[] = [];
  readonly regions: ProgramRegionRecord[] = [];
  readonly dependencies: ProgramDependencyRecord[] = [];
  readonly locations: ProgramLocationRecord[] = [];
  readonly sourceRecords: ProgramSourceRecord[] = [];
  readonly generatedHandlers: GeneratedHandler[] = [];
  readonly fieldNames: Set<string>;
  readonly methodNames: Set<string>;
  readonly computedNames: Set<string>;
  readonly fieldTypes: Map<string, PropertyValueType>;
  private readonly sf: ts.SourceFile;
  private elementSerial = 0;

  constructor(sf: ts.SourceFile, fields: CompiledField[], methodNames: string[]) {
    this.sf = sf;
    this.fieldNames = new Set(fields.map((field) => field.name));
    this.methodNames = new Set(methodNames);
    this.computedNames = new Set(
      fields.filter((field) => field.computed).map((field) => field.name),
    );
    this.fieldTypes = new Map(fields.map((field) => [field.name, field.type]));
  }

  fail(node: ts.Node, code: string, message: string): never {
    throw new CompiledElementError([diagnosticAt(this.sf, node, code, message)]);
  }

  private addSource(id: string, kind: ProgramSourceRecord['kind'], node: ts.Node): void {
    if (this.sourceRecords.some((record) => record.id === id)) return;
    this.sourceRecords.push({ id, kind, source: sourceRange(this.sf, node) });
  }

  private reserveElement(tag: string, path: number[], node: ts.Node): string {
    const id = `e${this.elementSerial++}`;
    this.locations.push({ id, kind: 'element', tag, path: [...path] });
    this.addSource(id, 'element', node);
    return id;
  }

  private addElement(
    id: string,
    tag: string,
    attrs: Array<[string, string]>,
    children: ProgramTreeNode[],
    iattrs?: Array<[string, string]>,
  ): ProgramTreeNode {
    return {
      k: 'el',
      id,
      tag,
      attrs,
      ...(iattrs && iattrs.length > 0 ? { iattrs } : {}),
      children,
    };
  }

  private addPart(
    part: ProgramPartInput,
    path: number[],
    node: ts.Node,
    targetNode?: string,
  ): number {
    const index = this.parts.length;
    const isAnchor = part.k === 'text' || part.k === 'when' || part.k === 'each';
    const location: ProgramLocation = {
      id: `p${index}`,
      kind: isAnchor ? 'anchor' : 'sink',
      path: [...path],
      ...(targetNode ? { node: targetNode } : {}),
    };
    const fullPart = { ...part, index, location } as ProgramPart;
    this.parts.push(fullPart);
    if (isAnchor) {
      this.locations.push({ id: `p${index}`, kind: 'anchor', part: index, path: [...path] });
    } else {
      this.locations.push({
        id: `p${index}`,
        kind: 'sink',
        part: index,
        node: targetNode!,
        path: [...path],
      });
    }
    const sourceKind = part.k === 'when' || part.k === 'each' ? 'region' : 'part';
    this.addSource(`p${index}`, sourceKind, node);
    if (part.k === 'when' || part.k === 'each') {
      this.regions.push({
        id: `r${index}`,
        index,
        kind: part.k,
        anchor: `p${index}`,
        end: `p${index}:end`,
        source: `p${index}`,
      });
      this.addSource(`r${index}`, 'region', node);
    }
    if (
      part.k === 'text' ||
      part.k === 'prop' ||
      part.k === 'attr' ||
      part.k === 'bool' ||
      part.k === 'class' ||
      part.k === 'style' ||
      part.k === 'html' ||
      part.k === 'when' ||
      part.k === 'each'
    ) {
      this.dependencies.push({
        signal: part.signal,
        owner: { kind: part.k === 'when' || part.k === 'each' ? 'region' : 'part', index },
        location: `p${index}`,
      });
    }
    return index;
  }

  private fieldAccess(expr: ts.Expression): string | null {
    const value = unwrapExpression(expr);
    if (
      ts.isPropertyAccessExpression(value) &&
      value.expression.kind === ts.SyntaxKind.ThisKeyword &&
      this.fieldNames.has(value.name.text)
    ) {
      return value.name.text;
    }
    return null;
  }

  private methodAccess(expr: ts.Expression): string | null {
    const value = unwrapExpression(expr);
    if (
      ts.isPropertyAccessExpression(value) &&
      value.expression.kind === ts.SyntaxKind.ThisKeyword &&
      this.methodNames.has(value.name.text)
    ) {
      return value.name.text;
    }
    return null;
  }

  lowerRoot(expr: ts.Expression): ProgramTreeNode {
    const root = unwrapExpression(expr);
    if (ts.isJsxElement(root)) {
      return this.lowerElement(
        root.openingElement.tagName,
        root.openingElement.attributes,
        [...root.children],
        [0],
        root,
      );
    }
    if (ts.isJsxSelfClosingElement(root)) {
      return this.lowerElement(root.tagName, root.attributes, [], [0], root);
    }
    return this.fail(root, 'OEC9007', 'render() must return a single JSX element');
  }

  private normalizeAttributeName(name: string): string {
    return name === 'className' ? 'class' : name;
  }

  private lowerElement(
    tagNameNode: ts.JsxTagNameExpression,
    attributes: ts.JsxAttributes,
    children: ts.JsxChild[],
    path: number[],
    sourceNode: ts.Node,
    staticOnly = false,
  ): ProgramTreeNode {
    const tag = tagNameNode.getText(this.sf);
    // alpha.8: custom-element hosts (<x-y>) are admitted as nested hosts — the
    // page/layout composition renders them as host tags that the server entry
    // expands per the SSR admission plan. They carry static literal attributes
    // or this.<property> bindings (lowered as prop Parts so the server
    // serializer emits them as host attributes and the client claim assigns
    // them as JS properties). Children are the host's light content (slot
    // projection is platform behavior) and lower with the ordinary grammar;
    // event handlers and refs on hosts still fail closed.
    const isCustomHost = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(tag);
    if (!/^[a-z][a-z0-9]*$/.test(tag) && !isCustomHost) {
      this.fail(
        tagNameNode,
        'OEC9010',
        `component tag <${tag}> is outside the compiler grammar (intrinsic lowercase elements and custom-element hosts only)`,
      );
    }
    const tagReason = forbiddenSinkReason('tag', tag);
    if (tagReason !== null) this.fail(tagNameNode, 'OEC9010', tagReason);
    const attrs: Array<[string, string]> = [];
    const elementId = this.reserveElement(tag, path, sourceNode);
    const attributeNames = new Set<string>();
    let trustedHtmlCapability = false;
    for (const prop of attributes.properties) {
      if (ts.isJsxSpreadAttribute(prop)) continue;
      if (this.normalizeAttributeName(prop.name.getText(this.sf)) !== 'trustedHtml') continue;
      const init = prop.initializer;
      trustedHtmlCapability =
        init === undefined ||
        (ts.isJsxExpression(init) && init.expression?.kind === ts.SyntaxKind.TrueKeyword);
      if (!trustedHtmlCapability) {
        this.fail(prop, 'OEC9026', 'trustedHtml capability marker must be the literal true');
      }
    }
    for (const prop of attributes.properties) {
      if (ts.isJsxSpreadAttribute(prop)) {
        this.fail(prop, 'OEC9011', 'spread attributes are not supported by the compiler grammar');
      }
      const name = this.normalizeAttributeName(prop.name.getText(this.sf));
      const init = prop.initializer;
      if (name === 'trustedHtml') continue;
      const isDynamicEvent =
        /^on[A-Z]/.test(name) &&
        init !== undefined &&
        ts.isJsxExpression(init) &&
        init.expression !== undefined;
      if (isCustomHost && (isDynamicEvent || /^on[A-Z]/.test(name))) {
        this.fail(prop, 'OEC9017', `custom-element host <${tag}> may not carry event handlers`);
      }
      if (!isSafeAttributeName(name) && !isDynamicEvent && name !== 'innerHTML') {
        this.fail(prop, 'OEC9011', `attribute name "${name}" is unsafe`);
      }
      // innerHTML is exempt from the generic name check only so the dynamic
      // trusted-HTML sink path below can admit it; every static or non-field
      // form is a plain attribute and rejected by the same shared predicate.
      if (
        name === 'innerHTML' &&
        !(
          init !== undefined &&
          ts.isJsxExpression(init) &&
          init.expression !== undefined &&
          this.fieldAccess(unwrapExpression(init.expression)) !== null
        )
      ) {
        this.fail(prop, 'OEC9011', `attribute name "${name}" is unsafe`);
      }
      const attributeKey = name.toLowerCase();
      if (attributeNames.has(attributeKey)) {
        this.fail(prop, 'OEC9011', `duplicate attribute "${name}" is unsupported`);
      }
      attributeNames.add(attributeKey);
      if (!init) {
        attrs.push([name, '']);
        continue;
      }
      if (ts.isStringLiteral(init)) {
        attrs.push([name, init.text]);
        continue;
      }
      if (!ts.isJsxExpression(init) || !init.expression) {
        this.fail(
          prop,
          'OEC9011',
          `attribute "${name}" must be a literal or a supported expression`,
        );
      }
      const expr = unwrapExpression(init.expression);
      if (/^on[A-Z]/.test(name)) {
        if (staticOnly) this.fail(prop, 'OEC9012', 'Region branches must be fully static');
        this.lowerEvent(name, expr, path, prop, elementId);
        continue;
      }
      if (name === 'ref') {
        if (isCustomHost) {
          this.fail(prop, 'OEC9017', `custom-element host <${tag}> may not carry a ref`);
        }
        if (staticOnly) this.fail(prop, 'OEC9012', 'Region branches must be fully static');
        const ref = this.fieldAccess(expr);
        if (!ref) this.fail(prop, 'OEC9011', 'ref must reference this.<field>');
        this.addPart({ k: 'ref', ref, path }, path, prop, elementId);
        continue;
      }
      const field = this.fieldAccess(expr);
      if (field) {
        if (staticOnly) this.fail(prop, 'OEC9012', 'Region branches must be fully static');
        // Security sinks are classified before host lowering: an innerHTML sink
        // is the same TrustedHtml boundary on an intrinsic element and on a
        // custom-element host, so the custom-host prop lowering below must not
        // be able to skip the capability admission.
        if (name === 'innerHTML') {
          this.lowerDynamicAttribute(
            name,
            field,
            tag,
            path,
            prop,
            elementId,
            trustedHtmlCapability,
          );
          continue;
        }
        if (isCustomHost) {
          // Host attributes cross the SSR boundary as host attributes: lower
          // every dynamic host attribute as a prop Part so the serializer
          // emits it and the client claim assigns it as a JS property.
          const propReason = forbiddenSinkReason('prop', name);
          if (propReason !== null) {
            this.fail(prop, 'OEC9011', `property sink name "${name}" is unsafe`);
          }
          this.addPart({ k: 'prop', signal: field, name, path }, path, prop, elementId);
          continue;
        }
        this.lowerDynamicAttribute(name, field, tag, path, prop, elementId, trustedHtmlCapability);
        continue;
      }
      const literal = literalValue(expr, this.sf);
      if (literal === undefined) {
        this.fail(
          prop,
          'OEC9011',
          `attribute "${name}" must be a literal, this.<property>, or a supported expression`,
        );
      }
      const text = primitiveText(literal);
      if (text === null) {
        this.fail(prop, 'OEC9011', `attribute "${name}" only accepts primitive literal values`);
      }
      if (literal === false || literal === null) continue;
      attrs.push([name, literal === true ? '' : (text ?? '')]);
    }

    const hasHtmlSink = this.parts.some(
      (part) =>
        part.k === 'html' &&
        part.path.length === path.length &&
        part.path.every((value, index) => value === path[index]),
    );
    if (trustedHtmlCapability && !hasHtmlSink) {
      this.fail(sourceNode, 'OEC9026', 'trustedHtml capability marker requires an innerHTML sink');
    }
    if (
      !isCustomHost &&
      hasHtmlSink &&
      children.some((child) => hasMeaningfulJsxChild(this.sf, child))
    ) {
      this.fail(
        sourceNode,
        'OEC9026',
        'an innerHTML sink target must be otherwise childless (the sink owns its content)',
      );
    }

    const lowered: ProgramTreeNode[] = [];
    for (const child of children) {
      const childPath = [...path, lowered.length];
      if (ts.isJsxText(child)) {
        const value = cleanJsxText(child.text);
        if (value === '') continue;
        lowered.push({ k: 'text', value });
        continue;
      }
      if (ts.isJsxExpression(child)) {
        const loweredChild = this.lowerExpressionChild(child, staticOnly, childPath);
        if (loweredChild) lowered.push(loweredChild);
        continue;
      }
      if (ts.isJsxElement(child)) {
        lowered.push(
          this.lowerElement(
            child.openingElement.tagName,
            child.openingElement.attributes,
            [...child.children],
            childPath,
            child,
            staticOnly,
          ),
        );
        continue;
      }
      if (ts.isJsxSelfClosingElement(child)) {
        lowered.push(
          this.lowerElement(child.tagName, child.attributes, [], childPath, child, staticOnly),
        );
        continue;
      }
      this.fail(child, 'OEC9013', 'JSX fragments and spreads are outside the compiler grammar');
    }
    if (VOID_TAGS.has(tag)) {
      const child = children.find((candidate) => hasMeaningfulJsxChild(this.sf, candidate));
      if (child) {
        this.fail(child, 'OEC9013', `void element <${tag}> may not have children`);
      }
    }
    return this.addElement(elementId, tag, attrs, lowered);
  }

  private lowerEvent(
    attributeName: string,
    expr: ts.Expression,
    path: number[],
    sourceNode: ts.Node,
    elementId: string,
  ): number {
    const action = this.eventAction(expr, sourceNode);
    return this.addPart(
      {
        k: 'event',
        event: attributeName.slice(2).toLowerCase(),
        handler: action.handler,
        action: action.action,
        path,
      },
      path,
      sourceNode,
      elementId,
    );
  }

  private eventAction(
    expr: ts.Expression,
    sourceNode: ts.Node,
  ): { handler: string; action: ProgramEventAction } {
    const method = this.methodAccess(expr);
    if (method) return { handler: method, action: { kind: 'method', name: method } };
    if (!ts.isArrowFunction(expr) || expr.parameters.length > 1) {
      this.fail(
        sourceNode,
        'OEC9016',
        'event handlers must be this.<method> or a single-action arrow',
      );
    }
    const expression = ts.isBlock(expr.body)
      ? expr.body.statements.length === 1 && ts.isExpressionStatement(expr.body.statements[0])
        ? expr.body.statements[0].expression
        : undefined
      : expr.body;
    if (!expression) {
      this.fail(
        sourceNode,
        'OEC9016',
        'event arrow handlers must contain exactly one supported action',
      );
    }
    const action = this.parseEventMutation(expression, sourceNode);
    let name = `__compiledEvent${this.generatedHandlers.length}`;
    while (this.methodNames.has(name) || this.fieldNames.has(name)) name = `_${name}`;
    this.methodNames.add(name);
    this.generatedHandlers.push({ name, action, node: expr });
    this.addSource(`handler:${name}`, 'handler', expr);
    return { handler: name, action };
  }

  private parseEventMutation(expr: ts.Expression, near: ts.Node): ProgramEventAction {
    const value = unwrapExpression(expr);
    const assertWritable = (signal: string): void => {
      if (this.computedNames.has(signal)) {
        this.fail(
          near,
          'OEC9024',
          `event actions may not write computed field "${signal}" — assign its source properties`,
        );
      }
    };
    if (ts.isPostfixUnaryExpression(value) || ts.isPrefixUnaryExpression(value)) {
      const signal = this.fieldAccess(value.operand);
      if (
        !signal ||
        (value.operator !== ts.SyntaxKind.PlusPlusToken &&
          value.operator !== ts.SyntaxKind.MinusMinusToken)
      ) {
        this.fail(near, 'OEC9016', 'event mutations support only this.<number>++ or --');
      }
      assertWritable(signal!);
      return {
        kind: value.operator === ts.SyntaxKind.PlusPlusToken ? 'increment' : 'decrement',
        signal: signal!,
      };
    }
    if (ts.isBinaryExpression(value)) {
      const signal = this.fieldAccess(value.left);
      const literal = literalValue(value.right, this.sf);
      if (!signal || literal === undefined) {
        this.fail(near, 'OEC9016', 'event assignment values must be serializable literals');
      }
      assertWritable(signal!);
      if (value.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        return { kind: 'assign', signal, value: literal! };
      }
      if (
        (value.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ||
          value.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken) &&
        typeof literal === 'number'
      ) {
        return {
          kind: value.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ? 'add' : 'subtract',
          signal,
          value: literal,
        };
      }
      this.fail(near, 'OEC9016', 'event arithmetic supports only numeric += or -= literals');
    }
    if (ts.isCallExpression(value) && value.arguments.length === 0) {
      const method = this.methodAccess(value.expression);
      if (method) return { kind: 'call', name: method };
    }
    this.fail(
      near,
      'OEC9016',
      'unsupported event action; use this.<field>++, assignment or this.<method>()',
    );
  }

  private lowerDynamicAttribute(
    name: string,
    signal: string,
    tag: string,
    path: number[],
    sourceNode: ts.Node,
    elementId: string,
    trustedHtmlCapability: boolean,
  ): void {
    const lowerName = name.toLowerCase();
    if (name === 'class') {
      this.addPart({ k: 'class', signal, path }, path, sourceNode, elementId);
      return;
    }
    if (name === 'style') {
      this.addPart({ k: 'style', signal, path }, path, sourceNode, elementId);
      return;
    }
    if (name === 'innerHTML') {
      // Trusted-HTML sink: the marker admits the sink at compile time and the
      // Object-typed signal must carry the runtime TrustedHtml capability.
      if (this.fieldTypes.get(signal) !== 'object') {
        this.fail(
          sourceNode,
          'OEC9026',
          'innerHTML sinks require an Object-typed TrustedHtml property',
        );
      }
      if (!trustedHtmlCapability) {
        this.fail(
          sourceNode,
          'OEC9026',
          'innerHTML sinks require the explicit trustedHtml capability marker',
        );
      }
      if (VOID_TAGS.has(tag)) {
        this.fail(sourceNode, 'OEC9026', `void element <${tag}> cannot carry an innerHTML sink`);
      }
      this.addPart({ k: 'html', signal, path }, path, sourceNode, elementId);
      return;
    }
    if (BOOLEAN_ATTRIBUTES.has(lowerName)) {
      if (forbiddenSinkReason('bool', name) !== null) {
        this.fail(sourceNode, 'OEC9011', `attribute name "${name}" is unsafe`);
      }
      this.addPart({ k: 'bool', signal, name, path }, path, sourceNode, elementId);
      return;
    }
    if (name === 'value' || DOM_PROPERTY_NAMES.has(name) || (tag === 'input' && name === 'value')) {
      if (forbiddenSinkReason('prop', name) !== null) {
        this.fail(sourceNode, 'OEC9011', `property sink name "${name}" is unsafe`);
      }
      this.addPart({ k: 'prop', signal, name, path }, path, sourceNode, elementId);
      return;
    }
    if (forbiddenSinkReason('attr', name) !== null) {
      this.fail(sourceNode, 'OEC9011', `attribute name "${name}" is unsafe`);
    }
    this.addPart({ k: 'attr', signal, name, path }, path, sourceNode, elementId);
  }

  private lowerExpressionChild(
    child: ts.JsxExpression,
    staticOnly: boolean,
    path: number[],
  ): ProgramTreeNode | null {
    if (!child.expression) return null;
    const expr = unwrapExpression(child.expression);
    const field = this.fieldAccess(expr);
    if (field) {
      if (staticOnly) this.fail(child, 'OEC9012', 'Region branches must be fully static');
      const index = this.addPart({ k: 'text', signal: field }, path, child);
      return { k: 'part', id: `p${index}`, index };
    }
    const literal = literalValue(expr, this.sf);
    if (literal !== undefined) {
      const text = primitiveText(literal);
      if (text === null) {
        this.fail(child, 'OEC9013', 'dynamic child literals must be primitive values');
      }
      if (text === '') return null;
      return { k: 'text', value: text ?? '' };
    }
    if (ts.isConditionalExpression(expr)) {
      if (staticOnly) {
        this.fail(child, 'OEC9012', 'nested Regions are outside the compiler grammar');
      }
      const test = this.parseCondition(expr.condition, child);
      const on = this.lowerStaticBranch(expr.whenTrue, child);
      const off = this.lowerStaticBranch(expr.whenFalse, child);
      const index = this.addPart(
        { k: 'when', signal: test.signal, test, on: [on], off: [off] },
        path,
        child,
      );
      return { k: 'part', id: `p${index}`, index };
    }
    if (ts.isCallExpression(expr)) {
      if (staticOnly) {
        this.fail(child, 'OEC9012', 'nested Regions are outside the compiler grammar');
      }
      return this.lowerEach(expr, child, path);
    }
    this.fail(
      child,
      'OEC9013',
      'unsupported dynamic expression; use this.<property>, a supported condition, or this.<array>.map(...)',
    );
  }

  private parseCondition(expr: ts.Expression, near: ts.Node): ProgramCondition {
    const condition = unwrapExpression(expr);
    // Bare `this.<property>` truthiness and its negation (#1372): the only
    // nullary forms. Everything else must be `this.<prop> <op> <literal>`.
    const bareSignal = this.fieldAccess(condition);
    if (bareSignal) return { signal: bareSignal, op: 'truthy', value: true };
    if (
      ts.isPrefixUnaryExpression(condition) &&
      condition.operator === ts.SyntaxKind.ExclamationToken
    ) {
      const negatedSignal = this.fieldAccess(unwrapExpression(condition.operand));
      if (negatedSignal) return { signal: negatedSignal, op: 'truthy', value: false };
    }
    if (ts.isBinaryExpression(condition)) {
      const signal = this.fieldAccess(condition.left);
      const value = literalValue(condition.right, this.sf);
      const op = CONDITION_TOKEN_OPS[condition.operatorToken.kind];
      if (
        signal &&
        op &&
        value !== undefined &&
        typeof value !== 'object' &&
        conditionLiteralAllowed(op, value)
      ) {
        return { signal, op, value };
      }
    }
    this.fail(
      near,
      'OEC9013',
      'conditional Regions support this.<property> compared with a numeric literal (>, >=, <, <=), ' +
        'a number/string/boolean equality (===, !==), or a bare this.<property> (optionally negated) truthiness test',
    );
  }

  private lowerStaticBranch(expr: ts.Expression, near: ts.Node): ProgramTreeNode {
    const branch = unwrapExpression(expr);
    if (ts.isJsxElement(branch)) {
      return this.lowerElement(
        branch.openingElement.tagName,
        branch.openingElement.attributes,
        [...branch.children],
        [],
        branch,
        true,
      );
    }
    if (ts.isJsxSelfClosingElement(branch)) {
      return this.lowerElement(branch.tagName, branch.attributes, [], [], branch, true);
    }
    this.fail(near, 'OEC9012', 'conditional Region branches must be single static JSX elements');
  }

  private lowerEach(expr: ts.CallExpression, near: ts.Node, path: number[]): ProgramTreeNode {
    const callee = expr.expression;
    if (
      !ts.isPropertyAccessExpression(callee) ||
      callee.name.text !== 'map' ||
      expr.arguments.length !== 1
    ) {
      this.fail(near, 'OEC9013', 'list Regions support exactly this.<property>.map(...)');
    }
    const signal = this.fieldAccess(callee.expression);
    if (!signal) this.fail(near, 'OEC9013', 'list Regions must map over this.<property>');
    const arrow = expr.arguments[0];
    if (
      !ts.isArrowFunction(arrow) ||
      arrow.parameters.length !== 1 ||
      !ts.isIdentifier(arrow.parameters[0].name)
    ) {
      this.fail(near, 'OEC9013', 'list Region mapper must be a single-parameter arrow function');
    }
    if (ts.isBlock(arrow.body)) {
      this.fail(near, 'OEC9013', 'list Region mapper must return one JSX element');
    }
    const body = unwrapExpression(arrow.body);
    if (!ts.isJsxElement(body) && !ts.isJsxSelfClosingElement(body)) {
      this.fail(near, 'OEC9013', 'list Region mapper must return one JSX element');
    }
    const param = arrow.parameters[0].name.text;
    const attributes = ts.isJsxElement(body) ? body.openingElement.attributes : body.attributes;
    let key: string | null = null;
    for (const prop of attributes.properties) {
      if (!ts.isJsxAttribute(prop)) {
        this.fail(prop, 'OEC9011', 'list Region items do not support spread attributes');
      }
      if (prop.name.getText(this.sf) !== 'key') continue;
      if (key !== null) this.fail(prop, 'OEC9014', 'list Region items may declare key only once');
      if (
        !prop.initializer ||
        !ts.isJsxExpression(prop.initializer) ||
        !prop.initializer.expression
      ) {
        this.fail(prop, 'OEC9014', 'key must be key={<item>.<field>}');
      }
      const keyExpr = unwrapExpression(prop.initializer.expression);
      if (
        ts.isPropertyAccessExpression(keyExpr) &&
        ts.isIdentifier(keyExpr.expression) &&
        keyExpr.expression.text === param &&
        isIdentifier(keyExpr.name.text)
      ) {
        key = keyExpr.name.text;
      } else {
        this.fail(prop, 'OEC9014', `key must reference ${param}.<field>`);
      }
    }
    if (!key) this.fail(body, 'OEC9014', 'list Region items require key={<item>.<field>}');

    const itemFields: string[] = [];
    const item = this.lowerItemElement(body, param, itemFields, [], true);
    const uniqueFields = [...new Set(itemFields)];
    if (uniqueFields.length === 0) {
      this.fail(
        body,
        'OEC9013',
        'list Region items must bind at least one {<item>.<field>} value or attribute slot',
      );
    }
    const index = this.addPart(
      {
        k: 'each',
        signal: signal!,
        key: key!,
        // Single-field templates keep the Region-level field restatement;
        // multi-field templates omit it — every ival/iattrs slot owns its own.
        ...(uniqueFields.length === 1 ? { field: uniqueFields[0] } : {}),
        item: [item],
      },
      path,
      near,
    );
    return { k: 'part', id: `p${index}`, index };
  }

  private lowerItemElement(
    element: ts.JsxElement | ts.JsxSelfClosingElement,
    param: string,
    itemFields: string[],
    path: number[],
    allowKey = false,
  ): ProgramTreeNode {
    const tagName = ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName;
    const attributes = ts.isJsxElement(element)
      ? element.openingElement.attributes
      : element.attributes;
    const tag = tagName.getText(this.sf);
    // alpha.8: item templates may nest custom-element hosts (e.g. an island
    // per row) as empty static shells — static literal attributes only, no
    // children (slots are outside grammar v1). The server serializer emits
    // them verbatim and the client instantiates them per item.
    const isCustomHost = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(tag);
    if (!/^[a-z][a-z0-9]*$/.test(tag) && !isCustomHost) {
      this.fail(tagName, 'OEC9010', 'list Region item must be an intrinsic lowercase element');
    }
    const itemTagReason = forbiddenSinkReason('tag', tag);
    if (itemTagReason !== null) this.fail(tagName, 'OEC9010', itemTagReason);
    const elementId = this.reserveElement(tag, path, element);
    const attrs: Array<[string, string]> = [];
    const iattrs: Array<[string, string]> = [];
    const attributeNames = new Set<string>();
    for (const prop of attributes.properties) {
      if (!ts.isJsxAttribute(prop)) {
        this.fail(prop, 'OEC9011', 'spread attributes are not supported in item templates');
      }
      const name = this.normalizeAttributeName(prop.name.getText(this.sf));
      if (name === 'key') {
        if (!allowKey) {
          this.fail(prop, 'OEC9011', 'key is only supported on the list Region item root');
        }
        continue;
      }
      if (!isSafeAttributeName(name)) {
        this.fail(prop, 'OEC9011', `attribute name "${name}" is unsafe`);
      }
      const attributeKey = name.toLowerCase();
      if (attributeNames.has(attributeKey)) {
        this.fail(prop, 'OEC9011', `duplicate attribute "${name}" is unsupported`);
      }
      attributeNames.add(attributeKey);
      if (!prop.initializer) {
        attrs.push([name, '']);
        continue;
      }
      if (ts.isStringLiteral(prop.initializer)) {
        attrs.push([name, prop.initializer.text]);
        continue;
      }
      if (!ts.isJsxExpression(prop.initializer) || !prop.initializer.expression) {
        this.fail(prop, 'OEC9011', 'item template attributes must be static literals');
      }
      // alpha.8: per-item attribute slots — `name={item.<field>}` resolves from
      // the current item at mount/claim (true emits a bare attribute, falsy
      // omits it, anything else serializes with String()).
      const attrExpr = unwrapExpression(prop.initializer.expression);
      if (
        ts.isPropertyAccessExpression(attrExpr) &&
        ts.isIdentifier(attrExpr.expression) &&
        attrExpr.expression.text === param &&
        isIdentifier(attrExpr.name.text)
      ) {
        itemFields.push(attrExpr.name.text);
        iattrs.push([name, attrExpr.name.text]);
        continue;
      }
      const literal = literalValue(prop.initializer.expression, this.sf);
      if (literal === undefined) {
        this.fail(
          prop,
          'OEC9011',
          `item template attribute "${name}" must be a static literal or {${param}.<field>}`,
        );
      }
      const text = primitiveText(literal);
      if (text === null) {
        this.fail(prop, 'OEC9011', 'item template attributes must use primitive literals');
      }
      if (literal === false || literal === null) continue;
      attrs.push([name, literal === true ? '' : (text ?? '')]);
    }
    const children: ProgramTreeNode[] = [];
    const rawChildren = ts.isJsxElement(element) ? [...element.children] : [];
    if (VOID_TAGS.has(tag)) {
      const child = rawChildren.find((candidate) => hasMeaningfulJsxChild(this.sf, candidate));
      if (child) this.fail(child, 'OEC9013', `void element <${tag}> may not have children`);
    }
    if (isCustomHost && rawChildren.some((child) => hasMeaningfulJsxChild(this.sf, child))) {
      this.fail(
        element,
        'OEC9017',
        `custom-element host <${tag}> may not have children in the compiler grammar (slots are unsupported)`,
      );
    }
    for (const child of rawChildren) {
      const childPath = [...path, children.length];
      if (ts.isJsxText(child)) {
        const text = cleanJsxText(child.text);
        if (text !== '') children.push({ k: 'text', value: text });
        continue;
      }
      if (ts.isJsxExpression(child) && child.expression) {
        const expr = unwrapExpression(child.expression);
        if (
          ts.isPropertyAccessExpression(expr) &&
          ts.isIdentifier(expr.expression) &&
          expr.expression.text === param &&
          isIdentifier(expr.name.text)
        ) {
          itemFields.push(expr.name.text);
          children.push({ k: 'ival', field: expr.name.text });
          continue;
        }
        this.fail(child, 'OEC9013', `item child must be {${param}.<field>}`);
      }
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
        children.push(this.lowerItemElement(child, param, itemFields, childPath));
        continue;
      }
      this.fail(
        child,
        'OEC9013',
        'item templates support static text, item values and intrinsic elements',
      );
    }
    return this.addElement(elementId, tag, attrs, children, iattrs);
  }
}
