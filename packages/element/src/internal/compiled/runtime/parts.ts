/**
 * Fixed-Part execution of the compiled Part Program runtime: compiler-owned
 * path resolution, the value/event/ref installers shared by fresh creation
 * and claim attach, and the text Part slot with its keyed update.
 */

// Canonical attribute-escape contract (issue #1220, M4/L1) — single source of
// truth, shared with the server serializer and the serialization kernel.
import { trustedHtmlValue } from '../../core/security.ts';
import {
  partAnchorMarker,
  type ProgramAttrPart,
  type ProgramBoolPart,
  type ProgramClassPart,
  type ProgramEventPart,
  type ProgramHtmlPart,
  type ProgramPropPart,
  type ProgramRefPart,
  type ProgramStylePart,
  type ProgramTextPart,
} from '@openelement/protocol/part-program';
// Canonical attr/class/style value coercions — single source of truth,
// shared with the server serializer (server/shared.ts) so all three
// execution modes stay byte-identical; do not reintroduce private copies.
import { attributeValueOf, classValueOf, styleValueOf } from '../server/shared.ts';
import { RuntimeErrorCode } from '@openelement/protocol/errors';
import type { LifetimeScope } from '../lifetime-scope.ts';
import {
  displayValue,
  fail,
  isElement,
  type MountContext,
  type ProgramBranchSinkPart,
  signalOf,
  subscribeWrites,
} from './program-kernel.ts';

export interface TextPartSlot {
  scope: LifetimeScope;
  anchor: Comment;
  text?: Text;
  current: string;
}

/** The canonical anchor/value-node write of one text Part. */
function writeTextPart(slot: TextPartSlot, next: string): void {
  const parent = slot.anchor.parentNode;
  if (!parent) {
    slot.current = next;
    return;
  }
  if (next.length === 0) {
    slot.text?.parentNode?.removeChild(slot.text);
    slot.text = undefined;
  } else if (slot.text) {
    if (slot.text.data !== next) slot.text.data = next;
  } else {
    slot.text = slot.anchor.ownerDocument.createTextNode(next);
    parent.insertBefore(slot.text, slot.anchor.nextSibling);
  }
  slot.current = next;
}

export function updateTextPart(slot: TextPartSlot, value: unknown): void {
  if (slot.scope.disposed) return;
  const next = displayValue(value);
  if (next === slot.current) return;
  writeTextPart(slot, next);
}

/**
 * Reconcile the slot's owned node to `value` unconditionally (resume
 * reconciliation): the reconnect path cannot trust its `current` baseline,
 * because the DOM it owned may carry a write that never reached a
 * subscription.
 */
export function reconcileTextPart(slot: TextPartSlot, value: unknown): void {
  writeTextPart(slot, displayValue(value));
}

export function buildTextPart(
  ctx: MountContext,
  parentScope: LifetimeScope,
  doc: Document,
  part: ProgramTextPart,
): Node[] {
  const scope = parentScope.child();
  const anchor = doc.createComment(partAnchorMarker(part.index));
  const current = displayValue(signalOf(ctx, part.signal).value);
  const slot: TextPartSlot = {
    scope,
    anchor,
    text: current.length > 0 ? doc.createTextNode(current) : undefined,
    current,
  };
  scope.addRangeCleanup(() => {
    slot.text?.parentNode?.removeChild(slot.text);
    slot.text = undefined;
  });
  subscribeWrites(ctx, scope, part.signal, (value) => updateTextPart(slot, value));
  // The ownership record a reconnect re-arms (revive.ts): this slot is the
  // single owner of the anchor and the value node for this Part index.
  ctx.bindings.set(part.index, slot);
  return [anchor, ...(slot.text ? [slot.text] : [])];
}

/** Resolve a compiler-owned static path without any selector/discovery walk. */
export function resolvePath(root: Node, path: number[], where: string, rootOffset = 0): Element {
  // Program paths are relative to the template node list: the first index
  // selects a child of the mount root (the sole template root element lives at
  // path [0]). The validator rejects empty paths, so every path walks at least
  // once into the template.
  if (path.length === 0) {
    fail(RuntimeErrorCode.PATH_UNRESOLVED, `[compiled-runtime] ${where}: path [] unresolved`);
  }
  let node: Node = root;
  for (let depth = 0; depth < path.length; depth++) {
    const index = path[depth] + (depth === 0 ? rootOffset : 0);
    const child = node.childNodes[index];
    if (!child) {
      fail(
        RuntimeErrorCode.PATH_UNRESOLVED,
        `[compiled-runtime] ${where}: path [${path.join(',')}] unresolved`,
      );
    }
    node = child;
  }
  if (!isElement(node)) {
    fail(
      RuntimeErrorCode.PATH_NOT_ELEMENT,
      `[compiled-runtime] ${where}: path [${path.join(',')}] is not an element`,
    );
  }
  return node;
}

/**
 * Resolve a fixed Part's path against an explicit top-level node list — the
 * branch-sink form of {@linkcode resolvePath}: the first index selects from
 * `nodes` (the mounted branch's own node list), deeper indexes walk
 * childNodes. A when branch mounts detached, so its sinks cannot resolve from
 * the mount root; their paths are branch-relative addresses into this list.
 */
function resolvePathInList(nodes: readonly Node[], path: number[], where: string): Element {
  if (path.length === 0) {
    fail(RuntimeErrorCode.PATH_UNRESOLVED, `[compiled-runtime] ${where}: path [] unresolved`);
  }
  let node: Node | undefined = nodes[path[0]];
  for (let depth = 1; depth < path.length; depth++) {
    if (!node) break;
    node = node.childNodes[path[depth]];
  }
  if (!node) {
    fail(
      RuntimeErrorCode.PATH_UNRESOLVED,
      `[compiled-runtime] ${where}: path [${path.join(',')}] unresolved`,
    );
  }
  if (!isElement(node)) {
    fail(
      RuntimeErrorCode.PATH_NOT_ELEMENT,
      `[compiled-runtime] ${where}: path [${path.join(',')}] is not an element`,
    );
  }
  return node;
}

interface PropertySink extends Element {
  [property: string]: unknown;
}

function propertySink(element: Element): PropertySink {
  return element as PropertySink;
}

function applyProperty(element: Element, name: string, value: unknown, initial: boolean): void {
  const sink = propertySink(element);
  if (initial) {
    const serialized = attributeValueOf(value);
    if (serialized === null) element.removeAttribute(name);
    else element.setAttribute(name, serialized);
  }
  sink[name] = value;
}

function applyAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function applyBoolean(element: Element, name: string, value: boolean): void {
  propertySink(element)[name] = value;
  if (value) element.setAttribute(name, '');
  else element.removeAttribute(name);
}

function installValuePart(
  ctx: MountContext,
  root: Node,
  part:
    | ProgramAttrPart
    | ProgramPropPart
    | ProgramBoolPart
    | ProgramClassPart
    | ProgramStylePart
    | ProgramHtmlPart,
  mode: 'fresh' | 'claim',
  rootOffset = 0,
): void {
  const element = resolvePath(root, part.path, `${part.k} Part`, rootOffset);
  installValuePartOn(ctx, element, part, mode, ctx.rootScope.child());
}

/**
 * Bind one value sink to its resolved element on the given scope. The scope
 * is the install's lifetime: the root attach installs on a root-scope child,
 * a when-branch install on the branch scope, so the subscription dies exactly
 * when the DOM it binds dies.
 */
function installValuePartOn(
  ctx: MountContext,
  element: Element,
  part:
    | ProgramAttrPart
    | ProgramPropPart
    | ProgramBoolPart
    | ProgramClassPart
    | ProgramStylePart
    | ProgramHtmlPart,
  mode: 'fresh' | 'claim',
  scope: LifetimeScope,
): void {
  const initial = signalOf(ctx, part.signal).value;
  if (mode === 'fresh') applyInitialSink(element, part, initial);

  if (part.k === 'html') {
    let current = trustedHtmlValue(initial);
    subscribeWrites(ctx, scope, part.signal, (value) => {
      const next = trustedHtmlValue(value);
      if (Object.is(next, current)) return;
      (element as Element).innerHTML = next;
      current = next;
    });
    return;
  }

  if (part.k === 'attr') {
    let current = attributeValueOf(initial);
    subscribeWrites(ctx, scope, part.signal, (value) => {
      const next = attributeValueOf(value);
      if (Object.is(next, current)) return;
      applyAttribute(element, part.name, next);
      current = next;
    });
    return;
  }

  if (part.k === 'prop') {
    let current = initial;
    subscribeWrites(ctx, scope, part.signal, (value) => {
      if (Object.is(value, current)) return;
      applyProperty(element, part.name, value, false);
      current = value;
    });
    return;
  }

  if (part.k === 'bool') {
    let current = Boolean(initial);
    subscribeWrites(ctx, scope, part.signal, (value) => {
      const next = Boolean(value);
      if (Object.is(next, current)) return;
      applyBoolean(element, part.name, next);
      current = next;
    });
    return;
  }

  if (part.k === 'class') {
    let current = classValueOf(initial);
    subscribeWrites(ctx, scope, part.signal, (value) => {
      const next = classValueOf(value);
      if (Object.is(next, current)) return;
      applyAttribute(element, 'class', next || null);
      current = next;
    });
    return;
  }

  let current = styleValueOf(initial);
  subscribeWrites(ctx, scope, part.signal, (value) => {
    const next = styleValueOf(value);
    if (Object.is(next, current)) return;
    applyAttribute(element, 'style', next || null);
    current = next;
  });
}

/**
 * Apply one value sink's initial value without subscribing — the fresh-mode
 * half of {@linkcode installValuePartOn}, reused by the bounded recovery
 * build (no live resources before the retried claim).
 */
function applyInitialSink(element: Element, part: ProgramBranchSinkPart, initial: unknown): void {
  if (part.k === 'html') {
    (element as Element).innerHTML = trustedHtmlValue(initial);
    return;
  }
  if (part.k === 'attr') {
    applyAttribute(element, part.name, attributeValueOf(initial));
    return;
  }
  if (part.k === 'prop') {
    applyProperty(element, part.name, initial, true);
    return;
  }
  if (part.k === 'bool') {
    applyBoolean(element, part.name, Boolean(initial));
    return;
  }
  if (part.k === 'class') {
    applyAttribute(element, 'class', classValueOf(initial) || null);
    return;
  }
  applyAttribute(element, 'style', styleValueOf(initial) || null);
}

function installEventPart(
  ctx: MountContext,
  root: Node,
  part: ProgramEventPart,
  rootOffset = 0,
): void {
  const element = resolvePath(root, part.path, 'event Part', rootOffset);
  const scope = ctx.rootScope.child();
  const handler = ctx.host.handlers?.[part.handler];
  if (!handler) {
    fail(
      RuntimeErrorCode.HOST_HANDLER_MISSING,
      `[compiled-runtime] missing host handler "${part.handler}"`,
    );
  }
  const listener: EventListener = (event) => handler(event);
  element.addEventListener(part.event, listener);
  scope.add(() => element.removeEventListener(part.event, listener));
}

function installRefPart(ctx: MountContext, root: Node, part: ProgramRefPart, rootOffset = 0): void {
  const element = resolvePath(root, part.path, 'ref Part', rootOffset);
  const scope = ctx.rootScope.child();
  const ref = ctx.host.refs?.[part.ref];
  if (!ref) {
    fail(RuntimeErrorCode.HOST_REF_MISSING, `[compiled-runtime] missing host ref "${part.ref}"`);
  }
  let cleanup = ref(element);

  const detach = (): void => {
    try {
      if (typeof cleanup === 'function') cleanup();
    } finally {
      cleanup = undefined;
      ref(null);
    }
  };
  scope.add(detach);
}

export function attachFixedParts(
  ctx: MountContext,
  root: Node,
  mode: 'fresh' | 'claim',
  rootOffset = 0,
): void {
  for (const part of ctx.program.parts) {
    // A branch-owned sink binds when its branch mounts (installBranchValueParts),
    // not from the mount root: its path is a branch-relative address and the
    // root walk would resolve it against the wrong nodes (or fail on the
    // inactive branch).
    if (ctx.branchParts.owned.has(part.index)) continue;
    if (
      part.k === 'attr' ||
      part.k === 'prop' ||
      part.k === 'bool' ||
      part.k === 'class' ||
      part.k === 'style' ||
      part.k === 'html'
    ) {
      installValuePart(ctx, root, part, mode, rootOffset);
    } else if (part.k === 'event') {
      installEventPart(ctx, root, part, rootOffset);
    } else if (part.k === 'ref') {
      installRefPart(ctx, root, part, rootOffset);
    }
  }
}

/**
 * Bind the value sinks one when-Block branch owns, scoped to the branch's
 * lifetime (alpha15). `nodes` is the branch's mounted top-level node list —
 * the address space the branch-relative sink paths index. Claim mode keeps
 * the served values (no initial write); fresh mode applies the signal's
 * current value.
 */
export function installBranchValueParts(
  ctx: MountContext,
  scope: LifetimeScope,
  nodes: readonly Node[],
  whenIndex: number,
  which: 'on' | 'off',
  mode: 'fresh' | 'claim',
): void {
  const sinks = ctx.branchParts.byWhen.get(whenIndex)?.[which] ?? [];
  for (const part of sinks) {
    const element = resolvePathInList(nodes, part.path, `${part.k} Part`);
    installValuePartOn(ctx, element, part, mode, scope);
  }
}

/**
 * Apply the branch sinks' initial values without subscribing — the bounded
 * recovery build's shape: the rebuilt branch DOM carries its sink values, and
 * the retried claim re-arms the live bindings.
 */
export function applyBranchSinkInitials(
  ctx: MountContext,
  nodes: readonly Node[],
  whenIndex: number,
  which: 'on' | 'off',
): void {
  const sinks = ctx.branchParts.byWhen.get(whenIndex)?.[which] ?? [];
  for (const part of sinks) {
    const element = resolvePathInList(nodes, part.path, `${part.k} Part`);
    applyInitialSink(element, part, signalOf(ctx, part.signal).value);
  }
}
