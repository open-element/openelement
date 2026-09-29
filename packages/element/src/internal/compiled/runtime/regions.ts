/**
 * when/each Region machinery of the compiled Part Program runtime: keyed
 * list reconciliation with LIS moves, when-branch swapping, and the
 * per-item value/attribute slot projections. The Region builders re-enter
 * the template walk in fresh-dom.ts (mountNodes), while fresh-dom's Part
 * dispatch calls back into buildWhen/buildEach — a function-level ESM cycle
 * between hoisted declarations with no top-level evaluation, which is safe.
 */

// Canonical each-Region item-key derivation (#1374) — single source shared
// with the server serializer; do not reintroduce a private copy.
import { eachItemKey } from '../each-key.ts';
// Canonical when-Region condition evaluation (#1372) — single source shared
// with the server serializer; do not reintroduce a private comparison.
import { conditionHolds } from '../condition-holds.ts';
import {
  partAnchorEndMarker,
  partAnchorMarker,
  type ProgramEachPart,
  type ProgramWhenPart,
} from '../../protocol/part-program.ts';
import { EachKeyErrorCode, RuntimeErrorCode } from '../../protocol/errors.ts';
import type { LifetimeScope } from '../lifetime-scope.ts';
import type { MountContext } from './program-kernel.ts';
import {
  displayValue,
  fail,
  guardedUpdate,
  insertNodesBefore,
  itemAttrValue,
  itemValue,
  NO_ITEM,
  origin,
  removeNodes,
  signalOf,
  subscribeWrites,
} from './program-kernel.ts';
import { mountNodes } from './fresh-dom.ts';

/**
 * A list Region's authored name: the compiler's Region identity is a numeric
 * part index, which an author cannot map back to source. The signal name is
 * the authored `this.<property>` the Region renders.
 */
function regionName(part: ProgramEachPart | ProgramWhenPart): string {
  return `this.${part.signal}`;
}

/**
 * A list Region's signal must hold an array at every write. Naming the
 * authored property and the received value is what makes the failure
 * actionable; the compiler cannot reject it because the property type is an
 * authoring decision, and the Region is re-read on every signal write.
 */
export function expectsArrayMessage(where: string, part: ProgramEachPart, value: unknown): string {
  const received = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  return `${where}: the list Region over ${regionName(part)} expects an array, got ` +
    `${received} — it renders ${regionName(part)}.map(...), so initialize that property to [] ` +
    `instead of null/undefined.`;
}

/** Two items in one list Region derived the same item key. */
function duplicateKeyMessage(ctx: MountContext, part: ProgramEachPart, key: string): string {
  return `${origin(ctx)}: duplicate key in the list Region over ${regionName(part)} — two items ` +
    `share ${JSON.stringify(part.key)} = ${key}. A key is the item's DOM identity and must be ` +
    `unique within one list; give each item a unique ${part.key}.`;
}

export interface WhenRegion {
  ctx: MountContext;
  part: ProgramWhenPart;
  scope: LifetimeScope;
  anchor: Comment;
  end: Comment;
  current: boolean;
  branchScope: LifetimeScope;
  nodes: Node[];
  item: unknown;
  itemPart?: ProgramEachPart;
}

export interface ItemValueSlot {
  text?: Text;
  parent?: Node;
  before?: Node | null;
  position?: number;
  /** Item field this slot renders (multi-field item templates). */
  field?: string;
}

/** Per-item attribute slot tracked for keyed-reuse updates. */
export interface ItemAttrSlot {
  element: Element;
  name: string;
  field: string;
}

export interface EachEntry {
  key: string;
  scope: LifetimeScope;
  nodes: Node[];
  valueSlots: ItemValueSlot[];
  attrSlots: ItemAttrSlot[];
  /**
   * The item value this entry was last rendered from (#1416). Every slot in
   * an entry is a pure projection of one item, so an identical reference
   * means the projection cannot have changed and `updateEach` skips the whole
   * slot walk for that entry. Mutating an item in place is therefore outside
   * the reactive contract — the same object-identity boundary the canonical
   * key derivation draws (each-key.ts): the store replaces items, it does not
   * rewrite them.
   */
  item: unknown;
}

export interface EachRegion {
  ctx: MountContext;
  part: ProgramEachPart;
  scope: LifetimeScope;
  anchor: Comment;
  end: Comment;
  entries: EachEntry[];
  byKey: Map<string, EachEntry>;
  item: unknown;
}

export function whenActive(part: ProgramWhenPart, value: unknown): boolean {
  // Canonical condition evaluation (#1372) — shared with the server
  // serializer; do not reintroduce a private comparison.
  return conditionHolds(part.test, value);
}

export function buildItem(
  ctx: MountContext,
  regionScope: LifetimeScope,
  doc: Document,
  part: ProgramEachPart,
  item: unknown,
  parent?: Node,
): { nodes: Node[]; valueSlots: ItemValueSlot[]; attrSlots: ItemAttrSlot[]; scope: LifetimeScope } {
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

export function buildWhen(
  ctx: MountContext,
  parentScope: LifetimeScope,
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
  subscribeWrites(
    ctx,
    scope,
    part.signal,
    guardedUpdate(ctx, (value) => updateWhen(region, value)),
  );
  return [anchor, ...region.nodes, end];
}

export function updateWhen(region: WhenRegion, value: unknown): void {
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

export function buildEach(
  ctx: MountContext,
  parentScope: LifetimeScope,
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
    fail(RuntimeErrorCode.LIST_VALUE_NOT_ARRAY, expectsArrayMessage(origin(ctx), part, value));
  }
  const nodes: Node[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const key = eachItemKey(part, value[index]);
    if (seen.has(key)) {
      fail(EachKeyErrorCode.DUPLICATE_KEY, duplicateKeyMessage(ctx, part, key));
    }
    seen.add(key);
    const entry = buildItem(ctx, scope, doc, part, value[index], parent);
    const stored = {
      key,
      scope: entry.scope,
      nodes: entry.nodes,
      valueSlots: entry.valueSlots,
      attrSlots: entry.attrSlots,
      item: value[index],
    };
    region.entries.push(stored);
    region.byKey.set(key, stored);
    nodes.push(...entry.nodes);
  }
  subscribeWrites(ctx, scope, part.signal, guardedUpdate(ctx, (next) => updateEach(region, next)));
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
  entry: EachEntry,
  projection: { values: string[]; attrs: Array<string | null> },
  regionParent: Node,
  resolveRegionReference: () => Node,
): void {
  // The fallback insertion reference is a scan over the Region's later
  // entries. It is only reachable when a slot that currently has no text must
  // gain one, so resolve it once, on demand (#1416) — an update that only
  // rewrites or removes existing text never pays for the scan.
  let regionReference: Node | undefined;
  const regionReferenceForInsert = (): Node => (regionReference ??= resolveRegionReference());
  for (const [index, slot] of entry.valueSlots.entries()) {
    const next = projection.values[index];
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
    if (!document) {
      fail(
        RuntimeErrorCode.ITEM_SLOT_WITHOUT_DOCUMENT,
        '[compiled-runtime] item value slot has no owner document',
      );
    }
    const text = document.createTextNode(next);
    slot.text = text;
    insertItemValue(entry, index, text, regionParent, regionReferenceForInsert());
  }
  for (const [index, slot] of entry.attrSlots.entries()) {
    const next = projection.attrs[index];
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

function moveEntries(
  region: EachRegion,
  parent: Node,
  entries: EachEntry[],
  previousPositions: Map<EachEntry, number>,
  mounted: Set<EachEntry>,
): void {
  // A physically ordered suffix already touches the Region end anchor.
  // Leave it in place and keep the LIS work confined to the changed prefix.
  let limit = entries.length;
  let reference: Node = region.end;
  while (limit > 0) {
    const nodes = entries[limit - 1].nodes;
    let next = reference;
    let contiguous = true;
    for (let index = nodes.length - 1; index >= 0; index--) {
      if (nodes[index].parentNode !== parent || nodes[index].nextSibling !== next) {
        contiguous = false;
        break;
      }
      next = nodes[index];
    }
    if (!contiguous) break;
    reference = next;
    limit--;
  }

  // Keep the longest already-ordered subsequence in place. New entries and
  // formerly empty entries have no mounted position to preserve.
  const tails: number[] = [];
  const predecessors = new Int32Array(limit).fill(-1);
  for (let index = 0; index < limit; index++) {
    const entry = entries[index];
    const position = previousPositions.get(entry);
    const nodes = entry.nodes;
    if (
      position === undefined || !mounted.has(entry) || nodes.length === 0 ||
      nodes.some((node, nodeIndex) =>
        node.parentNode !== parent ||
        (nodeIndex > 0 && nodes[nodeIndex - 1].nextSibling !== node)
      )
    ) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (previousPositions.get(entries[tails[middle]])! < position) low = middle + 1;
      else high = middle;
    }
    if (low > 0) predecessors[index] = tails[low - 1];
    tails[low] = index;
  }
  const stationary = new Set<number>();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = predecessors[index]) {
    stationary.add(index);
  }

  for (let index = limit - 1; index >= 0; index--) {
    const nodes = entries[index].nodes;
    if (stationary.has(index)) {
      if (nodes.length > 0) reference = nodes[0];
      continue;
    }
    for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex--) {
      const node = nodes[nodeIndex];
      if (node.parentNode !== parent || node.nextSibling !== reference) {
        parent.insertBefore(node, reference);
      }
      reference = node;
    }
  }
}

export function updateEach(region: EachRegion, value: unknown): void {
  if (region.scope.disposed) return;
  if (!Array.isArray(value)) {
    fail(
      RuntimeErrorCode.LIST_VALUE_NOT_ARRAY,
      expectsArrayMessage(origin(region.ctx), region.part, value),
    );
  }
  const parent = region.end.parentNode;
  // A detached anchor/end pair means the Region's owning boundary is gone;
  // updates stop rather than rebuilding outside the owned range.
  if (!parent || region.anchor.parentNode !== parent) return;
  const previousPositions = new Map(region.entries.map((entry, index) => [entry, index]));
  const mounted = new Set(
    region.entries.filter((entry) => entry.nodes.some((node) => node.parentNode === parent)),
  );

  const descriptors: Array<{
    key: string;
    item: unknown;
    existing?: EachEntry;
    projection?: { values: string[]; attrs: Array<string | null> };
  }> = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    const key = eachItemKey(region.part, item);
    if (seen.has(key)) {
      fail(EachKeyErrorCode.DUPLICATE_KEY, duplicateKeyMessage(region.ctx, region.part, key));
    }
    seen.add(key);
    descriptors.push({ key, item, existing: region.byKey.get(key) });
  }
  for (const descriptor of descriptors) {
    const entry = descriptor.existing;
    if (!entry || entry.item === descriptor.item) continue;
    descriptor.projection = {
      values: entry.valueSlots.map((slot) =>
        displayValue(itemValue(region.part, descriptor.item, slot.field))
      ),
      attrs: entry.attrSlots.map((slot) => itemAttrValue(descriptor.item, slot.field)),
    };
  }

  // Membership only: `created` exists to tell a freshly built entry (already
  // rendered from its item by `buildItem`) from a reused one. The separate
  // Set keeps the `updateItemValues` guard O(1) instead of an array scan
  // (#1416) while `created` keeps its insertion order for the rollback loop.
  const created: EachEntry[] = [];
  const createdSet = new Set<EachEntry>();
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
      const entry = { key: descriptor.key, ...built, item: descriptor.item };
      descriptor.existing = entry;
      created.push(entry);
      createdSet.add(entry);
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
    const entry = descriptor.existing;
    if (!entry || createdSet.has(entry)) continue;
    // Unchanged item reference: every slot value is a pure projection of the
    // item, so re-deriving them cannot change any node. Skip the walk
    // entirely (#1416); the reference is refreshed below for every entry that
    // does re-render, so the next update compares against what is on screen.
    if (entry.item === descriptor.item) continue;
    updateItemValues(entry, descriptor.projection!, parent, () => {
      for (let nextIndex = descriptorIndex + 1; nextIndex < nextEntries.length; nextIndex++) {
        const nextNode = nextEntries[nextIndex].nodes.find((node) => node.parentNode === parent);
        if (nextNode) return nextNode;
      }
      return region.end;
    });
    entry.item = descriptor.item;
  }
  region.entries = nextEntries;
  region.byKey = new Map(nextEntries.map((entry) => [entry.key, entry]));
  moveEntries(region, parent, nextEntries, previousPositions, mounted);
}
