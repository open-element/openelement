/**
 * Shared execution core of the compiled Part Program runtime: the mount
 * context, the host contracts, the signal subscription plumbing, and the
 * node/value helpers every executor — fresh DOM creation, existing-DOM hydration,
 * seed serialization — rides on. This module imports no sibling: parts,
 * fresh-dom, blocks, claim, and pre-upgrade-events all draw their shared
 * machinery from here.
 */

import type { SignalLike, Unsubscribe } from '@openelement/protocol/signal';
import {
  STATIC_STYLES_MARKER,
  type PartProgramV2,
  type ProgramEachPart,
  type ProgramTreeNode,
} from '@openelement/protocol/part-program';
// The single error dialect (#1386 item 3): every failure raised by this module
// is an OpenElementError carrying a code from the catalogue, so a consumer
// classifies a compiled-runtime failure by code instead of by message prefix.
import {
  raiseFrameworkError,
  RUNTIME_MESSAGES_ENABLED,
  RuntimeErrorCode,
} from '@openelement/protocol/errors';
import type { RuntimeProgramIR } from '../runtime-program.ts';
// Type-only (erased): the binding shapes this context records, owned by the
// Part and Block modules that create them.
import type { TextPartSlot } from './parts.ts';
import type { EachBlock, WhenBlock } from './blocks.ts';
import { LifetimeScope } from '../lifetime-scope.ts';

export type ProgramFixedPart = Extract<
  PartProgramV2['parts'][number],
  { k: 'attr' | 'prop' | 'bool' | 'class' | 'style' | 'html' | 'event' | 'ref' }
>;

/** The fixed value sinks a when-Block branch can own (events/refs stay outside blocks). */
export type ProgramBranchSinkPart = Extract<
  PartProgramV2['parts'][number],
  { k: 'attr' | 'prop' | 'bool' | 'class' | 'style' | 'html' }
>;

/**
 * The branch-sink plan of one program (alpha15): which fixed value sinks a
 * when Block's branches own, per branch. Attribution is by the sink's
 * location element id — ids are globally unique across the template and every
 * branch tree, so the plan is exact even where both branches carry a sink at
 * the same branch-relative suffix. Built once per MountContext; a program
 * without when Parts plans nothing.
 */
export interface BranchPartPlan {
  /** Branch-owned value sinks keyed by the owning when Part's index. */
  readonly byWhen: ReadonlyMap<
    number,
    { on: ProgramBranchSinkPart[]; off: ProgramBranchSinkPart[] }
  >;
  /** Indexes of every branch-owned fixed Part (the root attach walks skip them). */
  readonly owned: ReadonlySet<number>;
}

function collectElementIds(nodes: readonly ProgramTreeNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.k === 'el') {
      out.add(node.id);
      collectElementIds(node.children, out);
    }
  }
}

/** True when `path` walks the branch tree to the element `nodeId` names. */
function branchResolves(
  tree: readonly ProgramTreeNode[],
  path: readonly number[],
  nodeId: string,
): boolean {
  let list = tree;
  let node: ProgramTreeNode | undefined;
  for (const index of path) {
    node = list[index];
    if (!node) return false;
    list = node.k === 'el' ? node.children : [];
  }
  return !!node && node.k === 'el' && node.id === nodeId;
}

/**
 * The location element id of one fixed value sink. The wire validator pins
 * every sink location to carry its target node, so a validated program never
 * misses it; the guard keeps the optional wire shape honest at the boundary.
 */
function sinkNodeId(part: ProgramBranchSinkPart): string {
  const nodeId = part.location.node;
  if (nodeId === undefined) {
    fail(RuntimeErrorCode.PATH_UNRESOLVED, `[compiled-runtime] ${part.k} Part has no sink node`);
  }
  return nodeId;
}

function buildBranchPartPlan(program: PartProgramV2): BranchPartPlan {
  const byWhen = new Map<number, { on: ProgramBranchSinkPart[]; off: ProgramBranchSinkPart[] }>();
  const owned = new Set<number>();
  const whens = program.parts.filter((part) => part.k === 'when');
  if (whens.length === 0) return { byWhen, owned };
  const valueSinks = program.parts.filter(
    (part): part is ProgramBranchSinkPart =>
      part.k === 'attr' ||
      part.k === 'prop' ||
      part.k === 'bool' ||
      part.k === 'class' ||
      part.k === 'style' ||
      part.k === 'html',
  );
  if (valueSinks.length === 0) return { byWhen, owned };
  const templateIds = new Set<string>();
  collectElementIds(program.template, templateIds);
  for (const when of whens) {
    const on: ProgramBranchSinkPart[] = [];
    const off: ProgramBranchSinkPart[] = [];
    for (const sink of valueSinks) {
      if (templateIds.has(sinkNodeId(sink))) continue;
      if (branchResolves(when.on, sink.path, sinkNodeId(sink))) on.push(sink);
      else if (branchResolves(when.off, sink.path, sinkNodeId(sink))) off.push(sink);
    }
    if (on.length > 0 || off.length > 0) {
      byWhen.set(when.index, { on, off });
      for (const sink of [...on, ...off]) owned.add(sink.index);
    }
  }
  return { byWhen, owned };
}

/** The retained binding of one Part anchor (see MountContext.bindings). */
export type PartBinding = TextPartSlot | WhenBlock | EachBlock;

export type CompiledEventHandler = (event: unknown) => void;
export type CompiledRefHandler = (element: Element | null) => void | Unsubscribe;

/** Host-provided state and behavior keyed by compiler-emitted names. */
export interface CompiledRuntimeHost {
  signals: Record<string, SignalLike<unknown>>;
  handlers: Record<string, CompiledEventHandler>;
  refs?: Record<string, CompiledRefHandler>;
  /**
   * Update-phase error sink (#1375): when a signal-driven Block update
   * (when/each) throws after activation, the runtime reports the error here
   * instead of letting it escape into the signal writer's stack, and leaves
   * the subscription live so a later write can retry. No rollback is
   * attempted — DOM mutation is not transactional — but the guarded failure
   * modes leave the Block's owned DOM either untouched (each pre-validates
   * the whole array before mutating) or explicitly emptied (when disposes the
   * old branch before rebuilding), never a half-committed mix. The compiled
   * kernel routes this into the element's CompiledErrorBoundary: the nearest
   * boundary owning those subscriptions. A host without a sink keeps the
   * propagating behavior.
   */
  onUpdateError?: (error: unknown) => void;
}

export interface CompiledProgramInstance {
  dispose(): void;
  /** Adopt one formerly pending streamed Part after its owned range is filled. */
  resolveDeferred?(partIndex: number): void;
  /**
   * Detach the live bindings (subscriptions, listeners) while keeping the DOM
   * this instance produced and the ownership record that re-arms it
   * (revive.ts). A suspended instance owns no live resources.
   */
  suspend?(): void;
  /** Re-verify the owned DOM and re-arm every retained binding. */
  revive?(): void;
}

export interface MountContext {
  program: RuntimeProgramIR;
  host: CompiledRuntimeHost;
  rootScope: LifetimeScope;
  fixedPartsByPath: Map<string, ProgramFixedPart[]>;
  /**
   * The program's branch-sink plan (alpha15): the fixed value sinks a
   * when Block owns per branch, and the index set the root attach walks skip.
   */
  branchParts: BranchPartPlan;
  /**
   * The DOM ownership record of this program instance: one retained binding
   * per Part anchor (text slot, when Block, each Block). Built by whichever
   * executor materialized the DOM (fresh creation or the initial claim) and
   * re-armed by a reconnect (revive.ts) — the reconnect never re-discovers
   * the tree it produced.
   */
  bindings: Map<number, PartBinding>;
}

export function createContext(
  program: RuntimeProgramIR,
  host: CompiledRuntimeHost,
  ownerScope?: LifetimeScope,
): MountContext {
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
    rootScope: ownerScope?.child() ?? new LifetimeScope(),
    fixedPartsByPath,
    branchParts: buildBranchPartPlan(program),
    bindings: new Map(),
  };
}

/**
 * Source origin for runtime diagnostics (#1413 W3): the compiled module and
 * tag an author can actually find. The wire Part Program deliberately omits
 * the compile-time `sourceMap` (browser payload discipline — see
 * semantic-core/compile.ts), so a runtime failure names the file and the
 * authored property or Block rather than a line; line/column live on the
 * compile-time OEC diagnostics, which run before a program can ship. These
 * strings ride the client bundle, so each one stays as short as it can while
 * still naming the cause and the fix.
 */
export function origin(ctx: MountContext): string {
  return `${ctx.program.metadata.sourceFile} <${ctx.program.tag}>`;
}

/**
 * Raise one runtime failure (#1386 item 3): every throw in this module is an
 * `OpenElementError` carrying a code from the catalogue, so a consumer catches
 * a compiled-runtime failure by code rather than by `[compiled-runtime]`
 * message prefix. The `[compiled-runtime]` text stays in the message for the
 * reader; the code is the contract.
 */
export function fail(code: string, message: string): never {
  raiseFrameworkError('render', code, message);
}

export function signalOf(ctx: MountContext, name: string): SignalLike<unknown> {
  const signal = ctx.host.signals[name];
  if (!signal) {
    fail(
      RuntimeErrorCode.HOST_SIGNAL_MISSING,
      // #1546 strip seam: a production client build folds the prose branch
      // away and keeps the origin + code form.
      RUNTIME_MESSAGES_ENABLED
        ? `${origin(ctx)}: render() reads this.${name}, but no host signal is registered. Every ` +
            `signal read by render() must be a declared @property on the compiled class.`
        : `${origin(ctx)}: ${RuntimeErrorCode.HOST_SIGNAL_MISSING}`,
    );
  }
  return signal;
}

/**
 * Subscribe to future writes only. Preact's adapter delivers a synchronous
 * initial effect; a conforming lazy engine may not. Only that exact
 * subscription-time echo is ignored, so a lazy engine's first real write is
 * never lost.
 */
export function subscribeWrites(
  ctx: MountContext,
  scope: LifetimeScope,
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
    fail(
      RuntimeErrorCode.SUBSCRIPTION_INVALID,
      `[compiled-runtime] signal "${name}" returned an invalid unsubscribe`,
    );
  }
  scope.add(unsub);
}

/**
 * Wrap one Block's update callback with the update-phase isolation contract
 * (#1375): a throw is reported to the host's update-error sink (the kernel's
 * CompiledErrorBoundary) and not rethrown, so the failing write never escapes
 * into the signal writer's stack and the subscription stays live for the
 * next write. A host without a sink keeps the propagating behavior.
 */
export function guardedUpdate(
  ctx: MountContext,
  fn: (value: unknown) => void,
): (value: unknown) => void {
  return (value) => {
    try {
      fn(value);
    } catch (error) {
      if (!ctx.host.onUpdateError) throw error;
      ctx.host.onUpdateError(error);
    }
  };
}

export function isFixedPart(part: PartProgramV2['parts'][number]): part is ProgramFixedPart {
  return (
    part.k === 'attr' ||
    part.k === 'prop' ||
    part.k === 'bool' ||
    part.k === 'class' ||
    part.k === 'style' ||
    part.k === 'html' ||
    part.k === 'event' ||
    part.k === 'ref'
  );
}

export function fixedPartsAtPath(ctx: MountContext, path: number[]): ProgramFixedPart[] {
  const parts = [...(ctx.fixedPartsByPath.get(path.join('.')) ?? [])];
  return parts.sort((left, right) => left.index - right.index);
}

/**
 * The fixed value sinks one template element owns by its stable id — the
 * branch-sink complement of {@linkcode fixedPartsAtPath}: a branch sink's
 * path is branch-relative, so claim-time checks attribute it to the element
 * node it names, not to a template walk path.
 */
export function fixedPartsAtNode(ctx: MountContext, nodeId: string): ProgramFixedPart[] {
  const out: ProgramFixedPart[] = [];
  for (const sides of ctx.branchParts.byWhen.values()) {
    for (const sink of [...sides.on, ...sides.off]) {
      if (sink.location.node === nodeId) out.push(sink);
    }
  }
  return out.sort((left, right) => left.index - right.index);
}
export function isComment(node: Node): node is Comment {
  return node.nodeType === 8;
}

export function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

export function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

/**
 * Is this node one of the marked static-style nodes the SSR serializer emits as
 * a root's LEADING children (alpha15 S lane)? Two shapes: the inline fallback
 * carrying authored CSS text, and the declarative external reference
 * (`<link rel="stylesheet" data-oe-static-styles>`). The tag check comes FIRST:
 * only these two shapes are ever asked for the marker, so every other node is
 * rejected without touching attributes it may not carry.
 *
 * ONE owner, two consumers: the claim (`leadingStaticStyleNodeCount`) and the
 * resume (`reviveOwnedDom`) must skip exactly the same nodes — a resume that
 * skipped only the old inline fallback would treat a served delivery link as
 * program drift and fail the reconnect closed. Keep this predicate here, in the
 * runtime core both executors already import; do not reintroduce a private copy.
 */
export function isStaticStyleNode(node: Node | undefined): boolean {
  if (!node || !isElement(node)) return false;
  const tag = node.tagName.toLowerCase();
  if (tag !== 'style' && tag !== 'link') return false;
  if (!node.hasAttribute(STATIC_STYLES_MARKER)) return false;
  // Only `rel="stylesheet"` links qualify: a marked link with any other
  // relation is drift.
  return tag === 'style' || node.getAttribute('rel') === 'stylesheet';
}

/** True for the marked inline fallback node (the one hydration may retire). */
export function isStaticStyleFallbackNode(node: Node | undefined): boolean {
  return (
    !!node && isStaticStyleNode(node) && isElement(node) && node.tagName.toLowerCase() === 'style'
  );
}

export function displayValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export function removeNodes(nodes: readonly Node[]): void {
  for (const node of nodes) node.parentNode?.removeChild(node);
}

export function insertNodesBefore(parent: Node, nodes: readonly Node[], reference: Node): void {
  for (const node of nodes) parent.insertBefore(node, reference);
}

export function itemValue(part: ProgramEachPart, item: unknown, field?: string): unknown {
  const selected = field ?? part.field;
  if (selected === undefined) return item;
  if (typeof item !== 'object' || item === null) return undefined;
  return (item as Record<string, unknown>)[selected];
}

/**
 * Item fields referenced by an each Block's template (ival + iattr slots):
 * the one required-field set both the claim validator and the server each
 * serializer admit records against, so the two paths cannot disagree on
 * which fields a record must carry.
 */
export function itemTemplateFields(
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

/** Per-item attribute slot value: bare when true, omitted when falsy/absent. */
export function itemAttrValue(item: unknown, field: string): string | null {
  if (typeof item !== 'object' || item === null) return null;
  const value = (item as Record<string, unknown>)[field];
  if (value === true) return '';
  if (value === false || value === null || value === undefined) return null;
  return String(value);
}

/** The sentinel distinguishes an undefined item from no item context. */
export const NO_ITEM = Symbol('compiled-runtime.no-item');

export function instance(ctx: MountContext): CompiledProgramInstance {
  let disposed = false;
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      ctx.rootScope.dispose();
    },
  };
}
