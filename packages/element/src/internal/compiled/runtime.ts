/**
 * @openelement/element — compiled Part Program runtime (v0.44 alpha.8).
 *
 * A Part Program v1 is executed by three entry points in this file:
 * `serializeToHtml`, `createFreshDom`, and `claimExistingDom`. They share the
 * same tree/Part/Region semantics. The browser path never performs selector or
 * marker discovery: markers are emitted and claimed only at compiler-owned
 * dynamic anchors, while fixed Parts resolve their compiler-owned paths once.
 * Part `location` records are the auditable identity of those same addresses;
 * the validator proves they agree with `path` before any mode runs.
 */

import type { SignalLike, Unsubscribe } from '../protocol/signal.ts';
import { trustedHtmlValue } from '../core/security.ts';
// Canonical void-element set and attribute-escape contract (issue #1220,
// M4/L1) — single source of truth, shared with the server serializer.
import { escapeAttr, VOID_TAGS } from '../core/html-escape.ts';
// Canonical text-node escape contract (#1272) — shared with the server
// serializer; do not reintroduce a private copy.
import { escapeText } from './escape-text.ts';
import { noteCompiledProgramActivated } from '../signal/selection.ts';
import {
  partAnchorEndMarker,
  partAnchorMarker,
  type PartProgramV1,
  type ProgramAttrPart,
  type ProgramBoolPart,
  type ProgramClassPart,
  type ProgramEachPart,
  type ProgramElementNode,
  type ProgramEventPart,
  type ProgramHtmlPart,
  type ProgramPropPart,
  type ProgramRefPart,
  type ProgramStylePart,
  type ProgramTextPart,
  type ProgramTreeNode,
  type ProgramWhenPart,
  STATIC_STYLES_MARKER,
} from '../protocol/part-program.ts';
import { normalizePartProgram, type RuntimeProgramIR } from './runtime-program.ts';

type ProgramFixedPart = Extract<
  PartProgramV1['parts'][number],
  { k: 'attr' | 'prop' | 'bool' | 'class' | 'style' | 'html' | 'event' | 'ref' }
>;

/** Owning range a claim mismatch is attributed to: the root or one bounded Region. */
export interface RootClaimOwner {
  kind: 'root';
  root: Node;
}

export interface RegionClaimOwner {
  kind: 'region';
  parent: Node;
  anchor: Comment;
  end: Comment;
  part: ProgramWhenPart | ProgramEachPart;
}

export type ClaimOwner = RootClaimOwner | RegionClaimOwner;

/**
 * Structured diagnostic for claim-time structure/identity drift. The canonical
 * constructor contract is `(path, message, owner)`: every mismatch carries the
 * exact owning range (root or one bounded Region) so bounded `owning`
 * recovery can rebuild exactly that range — and nothing outside it.
 */
export class PartProgramClaimError extends Error {
  readonly code = 'OPEN_ELEMENT_COMPILED_CLAIM_MISMATCH';
  readonly path: string;
  readonly detail: string;
  readonly ownerKind: ClaimOwner['kind'];
  readonly owner: ClaimOwner;

  constructor(path: string, message: string, owner: ClaimOwner) {
    super(`[compiled-claim] ${path}: ${message}`);
    this.name = 'PartProgramClaimError';
    this.path = path;
    this.detail = message;
    this.ownerKind = owner.kind;
    this.owner = owner;
  }
}

export type CompiledEventHandler = (event: unknown) => void;
export type CompiledRefHandler = (element: Element | null) => void | Unsubscribe;

/** Host-provided state and behavior keyed by compiler-emitted names. */
export interface CompiledRuntimeHost {
  signals: Record<string, SignalLike<unknown>>;
  handlers: Record<string, CompiledEventHandler>;
  refs?: Record<string, CompiledRefHandler>;
}

export interface CompiledProgramInstance {
  dispose(): void;
}

/**
 * A scope is the lifetime owner for one Part or Region. Parent scopes own
 * nested scopes, so removing a Region disposes all nested subscriptions,
 * event listeners, and refs exactly once.
 */
class ResourceScope {
  #parent?: ResourceScope;
  #children = new Set<ResourceScope>();
  #cleanups: Array<() => void> = [];
  #rangeCleanups: Array<() => void> = [];
  #disposed = false;

  constructor(parent?: ResourceScope) {
    this.#parent = parent;
    if (parent) parent.#children.add(this);
  }

  child(): ResourceScope {
    return new ResourceScope(this);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  add(cleanup: () => void): void {
    if (this.#disposed) {
      cleanup();
      return;
    }
    this.#cleanups.push(cleanup);
  }

  addRangeCleanup(cleanup: () => void): void {
    if (this.#disposed) {
      cleanup();
      return;
    }
    this.#rangeCleanups.push(cleanup);
  }

  dispose(detachOwnedNodes = false): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let firstError: unknown;
    let hasError = false;

    for (const child of [...this.#children]) {
      try {
        child.dispose(detachOwnedNodes);
      } catch (error) {
        hasError = true;
        firstError ??= error;
      }
    }
    this.#children.clear();

    for (const cleanup of this.#cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        hasError = true;
        firstError ??= error;
      }
    }
    const rangeCleanups = this.#rangeCleanups.splice(0).reverse();
    if (detachOwnedNodes) {
      for (const cleanup of rangeCleanups) {
        try {
          cleanup();
        } catch (error) {
          hasError = true;
          firstError ??= error;
        }
      }
    }
    if (this.#parent) this.#parent.#children.delete(this);
    if (hasError) throw firstError;
  }
}

interface MountContext {
  program: RuntimeProgramIR;
  host: CompiledRuntimeHost;
  rootScope: ResourceScope;
  fixedPartsByPath: Map<string, ProgramFixedPart[]>;
}

function createContext(program: RuntimeProgramIR, host: CompiledRuntimeHost): MountContext {
  const fixedPartsByPath = new Map<string, ProgramFixedPart[]>();
  for (const part of program.parts) {
    if (!isFixedPart(part)) continue;
    const key = part.path.join('.');
    const list = fixedPartsByPath.get(key) ?? [];
    list.push(part);
    fixedPartsByPath.set(key, list);
  }
  return {
    program,
    host,
    rootScope: new ResourceScope(),
    fixedPartsByPath,
  };
}

function signalOf(ctx: MountContext, name: string): SignalLike<unknown> {
  const signal = ctx.host.signals[name];
  if (!signal) throw new Error(`[compiled-runtime] missing host signal "${name}"`);
  return signal;
}

/**
 * Subscribe to future writes only. Preact's adapter delivers a synchronous
 * initial effect; a conforming lazy engine may not. Only that exact
 * subscription-time echo is ignored, so a lazy engine's first real write is
 * never lost.
 */
function subscribeWrites(
  ctx: MountContext,
  scope: ResourceScope,
  name: string,
  fn: (value: unknown) => void,
): void {
  const signal = signalOf(ctx, name);
  const snapshot = signal.value;
  let subscribeReturned = false;
  const unsub = signal.subscribe((value) => {
    if (!subscribeReturned && Object.is(value, snapshot)) return;
    if (!scope.disposed) fn(value);
  });
  subscribeReturned = true;
  if (typeof unsub !== 'function') {
    throw new Error(`[compiled-runtime] signal "${name}" returned an invalid unsubscribe`);
  }
  scope.add(unsub);
}

function isFixedPart(part: PartProgramV1['parts'][number]): part is ProgramFixedPart {
  return (
    part.k === 'attr' || part.k === 'prop' || part.k === 'bool' || part.k === 'class' ||
    part.k === 'style' || part.k === 'html' || part.k === 'event' || part.k === 'ref'
  );
}

function fixedPartsAtPath(ctx: MountContext, path: number[]): ProgramFixedPart[] {
  const parts = [...(ctx.fixedPartsByPath.get(path.join('.')) ?? [])];
  return parts.sort((left, right) => left.index - right.index);
}

function isComment(node: Node): node is Comment {
  return node.nodeType === 8;
}

function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function displayValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function attributeValue(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function classValue(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(classValue).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => Boolean((value as Record<string, unknown>)[key]))
      .join(' ');
  }
  throw new Error('[compiled-runtime] class Part expects a string, array, or record');
}

function cssName(name: string): string {
  if (name.startsWith('--')) return name;
  const vendor = /^(Webkit|Moz|ms|O)([A-Z].*)$/.exec(name);
  const kebab = (value: string): string =>
    value[0].toLowerCase() +
    value.slice(1).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  if (vendor) return `-${vendor[1].toLowerCase()}-${kebab(vendor[2])}`;
  return kebab(name);
}

function styleValue(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(styleValue).filter(Boolean).join(';');
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => {
        const item = (value as Record<string, unknown>)[key];
        return item !== null && item !== undefined && item !== false;
      })
      .map((key) => `${cssName(key)}:${String((value as Record<string, unknown>)[key])}`)
      .join(';');
  }
  throw new Error('[compiled-runtime] style Part expects CSS text or a declaration record');
}

function removeNodes(nodes: readonly Node[]): void {
  for (const node of nodes) node.parentNode?.removeChild(node);
}

function insertNodesBefore(parent: Node, nodes: readonly Node[], reference: Node): void {
  for (const node of nodes) parent.insertBefore(node, reference);
}

function itemValue(part: ProgramEachPart, item: unknown, field?: string): unknown {
  const selected = field ?? part.field;
  if (selected === undefined) return item;
  if (typeof item !== 'object' || item === null) return undefined;
  return (item as Record<string, unknown>)[selected];
}

/** Per-item attribute slot value: bare when true, omitted when falsy/absent. */
function itemAttrValue(item: unknown, field: string): string | null {
  if (typeof item !== 'object' || item === null) return null;
  const value = (item as Record<string, unknown>)[field];
  if (value === true) return '';
  if (value === false || value === null || value === undefined) return null;
  return String(value);
}

function itemKey(part: ProgramEachPart, item: unknown, _index: number): string {
  if (typeof item !== 'object' || item === null) {
    throw new Error(`[compiled-runtime] each part ${part.index} keyed items must be records`);
  }
  const value = (item as Record<string, unknown>)[part.key];
  if (
    (value !== null && typeof value === 'object') || typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    throw new Error(`[compiled-runtime] each part ${part.index} keys must be serializable values`);
  }
  return `${typeof value}:${String(value)}`;
}

interface WhenRegion {
  ctx: MountContext;
  part: ProgramWhenPart;
  scope: ResourceScope;
  anchor: Comment;
  end: Comment;
  current: boolean;
  branchScope: ResourceScope;
  nodes: Node[];
  item: unknown;
  itemPart?: ProgramEachPart;
}

interface TextPartSlot {
  scope: ResourceScope;
  anchor: Comment;
  text?: Text;
  current: string;
}

interface ItemValueSlot {
  text?: Text;
  parent?: Node;
  before?: Node | null;
  position?: number;
  /** Item field this slot renders (multi-field item templates). */
  field?: string;
}

/** Per-item attribute slot tracked for keyed-reuse updates. */
interface ItemAttrSlot {
  element: Element;
  name: string;
  field: string;
}

interface EachEntry {
  key: string;
  scope: ResourceScope;
  nodes: Node[];
  valueSlots: ItemValueSlot[];
  attrSlots: ItemAttrSlot[];
}

interface EachRegion {
  ctx: MountContext;
  part: ProgramEachPart;
  scope: ResourceScope;
  anchor: Comment;
  end: Comment;
  entries: EachEntry[];
  byKey: Map<string, EachEntry>;
  item: unknown;
}

function whenActive(part: ProgramWhenPart, value: unknown): boolean {
  return Number(value) > part.test.value;
}

function mountNodes(
  ctx: MountContext,
  scope: ResourceScope,
  doc: Document,
  nodes: ProgramTreeNode[],
  item: unknown = NO_ITEM,
  itemPart?: ProgramEachPart,
  itemValueSlots?: ItemValueSlot[],
  parent?: Node,
  itemAttrSlots?: ItemAttrSlot[],
): Node[] {
  const out: Node[] = [];
  const slotStart = itemValueSlots?.length ?? 0;
  for (const node of nodes) {
    if (node.k === 'text') {
      out.push(doc.createTextNode(node.value));
      continue;
    }
    if (node.k === 'ival') {
      if (item === NO_ITEM) {
        throw new Error('[compiled-runtime] item value slot outside an each Region');
      }
      if (!itemPart) throw new Error('[compiled-runtime] item value slot has no item Region');
      const value = displayValue(itemValue(itemPart, item, node.field));
      const slot: ItemValueSlot = { parent, position: out.length, field: node.field };
      if (value.length > 0) {
        const text = doc.createTextNode(value);
        slot.text = text;
        out.push(text);
      }
      itemValueSlots?.push(slot);
      continue;
    }
    if (node.k === 'el') {
      const el = doc.createElement(node.tag);
      for (const [name, value] of node.attrs) el.setAttribute(name, value);
      if (node.iattrs !== undefined) {
        if (item === NO_ITEM || !itemPart) {
          throw new Error('[compiled-runtime] item attribute slot outside an each Region');
        }
        for (const [name, field] of node.iattrs) {
          const value = itemAttrValue(item, field);
          if (value !== null) el.setAttribute(name, value);
          itemAttrSlots?.push({ element: el, name, field });
        }
      }
      for (
        const child of mountNodes(
          ctx,
          scope,
          doc,
          node.children,
          item,
          itemPart,
          itemValueSlots,
          el,
          itemAttrSlots,
        )
      ) {
        el.appendChild(child);
      }
      out.push(el);
      continue;
    }
    out.push(...mountPart(ctx, scope, doc, node.index, item, itemPart, parent));
  }
  if (itemValueSlots && parent) {
    for (let index = slotStart; index < itemValueSlots.length; index++) {
      const slot = itemValueSlots[index];
      if (slot.parent !== parent || slot.before !== undefined) continue;
      const position = slot.position ?? out.length;
      slot.before = out[position + (slot.text ? 1 : 0)] ?? null;
    }
  }
  return out;
}

/** The sentinel distinguishes an undefined item from no item context. */
const NO_ITEM = Symbol('compiled-runtime.no-item');

function buildItem(
  ctx: MountContext,
  regionScope: ResourceScope,
  doc: Document,
  part: ProgramEachPart,
  item: unknown,
  parent?: Node,
): { nodes: Node[]; valueSlots: ItemValueSlot[]; attrSlots: ItemAttrSlot[]; scope: ResourceScope } {
  const scope = regionScope.child();
  const valueSlots: ItemValueSlot[] = [];
  const attrSlots: ItemAttrSlot[] = [];
  try {
    return {
      nodes: mountNodes(ctx, scope, doc, part.item, item, part, valueSlots, parent, attrSlots),
      valueSlots,
      attrSlots,
      scope,
    };
  } catch (error) {
    try {
      scope.dispose();
    } catch {
      // Preserve the item construction error after attempting every cleanup.
    }
    throw error;
  }
}

function buildWhen(
  ctx: MountContext,
  parentScope: ResourceScope,
  doc: Document,
  part: ProgramWhenPart,
  item: unknown,
  itemPart?: ProgramEachPart,
  parent?: Node,
): Node[] {
  const scope = parentScope.child();
  const anchor = doc.createComment(partAnchorMarker(part.index));
  const end = doc.createComment(partAnchorEndMarker(part.index));
  const current = whenActive(part, signalOf(ctx, part.signal).value);
  const region: WhenRegion = {
    ctx,
    part,
    scope,
    anchor,
    end,
    current,
    branchScope: scope.child(),
    nodes: [],
    item,
    itemPart,
  };
  scope.addRangeCleanup(() => removeNodes(region.nodes));
  region.nodes = mountNodes(
    ctx,
    region.branchScope,
    doc,
    current ? part.on : part.off,
    item,
    itemPart,
    undefined,
    parent,
  );
  subscribeWrites(ctx, scope, part.signal, (value) => updateWhen(region, value));
  return [anchor, ...region.nodes, end];
}

function updateWhen(region: WhenRegion, value: unknown): void {
  if (region.scope.disposed) return;
  const next = whenActive(region.part, value);
  if (next === region.current) return;
  const parent = region.end.parentNode;
  // A detached anchor/end pair means the Region's owning boundary is gone;
  // updates stop rather than rebuilding outside the owned range.
  if (!parent || region.anchor.parentNode !== parent) return;
  try {
    region.branchScope.dispose(true);
  } finally {
    removeNodes(region.nodes);
  }
  const branchScope = region.scope.child();
  let nodes: Node[];
  try {
    nodes = mountNodes(
      region.ctx,
      branchScope,
      region.end.ownerDocument,
      next ? region.part.on : region.part.off,
      region.item,
      region.itemPart,
      undefined,
      parent,
    );
    insertNodesBefore(parent, nodes, region.end);
  } catch (error) {
    try {
      branchScope.dispose();
    } catch {
      // Preserve the branch construction error.
    }
    region.branchScope = branchScope;
    region.nodes = [];
    region.current = next;
    throw error;
  }
  region.branchScope = branchScope;
  region.nodes = nodes;
  region.current = next;
}

function updateTextPart(slot: TextPartSlot, value: unknown): void {
  if (slot.scope.disposed) return;
  const next = displayValue(value);
  if (next === slot.current) return;
  const parent = slot.anchor.parentNode;
  if (!parent) {
    slot.current = next;
    return;
  }
  if (next.length === 0) {
    slot.text?.parentNode?.removeChild(slot.text);
    slot.text = undefined;
  } else if (slot.text) {
    slot.text.data = next;
  } else {
    slot.text = slot.anchor.ownerDocument.createTextNode(next);
    parent.insertBefore(slot.text, slot.anchor.nextSibling);
  }
  slot.current = next;
}

function buildTextPart(
  ctx: MountContext,
  parentScope: ResourceScope,
  doc: Document,
  part: ProgramTextPart,
): Node[] {
  const scope = parentScope.child();
  const anchor = doc.createComment(partAnchorMarker(part.index));
  const current = displayValue(signalOf(ctx, part.signal).value);
  const slot: TextPartSlot = {
    scope,
    anchor,
    text: current.length > 0 ? doc.createTextNode(current) : undefined,
    current,
  };
  scope.addRangeCleanup(() => {
    slot.text?.parentNode?.removeChild(slot.text);
    slot.text = undefined;
  });
  subscribeWrites(ctx, scope, part.signal, (value) => updateTextPart(slot, value));
  return [anchor, ...(slot.text ? [slot.text] : [])];
}

function buildEach(
  ctx: MountContext,
  parentScope: ResourceScope,
  doc: Document,
  part: ProgramEachPart,
  parent?: Node,
): Node[] {
  const scope = parentScope.child();
  const anchor = doc.createComment(partAnchorMarker(part.index));
  const end = doc.createComment(partAnchorEndMarker(part.index));
  const region: EachRegion = {
    ctx,
    part,
    scope,
    anchor,
    end,
    entries: [],
    byKey: new Map(),
    item: NO_ITEM,
  };
  scope.addRangeCleanup(() => {
    for (const entry of region.entries) removeNodes(entry.nodes);
  });
  const value = signalOf(ctx, part.signal).value;
  if (!Array.isArray(value)) {
    throw new Error(`[compiled-runtime] each part ${part.index} expects an array signal`);
  }
  const nodes: Node[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const key = itemKey(part, value[index], index);
    if (seen.has(key)) {
      throw new Error(`[compiled-runtime] each part ${part.index} has duplicate key`);
    }
    seen.add(key);
    const entry = buildItem(ctx, scope, doc, part, value[index], parent);
    const stored = {
      key,
      scope: entry.scope,
      nodes: entry.nodes,
      valueSlots: entry.valueSlots,
      attrSlots: entry.attrSlots,
    };
    region.entries.push(stored);
    region.byKey.set(key, stored);
    nodes.push(...entry.nodes);
  }
  subscribeWrites(ctx, scope, part.signal, (next) => updateEach(region, next));
  return [anchor, ...nodes, end];
}

function recordDirectItemValueNode(entry: EachEntry, slot: ItemValueSlot, text: Text): void {
  const parent = slot.parent;
  if (!parent) return;
  const hasDirectEntryNode = entry.nodes.some((node) => node.parentNode === parent);
  if (!hasDirectEntryNode && entry.nodes.length > 0) return;
  if (entry.nodes.includes(text)) return;

  const reference = slot.before;
  const position = reference ? entry.nodes.indexOf(reference) : -1;
  if (position >= 0) entry.nodes.splice(position, 0, text);
  else entry.nodes.push(text);
}

function insertItemValue(
  entry: EachEntry,
  slotIndex: number,
  text: Text,
  regionParent: Node,
  regionReference: Node,
): void {
  const slot = entry.valueSlots[slotIndex];
  const parent = slot.parent;
  if (!parent) return;

  let reference: Node | null = null;
  for (let index = slotIndex + 1; index < entry.valueSlots.length; index++) {
    const later = entry.valueSlots[index].text;
    if (later?.parentNode === parent) {
      reference = later;
      break;
    }
  }
  if (!reference && slot.before?.parentNode === parent) reference = slot.before;
  if (!reference && parent === regionParent && regionReference.parentNode === parent) {
    reference = regionReference;
  }
  if (reference) parent.insertBefore(text, reference);
  else parent.appendChild(text);
  recordDirectItemValueNode(entry, slot, text);
}

function removeItemValue(entry: EachEntry, slot: ItemValueSlot, text: Text): void {
  const replacement = slot.before ?? null;
  text.parentNode?.removeChild(text);
  for (const other of entry.valueSlots) {
    if (other.before === text) other.before = replacement;
  }
  const position = entry.nodes.indexOf(text);
  if (position >= 0) entry.nodes.splice(position, 1);
  slot.text = undefined;
}

function updateItemValues(
  part: ProgramEachPart,
  entry: EachEntry,
  item: unknown,
  regionParent: Node,
  regionReference: Node,
): void {
  for (const [index, slot] of entry.valueSlots.entries()) {
    const next = displayValue(itemValue(part, item, slot.field));
    if (next.length === 0) {
      if (slot.text) removeItemValue(entry, slot, slot.text);
      continue;
    }
    if (slot.text) {
      if (slot.text.data !== next) slot.text.data = next;
      continue;
    }
    const parent = slot.parent ?? regionParent;
    slot.parent = parent;
    const document = parent.ownerDocument;
    if (!document) throw new Error('[compiled-runtime] item value slot has no owner document');
    const text = document.createTextNode(next);
    slot.text = text;
    insertItemValue(entry, index, text, regionParent, regionReference);
  }
  for (const slot of entry.attrSlots) {
    const next = itemAttrValue(item, slot.field);
    if (next === null) {
      if (slot.element.hasAttribute(slot.name)) slot.element.removeAttribute(slot.name);
    } else if (slot.element.getAttribute(slot.name) !== next) {
      slot.element.setAttribute(slot.name, next);
    }
  }
}

function disposeEntry(entry: EachEntry): void {
  try {
    entry.scope.dispose(true);
  } finally {
    removeNodes(entry.nodes);
  }
}

function moveEntries(region: EachRegion, parent: Node, entries: EachEntry[]): void {
  let cursor: Node = region.anchor.nextSibling ?? region.end;
  for (const entry of entries) {
    for (const node of entry.nodes) {
      if (node === cursor) {
        cursor = node.nextSibling ?? region.end;
      } else {
        parent.insertBefore(node, cursor);
        cursor = node.nextSibling ?? region.end;
      }
    }
  }
}

function updateEach(region: EachRegion, value: unknown): void {
  if (region.scope.disposed) return;
  if (!Array.isArray(value)) {
    throw new Error(`[compiled-runtime] each part ${region.part.index} expects an array signal`);
  }
  const parent = region.end.parentNode;
  // A detached anchor/end pair means the Region's owning boundary is gone;
  // updates stop rather than rebuilding outside the owned range.
  if (!parent || region.anchor.parentNode !== parent) return;

  const descriptors: Array<{ key: string; item: unknown; existing?: EachEntry }> = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    const key = itemKey(region.part, item, index);
    if (seen.has(key)) {
      throw new Error(`[compiled-runtime] each part ${region.part.index} has duplicate key`);
    }
    seen.add(key);
    descriptors.push({ key, item, existing: region.byKey.get(key) });
  }

  const created: EachEntry[] = [];
  try {
    for (const descriptor of descriptors) {
      if (descriptor.existing) continue;
      const built = buildItem(
        region.ctx,
        region.scope,
        region.end.ownerDocument,
        region.part,
        descriptor.item,
        parent,
      );
      const entry = { key: descriptor.key, ...built };
      descriptor.existing = entry;
      created.push(entry);
    }
  } catch (error) {
    for (const entry of created) disposeEntry(entry);
    throw error;
  }

  for (const entry of region.entries) {
    if (seen.has(entry.key)) continue;
    disposeEntry(entry);
  }
  const nextEntries = descriptors.map((descriptor) => descriptor.existing!);
  for (let descriptorIndex = 0; descriptorIndex < descriptors.length; descriptorIndex++) {
    const descriptor = descriptors[descriptorIndex];
    if (descriptor.existing && !created.includes(descriptor.existing)) {
      let regionReference: Node = region.end;
      for (let nextIndex = descriptorIndex + 1; nextIndex < nextEntries.length; nextIndex++) {
        const nextNode = nextEntries[nextIndex].nodes.find((node) => node.parentNode === parent);
        if (nextNode) {
          regionReference = nextNode;
          break;
        }
      }
      updateItemValues(region.part, descriptor.existing, descriptor.item, parent, regionReference);
    }
  }
  region.entries = nextEntries;
  region.byKey = new Map(nextEntries.map((entry) => [entry.key, entry]));
  moveEntries(region, parent, nextEntries);
}

function mountPart(
  ctx: MountContext,
  parentScope: ResourceScope,
  doc: Document,
  index: number,
  item: unknown,
  itemPart?: ProgramEachPart,
  parent?: Node,
): Node[] {
  const part = ctx.program.parts[index];
  if (!part) throw new Error(`[compiled-runtime] missing Part ${index}`);
  if (part.k === 'text') return buildTextPart(ctx, parentScope, doc, part);
  if (part.k === 'when') return buildWhen(ctx, parentScope, doc, part, item, itemPart, parent);
  if (part.k === 'each') return buildEach(ctx, parentScope, doc, part, parent);
  throw new Error(`[compiled-runtime] fixed Part ${part.index} cannot be used as an anchor`);
}

/** Resolve a compiler-owned static path without any selector/discovery walk. */
function resolvePath(
  root: Node,
  path: number[],
  where: string,
  rootOffset = 0,
): Element {
  // Program paths are relative to the template node list: the first index
  // selects a child of the mount root (the sole template root element lives at
  // path [0]). The validator rejects empty paths, so every path walks at least
  // once into the template.
  if (path.length === 0) {
    throw new Error(`[compiled-runtime] ${where}: path [] unresolved`);
  }
  let node: Node = root;
  for (let depth = 0; depth < path.length; depth++) {
    const index = path[depth] + (depth === 0 ? rootOffset : 0);
    const child = node.childNodes[index];
    if (!child) throw new Error(`[compiled-runtime] ${where}: path [${path.join(',')}] unresolved`);
    node = child;
  }
  if (!isElement(node)) {
    throw new Error(`[compiled-runtime] ${where}: path [${path.join(',')}] is not an element`);
  }
  return node;
}

interface PropertySink extends Element {
  [property: string]: unknown;
}

function propertySink(element: Element): PropertySink {
  return element as PropertySink;
}

function applyProperty(element: Element, name: string, value: unknown, initial: boolean): void {
  const sink = propertySink(element);
  if (initial) {
    const serialized = attributeValue(value);
    if (serialized === null) element.removeAttribute(name);
    else element.setAttribute(name, serialized);
  }
  sink[name] = value;
}

function applyAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function applyBoolean(element: Element, name: string, value: boolean): void {
  propertySink(element)[name] = value;
  if (value) element.setAttribute(name, '');
  else element.removeAttribute(name);
}

function installValuePart(
  ctx: MountContext,
  root: Node,
  part:
    | ProgramAttrPart
    | ProgramPropPart
    | ProgramBoolPart
    | ProgramClassPart
    | ProgramStylePart
    | ProgramHtmlPart,
  mode: 'fresh' | 'claim',
  rootOffset = 0,
): void {
  const element = resolvePath(root, part.path, `${part.k} Part`, rootOffset);
  const scope = ctx.rootScope.child();
  const initial = signalOf(ctx, part.signal).value;

  if (part.k === 'html') {
    let current = trustedHtmlValue(initial);
    if (mode === 'fresh') (element as Element).innerHTML = current;
    subscribeWrites(ctx, scope, part.signal, (value) => {
      const next = trustedHtmlValue(value);
      if (Object.is(next, current)) return;
      (element as Element).innerHTML = next;
      current = next;
    });
    return;
  }

  if (part.k === 'attr') {
    let current = attributeValue(initial);
    if (mode === 'fresh') applyAttribute(element, part.name, current);
    subscribeWrites(ctx, scope, part.signal, (value) => {
      const next = attributeValue(value);
      if (Object.is(next, current)) return;
      applyAttribute(element, part.name, next);
      current = next;
    });
    return;
  }

  if (part.k === 'prop') {
    let current = initial;
    if (mode === 'fresh') applyProperty(element, part.name, current, true);
    subscribeWrites(ctx, scope, part.signal, (value) => {
      if (Object.is(value, current)) return;
      applyProperty(element, part.name, value, false);
      current = value;
    });
    return;
  }

  if (part.k === 'bool') {
    let current = Boolean(initial);
    if (mode === 'fresh') applyBoolean(element, part.name, current);
    subscribeWrites(ctx, scope, part.signal, (value) => {
      const next = Boolean(value);
      if (Object.is(next, current)) return;
      applyBoolean(element, part.name, next);
      current = next;
    });
    return;
  }

  if (part.k === 'class') {
    let current = classValue(initial);
    if (mode === 'fresh') applyAttribute(element, 'class', current || null);
    subscribeWrites(ctx, scope, part.signal, (value) => {
      const next = classValue(value);
      if (Object.is(next, current)) return;
      applyAttribute(element, 'class', next || null);
      current = next;
    });
    return;
  }

  let current = styleValue(initial);
  if (mode === 'fresh') applyAttribute(element, 'style', current || null);
  subscribeWrites(ctx, scope, part.signal, (value) => {
    const next = styleValue(value);
    if (Object.is(next, current)) return;
    applyAttribute(element, 'style', next || null);
    current = next;
  });
}

function installEventPart(
  ctx: MountContext,
  root: Node,
  part: ProgramEventPart,
  rootOffset = 0,
): void {
  const element = resolvePath(root, part.path, 'event Part', rootOffset);
  const scope = ctx.rootScope.child();
  const handler = ctx.host.handlers?.[part.handler];
  if (!handler) throw new Error(`[compiled-runtime] missing host handler "${part.handler}"`);
  const listener: EventListener = (event) => handler(event);
  element.addEventListener(part.event, listener);
  scope.add(() => element.removeEventListener(part.event, listener));
}

function installRefPart(
  ctx: MountContext,
  root: Node,
  part: ProgramRefPart,
  rootOffset = 0,
): void {
  const element = resolvePath(root, part.path, 'ref Part', rootOffset);
  const scope = ctx.rootScope.child();
  const ref = ctx.host.refs?.[part.ref];
  if (!ref) throw new Error(`[compiled-runtime] missing host ref "${part.ref}"`);
  let cleanup = ref(element);

  const detach = (): void => {
    try {
      if (typeof cleanup === 'function') cleanup();
    } finally {
      cleanup = undefined;
      ref(null);
    }
  };
  scope.add(detach);
}

function attachFixedParts(
  ctx: MountContext,
  root: Node,
  mode: 'fresh' | 'claim',
  rootOffset = 0,
): void {
  for (const part of ctx.program.parts) {
    if (
      part.k === 'attr' || part.k === 'prop' || part.k === 'bool' || part.k === 'class' ||
      part.k === 'style' || part.k === 'html'
    ) {
      installValuePart(ctx, root, part, mode, rootOffset);
    } else if (part.k === 'event') {
      installEventPart(ctx, root, part, rootOffset);
    } else if (part.k === 'ref') {
      installRefPart(ctx, root, part, rootOffset);
    }
  }
}

function instance(ctx: MountContext): CompiledProgramInstance {
  let disposed = false;
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      ctx.rootScope.dispose();
    },
  };
}

/** Fresh browser DOM creation from the validated Part Program. */
export function createFreshDom(
  program: PartProgramV1,
  host: CompiledRuntimeHost,
  root: Node,
): CompiledProgramInstance {
  noteCompiledProgramActivated();
  const ctx = createContext(normalizePartProgram(program), host);
  const doc = root.ownerDocument;
  if (!doc) throw new Error('[compiled-runtime] root must have an ownerDocument');
  if (root.childNodes.length > 0) {
    throw new Error('[compiled-runtime] fresh DOM root must be empty');
  }
  let created: Node[] = [];
  try {
    created = mountNodes(
      ctx,
      ctx.rootScope,
      doc,
      ctx.program.template,
      NO_ITEM,
      undefined,
      undefined,
      root,
    );
    for (const node of created) {
      root.appendChild(node);
    }
    attachFixedParts(ctx, root, 'fresh');
    return instance(ctx);
  } catch (error) {
    removeNodes(created);
    try {
      ctx.rootScope.dispose();
    } catch {
      // Preserve the construction error; every cleanup was still attempted.
    }
    throw error;
  }
}

// ─── Server serialization ──────────────────────────────────────────

function serializedFixedAttributes(
  ctx: MountContext,
  node: ProgramElementNode,
  path: number[],
): Array<[string, string]> {
  const attrs = new Map<string, string>();
  for (const [name, value] of node.attrs) attrs.set(name, value);
  for (const part of fixedPartsAtPath(ctx, path)) {
    if (part.k === 'attr' || part.k === 'prop') {
      const value = signalOf(ctx, part.signal).value;
      const next = attributeValue(value);
      if (next === null) attrs.delete(part.name);
      else attrs.set(part.name, next);
    } else if (part.k === 'bool') {
      const value = signalOf(ctx, part.signal).value;
      if (value) attrs.set(part.name, '');
      else attrs.delete(part.name);
    } else if (part.k === 'class') {
      const value = signalOf(ctx, part.signal).value;
      const next = classValue(value);
      if (next) attrs.set('class', next);
      else attrs.delete('class');
    } else if (part.k === 'style') {
      const value = signalOf(ctx, part.signal).value;
      const next = styleValue(value);
      if (next) attrs.set('style', next);
      else attrs.delete('style');
    }
  }
  return [...attrs.entries()];
}

function serializeElement(
  ctx: MountContext,
  node: ProgramElementNode,
  programPath: number[],
  item: unknown,
  itemPart?: ProgramEachPart,
): string {
  const attrList = serializedFixedAttributes(ctx, node, programPath);
  if (node.iattrs !== undefined) {
    if (item === NO_ITEM || !itemPart) {
      throw new Error('[compiled-runtime] item attribute slot outside an each Region');
    }
    for (const [name, field] of node.iattrs) {
      const value = itemAttrValue(item, field);
      if (value !== null) attrList.push([name, value]);
    }
  }
  const attrs = attrList.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join('');
  const open = `<${node.tag}${attrs}`;
  if (VOID_TAGS.has(node.tag)) return `${open}>`;
  const htmlSink = fixedPartsAtPath(ctx, programPath).find((part) => part.k === 'html');
  if (htmlSink && htmlSink.k === 'html') {
    const value = trustedHtmlValue(signalOf(ctx, htmlSink.signal).value);
    return `${open}>${value}</${node.tag}>`;
  }
  const children = node.children
    .map((child, index) => serializeNode(ctx, child, [...programPath, index], item, itemPart))
    .join('');
  return `${open}>${children}</${node.tag}>`;
}

function serializeNode(
  ctx: MountContext,
  node: ProgramTreeNode,
  programPath: number[],
  item: unknown = NO_ITEM,
  itemPart?: ProgramEachPart,
): string {
  if (node.k === 'text') return escapeText(node.value);
  if (node.k === 'ival') {
    if (item === NO_ITEM) {
      throw new Error('[compiled-runtime] item value slot outside an each Region');
    }
    if (!itemPart) throw new Error('[compiled-runtime] item value slot has no item Region');
    return escapeText(displayValue(itemValue(itemPart, item)));
  }
  if (node.k === 'el') return serializeElement(ctx, node, programPath, item, itemPart);

  const part = ctx.program.parts[node.index];
  if (!part) throw new Error(`[compiled-runtime] missing Part ${node.index}`);
  const open = `<!--${partAnchorMarker(part.index)}-->`;
  if (part.k === 'text') return open + escapeText(displayValue(signalOf(ctx, part.signal).value));
  const close = `<!--${partAnchorEndMarker(part.index)}-->`;
  if (part.k === 'when') {
    const branch = whenActive(part, signalOf(ctx, part.signal).value) ? part.on : part.off;
    return open + branch.map((child, index) =>
      serializeNode(ctx, child, [...programPath, index], item, itemPart)
    ).join('') +
      close;
  }
  if (part.k === 'each') {
    const value = signalOf(ctx, part.signal).value;
    if (!Array.isArray(value)) {
      throw new Error(`[compiled-runtime] each part ${part.index} expects an array signal`);
    }
    return open + value.map((entry) =>
      part.item.map((child, index) =>
        serializeNode(ctx, child, [...programPath, index], entry, part)
      ).join('')
    ).join('') + close;
  }
  throw new Error(`[compiled-runtime] fixed Part ${part.index} has no serialized anchor`);
}

/** Server serialization: the same program renders deterministic HTML. */
export function serializeToHtml(program: PartProgramV1, host: CompiledRuntimeHost): string {
  const ctx = createContext(normalizePartProgram(program), host);
  return ctx.program.template.map((node, index) => serializeNode(ctx, node, [index])).join('');
}

// ─── Existing-DOM claim ─────────────────────────────────────────────

function claimFailure(path: string, message: string, owner: ClaimOwner): never {
  throw new PartProgramClaimError(path, message, owner);
}

function expectComment(node: Node, marker: string, path: string, owner: ClaimOwner): Comment {
  if (!isComment(node) || node.data !== marker) {
    claimFailure(path, `expected <!--${marker}--> anchor`, owner);
  }
  return node;
}

function dynamicAttributeNames(ctx: MountContext, path: number[]): Set<string> {
  const names = new Set<string>();
  for (const part of fixedPartsAtPath(ctx, path)) {
    if (part.k === 'attr' || part.k === 'prop' || part.k === 'bool') names.add(part.name);
    if (part.k === 'class') names.add('class');
    if (part.k === 'style') names.add('style');
  }
  return names;
}

function claimElementAttributes(
  ctx: MountContext,
  element: Element,
  node: ProgramElementNode,
  path: string,
  programPath: number[],
  owner: ClaimOwner,
): void {
  const dynamic = dynamicAttributeNames(ctx, programPath);
  // Per-item attribute slots are verified with their item context by the
  // caller; they are not static drift.
  for (const [name] of node.iattrs ?? []) dynamic.add(name);
  for (const [name, value] of node.attrs) {
    if (dynamic.has(name)) continue;
    if (element.getAttribute(name) !== value) {
      claimFailure(path, `attribute drift on "${name}": expected ${JSON.stringify(value)}`, owner);
    }
  }
  const getNames = (element as Element & { getAttributeNames?: () => string[] }).getAttributeNames;
  if (getNames) {
    const actualNames = getNames.call(element);
    const expected = new Set(node.attrs.map(([name]) => name));
    for (const name of dynamic) expected.add(name);
    for (const name of actualNames) {
      if (
        name.toLowerCase() === 'data-oe-light' && node.children.length === 0 &&
        node.tag.includes('-') && element.getAttribute('data-oe-light') !== null
      ) continue;
      if (!expected.has(name)) claimFailure(path, `unexpected attribute "${name}"`, owner);
    }
    for (const name of expected) {
      // A dynamic sink may legitimately have no serialized attribute; its live
      // value is deliberately not read or overwritten by claim.
      if (dynamic.has(name)) continue;
      if (!actualNames.includes(name)) claimFailure(path, `missing attribute "${name}"`, owner);
    }
  }
}

function findRegionEnd(
  parent: Node,
  start: number,
  marker: string,
): Comment | undefined {
  for (let index = start; index < parent.childNodes.length; index++) {
    const node = parent.childNodes[index];
    if (isComment(node) && node.data === marker) return node;
  }
  return undefined;
}

/** Attribute a Region-internal mismatch to its bounded anchor/end range. */
function regionClaimOwner(
  parent: Node,
  start: number,
  part: ProgramWhenPart | ProgramEachPart,
  anchor: Comment,
  fallback: ClaimOwner,
): ClaimOwner {
  const end = findRegionEnd(parent, start, partAnchorEndMarker(part.index));
  return end ? { kind: 'region', parent, anchor, end, part } : fallback;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Item fields referenced by an each Region's template (ival + iattr slots). */
function itemTemplateFields(
  nodes: readonly ProgramTreeNode[],
  out = new Set<string>(),
): Set<string> {
  for (const node of nodes) {
    if (node.k === 'ival') {
      if (node.field !== undefined) out.add(node.field);
      continue;
    }
    if (node.k === 'el') {
      for (const [, field] of node.iattrs ?? []) out.add(field);
      itemTemplateFields(node.children, out);
    }
  }
  return out;
}

/**
 * Claim-time validation of one each Region's items: records with own key and
 * own template fields, no duplicate keys. Failures are structured claim
 * mismatches owned by the Region, so `owning` recovery can rebuild exactly
 * that range.
 */
function claimItemRecords(
  part: ProgramEachPart,
  value: unknown,
  path: string,
  owner: ClaimOwner,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    claimFailure(path, 'each Region dependency must contain an array', owner);
  }
  const requiredFields = itemTemplateFields(part.item);
  const seen = new Set<string>();
  const items: Array<Record<string, unknown>> = [];
  for (let index = 0; index < value.length; index++) {
    const item: unknown = value[index];
    const itemPath = `${path}[${index}]`;
    if (!isRecordValue(item)) claimFailure(itemPath, 'item must be a record', owner);
    if (!Object.prototype.hasOwnProperty.call(item, part.key)) {
      claimFailure(itemPath, `item needs ${JSON.stringify(part.key)}`, owner);
    }
    for (const field of requiredFields) {
      if (!Object.prototype.hasOwnProperty.call(item, field)) {
        claimFailure(itemPath, `item needs ${JSON.stringify(field)}`, owner);
      }
    }
    const key = itemKey(part, item, index);
    if (seen.has(key)) {
      claimFailure(path, `duplicate key ${JSON.stringify(item[part.key])}`, owner);
    }
    seen.add(key);
    items.push(item);
  }
  return items;
}

/**
 * One signal subscription deferred to the attach phase. Claim is staged: the
 * complete owned structure is validated before any subscription, listener, or
 * ref attaches, so a failed claim leaves zero live resources behind.
 */
interface DeferredSubscription {
  scope: ResourceScope;
  signal: string;
  fn: (value: unknown) => void;
}

function claimNodes(
  ctx: MountContext,
  parent: Node,
  cursor: number,
  nodes: ProgramTreeNode[],
  path: string,
  programPath: number[],
  scope: ResourceScope,
  owner: ClaimOwner,
  pending: DeferredSubscription[],
  item: unknown = NO_ITEM,
  itemPart?: ProgramEachPart,
  itemValueSlots?: ItemValueSlot[],
  itemAttrSlots?: ItemAttrSlot[],
): number {
  const at = (index: number): Node => {
    const node = parent.childNodes[index];
    if (!node) claimFailure(path, `missing child at DOM index ${index}`, owner);
    return node;
  };

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const nodePath = `${path}[${index}]`;
    const nodeProgramPath = [...programPath, index];
    if (node.k === 'text') {
      const dom = at(cursor++);
      if (!isText(dom)) claimFailure(nodePath, 'expected a text node', owner);
      if (dom.data !== node.value) {
        claimFailure(
          nodePath,
          `text drift: expected ${JSON.stringify(node.value)}, found ${JSON.stringify(dom.data)}`,
          owner,
        );
      }
      continue;
    }
    if (node.k === 'ival') {
      if (item === NO_ITEM) claimFailure(nodePath, 'item value slot outside an each Region', owner);
      if (!itemPart) claimFailure(nodePath, 'item value slot has no item Region', owner);
      const expected = displayValue(itemValue(itemPart, item, node.field));
      if (expected.length > 0) {
        const dom = at(cursor++);
        if (!isText(dom)) claimFailure(nodePath, 'expected item value text', owner);
        if (dom.data !== expected) {
          claimFailure(nodePath, `item text drift: expected ${JSON.stringify(expected)}`, owner);
        }
        itemValueSlots?.push({
          text: dom,
          parent,
          before: parent.childNodes[cursor] ?? null,
          field: node.field,
        });
      } else {
        itemValueSlots?.push({
          parent,
          before: parent.childNodes[cursor] ?? null,
          field: node.field,
        });
      }
      continue;
    }
    if (node.k === 'el') {
      const dom = at(cursor++);
      if (!isElement(dom)) claimFailure(nodePath, 'expected an element', owner);
      if (dom.tagName.toLowerCase() !== node.tag) {
        claimFailure(
          nodePath,
          `expected <${node.tag}>, found <${dom.tagName.toLowerCase()}>`,
          owner,
        );
      }
      claimElementAttributes(ctx, dom, node, nodePath, nodeProgramPath, owner);
      if (node.iattrs !== undefined) {
        // Per-item attribute slots carry the item context: values are verified
        // against the item (deterministic) and tracked for keyed-reuse updates.
        if (item === NO_ITEM || !itemPart) {
          claimFailure(nodePath, 'item attribute slot outside an each Region', owner);
        }
        for (const [name, field] of node.iattrs) {
          const expected = itemAttrValue(item, field);
          const actual = dom.getAttribute(name);
          if (expected === null ? actual !== null : actual !== expected) {
            claimFailure(
              nodePath,
              `item attribute drift on "${name}": expected ${JSON.stringify(expected)}`,
              owner,
            );
          }
          itemAttrSlots?.push({ element: dom, name, field });
        }
      }
      // A trusted-HTML sink owns the target's whole content: the subtree is
      // opaque to the claim (the program declares no structure inside it).
      const hasHtmlSink = fixedPartsAtPath(ctx, nodeProgramPath)
        .some((part) => part.k === 'html');
      const ownsExpandedSubtree = node.children.length === 0 && node.tag.includes('-') &&
        dom.getAttribute('data-oe-light') !== null;
      const ownsProjection = node.tag === 'slot' && node.children.length === 0 &&
        dom.childNodes.length > 0;
      const consumed = hasHtmlSink || ownsExpandedSubtree || ownsProjection
        ? dom.childNodes.length
        : claimNodes(
          ctx,
          dom,
          0,
          node.children,
          `${nodePath}.children`,
          nodeProgramPath,
          scope,
          owner,
          pending,
          item,
          itemPart,
          itemValueSlots,
          itemAttrSlots,
        );
      if (consumed !== dom.childNodes.length) {
        claimFailure(`${nodePath}.children`, 'unexpected trailing nodes', owner);
      }
      continue;
    }

    const part = ctx.program.parts[node.index];
    if (!part) claimFailure(nodePath, `missing Part ${node.index}`, owner);
    if (part.k === 'text') {
      const anchor = expectComment(at(cursor++), partAnchorMarker(part.index), nodePath, owner);
      const expected = displayValue(signalOf(ctx, part.signal).value);
      let text: Text | undefined;
      if (expected.length > 0) {
        const next = at(cursor++);
        if (!isText(next)) {
          claimFailure(nodePath, 'expected a text node after the part anchor', owner);
        }
        text = next;
        if (text.data !== expected) {
          claimFailure(nodePath, `part text drift: expected ${JSON.stringify(expected)}`, owner);
        }
      }
      const partScope = scope.child();
      const slot: TextPartSlot = { scope: partScope, anchor, text, current: expected };
      partScope.addRangeCleanup(() => {
        slot.text?.parentNode?.removeChild(slot.text);
        slot.text = undefined;
      });
      pending.push({
        scope: partScope,
        signal: part.signal,
        fn: (value) => updateTextPart(slot, value),
      });
      continue;
    }
    if (part.k === 'when') {
      const anchor = expectComment(at(cursor++), partAnchorMarker(part.index), nodePath, owner);
      const scopedOwner = regionClaimOwner(parent, cursor, part, anchor, owner);
      const active = whenActive(part, signalOf(ctx, part.signal).value);
      const partScope = scope.child();
      const branchScope = partScope.child();
      const before = cursor;
      cursor = claimNodes(
        ctx,
        parent,
        cursor,
        active ? part.on : part.off,
        `${nodePath}.branch`,
        // Region subtrees hold no fixed-Part targets (the validator rejects
        // fixed paths crossing or preceded by an anchor), so the recursion
        // keeps the anchor's canonical path: resetting to [] would collide
        // with template-level sink paths and misidentify dynamic attributes.
        nodeProgramPath,
        branchScope,
        scopedOwner,
        pending,
        item,
        itemPart,
        itemValueSlots,
      );
      const end = expectComment(
        at(cursor++),
        partAnchorEndMarker(part.index),
        nodePath,
        scopedOwner,
      );
      const region: WhenRegion = {
        ctx,
        part,
        scope: partScope,
        anchor,
        end,
        current: active,
        branchScope,
        nodes: Array.from(parent.childNodes).slice(before, cursor - 1),
        item,
      };
      partScope.addRangeCleanup(() => removeNodes(region.nodes));
      pending.push({
        scope: partScope,
        signal: part.signal,
        fn: (value) => updateWhen(region, value),
      });
      continue;
    }
    if (part.k === 'each') {
      const anchor = expectComment(at(cursor++), partAnchorMarker(part.index), nodePath, owner);
      const scopedOwner = regionClaimOwner(parent, cursor, part, anchor, owner);
      const items = claimItemRecords(part, signalOf(ctx, part.signal).value, nodePath, scopedOwner);
      const partScope = scope.child();
      const region: EachRegion = {
        ctx,
        part,
        scope: partScope,
        anchor,
        end: anchor,
        entries: [],
        byKey: new Map(),
        item: NO_ITEM,
      };
      partScope.addRangeCleanup(() => {
        for (const entry of region.entries) removeNodes(entry.nodes);
      });
      for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
        const currentItem = items[itemIndex];
        const key = itemKey(part, currentItem, itemIndex);
        const itemScope = partScope.child();
        const itemSlots: ItemValueSlot[] = [];
        const itemAttrs: ItemAttrSlot[] = [];
        const before = cursor;
        cursor = claimNodes(
          ctx,
          parent,
          cursor,
          part.item,
          `${nodePath}.item[${itemIndex}]`,
          // Same canonical-path rule as the when branch above: item templates
          // hold no fixed-Part targets, so the anchor path is preserved
          // instead of resetting to a colliding [].
          nodeProgramPath,
          itemScope,
          scopedOwner,
          pending,
          currentItem,
          part,
          itemSlots,
          itemAttrs,
        );
        const entry: EachEntry = {
          key,
          scope: itemScope,
          nodes: Array.from(parent.childNodes).slice(before, cursor),
          valueSlots: itemSlots,
          attrSlots: itemAttrs,
        };
        region.entries.push(entry);
        region.byKey.set(key, entry);
      }
      region.end = expectComment(
        at(cursor++),
        partAnchorEndMarker(part.index),
        nodePath,
        scopedOwner,
      );
      pending.push({
        scope: partScope,
        signal: part.signal,
        fn: (next) => updateEach(region, next),
      });
      continue;
    }
    claimFailure(nodePath, `Part ${node.index} has no claimable anchor`, owner);
  }
  return cursor;
}

// ─── Pre-upgrade event capture/replay (claim-activation helpers) ──────

export interface PreUpgradeEvent {
  readonly target: EventTarget;
  readonly type: string;
  readonly event?: Event;
  readonly init?: EventInit;
  /**
   * Capture order assigned by the page-lifetime capture that recorded this
   * event. A root replays only records that predate its first activation, so
   * a morph reconnect (cached claim activation) never re-handles an
   * interaction the live island already processed. Hand-built records omit
   * it and sort before every captured event.
   */
  readonly seq?: number;
}

export interface PreUpgradeEventCapture {
  readonly events: readonly PreUpgradeEvent[];
  stop(): void;
}

const SUPPORTED_PRE_UPGRADE_EVENTS = new Set([
  'change',
  'click',
  'input',
  'keydown',
  'keyup',
  'pointerdown',
  'pointerup',
  'submit',
]);

/**
 * Hard bound on retained pre-upgrade records per page-lifetime capture.
 * One record per target/type; hits beyond the bound fail closed (the new
 * interaction is dropped, pending replays are never evicted). 64 covers a
 * large island page (8 event types x 8 pending islands) while keeping the
 * queue provably finite in a long-lived SPA.
 *
 * ponytail: fixed cap, not LRU — evicting pending replays would silently
 * drop pre-hydration clicks; upgrade path is per-pending-root local capture
 * if a page ever legitimately exceeds this bound (no such page known).
 */
export const MAX_PRE_UPGRADE_CAPTURED_EVENTS = 64;

const consumedEventRecords = new WeakSet<object>();
const consumedEventObjects = new WeakSet<object>();
/**
 * Page-lifetime capture order. Bumped for every recorded interaction so a
 * claim root can distinguish pre-upgrade events (replayable) from
 * post-activation events the live island already handled (never replayed).
 */
let preUpgradeCaptureSequence = 0;
/**
 * First-activation cutoff per claim root. Pinned at a root's first replay
 * pass; later passes for the same root node (morph reconnect reuses the
 * cached claim activation) replay nothing newer. Keyed by root node, so a
 * nested pending island keeps its own later cutoff.
 */
const claimRootActivationSequence = new WeakMap<object, number>();

/**
 * Resolve the original interaction target for a captured event (#942).
 * Prefers the composed path head (shadow-aware) and falls back to the
 * retargeted event.target where composedPath is unavailable. Never throws:
 * a hostile or exotic event object degrades to event.target.
 */
function resolveCaptureTarget(event: Event): EventTarget | null {
  try {
    const withPath = event as Event & { composedPath?: () => EventTarget[] };
    if (typeof withPath.composedPath === 'function') {
      const path = withPath.composedPath();
      if (Array.isArray(path) && path.length > 0 && path[0]) return path[0];
    }
  } catch {
    // Fall through to event.target below.
  }
  return event.target;
}

/**
 * Island hosts that already reached their activation decision (claim or
 * fresh, success or failure). The facade marks its host element here; the
 * document-level capture then skips ordinary traffic inside settled islands
 * while still capturing for nested still-pending islands. Kernel-level
 * callers (claimExistingDom tests, non-facade hosts) never consult this set:
 * their capture contract is "everything inside the claim root".
 */
const settledIslandHosts = new WeakSet<object>();

/** Facade activation decisions land here (success or failure). */
export function markPreUpgradeIslandSettled(host: unknown): void {
  if (host && typeof host === 'object') settledIslandHosts.add(host);
}

function isIslandHostTag(node: unknown): boolean {
  try {
    const element = node as { localName?: unknown; tagName?: unknown };
    if (!element || typeof element !== 'object') return false;
    const rawName = typeof element.localName === 'string'
      ? element.localName
      : typeof element.tagName === 'string'
      ? element.tagName.toLowerCase()
      : '';
    return rawName.includes('-');
  } catch {
    return false;
  }
}

function tagNameOf(node: unknown): string {
  try {
    const element = node as { localName?: unknown; tagName?: unknown };
    if (!element || typeof element !== 'object') return '';
    if (typeof element.localName === 'string') return element.localName.toLowerCase();
    if (typeof element.tagName === 'string') return element.tagName.toLowerCase();
    return '';
  } catch {
    return '';
  }
}

function eventPathNodes(event: Event, target: EventTarget): readonly unknown[] {
  try {
    const withPath = event as Event & { composedPath?: () => unknown };
    if (typeof withPath.composedPath === 'function') {
      const path = withPath.composedPath();
      if (Array.isArray(path)) return path;
    }
  } catch {
    // Fall through to the target-ancestor walk below.
  }
  // No composedPath (older harness / exotic event): walk the target chain
  // directly, crossing shadow boundaries through hosts where visible.
  const out: unknown[] = [];
  let current: unknown = target;
  let depth = 0;
  while (current && typeof current === 'object' && depth < 1024) {
    out.push(current);
    const node = current as { parentNode?: unknown; host?: unknown };
    if (node.parentNode) current = node.parentNode;
    else if (node.host) current = node.host;
    else break;
    depth++;
  }
  return out;
}

/**
 * Facade document-capture filter: only interactions that could belong to a
 * still-pending DECLARED OpenElement island enter the queue.
 *
 * The entry's `__tags` (the generated client entry's island list) is the
 * owner: a path node counts only when its tag is in the root's declared set
 * and its host is not settled. Undeclared third-party custom elements
 * (sl-*, md-*, ion-*, ...) never enter the queue no matter how many distinct
 * targets they produce — otherwise 64 foreign targets exhaust the bounded
 * queue and a real delayed island loses its replay. Nested pending declared
 * islands still capture through a settled outer (any pending declared host
 * on the path keeps the record).
 *
 * Legacy: with no declared set (empty/omitted — direct kernel callers and
 * older ensure() calls without tags), falls back to the dash heuristic so
 * existing call sites keep working.
 */
function declaredTagCount(declaredTags: ReadonlySet<string> | readonly string[]): number {
  // Array.isArray does not narrow readonly arrays under strict settings;
  // branch on the runtime shape explicitly instead.
  if (typeof (declaredTags as ReadonlySet<string>).size === 'number') {
    return (declaredTags as ReadonlySet<string>).size;
  }
  return (declaredTags as readonly string[]).length;
}

export function acceptPendingIslandEvent(
  event: Event,
  target: EventTarget,
  declaredTags?: ReadonlySet<string> | readonly string[],
): boolean {
  try {
    const hasDeclared = declaredTags !== undefined && declaredTagCount(declaredTags) > 0;
    const path = eventPathNodes(event, target);
    if (hasDeclared) {
      const lookup = Array.isArray(declaredTags)
        ? new Set(declaredTags.map((tag) => tag.toLowerCase()))
        : declaredTags as ReadonlySet<string>;
      for (const node of path) {
        const tag = tagNameOf(node);
        if (!tag || !lookup.has(tag)) continue;
        if (!settledIslandHosts.has(node as object)) return true;
      }
      return false;
    }
    for (const node of path) {
      if (!isIslandHostTag(node)) continue;
      // A pending host anywhere on the path (delayed / idle / visible /
      // nested-late / morph-added) keeps the record capturable.
      if (!settledIslandHosts.has(node as object)) return true;
    }
    // No island host (background) or every host settled (live traffic).
    return false;
  } catch {
    // Strict mode fails closed (never let an undecodable event occupy the
    // bounded queue); legacy mode preserves the old uncertainty-captures rule.
    const hasDeclared = declaredTags !== undefined && declaredTagCount(declaredTags) > 0;
    return !hasDeclared;
  }
}

function isDetachedTarget(target: EventTarget): boolean {
  try {
    const node = target as { isConnected?: unknown };
    return (node as { isConnected?: boolean }).isConnected === false;
  } catch {
    return false;
  }
}

/**
 * Drop records whose target left the document. Detached nodes can never
 * hydrate, so holding them only leaks memory until page end.
 */
function pruneDetachedTargets(
  events: PreUpgradeEvent[],
  index: Map<EventTarget, Map<string, number>>,
): void {
  let removed = false;
  for (let position = events.length - 1; position >= 0; position--) {
    if (isDetachedTarget(events[position].target)) {
      events.splice(position, 1);
      removed = true;
    }
  }
  if (removed) rebuildCaptureIndex(events, index);
}

function rebuildCaptureIndex(
  events: PreUpgradeEvent[],
  index: Map<EventTarget, Map<string, number>>,
): void {
  index.clear();
  for (let position = 0; position < events.length; position++) {
    const record = events[position];
    let byType = index.get(record.target);
    if (!byType) {
      byType = new Map<string, number>();
      index.set(record.target, byType);
    }
    byType.set(record.type, position);
  }
}

/**
 * Capture the bounded pre-upgrade interaction set on an owning root. One
 * latest event per target/type is retained, matching the one-click-per-host
 * queue contract while keeping replay deterministic and finite.
 *
 * Boundedness (three independent mechanisms, any one suffices):
 *   1. pending-owner filter (opt-in via `options.accept`, used by the facade
 *      document capture) — only interactions that could belong to a
 *      still-pending island enter the queue; ordinary events inside
 *      already-settled islands are skipped. Kernel-level callers pass no
 *      filter and keep the "everything inside the claim root" contract;
 *   2. capacity cap — beyond MAX_PRE_UPGRADE_CAPTURED_EVENTS the incoming
 *      record is dropped (fail closed, pending replays are never evicted);
 *   3. detached prune — removed nodes are swept (on capture pressure and on
 *      every release) instead of being held to page end.
 */
export function capturePreUpgradeEvents(
  root: EventTarget,
  eventTypes: readonly string[] = [...SUPPORTED_PRE_UPGRADE_EVENTS],
  options: { accept?: (event: Event, target: EventTarget) => boolean } = {},
): PreUpgradeEventCapture {
  const events: PreUpgradeEvent[] = [];
  const index = new Map<EventTarget, Map<string, number>>();
  const listeners: Array<{ type: string; listener: EventListener }> = [];
  const replaceFor = (record: PreUpgradeEvent): void => {
    const position = index.get(record.target)?.get(record.type);
    if (position !== undefined && events[position]?.target === record.target) {
      events[position] = record;
      return;
    }
    if (events.length >= MAX_PRE_UPGRADE_CAPTURED_EVENTS) {
      // One detached sweep before failing closed: a burst of removals
      // (navigation / morph) must free budget for genuinely pending islands.
      pruneDetachedTargets(events, index);
      if (events.length >= MAX_PRE_UPGRADE_CAPTURED_EVENTS) return;
    }
    index.get(record.target)?.set(record.type, events.length) ??
      index.set(record.target, new Map([[record.type, events.length]]));
    events.push(record);
  };
  for (const type of eventTypes) {
    if (!SUPPORTED_PRE_UPGRADE_EVENTS.has(type)) continue;
    const listener: EventListener = (event) => {
      // Shadow-aware target resolution (#942): a document-level capture
      // listener observes a retargeted event.target (the outer host) when the
      // interaction originates inside an open shadow root. composedPath()[0]
      // is the original interaction target, which is what the claiming
      // island's isInsideRoot check must see. Closed shadow roots hide their
      // internals from outside composedPath() by platform design; those
      // records fail closed at replay (never misdelivered, never crashed).
      const target = resolveCaptureTarget(event);
      if (!target) return;
      // No connected check here: harness and parser flows dispatch before
      // the nodes connect (they still hydrate later). Detached fate is
      // decided at replay (fail closed, never dispatched) and at release
      // (swept, never held to page end).
      // Opt-in pending-owner filter (facade document capture only).
      if (options.accept && !options.accept(event as Event, target)) return;
      replaceFor({ target, type, event, seq: ++preUpgradeCaptureSequence });
    };
    root.addEventListener(type, listener, { capture: true });
    listeners.push({ type, listener });
  }
  let stopped = false;
  return {
    events,
    stop(): void {
      if (stopped) return;
      stopped = true;
      for (const { type, listener } of listeners) {
        root.removeEventListener(type, listener, {
          capture: true,
        });
      }
    },
  };
}

function isNodeValue(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'nodeType' in value &&
    'childNodes' in value;
}

/**
 * One step up the composed tree. ShadowRoot.parentNode is null by spec, so
 * crossing out of a shadow tree goes through its host. Both fields are
 * standard: parentNode for ordinary nodes, host for shadow roots.
 */
function composedParentNode(node: Node): Node | null {
  if (node.parentNode) return node.parentNode;
  const host = (node as { host?: unknown }).host;
  return isNodeValue(host) ? host : null;
}

/**
 * Canonical composed-tree ownership predicate shared by replay and release:
 * a target belongs to `root` when walking parentNode (crossing each shadow
 * root through its host) reaches `root`. Traversal only follows the target's
 * own ancestor chain, so unrelated shadow trees, sibling islands, and
 * detached subtrees never match.
 */
function isInsideRoot(root: Node, target: EventTarget): target is Node {
  if (!isNodeValue(target)) return false;
  let current: Node | null = target;
  while (current) {
    if (current === root) return true;
    current = composedParentNode(current);
  }
  return false;
}

function preUpgradeEventList(
  source: CompiledClaimOptions['preUpgradeEvents'],
): readonly PreUpgradeEvent[] {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  if (typeof source === 'object' && 'stop' in source) {
    source.stop();
    return source.events;
  }
  throw new Error('[compiled-claim] preUpgradeEvents: expected an event array or capture object');
}

/**
 * Replay each captured record at most once, and only while its target remains
 * owned by this root. Records owned by OTHER roots stay pending: an element
 * that upgrades late (delayed/lazy island) must still receive its replay when
 * its own activation arrives (#1170), so an outside-root record is neither
 * replayed nor consumed here. Records captured after this root's first
 * activation stay pending too: the live island already handled them, and a
 * later pass for the same root (morph reconnect) must not re-handle them.
 */
export function replayPreUpgradeEvents(
  root: Node,
  captured: readonly PreUpgradeEvent[],
): number {
  // Pin this root's first-activation cutoff. Records captured after the pin
  // are interactions a live island already handled: replaying them on a
  // later pass for the same root (morph reconnect) would double-handle one
  // event per target/type. Records owned by other (nested, still-pending)
  // roots are unaffected: each root pins its own cutoff, and a skipped
  // record stays pending for the root it actually belongs to.
  const seenCutoff = claimRootActivationSequence.get(root as object);
  const cutoff = seenCutoff ?? preUpgradeCaptureSequence;
  if (seenCutoff === undefined) claimRootActivationSequence.set(root as object, cutoff);
  let replayed = 0;
  for (const record of captured) {
    if ((record.seq ?? 0) > cutoff) continue;
    if (consumedEventRecords.has(record)) continue;
    if (!SUPPORTED_PRE_UPGRADE_EVENTS.has(record.type)) {
      consumedEventRecords.add(record);
      continue;
    }
    if (!isInsideRoot(root, record.target)) continue;
    const target = record.target;
    if (record.event && typeof record.event === 'object') {
      if (consumedEventObjects.has(record.event)) {
        consumedEventRecords.add(record);
        continue;
      }
      consumedEventObjects.add(record.event);
    }
    consumedEventRecords.add(record);
    // Fail closed on detached targets: an interaction whose node left the
    // document before its island hydrated replays nowhere (never throws,
    // never delivers to a recycled node, never retries on a later upgrade).
    if (
      isNodeValue(target) && typeof target.isConnected === 'boolean' &&
      target.isConnected === false
    ) {
      continue;
    }
    if (typeof target.dispatchEvent !== 'function') continue;
    const event = record.event ?? (
      typeof globalThis.Event === 'function'
        ? new Event(record.type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          ...record.init,
        })
        : undefined
    );
    if (!event) continue;
    target.dispatchEvent(event);
    replayed++;
  }
  return replayed;
}

/**
 * Release the captured records owned by one activated root, dropping the
 * strong references to their event targets (including detached DOM). Runs at
 * that element's activation decision — success or failure — so retained
 * records never outlive it (the M1 leak). Records owned by other roots stay
 * pending for their own activation. The capture's listener set is untouched:
 * one fixed listener set per page is installed once by the generated entry
 * and is not the leak.
 */
export function releasePreUpgradeEvents(root: Node, captured: readonly PreUpgradeEvent[]): void {
  const events = captured as PreUpgradeEvent[];
  for (let index = events.length - 1; index >= 0; index--) {
    if (isInsideRoot(root, events[index].target)) events.splice(index, 1);
  }
  // Removal / navigation / morph replacement detaches pending targets that
  // no activation will ever own: sweep them with every release so they never
  // survive to page end waiting for an island that is already gone.
  for (let index = events.length - 1; index >= 0; index--) {
    if (isDetachedTarget(events[index].target)) events.splice(index, 1);
  }
}

// ─── Claim options, staged scan, and bounded recovery ─────────────────

export type ClaimRecoveryMode = 'throw' | 'owning';

/** Claim-time options for the owning root. */
export interface CompiledClaimOptions {
  /**
   * True when the claiming class carries static styles. The server serializer
   * emits those styles as one marked `<style data-oe-static-styles>` element —
   * the first template child — so a claim skips exactly that node. A marked
   * style node on a style-less class is drift and fails closed.
   */
  expectStaticStyle?: boolean;
  /** Default is `throw`; `owning` enables one bounded recovery attempt. */
  recovery?: ClaimRecoveryMode;
  /** Observe the exact structured mismatch before optional recovery. */
  onMismatch?: (error: PartProgramClaimError) => void;
  /** Events captured before upgrade and replayed after a successful attach. */
  preUpgradeEvents?: readonly PreUpgradeEvent[] | PreUpgradeEventCapture;
}

function isStaticStyleNode(node: Node | undefined): boolean {
  return (
    !!node && isElement(node) && node.tagName.toLowerCase() === 'style' &&
    node.hasAttribute(STATIC_STYLES_MARKER)
  );
}

/**
 * Resolve every fixed-Part target and read every dependency during the scan
 * phase. Unresolved paths are structural drift (a claim mismatch owned by the
 * root); missing signals/handlers/refs fail before any subscription or
 * listener can attach.
 */
function validateFixedPartTargets(
  ctx: MountContext,
  root: Node,
  rootOffset: number,
  owner: ClaimOwner,
): void {
  for (const part of ctx.program.parts) {
    if (!isFixedPart(part)) continue;
    try {
      resolvePath(root, part.path, `${part.k} Part`, rootOffset);
    } catch {
      claimFailure(
        `parts[${part.index}].path`,
        `path [${part.path.join(',')}] is unresolved`,
        owner,
      );
    }
    if (part.k === 'event') {
      if (typeof ctx.host.handlers?.[part.handler] !== 'function') {
        throw new Error(`[compiled-runtime] missing host handler "${part.handler}"`);
      }
    } else if (part.k === 'ref') {
      if (!ctx.host.refs?.[part.ref]) {
        throw new Error(`[compiled-runtime] missing host ref "${part.ref}"`);
      }
    } else {
      signalOf(ctx, part.signal);
    }
  }
}

/**
 * Scan phase: validate the complete owned structure against the existing DOM
 * and collect deferred subscriptions. No subscription, listener, or ref
 * attaches here, and no node is allocated or replaced.
 */
function scanClaim(
  ctx: MountContext,
  root: Node,
  options: CompiledClaimOptions,
  pending: DeferredSubscription[],
): number {
  const owner: RootClaimOwner = { kind: 'root', root };
  const styleNode = root.childNodes[0];
  const hasStaticStyle = isStaticStyleNode(styleNode);
  if (hasStaticStyle && !options.expectStaticStyle) {
    claimFailure('template', 'unexpected static style element', owner);
  }
  const cursorStart = hasStaticStyle ? 1 : 0;
  const consumed = claimNodes(
    ctx,
    root,
    cursorStart,
    ctx.program.template,
    'template',
    [],
    ctx.rootScope,
    owner,
    pending,
  );
  if (consumed !== root.childNodes.length) {
    claimFailure('template', 'unexpected trailing nodes', owner);
  }
  validateFixedPartTargets(ctx, root, cursorStart, owner);
  return cursorStart;
}

/** Static recovery build: Region branches and item templates hold no anchors. */
function buildStaticRecoveryNodes(doc: Document, nodes: ProgramTreeNode[]): Node[] {
  const out: Node[] = [];
  for (const node of nodes) {
    if (node.k === 'text') {
      out.push(doc.createTextNode(node.value));
      continue;
    }
    if (node.k === 'el') {
      const element = doc.createElement(node.tag);
      for (const [name, value] of node.attrs) element.setAttribute(name, value);
      for (const child of buildStaticRecoveryNodes(doc, node.children)) {
        element.appendChild(child);
      }
      out.push(element);
      continue;
    }
    throw new Error('[compiled-claim] recovery build met a dynamic node in a static Region');
  }
  return out;
}

/** Recovery build of one each-Region item (static template, live item values). */
function buildRecoveryItemNodes(
  doc: Document,
  part: ProgramEachPart,
  item: Record<string, unknown>,
): Node[] {
  const build = (nodes: ProgramTreeNode[]): Node[] => {
    const out: Node[] = [];
    for (const node of nodes) {
      if (node.k === 'text') {
        out.push(doc.createTextNode(node.value));
        continue;
      }
      if (node.k === 'ival') {
        const value = displayValue(itemValue(part, item, node.field));
        if (value.length > 0) out.push(doc.createTextNode(value));
        continue;
      }
      if (node.k === 'el') {
        const element = doc.createElement(node.tag);
        for (const [name, value] of node.attrs) element.setAttribute(name, value);
        for (const [name, field] of node.iattrs ?? []) {
          const value = itemAttrValue(item, field);
          if (value !== null) element.setAttribute(name, value);
        }
        for (const child of build(node.children)) element.appendChild(child);
        out.push(element);
        continue;
      }
      throw new Error('[compiled-claim] item templates may not contain Part anchors');
    }
    return out;
  };
  return build(part.item);
}

/** Recovery build of one Region's current content (no subscriptions). */
function buildRecoveryRegionContent(
  ctx: MountContext,
  doc: Document,
  part: ProgramWhenPart | ProgramEachPart,
): Node[] {
  if (part.k === 'when') {
    const active = whenActive(part, signalOf(ctx, part.signal).value);
    return buildStaticRecoveryNodes(doc, active ? part.on : part.off);
  }
  const items = claimItemRecords(part, signalOf(ctx, part.signal).value, `parts[${part.index}]`, {
    kind: 'root',
    root: doc,
  });
  return items.flatMap((item) => buildRecoveryItemNodes(doc, part, item));
}

/**
 * Recovery build of the full template (anchors emitted, no subscriptions).
 * Dynamic fixed-Part values are applied by the attach phase in `fresh` mode;
 * a trusted-HTML sink's subtree is likewise rewritten there.
 */
function buildRecoveryTemplateNodes(
  ctx: MountContext,
  doc: Document,
  nodes: ProgramTreeNode[],
  path: number[],
): Node[] {
  const out: Node[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const nodePath = [...path, index];
    if (node.k === 'text') {
      out.push(doc.createTextNode(node.value));
      continue;
    }
    if (node.k === 'ival') {
      throw new Error('[compiled-claim] item value slot outside an each Region');
    }
    if (node.k === 'el') {
      const element = doc.createElement(node.tag);
      for (const [name, value] of node.attrs) element.setAttribute(name, value);
      const hasHtmlSink = fixedPartsAtPath(ctx, nodePath).some((part) => part.k === 'html');
      if (!hasHtmlSink) {
        for (const child of buildRecoveryTemplateNodes(ctx, doc, node.children, nodePath)) {
          element.appendChild(child);
        }
      }
      out.push(element);
      continue;
    }
    const part = ctx.program.parts[node.index];
    if (!part) throw new Error(`[compiled-runtime] missing Part ${node.index}`);
    if (part.k === 'text') {
      out.push(doc.createComment(partAnchorMarker(part.index)));
      const current = displayValue(signalOf(ctx, part.signal).value);
      if (current.length > 0) out.push(doc.createTextNode(current));
      continue;
    }
    if (part.k === 'when' || part.k === 'each') {
      out.push(doc.createComment(partAnchorMarker(part.index)));
      out.push(...buildRecoveryRegionContent(ctx, doc, part));
      out.push(doc.createComment(partAnchorEndMarker(part.index)));
      continue;
    }
    throw new Error(`[compiled-runtime] fixed Part ${part.index} cannot be used as an anchor`);
  }
  return out;
}

function removeAllChildren(parent: Node): void {
  while (parent.childNodes.length > 0) {
    const child = parent.childNodes[0];
    if (!child) break;
    parent.removeChild(child);
  }
}

/**
 * Bounded `owning` recovery: replace only the mismatching owner — one Region
 * range between its anchors, or the owning root's children (the marked static
 * style node is serializer-owned and preserved). Nothing outside the compiled
 * location identity is searched or touched.
 */
function recoverClaimOwner(error: PartProgramClaimError, ctx: MountContext): boolean {
  if (error.owner.kind === 'region') {
    const { parent, anchor, end, part } = error.owner;
    if (anchor.parentNode !== parent || end.parentNode !== parent) return false;
    const doc = parent.ownerDocument;
    if (!doc) return false;
    const replacement = buildRecoveryRegionContent(ctx, doc, part);
    let current = anchor.nextSibling;
    while (current && current !== end) {
      const next = current.nextSibling;
      parent.removeChild(current);
      current = next;
    }
    for (const node of replacement) parent.insertBefore(node, end);
    return true;
  }
  const root = error.owner.root;
  const doc = root.ownerDocument;
  if (!doc) return false;
  const replacement = buildRecoveryTemplateNodes(ctx, doc, ctx.program.template, []);
  const firstChild = root.childNodes[0];
  const keepStyle = isStaticStyleNode(firstChild);
  removeAllChildren(root);
  if (keepStyle && firstChild) root.appendChild(firstChild);
  for (const node of replacement) root.appendChild(node);
  return true;
}

/**
 * Claim existing SSR DOM without allocating or overwriting live values.
 *
 * Claim is staged: the complete owned structure is validated first, then
 * subscriptions, listeners, and refs attach. A successful claim performs no
 * node allocation or replacement (browser node identity is preserved). A
 * mismatch fails closed with a structured PartProgramClaimError unless
 * `recovery: 'owning'` was explicitly requested, which grants exactly one
 * bounded rebuild of the mismatching owner.
 */
export function claimExistingDom(
  program: PartProgramV1,
  host: CompiledRuntimeHost,
  root: Node,
  options: CompiledClaimOptions = {},
): CompiledProgramInstance {
  noteCompiledProgramActivated();
  // Stop a live capture before staged validation so a failed claim cannot
  // leave its root listener installed. The captured records are replayed only
  // after the complete plan has attached successfully.
  const capturedEvents = preUpgradeEventList(options.preUpgradeEvents);
  const recovery = options.recovery ?? 'throw';
  let recovered = false;
  let rootRebuilt = false;
  for (;;) {
    const ctx = createContext(normalizePartProgram(program), host);
    const pending: DeferredSubscription[] = [];
    try {
      const cursorStart = scanClaim(ctx, root, options, pending);
      for (const deferred of pending) {
        subscribeWrites(ctx, deferred.scope, deferred.signal, deferred.fn);
      }
      // A rebuilt root carries no live values yet: fixed Parts apply their
      // initial values exactly as fresh creation would. A Region-range
      // recovery never contains fixed-Part targets, so `claim` mode stands.
      attachFixedParts(ctx, root, rootRebuilt ? 'fresh' : 'claim', cursorStart);
      replayPreUpgradeEvents(root, capturedEvents);
      return instance(ctx);
    } catch (error) {
      try {
        ctx.rootScope.dispose();
      } catch {
        // Keep the structural diagnostic while still attempting every cleanup.
      }
      if (!(error instanceof PartProgramClaimError)) throw error;
      options.onMismatch?.(error);
      if (recovery !== 'owning' || recovered || !recoverClaimOwner(error, ctx)) throw error;
      recovered = true;
      rootRebuilt = error.owner.kind === 'root';
    }
  }
}

/** Canonical entry-point aliases. */
export const createPartProgram = createFreshDom;
export const serializePartProgram = serializeToHtml;
export const claimPartProgram = claimExistingDom;
