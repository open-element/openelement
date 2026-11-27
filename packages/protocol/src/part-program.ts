/** Shared server JSX node and binding records, root modes, and generated host markers. */

import { VOID_TAGS } from './void-tags.ts';

export { VOID_TAGS };

/** How the compiled component attaches its root: light DOM or a shadow root. */
export type RootMode = 'light' | 'shadow-open' | 'shadow-closed';

/** The JSON-serializable value shape a compiled property default admits. */
export type SerializableValue =
  | null
  | boolean
  | number
  | string
  | SerializableValue[]
  | { [key: string]: SerializableValue };

/** Exact compiler-owned location for one dynamic sink or range anchor. */
export interface ProgramLocation {
  id: string;
  kind: 'anchor' | 'sink';
  path: number[];
  node?: string;
}

/** A static element node of the program tree. */
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

/** A static text node of the program tree. */
export interface ProgramTextNode {
  k: 'text';
  value: string;
}

/** The anchor node marking where a part binds in the tree. */
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

/** The discriminated union of static tree nodes. */
export type ProgramTreeNode =
  | ProgramElementNode
  | ProgramTextNode
  | ProgramPartAnchorNode
  | ProgramItemValueNode;

/** A text interpolation part bound to one signal. */
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

/** A style binding part. */
export interface ProgramStylePart {
  k: 'style';
  index: number;
  signal: string;
  path: number[];
  location: ProgramLocation;
}

/**
 * Trusted-HTML content sink (alpha.9). The signal value must carry
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

/** The action one event part dispatches. */
export type ProgramEventAction =
  | { kind: 'method'; name: string }
  | { kind: 'call'; name: string }
  | { kind: 'increment' | 'decrement'; signal: string }
  | { kind: 'assign'; signal: string; value: SerializableValue }
  | { kind: 'add' | 'subtract'; signal: string; value: number };

/** An event binding part: listener wiring between DOM event and action. */
export interface ProgramEventPart {
  k: 'event';
  index: number;
  event: string;
  handler: string;
  action: ProgramEventAction;
  path: number[];
  location: ProgramLocation;
}

/** The comparison operators a program condition supports. */
export type ConditionOperator =
  | 'greater-than'
  | 'greater-or-equal'
  | 'less-than'
  | 'less-or-equal'
  | 'equals'
  | 'not-equals'
  | 'truthy';

/** One condition clause of a when part. */
export interface ProgramCondition {
  signal: string;
  op: ConditionOperator;
  value: number | string | boolean;
}

/**
 * Operator and literal compatibility for conditions in server JSX:
 * - ordering operators require a finite numeric literal;
 * - `equals`/`not-equals` admit a finite number, string, or boolean;
 * - `truthy` admits exactly `true` or `false` (the recorded expectation).
 */
export function conditionLiteralAllowed(op: unknown, value: unknown): boolean {
  switch (op) {
    case 'greater-than':
    case 'greater-or-equal':
    case 'less-than':
    case 'less-or-equal':
      return typeof value === 'number' && Number.isFinite(value);
    case 'equals':
    case 'not-equals':
      if (typeof value === 'number') return Number.isFinite(value);
      return typeof value === 'string' || typeof value === 'boolean';
    case 'truthy':
      return value === true || value === false;
    default:
      return false;
  }
}

/** A conditional part: swaps template branches on a condition. */
export interface ProgramWhenPart {
  k: 'when';
  index: number;
  signal: string;
  test: ProgramCondition;
  on: ProgramTreeNode[];
  off: ProgramTreeNode[];
  location: ProgramLocation;
}

/**
 * An event binding scoped to each item of an `each` block. The runtime
 * attaches this listener to every item root node created by the block,
 * making per-item handlers (onClick={this.select(row.id)}) expressible
 * without fixed-path event parts.
 */
export interface ItemEventBinding {
  /** DOM event name ('click', 'input', …). */
  event: string;
  /** Handler method name on the compiled class. */
  handler: string;
  /** The action to dispatch, same union as fixed event parts. */
  action: ProgramEventAction;
  /**
   * Optional child selector within the item template (e.g. '.probe-button').
   * When omitted, the listener attaches to the item root.
   */
  selector?: string;
}

/** A list part: repeats its template node per item of a bound signal. */
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
  /** Per-item event bindings (#1556 IR v2): listeners attached to each item. */
  itemEvents?: ItemEventBinding[];
  location: ProgramLocation;
}

/** The discriminated union of dynamic parts a program instantiates. */
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

/** The serialized value-type tag of a compiled property default. */
export type PropertyValueType = 'string' | 'number' | 'boolean' | 'array' | 'object';

/** Marks generated stylesheet links at the beginning of an adopted template. */
export const STATIC_STYLES_MARKER = 'data-oe-static-styles';

/** Marks a server-rendered light root whose child nodes the element can claim. */
export const DATA_OE_LIGHT = 'data-oe-light';
