/**
 * Bounded `owning` recovery for the existing-DOM hydration: rebuilding exactly
 * the mismatching owner — one Block range between its anchors, one stream
 * Part's owned range, or the owning root's children. Nothing outside the
 * compiled location identity is searched or touched. Recovery re-enters the
 * hydration scan (hydrateNodes, hydrateItemRecords, hydrateFailure in claim.ts) for
 * the retried range, while hydrateExistingDom calls back into
 * resolveStreamRange/recoverHydrationOwner here — a function-level ESM cycle
 * between hoisted declarations with no top-level evaluation, which is safe.
 */

import {
  partAnchorEndMarker,
  partAnchorMarker,
  type ProgramEachPart,
  type ProgramTreeNode,
  type ProgramWhenPart,
} from '@openelement/protocol/part-program';
import { ClaimErrorCode, RuntimeErrorCode } from '@openelement/protocol/errors';
import type { MountContext } from './program-kernel.ts';
import {
  displayValue,
  fail,
  fixedPartsAtNode,
  fixedPartsAtPath,
  isStaticStyleNode,
  itemAttrValue,
  itemValue,
  NO_ITEM,
  signalOf,
  subscribeWrites,
} from './program-kernel.ts';
import { applyBranchSinkInitials, installBranchValueParts } from './parts.ts';
import { blockBuildersOrFail } from './blocks-seam.ts';
import {
  hydrateFailure,
  hydrateItemRecords,
  hydrateNodes,
  type CompiledHydrationOptions,
  type DeferredBranchInstall,
  type DeferredSubscription,
  PartProgramHydrationError,
  type StreamHydrationRange,
} from './hydrate.ts';

function recoverStreamRange(
  ctx: MountContext,
  range: StreamHydrationRange,
  index: number,
): boolean {
  const part = ctx.program.parts[index];
  const { parent, anchor, end } = range;
  const doc = parent.ownerDocument;
  if (!doc || anchor.parentNode !== parent || end.parentNode !== parent) return false;
  const nodes =
    part.k === 'text'
      ? (() => {
          const value = displayValue(signalOf(ctx, part.signal).value);
          return value ? [doc.createTextNode(value)] : [];
        })()
      : part.k === 'when' || part.k === 'each'
        ? buildRecoveryBlockContent(ctx, doc, part)
        : [];
  let cursor = anchor.nextSibling;
  while (cursor && cursor !== end) {
    const next = cursor.nextSibling;
    parent.removeChild(cursor);
    cursor = next;
  }
  if (cursor !== end) return false;
  for (const node of nodes) parent.insertBefore(node, end);
  return true;
}

export function resolveStreamRange(
  ctx: MountContext,
  range: StreamHydrationRange,
  index: number,
  options: CompiledHydrationOptions,
): void {
  let recovered = false;
  for (;;) {
    const { parent, anchor, end } = range;
    const children = Array.from(parent.childNodes);
    const start = children.indexOf(anchor);
    const finish = children.indexOf(end);
    if (start < 0 || finish <= start) {
      hydrateFailure(range.path, 'stream Part anchors are detached or out of order', range.owner);
    }
    const scope = range.scope.child();
    const subscriptions: DeferredSubscription[] = [];
    const branchInstalls: DeferredBranchInstall[] = [];
    try {
      const consumed = hydrateNodes(
        ctx,
        parent,
        start,
        [{ k: 'part', id: ctx.program.parts[index].location.id, index }],
        range.path,
        range.programPath,
        scope,
        range.owner,
        subscriptions,
        NO_ITEM,
        undefined,
        undefined,
        undefined,
        { streamed: new Set([index]), pending: new Set(), ranges: new Map() },
        branchInstalls,
      );
      if (consumed !== finish + 1) {
        hydrateFailure(range.path, 'stream Part has unexpected trailing nodes', range.owner);
      }
      for (const deferred of subscriptions) {
        subscribeWrites(ctx, deferred.scope, deferred.signal, deferred.fn);
      }
      for (const install of branchInstalls) {
        installBranchValueParts(
          ctx,
          install.scope,
          install.nodes,
          install.whenIndex,
          install.which,
          'fresh',
        );
      }
      return;
    } catch (error) {
      scope.dispose();
      if (!(error instanceof PartProgramHydrationError)) throw error;
      options.onMismatch?.(error);
      if (options.recovery !== 'owning' || recovered || !recoverStreamRange(ctx, range, index))
        throw error;
      recovered = true;
    }
  }
}

/** Static recovery build: Block branches and item templates hold no anchors. */
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
    fail(
      ClaimErrorCode.DYNAMIC_NODE_IN_STATIC_REGION,
      '[compiled-hydration] recovery build met a dynamic node in a static Block',
    );
  }
  return out;
}

/** Recovery build of one each-Block item (static template, live item values). */
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
      fail(
        ClaimErrorCode.ITEM_TEMPLATE_ANCHOR,
        '[compiled-hydration] item templates may not contain Part anchors',
      );
    }
    return out;
  };
  return build(part.item);
}

/** Recovery build of one Block's current content (no subscriptions). */
function buildRecoveryBlockContent(
  ctx: MountContext,
  doc: Document,
  part: ProgramWhenPart | ProgramEachPart,
): Node[] {
  if (part.k === 'when') {
    const active = blockBuildersOrFail().whenActive(part, signalOf(ctx, part.signal).value);
    const which = active ? 'on' : 'off';
    const nodes = buildStaticRecoveryNodes(doc, active ? part.on : part.off);
    // The rebuilt branch carries its own sinks' values (no subscriptions —
    // the retried claim re-arms the live bindings on the fresh scope).
    applyBranchSinkInitials(ctx, nodes, part.index, which);
    return nodes;
  }
  const items = hydrateItemRecords(part, signalOf(ctx, part.signal).value, `parts[${part.index}]`, {
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
      fail(
        RuntimeErrorCode.ITEM_SLOT_OUTSIDE_REGION,
        '[compiled-hydration] item value slot outside an each Block',
      );
    }
    if (node.k === 'el') {
      const element = doc.createElement(node.tag);
      for (const [name, value] of node.attrs) element.setAttribute(name, value);
      const hasHtmlSink =
        fixedPartsAtPath(ctx, nodePath).some((part) => part.k === 'html') ||
        fixedPartsAtNode(ctx, node.id).some((part) => part.k === 'html');
      if (!hasHtmlSink) {
        for (const child of buildRecoveryTemplateNodes(ctx, doc, node.children, nodePath)) {
          element.appendChild(child);
        }
      }
      out.push(element);
      continue;
    }
    const part = ctx.program.parts[node.index];
    if (!part) fail(RuntimeErrorCode.PART_MISSING, `[compiled-runtime] missing Part ${node.index}`);
    if (part.k === 'text') {
      out.push(doc.createComment(partAnchorMarker(part.index)));
      const current = displayValue(signalOf(ctx, part.signal).value);
      if (current.length > 0) out.push(doc.createTextNode(current));
      continue;
    }
    if (part.k === 'when' || part.k === 'each') {
      out.push(doc.createComment(partAnchorMarker(part.index)));
      out.push(...buildRecoveryBlockContent(ctx, doc, part));
      out.push(doc.createComment(partAnchorEndMarker(part.index)));
      continue;
    }
    fail(
      RuntimeErrorCode.FIXED_PART_AS_ANCHOR,
      `[compiled-runtime] fixed Part ${part.index} cannot be used as an anchor`,
    );
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
 * Bounded `owning` recovery: replace only the mismatching owner — one Block
 * range between its anchors, or the owning root's children (the marked static
 * style node is preserved through the rebuild so the retried scan still
 * claims from rootOffset=1; it is removed only after the recovered hydration
 * attaches — §5 "recovery completed"). Nothing outside the compiled
 * location identity is searched or touched.
 */
export function recoverHydrationOwner(
  error: PartProgramHydrationError,
  ctx: MountContext,
): boolean {
  if (error.owner.kind === 'block') {
    const { parent, anchor, end, part } = error.owner;
    if (anchor.parentNode !== parent || end.parentNode !== parent) return false;
    const doc = parent.ownerDocument;
    if (!doc) return false;
    const replacement = buildRecoveryBlockContent(ctx, doc, part);
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
  // Preserve every leading marked static-style node in order — the external
  // `<link>` delivery and/or the inline fallback (alpha15 S lane). Recovery
  // rebuilds the Part-owned nodes only; the style nodes are the framework's
  // delivery and must survive exactly as the claim found them.
  const leadingStyles: Node[] = [];
  while (isStaticStyleNode(root.childNodes[0])) {
    const node = root.childNodes[0]!;
    root.removeChild(node);
    leadingStyles.push(node);
  }
  removeAllChildren(root);
  for (const node of leadingStyles) root.appendChild(node);
  for (const node of replacement) root.appendChild(node);
  return true;
}
