/**
 * Revival of an already-activated instance (the reconnect path).
 *
 * Reconnecting an activated element re-binds the DOM the runtime itself
 * produced. That is not a claim of unknown DOM, so it must not require the SSR
 * hydration executor — which is why the runtime keeps the ownership graph (the
 * per-Part bindings in `ctx.bindings`) and re-arms it here instead: the same
 * Part/Block runtime, the same update machinery, no walker, no artifact
 * validation, and the same behavior on every entry (`index`, `client-only`,
 * `no-blocks`, `base`).
 *
 * Two phases, in this order:
 *
 * 1. VERIFY the owned structure: walk the program against the parent child
 *    lists and require every program node (and every binding's own nodes) at
 *    its exact position. A root may carry trailing app children; every other
 *    parent must hold exactly its program children. Any mismatch fails closed
 *    with the diagnostics the claim-time walk reports — a damaged activation is
 *    never silently rebuilt, and nothing is mutated before the whole structure
 *    passes.
 * 2. RE-ARM the retained bindings: fresh scopes, re-subscribed signals, the
 *    fixed/event/ref Parts re-attached against the verified tree, and every
 *    binding reconciled to its current signal value through the ordinary
 *    update path (which keeps node identity for unchanged values).
 */

import {
  DATA_OE_LIGHT,
  partAnchorEndMarker,
  partAnchorMarker,
  type ProgramEachPart,
  type ProgramTreeNode,
} from '@openelement/protocol/part-program';
import {
  ClaimErrorCode,
  RuntimeErrorCode,
  raiseFrameworkError,
} from '@openelement/protocol/errors';
import { LifetimeScope } from '../lifetime-scope.ts';
import {
  type CompiledProgramInstance,
  fail,
  fixedPartsAtNode,
  fixedPartsAtPath,
  isComment,
  isElement,
  isStaticStyleNode,
  isText,
  type MountContext,
  removeNodes,
  signalOf,
  subscribeWrites,
} from './program-kernel.ts';
import {
  attachFixedParts,
  installBranchValueParts,
  reconcileTextPart,
  type TextPartSlot,
  updateTextPart,
} from './parts.ts';
import { attachItemEvents, blockBuildersOrFail } from './blocks-seam.ts';
import type { EachBlock, EachEntry, WhenBlock } from './blocks.ts';

/** Stream bookkeeping a resumed instance must respect (owned ranges). */
export interface OwnedRangeOptions {
  /** Parts whose text range carries the stream's closing anchor. */
  streamParts?: ReadonlySet<number>;
  /** Parts whose streamed range is still pending (anchors only). */
  pendingParts?: { has(index: number): boolean };
}

/** Structured diagnostic for a resume whose DOM is no longer the one it owns. */
function structureFailure(path: string, message: string): never {
  raiseFrameworkError(
    'csr',
    ClaimErrorCode.STRUCTURE_MISMATCH,
    `[compiled-hydration] ${path}: ${message}`,
  );
}

function describeExpected(node: Node): string {
  if (isElement(node)) return `expected <${node.tagName.toLowerCase()}>`;
  if (isComment(node)) return `expected <!--${node.data}--> anchor`;
  if (isText(node)) return 'expected a text node';
  return 'missing child';
}

function describeAt(node: Node | undefined, expected: string): string {
  if (!node) return `missing child (expected ${expected})`;
  if (isElement(node)) return `expected ${expected}, found <${node.tagName.toLowerCase()}>`;
  if (isComment(node)) return `expected ${expected}, found <!--${node.data}-->`;
  if (isText(node)) return `expected ${expected}, found a text node`;
  return `expected ${expected}`;
}

/** Verify one Part anchor plus the nodes its binding owns. */
function verifyBinding(
  ctx: MountContext,
  parent: Node,
  cursor: number,
  index: number,
  path: string,
  ranges: OwnedRangeOptions,
): number {
  const part = ctx.program.parts[index];
  if (!part) structureFailure(path, `missing Part ${index}`);
  if (ranges.pendingParts?.has(index) === true) {
    // A streamed range that never resolved: anchors only, no content yet.
    const anchor = parent.childNodes[cursor];
    if (!anchor || !isComment(anchor) || anchor.data !== partAnchorMarker(index)) {
      structureFailure(path, `expected <!--${partAnchorMarker(index)}--> anchor`);
    }
    const end = parent.childNodes[cursor + 1];
    if (!end || !isComment(end) || end.data !== partAnchorEndMarker(index)) {
      structureFailure(path, `expected <!--${partAnchorEndMarker(index)}--> anchor`);
    }
    return cursor + 2;
  }
  const binding = ctx.bindings.get(index);
  if (!binding) structureFailure(path, `missing binding for Part ${index}`);
  if (part.k === 'text') {
    const slot = binding as TextPartSlot;
    if (parent.childNodes[cursor] !== slot.anchor) {
      structureFailure(path, `expected <!--${partAnchorMarker(index)}--> anchor`);
    }
    cursor++;
    if (slot.text) {
      if (parent.childNodes[cursor] !== slot.text) {
        structureFailure(path, 'expected the Part value node');
      }
      cursor++;
    }
    if (ranges.streamParts?.has(index) === true) {
      const end = parent.childNodes[cursor];
      if (!end || !isComment(end) || end.data !== partAnchorEndMarker(index)) {
        structureFailure(path, `expected <!--${partAnchorEndMarker(index)}--> anchor`);
      }
      cursor++;
    }
    return cursor;
  }
  // Block ranges: the anchors plus the live range the binding owns.
  const block = binding as WhenBlock | EachBlock;
  if (parent.childNodes[cursor] !== block.anchor) {
    structureFailure(path, `expected <!--${partAnchorMarker(index)}--> anchor`);
  }
  cursor++;
  const owned: readonly Node[] =
    part.k === 'when'
      ? (block as WhenBlock).nodes
      : (block as EachBlock).entries.flatMap((entry: EachEntry) => entry.nodes);
  for (const node of owned) {
    if (parent.childNodes[cursor] !== node) structureFailure(path, describeExpected(node));
    cursor++;
  }
  if (parent.childNodes[cursor] !== block.end) {
    structureFailure(path, `expected <!--${partAnchorEndMarker(index)}--> anchor`);
  }
  return cursor + 1;
}

/** Verify one program node list against one parent's children. */
function verifyNodes(
  ctx: MountContext,
  parent: Node,
  cursor: number,
  nodes: readonly ProgramTreeNode[],
  path: string,
  programPath: number[],
  exact: boolean,
  ranges: OwnedRangeOptions,
): number {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const nodePath = `${path}[${index}]`;
    if (node.k === 'text') {
      const dom = parent.childNodes[cursor];
      if (dom === undefined) structureFailure(nodePath, 'missing child (expected a text node)');
      if (!isText(dom)) structureFailure(nodePath, describeAt(dom, 'a text node'));
      cursor++;
      continue;
    }
    if (node.k === 'el') {
      const dom = parent.childNodes[cursor];
      if (dom === undefined) {
        structureFailure(nodePath, `missing child (expected <${node.tag}>)`);
      }
      if (!isElement(dom) || dom.tagName.toLowerCase() !== node.tag) {
        structureFailure(nodePath, describeAt(dom, `<${node.tag}>`));
      }
      cursor++;
      const nodeProgramPath = [...programPath, index];
      const hasHtmlSink =
        fixedPartsAtPath(ctx, nodeProgramPath).some((part) => part.k === 'html') ||
        fixedPartsAtNode(ctx, node.id).some((part) => part.k === 'html');
      // The same owned-subtree cases the claim walk honors: a trusted-HTML
      // sink, an expanded light island, and a projected slot own their
      // children; their content is not part of the parent's program nodes.
      const ownsExpandedSubtree =
        node.children.length === 0 &&
        node.tag.includes('-') &&
        dom.getAttribute(DATA_OE_LIGHT) !== null;
      const ownsProjection =
        node.tag === 'slot' && node.children.length === 0 && dom.childNodes.length > 0;
      if (!hasHtmlSink && !ownsExpandedSubtree && !ownsProjection) {
        // The recursion verifies the child's own extent (`exact`); the parent
        // cursor only advances past the element itself.
        verifyNodes(
          ctx,
          dom,
          0,
          node.children,
          `${nodePath}.children`,
          nodeProgramPath,
          true,
          ranges,
        );
      }
      continue;
    }
    // Item value slots live inside each entries' node lists (verified through
    // the Block binding); only an item template reaches them directly.
    if (node.k === 'ival') continue;
    cursor = verifyBinding(ctx, parent, cursor, node.index, nodePath, ranges);
  }
  if (exact && cursor !== parent.childNodes.length) {
    structureFailure(path, 'unexpected trailing nodes');
  }
  return cursor;
}

/** Re-bind one retained Part: a fresh scope, the same subscription, the current value. */
function armBinding(ctx: MountContext, scope: LifetimeScope, index: number): void {
  const part = ctx.program.parts[index];
  const binding = ctx.bindings.get(index);
  if (!part || !binding) return;
  if (part.k === 'text') {
    const slot = binding as TextPartSlot;
    const partScope = scope.child();
    slot.scope = partScope;
    subscribeWrites(ctx, partScope, part.signal, (value) => updateTextPart(slot, value));
    // The reconnect cannot trust its retained baseline: the DOM it owned may
    // carry a write that never reached a subscription, so the value is
    // applied unconditionally (in place, identity preserved).
    reconcileTextPart(slot, signalOf(ctx, part.signal).value);
    return;
  }
  if (part.k !== 'when' && part.k !== 'each') return;
  const builders = blockBuildersOrFail();
  if (part.k === 'when') {
    const block = binding as WhenBlock;
    const partScope = scope.child();
    block.scope = partScope;
    partScope.addRangeCleanup(() => removeNodes(block.nodes));
    subscribeWrites(ctx, partScope, part.signal, (value) => {
      try {
        builders.updateWhen(block, value);
      } catch (error) {
        if (!ctx.host.onUpdateError) throw error;
        ctx.host.onUpdateError(error);
      }
    });
    // Only a branch flip rebuilds: an unchanged branch keeps its nodes.
    builders.updateWhen(block, signalOf(ctx, part.signal).value);
    // A kept branch's own value sinks died with the disposed scopes (alpha15):
    // a rebuilt branch re-installed inside updateWhen, so only the kept one
    // needs a fresh branch scope and re-bind here.
    if (block.branchScope.disposed) {
      block.branchScope = partScope.child();
      installBranchValueParts(
        ctx,
        block.branchScope,
        block.nodes,
        part.index,
        block.current ? 'on' : 'off',
        'fresh',
      );
    }
    return;
  }
  const block = binding as EachBlock;
  const partScope = scope.child();
  block.scope = partScope;
  partScope.addRangeCleanup(() => {
    for (const entry of block.entries) removeNodes(entry.nodes);
  });
  for (const entry of block.entries) {
    entry.scope = partScope.child();
    attachEventsForEntry(ctx, part as ProgramEachPart, entry);
  }
  subscribeWrites(ctx, partScope, part.signal, (value) => {
    try {
      builders.updateEach(block, value);
    } catch (error) {
      if (!ctx.host.onUpdateError) throw error;
      ctx.host.onUpdateError(error);
    }
  });
  // Keyed reuse: unchanged items keep their nodes and listeners.
  builders.updateEach(block, signalOf(ctx, part.signal).value);
}

function attachEventsForEntry(ctx: MountContext, part: ProgramEachPart, entry: EachEntry): void {
  attachItemEvents(ctx, part, entry.nodes, entry.scope, entry.itemBox);
}

/**
 * Reconnect the DOM an activated instance owns: verify first (nothing is
 * mutated on a mismatch), then re-arm every retained binding on a fresh root
 * scope.
 *
 * The leading marked static-style nodes the serializer emitted are skipped by
 * the SAME predicate the claim uses (`isStaticStyleNode`): the inline fallback
 * of the pre-externalisation shape and the declarative `<link>` the alpha15 S
 * lane serves are both delivery, never program drift. A style-only assumption
 * here failed every reconnect of a served link root closed.
 */
export function reviveOwnedDom(
  ctx: MountContext,
  root: Node,
  ranges: OwnedRangeOptions = {},
): void {
  const styleOffset = isStaticStyleNode(root.childNodes[0]) ? 1 : 0;
  verifyNodes(ctx, root, styleOffset, ctx.program.template, 'template', [], false, ranges);
  const scope = new LifetimeScope();
  ctx.rootScope = scope;
  for (const index of [...ctx.bindings.keys()].sort((left, right) => left - right)) {
    armBinding(ctx, scope, index);
  }
  attachFixedParts(ctx, root, 'fresh', styleOffset);
}

/** Build the reconnectable instance: suspend keeps the DOM, revive re-arms. */
export function createRevivableInstance(
  ctx: MountContext,
  root: Node,
  ranges: OwnedRangeOptions = {},
): CompiledProgramInstance {
  let disposed = false;
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      ctx.rootScope.dispose();
    },
    suspend(): void {
      if (disposed) return;
      ctx.rootScope.dispose();
    },
    revive(): void {
      if (disposed) {
        fail(RuntimeErrorCode.PART_MISSING, '[compiled-runtime] instance is disposed');
      }
      reviveOwnedDom(ctx, root, ranges);
    },
  };
}
