/**
 * JSX → Part Program lowering for the compiled grammar (#1473 split): the
 * {@link Lowering} walk turns
 * the analyzed render() tree into fixed Parts, Blocks, locations and source
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
  validateComputedExpressionBody,
} from './analyze-module.ts';
import {
  conditionLiteralAllowed,
  type ConditionOperator,
  type ItemEventBinding,
  type ProgramCondition,
  type ProgramDependencyRecord,
  type ProgramEventAction,
  type ProgramLocation,
  type ProgramLocationRecord,
  type ProgramPart,
  type ProgramBlockRecord,
  type ProgramSourceRecord,
  type ProgramTreeNode,
  type PropertyValueType,
  VOID_TAGS,
} from '@openelement/protocol/part-program';
import { forbiddenSinkReason } from '@openelement/protocol/forbidden-sinks';

export interface GeneratedHandler {
  name: string;
  action: ProgramEventAction;
  node: ts.ArrowFunction;
}

/**
 * Local name the generated module binds the canonical `computed` import to
 * when a synthesized conditional-class field (#1556) exists but the authored
 * module never imported computed. The synthesized name cannot collide with an
 * authored binding the compiler would have resolved (a canonical computed
 * import is reused by name instead), and the emitter adds the import
 * alongside it.
 */
export const SYNTHESIZED_COMPUTED_LOCAL = '__openelementComputed';

/**
 * The server function component binding surface (alpha15 server lane): when
 * set, the ONE lowering walk reads component state from the component
 * function's `props` parameter instead of `this`, resolves uppercase JSX tags
 * against the imported server function components, and records which
 * custom-element hosts the host build admitted as compiled components
 * (rendered through `__ssr`). Every other rule — attribute-name safety, sink
 * denial, the trustedHtml boundary, the single-return grammar, the OEC
 * diagnostics — is exactly the @element class path's: one semantic authority.
 */
export interface ServerComponentBindings {
  /** The component function's single parameter (fixed `props` by admission). */
  readonly parameter: string;
  /** JSX identifier tag → the local binding the generated call targets. */
  readonly components: ReadonlyMap<string, string>;
  /** Custom-element host tags the build admitted as compiled components (`__ssr`). */
  readonly compiledTags: ReadonlySet<string>;
}

/** Lowering inputs beyond the analyzed module shape. */
export interface LoweringOptions {
  /**
   * The authored module's canonical `computed` local binding (aliases
   * followed), when present. Synthesized conditional-class factories
   * reference it; when null the emitter binds
   * {@linkcode SYNTHESIZED_COMPUTED_LOCAL} and adds the import.
   */
  readonly computedLocal: string | null;
  /**
   * Server function component mode (alpha15 server lane). Absent: the walk
   * behaves byte-identically to the @element class path.
   */
  readonly server?: ServerComponentBindings;
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

/**
 * The one boundary sentence every when-branch rejection names (alpha15):
 * a branch element admits `this.<property>` attribute sinks, but event
 * handlers, refs and inline conditional classes stay outside blocks — a
 * branch has no anchor of its own, so only attribute-bound state is
 * representable inside it.
 */
const BRANCH_BOUNDARY =
  'Block branches admit attribute bindings; events and refs stay outside blocks';

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

/**
 * Token→operator map for when-Block conditions (#1372). Only strict
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
  readonly blocks: ProgramBlockRecord[] = [];
  readonly dependencies: ProgramDependencyRecord[] = [];
  readonly locations: ProgramLocationRecord[] = [];
  readonly sourceRecords: ProgramSourceRecord[] = [];
  readonly generatedHandlers: GeneratedHandler[] = [];
  readonly fieldNames: Set<string>;
  readonly methodNames: Set<string>;
  readonly computedNames: Set<string>;
  readonly fieldTypes: Map<string, PropertyValueType>;
  /**
   * Compiler-synthesized computed fields (#1556): one per inline conditional
   * class. The caller appends them to the analyzed fields after lowering so
   * the metadata, `__compiledProps` and `__computedFields` emission treat
   * them exactly like authored computeds — the Part Program IR itself stays
   * v1 (one class Part bound to the synthesized signal).
   */
  readonly synthesizedFields: CompiledField[] = [];
  /** True when the authored module binds the canonical `computed` import. */
  readonly sourceBindsComputed: boolean;
  /**
   * The component's statically admitted class tokens (alpha15 S lane): every
   * whitespace-separated token of every compile-time `class` value the
   * lowering admits — static literals, primitive-literal attributes, both
   * branches of an admitted conditional class, and `each` item-template
   * literals. The compiler collects them as OPAQUE STRINGS: it never
   * interprets Tailwind's class grammar, and the build layer hands the list
   * to the official Tailwind compiler as explicit candidates.
   */
  readonly classCandidates = new Set<string>();
  /**
   * Server mode side tables (alpha15 server lane): the nested server function
   * component calls (element id → the recorded call shape, props entries as
   * verbatim value texts) and the custom-element hosts the build admitted as
   * compiled components (`__ssr`). The tree stays Part Program vocabulary —
   * the code generator consumes these alongside it.
   */
  readonly componentCalls = new Map<
    string,
    { component: string; propsEntries: Array<[string, string]>; children: ProgramTreeNode[] }
  >();
  readonly ssrCalls = new Set<string>();
  private readonly server?: ServerComponentBindings;
  private readonly plainFieldNames: Set<string>;
  private readonly computedFieldNames: Set<string>;
  private readonly sf: ts.SourceFile;
  private readonly options: LoweringOptions;
  private elementSerial = 0;
  private conditionalClassSerial = 0;

  constructor(
    sf: ts.SourceFile,
    fields: CompiledField[],
    methodNames: string[],
    options: LoweringOptions = { computedLocal: null },
  ) {
    this.sf = sf;
    this.fieldNames = new Set(fields.map((field) => field.name));
    this.methodNames = new Set(methodNames);
    this.computedNames = new Set(
      fields.filter((field) => field.computed).map((field) => field.name),
    );
    this.fieldTypes = new Map(fields.map((field) => [field.name, field.type]));
    this.plainFieldNames = new Set(fields.filter((field) => !field.computed).map((f) => f.name));
    this.computedFieldNames = new Set(this.computedNames);
    this.sourceBindsComputed = options.computedLocal !== null;
    this.options = options;
    this.server = options.server;
  }

  fail(node: ts.Node, code: string, message: string): never {
    throw new CompiledElementError([diagnosticAt(this.sf, node, code, message)]);
  }

  /**
   * Record one compile-time class value's whitespace-separated tokens as
   * Tailwind candidates (alpha15 S lane). The values are provably finite at
   * compile time — the compiler's grammar admits no other shape — so the
   * tokens are FACTS, not guesses: no runtime class interpolation ever
   * contributes, and the compiler attaches no Tailwind semantics to them.
   */
  private collectClassCandidates(value: string): void {
    for (const token of value.split(/\s+/)) {
      if (token !== '') this.classCandidates.add(token);
    }
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
      this.blocks.push({
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
    // Server mode: the component function's `props` parameter plays the
    // field role — the same field-name table, the same sink classification,
    // one accessor spelling difference.
    if (
      this.server !== undefined &&
      ts.isPropertyAccessExpression(value) &&
      ts.isIdentifier(value.expression) &&
      value.expression.text === this.server.parameter &&
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
    // Server function components (alpha15 server lane): an uppercase JSX tag
    // is a nested server function component — composed by a DIRECT function
    // call to the imported binding, resolved at compile time from the
    // authored imports. The class grammar rejects identifier tags
    // (composition by tag name); the server lane's composition channel is the
    // import, so the same walk branches here before the intrinsic-tag rule.
    if (this.server !== undefined && ts.isIdentifier(tagNameNode) && /^[A-Z]/.test(tag)) {
      return this.lowerComponentElement(tagNameNode, attributes, children, path, sourceNode);
    }
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
        `component tag <${tag}> is outside the compiler grammar (intrinsic lowercase elements and custom-element hosts only) — custom elements compose by tag name — use the tag string, not the class value`,
      );
    }
    const tagReason = forbiddenSinkReason('tag', tag);
    if (tagReason !== null) this.fail(tagNameNode, 'OEC9010', tagReason);
    const attrs: Array<[string, string]> = [];
    const elementId = this.reserveElement(tag, path, sourceNode);
    // Server function components: a build-admitted compiled host renders
    // through `__ssr` — the component path's literal runtime function. The
    // recording rides the ordinary host walk (attributes cross as raw props).
    if (this.server !== undefined && isCustomHost && this.server.compiledTags.has(tag)) {
      this.ssrCalls.add(elementId);
    }
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
        this.fail(
          prop,
          'OEC9011',
          'spread attributes are not supported by the compiler grammar — write each attribute ' +
            'explicitly (a literal or a this.<property> sink)',
        );
      }
      const name = this.normalizeAttributeName(prop.name.getText(this.sf));
      const init = prop.initializer;
      if (name === 'trustedHtml') continue;
      const isDynamicEvent =
        /^on[A-Z]/.test(name) &&
        init !== undefined &&
        ts.isJsxExpression(init) &&
        init.expression !== undefined;
      // Server function components render static HTML: event handlers are a
      // client-only construct, refused with the server-lane code (the class
      // path's handler lowering never runs here).
      if (this.server !== undefined && /^on[A-Z]/.test(name)) {
        this.fail(
          prop,
          'OEC9031',
          `event handlers are a client-only construct — a server function component renders ` +
            `static HTML and may not carry ${name}; interactivity belongs to an @element island ` +
            '(a compiled component), not to server markup',
        );
      }
      if (isCustomHost && (isDynamicEvent || /^on[A-Z]/.test(name))) {
        this.fail(
          prop,
          'OEC9017',
          `custom-element host <${tag}> may not carry event handlers — bind the handler on an ` +
            'intrinsic element, or attach the listener imperatively in a lifecycle method',
        );
      }
      if (!isSafeAttributeName(name) && !isDynamicEvent && name !== 'innerHTML') {
        this.fail(
          prop,
          'OEC9011',
          `attribute name "${name}" is unsafe — names must be valid HTML attribute names, not ` +
            'event handlers (on*) or forbidden sinks; use an admitted attribute name',
        );
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
        this.fail(
          prop,
          'OEC9011',
          'attribute name "innerHTML" is unsafe as a static attribute — innerHTML opens only ' +
            'through the trusted-HTML sink: bind an Object-typed trustedHtml(...) property and ' +
            'carry the literal trustedHtml marker',
        );
      }
      const attributeKey = name.toLowerCase();
      if (attributeNames.has(attributeKey)) {
        this.fail(
          prop,
          'OEC9011',
          `duplicate attribute "${name}" is unsupported — remove one; an element admits each ` +
            'attribute once',
        );
      }
      attributeNames.add(attributeKey);
      if (!init) {
        attrs.push([name, '']);
        continue;
      }
      if (ts.isStringLiteral(init)) {
        attrs.push([name, init.text]);
        if (name === 'class') this.collectClassCandidates(init.text);
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
        if (staticOnly) {
          this.fail(
            prop,
            'OEC9012',
            `${BRANCH_BOUNDARY} — an event handler cannot bind inside a branch`,
          );
        }
        this.lowerEvent(name, expr, path, prop, elementId);
        continue;
      }
      if (name === 'ref') {
        if (this.server !== undefined) {
          this.fail(
            prop,
            'OEC9031',
            'refs are a client-only construct — a server function component renders static HTML ' +
              'and may not carry a ref; element access belongs to an @element island (a compiled ' +
              'component), not to server markup',
          );
        }
        if (isCustomHost) {
          this.fail(
            prop,
            'OEC9017',
            `custom-element host <${tag}> may not carry a ref — query the host imperatively ` +
              'in a lifecycle method (e.g. connectedCallback)',
          );
        }
        if (staticOnly) {
          this.fail(prop, 'OEC9012', `${BRANCH_BOUNDARY} — a ref cannot bind inside a branch`);
        }
        const ref = this.fieldAccess(expr);
        if (!ref) this.fail(prop, 'OEC9011', 'ref must reference this.<field>');
        this.addPart({ k: 'ref', ref, path }, path, prop, elementId);
        continue;
      }
      // Inline conditional class (#1556): admitted on intrinsic elements in
      // the dynamic grammar. Block branches keep their boundary — a branch
      // admits plain attribute sinks only, and a synthesized conditional-class
      // computed is one dynamic form too many inside one — and
      // custom-element hosts keep today's diagnostics. Both fail closed here
      // with the located boundary diagnostic instead of the generic
      // unsupported-expression one.
      if (name === 'class' && ts.isConditionalExpression(expr)) {
        if (staticOnly) {
          this.fail(
            prop,
            'OEC9012',
            `${BRANCH_BOUNDARY} — an inline conditional class cannot bind inside a branch`,
          );
        }
        if (!isCustomHost) {
          this.lowerConditionalClass(expr, path, prop, elementId);
          continue;
        }
      }
      const field = this.fieldAccess(expr);
      if (field) {
        // alpha15: a when-branch element admits `this.<property>` attribute
        // sinks — the sink Part's path is branch-relative (the branch tree has
        // no anchors of its own), the runtime binds it branch-scoped, and the
        // serializer attributes it by the branch element's own id. Events and
        // refs failed above; this is the whole widening.
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
            this.fail(
              prop,
              'OEC9011',
              `property sink name "${name}" is unsafe — prototype-pollution primitives are on ` +
                'the shared deny list on every boundary; rename the attribute',
            );
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
        this.fail(
          prop,
          'OEC9011',
          `attribute "${name}" only accepts primitive literal values — use a string, number or ` +
            'boolean literal (objects and arrays have no attribute form)',
        );
      }
      if (literal === false || literal === null) continue;
      attrs.push([name, literal === true ? '' : (text ?? '')]);
      if (name === 'class' && literal !== true && text !== null) this.collectClassCandidates(text);
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

    const lowered = this.lowerChildren(children, staticOnly, path);
    if (VOID_TAGS.has(tag)) {
      const child = children.find((candidate) => hasMeaningfulJsxChild(this.sf, candidate));
      if (child) {
        this.fail(child, 'OEC9013', `void element <${tag}> may not have children`);
      }
    }
    return this.addElement(elementId, tag, attrs, lowered);
  }

  /**
   * The one children walk both the class path and the server component
   * branch share: JSX text cleaning, expression children (field read /
   * literal / when / each), nested elements, and the fragments-and-spreads
   * rejection. `elementPath` is the owning element's own address.
   */
  private lowerChildren(
    children: ts.JsxChild[],
    staticOnly: boolean,
    elementPath: number[],
  ): ProgramTreeNode[] {
    const lowered: ProgramTreeNode[] = [];
    for (const child of children) {
      const childPath = [...elementPath, lowered.length];
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
      this.fail(
        child,
        'OEC9013',
        "JSX fragments and spreads are outside the compiler grammar — wrap the fragment's " +
          'children in a single element',
      );
    }
    return lowered;
  }

  /**
   * Server function components: one uppercase JSX tag — a nested server
   * function component reference. The call composes by DIRECT function call
   * to the imported binding: attribute values cross as raw props (literals
   * or `props.<field>` reads — the callee's own compiled body escapes at its
   * sinks), and JSX children compose the `children` prop through the same
   * children walk every other element takes.
   */
  private lowerComponentElement(
    tagNameNode: ts.JsxTagNameExpression,
    attributes: ts.JsxAttributes,
    children: ts.JsxChild[],
    path: number[],
    sourceNode: ts.Node,
  ): ProgramTreeNode {
    const name = tagNameNode.getText(this.sf);
    const local = this.server!.components.get(name);
    if (local === undefined) {
      this.fail(
        tagNameNode,
        'OEC9032',
        `<${name}> is not a server function component — import it from the module that exports ` +
          'it (a server function component composes only by direct call to another server ' +
          'function component; @element components compose by tag name)',
      );
    }
    const elementId = this.reserveElement(local!, path, sourceNode);
    const propsEntries: Array<[string, string]> = [];
    for (const prop of attributes.properties) {
      if (ts.isJsxSpreadAttribute(prop)) {
        this.fail(
          prop,
          'OEC9011',
          'spread attributes are not supported by the compiler grammar — write each attribute ' +
            'explicitly (a literal or a this.<property> sink)',
        );
      }
      if (!ts.isIdentifier(prop.name)) {
        this.fail(prop, 'OEC9032', 'component prop names must be plain identifiers');
      }
      const propName = prop.name.text;
      if (/^on[A-Z]/.test(propName)) {
        this.fail(
          prop,
          'OEC9031',
          `event handlers are a client-only construct — a server function component renders ` +
            `static HTML and may not carry ${propName}; interactivity belongs to an @element ` +
            'island (a compiled component), not to server markup',
        );
      }
      const initializer = prop.initializer;
      if (initializer === undefined) {
        propsEntries.push([propName, 'true']);
        continue;
      }
      if (ts.isStringLiteral(initializer)) {
        propsEntries.push([propName, JSON.stringify(initializer.text)]);
        continue;
      }
      if (!ts.isJsxExpression(initializer) || !initializer.expression) {
        this.fail(
          prop,
          'OEC9032',
          `component prop "${propName}" must be a literal or a props.<field> read`,
        );
      }
      const expr = unwrapExpression(initializer.expression!);
      const field = this.fieldAccess(expr);
      if (field !== null) {
        propsEntries.push([propName, `${this.server!.parameter}.${field}`]);
        continue;
      }
      const literal = literalValue(expr, this.sf);
      if (literal === undefined) {
        this.fail(
          prop,
          'OEC9032',
          `component prop "${propName}" must be a literal or a props.<field> read — arbitrary ` +
            'expressions are outside the server function grammar',
        );
      }
      propsEntries.push([propName, JSON.stringify(literal)]);
    }
    const childNodes = this.lowerChildren(children, false, path);
    this.componentCalls.set(elementId, { component: local!, propsEntries, children: childNodes });
    // The tree node is a placeholder: the code generator emits the recorded
    // call, never a tag.
    return this.addElement(elementId, local!, [], []);
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

  /**
   * Inline conditional class (#1556): `class={this.<cond> ? 'a' : 'b'}` is
   * authoring sugar for a computed field bound to the element's class Part —
   * exactly the shape the author would hand-write as
   * `@property({ reflect: false, attribute: false }) x = computed(() => ...)`
   * plus `class={x}`. The lowering therefore reuses the computed-field
   * machinery end to end: the condition validates under the same body grammar
   * (only `this.<declared plain property>` reads; module-scope values pass
   * through), the synthesized factory rides the existing `__computedFields`
   * emission, and the Part Program stays v1 — one `class` Part whose signal
   * is the synthesized computed signal. No runtime or IR shape changes; the
   * serialized class value and its reactivity are the existing class-Part
   * and computed-signal semantics on every execution mode.
   *
   * Both branches must be string literals (the class-attribute text); an
   * empty string is the idiomatic off-branch. Everything else fails closed
   * with OEC9011 — no runtime fallback (P2). A condition reading no declared
   * property would emit a computed entry with an empty dep list, which the
   * wire validator rejects, so it fails here at the source.
   */
  private lowerConditionalClass(
    expr: ts.ConditionalExpression,
    path: number[],
    sourceNode: ts.Node,
    elementId: string,
  ): void {
    for (const branch of [expr.whenTrue, expr.whenFalse]) {
      const value = unwrapExpression(branch);
      if (!ts.isStringLiteral(value) && !ts.isNoSubstitutionTemplateLiteral(value)) {
        this.fail(
          sourceNode,
          'OEC9011',
          "conditional class branches must be string literals: class={this.<cond> ? 'a' : 'b'}",
        );
      }
      // Both branches are compile-time literals: the compiler's own grammar
      // makes the candidate set provably finite, so both ride the Tailwind
      // candidates (alpha15 S lane) exactly like a static class attribute.
      this.collectClassCandidates(value.text);
    }
    const { deps, bodyText } = validateComputedExpressionBody(
      expr,
      this.sf,
      this.plainFieldNames,
      this.computedFieldNames,
      (node, code, message) => this.fail(node, code, message),
      {
        actor: 'conditional class conditions',
        single: 'conditional class condition',
        plural: 'conditional class conditions',
      },
      this.server === undefined ? undefined : { parameter: this.server.parameter },
    );
    if (deps.length === 0) {
      this.fail(
        sourceNode,
        'OEC9011',
        `conditional class conditions must read at least one ${
          this.server === undefined ? 'this' : this.server.parameter
        }.<property>`,
      );
    }
    const computedName = this.options.computedLocal ?? SYNTHESIZED_COMPUTED_LOCAL;
    let name = `__compiledClass${this.conditionalClassSerial++}`;
    while (this.methodNames.has(name) || this.fieldNames.has(name)) name = `_${name}`;
    this.fieldNames.add(name);
    this.computedNames.add(name);
    // The synthesized declaration has no authored PropertyDeclaration; the
    // conditional expression is the truthful origin for every consumer (the
    // property source record and the emission mapping). The prototype-linked
    // shim projects `name`/`initializer` onto it and inherits the node's own
    // position/text accessors.
    const node = Object.assign(Object.create(expr), {
      name: expr,
      initializer: expr,
    }) as unknown as ts.PropertyDeclaration;
    this.synthesizedFields.push({
      name,
      reflect: false,
      attribute: null,
      type: 'string',
      converter: 'string',
      typeConstructor: 'String',
      accessibility: '',
      typeText: '',
      initializerText: '',
      defaultValue: null,
      node,
      computed: { deps, factoryText: `(__s) => ${computedName}(() => ${bodyText})`, body: expr },
    });
    this.addPart({ k: 'class', signal: name, path }, path, sourceNode, elementId);
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
        this.fail(
          sourceNode,
          'OEC9026',
          `void element <${tag}> cannot carry an innerHTML sink — move the sink to a ` +
            'container element (e.g. <div>)',
        );
      }
      this.addPart({ k: 'html', signal, path }, path, sourceNode, elementId);
      return;
    }
    if (BOOLEAN_ATTRIBUTES.has(lowerName)) {
      if (forbiddenSinkReason('bool', name) !== null) {
        this.fail(
          sourceNode,
          'OEC9011',
          `attribute name "${name}" is unsafe — names must be valid HTML attribute names, not ` +
            'event handlers (on*) or forbidden sinks; use an admitted attribute name',
        );
      }
      this.addPart({ k: 'bool', signal, name, path }, path, sourceNode, elementId);
      return;
    }
    if (name === 'value' || DOM_PROPERTY_NAMES.has(name) || (tag === 'input' && name === 'value')) {
      if (forbiddenSinkReason('prop', name) !== null) {
        this.fail(
          sourceNode,
          'OEC9011',
          `property sink name "${name}" is unsafe — prototype-pollution primitives are on the ` +
            'shared deny list on every boundary; rename the sink',
        );
      }
      this.addPart({ k: 'prop', signal, name, path }, path, sourceNode, elementId);
      return;
    }
    if (forbiddenSinkReason('attr', name) !== null) {
      this.fail(
        sourceNode,
        'OEC9011',
        `attribute name "${name}" is unsafe — names must be valid HTML attribute names, not ` +
          'event handlers (on*) or forbidden sinks; use an admitted attribute name',
      );
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
    // Server function components: the composition channel is the `children`
    // prop — an UNDECLARED read gets its own fix instead of the generic
    // unsupported-expression rejection; a declared read lowers through the
    // ordinary field path and the code generator emits it raw (compiler-
    // produced final HTML).
    if (
      this.server !== undefined &&
      ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === this.server.parameter &&
      expr.name.text === 'children' &&
      !this.fieldNames.has('children')
    ) {
      this.fail(
        child,
        'OEC9032',
        `${this.server.parameter}.children is not declared — add \`children?: string\` to the ` +
          'props type: the JSX children a caller nests compose it as one final-HTML string',
      );
    }
    const field = this.fieldAccess(expr);
    if (field) {
      // alpha15 widened branches to admit this.<property> attribute sinks; text
      // interpolation is the one binding a branch still cannot carry, so the
      // message names the now-legal attribute spelling (#1614).
      if (staticOnly) {
        this.fail(
          child,
          'OEC9012',
          `${BRANCH_BOUNDARY} — a branch cannot interpolate text; bind the value as an ` +
            'attribute (e.g. data-label={this.<property>})',
        );
      }
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
        this.fail(child, 'OEC9012', 'nested Blocks are outside the compiler grammar');
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
        this.fail(child, 'OEC9012', 'nested Blocks are outside the compiler grammar');
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
      'conditional Blocks support this.<property> compared with a numeric literal (>, >=, <, <=), ' +
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
        // The branch root's address within the branch node list — the same
        // node-list indexing the main template root uses ([0]). Branch sinks
        // derive their runtime/serializer addresses from it, and the branch
        // element locations record the same convention.
        [0],
        branch,
        true,
      );
    }
    if (ts.isJsxSelfClosingElement(branch)) {
      return this.lowerElement(branch.tagName, branch.attributes, [], [0], branch, true);
    }
    // The two near-misses an author (or agent) actually writes get their own
    // nearest-legal-spelling hint (#1614): a nested ternary fails because one
    // Block carries one condition, and a text-only ternary fails because a
    // Block swaps elements, not text — both resolve through computed(...).
    if (ts.isConditionalExpression(branch)) {
      this.fail(
        near,
        'OEC9012',
        'nested ternaries are outside the compiler grammar — one condition per Block; derive ' +
          'the decision in a computed(...) property and branch on it',
      );
    }
    if (literalValue(branch, this.sf) !== undefined) {
      this.fail(
        near,
        'OEC9012',
        'a text-only ternary is not a Block — Blocks swap elements; derive the text in a ' +
          'computed(...) property and interpolate {this.<property>}',
      );
    }
    this.fail(
      near,
      'OEC9012',
      'conditional Block branches must be single static JSX elements — each branch is exactly ' +
        'one element (bind its values as this.<property> attributes)',
    );
  }

  private lowerEach(expr: ts.CallExpression, near: ts.Node, path: number[]): ProgramTreeNode {
    const callee = expr.expression;
    if (
      !ts.isPropertyAccessExpression(callee) ||
      callee.name.text !== 'map' ||
      expr.arguments.length !== 1
    ) {
      this.fail(near, 'OEC9013', 'list Blocks support exactly this.<property>.map(...)');
    }
    const signal = this.fieldAccess(callee.expression);
    if (!signal) this.fail(near, 'OEC9013', 'list Blocks must map over this.<property>');
    const arrow = expr.arguments[0];
    if (
      !ts.isArrowFunction(arrow) ||
      arrow.parameters.length !== 1 ||
      !ts.isIdentifier(arrow.parameters[0].name)
    ) {
      this.fail(near, 'OEC9013', 'list Block mapper must be a single-parameter arrow function');
    }
    if (ts.isBlock(arrow.body)) {
      this.fail(near, 'OEC9013', 'list Block mapper must return one JSX element');
    }
    const body = unwrapExpression(arrow.body);
    if (!ts.isJsxElement(body) && !ts.isJsxSelfClosingElement(body)) {
      this.fail(near, 'OEC9013', 'list Block mapper must return one JSX element');
    }
    const param = arrow.parameters[0].name.text;
    const attributes = ts.isJsxElement(body) ? body.openingElement.attributes : body.attributes;
    let key: string | null = null;
    for (const prop of attributes.properties) {
      if (!ts.isJsxAttribute(prop)) {
        this.fail(
          prop,
          'OEC9011',
          'list Block items do not support spread attributes — write each attribute ' +
            'explicitly (a literal or {<item>.<field>})',
        );
      }
      if (prop.name.getText(this.sf) !== 'key') continue;
      if (key !== null) this.fail(prop, 'OEC9014', 'list Block items may declare key only once');
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
    if (!key) this.fail(body, 'OEC9014', 'list Block items require key={<item>.<field>}');

    const itemFields: string[] = [];
    // Per-item event bindings (#1556 IR v2): `on<event>={this.<method>}` (or a
    // single-action arrow) inside the item template lowers to ItemEventBinding
    // entries on the each part — the runtime attaches them per item and
    // dispatches with (event, item), the same action union as fixed event
    // parts.
    const itemEvents: ItemEventBinding[] = [];
    const item = this.lowerItemElement(body, param, itemFields, [], true, itemEvents, '');
    const uniqueFields = [...new Set(itemFields)];
    if (uniqueFields.length === 0) {
      this.fail(
        body,
        'OEC9013',
        'list Block items must bind at least one {<item>.<field>} value or attribute slot',
      );
    }
    const index = this.addPart(
      {
        k: 'each',
        signal: signal!,
        key: key!,
        // Single-field templates keep the Block-level field restatement;
        // multi-field templates omit it — every ival/iattrs slot owns its own.
        ...(uniqueFields.length === 1 ? { field: uniqueFields[0] } : {}),
        item: [item],
        ...(itemEvents.length > 0 ? { itemEvents } : {}),
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
    itemEvents?: ItemEventBinding[],
    selector = '',
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
      this.fail(
        tagName,
        'OEC9010',
        'list Block item must be an intrinsic lowercase element or a custom-element host — ' +
          'compose by tag name, not class values',
      );
    }
    const itemTagReason = forbiddenSinkReason('tag', tag);
    if (itemTagReason !== null) this.fail(tagName, 'OEC9010', itemTagReason);
    const elementId = this.reserveElement(tag, path, element);
    const attrs: Array<[string, string]> = [];
    const iattrs: Array<[string, string]> = [];
    const attributeNames = new Set<string>();
    for (const prop of attributes.properties) {
      if (!ts.isJsxAttribute(prop)) {
        this.fail(
          prop,
          'OEC9011',
          'spread attributes are not supported in item templates — write each attribute ' +
            'explicitly (a literal or {<item>.<field>})',
        );
      }
      const name = this.normalizeAttributeName(prop.name.getText(this.sf));
      if (name === 'key') {
        if (!allowKey) {
          this.fail(prop, 'OEC9011', 'key is only supported on the list Block item root');
        }
        continue;
      }
      // Event-handler attributes (`on<event>={...}`) are not wire attributes —
      // they lower to ItemEventBinding entries below, so they take the same
      // exemption from the attribute-name safety check the fixed-element
      // path grants dynamic events.
      const isItemEvent =
        /^on[A-Z]/.test(name) &&
        prop.initializer !== undefined &&
        ts.isJsxExpression(prop.initializer) &&
        prop.initializer.expression !== undefined;
      if (!isSafeAttributeName(name) && !isItemEvent) {
        this.fail(
          prop,
          'OEC9011',
          `attribute name "${name}" is unsafe — names must be valid HTML attribute names, not ` +
            'event handlers (on*) or forbidden sinks; use an admitted attribute name',
        );
      }
      const attributeKey = name.toLowerCase();
      if (attributeNames.has(attributeKey)) {
        this.fail(
          prop,
          'OEC9011',
          `duplicate attribute "${name}" is unsupported — remove one; an element admits each ` +
            'attribute once',
        );
      }
      attributeNames.add(attributeKey);
      if (!prop.initializer) {
        attrs.push([name, '']);
        continue;
      }
      if (ts.isStringLiteral(prop.initializer)) {
        attrs.push([name, prop.initializer.text]);
        if (name === 'class') this.collectClassCandidates(prop.initializer.text);
        continue;
      }
      if (!ts.isJsxExpression(prop.initializer) || !prop.initializer.expression) {
        this.fail(
          prop,
          'OEC9011',
          `item template attribute "${name}" must be a static literal or {${param}.<field>}`,
        );
      }
      // Per-item event handlers (#1556 IR v2): `on<event>={this.<method>}` (or
      // a single-action arrow) lowers to an ItemEventBinding on the each part
      // instead of a fixed-path event Part — the runtime re-attaches it per
      // item and dispatches with (event, item). Custom-element hosts inside
      // item templates stay handler-free, matching the host rule above.
      if (/^on[A-Z]/.test(name)) {
        if (this.server !== undefined) {
          this.fail(
            prop,
            'OEC9031',
            `event handlers are a client-only construct — a server function component renders ` +
              `static HTML and may not carry ${name}; interactivity belongs to an @element island ` +
              '(a compiled component), not to server markup',
          );
        }
        if (isCustomHost) {
          this.fail(
            prop,
            'OEC9017',
            `custom-element host <${tag}> may not carry event handlers — bind the handler on an ` +
              'intrinsic element, or attach the listener imperatively in a lifecycle method',
          );
        }
        if (itemEvents === undefined) {
          this.fail(
            prop,
            'OEC9012',
            'event handlers are only supported on list Block item templates',
          );
        }
        const action = this.eventAction(unwrapExpression(prop.initializer.expression), prop);
        itemEvents.push({
          event: name.slice(2).toLowerCase(),
          handler: action.handler,
          action: action.action,
          ...(selector ? { selector } : {}),
        });
        continue;
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
        this.fail(
          prop,
          'OEC9011',
          'item template attributes must use primitive literals — use a string, number or ' +
            `boolean literal, or bind {${param}.<field>}`,
        );
      }
      if (literal === false || literal === null) continue;
      attrs.push([name, literal === true ? '' : (text ?? '')]);
      if (name === 'class' && literal !== true && text !== null) this.collectClassCandidates(text);
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
    let elementChildIndex = 0;
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
        // Structural selector for nested item-event targets (#1556 IR v2):
        // `:nth-child` counts element siblings only, and item templates are
        // static, so the element position is a compile-time constant. The
        // root binding carries no selector.
        const childSelector = `${selector || ':scope'} > *:nth-child(${elementChildIndex + 1})`;
        children.push(
          this.lowerItemElement(
            child,
            param,
            itemFields,
            childPath,
            false,
            itemEvents,
            childSelector,
          ),
        );
        elementChildIndex += 1;
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
