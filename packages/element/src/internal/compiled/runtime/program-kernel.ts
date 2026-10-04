/**
 * Shared execution core of the compiled Part Program runtime: the mount
 * context, the host contracts, the signal subscription plumbing, and the
 * node/value helpers every executor — fresh DOM creation, existing-DOM claim,
 * seed serialization — rides on. This module imports no sibling: parts,
 * fresh-dom, regions, claim, and pre-upgrade-events all draw their shared
 * machinery from here.
 */

import type { SignalLike, Unsubscribe } from '../../protocol/signal.ts';
import type {
  PartProgramV1,
  ProgramEachPart,
  ProgramTreeNode,
} from '../../protocol/part-program.ts';
// The single error dialect (#1386 item 3): every failure raised by this module
// is an OpenElementError carrying a code from the catalogue, so a consumer
// classifies a compiled-runtime failure by code instead of by message prefix.
import { raiseFrameworkError, RuntimeErrorCode } from '../../protocol/errors.ts';
import type { RuntimeProgramIR } from '../runtime-program.ts';
import { LifetimeScope } from '../lifetime-scope.ts';

export type ProgramFixedPart = Extract<
  PartProgramV1['parts'][number],
  { k: 'attr' | 'prop' | 'bool' | 'class' | 'style' | 'html' | 'event' | 'ref' }
>;

export type CompiledEventHandler = (event: unknown) => void;
export type CompiledRefHandler = (element: Element | null) => void | Unsubscribe;

/** Host-provided state and behavior keyed by compiler-emitted names. */
export interface CompiledRuntimeHost {
  signals: Record<string, SignalLike<unknown>>;
  handlers: Record<string, CompiledEventHandler>;
  refs?: Record<string, CompiledRefHandler>;
  /**
   * Update-phase error sink (#1375): when a signal-driven Region update
   * (when/each) throws after activation, the runtime reports the error here
   * instead of letting it escape into the signal writer's stack, and leaves
   * the subscription live so a later write can retry. No rollback is
   * attempted — DOM mutation is not transactional — but the guarded failure
   * modes leave the Region's owned DOM either untouched (each pre-validates
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
}

export interface MountContext {
  program: RuntimeProgramIR;
  host: CompiledRuntimeHost;
  rootScope: LifetimeScope;
  fixedPartsByPath: Map<string, ProgramFixedPart[]>;
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
  };
}

/**
 * Source origin for runtime diagnostics (#1413 W3): the compiled module and
 * tag an author can actually find. The wire Part Program deliberately omits
 * the compile-time `sourceMap` (browser payload discipline — see
 * semantic-core/compile.ts), so a runtime failure names the file and the
 * authored property or Region rather than a line; line/column live on the
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
      `${origin(ctx)}: render() reads this.${name}, but no host signal is registered. Every ` +
        `signal read by render() must be a declared @property on the compiled class.`,
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
 * Wrap one Region's update callback with the update-phase isolation contract
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

export function isFixedPart(part: PartProgramV1['parts'][number]): part is ProgramFixedPart {
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

export function isComment(node: Node): node is Comment {
  return node.nodeType === 8;
}

export function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

export function isElement(node: Node): node is Element {
  return node.nodeType === 1;
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
 * Item fields referenced by an each Region's template (ival + iattr slots):
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
