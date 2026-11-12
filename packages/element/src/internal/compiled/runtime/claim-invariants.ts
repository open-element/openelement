/**
 * claim-invariants.ts — the single implementation of the generated-leaf claim
 * invariants.
 *
 * Four rules decide whether a generated leaf claim may adopt existing DOM:
 *
 *   1. the claim parent, its element ancestors and each claimed element are in
 *      the HTML namespace;
 *   2. each claimed element's static attribute seed is exactly the declared
 *      ordered set (names compared after HTML ASCII case folding, because the
 *      DOM exposes HTML attribute names lowercased; values compared exactly);
 *   3. each dynamic-text slot consumes one expected start/end comment pair with
 *      a matching canonical ordinal at the current position;
 *   4. a structural mismatch is reported as one catalogued internal identity.
 *
 * The generated claim calls into this module instead of emitting its own copy
 * of the rule, so the rule exists once. The directory consumer
 * (`./static-sibling-ranges.ts`) shares the same two predicates and maps a
 * failure onto its own `OE_RUNTIME_STATIC_RANGE_MISMATCH` identity: the codes
 * differ because the failure surfaces differ, the rule does not.
 *
 * `LEAF_CLAIM_MISMATCH` is deliberately not a member of the exported
 * `RuntimeErrorCode` catalogue (that catalogue requires the `OE_` prefix). It
 * is the internal generated-leaf identity and it stays internal: no public
 * runtime code, no `public-interface-snapshot` change.
 *
 * @module ./claim-invariants.ts
 */

import { OpenElementError } from '@openelement/protocol/errors';
import { LIST_KEY_UNSUPPORTED } from './list-key.ts';
import {
  parseEachMarker,
  parseEntryKeyMarker,
  parseTextSlotMarker,
  parseWhenMarker,
} from './markers.ts';

/** The HTML namespace. Every claimed element must be in it. */
export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/**
 * Internal identity of a generated-leaf structural mismatch. The value is the
 * long-standing wire string; it is not `OE_RUNTIME_STATIC_RANGE_MISMATCH` and
 * it is not part of the exported code catalogue.
 */
export const LEAF_CLAIM_MISMATCH = 'OEIR_LEAF_CLAIM_MISMATCH';

/** One declared static attribute, already authored order. */
export interface DeclaredStaticAttribute {
  readonly name: string;
  readonly value: string;
}

function describe(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * The one way a generated-leaf claim reports a mismatch. Generated modules
 * call this instead of constructing the error and its options themselves, so
 * the code, phase and recoverability live here too.
 */
export function leafClaimMismatch(detail: string): OpenElementError {
  return new OpenElementError(`${LEAF_CLAIM_MISMATCH}: ${detail}`, {
    code: LEAF_CLAIM_MISMATCH,
    phase: 'csr',
    severity: 'error',
    recoverable: false,
  });
}

/**
 * `null` when the element's static attribute seed equals `declared` in name,
 * value and order; otherwise a human-readable reason. Names are compared after
 * HTML ASCII case folding; values stay exact. Attributes the caller owns
 * dynamically are excluded by the caller, not here.
 */
export function staticAttributeSeedMismatch(
  element: Element,
  declared: readonly DeclaredStaticAttribute[],
  dynamicNames: readonly string[] = [],
): string | null {
  const { attributes } = element;
  const skip = new Set(dynamicNames.map((name) => name.toLowerCase()));
  const live: { name: string; value: string }[] = [];
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes.item(index);
    if (attribute === null) continue;
    const name = attribute.name.toLowerCase();
    // A slot the claim writes itself is not part of the static seed.
    if (skip.has(name)) continue;
    live.push({ name, value: attribute.value });
  }
  if (live.length !== declared.length) {
    return `static attribute seed count is ${live.length}, declared ${declared.length}`;
  }
  for (let index = 0; index < declared.length; index += 1) {
    const actual = live[index];
    const expected = declared[index];
    if (actual === undefined || expected === undefined)
      return 'static attribute seed is shorter than declared';
    const name = expected.name.toLowerCase();
    if (actual.name !== name) {
      return `static attribute ${name} is out of order (found ${actual.name})`;
    }
    if (actual.value !== expected.value) {
      return `static attribute ${name} has value ${describe(actual.value)}, declared ${describe(expected.value)}`;
    }
  }
  return null;
}

/** Throw the catalogued leaf mismatch when the static attribute seed differs. */
export function assertStaticAttributeSeed(
  element: Element,
  declared: readonly DeclaredStaticAttribute[],
  where: string,
  dynamicNames: readonly string[] = [],
): void {
  const reason = staticAttributeSeedMismatch(element, declared, dynamicNames);
  if (reason !== null) throw leafClaimMismatch(`${reason} at ${where}`);
}

/**
 * `null` when the node is an HTML element; otherwise a reason. Text and
 * comment nodes are not element-namespace failures.
 */
export function elementHtmlNamespaceViolation(node: Node | null): string | null {
  if (node === null) return 'no node';
  if (node.nodeType !== 1) return 'not an element';
  const element = node as Element;
  if (element.namespaceURI !== HTML_NAMESPACE) {
    return `non-HTML namespace ${describe(element.namespaceURI)} on ${describe(element.localName ?? element.nodeName)}`;
  }
  return null;
}

/**
 * The generated dynamic-text claim consumes one expected boundary marker at the
 * current position. It is a one-position check, not a protocol interpreter:
 * there is no scan, no descriptor table and no recovery path.
 *
 * A missing/mistyped/foreign marker fails closed with the same internal
 * `OEIR_LEAF_CLAIM_MISMATCH` identity the rest of the leaf claim uses. The
 * comment's text is never echoed into the error: it may be arbitrary page
 * content and is not useful to the caller.
 */
export function assertTextSlotMarker(
  node: Node | null | undefined,
  ordinal: number,
  end: boolean,
  where: string,
): void {
  const position = end ? 'end' : 'start';
  if (node == null) {
    throw leafClaimMismatch(`text boundary ${position} is missing at ${where}`);
  }
  if (node.nodeType !== 8) {
    throw leafClaimMismatch(`text boundary ${position} at ${where} is not a comment`);
  }
  const parsed = parseTextSlotMarker((node as Comment).nodeValue);
  if (parsed === null || parsed.end !== end || parsed.ordinal !== ordinal) {
    throw leafClaimMismatch(
      `text boundary ${position} at ${where} does not match ordinal ${ordinal}`,
    );
  }
}

/**
 * The condition anchor/end are fixed markers, not a scan. A missing, foreign or
 * swapped comment fails closed with the same internal leaf-claim identity. The
 * condition has no branch id: the branch identity is the client branch
 * template's structure, static attribute seed, values and slot ordinals, all
 * checked by the ordinary claim walk.
 */
export function isWhenEndMarker(node: Node | null | undefined): boolean {
  return (
    node != null && node.nodeType === 8 && parseWhenMarker((node as Comment).nodeValue) === 'end'
  );
}

export function assertWhenAnchor(node: Node | null | undefined, where: string): void {
  if (node == null) {
    throw leafClaimMismatch(`condition anchor is missing at ${where}`);
  }
  if (node.nodeType !== 8) {
    throw leafClaimMismatch(`condition anchor at ${where} is not a comment`);
  }
  if (parseWhenMarker((node as Comment).nodeValue) !== 'start') {
    throw leafClaimMismatch(`condition anchor at ${where} does not match`);
  }
}

export function assertWhenEndMarker(node: Node | null | undefined, where: string): void {
  if (node == null) {
    throw leafClaimMismatch(`condition end is missing at ${where}`);
  }
  if (node.nodeType !== 8) {
    throw leafClaimMismatch(`condition end at ${where} is not a comment`);
  }
  if (parseWhenMarker((node as Comment).nodeValue) !== 'end') {
    throw leafClaimMismatch(`condition end at ${where} does not match`);
  }
}

/**
 * The list anchor/end are fixed markers checked at one position. No scan, no
 * ordinal, no per-entry end marker. A missing, foreign or swapped comment fails
 * closed with the internal leaf mismatch identity.
 *
 * This is a check of the parsed DOM only. A raw-byte truncation that the HTML
 * parser repairs into the same legal comment node (for example `<!--oe:/each`
 * at EOF) is structurally indistinguishable from the producer's document here;
 * original-byte/transport completeness belongs to the HTTP/build boundary and
 * is not claimed by this check. No document/root sentinel is added.
 */
export function assertEachAnchor(node: Node | null | undefined, where: string): void {
  if (node == null) {
    throw leafClaimMismatch(`list anchor is missing at ${where}`);
  }
  if (node.nodeType !== 8) {
    throw leafClaimMismatch(`list anchor at ${where} is not a comment`);
  }
  if (parseEachMarker((node as Comment).nodeValue) !== 'start') {
    throw leafClaimMismatch(`list anchor at ${where} does not match`);
  }
}

export function assertEachEndMarker(node: Node | null | undefined, where: string): void {
  if (node == null) {
    throw leafClaimMismatch(`list end is missing at ${where}`);
  }
  if (node.nodeType !== 8) {
    throw leafClaimMismatch(`list end at ${where} is not a comment`);
  }
  if (parseEachMarker((node as Comment).nodeValue) !== 'end') {
    throw leafClaimMismatch(`list end at ${where} does not match`);
  }
}

/** `true` exactly when the node is the list-level closing marker. */
export function isEachEndMarker(node: Node | null | undefined): boolean {
  return (
    node != null && node.nodeType === 8 && parseEachMarker((node as Comment).nodeValue) === 'end'
  );
}

/**
 * Read one entry-key marker at the current position. The comment must parse as
 * `oe:k:<canonical token>`; the mount-only `u` payload is an explicit mismatch
 * (`unsupported entry key kind`), never silently adopted. The token is returned
 * as a string and never decoded.
 */
export function readEntryKeyMarker(node: Node | null | undefined, where: string): string {
  if (node == null) {
    throw leafClaimMismatch(`entry key marker is missing at ${where}`);
  }
  if (node.nodeType !== 8) {
    throw leafClaimMismatch(`entry key marker at ${where} is not a comment`);
  }
  const parsed = parseEntryKeyMarker((node as Comment).nodeValue);
  if (parsed === null) {
    throw leafClaimMismatch(`entry key marker at ${where} does not match`);
  }
  if (parsed.token === LIST_KEY_UNSUPPORTED) {
    throw leafClaimMismatch(`unsupported entry key kind at ${where}`);
  }
  return parsed.token;
}

/**
 * Server/client entry-seed comparison. Pure string work: no DOM, no decode, no
 * key recovery. The wire keeps the mount's duplicate-key semantics: the same
 * token may appear more than once and every occurrence is a distinct entry
 * identity. The rules run in order and the first failure wins:
 *
 *   S1 a client key outside the admitted primitives;
 *   S2 a wire token occurs more often than the client list (ambiguous borrowed
 *      identity: the extra server occurrence has no client item to adopt it);
 *   S3 a wire token with no client item at all (would require deleting borrowed
 *      DOM).
 *
 * Ordering is not compared: the claim matches by token and the existing
 * minimal-move placement handles reorder. Wire-more is S2/S3; client-more is
 * the insert path, not a mismatch here. Duplicate client keys are legal and are
 * handled by the mount used-set rule. The caller pairs the Nth occurrence of a
 * token with the Nth wire entry of that token, so cross-key reorder keeps each
 * token's occurrence order stable while every entry identity is consumed at
 * most once.
 */
export function entrySeedMismatch(
  wireTokens: readonly string[],
  clientTokens: readonly (string | null)[],
): string | null {
  for (const token of clientTokens) {
    if (token === null) return 'client entry key is not a supported primitive';
  }
  const clientCounts = new Map<string, number>();
  for (const token of clientTokens) {
    if (token === null) continue;
    clientCounts.set(token, (clientCounts.get(token) ?? 0) + 1);
  }
  const wireCounts = new Map<string, number>();
  for (const token of wireTokens) {
    wireCounts.set(token, (wireCounts.get(token) ?? 0) + 1);
  }
  for (const [token, wireCount] of wireCounts) {
    const clientCount = clientCounts.get(token) ?? 0;
    if (clientCount === 0) return 'server entry key has no client item';
    if (wireCount > clientCount) {
      return `server entry key ${token} occurs ${wireCount} times, client has ${clientCount}`;
    }
  }
  return null;
}

/**
 * The claim parent, every element ancestor, and each claimed element must be
 * in the HTML namespace. The failure window does not write.
 */
export function assertElementInHtmlNamespace(node: Node | null, where: string): void {
  // The claim target itself must be an HTML element (a text or comment node is
  // not a claim target at all). Element ancestors are checked above it.
  const own = elementHtmlNamespaceViolation(node);
  if (own !== null) throw leafClaimMismatch(`non-HTML namespace at ${where} (${own})`);
  for (let current = node?.parentNode ?? null; current !== null; current = current.parentNode) {
    if (current.nodeType !== 1) continue;
    const reason = elementHtmlNamespaceViolation(current);
    if (reason !== null) throw leafClaimMismatch(`non-HTML namespace at ${where} (${reason})`);
  }
}
