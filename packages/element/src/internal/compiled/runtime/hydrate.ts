/**
 * Existing-DOM hydration for the compiled Part Program runtime: the staged scan
 * that validates the complete owned structure against server-rendered (or
 * light) DOM before any subscription, listener, or ref attaches. Bounded
 * recovery lives in hydrate-recovery.ts (function-level ESM cycle, safe).
 */

import {
  DATA_OE_LIGHT,
  partAnchorEndMarker,
  partAnchorMarker,
  type PartProgramV2,
  type ProgramEachPart,
  type ProgramElementNode,
  type ProgramTreeNode,
  type ProgramWhenPart,
} from '@openelement/protocol/part-program';
import { ClaimErrorCode, OpenElementError, RuntimeErrorCode } from '@openelement/protocol/errors';
// The broadcast attribute's single writer names it; hydration only classifies it.
import { THEME_ATTRIBUTE } from '../../../open-element-theme.ts';
// Canonical each-Block item-key derivation (#1374) — single source shared
// with the server serializer; do not reintroduce a private copy.
import { isExpectedStyleResource, styleResourceIdentity } from '../style-identity.ts';
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
  fixedPartsAtNode,
  fixedPartsAtPath,
  isComment,
  isElement,
  isFixedPart,
  isStaticStyleFallbackNode,
  isStaticStyleNode,
  isText,
  itemAttrValue,
  itemTemplateFields,
  itemValue,
  NO_ITEM,
  removeNodes,
  signalOf,
  subscribeWrites,
} from './program-kernel.ts';
import {
  attachFixedParts,
  installBranchValueParts,
  resolvePath,
  type TextPartSlot,
  updateTextPart,
} from './parts.ts';
import { createRevivableInstance } from './revive.ts';
// Block Parts hydrate and update through the builders seam (#1548): a
// blocks-free bundle (an app whose Part Programs carry no when/each Parts)
// drops the whole blocks module; a blocks Part reaching a blocks-free
// graph is a build-selection bug and fails closed.
import { blockBuildersOrFail } from './blocks-seam.ts';
import type { EachEntry, EachBlock, ItemAttrSlot, ItemValueSlot, WhenBlock } from './blocks.ts';
import { attachItemEvents } from './blocks.ts';
import {
  type PreUpgradeEvent,
  type PreUpgradeEventCapture,
  preUpgradeEventList,
  replayPreUpgradeEvents,
} from './pre-upgrade-events.ts';
import { recoverHydrationOwner, resolveStreamRange } from './hydrate-recovery.ts';

/** Owning range a hydration mismatch is attributed to: the root or one bounded Block. */
export interface RootHydrationOwner {
  kind: 'root';
  root: Node;
}

export interface BlockHydrationOwner {
  kind: 'block';
  parent: Node;
  anchor: Comment;
  end: Comment;
  part: ProgramWhenPart | ProgramEachPart;
}

export type HydrationOwner = RootHydrationOwner | BlockHydrationOwner;

/**
 * Structured diagnostic for hydration-time structure/identity drift. The canonical
 * constructor contract is `(path, message, owner)`: every mismatch carries the
 * exact owning range (root or one bounded Block) so bounded `owning`
 * recovery can rebuild exactly that range — and nothing outside it.
 *
 * Part of the single error dialect (#1386 item 3): an `OpenElementError`
 * carrying {@linkcode ClaimErrorCode.STRUCTURE_MISMATCH}. The code value is
 * unchanged from 1.0.0-alpha.3, so a consumer matching on it keeps working;
 * `owner` and `detail` stay as fields because they are per-site provenance,
 * not contract.
 */
export class PartProgramHydrationError extends OpenElementError {
  readonly path: string;
  readonly detail: string;
  readonly ownerKind: HydrationOwner['kind'];
  readonly owner: HydrationOwner;

  constructor(path: string, message: string, owner: HydrationOwner) {
    super(`[compiled-hydration] ${path}: ${message}`, {
      code: ClaimErrorCode.STRUCTURE_MISMATCH,
      severity: 'error',
      phase: 'render',
      recoverable: true,
    });
    this.name = 'PartProgramHydrationError';
    this.path = path;
    this.detail = message;
    this.ownerKind = owner.kind;
    this.owner = owner;
  }
}

export function hydrateFailure(path: string, message: string, owner: HydrationOwner): never {
  throw new PartProgramHydrationError(path, message, owner);
}

function expectComment(node: Node, marker: string, path: string, owner: HydrationOwner): Comment {
  if (!isComment(node) || node.data !== marker) {
    hydrateFailure(path, `expected <!--${marker}--> anchor`, owner);
  }
  return node;
}

function dynamicAttributeNames(ctx: MountContext, path: number[], nodeId?: string): Set<string> {
  const names = new Set<string>();
  for (const part of fixedPartsAtPath(ctx, path)) {
    if (part.k === 'attr' || part.k === 'prop' || part.k === 'bool') names.add(part.name);
    if (part.k === 'class') names.add('class');
    if (part.k === 'style') names.add('style');
  }
  // Branch-owned sinks attribute by element id (alpha15): their paths are
  // branch-relative, so the walk path finds nothing — the sink's own
  // location element id is the identity.
  if (nodeId !== undefined) {
    for (const part of fixedPartsAtNode(ctx, nodeId)) {
      if (part.k === 'attr' || part.k === 'prop' || part.k === 'bool') names.add(part.name);
      if (part.k === 'class') names.add('class');
      if (part.k === 'style') names.add('style');
    }
  }
  return names;
}

function hydrateElementAttributes(
  ctx: MountContext,
  element: Element,
  node: ProgramElementNode,
  path: string,
  programPath: number[],
  owner: HydrationOwner,
): void {
  const dynamic = dynamicAttributeNames(ctx, programPath, node.id);
  // Per-item attribute slots are verified with their item context by the
  // caller; they are not static drift.
  for (const [name] of node.iattrs ?? []) dynamic.add(name);
  for (const [name, value] of node.attrs) {
    if (dynamic.has(name)) continue;
    if (element.getAttribute(name) !== value) {
      hydrateFailure(
        path,
        `attribute drift on "${name}": expected ${JSON.stringify(value)}`,
        owner,
      );
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
      // can precede THIS hydration (the parent upgrades after the child island's
      // chunk). The attribute is runtime-managed state (THEME_ATTRIBUTE is the
      // manager's own constant), not server-rendered drift; its authored
      // value, when the program declares one, is still drift-checked above.
      if (name === THEME_ATTRIBUTE && node.tag.includes('-')) continue;
      if (!expected.has(name)) hydrateFailure(path, `unexpected attribute "${name}"`, owner);
    }
    for (const name of expected) {
      // A dynamic sink may legitimately have no serialized attribute; its live
      // value is deliberately not read or overwritten by hydration.
      if (dynamic.has(name)) continue;
      if (!actualNames.includes(name)) hydrateFailure(path, `missing attribute "${name}"`, owner);
    }
  } else {
    // No attribute-name inspection API: the reverse direction of the
    // dual-compare cannot run, so this range is unverifiable — fail the hydration
    // (bounded recovery rebuilds exactly this range) instead of silently
    // waving an unchecked element through.
    hydrateFailure(
      path,
      'cannot verify attributes: Element.getAttributeNames is unavailable in this DOM',
      owner,
    );
  }
}

function findBlockEnd(parent: Node, start: number, marker: string): Comment | undefined {
  for (let index = start; index < parent.childNodes.length; index++) {
    const node = parent.childNodes[index];
    if (isComment(node) && node.data === marker) return node;
  }
  return undefined;
}

/** Attribute a Block-internal mismatch to its bounded anchor/end range. */
function blockHydrationOwner(
  parent: Node,
  start: number,
  part: ProgramWhenPart | ProgramEachPart,
  anchor: Comment,
  fallback: HydrationOwner,
): HydrationOwner {
  const end = findBlockEnd(parent, start, partAnchorEndMarker(part.index));
  return end ? { kind: 'block', parent, anchor, end, part } : fallback;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Hydration-time validation of one each Block's items: records with own key and
 * own template fields, no duplicate keys. Failures are structured hydration
 * mismatches owned by the Block, so `owning` recovery can rebuild exactly
 * that range.
 */
export function hydrateItemRecords(
  part: ProgramEachPart,
  value: unknown,
  path: string,
  owner: HydrationOwner,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    hydrateFailure(path, 'each Block dependency must contain an array', owner);
  }
  const requiredFields = itemTemplateFields(part.item);
  const seen = new Set<string>();
  const items: Array<Record<string, unknown>> = [];
  for (let index = 0; index < value.length; index++) {
    const item: unknown = value[index];
    const itemPath = `${path}[${index}]`;
    if (!isRecordValue(item)) hydrateFailure(itemPath, 'item must be a record', owner);
    if (!Object.prototype.hasOwnProperty.call(item, part.key)) {
      hydrateFailure(itemPath, `item needs ${JSON.stringify(part.key)}`, owner);
    }
    for (const field of requiredFields) {
      if (!Object.prototype.hasOwnProperty.call(item, field)) {
        hydrateFailure(itemPath, `item needs ${JSON.stringify(field)}`, owner);
      }
    }
    const key = eachItemKey(part, item);
    if (seen.has(key)) {
      hydrateFailure(path, `duplicate key ${JSON.stringify(item[part.key])}`, owner);
    }
    seen.add(key);
    items.push(item);
  }
  return items;
}

/**
 * One signal subscription deferred to the attach phase. Hydration is staged: the
 * complete owned structure is validated before any subscription, listener, or
 * ref attaches, so a failed hydration leaves zero live resources behind.
 */
export interface DeferredSubscription {
  scope: LifetimeScope;
  signal: string;
  fn: (value: unknown) => void;
}

export interface StreamHydrationRange {
  parent: Node;
  anchor: Comment;
  end: Comment;
  scope: LifetimeScope;
  path: string;
  programPath: number[];
  owner: HydrationOwner;
}

interface StreamHydrationState {
  streamed: ReadonlySet<number>;
  pending: ReadonlySet<number>;
  ranges: Map<number, StreamHydrationRange>;
}

/**
 * One branch-sink binding deferred to the attach phase (alpha15): the when
 * Block's claimed nodes plus the branch scope the sinks install on. Like the
 * deferred subscriptions, nothing binds until the complete scan passed.
 */
export interface DeferredBranchInstall {
  scope: LifetimeScope;
  nodes: readonly Node[];
  whenIndex: number;
  which: 'on' | 'off';
}

export function hydrateNodes(
  ctx: MountContext,
  parent: Node,
  cursor: number,
  nodes: ProgramTreeNode[],
  path: string,
  programPath: number[],
  scope: LifetimeScope,
  owner: HydrationOwner,
  pending: DeferredSubscription[],
  item: unknown = NO_ITEM,
  itemPart?: ProgramEachPart,
  itemValueSlots?: ItemValueSlot[],
  itemAttrSlots?: ItemAttrSlot[],
  stream?: StreamHydrationState,
  branchInstalls?: DeferredBranchInstall[],
): number {
  const at = (index: number): Node => {
    const node = parent.childNodes[index];
    if (!node) hydrateFailure(path, `missing child at DOM index ${index}`, owner);
    return node;
  };

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const nodePath = `${path}[${index}]`;
    const nodeProgramPath = [...programPath, index];
    if (node.k === 'text') {
      const dom = at(cursor++);
      if (!isText(dom)) hydrateFailure(nodePath, 'expected a text node', owner);
      if (dom.data !== node.value) {
        hydrateFailure(
          nodePath,
          `text drift: expected ${JSON.stringify(node.value)}, found ${JSON.stringify(dom.data)}`,
          owner,
        );
      }
      continue;
    }
    if (node.k === 'ival') {
      if (item === NO_ITEM)
        hydrateFailure(nodePath, 'item value slot outside an each Block', owner);
      if (!itemPart) hydrateFailure(nodePath, 'item value slot has no item Block', owner);
      const expected = displayValue(itemValue(itemPart, item, node.field));
      if (expected.length > 0) {
        const dom = at(cursor++);
        if (!isText(dom)) hydrateFailure(nodePath, 'expected item value text', owner);
        if (dom.data !== expected) {
          hydrateFailure(nodePath, `item text drift: expected ${JSON.stringify(expected)}`, owner);
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
      if (!isElement(dom)) hydrateFailure(nodePath, 'expected an element', owner);
      if (dom.tagName.toLowerCase() !== node.tag) {
        hydrateFailure(
          nodePath,
          `expected <${node.tag}>, found <${dom.tagName.toLowerCase()}>`,
          owner,
        );
      }
      hydrateElementAttributes(ctx, dom, node, nodePath, nodeProgramPath, owner);
      if (node.iattrs !== undefined) {
        // Per-item attribute slots carry the item context: values are verified
        // against the item (deterministic) and tracked for keyed-reuse updates.
        if (item === NO_ITEM || !itemPart) {
          hydrateFailure(nodePath, 'item attribute slot outside an each Block', owner);
        }
        for (const [name, field] of node.iattrs) {
          const expected = itemAttrValue(item, field);
          const actual = dom.getAttribute(name);
          if (expected === null ? actual !== null : actual !== expected) {
            hydrateFailure(
              nodePath,
              `item attribute drift on "${name}": expected ${JSON.stringify(expected)}`,
              owner,
            );
          }
          itemAttrSlots?.push({ element: dom, name, field });
        }
      }
      // A trusted-HTML sink owns the target's whole content: the subtree is
      // opaque to the hydration (the program declares no structure inside it).
      const hasHtmlSink =
        fixedPartsAtPath(ctx, nodeProgramPath).some((part) => part.k === 'html') ||
        fixedPartsAtNode(ctx, node.id).some((part) => part.k === 'html');
      const ownsExpandedSubtree =
        node.children.length === 0 &&
        node.tag.includes('-') &&
        dom.getAttribute(DATA_OE_LIGHT) !== null;
      const ownsProjection =
        node.tag === 'slot' && node.children.length === 0 && dom.childNodes.length > 0;
      const consumed =
        hasHtmlSink || ownsExpandedSubtree || ownsProjection
          ? dom.childNodes.length
          : hydrateNodes(
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
              branchInstalls,
            );
      if (consumed !== dom.childNodes.length) {
        hydrateFailure(`${nodePath}.children`, 'unexpected trailing nodes', owner);
      }
      continue;
    }

    const part = ctx.program.parts[node.index];
    if (!part) hydrateFailure(nodePath, `missing Part ${node.index}`, owner);
    if (stream?.pending.has(part.index)) {
      if (part.k !== 'text' && part.k !== 'when' && part.k !== 'each') {
        hydrateFailure(nodePath, 'pending Part is not an owned range', owner);
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
          hydrateFailure(nodePath, 'expected a text node after the part anchor', owner);
        }
        text = next;
        if (text.data !== expected) {
          hydrateFailure(nodePath, `part text drift: expected ${JSON.stringify(expected)}`, owner);
        }
      }
      if (stream?.streamed.has(part.index)) {
        expectComment(at(cursor++), partAnchorEndMarker(part.index), nodePath, owner);
      }
      const partScope = scope.child();
      const slot: TextPartSlot = { scope: partScope, anchor, text, current: expected };
      // The ownership record a reconnect re-arms (revive.ts).
      ctx.bindings.set(part.index, slot);
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
      const scopedOwner = blockHydrationOwner(parent, cursor, part, anchor, owner);
      const active = blockBuildersOrFail().whenActive(part, signalOf(ctx, part.signal).value);
      const partScope = scope.child();
      const branchScope = partScope.child();
      const before = cursor;
      cursor = hydrateNodes(
        ctx,
        parent,
        cursor,
        active ? part.on : part.off,
        `${nodePath}.branch`,
        // Branch content keeps the anchor's canonical walk-path prefix:
        // resetting to [] would collide with template-level walk paths and
        // misidentify dynamic attributes. Branch sinks attribute themselves
        // by their own element id (fixedPartsAtNode), so the shared suffix
        // both branches may carry never crosses attribution (alpha15).
        nodeProgramPath,
        branchScope,
        scopedOwner,
        pending,
        item,
        itemPart,
        itemValueSlots,
        undefined,
        stream,
        branchInstalls,
      );
      const end = expectComment(
        at(cursor++),
        partAnchorEndMarker(part.index),
        nodePath,
        scopedOwner,
      );
      const block: WhenBlock = {
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
      // The ownership record a reconnect re-arms (revive.ts).
      ctx.bindings.set(part.index, block);
      partScope.addRangeCleanup(() => removeNodes(block.nodes));
      // The claimed branch's own value sinks bind at attach time, on the
      // branch scope (alpha15) — staged like every other subscription.
      branchInstalls?.push({
        scope: branchScope,
        nodes: block.nodes,
        whenIndex: part.index,
        which: active ? 'on' : 'off',
      });
      pending.push({
        scope: partScope,
        signal: part.signal,
        fn: (value) => blockBuildersOrFail().updateWhen(block, value),
      });
      continue;
    }
    if (part.k === 'each') {
      const anchor = expectComment(at(cursor++), partAnchorMarker(part.index), nodePath, owner);
      const scopedOwner = blockHydrationOwner(parent, cursor, part, anchor, owner);
      const items = hydrateItemRecords(
        part,
        signalOf(ctx, part.signal).value,
        nodePath,
        scopedOwner,
      );
      const partScope = scope.child();
      const block: EachBlock = {
        ctx,
        part,
        scope: partScope,
        anchor,
        end: anchor,
        entries: [],
        byKey: new Map(),
        item: NO_ITEM,
      };
      // The ownership record a reconnect re-arms (revive.ts).
      ctx.bindings.set(part.index, block);
      partScope.addRangeCleanup(() => {
        for (const entry of block.entries) removeNodes(entry.nodes);
      });
      for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
        const currentItem = items[itemIndex];
        const key = eachItemKey(part, currentItem);
        const itemScope = partScope.child();
        const itemSlots: ItemValueSlot[] = [];
        const itemAttrs: ItemAttrSlot[] = [];
        const before = cursor;
        cursor = hydrateNodes(
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
        // Claimed item DOM gets the same per-item listeners a fresh build
        // mounts (#1556 IR v2): the box keeps them live across keyed reuse.
        const itemBox = { item: currentItem };
        const entry: EachEntry = {
          key,
          scope: itemScope,
          nodes: Array.from(parent.childNodes).slice(before, cursor),
          valueSlots: itemSlots,
          attrSlots: itemAttrs,
          itemBox,
          item: currentItem,
        };
        attachItemEvents(ctx, part, entry.nodes, itemScope, itemBox);
        block.entries.push(entry);
        block.byKey.set(key, entry);
      }
      block.end = expectComment(
        at(cursor++),
        partAnchorEndMarker(part.index),
        nodePath,
        scopedOwner,
      );
      pending.push({
        scope: partScope,
        signal: part.signal,
        fn: (next) => blockBuildersOrFail().updateEach(block, next),
      });
      continue;
    }
    hydrateFailure(nodePath, `Part ${node.index} has no hydrate anchor`, owner);
  }
  return cursor;
}

export type HydrationRecoveryMode = 'throw' | 'owning';

/** Hydration-time options for the owning root. */
export interface CompiledHydrationOptions {
  /**
   * True when the hydrating class carries static styles. The server serializer
   * emits those styles as LEADING marked nodes of the template — the inline
   * `<style data-oe-static-styles>` text fallback for URL-less sheets, and
   * `<link rel="stylesheet" data-oe-static-styles>` for every externalised
   * sheet (alpha15 S lane) — so hydration skips exactly those nodes (see
   * `isStaticStyleNode`). A marked style node on a style-less class is drift
   * and fails closed.
   *
   * Hydration-then-delete: the skipped inline fallback is removed only after
   * the staged plan attaches (Parts bound, rootOffset honored throughout) —
   * a hydration failure keeps it, so recovery and never-upgrade pages keep
   * first-paint styling by construction. A skipped LINK is never removed: it
   * is the external reference, not a duplicate of an adopted sheet.
   */
  expectStaticStyle?: boolean;
  /**
   * Aggregate readiness of the component's replacing style sheets, when any is
   * still filling: a generated client adapter creates its sheet synchronously
   * and installs the rules later. The fallback node retires only once these
   * sheets are installed, so a sheet that is still loading never leaves the
   * shadow tree without styling. Absent means every sheet is already usable.
   */
  staticStyleReady?: Promise<unknown>;
  /** Default is `throw`; `owning` enables one bounded recovery attempt. */
  /**
   * The external stylesheet resources this component's markup may declare
   * (alpha15 S lane, S-R1). Derived by the kernel from the class's own sheet
   * objects and the registered framework sheets — build facts, never the DOM
   * under verification. Identity is path + query, so origin- and
   * spelling-differences between the bundler-resolved client URL and the
   * server-declared href are not drift; a different resource never matches.
   * Absent/empty means no fact was supplied and marked links are accepted.
   */
  expectedStyleLinks?: readonly string[];
  recovery?: HydrationRecoveryMode;
  /** Observe the exact structured mismatch before optional recovery. */
  onMismatch?: (error: PartProgramHydrationError) => void;
  /** Events captured before upgrade and replayed after a successful attach. */
  preUpgradeEvents?: readonly PreUpgradeEvent[] | PreUpgradeEventCapture;
  /** Stream-only Parts have a closing marker even for text; pending ranges are empty. */
  streamParts?: readonly number[];
  pendingParts?: readonly number[];
}

/** The document base an observed or expected resource URL resolves against. */
function documentBaseURI(): string {
  return typeof document === 'undefined' ? 'http://localhost/' : document.baseURI;
}

/**
 * The count of marked static-style nodes the serializer emitted as the
 * template's leading children. The scan skips exactly these; the claim keeps
 * every link (an external reference is the delivery, not a fallback) and may
 * retire the inline fallback once the replacing sheets are installed.
 *
 * A marked LINK is additionally checked against the expected resource set
 * (alpha15 S lane, S5-D1): the expected hrefs come from the class's own sheet
 * objects and the registered framework sheets — the compiler/build facts —
 * never from the DOM being claimed. A href that set does not declare is drift
 * and fails closed, so an unrelated valid URL can never pass for the
 * component's stylesheet.
 */
function leadingStaticStyleNodeCount(
  root: Node,
  options: CompiledHydrationOptions,
  owner: RootHydrationOwner,
): number {
  let count = 0;
  while (isStaticStyleNode(root.childNodes[count])) {
    const node = root.childNodes[count];
    if (isElement(node) && node.tagName.toLowerCase() === 'link') {
      const href = node.getAttribute('href') ?? '';
      const expected = options.expectedStyleLinks;
      if (
        expected !== undefined &&
        expected.length > 0 &&
        !isExpectedStyleResource(href, expected, { baseURI: documentBaseURI() })
      ) {
        hydrateFailure(
          'template',
          `unexpected static stylesheet resource ${JSON.stringify(styleResourceIdentity(href, { baseURI: documentBaseURI() }))}`,
          owner,
        );
      }
    }
    count++;
  }
  return count;
}

/**
 * Hydration-then-delete: remove the marked inline DSD style node this
 * hydration skipped at index 0. Called only after the staged plan has attached —
 * removal must not precede hydration because Part paths resolve against
 * rootOffset=1 — so the node served first paint and anchored the scan, and
 * the shared adopted sheet the kernel applied is the one remaining channel.
 * A failed hydration never reaches the caller, leaving the node in place for
 * recovery and for pages that never upgrade.
 *
 * Only the INLINE fallback is retired. The marked `<link rel="stylesheet">`
 * nodes (framework-generated component CSS, alpha15 S lane) are a declarative
 * external resource, not a duplicate of an adopted sheet: the runtime keeps
 * them and does not adopt the sheet they deliver (open-element-theme.ts), so a
 * root always has exactly one delivery.
 */
function removeHydratedStaticStyle(root: Node): void {
  const node = root.childNodes[0];
  if (isStaticStyleFallbackNode(node)) root.removeChild(node);
}

/**
 * Resolve every fixed-Part target and read every dependency during the scan
 * phase. Unresolved paths are structural drift (a hydration mismatch owned by the
 * root); missing signals/handlers/refs fail before any subscription or
 * listener can attach.
 */
function validateFixedPartTargets(
  ctx: MountContext,
  root: Node,
  rootOffset: number,
  owner: HydrationOwner,
): void {
  for (const part of ctx.program.parts) {
    if (!isFixedPart(part)) continue;
    // A branch-owned sink's path is a branch-relative address; it resolves
    // when its branch mounts, never from the claim root.
    if (ctx.branchParts.owned.has(part.index)) continue;
    try {
      resolvePath(root, part.path, `${part.k} Part`, rootOffset);
    } catch {
      hydrateFailure(
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
function scanHydration(
  ctx: MountContext,
  root: Node,
  options: CompiledHydrationOptions,
  pending: DeferredSubscription[],
  stream?: StreamHydrationState,
  branchInstalls?: DeferredBranchInstall[],
): number {
  const owner: RootHydrationOwner = { kind: 'root', root };
  const styleNodeCount = leadingStaticStyleNodeCount(root, options, owner);
  if (styleNodeCount > 0 && !options.expectStaticStyle) {
    hydrateFailure('template', 'unexpected static style element', owner);
  }
  const cursorStart = styleNodeCount;
  const consumed = hydrateNodes(
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
    branchInstalls,
  );
  if (consumed !== root.childNodes.length) {
    hydrateFailure('template', 'unexpected trailing nodes', owner);
  }
  validateFixedPartTargets(ctx, root, cursorStart, owner);
  return cursorStart;
}

/**
 * Hydration existing SSR DOM without allocating or overwriting live values.
 *
 * Hydration is staged: the complete owned structure is validated first, then
 * subscriptions, listeners, and refs attach. A successful hydration performs no
 * node allocation or replacement (browser node identity is preserved). A
 * mismatch fails closed with a structured PartProgramHydrationError unless
 * `recovery: 'owning'` was explicitly requested, which grants exactly one
 * bounded rebuild of the mismatching owner.
 */
export function hydrateExistingDom(
  program: PartProgramV2,
  host: CompiledRuntimeHost,
  root: Node,
  options: CompiledHydrationOptions = {},
  ownerScope?: LifetimeScope,
): CompiledProgramInstance {
  // Stop a live capture before staged validation so a failed hydration cannot
  // leave its root listener installed. The captured records are replayed only
  // after the complete plan has attached successfully.
  const capturedEvents = preUpgradeEventList(options.preUpgradeEvents);
  const recovery = options.recovery ?? 'throw';
  let recovered = false;
  let rootRebuilt = false;
  for (;;) {
    const ctx = createContext(normalizePartProgram(program), host, ownerScope);
    const pending: DeferredSubscription[] = [];
    const branchInstalls: DeferredBranchInstall[] = [];
    const streamed = new Set(options.streamParts ?? []);
    const unresolved = new Set(options.pendingParts ?? []);
    const isStream = options.streamParts !== undefined || options.pendingParts !== undefined;
    const stream: StreamHydrationState | undefined = isStream
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
        hydrateFailure('template', 'invalid streamed or pending Part selection', {
          kind: 'root',
          root,
        });
      }
      const cursorStart = scanHydration(ctx, root, options, pending, stream, branchInstalls);
      if (stream && stream.ranges.size !== unresolved.size) {
        hydrateFailure('template', 'pending Part has no owned range', { kind: 'root', root });
      }
      for (const deferred of pending) {
        subscribeWrites(ctx, deferred.scope, deferred.signal, deferred.fn);
      }
      // The claimed branches' own value sinks bind last, on their branch
      // scopes (alpha15): claim mode keeps the served values, a rebuilt root
      // gets the live ones exactly as fresh creation would apply them.
      const branchMode = rootRebuilt ? 'fresh' : 'claim';
      for (const install of branchInstalls) {
        installBranchValueParts(
          ctx,
          install.scope,
          install.nodes,
          install.whenIndex,
          install.which,
          branchMode,
        );
      }
      // A rebuilt root carries no live values yet: fixed Parts apply their
      // initial values exactly as fresh creation would. A Block-range recovery
      // never contains fixed-Part targets, so `claim` mode stands.
      attachFixedParts(ctx, root, rootRebuilt ? 'fresh' : 'claim', cursorStart);
      replayPreUpgradeEvents(root, capturedEvents);
      // Part binding completed: the DSD style node's double application
      // retires (no-op when the hydration ran from cursor 0). On the recovery
      // path this is "recovery completed" from the scenario table. A sheet that
      // is still filling keeps the fallback — it is the only styling channel
      // until the replacement is installed on this root, and the style scope
      // reports the failure if it never arrives.
      if (cursorStart > 0) {
        const ready = options.staticStyleReady;
        if (ready === undefined) removeHydratedStaticStyle(root);
        else
          void ready.then(
            () => {
              // The root may have been detached (or replaced) while the sheet
              // was loading; an obsolete connection never mutates the DOM.
              if (root.isConnected) removeHydratedStaticStyle(root);
            },
            () => {
              /* The owning style scope reports the failure; keep the fallback. */
            },
          );
      }
      const hydrated = stream
        ? createRevivableInstance(ctx, root, {
            streamParts: streamed,
            // Live view: ranges resolve over the element's lifetime.
            pendingParts: { has: (index: number) => stream.ranges.has(index) },
          })
        : createRevivableInstance(ctx, root);
      if (!stream || stream.ranges.size === 0) return hydrated;
      let disposed = false;
      return {
        dispose() {
          disposed = true;
          hydrated.dispose();
        },
        suspend() {
          hydrated.suspend?.();
        },
        revive() {
          // Re-arm the inner bindings, then hand every still-pending stream
          // range a live scope again (resolveDeferred fills it later).
          hydrated.revive?.();
          for (const range of stream.ranges.values()) range.scope = ctx.rootScope.child();
        },
        resolveDeferred(index) {
          if (disposed || !stream.ranges.has(index)) {
            hydrateFailure(`parts[${index}]`, 'stream Part is disposed or already resolved', {
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
      if (!(error instanceof PartProgramHydrationError)) throw error;
      options.onMismatch?.(error);
      if (stream || recovery !== 'owning' || recovered || !recoverHydrationOwner(error, ctx)) {
        throw error;
      }
      recovered = true;
      rootRebuilt = error.owner.kind === 'root';
    }
  }
}
