/**
 * Projection lineage: the M04 check that a mount recipe may be inserted at a
 * given projection site (JSX model §4.1c, TSX-26).
 *
 * The approved contract is: lexical dependencies belong to the definition site,
 * ownership belongs to the projection site, and a projection must stay inside
 * the definition owner's subtree in Alpha16 — projecting a recipe into another
 * owner tree would create an instance that outlives the state it reads. The
 * runtime therefore rejects, fail-closed and coded:
 *
 * - a projection whose definition owner is already disposed (deferred insertion
 *   after definition disposal; captured signals would write to dead scopes),
 * - a projection into a disposed owner,
 * - a projection whose inserting owner is not the definition owner or one of its
 *   descendants.
 *
 * `LifetimeScope` stays a scope, not a graph service: the ancestry walk lives
 * here and reads the parent link through the module-internal `parentScopeOf`
 * query in `lifetime-scope.ts` — one query, no public surface, no graph API on
 * the class. The check runs once per insertion, so a projection that never
 * crosses an owner boundary pays one short walk.
 *
 * The failure code reuses the catalogue: a dead owner is `OE_KERNEL_DISPOSED`
 * (the same class as the `LifetimeScope` attach guard) and a non-descendant
 * projection is `OE_KERNEL_ROOT_NOT_OWNED` (the supplied owner is not owned by
 * the definition owner). A dedicated lineage code would need a protocol
 * catalogue addition, which is outside this slice — recorded as an owner
 * decision in the PR body.
 *
 * @module ./lineage.ts
 */

import {
  KernelErrorCode,
  raiseFrameworkError,
  RUNTIME_MESSAGES_ENABLED,
} from '@openelement/protocol/errors';
import { parentScopeOf, type LifetimeScope } from '../lifetime-scope.ts';
import { recordLineage } from './observability.ts';

/** The definition-site label a coded failure names (compiler-supplied). */
export type ProjectionSource = string;

/**
 * Raise one projection-lineage failure. The production message-strip seam
 * (#1546) keeps the source label and the code and folds the prose away, the
 * same discipline every other compiled-runtime failure follows.
 */
function failProjection(code: string, source: ProjectionSource, prose: string): never {
  const where = `[compiled-runtime] ${source}`;
  raiseFrameworkError(
    'csr',
    code,
    RUNTIME_MESSAGES_ENABLED ? `${where}: ${prose}` : `${where}: ${code}`,
  );
}

/**
 * Assert that `projectionOwner` may project a recipe defined by
 * `definitionOwner`. Throws a coded, source-located failure otherwise; returns
 * silently when the projection is legal.
 */
export function assertProjectionAllowed(
  definitionOwner: LifetimeScope,
  projectionOwner: LifetimeScope,
  source: ProjectionSource,
): void {
  if (definitionOwner.disposed) {
    recordLineage(false);
    failProjection(
      KernelErrorCode.DISPOSED,
      source,
      'cannot project a recipe whose definition owner was disposed; a projection may not ' +
        'outlive the state its getters read (deferred insertion after definition disposal is ' +
        'not supported)',
    );
  }
  if (projectionOwner.disposed) {
    recordLineage(false);
    failProjection(KernelErrorCode.DISPOSED, source, 'cannot project into a disposed owner');
  }
  // The definition owner itself is a legal projection site: a component's own
  // region scopes are children of the owner its JSX value was created in.
  for (let current: LifetimeScope | undefined = projectionOwner; current;) {
    if (current === definitionOwner) {
      recordLineage(true);
      return;
    }
    current = parentScopeOf(current);
  }
  recordLineage(false);
  failProjection(
    KernelErrorCode.ROOT_NOT_OWNED,
    source,
    'the projection owner is not inside the recipe definition owner subtree; cross-owner ' +
      'projection is not supported in Alpha16',
  );
}
