/**
 * The generated-code insertion primitive: mount recipes and their per-projection
 * owners (JSX model §4, §4.1a/§4.1b/§4.2, ADR-0173 2026-11-03 amendment).
 *
 * A JSX expression in value position is a compiler-emitted **mount recipe** —
 * an opaque, non-serializable insertion description. Creating one evaluates no
 * authored expression, allocates no DOM and no instance, and reads no signal
 * (§4.2 row 1). Inserting one at a projection site creates that insertion's own
 * child `LifetimeScope`, one instance of the props record, the DOM region, and
 * its cleanups (§4.2 row 2). Inserting the SAME recipe twice therefore yields
 * two isolated owners/instances/regions — never a shared or moved region.
 *
 * ## Shape (design decision)
 *
 * A recipe is a sealed JavaScript object with a documented, non-traversable
 * shape — `definitionOwner`, `mount`, `createProps`, `source` — consumed only by
 * {@linkcode insertRecipe}. This is the "sealed internal object with a single
 * call method" option the model leaves open (§8 item 1); it was chosen over a
 * bare closure because the runtime must enforce the projection-lineage rule
 * (§4.1c) and a closure carries no definition owner to check. There is no type
 * tag, no children list and no runtime dispatch: a generic walker has nothing to
 * traverse, and every consumer must go through `insertRecipe`, which requires
 * both owners. Generated call sites are expected to look like:
 *
 * ```js
 * const counter = createRecipe({
 *   definitionOwner: __owner,
 *   mount: Counter__mount,
 *   createProps: () => ({ get step() { return step.value; } }),
 *   source: 'Counter.tsx',
 * });
 * // two insertion sites are two calls with the same recipe:
 * insertRecipe(__owner, counter, parent, before);
 * insertRecipe(__owner, counter, parent, before);
 * ```
 *
 * ## Mount contract
 *
 * `mount(scope, props)` creates the instance's DOM **detached** and returns its
 * top-level nodes in document order. Exception-safe ownership requires:
 *
 * 1. the child scope already exists (it does — `insertRecipe` creates it);
 * 2. every acquired resource registers on that scope AS IT IS ACQUIRED — a node
 *    range cleanup before the node can be appended anywhere, listeners through
 *    `scope.add`, write subscriptions through `bindSignalWrites` — so a failing
 *    setup can be rolled back completely (§4.1b rows 1–4);
 * 3. the mount does not attach the returned nodes to their final parent; the
 *    inserting projection site owns the position (`insertRecipe` inserts them,
 *    and removal of the whole region is registered before that first insertion,
 *    so a throw during insertion removes the partial range too).
 *
 * On failure `insertRecipe` disposes the scope in detach mode (resources first,
 * then any registered partial range), suppresses cleanup errors and rethrows the
 * ORIGINAL construction error (§4.1b row 7). A failed projection never attaches
 * an orphan region to the parent.
 *
 * ## Disposal mapping (§4.1a)
 *
 * `projection.dispose()` is plain scope disposal: abort, child scopes in
 * insertion order, own cleanups LIFO — the owned DOM STAYS in place, which is
 * the disconnect/suspend path the revive machinery depends on. `dispose(true)`
 * additionally runs the range cleanups and removes the region. Inheriting the
 * mode down a subtree is `LifetimeScope`'s existing behavior; this module does
 * not add a second disposal mechanism.
 *
 * @module ./recipe.ts
 */

import {
  raiseFrameworkError,
  RUNTIME_MESSAGES_ENABLED,
  RuntimeErrorCode,
} from '@openelement/protocol/errors';
import type { LifetimeScope } from '../lifetime-scope.ts';
import { assertOwnProjectionAllowed, assertProjectionAllowed } from './lineage.ts';
import {
  recordOwnerCreated,
  recordProjection,
  recordProjectionDisposed,
  recordRangeCleanup,
  recordRegionAllocated,
} from './observability.ts';
import { removeNodes } from './values.ts';

/** One generated mount: build this instance's detached DOM, owned by `scope`. */
export type MountFunction<P = unknown> = (scope: LifetimeScope, props: Readonly<P>) => Node[];

/**
 * One generated claim: adopt the existing children of `parent` in place.
 *
 * The function returns the adopted top-level nodes. It must not create
 * replacement nodes for a matching structure, and a structural mismatch must
 * throw before any subscription is registered. A throw does not promise to
 * restore bytes already written: validation that throws before a write leaves
 * zero writes, and an activation throw may leave an earlier dynamic write.
 * `claimRecipe` then releases resources without deleting the borrowed nodes.
 * Absent on recipes whose shape is outside the M07a leaf slice; mount stays
 * available either way.
 */
export type ClaimFunction<P = unknown> = (
  scope: LifetimeScope,
  props: Readonly<P>,
  parent: Node,
) => Node[];

/** The options one generated recipe call site provides. */
export interface RecipeOptions<P = unknown> {
  /** The owner the JSX value was created in (definition-site lineage anchor). */
  definitionOwner: LifetimeScope;
  /** The generated mount for one instance of the recipe. */
  mount: MountFunction<P>;
  /**
   * Optional generated claim for this recipe (M07a). Omitted recipes cannot
   * be claimed; `claimRecipe` fails closed before allocating an owner.
   */
  claim?: ClaimFunction<P>;
  /**
   * Creates this insertion's props record; called exactly once per insertion,
   * at insertion time (never at recipe creation). Defaults to an empty record.
   */
  createProps?: () => P;
  /** Author-facing source label named by coded failures (e.g. `Counter.tsx:12`). */
  source?: string;
}

/**
 * One mount recipe: an opaque insertion description. Sealed and frozen; its
 * fields are runtime-internal hooks, not a program structure.
 */
export interface Recipe<P = unknown> {
  readonly definitionOwner: LifetimeScope;
  readonly mount: MountFunction<P>;
  /** Present only when this recipe was created with a generated claim. */
  readonly claim?: ClaimFunction<P>;
  readonly createProps: () => P;
  readonly source: string;
}

/**
 * Create a mount recipe. Allocates one small object; reads no signal, runs no
 * authored expression and touches no DOM (§4.2a row 1). A recipe captured before
 * its definition owner is disposed may still be inserted until that disposal —
 * the lineage check fails closed at insertion time.
 */
export function createRecipe<P = unknown>(options: RecipeOptions<P>): Recipe<P> {
  const recipe: Recipe<P> = {
    definitionOwner: options.definitionOwner,
    mount: options.mount,
    createProps: options.createProps ?? (() => ({}) as P),
    source: options.source ?? 'generated mount',
    ...(options.claim === undefined ? {} : { claim: options.claim }),
  };
  return Object.freeze(recipe);
}

/** One live projection: an inserted instance and the region it owns. */
export interface Projection<P = unknown> {
  /** Region identity, unique per insertion (two insertions never share one). */
  readonly region: number;
  /** The projection-site owner: a child scope of the inserting owner. */
  readonly owner: LifetimeScope;
  /** The owned top-level DOM nodes, in document order (possibly empty). */
  readonly nodes: readonly Node[];
  /** This instance's props record (stable identity; see `createTrackedProps`). */
  readonly props: Readonly<P>;
  /**
   * Dispose this projection's resources. The default keeps the owned DOM in
   * place (disconnect/suspend); `true` additionally removes the owned region.
   * Idempotent: a second call is a no-op, and a plain-dispose projection cannot
   * later have its region removed through this handle (the range cleanups were
   * released when the scope was disposed — the lifetime-scope contract).
   */
  dispose(detachOwnedNodes?: boolean): void;
}

let nextRegionId = 1;

/**
 * Release the failed projection's resources while keeping its original error.
 * Mount rollback also removes partial ranges. Claim rollback keeps borrowed
 * nodes and any bytes an already-run activation wrote.
 */
function rollbackProjection(owner: LifetimeScope, detachOwnedNodes: boolean): void {
  try {
    owner.dispose(detachOwnedNodes);
  } catch {
    // Every cleanup was still attempted; the construction error is what surfaces.
  }
}

/**
 * The common projection operation once the caller has validated ownership.
 * Mount inserts the produced nodes. Claim adopts an existing region.
 */
function project<P>(
  insertingOwner: LifetimeScope,
  createProps: () => P,
  createNodes: (owner: LifetimeScope, props: P) => Node[],
  parent: Node,
  before: Node | null,
  insert: boolean,
): Projection<P> {
  const owner = insertingOwner.child();
  recordOwnerCreated();
  const region = nextRegionId++;
  recordRegionAllocated();

  let props: P;
  let nodes: Node[];
  try {
    props = createProps();
    nodes = createNodes(owner, props);
  } catch (error) {
    rollbackProjection(owner, insert);
    throw error;
  }

  // Register removal before a mount can place any part of the region, or
  // only after a claim has successfully adopted its existing nodes.
  owner.addRangeCleanup(() => removeNodes(nodes));
  recordRangeCleanup();
  if (insert) {
    try {
      for (const node of nodes) parent.insertBefore(node, before);
    } catch (error) {
      rollbackProjection(owner, true);
      throw error;
    }
  }

  recordProjection(nodes.length);
  let disposed = false;
  const projection: Projection<P> = {
    region,
    owner,
    nodes,
    props,
    dispose(detachOwnedNodes = false): void {
      if (disposed) return;
      disposed = true;
      recordProjectionDisposed();
      owner.dispose(detachOwnedNodes);
    },
  };
  return Object.freeze(projection);
}

/** Insert a recipe within a live definition owner's subtree. */
export function insertRecipe<P>(
  insertingOwner: LifetimeScope,
  recipe: Recipe<P>,
  parent: Node,
  before: Node | null = null,
): Projection<P> {
  assertProjectionAllowed(recipe.definitionOwner, insertingOwner, recipe.source);
  return project(
    insertingOwner,
    () => recipe.createProps(),
    (owner, props) => recipe.mount(owner, props),
    parent,
    before,
    true,
  );
}

/** Claim existing nodes with a recipe whose definition owner is still live. */
export function claimRecipe<P>(
  insertingOwner: LifetimeScope,
  recipe: Recipe<P>,
  parent: Node,
): Projection<P> {
  assertProjectionAllowed(recipe.definitionOwner, insertingOwner, recipe.source);
  if (recipe.claim === undefined) {
    const where = `[compiled-runtime] ${recipe.source}`;
    raiseFrameworkError(
      'csr',
      RuntimeErrorCode.LEAF_CLAIM_UNAVAILABLE,
      RUNTIME_MESSAGES_ENABLED
        ? `${where}: no generated claim`
        : `${where}: ${RuntimeErrorCode.LEAF_CLAIM_UNAVAILABLE}`,
    );
  }
  return project(
    insertingOwner,
    () => recipe.createProps(),
    (owner, props) => recipe.claim!(owner, props, parent),
    parent,
    null,
    false,
  );
}

function createEmptyProjectionProps(): Record<string, never> {
  return {};
}

/** Project a compiled leaf whose definition belongs to this insertion owner. */
export function projectOwnGeneratedLeaf(
  owner: LifetimeScope,
  source: string,
  createNodes: (owner: LifetimeScope) => Node[],
  parent: Node,
  insert: boolean,
): Projection<Record<string, never>> {
  assertOwnProjectionAllowed(owner, source);
  return project(owner, createEmptyProjectionProps, createNodes, parent, null, insert);
}
