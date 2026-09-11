/**
 * @openelement/element — serializable Part Program v1.
 *
 * This is the compiler-side copy of the exchange artifact. It intentionally
 * has no import edge to the element runtime: the generated JSON is the seam
 * shared by server serialization, fresh DOM creation and existing-DOM claim.
 * Every dynamic location receives a compiler-owned identity. Runtime code does
 * not discover bindings by walking a VNode or a generic DOM tree.
 */

export const PART_PROGRAM_VERSION = 1 as const;

export type RootMode = 'light' | 'shadow-open' | 'shadow-closed';

export interface ProgramRoot {
  id: 'root';
  kind: RootMode;
  nodes: string[];
}

export type SerializableValue =
  | null
  | boolean
  | number
  | string
  | SerializableValue[]
  | { [key: string]: SerializableValue };

export interface ProgramPosition {
  offset: number;
  line: number;
  column: number;
}

export interface ProgramSourceRange {
  file: string;
  start: ProgramPosition;
  end: ProgramPosition;
}

export type ProgramSourceKind =
  | 'root'
  | 'element'
  | 'part'
  | 'region'
  | 'property'
  | 'handler';

export interface ProgramSourceRecord {
  id: string;
  kind: ProgramSourceKind;
  source: ProgramSourceRange;
}

export interface ProgramSourceMap {
  version: 1;
  file: string;
  records: ProgramSourceRecord[];
}

/** Exact compiler-owned location for one dynamic sink or range anchor. */
export interface ProgramLocation {
  id: string;
  kind: 'anchor' | 'sink';
  path: number[];
  node?: string;
}

/** A location record also makes the identity auditable without inspecting parts. */
export type ProgramLocationRecord =
  | { id: string; kind: 'element'; tag: string; path: number[] }
  | { id: string; kind: 'anchor'; part: number; path: number[] }
  | { id: string; kind: 'sink'; part: number; node: string; path: number[] };

export interface ProgramElementNode {
  k: 'el';
  id: string;
  tag: string;
  attrs: Array<[string, string]>;
  /**
   * Per-item attribute slots ([name, itemField]) — valid only inside an
   * `each` item template. At mount/claim time the value resolves from the
   * current item: `true` emits a bare attribute, `false`/`null`/`undefined`
   * omit it, anything else serializes with String().
   */
  iattrs?: Array<[string, string]>;
  children: ProgramTreeNode[];
}

export interface ProgramTextNode {
  k: 'text';
  value: string;
}

export interface ProgramPartAnchorNode {
  k: 'part';
  id: string;
  index: number;
}

/**
 * Item-value text slot; valid only inside an `each` item template. `field`
 * names the item field rendered by this slot — multi-field item templates
 * carry one slot per field, and the compiler always emits it.
 */
export interface ProgramItemValueNode {
  k: 'ival';
  field: string;
}

export type ProgramTreeNode =
  | ProgramElementNode
  | ProgramTextNode
  | ProgramPartAnchorNode
  | ProgramItemValueNode;

export interface ProgramTextPart {
  k: 'text';
  index: number;
  signal: string;
  location: ProgramLocation;
}

/** DOM property sink bound to a Signal; `path` is retained for seed consumers. */
export interface ProgramPropPart {
  k: 'prop';
  index: number;
  signal: string;
  name: string;
  path: number[];
  location: ProgramLocation;
}

/** String attribute sink bound to a Signal. */
export interface ProgramAttrPart {
  k: 'attr';
  index: number;
  signal: string;
  name: string;
  path: number[];
  location: ProgramLocation;
}

/** Boolean attribute sink bound to a Signal. */
export interface ProgramBoolPart {
  k: 'bool';
  index: number;
  signal: string;
  name: string;
  path: number[];
  location: ProgramLocation;
}

/** Specialized fixed sinks make ownership explicit for class and style text. */
export interface ProgramClassPart {
  k: 'class';
  index: number;
  signal: string;
  path: number[];
  location: ProgramLocation;
}

export interface ProgramStylePart {
  k: 'style';
  index: number;
  signal: string;
  path: number[];
  location: ProgramLocation;
}

/**
 * Trusted-HTML content sink (ADR-0150 alpha.9). The signal value must carry
 * the runtime TrustedHtml capability; its HTML replaces the target
 * element's content. The target's subtree is opaque to the claim path. The
 * compiler emits this only for an explicit `innerHTML={this.<field>}` sink on
 * an otherwise childless element — there is no implicit or discovery path to
 * raw HTML.
 */
export interface ProgramHtmlPart {
  k: 'html';
  index: number;
  signal: string;
  path: number[];
  location: ProgramLocation;
}

/** A named ref slot is serializable; the generated class supplies the ref value. */
export interface ProgramRefPart {
  k: 'ref';
  index: number;
  ref: string;
  path: number[];
  location: ProgramLocation;
}

export type ProgramEventAction =
  | { kind: 'method'; name: string }
  | { kind: 'call'; name: string }
  | { kind: 'increment' | 'decrement'; signal: string }
  | { kind: 'assign'; signal: string; value: SerializableValue }
  | { kind: 'add' | 'subtract'; signal: string; value: number };

export interface ProgramEventPart {
  k: 'event';
  index: number;
  event: string;
  handler: string;
  action: ProgramEventAction;
  path: number[];
  location: ProgramLocation;
}

export type ConditionOperator = 'greater-than';

export interface ProgramCondition {
  signal: string;
  op: ConditionOperator;
  value: number;
}

export interface ProgramWhenPart {
  k: 'when';
  index: number;
  signal: string;
  test: ProgramCondition;
  on: ProgramTreeNode[];
  off: ProgramTreeNode[];
  location: ProgramLocation;
}

export interface ProgramEachPart {
  k: 'each';
  index: number;
  signal: string;
  key: string;
  /**
   * Restatement of the item field for single-field templates; omitted when
   * the item template binds multiple fields (each `ival`/`iattrs` slot then
   * carries its own field).
   */
  field?: string;
  item: ProgramTreeNode[];
  location: ProgramLocation;
}

export type ProgramPart =
  | ProgramTextPart
  | ProgramPropPart
  | ProgramAttrPart
  | ProgramBoolPart
  | ProgramClassPart
  | ProgramStylePart
  | ProgramHtmlPart
  | ProgramRefPart
  | ProgramEventPart
  | ProgramWhenPart
  | ProgramEachPart;

export interface ProgramRegionRecord {
  id: string;
  index: number;
  kind: 'when' | 'each';
  anchor: string;
  end: string;
  source: string;
}

export interface ProgramDependencyRecord {
  signal: string;
  owner: { kind: 'part' | 'region'; index: number };
  location: string;
}

export type PropertyValueType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface CompiledPropertyMetadata {
  name: string;
  attribute: string | null;
  type: PropertyValueType;
  converter: PropertyValueType;
  reflect: boolean;
  default: SerializableValue;
  /**
   * True for computed fields (`= computed(() => ...)` in the source): their
   * signal is derived from other property signals by the generated
   * `__computedFields` factory, never seeded from attributes/props. Always
   * paired with `attribute: null` and `reflect: false`.
   */
  computed?: boolean;
  /** Source signal names a computed field reads (declaration order). */
  deps?: string[];
}

export interface CemPropertyMetadata {
  name: string;
  fieldName: string;
  type: PropertyValueType;
  attribute: string | null;
  reflect: boolean;
}

export interface CompiledCemMetadata {
  tagName: string;
  className: string;
  declaration: { name: string; module: string };
  attributes: Array<{ name: string; fieldName: string; type: PropertyValueType; reflect: boolean }>;
  members: CemPropertyMetadata[];
}

export interface CompiledElementMetadata {
  tag: string;
  className: string;
  sourceFile: string;
  properties: CompiledPropertyMetadata[];
  observedAttributes: string[];
  cem: CompiledCemMetadata;
}

/** The one deterministic program consumed by all execution modes. */
export interface PartProgramV1 {
  version: typeof PART_PROGRAM_VERSION;
  tag: string;
  root: ProgramRoot;
  template: ProgramTreeNode[];
  parts: ProgramPart[];
  regions: ProgramRegionRecord[];
  dependencies: ProgramDependencyRecord[];
  locations: ProgramLocationRecord[];
  sourceMap: ProgramSourceMap;
  metadata: CompiledElementMetadata;
}

export type PartProgram = PartProgramV1;

/** Anchor marker payloads shared by seed runtime consumers. */
export function partAnchorMarker(index: number): string {
  return `oe:p${index}`;
}

export function partAnchorEndMarker(index: number): string {
  return `oe:/p${index}`;
}

function fail(reason: string): never {
  throw new Error(`[compiled-program] invalid Part Program v1: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) fail(`${where}.${key} is not part of Part Program v1`);
  }
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => Number.isInteger(entry) && entry >= 0);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function isAttributeName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(value) &&
    !/^on/i.test(value);
}

// Mechanical mirror of the canonical VOID_TAGS in @openelement/element
// src/internal/core/html-escape.ts (issue #1220, M4): this exchange artifact
// intentionally has no import edge (ADR-0148: the semantic core stays
// bundler-neutral and inside the core), so the tag list is duplicated here
// and must stay byte-identical to the canonical definition (the convergence
// guard test enforces that). Exported for compile.ts.
export const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function samePath(left: unknown, right: number[]): boolean {
  return isIntegerArray(left) && JSON.stringify(left) === JSON.stringify(right);
}

function isSerializable(value: unknown, seen = new Set<unknown>()): value is SerializableValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((entry) => isSerializable(entry, seen));
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every((entry) => isSerializable(entry, seen));
}

function validatePosition(value: unknown, where: string): void {
  if (!isRecord(value)) fail(`${where} must be a position object`);
  validateKeys(value, ['offset', 'line', 'column'], where);
  const offset = value.offset;
  const line = value.line;
  const column = value.column;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    fail(`${where}.offset must be non-negative`);
  }
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
    fail(`${where}.line must be positive`);
  }
  if (typeof column !== 'number' || !Number.isInteger(column) || column < 1) {
    fail(`${where}.column must be positive`);
  }
}

function validateSourceRange(value: unknown, where: string): void {
  if (!isRecord(value) || typeof value.file !== 'string' || value.file.length === 0) {
    fail(`${where} must contain a source file`);
  }
  validateKeys(value, ['file', 'start', 'end'], where);
  validatePosition(value.start, `${where}.start`);
  validatePosition(value.end, `${where}.end`);
  const start = value.start as Record<string, unknown>;
  const end = value.end as Record<string, unknown>;
  if ((end.offset as number) < (start.offset as number)) fail(`${where} end precedes start`);
}

function validateTreeNodes(
  nodes: unknown,
  where: string,
  allowAnchors: boolean,
  allowItemValues: boolean,
  elementIds: Set<string>,
  anchorIds: Map<number, string>,
  elementLocations: Map<string, { tag: string; path: number[] }>,
  pathPrefix: number[] = [],
  rootPath: number[] | undefined = undefined,
): asserts nodes is ProgramTreeNode[] {
  if (!Array.isArray(nodes)) fail(`${where} must be an array`);
  for (const [position, rawNode] of nodes.entries()) {
    if (!isRecord(rawNode)) fail(`${where}[${position}] must be an object`);
    switch (rawNode.k) {
      case 'el': {
        validateKeys(
          rawNode,
          ['k', 'id', 'tag', 'attrs', 'iattrs', 'children'],
          `${where}[${position}]`,
        );
        if (typeof rawNode.id !== 'string' || !/^e\d+$/.test(rawNode.id)) {
          fail(`${where}[${position}] element needs a stable eN id`);
        }
        if (elementIds.has(rawNode.id)) {
          fail(`${where}[${position}] duplicates element ${rawNode.id}`);
        }
        elementIds.add(rawNode.id);
        if (
          typeof rawNode.tag !== 'string' ||
          !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(rawNode.tag)
        ) {
          fail(`${where}[${position}].tag must be a lowercase element tag`);
        }
        elementLocations.set(rawNode.id, {
          tag: rawNode.tag,
          path: position === 0 && rootPath !== undefined
            ? [...rootPath]
            : [...pathPrefix, position],
        });
        if (!Array.isArray(rawNode.attrs)) fail(`${where}[${position}].attrs must be an array`);
        const attributeNames = new Set<string>();
        for (const [attrPosition, attr] of rawNode.attrs.entries()) {
          if (
            !Array.isArray(attr) || attr.length !== 2 || typeof attr[0] !== 'string' ||
            typeof attr[1] !== 'string'
          ) {
            fail(`${where}[${position}].attrs[${attrPosition}] must be a [name, value] pair`);
          }
          if (!isAttributeName(attr[0])) {
            fail(`${where}[${position}].attrs[${attrPosition}] has an unsafe name`);
          }
          if (attributeNames.has(attr[0].toLowerCase())) {
            fail(`${where}[${position}].attrs[${attrPosition}] duplicates attribute ${attr[0]}`);
          }
          attributeNames.add(attr[0].toLowerCase());
        }
        if (rawNode.iattrs !== undefined) {
          if (!allowItemValues) {
            fail(`${where}[${position}].iattrs item attribute slots need an each item template`);
          }
          if (!Array.isArray(rawNode.iattrs)) {
            fail(`${where}[${position}].iattrs must be an array`);
          }
          for (const [slotPosition, slot] of rawNode.iattrs.entries()) {
            if (
              !Array.isArray(slot) || slot.length !== 2 || typeof slot[0] !== 'string' ||
              typeof slot[1] !== 'string'
            ) {
              fail(`${where}[${position}].iattrs[${slotPosition}] must be a [name, field] pair`);
            }
            if (!isAttributeName(slot[0])) {
              fail(`${where}[${position}].iattrs[${slotPosition}] has an unsafe name`);
            }
            if (slot[0].toLowerCase() === 'key') {
              fail(`${where}[${position}].iattrs[${slotPosition}] may not bind the item key`);
            }
            if (!isIdentifier(slot[1])) {
              fail(`${where}[${position}].iattrs[${slotPosition}] field must be an identifier`);
            }
            if (attributeNames.has(slot[0].toLowerCase())) {
              fail(
                `${where}[${position}].iattrs[${slotPosition}] duplicates static attribute ${
                  slot[0]
                }`,
              );
            }
            attributeNames.add(slot[0].toLowerCase());
          }
        }
        if (!Array.isArray(rawNode.children)) {
          fail(`${where}[${position}].children must be an array`);
        }
        if (VOID_TAGS.has(rawNode.tag) && rawNode.children.length > 0) {
          fail(`${where}[${position}] void elements may not have children`);
        }
        validateTreeNodes(
          rawNode.children,
          `${where}[${position}].children`,
          allowAnchors,
          allowItemValues,
          elementIds,
          anchorIds,
          elementLocations,
          position === 0 && rootPath !== undefined ? [...rootPath] : [...pathPrefix, position],
        );
        break;
      }
      case 'text':
        validateKeys(rawNode, ['k', 'value'], `${where}[${position}]`);
        if (typeof rawNode.value !== 'string' || rawNode.value.length === 0) {
          fail(`${where}[${position}].value must be a non-empty string`);
        }
        break;
      case 'part': {
        validateKeys(rawNode, ['k', 'id', 'index'], `${where}[${position}]`);
        if (!allowAnchors) fail(`${where}[${position}] may not contain a part anchor`);
        const index = rawNode.index;
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
          fail(`${where}[${position}].index must be a non-negative integer`);
        }
        if (rawNode.id !== `p${index}`) {
          fail(`${where}[${position}] id must match its part index`);
        }
        if (anchorIds.has(index)) fail(`${where} duplicates part ${index}`);
        anchorIds.set(index, rawNode.id);
        break;
      }
      case 'ival':
        validateKeys(rawNode, ['k', 'field'], `${where}[${position}]`);
        if (!allowItemValues) fail(`${where}[${position}] may not contain an item value slot`);
        if (!isIdentifier(rawNode.field)) fail(`${where}[${position}].field must be an identifier`);
        break;
      default:
        fail(`${where}[${position}] has unknown node kind ${String(rawNode.k)}`);
    }
  }
}

function validateLocation(value: unknown, where: string): asserts value is ProgramLocation {
  if (!isRecord(value)) fail(`${where} must be a location object`);
  validateKeys(
    value,
    value.kind === 'sink' ? ['id', 'kind', 'path', 'node'] : ['id', 'kind', 'path'],
    where,
  );
  if (typeof value.id !== 'string' || !/^p\d+$/.test(value.id)) fail(`${where}.id is invalid`);
  if (value.kind !== 'anchor' && value.kind !== 'sink') fail(`${where}.kind is invalid`);
  if (!isIntegerArray(value.path)) fail(`${where}.path must be non-negative child indices`);
  if (value.kind === 'sink' && (typeof value.node !== 'string' || !/^e\d+$/.test(value.node))) {
    fail(`${where}.node must name a stable element id`);
  }
}

function validateCondition(value: unknown, where: string): asserts value is ProgramCondition {
  if (
    !isRecord(value) || !isIdentifier(value.signal) || value.op !== 'greater-than' ||
    typeof value.value !== 'number' || !Number.isFinite(value.value)
  ) {
    fail(`${where} supports only greater-than with a finite numeric value`);
  }
  validateKeys(value, ['signal', 'op', 'value'], where);
}

function validateItemValueFields(
  nodes: ProgramTreeNode[],
  field: string | undefined,
  where: string,
): void {
  nodes.forEach((node, position) => {
    if (node.k === 'ival') {
      // A Region-level `field` restatement (single-field templates) constrains
      // every slot; multi-field templates omit it and slots own their fields.
      if (field !== undefined && node.field !== field) {
        fail(`${where}[${position}] must use item field ${field}`);
      }
      return;
    }
    if (node.k === 'el') {
      validateItemValueFields(node.children, field, `${where}[${position}].children`);
    }
  });
}

function validatePartPath(
  template: ProgramTreeNode[],
  path: unknown,
  where: string,
  elementIds: Set<string>,
): string {
  if (!isIntegerArray(path) || path.length === 0) fail(`${where}.path must target an element`);
  let nodes = template;
  let node: ProgramTreeNode | undefined;
  for (const index of path) {
    node = nodes[index];
    if (!node) fail(`${where}.path [${path.join(',')}] is unresolved`);
    nodes = node.k === 'el' ? node.children : [];
  }
  if (!node || node.k !== 'el') fail(`${where}.path must target an element`);
  if (!elementIds.has(node.id)) fail(`${where}.path targets an unknown element`);
  return node.id;
}

function validateAnchorPath(
  template: ProgramTreeNode[],
  path: unknown,
  partIndex: number,
  where: string,
): void {
  if (!isIntegerArray(path) || path.length === 0) {
    fail(`${where}.path must target a template anchor`);
  }
  let nodes = template;
  let node: ProgramTreeNode | undefined;
  for (const [position, index] of path.entries()) {
    node = nodes[index];
    if (!node) fail(`${where}.path [${path.join(',')}] is unresolved`);
    if (position < path.length - 1) {
      if (node.k !== 'el') fail(`${where}.path must target a template anchor`);
      nodes = node.children;
    }
  }
  if (!node || node.k !== 'part' || node.index !== partIndex || node.id !== `p${partIndex}`) {
    fail(`${where}.path must target anchor p${partIndex}`);
  }
}

function validateFixedPartPath(
  template: ProgramTreeNode[],
  path: number[],
  where: string,
): void {
  let nodes = template;
  for (const target of path) {
    for (let sibling = 0; sibling < target; sibling++) {
      if (nodes[sibling]?.k === 'part') {
        fail(`${where}.path is preceded by a dynamic anchor`);
      }
    }
    const next = nodes[target];
    nodes = next?.k === 'el' ? next.children : [];
  }
}

function hasSignal(
  part: ProgramPart,
): part is
  | ProgramTextPart
  | ProgramPropPart
  | ProgramAttrPart
  | ProgramBoolPart
  | ProgramClassPart
  | ProgramStylePart
  | ProgramHtmlPart
  | ProgramWhenPart
  | ProgramEachPart {
  return part.k === 'text' || part.k === 'prop' || part.k === 'attr' || part.k === 'bool' ||
    part.k === 'class' || part.k === 'style' || part.k === 'html' || part.k === 'when' ||
    part.k === 'each';
}

function isRegion(part: ProgramPart): part is ProgramWhenPart | ProgramEachPart {
  return part.k === 'when' || part.k === 'each';
}

function validateEventAction(value: unknown, where: string): void {
  if (!isRecord(value) || typeof value.kind !== 'string') fail(`${where} must be an event action`);
  if (value.kind === 'method' || value.kind === 'call') {
    validateKeys(value, ['kind', 'name'], where);
    if (!isIdentifier(value.name)) fail(`${where}.name must be an identifier`);
    return;
  }
  if (value.kind === 'increment' || value.kind === 'decrement') {
    validateKeys(value, ['kind', 'signal'], where);
    if (!isIdentifier(value.signal)) fail(`${where}.signal must be an identifier`);
    return;
  }
  if (value.kind === 'assign') {
    validateKeys(value, ['kind', 'signal', 'value'], where);
    if (!isIdentifier(value.signal) || !isSerializable(value.value)) {
      fail(`${where} assign action needs a signal and serializable value`);
    }
    return;
  }
  if (value.kind === 'add' || value.kind === 'subtract') {
    validateKeys(value, ['kind', 'signal', 'value'], where);
    if (
      !isIdentifier(value.signal) || typeof value.value !== 'number' ||
      !Number.isFinite(value.value)
    ) {
      fail(`${where} arithmetic action is invalid`);
    }
    return;
  }
  fail(`${where} has unknown action kind ${value.kind}`);
}

/**
 * Validate an unknown value as a Part Program v1. The validator is intentionally
 * strict: unknown instruction kinds, missing ownership records and unsafe paths
 * fail before a runtime can guess at their meaning.
 */
export function validatePartProgram(raw: unknown): asserts raw is PartProgram {
  if (!isRecord(raw)) fail('program must be an object');
  validateKeys(raw, [
    'version',
    'tag',
    'root',
    'template',
    'parts',
    'regions',
    'dependencies',
    'locations',
    'sourceMap',
    'metadata',
  ], 'program');
  if (raw.version !== PART_PROGRAM_VERSION) fail('version must be 1');
  if (typeof raw.tag !== 'string' || !/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(raw.tag)) {
    fail('tag must be a custom-element tag name');
  }
  if (!isRecord(raw.root) || raw.root.id !== 'root') fail('root must be a root record');
  validateKeys(raw.root, ['id', 'kind', 'nodes'], 'root');
  if (
    raw.root.kind !== 'light' && raw.root.kind !== 'shadow-open' &&
    raw.root.kind !== 'shadow-closed'
  ) {
    fail('root.kind is unsupported');
  }
  if (!Array.isArray(raw.root.nodes) || raw.root.nodes.some((id) => typeof id !== 'string')) {
    fail('root.nodes must list element ids');
  }

  const elementIds = new Set<string>();
  const anchorIds = new Map<number, string>();
  const elementLocations = new Map<string, { tag: string; path: number[] }>();
  validateTreeNodes(
    raw.template,
    'template',
    true,
    false,
    elementIds,
    anchorIds,
    elementLocations,
  );
  const topLevelElements = (raw.template as ProgramTreeNode[])
    .filter((node): node is ProgramElementNode => node.k === 'el')
    .map((node) => node.id);
  if (JSON.stringify(raw.root.nodes) !== JSON.stringify(topLevelElements)) {
    fail('root.nodes must match top-level template elements in order');
  }

  if (!Array.isArray(raw.parts)) fail('parts must be an array');
  const parts = raw.parts as ProgramPart[];
  const anchorPartCounts = new Map<number, number>();
  parts.forEach((part, position) => {
    if (!isRecord(part)) fail(`parts[${position}] must be an object`);
    if (part.index !== position) fail(`parts[${position}].index must equal its position`);
    validateLocation(part.location, `parts[${position}].location`);
    if (part.location.id !== `p${position}`) fail(`parts[${position}].location id is out of order`);
    switch (part.k) {
      case 'text':
        validateKeys(part, ['k', 'index', 'signal', 'location'], `parts[${position}]`);
        if (!isIdentifier(part.signal)) fail(`parts[${position}].signal must be an identifier`);
        if (part.location.kind !== 'anchor') fail(`parts[${position}] text must own an anchor`);
        validateAnchorPath(
          raw.template as ProgramTreeNode[],
          part.location.path,
          position,
          `parts[${position}]`,
        );
        anchorPartCounts.set(position, (anchorPartCounts.get(position) ?? 0) + 1);
        break;
      case 'prop':
      case 'attr':
      case 'bool':
        validateKeys(
          part,
          ['k', 'index', 'signal', 'name', 'path', 'location'],
          `parts[${position}]`,
        );
        if (!isIdentifier(part.signal) || typeof part.name !== 'string' || part.name.length === 0) {
          fail(`parts[${position}] ${part.k} needs signal and name`);
        }
        if (part.k === 'prop' && (!isIdentifier(part.name) || /^on/i.test(part.name))) {
          fail(`parts[${position}] prop name must be an identifier`);
        }
        if ((part.k === 'attr' || part.k === 'bool') && !isAttributeName(part.name)) {
          fail(`parts[${position}] ${part.k} name is unsafe`);
        }
        if (part.location.kind !== 'sink') fail(`parts[${position}] ${part.k} must own a sink`);
        if (
          validatePartPath(
            raw.template as ProgramTreeNode[],
            part.path,
            `parts[${position}]`,
            elementIds,
          ) !==
            part.location.node
        ) {
          fail(`parts[${position}] location node does not match path`);
        }
        if (!samePath(part.location.path, part.path)) {
          fail(`parts[${position}] location path does not match path`);
        }
        break;
      case 'class':
      case 'style':
        validateKeys(part, ['k', 'index', 'signal', 'path', 'location'], `parts[${position}]`);
        if (!isIdentifier(part.signal) || part.location.kind !== 'sink') {
          fail(`parts[${position}] ${part.k} is invalid`);
        }
        if (
          validatePartPath(
            raw.template as ProgramTreeNode[],
            part.path,
            `parts[${position}]`,
            elementIds,
          ) !==
            part.location.node
        ) {
          fail(`parts[${position}] location node does not match path`);
        }
        if (!samePath(part.location.path, part.path)) {
          fail(`parts[${position}] location path does not match path`);
        }
        break;
      case 'html': {
        validateKeys(part, ['k', 'index', 'signal', 'path', 'location'], `parts[${position}]`);
        if (!isIdentifier(part.signal) || part.location.kind !== 'sink') {
          fail(`parts[${position}] html is invalid`);
        }
        const htmlTargetId = validatePartPath(
          raw.template as ProgramTreeNode[],
          part.path,
          `parts[${position}]`,
          elementIds,
        );
        if (htmlTargetId !== part.location.node) {
          fail(`parts[${position}] location node does not match path`);
        }
        if (!samePath(part.location.path, part.path)) {
          fail(`parts[${position}] location path does not match path`);
        }
        // The HTML sink owns its target's whole content: the target must be a
        // childless element (the serializer would overwrite program children).
        let htmlTarget: ProgramTreeNode | undefined;
        let htmlNodes = raw.template as ProgramTreeNode[];
        for (const pathIndex of part.path) {
          htmlTarget = htmlNodes[pathIndex];
          htmlNodes = htmlTarget?.k === 'el' ? htmlTarget.children : [];
        }
        if (htmlTarget?.k !== 'el' || htmlTarget.children.length > 0) {
          fail(`parts[${position}] html sink target must be a childless element`);
        }
        break;
      }
      case 'ref':
        validateKeys(part, ['k', 'index', 'ref', 'path', 'location'], `parts[${position}]`);
        if (!isIdentifier(part.ref) || part.location.kind !== 'sink') {
          fail(`parts[${position}] ref is invalid`);
        }
        if (
          validatePartPath(
            raw.template as ProgramTreeNode[],
            part.path,
            `parts[${position}]`,
            elementIds,
          ) !==
            part.location.node
        ) {
          fail(`parts[${position}] location node does not match path`);
        }
        if (!samePath(part.location.path, part.path)) {
          fail(`parts[${position}] location path does not match path`);
        }
        break;
      case 'event':
        validateKeys(
          part,
          ['k', 'index', 'event', 'handler', 'action', 'path', 'location'],
          `parts[${position}]`,
        );
        if (
          !isIdentifier(part.handler) || typeof part.event !== 'string' || part.event.length === 0
        ) {
          fail(`parts[${position}] event needs event and handler`);
        }
        if (!/^[a-z][a-z0-9:-]*$/.test(part.event)) {
          fail(`parts[${position}] event name is unsafe`);
        }
        validateEventAction(part.action, `parts[${position}].action`);
        if (part.location.kind !== 'sink') fail(`parts[${position}] event must own a sink`);
        if (
          validatePartPath(
            raw.template as ProgramTreeNode[],
            part.path,
            `parts[${position}]`,
            elementIds,
          ) !==
            part.location.node
        ) {
          fail(`parts[${position}] event location node does not match path`);
        }
        if (!samePath(part.location.path, part.path)) {
          fail(`parts[${position}] location path does not match path`);
        }
        break;
      case 'when':
        validateKeys(
          part,
          ['k', 'index', 'signal', 'test', 'on', 'off', 'location'],
          `parts[${position}]`,
        );
        if (!isIdentifier(part.signal)) fail(`parts[${position}] when needs a signal`);
        if (part.location.kind !== 'anchor') fail(`parts[${position}] when must own an anchor`);
        validateCondition(part.test, `parts[${position}].test`);
        if (part.test.signal !== part.signal) fail(`parts[${position}] test signal mismatch`);
        validateTreeNodes(
          part.on,
          `parts[${position}].on`,
          false,
          false,
          elementIds,
          new Map(),
          elementLocations,
          [],
          [],
        );
        validateTreeNodes(
          part.off,
          `parts[${position}].off`,
          false,
          false,
          elementIds,
          new Map(),
          elementLocations,
          [],
          [],
        );
        validateAnchorPath(
          raw.template as ProgramTreeNode[],
          part.location.path,
          position,
          `parts[${position}]`,
        );
        anchorPartCounts.set(position, (anchorPartCounts.get(position) ?? 0) + 1);
        break;
      case 'each':
        validateKeys(
          part,
          ['k', 'index', 'signal', 'key', 'field', 'item', 'location'],
          `parts[${position}]`,
        );
        if (
          !isIdentifier(part.signal) || !isIdentifier(part.key) ||
          (part.field !== undefined && !isIdentifier(part.field))
        ) {
          fail(`parts[${position}] each needs signal and key identifiers`);
        }
        if (part.location.kind !== 'anchor') fail(`parts[${position}] each must own an anchor`);
        validateTreeNodes(
          part.item,
          `parts[${position}].item`,
          false,
          true,
          elementIds,
          new Map(),
          elementLocations,
          [],
          [],
        );
        validateItemValueFields(
          part.item,
          part.field,
          `parts[${position}].item`,
        );
        validateAnchorPath(
          raw.template as ProgramTreeNode[],
          part.location.path,
          position,
          `parts[${position}]`,
        );
        anchorPartCounts.set(position, (anchorPartCounts.get(position) ?? 0) + 1);
        break;
      default:
        fail(`parts[${position}] has unknown part kind ${String((part as { k?: unknown }).k)}`);
    }
  });

  for (const part of parts) {
    if (part.k === 'text' || part.k === 'when' || part.k === 'each') continue;
    validateFixedPartPath(raw.template as ProgramTreeNode[], part.path, `parts[${part.index}]`);
  }

  for (const [index, id] of anchorIds) {
    const part = parts[index];
    if (!part || (!isRegion(part) && part.k !== 'text')) {
      fail(`anchor ${id} must reference a text or Region part`);
    }
    if ((anchorPartCounts.get(index) ?? 0) !== 1) {
      fail(`part ${index} must have exactly one anchor`);
    }
  }
  for (const part of parts) {
    if (isRegion(part) || part.k === 'text') {
      if (!anchorIds.has(part.index)) fail(`part ${part.index} is missing its template anchor`);
    } else if (anchorIds.has(part.index)) {
      fail(`fixed part ${part.index} may not have a template anchor`);
    }
  }

  if (!Array.isArray(raw.regions)) fail('regions must be an array');
  const regions = raw.regions as ProgramRegionRecord[];
  const regionParts = parts.filter(isRegion);
  if (regions.length !== regionParts.length) {
    fail('regions must describe every Region part exactly once');
  }
  regions.forEach((region, position) => {
    if (isRecord(region)) {
      validateKeys(
        region,
        ['id', 'index', 'kind', 'anchor', 'end', 'source'],
        `regions[${position}]`,
      );
    }
    if (
      !isRecord(region) || region.id !== `r${region.index}` ||
      region.index !== regionParts[position].index ||
      (region.kind !== 'when' && region.kind !== 'each') || region.anchor !== `p${region.index}` ||
      region.end !== `p${region.index}:end` || region.source !== `p${region.index}`
    ) {
      fail(`regions[${position}] has an invalid Region record`);
    }
    if (region.kind !== regionParts[position].k) {
      fail(`regions[${position}] kind mismatches its part`);
    }
  });

  if (!Array.isArray(raw.dependencies)) fail('dependencies must be an array');
  const dependencies = raw.dependencies as ProgramDependencyRecord[];
  const dependencyOwners = new Set<string>();
  const expectedDependencyOwners = new Set(
    parts.filter(hasSignal).map((part) => `${isRegion(part) ? 'region' : 'part'}:${part.index}`),
  );
  for (const [position, dependency] of dependencies.entries()) {
    if (!isRecord(dependency) || !isIdentifier(dependency.signal) || !isRecord(dependency.owner)) {
      fail(`dependencies[${position}] is invalid`);
    }
    validateKeys(dependency, ['signal', 'owner', 'location'], `dependencies[${position}]`);
    validateKeys(dependency.owner, ['kind', 'index'], `dependencies[${position}].owner`);
    if (dependency.owner.kind !== 'part' && dependency.owner.kind !== 'region') {
      fail(`dependencies[${position}].owner.kind is invalid`);
    }
    if (!Number.isInteger(dependency.owner.index) || dependency.owner.index < 0) {
      fail(`dependencies[${position}].owner.index is invalid`);
    }
    const owner = parts[dependency.owner.index];
    if (
      !owner || !hasSignal(owner) || (isRegion(owner) ? 'region' : 'part') !== dependency.owner.kind
    ) {
      fail(`dependencies[${position}] points at a non-signal owner`);
    }
    if (owner.signal !== dependency.signal || dependency.location !== owner.location.id) {
      fail(`dependencies[${position}] does not match its owning instruction`);
    }
    const ownerKey = `${dependency.owner.kind}:${dependency.owner.index}`;
    if (dependencyOwners.has(ownerKey)) fail(`dependencies duplicate ${ownerKey}`);
    dependencyOwners.add(ownerKey);
  }
  if (dependencyOwners.size !== expectedDependencyOwners.size) {
    fail('every signal-owning instruction needs one dependency record');
  }
  for (const owner of expectedDependencyOwners) {
    if (!dependencyOwners.has(owner)) fail(`missing dependency ${owner}`);
  }

  if (!Array.isArray(raw.locations)) fail('locations must be an array');
  const locations = raw.locations as ProgramLocationRecord[];
  const locationIds = new Set<string>();
  const locationById = new Map<string, ProgramLocationRecord>();
  for (const [position, location] of locations.entries()) {
    if (!isRecord(location) || typeof location.id !== 'string' || locationIds.has(location.id)) {
      fail(`locations[${position}] must have a unique id`);
    }
    const locationKeys = location.kind === 'element'
      ? ['id', 'kind', 'tag', 'path']
      : location.kind === 'anchor'
      ? ['id', 'kind', 'part', 'path']
      : location.kind === 'sink'
      ? ['id', 'kind', 'part', 'node', 'path']
      : ['id', 'kind', 'path'];
    validateKeys(location, locationKeys, `locations[${position}]`);
    locationIds.add(location.id);
    locationById.set(location.id, location);
    if (!isIntegerArray(location.path)) fail(`locations[${position}].path is invalid`);
    if (location.kind === 'element') {
      const element = elementLocations.get(location.id);
      if (
        !element || location.tag !== element.tag || !samePath(location.path, element.path)
      ) fail(`locations[${position}] element is invalid`);
    } else if (location.kind === 'anchor') {
      const part = Number.isInteger(location.part) ? parts[location.part] : undefined;
      if (
        !part || !isRegion(part) && part.k !== 'text' || location.id !== `p${location.part}` ||
        !samePath(location.path, part.location.path)
      ) {
        fail(`locations[${position}] anchor is invalid`);
      }
    } else if (location.kind === 'sink') {
      const part = Number.isInteger(location.part) ? parts[location.part] : undefined;
      if (
        !part || isRegion(part) || part.k === 'text' || location.id !== `p${location.part}` ||
        !elementIds.has(location.node) || !samePath(location.path, part.location.path) ||
        part.location.node !== location.node
      ) {
        fail(`locations[${position}] sink is invalid`);
      }
    } else {
      fail(`locations[${position}] has an unknown kind`);
    }
  }
  for (const elementId of elementIds) {
    if (!locationIds.has(elementId)) fail(`missing location for ${elementId}`);
  }
  for (const part of parts) {
    if (!locationIds.has(part.location.id)) fail(`missing location for ${part.location.id}`);
    const location = locationById.get(part.location.id);
    if (!location || location.kind !== part.location.kind) {
      fail(`location ${part.location.id} does not match its instruction`);
    }
  }

  if (!isRecord(raw.metadata)) fail('metadata must be an object');
  const metadata = raw.metadata;
  validateKeys(
    metadata,
    ['tag', 'className', 'sourceFile', 'properties', 'observedAttributes', 'cem'],
    'metadata',
  );
  if (
    !isRecord(raw.sourceMap) || raw.sourceMap.version !== 1 ||
    raw.sourceMap.file !== metadata.sourceFile
  ) {
    fail('sourceMap must be version 1 and identify the metadata source file');
  }
  validateKeys(raw.sourceMap, ['version', 'file', 'records'], 'sourceMap');
  if (!Array.isArray(raw.sourceMap.records)) fail('sourceMap.records must be an array');
  const sourceIds = new Set<string>();
  for (const [position, record] of raw.sourceMap.records.entries()) {
    if (!isRecord(record) || typeof record.id !== 'string' || sourceIds.has(record.id)) {
      fail(`sourceMap.records[${position}] must have a unique id`);
    }
    validateKeys(record, ['id', 'kind', 'source'], `sourceMap.records[${position}]`);
    sourceIds.add(record.id);
    const kinds = new Set<ProgramSourceKind>([
      'root',
      'element',
      'part',
      'region',
      'property',
      'handler',
    ]);
    if (typeof record.kind !== 'string' || !kinds.has(record.kind as ProgramSourceKind)) {
      fail(`sourceMap.records[${position}].kind is invalid`);
    }
    validateSourceRange(record.source, `sourceMap.records[${position}].source`);
  }

  if (
    metadata.tag !== raw.tag || typeof metadata.className !== 'string' ||
    typeof metadata.sourceFile !== 'string'
  ) {
    fail('metadata identity does not match the program');
  }
  if (!Array.isArray(metadata.properties) || !Array.isArray(metadata.observedAttributes)) {
    fail('metadata properties and observedAttributes must be arrays');
  }
  const propertyTypes = new Set<PropertyValueType>([
    'string',
    'number',
    'boolean',
    'array',
    'object',
  ]);
  const metadataNames = new Set<string>();
  const metadataProperties: Array<{
    name: string;
    attribute: string | null;
    type: PropertyValueType;
    reflect: boolean;
  }> = [];
  for (const [position, property] of metadata.properties.entries()) {
    const name = isIdentifier(property && isRecord(property) ? property.name : undefined)
      ? property.name
      : '';
    const attribute = property && isRecord(property) && property.attribute !== undefined
      ? property.attribute
      : undefined;
    const type = property && isRecord(property) ? property.type : undefined;
    const converter = property && isRecord(property) ? property.converter : undefined;
    const reflect = property && isRecord(property) ? property.reflect : undefined;
    const defaultValue = property && isRecord(property) ? property.default : undefined;
    const computed = property && isRecord(property) ? property.computed : undefined;
    const deps = property && isRecord(property) ? property.deps : undefined;
    if (
      !isRecord(property) || !isIdentifier(name) || metadataNames.has(name) ||
      (attribute !== null && !isAttributeName(attribute)) ||
      (attribute === undefined) || typeof type !== 'string' ||
      !propertyTypes.has(type as PropertyValueType) ||
      typeof converter !== 'string' || !propertyTypes.has(converter as PropertyValueType) ||
      typeof reflect !== 'boolean' || !isSerializable(defaultValue)
    ) {
      fail(`metadata.properties[${position}] is invalid`);
    }
    validateKeys(
      property,
      ['name', 'attribute', 'type', 'converter', 'reflect', 'default', 'computed', 'deps'],
      `metadata.properties[${position}]`,
    );
    if (computed !== undefined) {
      // Computed fields derive their signal from other properties, so they can
      // never be attribute-backed, reflect, or carry no source list.
      if (
        computed !== true || attribute !== null || reflect !== false ||
        !Array.isArray(deps) || deps.length === 0 ||
        deps.some((dep) => !isIdentifier(dep))
      ) {
        fail(`metadata.properties[${position}].computed is invalid`);
      }
    } else if (deps !== undefined) {
      fail(`metadata.properties[${position}].deps requires computed: true`);
    }
    metadataNames.add(name);
    metadataProperties.push({
      name,
      attribute: attribute as string | null,
      type: type as PropertyValueType,
      reflect,
    });
  }
  const observed = new Set<string>();
  for (const [position, attribute] of metadata.observedAttributes.entries()) {
    if (!isAttributeName(attribute) || attribute.length === 0 || observed.has(attribute)) {
      fail(`metadata.observedAttributes[${position}] is invalid`);
    }
    observed.add(attribute);
  }
  const expectedObserved = metadataProperties.flatMap((property) =>
    property.attribute === null ? [] : [property.attribute]
  );
  if (JSON.stringify(expectedObserved) !== JSON.stringify(metadata.observedAttributes)) {
    fail('metadata.observedAttributes must match property attributes in declaration order');
  }
  const cem = metadata.cem;
  if (
    !isRecord(cem) || cem.tagName !== raw.tag || cem.className !== metadata.className ||
    !isRecord(cem.declaration) || cem.declaration.name !== metadata.className ||
    typeof cem.declaration.module !== 'string' || !Array.isArray(cem.attributes) ||
    !Array.isArray(cem.members)
  ) {
    fail('metadata.cem identity or shape is invalid');
  }
  validateKeys(
    cem,
    ['tagName', 'className', 'declaration', 'attributes', 'members'],
    'metadata.cem',
  );
  validateKeys(cem.declaration, ['name', 'module'], 'metadata.cem.declaration');
  const cemAttributes = cem.attributes;
  const expectedCemAttributes = metadataProperties.filter((property) =>
    property.attribute !== null
  );
  if (cemAttributes.length !== expectedCemAttributes.length) {
    fail('metadata.cem attributes are incomplete');
  }
  for (const [position, attribute] of cemAttributes.entries()) {
    if (
      !isRecord(attribute) || !isAttributeName(attribute.name) ||
      !isIdentifier(attribute.fieldName) ||
      typeof attribute.type !== 'string' ||
      !propertyTypes.has(attribute.type as PropertyValueType) ||
      typeof attribute.reflect !== 'boolean'
    ) {
      fail(`metadata.cem.attributes[${position}] is invalid`);
    }
    validateKeys(
      attribute,
      ['name', 'fieldName', 'type', 'reflect'],
      `metadata.cem.attributes[${position}]`,
    );
    const expected = expectedCemAttributes[position];
    if (
      attribute.name !== expected.attribute || attribute.fieldName !== expected.name ||
      attribute.type !== expected.type || attribute.reflect !== expected.reflect
    ) {
      fail(`metadata.cem.attributes[${position}] does not match property metadata`);
    }
  }
  if (cem.members.length !== metadataProperties.length) fail('metadata.cem members are incomplete');
  for (const [position, member] of cem.members.entries()) {
    if (
      !isRecord(member) || !isIdentifier(member.name) || !isIdentifier(member.fieldName) ||
      typeof member.type !== 'string' || !propertyTypes.has(member.type as PropertyValueType) ||
      (member.attribute !== null && !isAttributeName(member.attribute)) ||
      typeof member.reflect !== 'boolean'
    ) {
      fail(`metadata.cem.members[${position}] is invalid`);
    }
    validateKeys(
      member,
      ['name', 'fieldName', 'type', 'attribute', 'reflect'],
      `metadata.cem.members[${position}]`,
    );
    const expected = metadataProperties[position];
    if (
      member.name !== expected.name || member.fieldName !== expected.name ||
      member.type !== expected.type ||
      member.attribute !== expected.attribute || member.reflect !== expected.reflect
    ) {
      fail(`metadata.cem.members[${position}] does not match property metadata`);
    }
  }

  const expectedSourceIds = new Set<string>([
    'root',
    ...metadataProperties.map((property) => `property:${property.name}`),
    ...locations.map((location) => location.id),
    ...regions.map((region) => region.id),
  ]);
  for (const sourceId of expectedSourceIds) {
    if (!sourceIds.has(sourceId)) fail(`sourceMap is missing record ${sourceId}`);
  }
}
