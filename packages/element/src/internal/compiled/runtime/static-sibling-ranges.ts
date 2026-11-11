/**
 * M07b — a caller-declared directory of static sibling ranges.
 *
 * One HTML element parent, and nothing else: its child list is exactly the
 * paired comments `oe:r:<ordinal>` … `oe:/r:<ordinal>` for ordinals 0..N-1.
 * The spelling is private to this slice. It is not `oe:p`, `oe:when`, or
 * `oe:each`, and it is not a public ABI. Mount does not emit these markers.
 *
 * The caller supplies the declaration and each claim's expected ordinal, or a
 * handle whose start comment the caller already holds. The runtime never
 * chooses the ordinal by searching for matching content, so two identical
 * ranges cannot be swapped without the caller noticing the ordinal or the
 * node identity.
 *
 * Validation reads `nodeType`, `nodeValue`, `localName`, `namespaceURI`, and
 * attributes only. An exclusive reservation is taken before those reads and
 * before `activate`. The reservation, the cursor, and the committed markers
 * belong to the parent element, so a second `openStaticSiblingDirectory` on
 * that parent is another view of the same pair identity, not a second owner.
 * A different parent is a different identity. Moving a committed marker onto
 * another parent is outside this slice; there is no global marker lock.
 * The directory parent, its element ancestors, and every element inside a
 * range must have `namespaceURI === "http://www.w3.org/1999/xhtml"`. `null`
 * is refused, as is every other namespace.
 * Only the holder releases an uncommitted reservation. A successful range
 * remembers the ordinal and the start and end comments and advances the
 * cursor. Those records stay with the attempt until every declared range has
 * committed. A failure after the reservation is taken rolls that attempt
 * back: the reservation is released, tombstones and the success cursor
 * committed in the attempt are cleared, and those ranges' owners are released
 * with `dispose(false)`. Borrowed nodes are not deleted. A dynamic write that
 * already happened may stay. This is not a byte-level restore of the claim.
 * A directory claim that commits every declared range stays permanent,
 * including after `dispose`. A validation failure of the range in hand writes
 * nothing and creates no owner for that range. An activation failure disposes
 * that uncommitted scope with `dispose(false)` before the attempt is rolled
 * back. A failure before the reservation is taken does not roll the attempt
 * back, and a `busy` reentry does not clear the holder's reservation.
 *
 * @module ./static-sibling-ranges.ts
 */

import {
  raiseFrameworkError,
  RUNTIME_MESSAGES_ENABLED,
  RuntimeErrorCode,
} from '@openelement/protocol/errors';
import type { LifetimeScope } from '../lifetime-scope.ts';
import {
  recordOwnerCreated,
  recordProjection,
  recordProjectionDisposed,
  recordRangeCleanup,
  recordRegionAllocated,
} from './observability.ts';
import { removeNodes } from './values.ts';

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
/**
 * HTML parsing contexts this static subset does not own. The names are the
 * table, select, and template families plus `svg` and `math`. ASCII case is
 * folded because a shim can keep the source spelling; a canonical HTML
 * `localName` is already lowercase. This set is not the stream-frame deny
 * list and it is not an HTML parser.
 */
const RESTRICTED_HTML_LOCAL_NAMES = new Set([
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'select',
  'optgroup',
  'option',
  'template',
  'svg',
  'math',
]);
const MAX_ORDINAL_DIGITS = 16;

/** One node the caller declares. Compared against the parsed DOM, not HTML source. */
export interface DeclaredStaticNode {
  readonly kind: 'element' | 'text';
  readonly localName?: string;
  readonly attributes?: readonly { readonly name: string; readonly value: string }[];
  readonly nodeValue?: string | null;
  readonly children?: readonly DeclaredStaticNode[];
}

/**
 * A start comment the caller already holds. Passing it does not search the
 * directory for similar content; the node must be the next range's start.
 */
export interface StaticRangeHandle {
  readonly start: Node;
}

/** A committed range. `dispose` does not clear the directory tombstone. */
export interface StaticSiblingClaim {
  readonly ordinal: number;
  readonly owner: LifetimeScope;
  readonly start: Node;
  readonly end: Node;
  readonly interior: readonly Node[];
  dispose(detachOwnedNodes?: boolean): void;
}

interface ParsedRange {
  readonly ordinal: number;
  readonly start: Node;
  readonly end: Node;
  readonly interior: readonly Node[];
}

interface Reservation {
  readonly token: number;
  readonly ordinal: number;
}

/**
 * One range committed by the current incomplete directory attempt.
 * `release` drops the owner without deleting borrowed nodes. A completed
 * directory claim clears this list without calling `release`.
 */
interface ProvisionalCommit {
  readonly ordinal: number;
  readonly start: Node;
  readonly end: Node;
  readonly release: () => void;
}

/**
 * One open of a parent. The consumption and reservation live on the pair
 * identity below, not on this object: two opens of one parent share them.
 */
export interface StaticSiblingDirectory {
  readonly parent: Element;
  readonly declaration: readonly (readonly DeclaredStaticNode[])[];
  readonly source: string;
}

/**
 * Ownership of one parent. Keyed by the element, so it survives a second open
 * and a `dispose` that removes the markers. The marker set keeps the committed
 * start and end nodes reachable for that parent's lifetime. It is not a global
 * marker lock: a committed node moved under a different parent is outside
 * this slice.
 */
interface PairIdentity {
  next: number;
  readonly consumedOrdinals: Set<number>;
  readonly consumedMarkers: Set<Node>;
  reservation: Reservation | null;
  serial: number;
  /**
   * Ranges committed by the incomplete directory attempt. Empty once every
   * declared range has committed, and empty again after a failed attempt
   * rolls them back. Caller `dispose` does not clear it.
   */
  readonly provisional: ProvisionalCommit[];
}

const pairIdentities = new WeakMap<Element, PairIdentity>();

interface DirectoryState extends StaticSiblingDirectory {
  readonly identity: PairIdentity;
}

function pairIdentity(parent: Element): PairIdentity {
  let identity = pairIdentities.get(parent);
  if (!identity) {
    identity = {
      next: 0,
      consumedOrdinals: new Set(),
      consumedMarkers: new Set(),
      reservation: null,
      serial: 0,
      provisional: [],
    };
    pairIdentities.set(parent, identity);
  }
  return identity;
}

function fail(source: string, detail: string): never {
  const where = `[compiled-runtime] ${source}`;
  raiseFrameworkError(
    'csr',
    RuntimeErrorCode.STATIC_RANGE_MISMATCH,
    RUNTIME_MESSAGES_ENABLED
      ? `${where}: ${detail}`
      : `${where}: ${RuntimeErrorCode.STATIC_RANGE_MISMATCH}`,
  );
}

function childAt(list: NodeListOf<ChildNode>, index: number): Node | null {
  if (typeof list.item === 'function') return list.item(index);
  return list[index] ?? null;
}

function childrenOf(parent: Node): Node[] {
  const list = parent.childNodes;
  const nodes: Node[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const child = childAt(list, index);
    if (child) nodes.push(child);
  }
  return nodes;
}

/**
 * Canonical decimal, no sign, no leading zero, no truncation. `parseInt` is
 * intentionally not used: it accepts `01` and stops early on `1e2` / `1.0`.
 * A digit string that would exceed `Number.MAX_SAFE_INTEGER` is rejected
 * instead of being rounded.
 */
function canonicalOrdinal(digits: string): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(digits)) return null;
  if (digits.length > MAX_ORDINAL_DIGITS) return null;
  let value = 0;
  for (const char of digits) {
    const digit = char.charCodeAt(0) - 48;
    if (value > (Number.MAX_SAFE_INTEGER - digit) / 10) return null;
    value = value * 10 + digit;
  }
  return value;
}

function markerOrdinal(nodeValue: string | null, end: boolean): number | null {
  if (nodeValue === null) return null;
  const prefix = end ? 'oe:/r:' : 'oe:r:';
  if (!nodeValue.startsWith(prefix)) return null;
  return canonicalOrdinal(nodeValue.slice(prefix.length));
}

function asciiLower(value: string): string {
  let folded = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    folded += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : value[index];
  }
  return folded;
}

/**
 * Admitted only when `namespaceURI` is the HTML namespace. `null` and every
 * other namespace are refused. The restricted local-name set is unchanged.
 * Returns the rejection detail, or `null` when the element is admitted.
 */
function elementRejection(element: Element): string | null {
  const namespace = element.namespaceURI;
  if (namespace !== HTML_NAMESPACE) {
    return `non-HTML namespace ${JSON.stringify(namespace)} on ${JSON.stringify(element.localName)}`;
  }
  const localName = typeof element.localName === 'string' ? element.localName : '';
  if (RESTRICTED_HTML_LOCAL_NAMES.has(asciiLower(localName))) {
    return `restricted element ${JSON.stringify(localName)}`;
  }
  return null;
}

function readAttributes(element: Element): { name: string; value: string }[] {
  const { attributes } = element;
  const result: { name: string; value: string }[] = [];
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes.item(index);
    if (!attribute) continue;
    result.push({ name: attribute.name, value: attribute.value });
  }
  return result;
}

function rejectNestedMarker(node: Node, source: string): void {
  if (node.nodeType === 8) {
    const value = node.nodeValue ?? '';
    if (value.startsWith('oe:r:') || value.startsWith('oe:/r:')) {
      fail(source, `boundary: nested or mismatched marker ${JSON.stringify(value)}`);
    }
    return;
  }
  if (node.nodeType !== 1) return;
  const element = node as Element;
  const rejection = elementRejection(element);
  if (rejection) {
    fail(source, `parent: unsupported element inside a static range (${rejection})`);
  }
  for (const child of childrenOf(element)) rejectNestedMarker(child, source);
}

/**
 * The parent must be only sibling ranges. Ordinals are strictly increasing.
 * Every ordinal `>= requiredFrom` (the unconsumed suffix) must be present.
 * A consumed range may still be present after `dispose(false)`, or absent
 * after `dispose(true)`. Neither case rewinds the cursor.
 */
function parseDirectory(
  parent: Element,
  count: number,
  source: string,
  requiredFrom: number,
): ParsedRange[] {
  const children = childrenOf(parent);
  const ranges: ParsedRange[] = [];
  let index = 0;
  let previous = -1;
  while (index < children.length) {
    const start = children[index];
    if (!start || start.nodeType !== 8) {
      fail(
        source,
        `boundary: outside node is not a range start (${JSON.stringify(start?.nodeValue)})`,
      );
    }
    const ordinal = markerOrdinal(start.nodeValue, false);
    if (ordinal === null) {
      fail(source, `ordinal: non-canonical start ${JSON.stringify(start.nodeValue)}`);
    }
    if (ordinal <= previous || ordinal >= count) {
      fail(source, `order: start ordinal ${ordinal} is duplicate, gapped, or out of bounds`);
    }
    if (ordinal > previous + 1 && ordinal > requiredFrom) {
      fail(source, `order: gap before ordinal ${ordinal}`);
    }
    previous = ordinal;
    index += 1;
    const interior: Node[] = [];
    let closed = false;
    for (; index < children.length; index += 1) {
      const node = children[index];
      if (!node) break;
      if (node.nodeType === 8 && markerOrdinal(node.nodeValue, true) === ordinal) {
        closed = true;
        break;
      }
      if (node.nodeType === 8 && markerOrdinal(node.nodeValue, false) !== null) {
        fail(source, `boundary: crossed or nested start ${JSON.stringify(node.nodeValue)}`);
      }
      if (node.nodeType === 8 && markerOrdinal(node.nodeValue, true) !== null) {
        fail(source, `boundary: mismatched end ${JSON.stringify(node.nodeValue)}`);
      }
      rejectNestedMarker(node, source);
      interior.push(node);
    }
    if (!closed) fail(source, `boundary: missing end for ordinal ${ordinal}`);
    const end = children[index];
    if (!end) fail(source, `boundary: missing end for ordinal ${ordinal}`);
    ranges.push({ ordinal, start, end, interior });
    index += 1;
  }
  for (let ordinal = requiredFrom; ordinal < count; ordinal += 1) {
    if (!ranges.some((range) => range.ordinal === ordinal)) {
      fail(source, `order: unconsumed ordinal ${ordinal} is missing`);
    }
  }
  return ranges;
}

function sameAttributes(
  element: Element,
  expected: readonly { readonly name: string; readonly value: string }[],
): boolean {
  const live = readAttributes(element);
  if (live.length !== expected.length) return false;
  for (let index = 0; index < live.length; index += 1) {
    const actual = live[index];
    const declared = expected[index];
    if (!actual || !declared) return false;
    if (actual.name !== declared.name || actual.value !== declared.value) return false;
  }
  return true;
}

function matches(node: Node, declared: DeclaredStaticNode, source: string): boolean {
  if (declared.kind === 'text') {
    return node.nodeType === 3 && node.nodeValue === (declared.nodeValue ?? '');
  }
  if (declared.kind !== 'element') {
    fail(source, `static-seed: undeclared kind ${JSON.stringify(declared.kind)}`);
  }
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  const rejection = elementRejection(element);
  if (rejection) {
    fail(source, `parent: unsupported element inside a static range (${rejection})`);
  }
  if (element.localName !== declared.localName) return false;
  if (!sameAttributes(element, declared.attributes ?? [])) return false;
  const children = childrenOf(element);
  const declaredChildren = declared.children ?? [];
  if (children.length !== declaredChildren.length) return false;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const expected = declaredChildren[index];
    if (!child || !expected || !matches(child, expected, source)) return false;
  }
  return true;
}

function matchInterior(
  interior: readonly Node[],
  declared: readonly DeclaredStaticNode[],
  source: string,
): void {
  if (interior.length !== declared.length) {
    fail(source, `static-seed: interior length ${interior.length} !== ${declared.length}`);
  }
  for (let index = 0; index < interior.length; index += 1) {
    const node = interior[index];
    const expected = declared[index];
    if (!node || !expected || !matches(node, expected, source)) {
      fail(source, `static-seed: node ${index} does not match the declaration`);
    }
  }
}

/**
 * Open a directory. This reads the marker skeleton only; it does not claim a
 * range and it does not compare static seed. There is no user callback.
 */
export function openStaticSiblingDirectory(
  parent: Node,
  declaration: readonly (readonly DeclaredStaticNode[])[],
  source = 'static sibling range',
): StaticSiblingDirectory {
  if (parent.nodeType !== 1) {
    fail(source, `parent: unsupported directory parent ${JSON.stringify(String(parent.nodeType))}`);
  }
  const element = parent as Element;
  const rejection = elementRejection(element);
  if (rejection) fail(source, `parent: unsupported directory parent (${rejection})`);
  let ancestor: Node | null = element.parentNode;
  while (ancestor) {
    if (ancestor.nodeType === 1) {
      const ancestorRejection = elementRejection(ancestor as Element);
      if (ancestorRejection) fail(source, `parent: directory is inside ${ancestorRejection}`);
    }
    ancestor = ancestor.parentNode;
  }
  const identity = pairIdentity(element);
  if (identity.reservation) fail(source, 'busy: directory reservation is held');
  parseDirectory(element, declaration.length, source, identity.next);
  const state: DirectoryState = {
    parent: element,
    declaration,
    source,
    identity,
  };
  return state;
}

function asState(directory: StaticSiblingDirectory): DirectoryState {
  return directory as DirectoryState;
}

/**
 * Claim the next range. `expected` is the caller's ordinal, or the start
 * comment the caller held before this call. The reservation is taken on the
 * parent's pair identity before any DOM read and before `activate`. A failure
 * before that reservation does not roll back an earlier range. A failure
 * after it releases the reservation and rolls back ranges committed earlier
 * in the same incomplete directory attempt. When every declared range has
 * committed, the tombstones stay, including after `dispose` and including a
 * later open of the same parent.
 */

/**
 * Undo tombstones and the success cursor of the incomplete attempt, then
 * release those owners. A directory claim that already committed every range
 * has nothing provisional and is left alone. Dispose errors do not replace
 * the claim error. Borrowed nodes are not removed: release uses
 * `dispose(false)`.
 */
function rollbackProvisional(identity: PairIdentity): void {
  const ranges = identity.provisional.splice(0);
  if (ranges.length === 0) return;
  let earliest = identity.next;
  for (const range of ranges) {
    identity.consumedOrdinals.delete(range.ordinal);
    identity.consumedMarkers.delete(range.start);
    identity.consumedMarkers.delete(range.end);
    if (range.ordinal < earliest) earliest = range.ordinal;
  }
  identity.next = earliest;
  for (const range of ranges) {
    try {
      range.release();
    } catch {
      // The claim error is what surfaces. Borrowed nodes stay.
    }
  }
}

export function claimStaticSiblingRange(
  directory: StaticSiblingDirectory,
  expected: number | StaticRangeHandle,
  insertingOwner: LifetimeScope,
  activate: (scope: LifetimeScope, interior: readonly Node[]) => void,
): StaticSiblingClaim {
  const state = asState(directory);
  const identity = state.identity;
  if (typeof expected === 'number') {
    if (!Number.isSafeInteger(expected) || expected < 0) {
      fail(
        state.source,
        `ordinal: caller ordinal is not a canonical safe integer (${String(expected)})`,
      );
    }
    if (identity.consumedOrdinals.has(expected) || expected < identity.next) {
      fail(state.source, `consumed: ordinal ${expected} is already committed`);
    }
    if (expected !== identity.next) {
      fail(
        state.source,
        `order: ordinal ${expected} is not the next unconsumed ordinal ${identity.next}`,
      );
    }
  } else if (identity.consumedMarkers.has(expected.start)) {
    fail(state.source, 'consumed: marker is already committed');
  }
  if (identity.reservation) {
    fail(state.source, 'busy: directory reservation is held');
  }
  const token = ++identity.serial;
  identity.reservation = { token, ordinal: identity.next };
  try {
    const parsed = parseDirectory(
      state.parent,
      state.declaration.length,
      state.source,
      identity.next,
    );
    const range =
      typeof expected === 'number'
        ? parsed.find((item) => item.ordinal === expected)
        : parsed.find((item) => item.start === expected.start);
    const ordinal = range?.ordinal;
    if (ordinal === undefined || !Number.isSafeInteger(ordinal) || !range) {
      fail(
        state.source,
        typeof expected === 'number'
          ? `order: ordinal ${String(expected)} is not an unconsumed range`
          : 'order: handle is not the start comment of a declared range',
      );
    }
    if (
      identity.consumedOrdinals.has(ordinal) ||
      ordinal < identity.next ||
      identity.consumedMarkers.has(range.start)
    ) {
      fail(state.source, `consumed: ordinal ${ordinal} is already committed`);
    }
    if (ordinal !== identity.next) {
      fail(
        state.source,
        `order: ordinal ${ordinal} is not the next unconsumed ordinal ${identity.next}`,
      );
    }
    const declared = state.declaration[ordinal];
    if (!declared || !range) fail(state.source, `order: ordinal ${ordinal} has no declaration`);
    matchInterior(range.interior, declared, state.source);
    const owner = insertingOwner.child();
    recordOwnerCreated();
    try {
      activate(owner, range.interior);
    } catch (error) {
      try {
        owner.dispose(false);
      } catch {
        // The activation error is what surfaces. Borrowed nodes stay.
      }
      throw error;
    }
    const owned = [range.start, ...range.interior, range.end];
    owner.addRangeCleanup(() => removeNodes(owned));
    recordRangeCleanup();
    recordRegionAllocated();
    recordProjection(owned.length);
    if (identity.reservation?.token !== token) {
      fail(state.source, 'busy: reservation changed during activation');
    }
    identity.consumedOrdinals.add(ordinal);
    identity.consumedMarkers.add(range.start);
    identity.consumedMarkers.add(range.end);
    identity.next = ordinal + 1;
    identity.reservation = null;
    let disposed = false;
    const claim: StaticSiblingClaim = {
      ordinal,
      owner,
      start: range.start,
      end: range.end,
      interior: range.interior,
      dispose(detachOwnedNodes = false): void {
        if (disposed) return;
        disposed = true;
        recordProjectionDisposed();
        owner.dispose(detachOwnedNodes);
      },
    };
    const frozen = Object.freeze(claim);
    identity.provisional.push({
      ordinal,
      start: range.start,
      end: range.end,
      release(): void {
        frozen.dispose(false);
      },
    });
    if (identity.next === state.declaration.length) identity.provisional.length = 0;
    return frozen;
  } catch (error) {
    rollbackProvisional(identity);
    if (identity.reservation?.token === token) identity.reservation = null;
    throw error;
  }
}
