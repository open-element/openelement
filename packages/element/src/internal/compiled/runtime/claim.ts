/**
 * Existing-DOM claim for the compiled Part Program runtime: the staged scan
 * that validates the complete owned structure against server-rendered (or
 * light) DOM before any subscription, listener, or ref attaches. Bounded
 * recovery lives in claim-recovery.ts (function-level ESM cycle, safe).
 */

import {
  DATA_OE_LIGHT,
  partAnchorEndMarker,
  partAnchorMarker,
  type PartProgramV1,
  type ProgramEachPart,
  type ProgramElementNode,
  type ProgramTreeNode,
  type ProgramWhenPart,
  STATIC_STYLES_MARKER,
} from '@openelement/protocol/part-program';
import { ClaimErrorCode, OpenElementError, RuntimeErrorCode } from '@openelement/protocol/errors';
// The broadcast attribute's single writer names it; the claim only classifies it.
import { THEME_ATTRIBUTE } from '../../../open-element-theme.ts';
// Canonical each-Region item-key derivation (#1374) — single source shared
// with the server serializer; do not reintroduce a private copy.
import { eachItemKey } from '../each-key.ts';
import { normalizePartProgram } from '../runtime-program.ts';
import type { LifetimeScope } from '../lifetime-scope.ts';
import type {
  CompiledProgramInstance,
  CompiledRuntimeHost,
  MountContext,
} from './program-kernel.ts';
import {
  createContext,
  displayValue,
  fail,
  fixedPartsAtPath,
  instance,
  isComment,
  isElement,
  isFixedPart,
  isText,
  itemAttrValue,
  itemTemplateFields,
  itemValue,
  NO_ITEM,
  removeNodes,
  signalOf,
  subscribeWrites,
} from './program-kernel.ts';
import { attachFixedParts, resolvePath, type TextPartSlot, updateTextPart } from './parts.ts';
// Region Parts claim and update through the builders seam (#1548): a
// regions-free bundle (an app whose Part Programs carry no when/each Parts)
// drops the whole regions module; a regions Part reaching a regions-free
// graph is a build-selection bug and fails closed.
import { regionBuildersOrFail } from './regions-seam.ts';
import type { EachEntry, EachRegion, ItemAttrSlot, ItemValueSlot, WhenRegion } from './regions.ts';
import {
  type PreUpgradeEvent,
  type PreUpgradeEventCapture,
  preUpgradeEventList,
  replayPreUpgradeEvents,
} from './pre-upgrade-events.ts';
import { recoverClaimOwner, resolveStreamRange } from './claim-recovery.ts';

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
 *
 * Part of the single error dialect (#1386 item 3): an `OpenElementError`
 * carrying {@linkcode ClaimErrorCode.STRUCTURE_MISMATCH}. The code value is
 * unchanged from 1.0.0-alpha.3, so a consumer matching on it keeps working;
 * `owner` and `detail` stay as fields because they are per-site provenance,
 * not contract.
 */
export class PartProgramClaimError extends OpenElementError {
  readonly path: string;
  readonly detail: string;
  readonly ownerKind: ClaimOwner['kind'];
  readonly owner: ClaimOwner;

  constructor(path: string, message: string, owner: ClaimOwner) {
    super(`[compiled-claim] ${path}: ${message}`, {
      code: ClaimErrorCode.STRUCTURE_MISMATCH,
      severity: 'error',
      phase: 'render',
      recoverable: true,
    });
    this.name = 'PartProgramClaimError';
    this.path = path;
    this.detail = message;
    this.ownerKind = owner.kind;
    this.owner = owner;
  }
}

export function claimFailure(path: string, message: string, owner: ClaimOwner): never {
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
        name.toLowerCase() === DATA_OE_LIGHT &&
        node.children.length === 0 &&
        node.tag.includes('-') &&
        element.getAttribute(DATA_OE_LIGHT) !== null
      )
        continue;
      // The theme manager writes its broadcast attribute on a custom-element
      // host at that host's own connect — which under chunked island loading
      // can precede THIS claim (the parent upgrades after the child island's
      // chunk). The attribute is runtime-managed state (THEME_ATTRIBUTE is the
      // manager's own constant), not server-rendered drift; its authored
      // value, when the program declares one, is still drift-checked above.
      if (name === THEME_ATTRIBUTE && node.tag.includes('-')) continue;
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

function findRegionEnd(parent: Node, start: number, marker: string): Comment | undefined {
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

/**
 * Claim-time validation of one each Region's items: records with own key and
 * own template fields, no duplicate keys. Failures are structured claim
 * mismatches owned by the Region, so `owning` recovery can rebuild exactly
 * that range.
 */
export function claimItemRecords(
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
    const key = eachItemKey(part, item);
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
export interface DeferredSubscription {
  scope: LifetimeScope;
  signal: string;
  fn: (value: unknown) => void;
}

export interface StreamClaimRange {
  parent: Node;
  anchor: Comment;
  end: Comment;
  scope: LifetimeScope;
  path: string;
  programPath: number[];
  owner: ClaimOwner;
}

interface StreamClaimState {
  streamed: ReadonlySet<number>;
  pending: ReadonlySet<number>;
  ranges: Map<number, StreamClaimRange>;
}

export function claimNodes(
  ctx: MountContext,
  parent: Node,
  cursor: number,
  nodes: ProgramTreeNode[],
  path: string,
  programPath: number[],
  scope: LifetimeScope,
  owner: ClaimOwner,
  pending: DeferredSubscription[],
  item: unknown = NO_ITEM,
  itemPart?: ProgramEachPart,
  itemValueSlots?: ItemValueSlot[],
  itemAttrSlots?: ItemAttrSlot[],
  stream?: StreamClaimState,
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
      const hasHtmlSink = fixedPartsAtPath(ctx, nodeProgramPath).some((part) => part.k === 'html');
      const ownsExpandedSubtree =
        node.children.length === 0 &&
        node.tag.includes('-') &&
        dom.getAttribute(DATA_OE_LIGHT) !== null;
      const ownsProjection =
        node.tag === 'slot' && node.children.length === 0 && dom.childNodes.length > 0;
      const consumed =
        hasHtmlSink || ownsExpandedSubtree || ownsProjection
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
              stream,
            );
      if (consumed !== dom.childNodes.length) {
        claimFailure(`${nodePath}.children`, 'unexpected trailing nodes', owner);
      }
      continue;
    }

    const part = ctx.program.parts[node.index];
    if (!part) claimFailure(nodePath, `missing Part ${node.index}`, owner);
    if (stream?.pending.has(part.index)) {
      if (part.k !== 'text' && part.k !== 'when' && part.k !== 'each') {
        claimFailure(nodePath, 'pending Part is not an owned range', owner);
      }
      const anchor = expectComment(at(cursor++), partAnchorMarker(part.index), nodePath, owner);
      const end = expectComment(at(cursor++), partAnchorEndMarker(part.index), nodePath, owner);
      stream.ranges.set(part.index, {
        parent,
        anchor,
        end,
        scope,
        path: nodePath,
        programPath,
        owner,
      });
      continue;
    }
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
      if (stream?.streamed.has(part.index)) {
        expectComment(at(cursor++), partAnchorEndMarker(part.index), nodePath, owner);
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
      const active = regionBuildersOrFail().whenActive(part, signalOf(ctx, part.signal).value);
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
        undefined,
        stream,
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
        fn: (value) => regionBuildersOrFail().updateWhen(region, value),
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
        const key = eachItemKey(part, currentItem);
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
          stream,
        );
        const entry: EachEntry = {
          key,
          scope: itemScope,
          nodes: Array.from(parent.childNodes).slice(before, cursor),
          valueSlots: itemSlots,
          attrSlots: itemAttrs,
          item: currentItem,
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
        fn: (next) => regionBuildersOrFail().updateEach(region, next),
      });
      continue;
    }
    claimFailure(nodePath, `Part ${node.index} has no claimable anchor`, owner);
  }
  return cursor;
}

export type ClaimRecoveryMode = 'throw' | 'owning';

/** Claim-time options for the owning root. */
export interface CompiledClaimOptions {
  /**
   * True when the claiming class carries static styles. The server serializer
   * emits those styles as one marked `<style data-oe-static-styles>` element —
   * the first template child — so a claim skips exactly that node. A marked
   * style node on a style-less class is drift and fails closed.
   *
   * Claim-then-delete: the skipped node is removed only after
   * the staged plan attaches (Parts bound, rootOffset=1 honored throughout) —
   * a claim failure keeps it, so recovery and never-upgrade pages keep
   * first-paint styling by construction.
   */
  expectStaticStyle?: boolean;
  /** Default is `throw`; `owning` enables one bounded recovery attempt. */
  recovery?: ClaimRecoveryMode;
  /** Observe the exact structured mismatch before optional recovery. */
  onMismatch?: (error: PartProgramClaimError) => void;
  /** Events captured before upgrade and replayed after a successful attach. */
  preUpgradeEvents?: readonly PreUpgradeEvent[] | PreUpgradeEventCapture;
  /** Stream-only Parts have a closing marker even for text; pending ranges are empty. */
  streamParts?: readonly number[];
  pendingParts?: readonly number[];
}

export function isStaticStyleNode(node: Node | undefined): boolean {
  return (
    !!node &&
    isElement(node) &&
    node.tagName.toLowerCase() === 'style' &&
    node.hasAttribute(STATIC_STYLES_MARKER)
  );
}

/**
 * Claim-then-delete: remove the marked DSD style node this
 * claim skipped at index 0. Called only after the staged plan has attached —
 * removal must not precede claim because Part paths resolve against
 * rootOffset=1 — so the node served first paint and anchored the scan, and
 * the shared adopted sheet the kernel applied is the one remaining channel.
 * A failed claim never reaches the caller, leaving the node in place for
 * recovery and for pages that never upgrade.
 */
function removeClaimedStaticStyle(root: Node): void {
  const node = root.childNodes[0];
  if (isStaticStyleNode(node)) root.removeChild(node);
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
        fail(
          RuntimeErrorCode.HOST_HANDLER_MISSING,
          `[compiled-runtime] missing host handler "${part.handler}"`,
        );
      }
    } else if (part.k === 'ref') {
      if (!ctx.host.refs?.[part.ref]) {
        fail(
          RuntimeErrorCode.HOST_REF_MISSING,
          `[compiled-runtime] missing host ref "${part.ref}"`,
        );
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
  stream?: StreamClaimState,
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
    NO_ITEM,
    undefined,
    undefined,
    undefined,
    stream,
  );
  if (consumed !== root.childNodes.length) {
    claimFailure('template', 'unexpected trailing nodes', owner);
  }
  validateFixedPartTargets(ctx, root, cursorStart, owner);
  return cursorStart;
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
  ownerScope?: LifetimeScope,
): CompiledProgramInstance {
  // Stop a live capture before staged validation so a failed claim cannot
  // leave its root listener installed. The captured records are replayed only
  // after the complete plan has attached successfully.
  const capturedEvents = preUpgradeEventList(options.preUpgradeEvents);
  const recovery = options.recovery ?? 'throw';
  let recovered = false;
  let rootRebuilt = false;
  for (;;) {
    const ctx = createContext(normalizePartProgram(program), host, ownerScope);
    const pending: DeferredSubscription[] = [];
    const streamed = new Set(options.streamParts ?? []);
    const unresolved = new Set(options.pendingParts ?? []);
    const isStream = options.streamParts !== undefined || options.pendingParts !== undefined;
    const stream: StreamClaimState | undefined = isStream
      ? { streamed, pending: unresolved, ranges: new Map() }
      : undefined;
    try {
      if (
        streamed.size !== (options.streamParts?.length ?? 0) ||
        unresolved.size !== (options.pendingParts?.length ?? 0) ||
        [...unresolved].some((index) => !streamed.has(index)) ||
        [...streamed].some(
          (index) =>
            !Number.isInteger(index) ||
            !ctx.program.parts[index] ||
            !['text', 'when', 'each'].includes(ctx.program.parts[index].k),
        )
      ) {
        claimFailure('template', 'invalid streamed or pending Part selection', {
          kind: 'root',
          root,
        });
      }
      const cursorStart = scanClaim(ctx, root, options, pending, stream);
      if (stream && stream.ranges.size !== unresolved.size) {
        claimFailure('template', 'pending Part has no owned range', { kind: 'root', root });
      }
      for (const deferred of pending) {
        subscribeWrites(ctx, deferred.scope, deferred.signal, deferred.fn);
      }
      // A rebuilt root carries no live values yet: fixed Parts apply their
      // initial values exactly as fresh creation would. A Region-range
      // recovery never contains fixed-Part targets, so `claim` mode stands.
      attachFixedParts(ctx, root, rootRebuilt ? 'fresh' : 'claim', cursorStart);
      replayPreUpgradeEvents(root, capturedEvents);
      // Part binding completed: the DSD style node's double application
      // retires (no-op when the claim ran from cursor 0). On the recovery
      // path this is "recovery completed" from the scenario table.
      if (cursorStart === 1) removeClaimedStaticStyle(root);
      const claimed = instance(ctx);
      if (!stream || stream.ranges.size === 0) return claimed;
      let disposed = false;
      return {
        dispose() {
          disposed = true;
          claimed.dispose();
        },
        resolveDeferred(index) {
          if (disposed || !stream.ranges.has(index)) {
            claimFailure(`parts[${index}]`, 'stream Part is disposed or already resolved', {
              kind: 'root',
              root,
            });
          }
          resolveStreamRange(ctx, stream.ranges.get(index)!, index, options);
          stream.ranges.delete(index);
        },
      };
    } catch (error) {
      try {
        ctx.rootScope.dispose();
      } catch {
        // Keep the structural diagnostic while still attempting every cleanup.
      }
      if (!(error instanceof PartProgramClaimError)) throw error;
      options.onMismatch?.(error);
      if (stream || recovery !== 'owning' || recovered || !recoverClaimOwner(error, ctx)) {
        throw error;
      }
      recovered = true;
      rootRebuilt = error.owner.kind === 'root';
    }
  }
}
