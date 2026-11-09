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
import { assertProjectionAllowed } from './lineage.ts';
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
 * Roll a failed projection's scope back: full disposal plus partial-range
 * removal, suppressing cleanup errors so the construction error survives.
 */
function rollbackProjection(owner: LifetimeScope): void {
  try {
    owner.dispose(true);
  } catch {
    // Every cleanup was still attempted; the construction error is what surfaces.
  }
}

/** Insert the mounted nodes at the projection site, preserving their order. */
function insertRegion(parent: Node, nodes: readonly Node[], before: Node | null): void {
  for (const node of nodes) parent.insertBefore(node, before);
}

/**
 * Insert one recipe at a projection site: lineage check, one child owner, one
 * props record, one DOM region, one range cleanup.
 *
 * @param insertingOwner - the owner of the site projecting the recipe.
 * @param recipe - the mount recipe being inserted (may be inserted repeatedly).
 * @param parent - the node the region is inserted into.
 * @param before - insert before this child, or append when `null`.
 */
export function insertRecipe<P>(
  insertingOwner: LifetimeScope,
  recipe: Recipe<P>,
  parent: Node,
  before: Node | null = null,
): Projection<P> {
  // Fail closed before any owner or DOM exists: a rejected projection leaves
  // the parent untouched (TSX-25/TSX-26 negatives).
  assertProjectionAllowed(recipe.definitionOwner, insertingOwner, recipe.source);

  const owner = insertingOwner.child();
  recordOwnerCreated();
  const region = nextRegionId++;
  recordRegionAllocated();

  let props!: P;
  let nodes: Node[];
  try {
    props = recipe.createProps();
    nodes = recipe.mount(owner, props);
  } catch (error) {
    rollbackProjection(owner);
    throw error;
  }

  // Register the region's removal BEFORE the first node enters the parent: a
  // throw during insertion then rolls the partial range back too (§4.1b rows
  // 3–5). The mount's own per-resource registrations run first (LIFO), so a
  // range node is never left behind by a throwing resource cleanup.
  owner.addRangeCleanup(() => removeNodes(nodes));
  recordRangeCleanup();
  try {
    insertRegion(parent, nodes, before);
  } catch (error) {
    rollbackProjection(owner);
    throw error;
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

/**
 * Release resources from a failed claim without deleting borrowed DOM and
 * without restoring bytes already written. Range cleanups are not run.
 * Validation that throws before a write therefore leaves the parent unchanged.
 * Activation that throws after a dynamic write may leave that write in place
 * while non-range cleanups still run. Whole-region byte rollback is not this
 * function; that would be a separate design.
 */
function rollbackClaim(owner: LifetimeScope): void {
  try {
    owner.dispose(false);
  } catch {
    // The claim error is what surfaces; every non-range cleanup was still attempted.
  }
}

/**
 * Claim one recipe onto an existing parent: lineage check, one child owner,
 * one props record, and the nodes the generated claim adopts in place.
 *
 * Unlike {@link insertRecipe}, this does not create or move DOM, and it does
 * not use §4.1b's detach rollback. A recipe without a claim function fails
 * before any owner exists. A claim that throws disposes the child owner with
 * `dispose(false)`: resources are released, borrowed nodes stay, and bytes
 * written before the throw are not restored. A structural check that throws
 * before writing leaves zero writes. A later throw may preserve an earlier
 * dynamic write. This is not an entire-claim byte transaction.
 */
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

  const owner = insertingOwner.child();
  recordOwnerCreated();
  const region = nextRegionId++;
  recordRegionAllocated();

  let props!: P;
  let nodes: Node[];
  try {
    props = recipe.createProps();
    nodes = recipe.claim(owner, props, parent);
  } catch (error) {
    rollbackClaim(owner);
    throw error;
  }

  // The nodes are already in `parent`. Register removal only after claim
  // succeeds, so a throwing claim cannot delete them.
  owner.addRangeCleanup(() => removeNodes(nodes));
  recordRangeCleanup();
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
