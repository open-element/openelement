/**
 * M07b — a caller-declared directory of static sibling ranges.
 *
 * One HTML element parent, and nothing else: its child list is exactly the
 * paired range markers for ordinals 0..N-1. The marker spelling and its
 * parser live in `./markers.ts`; this module consumes `parseRangeMarker` and
 * never restates the text.
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
 * A directory claim that commits every declared range stays permanent while
 * the claim owns the DOM: a later open of the same parent cannot re-take those
 * ordinals. Two disposal modes, two halves of one rule. A RETAINED-DOM dispose
 * -- `dispose(false)` on the claim, or a retained disposal of the scope the
 * claim was inserted into, which is the disconnect cascade -- releases that
 * claim's OWN tombstones and rewinds the cursor to its ordinal, so the
 * surviving markers can be claimed again in order by a reconnect. A DETACH
 * dispose (`dispose(true)`) keeps the tombstones: its range cleanup removed
 * the markers, so `consumed:` is the honest refusal for that ordinal. A
 * validation failure of the range in hand writes nothing and creates no owner
 * for that range. An activation failure disposes that uncommitted scope with
 * `dispose(false)` before the attempt is rolled back. A failure before the
 * reservation is taken does not roll the attempt back, and a `busy` reentry
 * does not clear the holder's reservation.
 *
 * @module ./static-sibling-ranges.ts
 */

import {
  raiseFrameworkError,
  RUNTIME_MESSAGES_ENABLED,
  RuntimeErrorCode,
} from '@openelement/protocol/errors';
import { STATIC_STYLES_MARKER } from '@openelement/protocol/part-program';
import type { LifetimeScope } from '../lifetime-scope.ts';
import {
  recordOwnerCreated,
  recordProjection,
  recordProjectionDisposed,
  recordRangeCleanup,
  recordRegionAllocated,
} from './observability.ts';
import { removeNodes } from './values.ts';
import {
  HTML_NAMESPACE,
  isClaimParentShadowRoot,
  staticAttributeSeedMismatch,
} from './claim-invariants.ts';
import { parseRangeMarker } from './markers.ts';
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

/**
 * A committed range. `dispose(false)` releases this range's directory
 * tombstones (the retained-DOM case); `dispose(true)` keeps them, because it
 * removes the markers.
 */
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
 * The directory parent is an HTML element or a real ShadowRoot. A bare
 * `DocumentFragment` is not a claim parent: it has no HTML host and no shadow
 * root platform surface.
 */
export type StaticSiblingDirectoryParent = Element | ShadowRoot;

/**
 * One open of a parent. The consumption and reservation live on the pair
 * identity below, not on this object: two opens of one parent share them.
 */
export interface StaticSiblingDirectory {
  readonly parent: StaticSiblingDirectoryParent;
  readonly declaration: readonly (readonly DeclaredStaticNode[])[];
  readonly source: string;
}

/**
 * Ownership of one parent. Keyed by the element, so it survives a second open
 * and a retained-DOM `dispose` that keeps the markers. The ordinal set and the
 * marker set are one claim's tombstone pair: permanent while that claim owns
 * the DOM, released together when that claim is disposed with the DOM
 * retained. It is not a global marker lock: a committed node moved under a
 * different parent is outside this slice.
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

const pairIdentities = new WeakMap<StaticSiblingDirectoryParent, PairIdentity>();

interface DirectoryState extends StaticSiblingDirectory {
  readonly identity: PairIdentity;
}

function pairIdentity(parent: StaticSiblingDirectoryParent): PairIdentity {
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

function rejectNestedMarker(node: Node, source: string): void {
  if (node.nodeType === 8) {
    const value = node.nodeValue ?? '';
    if (parseRangeMarker(value) !== null) {
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
 * The number of LEADING canonical marked stylesheet `<link>` nodes a claim
 * parent delivers before its authored content (M09-2e / #1803; F16 nested-light
 * lift).
 *
 * A claim parent that is a ShadowRoot is a parser-adopted DSD template. The
 * runtime prefixes that template with the marked links it owns: the module's
 * own declared sheets, plus — when a nested LIGHT child is expanded into the
 * same template — that child's lifted sheets. Those nodes are borrowed
 * delivery markup, never static-directory content, so the directory parse
 * starts after the run. The predicate is the emitted claim walk's own
 * (`nodeName === "LINK"` carrying the marker): a marked `<style>`, an unmarked
 * `<link>`, or a marked link past the run is NOT prefix and stays the
 * structural mismatch it always was.
 *
 * Scoped to the claim ROOT: an element directory's first child is never a
 * style link, so no other parent skips anything.
 */
function leadingStyleLinkCount(parent: StaticSiblingDirectoryParent): number {
  if (!isClaimParentShadowRoot(parent)) return 0;
  const children = parent.childNodes;
  let count = 0;
  for (;;) {
    const node = count < children.length ? childAt(children, count) : null;
    if (node === null || node.nodeType !== 1) return count;
    const element = node as Element;
    if (element.nodeName !== 'LINK') return count;
    if (!element.hasAttribute(STATIC_STYLES_MARKER)) return count;
    count += 1;
  }
}

/**
 * The parent must be only sibling ranges. Ordinals are strictly increasing.
 * Every ordinal `>= requiredFrom` (the unconsumed suffix) must be present.
 * The start slot must carry the start spelling `oe:r:<n>`; an end marker
 * `oe:/r:<n>` there is malformed, not a start whose close happens to follow.
 * A retained-DOM dispose rewinds the cursor to the released ordinal, so those
 * markers are the unconsumed suffix again. A detach dispose keeps the
 * tombstone and never rewinds: its markers are absent and the suffix starts
 * after them.
 */
function parseDirectory(
  parent: StaticSiblingDirectoryParent,
  count: number,
  source: string,
  requiredFrom: number,
): ParsedRange[] {
  const all = childrenOf(parent);
  const skip = leadingStyleLinkCount(parent);
  const children = skip === 0 ? all : all.slice(skip);
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
    const startMarker = parseRangeMarker(start.nodeValue);
    if (startMarker === null) {
      fail(source, `ordinal: non-canonical start ${JSON.stringify(start.nodeValue)}`);
    }
    // The pair spelling has a start (`oe:r:<n>`) and an end (`oe:/r:<n>`). The
    // start slot reads only the start spelling; an end marker there is a
    // malformed skeleton, not a start that happens to close later.
    if (startMarker.end) {
      fail(source, `boundary: end marker in a start slot ${JSON.stringify(start.nodeValue)}`);
    }
    const ordinal = startMarker.ordinal;
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
      if (node.nodeType === 8) {
        const marker = parseRangeMarker(node.nodeValue);
        if (marker !== null && marker.end && marker.ordinal === ordinal) {
          closed = true;
          break;
        }
        if (marker !== null && !marker.end) {
          fail(source, `boundary: crossed or nested start ${JSON.stringify(node.nodeValue)}`);
        }
        if (marker !== null) {
          fail(source, `boundary: mismatched end ${JSON.stringify(node.nodeValue)}`);
        }
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
  // One rule, one implementation: the seed predicate in `claim-invariants.ts`
  // is what the generated leaf claim asserts too. Only the error identity
  // differs (directory code here, leaf code there).
  return staticAttributeSeedMismatch(element, expected) === null;
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
  const directoryParent: StaticSiblingDirectoryParent | null =
    parent.nodeType === 1 ? (parent as Element) : isClaimParentShadowRoot(parent) ? parent : null;
  if (directoryParent === null) {
    fail(source, `parent: unsupported directory parent ${JSON.stringify(String(parent.nodeType))}`);
  }
  // A ShadowRoot parent is checked through its host: the host is the element
  // that owns the tree, and the host's element ancestors take the place of an
  // element parent's ancestors. A plain DocumentFragment never reaches here.
  const anchor: Element =
    directoryParent.nodeType === 1
      ? (directoryParent as Element)
      : (directoryParent as ShadowRoot).host;
  const rejection = elementRejection(anchor);
  if (rejection) fail(source, `parent: unsupported directory parent (${rejection})`);
  let ancestor: Node | null = anchor.parentNode;
  while (ancestor) {
    if (ancestor.nodeType === 1) {
      const ancestorRejection = elementRejection(ancestor as Element);
      if (ancestorRejection) fail(source, `parent: directory is inside ${ancestorRejection}`);
    }
    ancestor = ancestor.parentNode;
  }
  const identity = pairIdentity(directoryParent);
  if (identity.reservation) fail(source, 'busy: directory reservation is held');
  parseDirectory(directoryParent, declaration.length, source, identity.next);
  const state: DirectoryState = {
    parent: directoryParent,
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
 * committed, the claim owns its tombstones: they stay while it owns the DOM
 * (a later open of the same parent cannot re-take them), until a retained-DOM
 * dispose releases them for the next claim in order. A detach dispose keeps
 * them, because it removed the markers.
 */

/**
 * Undo tombstones and the success cursor of the incomplete attempt, then
 * release those owners. A directory claim that already committed every range
 * has nothing provisional and is left alone: its tombstones are permanent
 * while it owns the DOM, and only a retained-DOM dispose releases them (a
 * rollback is not one). Dispose errors do not replace the claim error.
 * Borrowed nodes are not removed: release uses `dispose(false)`.
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

/**
 * Release one claim's OWN tombstone pair: its ordinal and its two marker
 * nodes leave the identity, and the cursor rewinds to its ordinal so the next
 * claim can take it in order. A tombstone the identity has since given back to
 * a later claim is never touched -- the caller's one-shot guard limits this to
 * one call per claim. The live-owner guard is elsewhere and stays: only a
 * claim whose owner is disposed reaches this function.
 */
function releaseClaimTombstones(
  identity: PairIdentity,
  ordinal: number,
  start: Node,
  end: Node,
): void {
  identity.consumedOrdinals.delete(ordinal);
  identity.consumedMarkers.delete(start);
  identity.consumedMarkers.delete(end);
  if (ordinal < identity.next) identity.next = ordinal;
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
    // One release per claim, and only this claim's own pair.
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      releaseClaimTombstones(identity, ordinal, range.start, range.end);
    };
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
        try {
          owner.dispose(detachOwnedNodes);
        } finally {
          // The retained-DOM dispose releases the tombstones even when a
          // cleanup throws: the markers are still in the parent.
          if (!detachOwnedNodes) release();
        }
      },
    };
    // The shell disposes the scope the claim was inserted into, not this
    // handle: `projection?.dispose(false)` on disconnect cascades to the range
    // owner. That cascade is the retained-DOM case too, so the claim registers
    // one cleanup on its inserting scope. A parent's regular cleanups run
    // after its child scopes are disposed and after their detach range
    // cleanups, so a marker still in the parent means "retained" (release) and
    // an absent marker means "detached" (keep the tombstone).
    insertingOwner.add(() => {
      if (!owner.disposed) return;
      if (range.start.parentNode !== state.parent) return;
      release();
    });
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
